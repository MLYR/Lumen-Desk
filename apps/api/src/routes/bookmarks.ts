import type { Context, Hono } from 'hono';
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { errorResponse, InputError, limit, readJson, requireType, sameOrigin as sameOriginFor } from '../http.js';
import { BookmarkParseError, exportBookmarksHtml, parseBookmarksHtml } from '../bookmarks/netscape.js';
import {
  createFolder,
  createLink,
  deleteFolder,
  deleteLink,
  exportTree,
  getTree,
  hasBookmarks,
  importTree,
  InvalidMoveError,
  listSnapshots,
  reorder,
  restoreSnapshot,
  saveSnapshot,
  updateFolder,
  updateLink,
} from '../bookmarks/store.js';

export interface BookmarkDeps {
  config: Config;
  db: DB;
  now: () => number;
}

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const TZ_OFFSET_MS = 8 * 3600_000;
const localDay = (ms: number, sep: string) => new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10).replaceAll('-', sep);

/**
 * /api/private/bookmarks*. Fixed paths (order, import, export, snapshots) are registered before the
 * :id routes, and :id only matches digits. Register after the /api/private/* session middleware.
 */
export function registerBookmarks(app: Hono, { config, db, now }: BookmarkDeps): void {
  const sameOrigin = sameOriginFor(config.siteUrl);
  const jsonWrite = [sameOrigin, requireType('application/json'), limit(64 * 1024)] as const;
  const fail = (c: Context, err: unknown) => {
    if (err instanceof InvalidMoveError) return c.json({ error: 'invalid_move', message: '不能移到它自己或它的子文件夹里' }, 400);
    if (err instanceof BookmarkParseError) return c.json({ error: 'invalid_request', message: err.message }, 400);
    return errorResponse(c, err);
  };
  const withJson = (fn: (c: Context, body: unknown) => Response) => async (c: Context) => {
    try {
      return fn(c, await readJson(c));
    } catch (err) {
      return fail(c, err);
    }
  };
  const id = (c: Context) => Number(c.req.param('id'));

  app.get('/api/private/bookmarks', (c) => {
    if (!hasBookmarks(db)) return c.json({ error: 'no_bookmarks' }, 404);
    return c.json(getTree(db));
  });

  // ---- fixed paths first ----

  app.put('/api/private/bookmarks/order', ...jsonWrite, withJson((c, body) => (reorder(db, body, now()), c.body(null, 204))));

  app.post('/api/private/bookmarks/import', sameOrigin, requireType('multipart/form-data'), limit(MAX_IMPORT_BYTES + 64 * 1024), async (c) => {
    let form: Record<string, string | File>;
    try {
      form = (await c.req.parseBody()) as Record<string, string | File>;
    } catch {
      return c.json({ error: 'invalid_request', message: '无法解析表单' }, 400);
    }
    const file = form.file;
    const mode = form.mode ?? 'replace';
    if (!(file instanceof File)) return c.json({ error: 'invalid_request', message: '没有 file 字段' }, 400);
    if (mode !== 'replace' && mode !== 'merge') return c.json({ error: 'invalid_request', message: 'mode 只能是 replace 或 merge' }, 400);
    if (file.size > MAX_IMPORT_BYTES) return c.json({ error: 'payload_too_large', message: '文件超过 5 MiB' }, 413);
    try {
      let html: string;
      try {
        html = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      } catch {
        throw new InputError('文件不是 UTF-8 文本');
      }
      const tree = parseBookmarksHtml(html);
      const t = now();
      return c.json(importTree(db, tree, mode, t, `导入 ${localDay(t, '-')}`));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.get('/api/private/bookmarks/export', (c) => {
    const t = now();
    c.header('Content-Type', 'text/html; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="bookmarks_${localDay(t, '_')}.html"`);
    c.header('Cache-Control', 'no-store');
    return c.body(exportBookmarksHtml(exportTree(db), Math.floor(t / 1000)));
  });

  app.get('/api/private/bookmarks/snapshots', (c) => c.json({ items: listSnapshots(db) }));

  app.post('/api/private/bookmarks/snapshots', sameOrigin, (c) => {
    const sid = saveSnapshot(db, 'manual', now());
    return c.json(listSnapshots(db).find((s) => s.id === sid), 201);
  });

  app.post('/api/private/bookmarks/snapshots/:id{[0-9]+}/restore', sameOrigin, (c) => {
    try {
      return c.json(restoreSnapshot(db, id(c), now()));
    } catch (err) {
      return fail(c, err);
    }
  });

  // ---- folders / links ----

  app.post('/api/private/bookmarks/folders', ...jsonWrite, withJson((c, body) => c.json(createFolder(db, body, now()), 201)));
  app.put('/api/private/bookmarks/folders/:id{[0-9]+}', ...jsonWrite, withJson((c, body) => c.json(updateFolder(db, id(c), body, now()))));
  app.delete('/api/private/bookmarks/folders/:id{[0-9]+}', sameOrigin, (c) => {
    try {
      const n = deleteFolder(db, id(c), now());
      c.header('X-Deleted-Count', String(n));
      return c.body(null, 204);
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post('/api/private/bookmarks/links', ...jsonWrite, withJson((c, body) => c.json(createLink(db, body, now()), 201)));
  app.put('/api/private/bookmarks/links/:id{[0-9]+}', ...jsonWrite, withJson((c, body) => c.json(updateLink(db, id(c), body, now()))));
  app.delete('/api/private/bookmarks/links/:id{[0-9]+}', sameOrigin, (c) => (deleteLink(db, id(c)) ? c.body(null, 204) : c.json({ error: 'not_found' }, 404)));
}
