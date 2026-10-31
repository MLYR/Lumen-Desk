import type { Context, Hono } from 'hono';
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { errorResponse, limit, readJson, requireType, sameOrigin as sameOriginFor } from '../http.js';
import { getResume, getSettings, parseResume, parseSettings, publicView, saveResume, saveSettings } from '../resume.js';

export interface ResumeDeps {
  config: Config;
  db: DB;
  now: () => number;
}

/** /api/resume (public, masked unless revealPublic) and /api/private/resume*. */
export function registerResume(app: Hono, { config, db, now }: ResumeDeps): void {
  const sameOrigin = sameOriginFor(config.siteUrl);
  const jsonWrite = [sameOrigin, requireType('application/json'), limit(256 * 1024)] as const;

  const visitorView = (c: Context) => {
    const r = getResume(db);
    if (!r) return c.json({ error: 'no_resume' }, 404);
    const settings = getSettings(db);
    // reveal=true → the page adds <meta name="robots" content="noindex">; the header covers crawlers too.
    if (settings.revealPublic) c.header('X-Robots-Tag', 'noindex');
    return c.json(publicView(r, settings));
  };

  app.get('/api/resume', (c) => {
    // no-store: flipping revealPublic must take effect immediately.
    c.header('Cache-Control', 'no-store');
    return visitorView(c);
  });

  app.get('/api/private/resume', (c) => {
    const r = getResume(db);
    if (!r) return c.json({ error: 'no_resume' }, 404);
    return c.json({ ...r, settings: getSettings(db) });
  });

  // Fixed paths before any future /:id-style routes.
  app.get('/api/private/resume/preview', visitorView);

  app.get('/api/private/resume/export', (c) => {
    const r = getResume(db);
    if (!r) return c.json({ error: 'no_resume' }, 404);
    const day = new Date(now() + 8 * 3600_000).toISOString().slice(0, 10).replaceAll('-', '');
    c.header('Content-Disposition', `attachment; filename="resume-${day}.json"`);
    c.header('Content-Type', 'application/json; charset=utf-8');
    return c.body(`${JSON.stringify({ ...r, settings: getSettings(db) }, null, 2)}\n`);
  });

  app.put('/api/private/resume/settings', ...jsonWrite, async (c) => {
    try {
      const s = parseSettings(await readJson(c));
      saveSettings(db, s);
      return c.json(s);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.put('/api/private/resume', ...jsonWrite, async (c) => {
    try {
      const r = parseResume(await readJson(c), now());
      saveResume(db, r);
      return c.json(r);
    } catch (err) {
      return errorResponse(c, err);
    }
  });
}
