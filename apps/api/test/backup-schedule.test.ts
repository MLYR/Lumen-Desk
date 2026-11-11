import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { latestUsableBackup, listBackups, pruneBackups, restoreBackup, runBackup, verifyBackupFile } from '../src/backups.js';
import { authed, setup } from './helpers.js';

const DAY = 86_400_000;
const tmpDir = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `ld-${name}-`));

describe('定时备份：落盘、保留策略、坏包和恢复', () => {
  it('做一份备份能读回来，清单里的数量和内容对得上', async () => {
    const s = await authed();
    await s.create({ title: '定时备份文章', slug: 'sched', publishedAt: '2026-10-30T02:00:00Z' });
    const dir = tmpDir('bk');

    const run = runBackup(s.db, s.dataDir, dir, Date.UTC(2026, 10, 11, 3, 35, 0));

    expect(fs.existsSync(run.file)).toBe(true);
    expect(path.basename(run.file)).toMatch(/^lumen-desk-backup-\d{12}\.zip$/);
    expect(() => verifyBackupFile(run.file)).not.toThrow();
    expect(run.counts.posts).toBe(1);
    expect(listBackups(dir)).toHaveLength(1);
    // 先写临时文件再改名：目录里不该留下半成品
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toHaveLength(0);
    expect(verifyBad(() => verifyBackupFile(path.join(dir, 'nope.zip')))).toBe(true);
  });

  it('超过保留份数时删最旧的，别人的文件不碰', async () => {
    const s = await authed();
    const dir = tmpDir('prune');
    const base = Date.UTC(2026, 10, 1, 3, 35, 0);
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a backup');

    for (let i = 0; i < 15; i += 1) runBackup(s.db, s.dataDir, dir, base + i * DAY, 14);

    const names = listBackups(dir).map((entry) => entry.name);
    expect(names).toHaveLength(14);
    expect(names[0]! > names[13]!).toBe(true); // 新的在前
    expect(fs.existsSync(path.join(dir, 'notes.txt'))).toBe(true);
    expect(pruneBackups(dir, 14)).toEqual([]);
  });

  it('最新的一份坏了就跳过，返回上一份可用的并告警', async () => {
    const s = await authed();
    const dir = tmpDir('bad');
    const base = Date.UTC(2026, 10, 1, 3, 35, 0);
    const first = runBackup(s.db, s.dataDir, dir, base, 14);
    const second = runBackup(s.db, s.dataDir, dir, base + DAY, 14);
    fs.writeFileSync(second.file, 'not a zip at all');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(latestUsableBackup(dir)).toBe(first.file);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('跳过坏备份'));
    warn.mockRestore();
  });

  it('从备份恢复到空实例，文章和页面都回得来', async () => {
    const source = await authed();
    await source.create({ title: '恢复文章', slug: 'restored', publishedAt: '2026-10-30T02:00:00Z' });
    const dir = tmpDir('restore');
    const run = runBackup(source.db, source.dataDir, dir, Date.UTC(2026, 10, 11, 3, 35, 0));

    const target = setup();
    const counts = await restoreBackup(target.db, target.dataDir, run.file, Date.UTC(2026, 10, 11, 4, 0, 0));

    expect(counts.posts).toBe(1);
    const rows = target.db.prepare('SELECT slug FROM posts').all() as Array<{ slug: string }>;
    expect(rows.map((r) => r.slug)).toEqual(['restored']);

    const res = await target.app.request('/blog/restored/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('恢复文章');
    // 验证器和会话不在这份包里，恢复出来的实例仍要靠手机验证码登录
    const auth = await target.app.request('/api/auth/check', { headers: { cookie: 'ld_session=stale' } });
    expect(auth.status).toBe(401);
  });
});

function verifyBad(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
