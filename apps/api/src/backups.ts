import fs from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { BACKUP_FORMAT, BACKUP_VERSION, buildBackup, importBackup, type BackupCounts } from './backup.js';
import type { DB } from './db.js';

// P1.5-7：定时全量备份。复用 P2.12 的导出/导入（云备份格式一致），
// 这里只负责落盘、保留策略、坏包检测和恢复。

/** 只认自己写的文件名（形如 lumen-desk-backup-202611111135.zip），手滑放进去的东西不会被保留策略删掉。 */
export const BACKUP_NAME_RE = /^lumen-desk-backup-\d{12}\.zip$/;

export interface BackupRun {
  file: string;
  bytes: number;
  counts: BackupCounts;
}

export interface BackupEntry {
  name: string;
  file: string;
  bytes: number;
  mtimeMs: number;
}

/** 目录里已有的备份，按文件名（= 本地时间戳）从新到旧。 */
export function listBackups(dir: string): BackupEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => BACKUP_NAME_RE.test(name))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((name) => {
      const file = path.join(dir, name);
      const st = fs.statSync(file);
      return { name, file, bytes: st.size, mtimeMs: st.mtimeMs };
    });
}

/**
 * 检查一个备份文件是不是完整的 ZIP、manifest 对不对、content.json 在不在。
 * 不做全量字段校验（那是 importBackup 的事），只回答「这个包还能不能读」。
 */
export function verifyBackupFile(file: string): void {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(fs.readFileSync(file)));
  } catch {
    throw new Error(`${path.basename(file)} 不是有效的 ZIP`);
  }
  if (!entries['manifest.json'] || !entries['content.json']) throw new Error(`${path.basename(file)} 缺少 manifest.json 或 content.json`);
  let manifest: unknown;
  try {
    manifest = JSON.parse(strFromU8(entries['manifest.json']!));
  } catch {
    throw new Error(`${path.basename(file)} 的 manifest.json 不是合法 JSON`);
  }
  const m = manifest as { format?: unknown; version?: unknown };
  if (m.format !== BACKUP_FORMAT || m.version !== BACKUP_VERSION) throw new Error(`${path.basename(file)} 不是受支持的备份格式`);
}

/** 删掉超出 keep 的旧备份，返回删掉的文件名。 */
export function pruneBackups(dir: string, keep = 14): string[] {
  if (!Number.isInteger(keep) || keep < 1) throw new Error(`保留份数不合法：${keep}`);
  const deleted: string[] = [];
  for (const entry of listBackups(dir).slice(keep)) {
    try {
      fs.rmSync(entry.file);
      deleted.push(entry.name);
    } catch {
      // 删不掉（权限、正被读）就留着，下次再删；不能因为一个文件删不掉就让备份失败。
    }
  }
  return deleted;
}

/**
 * 现在做一份备份。先写临时文件再改名，中途失败不会留下半个包。
 * 写完立刻验一遍：验不过就删掉并报错，旧备份一份都不动。
 */
export function runBackup(db: DB, dataDir: string, destDir: string, nowMs: number, keep = 14): BackupRun {
  const built = buildBackup(db, dataDir, nowMs);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, built.filename);
  const tmp = path.join(destDir, `.${built.filename}.tmp`);
  fs.writeFileSync(tmp, built.data, { mode: 0o600 });
  fs.renameSync(tmp, dest);
  try {
    verifyBackupFile(dest);
  } catch (err) {
    fs.rmSync(dest, { force: true });
    throw err;
  }
  pruneBackups(destDir, keep);
  return { file: dest, bytes: built.data.length, counts: built.counts };
}

/**
 * 最新一个还能读的备份。坏包跳过并在日志里留一行，返回 undefined 表示一个都没有。
 */
export function latestUsableBackup(dir: string): string | undefined {
  for (const entry of listBackups(dir)) {
    try {
      verifyBackupFile(entry.file);
      return entry.file;
    } catch (err) {
      console.warn(`[backup] 跳过坏备份 ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return undefined;
}

/** 从一个备份文件恢复。会替换现有内容（不碰 TOTP、恢复码和会话）。 */
export async function restoreBackup(db: DB, dataDir: string, file: string, nowMs: number): Promise<BackupCounts> {
  const zip = new Uint8Array(fs.readFileSync(file));
  return importBackup(db, dataDir, zip, nowMs);
}
