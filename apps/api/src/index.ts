import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { Cron } from 'croner';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { rerenderPosts } from './blog/posts.js';
import { migrateLegacyFile } from './bookmarks/store.js';
import { seedBuiltinLabs } from './lab/seed.js';
import { purgeExpiredSessions } from './auth/sessions.js';
import { latestUsableBackup, runBackup } from './backups.js';
import { purgeStaleAihot, purgeStaleAihotDaily, refreshAihot, refreshAihotDaily } from './sources/aihot.js';
import { getCachedLocation, getWeatherSettings, inferProvince, refreshWeather } from './sources/weather.js';
import { refreshGithub } from './sources/github.js';

const config = loadConfig();
const db = openDb(config.dataDir);
// One-time move of DATA_DIR/bookmarks.json into SQLite (logs counts only).
migrateLegacyFile(db, config.dataDir, Date.now());
// One-time seed of built-in Lab experiment (end-of-time) into SQLite and DATA_DIR/labs/.
seedBuiltinLabs(db, config.dataDir, Date.now());
// Renderer upgrades (e.g. heading ids + toc) re-render stored posts once, in the background:
// old html keeps serving until then, and a failure never stops the server (the version mark is
// only written on success, so the next start retries).
void rerenderPosts(db).then(
  (n) => { if (n) console.log(`[blog] re-rendered ${n} posts`); },
  (err: unknown) => console.error('[blog] re-render failed; will retry on next start:', err instanceof Error ? err.message : err),
);
const app = createApp({ config, db, weatherFetch: fetch });

const refresh = async (): Promise<void> => {
  purgeStaleAihot(db);
  await refreshAihot(db, { siteUrl: config.siteUrl });
};
void refresh();
const aihotJob = new Cron('*/10 * * * *', { protect: true }, refresh);

const refreshDaily = async (): Promise<void> => {
  purgeStaleAihotDaily(db);
  await refreshAihotDaily(db, { siteUrl: config.siteUrl });
};
void refreshDaily();
// AIHOT 日报带 ETag 304 校验，每小时检一次既轻又能在撤回/更新后及时同步。
const dailyJob = new Cron('5 * * * *', { protect: true }, refreshDaily);

const fallbackWeatherLoc = {
  province: inferProvince(config.weatherCity),
  city: config.weatherCity,
  lat: config.weatherLat,
  lon: config.weatherLon,
  timezone: config.weatherTimezone,
};
const refreshWeatherNow = async (): Promise<void> => {
  const settings = getWeatherSettings(db, fallbackWeatherLoc);
  const target =
    settings.mode === 'manual'
      ? {
          province: settings.province,
          city: settings.city,
          lat: settings.lat,
          lon: settings.lon,
          timezone: settings.timezone,
        }
      : getCachedLocation(db);
  if (target) await refreshWeather(db, target, { siteUrl: config.siteUrl });
};
void refreshWeatherNow();
const weatherJob = new Cron('*/30 * * * *', { protect: true }, refreshWeatherNow);

const refreshGithubNow = async (): Promise<void> => {
  await refreshGithub(db, { username: config.githubUsername, token: config.githubToken, siteUrl: config.siteUrl });
};
void refreshGithubNow();
const githubJob = new Cron('20 */2 * * *', { protect: true }, refreshGithubNow);

const cleanupJob = new Cron('17 * * * *', () => purgeExpiredSessions(db));

// P1.5-7：每天北京时间 03:35 做一份全量备份，保留 BACKUP_KEEP 份。
// 这里按 UTC 写（19:35 UTC = 03:35 次日北京时间）：api 镜像基于 alpine、不带 tzdata，
// 设 TZ 也不生效，所以不靠容器时区，直接把时差算进 cron 表达式。
// 启动时如果目录里超过 24 小时没有能读的备份，先补一份，免得机器宕机几天回来一直没有备份。
const backupOnce = (reason: string): void => {
  try {
    const run = runBackup(db, config.dataDir, config.backupDir, Date.now(), config.backupKeep);
    console.log(`[backup] ${reason}：${run.file}（${Math.round(run.bytes / 1024)} KB，文章 ${run.counts.posts}、书签 ${run.counts.bookmarks}）`);
  } catch (err) {
    console.error('[backup] 失败：', err instanceof Error ? err.message : err);
  }
};
const backupJob = new Cron('35 19 * * *', { protect: true }, () => backupOnce('定时备份'));
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
  dailyJob.stop();
  weatherJob.stop();
  githubJob.stop();
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
