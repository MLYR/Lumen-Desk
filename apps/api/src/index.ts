import { serve } from '@hono/node-server';
import { Cron } from 'croner';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { rerenderPosts } from './blog/posts.js';
import { purgeExpiredSessions } from './auth/sessions.js';
import { purgeStaleAihot, refreshAihot } from './sources/aihot.js';

const config = loadConfig();
const db = openDb(config.dataDir);
// Renderer upgrades (e.g. heading ids + toc) re-render stored posts once, in the background:
// old html keeps serving until then, and a failure never stops the server (the version mark is
// only written on success, so the next start retries).
void rerenderPosts(db).then(
  (n) => { if (n) console.log(`[blog] re-rendered ${n} posts`); },
  (err: unknown) => console.error('[blog] re-render failed; will retry on next start:', err instanceof Error ? err.message : err),
);
const app = createApp({ config, db });

const refresh = async (): Promise<void> => {
  purgeStaleAihot(db);
  await refreshAihot(db, { siteUrl: config.siteUrl });
};
void refresh();
const aihotJob = new Cron('*/10 * * * *', { protect: true }, refresh);
const cleanupJob = new Cron('17 * * * *', () => purgeExpiredSessions(db));

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[api] listening on :${info.port}`);
});

const shutdown = () => {
  aihotJob.stop();
  cleanupJob.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
