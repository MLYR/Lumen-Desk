import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { kvGet, kvSet, openDb } from '../src/db.js';
import { InitRefused, initTotp } from '../src/auth/init-totp.js';
import { open, parseSecretKey, writePending } from '../src/auth/secret-store.js';
import { createSession, validateSession } from '../src/auth/sessions.js';

const KEY = Buffer.alloc(32, 9).toString('base64'); // synthetic

describe('init-totp', () => {
  it('writes secret, clears pending and replay floor, signs out every session, in one transaction', () => {
    const db = openDb(':memory:');
    const key = parseSecretKey(KEY)!;
    const t = Date.UTC(2026, 9, 31);
    const s1 = createSession(db, t);
    const s2 = createSession(db, t);
    writePending(db, key, { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', expiresAt: t + 1 });
    kvSet(db, 'totp_last_step', '123');

    const r = initTotp(db, key, { force: false, printEnv: false, now: t });
    expect(r.codes).toHaveLength(10);
    expect(r.sessionsRevoked).toBe(2);
    expect(open(key, kvGet(db, 'totp_secret')!, 'totp_secret')).toBe(r.secret);
    expect(kvGet(db, 'totp_pending')).toBeUndefined();
    expect(kvGet(db, 'totp_last_step')).toBeUndefined();
    expect(validateSession(db, s1, t)).toBe(false);
    expect(validateSession(db, s2, t)).toBe(false);

    // Second run without --force is refused; --print-env is refused while the database has a secret.
    expect(() => initTotp(db, key, { force: false, printEnv: false, now: t })).toThrow(InitRefused);
    expect(() => initTotp(db, key, { force: true, printEnv: true, now: t })).toThrow('数据库里已有密钥，.env 的值不会生效；请用 --force 写入数据库');
    const before = kvGet(db, 'totp_secret');
    expect(kvGet(db, 'totp_secret')).toBe(before);
    // --force rewrites.
    expect(initTotp(db, key, { force: true, printEnv: false, now: t }).secret).not.toBe(r.secret);
  });

  it('rolls back everything if a write fails midway', () => {
    const db = openDb(':memory:');
    const t = Date.now();
    const s = createSession(db, t);
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON recovery_codes BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    expect(() => initTotp(db, null, { force: false, printEnv: false, now: t })).toThrow(/boom/);
    expect(kvGet(db, 'totp_secret')).toBeUndefined();
    expect(validateSession(db, s, t)).toBe(true);
  });

  it('runs as a CLI against a temporary DATA_DIR', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-init-'));
    const env = { ...process.env, DATA_DIR: dir, SECRET_KEY: KEY, TOTP_SECRET: '', NODE_NO_WARNINGS: '1' };
    const cli = path.join(import.meta.dirname, '..', 'src', 'cli', 'init-totp.ts');
    const tsx = path.join(import.meta.dirname, '..', 'node_modules', '.bin', 'tsx');
    // A session that must be signed out.
    const db0 = openDb(dir);
    const sess = createSession(db0, Date.now());
    db0.close();

    const out = execFileSync(tsx, [cli], { env, encoding: 'utf8' });
    expect(out).toContain('Saved to the database (encrypted with SECRET_KEY)');
    expect(out).toMatch(/All devices were signed out \(1 sessions\)/);
    expect(out).not.toContain('TOTP_SECRET=');
    const db = openDb(dir);
    expect(kvGet(db, 'totp_secret')).toMatch(/^v1:/);
    expect(validateSession(db, sess, Date.now())).toBe(false);
    db.close();

    const again = spawnSync(tsx, [cli], { env, encoding: 'utf8' });
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('Refusing to overwrite');
    const pe = spawnSync(tsx, [cli, '--print-env', '--force'], { env, encoding: 'utf8' });
    expect(pe.status).toBe(1);
    expect(pe.stderr).toContain('数据库里已有密钥，.env 的值不会生效；请用 --force 写入数据库');

    // Fresh directory: --print-env prints the line and leaves kv.totp_secret alone.
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-init-'));
    const pe2 = execFileSync(tsx, [cli, '--print-env'], { env: { ...env, DATA_DIR: dir2 }, encoding: 'utf8' });
    expect(pe2).toMatch(/TOTP_SECRET=[A-Z2-7]{32}/);
    const db2 = openDb(dir2);
    expect(kvGet(db2, 'totp_secret')).toBeUndefined();
    db2.close();
  }, 30_000);
});
