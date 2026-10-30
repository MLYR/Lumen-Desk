import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { importToInput, toMarkdownFile } from './frontmatter.js';
import { fillShell, indexPage, loadShell, notFoundPage, postPage, rss, SITE_NAME, sitemap } from './pages.js';
import {
  effectiveSummary,
  getPublishedBySlug,
  getRow,
  InputError,
  NotFoundError,
  listPublished,
  MAX_MARKDOWN_BYTES,
  parsePostInput,
  rowToPost,
  savePost,
  searchPosts,
  SLUG_RE,
  SlugTakenError,
  toPublicItem,
  type Post,
  type PostRow,
} from './posts.js';
import { renderMarkdown } from './render.js';
import { ImageTooLargeError, MAX_UPLOAD_BYTES, storeImage, UnsupportedImageError } from './uploads.js';

export interface BlogDeps {
  config: Config;
  db: DB;
  now: () => number;
}

const PUBLIC_CACHE = 'public, max-age=60';
const MAX_IMPORT_FILES = 20;
const tooLarge = (c: Context) => c.json({ error: 'payload_too_large' }, 413);
const limit = (maxSize: number) => bodyLimit({ maxSize, onError: tooLarge });

/**
 * Blog routes. Must be registered after the /api/private/* session middleware.
 * Private write requests additionally check Origin and Content-Type (CSRF defense on top of SameSite=Strict).
 */
export function registerBlog(app: Hono, { config, db, now }: BlogDeps): void {
  const shell = loadShell(config.shellDir);
  const siteOrigin = safeOrigin(config.siteUrl);
  const uploadsDir = path.join(config.dataDir, 'uploads');

  const html = (c: Context, title: string, description: string, content: string, status: 200 | 404 = 200) => {
    c.header('Cache-Control', PUBLIC_CACHE);
    return c.html(fillShell(shell, title, description, content), status);
  };
  const notFound = (c: Context) => html(c, `找不到页面 · ${SITE_NAME}`, '', notFoundPage(), 404);

  // ---------- public JSON ----------

  app.get('/api/posts', (c) => {
    const raw = c.req.query('limit') ?? '10';
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n < 1 || n > 50) return c.json({ error: 'invalid_request', message: 'limit 取 1–50' }, 400);
    const tag = c.req.query('tag');
    c.header('Cache-Control', PUBLIC_CACHE);
    return c.json({ items: listPublished(db, { limit: n, tag: tag || undefined }).map(toPublicItem) });
  });

  app.get('/api/search', (c) => {
    const q = (c.req.query('q') ?? '').trim();
    const n = [...q].length;
    if (n < 2 || n > 50) return c.json({ error: 'invalid_request', message: 'q 取 2–50 字' }, 400);
    c.header('Cache-Control', PUBLIC_CACHE);
    return c.json({ items: searchPosts(db, q) });
  });

  // ---------- public HTML ----------

  const blogIndex = (c: Context) =>
    html(c, `博客 · ${SITE_NAME}`, `${SITE_NAME} 的全部文章`, indexPage('博客', listPublished(db)));
  app.get('/blog', blogIndex);
  app.get('/blog/', blogIndex);

  const tagIndex = (c: Context) => {
    const tag = c.req.param('tag') ?? '';
    const posts = listPublished(db, { tag });
    if (!posts.length) return notFound(c);
    return html(c, `标签 · ${tag} · ${SITE_NAME}`, `${SITE_NAME} 中标签为「${tag}」的文章`, indexPage(`标签 · ${tag}`, posts));
  };
  app.get('/blog/tags/:tag', tagIndex);
  app.get('/blog/tags/:tag/', tagIndex);

  const article = (c: Context) => {
    const slug = c.req.param('slug') ?? '';
    const row = SLUG_RE.test(slug) ? getPublishedBySlug(db, slug) : undefined;
    if (!row) return notFound(c);
    return html(c, `${row.title} · ${SITE_NAME}`, effectiveSummary(row), postPage(row));
  };
  app.get('/blog/:slug', article);
  app.get('/blog/:slug/', article);
  app.get('/blog/*', notFound);

  app.get('/rss.xml', (c) => {
    c.header('Cache-Control', PUBLIC_CACHE);
    c.header('Content-Type', 'application/rss+xml; charset=utf-8');
    return c.body(rss(config.siteUrl, listPublished(db, { limit: 20 })));
  });

  app.get('/sitemap.xml', (c) => {
    c.header('Cache-Control', PUBLIC_CACHE);
    c.header('Content-Type', 'application/xml; charset=utf-8');
    return c.body(sitemap(config.siteUrl, listPublished(db)));
  });

  // ---------- private ----------

  const sameOrigin: MiddlewareHandler = async (c, next) => {
    const origin = c.req.header('origin');
    if (origin !== undefined) {
      const o = safeOrigin(origin);
      const host = c.req.header('host');
      const ok = o !== null && (o === siteOrigin || (host !== undefined && new URL(o).host === host.toLowerCase()));
      if (!ok) return c.json({ error: 'bad_origin' }, 403);
    }
    await next();
  };
  const requireType =
    (type: 'application/json' | 'multipart/form-data'): MiddlewareHandler =>
    async (c, next) => {
      const ct = c.req.header('content-type')?.toLowerCase() ?? '';
      if (!ct.startsWith(type)) return c.json({ error: 'unsupported_media_type' }, 415);
      await next();
    };
  const json = [sameOrigin, requireType('application/json'), limit(3 * MAX_MARKDOWN_BYTES)] as const;

  const readJson = async (c: Context): Promise<unknown> => {
    try {
      return await c.req.json();
    } catch {
      throw new InputError('请求体不是有效的 JSON');
    }
  };
  const writeError = (c: Context, err: unknown) => {
    if (err instanceof InputError) return c.json({ error: 'invalid_request', message: err.message }, 400);
    if (err instanceof SlugTakenError) return c.json({ error: 'slug_taken', message: 'slug 已被占用' }, 409);
    if (err instanceof NotFoundError) return c.json({ error: 'not_found' }, 404);
    throw err;
  };

  app.get('/api/private/posts', (c) => {
    const rows = db
      .prepare('SELECT id, slug, title, status, tags, published_at, updated_at FROM posts ORDER BY updated_at DESC, id DESC')
      .all() as unknown as PostRow[];
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        status: r.status,
        tags: JSON.parse(r.tags) as string[],
        publishedAt: r.published_at,
        updatedAt: r.updated_at,
      })),
    });
  });

  app.get('/api/private/posts/export', (c) => {
    const rows = db.prepare('SELECT * FROM posts ORDER BY id').all() as unknown as PostRow[];
    const files: Record<string, Uint8Array> = {};
    for (const r of rows) files[`${r.slug}.md`] = strToU8(toMarkdownFile(rowToPost(r)));
    const zip = zipSync(files, { level: 6 });
    const day = new Date(now()).toISOString().slice(0, 10).replaceAll('-', '');
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', `attachment; filename="lumen-desk-posts-${day}.zip"`);
    return c.body(zip);
  });

  app.get('/api/private/posts/:id{[0-9]+}', (c) => {
    const row = getRow(db, Number(c.req.param('id')));
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json(rowToPost(row));
  });

  app.post('/api/private/posts', ...json, async (c) => {
    try {
      const input = parsePostInput(await readJson(c));
      return c.json(await savePost(db, input, now()), 201);
    } catch (err) {
      return writeError(c, err);
    }
  });

  app.put('/api/private/posts/:id{[0-9]+}', ...json, async (c) => {
    try {
      const input = parsePostInput(await readJson(c));
      return c.json(await savePost(db, input, now(), Number(c.req.param('id'))));
    } catch (err) {
      return writeError(c, err);
    }
  });

  app.delete('/api/private/posts/:id{[0-9]+}', sameOrigin, (c) => {
    const r = db.prepare('DELETE FROM posts WHERE id = ?').run(Number(c.req.param('id')));
    if (r.changes === 0) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });

  app.post(
    '/api/private/posts/import',
    sameOrigin,
    requireType('multipart/form-data'),
    limit(MAX_IMPORT_FILES * MAX_MARKDOWN_BYTES + 1024 * 1024),
    async (c) => {
      let form: Record<string, string | File | Array<string | File>>;
      try {
        form = await c.req.parseBody({ all: true });
      } catch {
        return c.json({ error: 'invalid_request', message: '无法解析表单' }, 400);
      }
      const raw = form.files;
      const files = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter((f): f is File => f instanceof File);
      if (!files.length) return c.json({ error: 'invalid_request', message: '没有 files 字段' }, 400);
      if (files.length > MAX_IMPORT_FILES) return c.json({ error: 'invalid_request', message: `一次最多 ${MAX_IMPORT_FILES} 个文件` }, 400);

      const imported: Array<Pick<Post, 'id' | 'slug' | 'title' | 'status'>> = [];
      const errors: Array<{ file: string; error: string; message?: string }> = [];
      const decoder = new TextDecoder('utf-8', { fatal: true });
      for (const f of files) {
        const name = f.name.slice(0, 200);
        if (f.size > MAX_MARKDOWN_BYTES) {
          errors.push({ file: name, error: 'payload_too_large', message: '文件超过 1 MB' });
          continue;
        }
        try {
          let text: string;
          try {
            text = decoder.decode(await f.arrayBuffer());
          } catch {
            throw new InputError('文件不是 UTF-8 文本');
          }
          const post = await savePost(db, parsePostInput(importToInput(text, name)), now());
          imported.push({ id: post.id, slug: post.slug, title: post.title, status: post.status });
        } catch (err) {
          if (err instanceof InputError) errors.push({ file: name, error: 'invalid_request', message: err.message });
          else if (err instanceof SlugTakenError) errors.push({ file: name, error: 'slug_taken', message: 'slug 已被占用' });
          else throw err;
        }
      }
      return c.json({ imported, errors });
    },
  );

  app.post('/api/private/preview', ...json, async (c) => {
    try {
      const body = (await readJson(c)) as { markdown?: unknown } | null;
      if (typeof body?.markdown !== 'string') throw new InputError('缺少 markdown');
      if (Buffer.byteLength(body.markdown) > MAX_MARKDOWN_BYTES) throw new InputError('正文超过 1 MB');
      return c.json({ html: await renderMarkdown(body.markdown) });
    } catch (err) {
      return writeError(c, err);
    }
  });

  app.post(
    '/api/private/uploads',
    sameOrigin,
    requireType('multipart/form-data'),
    limit(12 * 1024 * 1024),
    async (c) => {
      let file: unknown;
      try {
        file = (await c.req.parseBody()).file;
      } catch {
        return c.json({ error: 'invalid_request', message: '无法解析表单' }, 400);
      }
      if (!(file instanceof File)) return c.json({ error: 'invalid_request', message: '没有 file 字段' }, 400);
      if (file.size > MAX_UPLOAD_BYTES) return tooLarge(c);
      try {
        return c.json(await storeImage(uploadsDir, Buffer.from(await file.arrayBuffer())));
      } catch (err) {
        if (err instanceof UnsupportedImageError) {
          return c.json({ error: 'unsupported_media_type', message: '只支持 jpg、png、webp、gif、avif' }, 415);
        }
        if (err instanceof ImageTooLargeError) {
          return c.json({ error: 'payload_too_large', message: '图片像素太多（上限 2400 万像素）' }, 413);
        }
        throw err;
      }
    },
  );
}

function safeOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}
