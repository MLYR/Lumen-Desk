import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import type { Context, Hono } from 'hono';
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { ConflictError, errorResponse, InputError, limit, readJson, requireType, sameOrigin as sameOriginFor } from '../http.js';
import { importToInput, toMarkdownFile } from './frontmatter.js';
import { blogNav, fillShell, indexPage, listLayout, loadShell, notFoundPage, postPage, rss, SITE_NAME, sitemap, tagsPage } from './pages.js';
import {
  effectiveSummary,
  getPublishedBySlug,
  categoryRef,
  getRow,
  listNavPosts,
  listPublished,
  pagerFor,
  parseToc,
  MAX_MARKDOWN_BYTES,
  parsePostInput,
  rowToPost,
  savePost,
  searchPosts,
  SLUG_RE,
  toPublicItem,
  type Post,
  type PostRow,
} from './posts.js';
import { renderMarkdown } from './render.js';
import {
  createCategory,
  createTag,
  deleteCategory,
  deleteTag,
  getPublicCategoryBySlug,
  listCategoriesPrivate,
  listCategoriesPublic,
  listNavCategories,
  listTagsPrivate,
  listTagsPublic,
  renameTag,
  reorderCategories,
  updateCategory,
  validTagName,
} from './taxonomy.js';
import { imageErrorResponse, readImageField, storeImage } from './uploads.js';

export interface BlogDeps {
  config: Config;
  db: DB;
  now: () => number;
}

const PUBLIC_CACHE = 'public, max-age=60';
const MAX_IMPORT_FILES = 20;

/**
 * Blog routes. Must be registered after the /api/private/* session middleware.
 * Private write requests additionally check Origin and Content-Type (CSRF defense on top of SameSite=Strict).
 */
export function registerBlog(app: Hono, { config, db, now }: BlogDeps): void {
  const shell = loadShell(config.shellDir);
  const sameOrigin = sameOriginFor(config.siteUrl);
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
    const catSlug = c.req.query('category');
    let categoryId: number | undefined;
    if (catSlug) {
      const cat = getPublicCategoryBySlug(db, catSlug);
      if (!cat) return c.json({ items: [] });
      categoryId = cat.id;
    }
    c.header('Cache-Control', PUBLIC_CACHE);
    return c.json({ items: listPublished(db, { limit: n, tag: tag || undefined, categoryId }).map(toPublicItem) });
  });

  app.get('/api/categories', (c) => {
    c.header('Cache-Control', PUBLIC_CACHE);
    return c.json({ items: listCategoriesPublic(db) });
  });

  app.get('/api/tags', (c) => {
    c.header('Cache-Control', PUBLIC_CACHE);
    return c.json({ items: listTagsPublic(db) });
  });

  app.get('/api/search', (c) => {
    const q = (c.req.query('q') ?? '').trim();
    const n = [...q].length;
    if (n < 2 || n > 50) return c.json({ error: 'invalid_request', message: 'q 取 2–50 字' }, 400);
    c.header('Cache-Control', PUBLIC_CACHE);
    return c.json({ items: searchPosts(db, q) });
  });

  // ---------- public HTML ----------

  // Left nav for every blog page except 404. Only public categories (draft-only ones stay hidden).
  const nav = (current: { slug?: string; categorySlug?: string } = {}) => blogNav(listNavCategories(db), listNavPosts(db), current);

  const blogIndex = (c: Context) =>
    html(c, `博客 · ${SITE_NAME}`, `${SITE_NAME} 的全部文章`, listLayout(nav(), indexPage('博客', listPublished(db))));
  app.get('/blog', blogIndex);
  app.get('/blog/', blogIndex);

  const categoryIndex = (c: Context) => {
    const slug = c.req.param('slug') ?? '';
    const cat = getPublicCategoryBySlug(db, slug);
    if (!cat) return notFound(c);
    const posts = listPublished(db, { categoryId: cat.id });
    return html(
      c,
      `${cat.name} · ${SITE_NAME}`,
      cat.description || `${SITE_NAME} 中分类为「${cat.name}」的文章`,
      listLayout(nav({ categorySlug: cat.slug }), indexPage(`分类 · ${cat.name}`, posts, { empty: '这个分类还没有文章。' })),
    );
  };
  app.get('/blog/category/:slug', categoryIndex);
  app.get('/blog/category/:slug/', categoryIndex);

  const allTags = (c: Context) => html(c, `标签 · ${SITE_NAME}`, `${SITE_NAME} 的全部标签`, listLayout(nav(), tagsPage(listTagsPublic(db))));
  app.get('/blog/tags', allTags);
  app.get('/blog/tags/', allTags);

  const tagIndex = (c: Context) => {
    const tag = c.req.param('tag') ?? '';
    const posts = listPublished(db, { tag });
    if (!posts.length) return notFound(c);
    return html(c, `标签 · ${tag} · ${SITE_NAME}`, `${SITE_NAME} 中标签为「${tag}」的文章`, listLayout(nav(), indexPage(`标签 · ${tag}`, posts)));
  };
  app.get('/blog/tags/:tag', tagIndex);
  app.get('/blog/tags/:tag/', tagIndex);

  const article = (c: Context) => {
    const slug = c.req.param('slug') ?? '';
    const row = SLUG_RE.test(slug) ? getPublishedBySlug(db, slug) : undefined;
    if (!row) return notFound(c);
    return html(
      c,
      `${row.title} · ${SITE_NAME}`,
      effectiveSummary(row),
      postPage(row, {
        category: categoryRef(db, row.category_id),
        toc: parseToc(row.toc),
        pager: pagerFor(db, row),
        nav: nav({ slug: row.slug }),
      }),
    );
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
    const cats = listCategoriesPublic(db).filter((x) => x.count > 0).map((x) => x.slug);
    return c.body(sitemap(config.siteUrl, listPublished(db), cats));
  });

  // ---------- private ----------

  const json = [sameOrigin, requireType('application/json'), limit(3 * MAX_MARKDOWN_BYTES)] as const;

  const writeError = errorResponse;

  app.get('/api/private/posts', (c) => {
    const rows = db
      .prepare('SELECT id, slug, title, status, tags, published_at, category_id, updated_at FROM posts ORDER BY updated_at DESC, id DESC')
      .all() as unknown as PostRow[];
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        status: r.status,
        tags: JSON.parse(r.tags) as string[],
        publishedAt: r.published_at,
        categoryId: r.category_id,
        category: categoryRef(db, r.category_id),
        updatedAt: r.updated_at,
      })),
    });
  });

  app.get('/api/private/posts/export', (c) => {
    const rows = db.prepare('SELECT * FROM posts ORDER BY id').all() as unknown as PostRow[];
    const files: Record<string, Uint8Array> = {};
    for (const r of rows) files[`${r.slug}.md`] = strToU8(toMarkdownFile(rowToPost(db, r)));
    const zip = zipSync(files, { level: 6 });
    const day = new Date(now()).toISOString().slice(0, 10).replaceAll('-', '');
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', `attachment; filename="lumen-desk-posts-${day}.zip"`);
    return c.body(zip);
  });

  app.get('/api/private/posts/:id{[0-9]+}', (c) => {
    const row = getRow(db, Number(c.req.param('id')));
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json(rowToPost(db, row));
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
          else if (err instanceof ConflictError) errors.push({ file: name, error: err.code, message: err.message });
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
      const img = await readImageField(c);
      if (img instanceof Response) return img;
      try {
        return c.json(await storeImage(uploadsDir, img));
      } catch (err) {
        return imageErrorResponse(c, err);
      }
    },
  );

  // ---------- categories & tags (private) ----------

  const run = <T>(c: Context, fn: () => T, ok: (v: T) => Response) => {
    try {
      return ok(fn());
    } catch (err) {
      return writeError(c, err);
    }
  };
  const jsonWrite = [sameOrigin, requireType('application/json'), limit(64 * 1024)] as const;

  app.get('/api/private/categories', (c) => c.json({ items: listCategoriesPrivate(db) }));

  app.post('/api/private/categories', ...jsonWrite, async (c) => {
    try {
      const body = await readJson(c);
      return c.json(createCategory(db, body), 201);
    } catch (err) {
      return writeError(c, err);
    }
  });

  // Must precede /:id so "order" is never read as an id (the id route is numeric-only as a second guard).
  app.put('/api/private/categories/order', ...jsonWrite, async (c) => {
    try {
      reorderCategories(db, await readJson(c));
      return c.body(null, 204);
    } catch (err) {
      return writeError(c, err);
    }
  });

  app.put('/api/private/categories/:id{[0-9]+}', ...jsonWrite, async (c) => {
    try {
      const body = await readJson(c);
      return c.json(updateCategory(db, Number(c.req.param('id')), body));
    } catch (err) {
      return writeError(c, err);
    }
  });

  app.delete('/api/private/categories/:id{[0-9]+}', sameOrigin, (c) =>
    deleteCategory(db, Number(c.req.param('id'))) ? c.body(null, 204) : c.json({ error: 'not_found' }, 404),
  );

  app.get('/api/private/tags', (c) => c.json({ items: listTagsPrivate(db) }));

  app.post('/api/private/tags', ...jsonWrite, async (c) => {
    try {
      const body = await readJson(c);
      return c.json(createTag(db, body), 201);
    } catch (err) {
      return writeError(c, err);
    }
  });

  app.put('/api/private/tags/rename', ...jsonWrite, async (c) => {
    try {
      const body = await readJson(c);
      return c.json(renameTag(db, body));
    } catch (err) {
      return writeError(c, err);
    }
  });

  app.delete('/api/private/tags/:name', sameOrigin, (c) =>
    run(
      c,
      () => deleteTag(db, validTagName(c.req.param('name'))),
      () => c.body(null, 204),
    ),
  );
}
