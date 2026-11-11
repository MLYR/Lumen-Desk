import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { Cron } from 'croner';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { rerenderPosts } from './blog/posts.js';
import { migrateLegacyFile } from './bookmarks/store.js';
import { purgeExpiredSessions } from './auth/sessions.js';
import { latestUsableBackup, runBackup } from './backups.js';
import { purgeStaleAihot, refreshAihot } from './sources/aihot.js';

const config = loadConfig();
const db = openDb(config.dataDir);
// One-time move of DATA_DIR/bookmarks.json into SQLite (logs counts only).
migrateLegacyFile(db, config.dataDir, Date.now());
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

// P1.5-7：每天 03:35（容器时区）做一份全量备份，保留 BACKUP_KEEP 份。
// 启动时如果目录里超过 24 小时没有能读的备份，先补一份，免得机器宕机几天回来一直没有备份。
const backupOnce = (reason: string): void => {
  try {
    const run = runBackup(db, config.dataDir, config.backupDir, Date.now(), config.backupKeep);
    console.log(`[backup] ${reason}：${run.file}（${Math.round(run.bytes / 1024)} KB，文章 ${run.counts.posts}、书签 ${run.counts.bookmarks}）`);
  } catch (err) {
    console.error('[backup] 失败：', err instanceof Error ? err.message : err);
  }
};
const backupJob = new Cron('35 3 * * *', { protect: true }, () => backupOnce('定时备份'));
{
  const newest = latestUsableBackup(config.backupDir);
  const age = newest ? Date.now() - fs.statSync(newest).mtimeMs : Number.POSITIVE_INFINITY;
  if (age > 24 * 3600_000) backupOnce(newest ? '启动补做（上一份超过 24 小时）' : '启动补做（还没有备份）');
}

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[api] listening on :${info.port}`);
});

const shutdown = () => {
  aihotJob.stop();
  cleanupJob.stop();
  backupJob.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
