import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { latestUsableBackup, listBackups, restoreBackup, runBackup, verifyBackupFile } from '../backups.js';

// Usage:
//   backup run                 现在做一份，写到 BACKUP_DIR（默认 DATA_DIR/backups），顺手清旧的
//   backup list                列出目录里的备份，新的在前，验不过的标出来
//   backup restore <file> --yes 用指定备份覆盖当前数据（文章、书签、简历、个人资料、上传图片）。
//                             不碰 TOTP 密钥、恢复码和会话——恢复完照旧用手机上的验证码登录。
const [, , cmd = 'run', arg] = process.argv;
const config = loadConfig();
const db = openDb(config.dataDir);

const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

try {
  if (cmd === 'run') {
    const run = runBackup(db, config.dataDir, config.backupDir, Date.now(), config.backupKeep);
    console.log(`备份完成：${path.basename(run.file)}  ${fmtBytes(run.bytes)}`);
    console.log(
      `  文章 ${run.counts.posts} · 分类 ${run.counts.categories} · 标签 ${run.counts.tags} · ` +
        `文件夹 ${run.counts.folders} · 书签 ${run.counts.bookmarks} · 图片 ${run.counts.uploads}`,
    );
    const kept = listBackups(config.backupDir);
    console.log(`  目录里现在有 ${kept.length} 份，保留上限 ${config.backupKeep} 份`);
  } else if (cmd === 'list') {
    const entries = listBackups(config.backupDir);
    if (!entries.length) console.log(`还没有备份。目录：${config.backupDir}`);
    for (const entry of entries) {
      let ok = 'ok';
      try {
        verifyBackupFile(entry.file);
      } catch (err) {
        ok = `坏包：${err instanceof Error ? err.message : String(err)}`;
      }
      const when = new Date(entry.mtimeMs).toISOString().replace('T', ' ').slice(0, 19);
      console.log(`  ${entry.name}  ${fmtBytes(entry.bytes).padStart(8)}  ${when}Z  ${ok}`);
    }
    const newest = latestUsableBackup(config.backupDir);
    console.log(newest ? `最新可用：${path.basename(newest)}` : '没有可用的备份');
  } else if (cmd === 'restore') {
    const file = arg ? path.resolve(arg) : '';
    if (!file || !fs.existsSync(file)) {
      console.error('用法：backup restore <备份文件> --yes');
      process.exitCode = 2;
    } else if (!process.argv.includes('--yes')) {
      console.error(`会用它覆盖当前数据：${file}`);
      console.error('确认后加 --yes 再跑一次。');
      process.exitCode = 2;
    } else {
      verifyBackupFile(file);
      const counts = await restoreBackup(db, config.dataDir, file, Date.now());
      console.log(`已恢复 ${path.basename(file)}`);
      console.log(`  文章 ${counts.posts} · 分类 ${counts.categories} · 标签 ${counts.tags} · 文件夹 ${counts.folders} · 书签 ${counts.bookmarks} · 图片 ${counts.uploads}`);
      console.log('  验证器密钥和会话没动，用原来的验证码登录。');
    }
  } else {
    console.error('用法：backup [run|list|restore <文件> --yes]');
    process.exitCode = 2;
  }
} finally {
  db.close();
}
