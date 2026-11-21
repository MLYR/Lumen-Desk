import type { Context, Hono, MiddlewareHandler } from 'hono';
import { SLUG_RE } from '../blog/posts.js';
import { escapeHtml } from '../blog/render.js';
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import {
  BAD_CHARS,
  ConflictError,
  errorResponse,
  InputError,
  limit,
  readJson,
  requireType,
  sameOrigin as sameOriginFor,
  visible,
} from '../http.js';
import {
  MAX_LAB_TEXT_BYTES,
  MAX_LAB_ZIP_BYTES,
  contentTypeOf,
  exportLabZip,
  extractZip,
  isTextFile,
  listFiles,
  normalizeRel,
  readFile,
  removeFile,
  removeLabDir,
  renameFile,
  scaffoldBlankLab,
  writeAssetFile,
  writeFile,
} from '../lab/store.js';

export interface LabDeps {
  config: Config;
  db: DB;
  now: () => number;
  /** 沿用 app.ts 里 /api/private/* 的同一套会话检查。 */
  isAdmin: (c: Context) => boolean;
}

interface LabRow {
  slug: string;
  title: string;
  intro: string;
  stack: string;
  status: string;
  cover: string;
  entry: string;
  featured: number;
  draft: number;
  sort: number;
  created_at: string;
  updated_at: string;
}

const COLS = 'slug, title, intro, stack, status, cover, entry, featured, draft, sort, created_at, updated_at';
const iso = (ms: number): string => new Date(ms).toISOString();

const getRow = (db: DB, slug: string): LabRow | undefined =>
  db.prepare(`SELECT ${COLS} FROM labs WHERE slug = ?`).get(slug) as LabRow | undefined;

const toLab = (r: LabRow) => ({
  slug: r.slug,
  title: r.title,
  intro: r.intro,
  stack: r.stack,
  status: r.status,
  cover: r.cover,
  entry: r.entry,
  featured: r.featured === 1,
  draft: r.draft === 1,
  sort: r.sort,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function fieldString(v: unknown, name: string, max: number, required = false): string {
  if (v === undefined || v === null) {
    if (required) throw new InputError(`${name} 不能为空`);
    return '';
  }
  if (typeof v !== 'string') throw new InputError(`${name} 必须是字符串`);
  const s = v.trim();
  if (required && !visible(s)) throw new InputError(`${name} 不能为空`);
  if (BAD_CHARS.test(s)) throw new InputError(`${name} 含有非法字符`);
  if (s.length > max) throw new InputError(`${name} 不能超过 ${max} 字`);
  return s;
}

function flagOf(v: unknown, name: string): 0 | 1 {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === 0 || v === 1) return v;
  throw new InputError(`${name} 必须是布尔值`);
}

function sortOf(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < -99999 || v > 99999) {
    throw new InputError('sort 必须是 -99999 到 99999 之间的整数');
  }
  return v;
}

function coverOf(v: unknown): string {
  const s = fieldString(v, 'cover', 300);
  if (!s) return '';
  if (s.startsWith('/')) {
    if (!/^\/[A-Za-z0-9._\-/]+$/.test(s) || s.includes('..')) throw new InputError('cover 路径不合法');
    return s;
  }
  return normalizeRel(s);
}

function entryOf(v: unknown): string {
  if (v === undefined || v === null || v === '') return 'index.html';
  const rel = normalizeRel(fieldString(v, 'entry', 240, true));
  if (!rel.toLowerCase().endsWith('.html')) throw new InputError('entry 必须是 .html 文件');
  return rel;
}

function pickEntry(files: string[]): string {
  if (files.includes('index.html')) return 'index.html';
  return files.find((f) => f.toLowerCase().endsWith('.html')) ?? 'index.html';
}

function entryHref(slug: string, entry: string): string {
  return `/lab-files/${encodeURIComponent(slug)}/${entry.split('/').map(encodeURIComponent).join('/')}`;
}

function labNotFoundHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>找不到这个实验 · 试验场 · 拾光台</title>
  <style>
    html, body {
      margin: 0;
      min-height: 100%;
      background: #060913;
      color: #e2e8f0;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .box {
      max-width: 420px;
      text-align: center;
      padding: 28px 24px;
      border-radius: 16px;
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid rgba(148, 163, 184, 0.2);
    }
    h1 { margin: 0 0 10px; font-size: 20px; font-weight: 600; }
    p { margin: 0 0 18px; font-size: 14px; color: #94a3b8; line-height: 1.6; }
    a {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      border-radius: 999px;
      background: rgba(56, 189, 248, 0.16);
      border: 1px solid rgba(56, 189, 248, 0.35);
      color: #bae6fd;
      text-decoration: none;
      font-size: 14px;
    }
    a:hover { background: rgba(56, 189, 248, 0.25); }
  </style>
</head>
<body>
  <main class="box">
    <h1>找不到这个实验</h1>
    <p>它可能还在草稿阶段，或者地址已经变更。</p>
    <a href="/lab/">← 返回试验场</a>
  </main>
</body>
</html>
`;
}

function labDetailHtml(row: LabRow): string {
  const esc = escapeHtml;
  const title = esc(row.title);
  const description = esc(row.intro || `${row.title} · 拾光台技术试验场`);
  const frameSrc = entryHref(row.slug, row.entry);
  const headMeta =
    row.draft === 1
      ? '<meta name="robots" content="noindex">'
      : '<script defer src="/u/script.js" data-website-id="default"></script>';
  const draftBadge = row.draft === 1 ? '<span class="lab-badge">草稿</span>' : '';
  const stackBadge = row.stack ? `<span class="lab-stack">${esc(row.stack)}</span>` : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${title} · 试验场 · 拾光台</title>
  <meta name="description" content="${description}">
  ${headMeta}
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #05070c;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #lab-frame {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      border: 0;
      background: #05070c;
    }
    .lab-capsule {
      position: fixed;
      top: calc(14px + env(safe-area-inset-top));
      left: calc(14px + env(safe-area-inset-left));
      z-index: 30;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      max-width: calc(100vw - 28px);
      padding: 6px 10px 6px 12px;
      border-radius: 999px;
      background: rgba(9, 13, 24, 0.72);
      border: 1px solid rgba(148, 163, 184, 0.24);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: #e2e8f0;
      font-size: 13px;
      line-height: 1;
      box-shadow: 0 8px 24px rgba(2, 6, 23, 0.36);
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .lab-capsule a,
    .lab-capsule button {
      color: inherit;
      font: inherit;
      text-decoration: none;
      background: none;
      border: 0;
      padding: 0;
      margin: 0;
      cursor: pointer;
      white-space: nowrap;
    }
    .lab-back {
      color: #bae6fd;
      font-weight: 500;
    }
    .lab-back:hover { color: #ffffff; }
    .lab-sep { color: rgba(148, 163, 184, 0.55); }
    .lab-title {
      font-weight: 600;
      color: #f8fafc;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 28vw;
    }
    .lab-badge {
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(251, 191, 36, 0.16);
      border: 1px solid rgba(251, 191, 36, 0.35);
      color: #fde68a;
      font-size: 11px;
    }
    .lab-stack {
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.14);
      color: #cbd5e1;
      font-size: 11px;
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .lab-capsule .lab-act {
      padding: 4px 9px;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.14);
      color: #e2e8f0;
      font-size: 12px;
    }
    .lab-capsule .lab-act:hover {
      background: rgba(56, 189, 248, 0.24);
      color: #ffffff;
    }
    .lab-capsule .lab-toggle {
      width: 24px;
      height: 24px;
      display: inline-grid;
      place-items: center;
      border-radius: 999px;
      color: #94a3b8;
      font-size: 15px;
    }
    .lab-capsule .lab-toggle:hover {
      background: rgba(148, 163, 184, 0.18);
      color: #ffffff;
    }
    .lab-capsule.is-collapsed {
      padding: 4px;
      gap: 0;
    }
    .lab-capsule.is-collapsed > :not(.lab-toggle) {
      display: none;
    }
    @media (max-width: 640px) {
      .lab-stack { display: none; }
      .lab-title { max-width: 34vw; }
    }
    @media (prefers-reduced-motion: reduce) {
      .lab-capsule { transition: none; }
    }
  </style>
</head>
<body>
  <iframe id="lab-frame" src="${esc(frameSrc)}" title="${title}" allow="fullscreen" allowfullscreen></iframe>
  <nav class="lab-capsule" id="lab-capsule" aria-label="试验场导航">
    <a class="lab-back" href="/lab/">← 试验场</a>
    <span class="lab-sep" aria-hidden="true">·</span>
    <span class="lab-title">${title}</span>
    ${draftBadge}
    ${stackBadge}
    <a class="lab-act" href="${esc(frameSrc)}" target="_blank" rel="noopener" title="新窗口打开纯享版">纯享 ↗</a>
    <button class="lab-act" id="lab-fs" type="button" title="切换全屏">全屏</button>
    <button class="lab-toggle" id="lab-toggle" type="button" aria-label="收起导航条" aria-expanded="true" title="收起/展开">‹</button>
  </nav>
  <script>
    (() => {
      const capsule = document.getElementById('lab-capsule');
      const toggle = document.getElementById('lab-toggle');
      const fsBtn = document.getElementById('lab-fs');
      if (capsule && toggle) {
        toggle.addEventListener('click', () => {
          const collapsed = capsule.classList.toggle('is-collapsed');
          toggle.textContent = collapsed ? '›' : '‹';
          toggle.setAttribute('aria-expanded', String(!collapsed));
          toggle.setAttribute('aria-label', collapsed ? '展开导航条' : '收起导航条');
        });
      }
      if (fsBtn) {
        const syncFs = () => {
          fsBtn.textContent = document.fullscreenElement ? '退出' : '全屏';
        };
        fsBtn.addEventListener('click', () => {
          if (document.fullscreenElement) {
            document.exitFullscreen?.();
          } else {
            document.documentElement.requestFullscreen?.();
          }
        });
        document.addEventListener('fullscreenchange', syncFs);
      }
    })();
  </script>
</body>
</html>
`;
}

export function registerLab(app: Hono, { config, db, now, isAdmin }: LabDeps): void {
  const sameOrigin = sameOriginFor(config.siteUrl);
  // /api/lab 不在 /api/private/* 下，写接口用同一套会话检查自己守。
  const adminOnly: MiddlewareHandler = async (c, next) => {
    if (!isAdmin(c)) return c.json({ error: 'unauthorized' }, 401);
    await next();
  };

  const rowFor = (c: Context): LabRow | undefined => {
    const slug = c.req.param('slug') ?? '';
    if (!SLUG_RE.test(slug)) return undefined;
    return getRow(db, slug);
  };

  const canRead = (c: Context, row: LabRow): boolean => row.draft === 0 || isAdmin(c);

  // ---------- metadata ----------

  app.get('/api/lab', (c) => {
    if (isAdmin(c)) {
      c.header('Cache-Control', 'no-store');
      const rows = db.prepare(`SELECT ${COLS} FROM labs ORDER BY featured DESC, sort ASC, created_at ASC`).all() as unknown as LabRow[];
      return c.json({ items: rows.map(toLab) });
    }
    c.header('Cache-Control', 'public, max-age=60');
    const rows = db
      .prepare(`SELECT ${COLS} FROM labs WHERE draft = 0 ORDER BY featured DESC, sort ASC, created_at ASC`)
      .all() as unknown as LabRow[];
    return c.json({ items: rows.map(toLab) });
  });

  app.get('/api/lab/:slug', (c) => {
    const row = rowFor(c);
    if (!row || !canRead(c, row)) return c.json({ error: 'not_found' }, 404);
    c.header('Cache-Control', isAdmin(c) ? 'no-store' : 'public, max-age=60');
    return c.json(toLab(row));
  });

  app.post('/api/lab', adminOnly, sameOrigin, requireType('application/json'), limit(64 * 1024), async (c) => {
    try {
      const body = await readJson(c);
      if (!isObject(body)) throw new InputError('请求体必须是对象');
      const slug = fieldString(body.slug, 'slug', 80, true);
      if (!SLUG_RE.test(slug)) throw new InputError('slug 只能是 a-z、0-9、-，最多 80 字');
      const title = fieldString(body.title, 'title', 120, true);
      if (db.prepare('SELECT 1 FROM labs WHERE slug = ?').get(slug)) throw new ConflictError('slug_taken', '这个 slug 已经存在');
      const t = iso(now());
      db.prepare(
        `INSERT INTO labs (slug, title, intro, stack, status, cover, entry, featured, draft, sort, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        slug,
        title,
        fieldString(body.intro, 'intro', 600),
        fieldString(body.stack, 'stack', 120),
        fieldString(body.status, 'status', 60),
        coverOf(body.cover),
        entryOf(body.entry),
        flagOf(body.featured ?? false, 'featured'),
        flagOf(body.draft ?? true, 'draft'),
        body.sort === undefined ? 0 : sortOf(body.sort),
        t,
        t,
      );
      if (body.scaffold === true) {
        scaffoldBlankLab(config.dataDir, slug, title);
      }
      c.header('Cache-Control', 'no-store');
      return c.json(toLab(getRow(db, slug) as LabRow), 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.patch('/api/lab/:slug', adminOnly, sameOrigin, requireType('application/json'), limit(64 * 1024), async (c) => {
    const row = rowFor(c);
    if (!row) return c.json({ error: 'not_found' }, 404);
    try {
      const body = await readJson(c);
      if (!isObject(body)) throw new InputError('请求体必须是对象');
      if ('slug' in body) throw new InputError('slug 不能修改');
      const sets: string[] = [];
      const values: Array<string | number> = [];
      const put = (col: string, value: string | number): void => {
        sets.push(`${col} = ?`);
        values.push(value);
      };
      if ('title' in body) put('title', fieldString(body.title, 'title', 120, true));
      if ('intro' in body) put('intro', fieldString(body.intro, 'intro', 600));
      if ('stack' in body) put('stack', fieldString(body.stack, 'stack', 120));
      if ('status' in body) put('status', fieldString(body.status, 'status', 60));
      if ('cover' in body) put('cover', coverOf(body.cover));
      if ('entry' in body) put('entry', entryOf(body.entry));
      if ('featured' in body) put('featured', flagOf(body.featured, 'featured'));
      if ('draft' in body) put('draft', flagOf(body.draft, 'draft'));
      if ('sort' in body) put('sort', sortOf(body.sort));
      if (!sets.length) throw new InputError('没有要修改的字段');
      put('updated_at', iso(now()));
      values.push(row.slug);
      db.prepare(`UPDATE labs SET ${sets.join(', ')} WHERE slug = ?`).run(...values);
      c.header('Cache-Control', 'no-store');
      return c.json(toLab(getRow(db, row.slug) as LabRow));
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.delete('/api/lab/:slug', adminOnly, sameOrigin, (c) => {
    const row = rowFor(c);
    if (!row) return c.json({ error: 'not_found' }, 404);
    db.prepare('DELETE FROM labs WHERE slug = ?').run(row.slug);
    removeLabDir(config.dataDir, row.slug);
    return c.body(null, 204);
  });

  app.get('/api/lab/:slug/export', adminOnly, (c) => {
    const row = rowFor(c);
    if (!row) return c.json({ error: 'not_found' }, 404);
    const zip = exportLabZip(config.dataDir, row.slug);
    c.header('Content-Type', 'application/zip');
    c.header('Content-Disposition', `attachment; filename="${row.slug}.zip"`);
    c.header('Cache-Control', 'no-store');
    return c.body(new Uint8Array(zip));
  });

  // ---------- files ----------

  app.post(
    '/api/lab/:slug/upload',
    adminOnly,
    sameOrigin,
    requireType('multipart/form-data'),
    limit(MAX_LAB_ZIP_BYTES + 1024 * 1024),
    async (c) => {
      const row = rowFor(c);
      if (!row) return c.json({ error: 'not_found' }, 404);
      let form: Record<string, string | File>;
      try {
        form = (await c.req.parseBody()) as Record<string, string | File>;
      } catch {
        return c.json({ error: 'invalid_request', message: '无法解析表单' }, 400);
      }
      const file = form.file;
      if (!(file instanceof File)) return c.json({ error: 'invalid_request', message: '没有 file 字段' }, 400);
      if (!/\.zip$/i.test(file.name)) return c.json({ error: 'invalid_request', message: '只接受 .zip 压缩包' }, 400);
      if (file.size > MAX_LAB_ZIP_BYTES) return c.json({ error: 'payload_too_large', message: '压缩包不能超过 15 MB' }, 413);
      try {
        const result = extractZip(config.dataDir, row.slug, new Uint8Array(await file.arrayBuffer()));
        const entry = result.files.includes(row.entry) ? row.entry : result.entry;
        const detectedCover = result.files.find((f) => /^cover\.(?:webp|png|jpe?g|gif|avif)$/i.test(f));
        const cover = row.cover || detectedCover || '';
        db.prepare('UPDATE labs SET entry = ?, cover = ?, updated_at = ? WHERE slug = ?').run(entry, cover, iso(now()), row.slug);
        c.header('Cache-Control', 'no-store');
        return c.json({ files: result.files, entry, cover, bytes: result.bytes });
      } catch (err) {
        return errorResponse(c, err);
      }
    },
  );

  app.get('/api/lab/:slug/files', (c) => {
    const row = rowFor(c);
    if (!row || !canRead(c, row)) return c.json({ error: 'not_found' }, 404);
    c.header('Cache-Control', isAdmin(c) ? 'no-store' : 'public, max-age=60');
    return c.json({ items: listFiles(config.dataDir, row.slug) });
  });

  app.get('/api/lab/:slug/file', (c) => {
    const row = rowFor(c);
    if (!row || !canRead(c, row)) return c.json({ error: 'not_found' }, 404);
    const rel = c.req.query('path');
    if (!rel) return c.json({ error: 'invalid_request', message: '缺少 path' }, 400);
    try {
      const file = readFile(config.dataDir, row.slug, rel);
      c.header('Cache-Control', isAdmin(c) ? 'no-store' : 'public, max-age=60');
      if (!isTextFile(file.path)) {
        c.header('Content-Type', contentTypeOf(file.path));
        return c.body(new Uint8Array(file.data));
      }
      return c.json({ path: file.path, content: file.data.toString('utf8'), size: file.data.length });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.put('/api/lab/:slug/file', adminOnly, sameOrigin, requireType('application/json'), limit(MAX_LAB_TEXT_BYTES + 1024), async (c) => {
    const row = rowFor(c);
    if (!row) return c.json({ error: 'not_found' }, 404);
    try {
      const body = await readJson(c);
      if (!isObject(body)) throw new InputError('请求体必须是对象');
      if (typeof body.path !== 'string' || !body.path) throw new InputError('path 不能为空');
      if (typeof body.content !== 'string') throw new InputError('content 必须是字符串');
      const saved = writeFile(config.dataDir, row.slug, body.path, body.content);
      db.prepare('UPDATE labs SET updated_at = ? WHERE slug = ?').run(iso(now()), row.slug);
      c.header('Cache-Control', 'no-store');
      return c.json(saved);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post(
    '/api/lab/:slug/file',
    adminOnly,
    sameOrigin,
    requireType('multipart/form-data'),
    limit(MAX_LAB_ZIP_BYTES + 1024 * 1024),
    async (c) => {
      const row = rowFor(c);
      if (!row) return c.json({ error: 'not_found' }, 404);
      let form: Record<string, string | File>;
      try {
        form = (await c.req.parseBody()) as Record<string, string | File>;
      } catch {
        return c.json({ error: 'invalid_request', message: '无法解析表单' }, 400);
      }
      const file = form.file;
      if (!(file instanceof File)) return c.json({ error: 'invalid_request', message: '没有 file 字段' }, 400);
      if (file.size > MAX_LAB_ZIP_BYTES) return c.json({ error: 'payload_too_large', message: '单个文件不能超过 15 MB' }, 413);
      const relPath = typeof form.path === 'string' && form.path.length > 0 ? form.path : file.name;
      try {
        const saved = writeAssetFile(config.dataDir, row.slug, relPath, new Uint8Array(await file.arrayBuffer()));
        const cover = !row.cover && /^cover\.(?:webp|png|jpe?g|gif|avif)$/i.test(saved.path) ? saved.path : row.cover;
        db.prepare('UPDATE labs SET cover = ?, updated_at = ? WHERE slug = ?').run(cover, iso(now()), row.slug);
        c.header('Cache-Control', 'no-store');
        return c.json({ path: saved.path, size: saved.size, cover });
      } catch (err) {
        return errorResponse(c, err);
      }
    },
  );

  app.post('/api/lab/:slug/file/rename', adminOnly, sameOrigin, requireType('application/json'), limit(16 * 1024), async (c) => {
    const row = rowFor(c);
    if (!row) return c.json({ error: 'not_found' }, 404);
    try {
      const body = await readJson(c);
      if (!isObject(body)) throw new InputError('请求体必须是对象');
      if (typeof body.from !== 'string' || !body.from) throw new InputError('from 不能为空');
      if (typeof body.to !== 'string' || !body.to) throw new InputError('to 不能为空');
      const cleanFrom = normalizeRel(body.from);
      const cleanTo = renameFile(config.dataDir, row.slug, cleanFrom, body.to);
      let entry = row.entry;
      let cover = row.cover;
      if (entry === cleanFrom) {
        entry = cleanTo.toLowerCase().endsWith('.html')
          ? cleanTo
          : pickEntry(listFiles(config.dataDir, row.slug).map((f) => f.path));
      }
      if (cover === cleanFrom) cover = cleanTo;
      db.prepare('UPDATE labs SET entry = ?, cover = ?, updated_at = ? WHERE slug = ?').run(entry, cover, iso(now()), row.slug);
      c.header('Cache-Control', 'no-store');
      return c.json({ path: cleanTo, entry, cover });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.delete('/api/lab/:slug/file', adminOnly, sameOrigin, (c) => {
    const row = rowFor(c);
    if (!row) return c.json({ error: 'not_found' }, 404);
    const rel = c.req.query('path');
    if (!rel) return c.json({ error: 'invalid_request', message: '缺少 path' }, 400);
    try {
      const removed = removeFile(config.dataDir, row.slug, rel);
      let entry = row.entry;
      let cover = row.cover;
      if (cover === removed) cover = '';
      if (entry === removed) entry = pickEntry(listFiles(config.dataDir, row.slug).map((f) => f.path));
      db.prepare('UPDATE labs SET entry = ?, cover = ?, updated_at = ? WHERE slug = ?').run(entry, cover, iso(now()), row.slug);
      return c.body(null, 204);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  // ---------- static: /lab-files/<slug>/* ----------

  const serveLabFile = (c: Context) => {
    const slug = c.req.param('slug') ?? '';
    if (!SLUG_RE.test(slug)) return c.text('not found', 404);
    const row = getRow(db, slug);
    if (!row || !canRead(c, row)) return c.text('not found', 404);

    let rel = '';
    const prefix = `/lab-files/${slug}/`;
    if (c.req.path.startsWith(prefix)) {
      try {
        rel = decodeURIComponent(c.req.path.slice(prefix.length));
      } catch {
        return c.text('bad path', 400);
      }
    }
    if (!rel || rel.endsWith('/')) rel += row.entry;

    try {
      const file = readFile(config.dataDir, slug, rel);
      c.header('Content-Type', contentTypeOf(file.path));
      c.header('Cache-Control', row.draft === 1 ? 'no-store' : 'public, max-age=60');
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('X-Frame-Options', 'SAMEORIGIN');
      return c.body(new Uint8Array(file.data));
    } catch (err) {
      if (err instanceof InputError) return c.text('bad path', 400);
      return c.text('not found', 404);
    }
  };

  app.get('/lab-files/:slug', serveLabFile);
  app.get('/lab-files/:slug/', serveLabFile);
  app.get('/lab-files/:slug/*', serveLabFile);

  // ---------- public detail page: /lab/<slug>/ ----------

  const serveLabPage = (c: Context) => {
    const slug = c.req.param('slug') ?? '';
    const row = SLUG_RE.test(slug) ? getRow(db, slug) : undefined;
    if (!row || !canRead(c, row)) {
      c.header('Cache-Control', 'no-store');
      return c.html(labNotFoundHtml(), 404);
    }
    c.header('X-Frame-Options', 'SAMEORIGIN');
    c.header('Cache-Control', row.draft === 1 ? 'no-store' : 'public, max-age=60');
    return c.html(labDetailHtml(row), 200);
  };

  app.get('/lab/:slug', serveLabPage);
  app.get('/lab/:slug/', serveLabPage);
}
