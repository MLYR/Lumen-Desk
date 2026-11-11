import type { Context, Hono } from 'hono';
import { MAX_BACKUP_BYTES, buildBackup, importBackup } from '../backup.js';
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { errorResponse, limit, requireType, sameOrigin as sameOriginFor } from '../http.js';

export interface BackupDeps {
  config: Config;
  db: DB;
  now: () => number;
}

/** Register after the /api/private/* session middleware. */
export function registerBackup(app: Hono, { config, db, now }: BackupDeps): void {
  const sameOrigin = sameOriginFor(config.siteUrl);
  const fail = (c: Context, err: unknown) => errorResponse(c, err);

  app.get('/api/private/backup/export', (c) => {
    try {
      const backup = buildBackup(db, config.dataDir, now());
      c.header('Content-Type', 'application/zip');
      c.header('Content-Disposition', `attachment; filename="${backup.filename}"`);
      c.header('Cache-Control', 'no-store');
      return c.body(Buffer.from(backup.data));
    } catch (err) {
      return fail(c, err);
    }
  });

  app.post(
    '/api/private/backup/import',
    sameOrigin,
    requireType('multipart/form-data'),
    limit(MAX_BACKUP_BYTES + 1024 * 1024),
    async (c) => {
      let form: Record<string, string | File>;
      try {
        form = (await c.req.parseBody()) as Record<string, string | File>;
      } catch {
        return c.json({ error: 'invalid_request', message: '无法解析表单' }, 400);
      }
      const file = form.file;
      if (!(file instanceof File)) return c.json({ error: 'invalid_request', message: '没有 file 字段' }, 400);
      if (file.size > MAX_BACKUP_BYTES) return c.json({ error: 'payload_too_large', message: '备份超过 40 MB' }, 413);
      try {
        return c.json(await importBackup(db, config.dataDir, new Uint8Array(await file.arrayBuffer()), now()));
      } catch (err) {
        return fail(c, err);
      }
    },
  );
}
