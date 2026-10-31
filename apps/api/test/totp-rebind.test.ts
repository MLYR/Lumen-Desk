import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as OTPAuth from 'otpauth';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { kvGet, openDb } from '../src/db.js';
import { open, parseSecretKey, readPending, seal, TotpStore, writePending } from '../src/auth/secret-store.js';
import { generateRecoveryCodes } from '../src/auth/recovery.js';
import { ORIGIN, SECRET, sessionCookie, SHELL_FIXTURE } from './helpers.js';

type Json = Record<string, any>;
const j = async (res: Response | Promise<Response>) => (await (await res).json()) as Json;
const KEY = Buffer.alloc(32, 7).toString('base64'); // synthetic test key

function rig(opts: { secretKey?: string; envSecret?: string | null } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-totp-'));
  const config = loadConfig({
    DATA_DIR: dataDir,
    ...(opts.envSecret === null ? {} : { TOTP_SECRET: opts.envSecret ?? SECRET }),
    ...(opts.secretKey ? { SECRET_KEY: opts.secretKey } : {}),
    SHELL_DIR: SHELL_FIXTURE,
    SITE_URL: 'https://blog.test',
    TRUST_PROXY: 'true',
  });
  const db = openDb(':memory:');
  const clock = { t: Date.UTC(2026, 9, 31, 0, 0, 10) };
  const logs: string[] = [];
  const warn = vi.spyOn(console, 'warn').mockImplementation((...a) => void logs.push(a.join(' ')));
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' ')));
  const app = createApp({ config, db, now: () => clock.t });
  const totpFor = (secret: string) => new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 });
  const old = totpFor(SECRET);
  const ip = '203.0.113.9';
  const login = (code: string, from = ip) =>
    app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': from }, body: JSON.stringify({ code }) });
  const post = (url: string, body: unknown, cookie: string, headers: Record<string, string> = {}) =>
    app.request(url, { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': ip, ...headers }, body: JSON.stringify(body) });
  const step = () => (clock.t += 30_000);
  const restore = () => {
    warn.mockRestore();
    logSpy.mockRestore();
  };
  return { app, db, config, clock, old, totpFor, login, post, step, logs, restore, dataDir };
}

async function loggedIn(r: ReturnType<typeof rig>) {
  const res = await r.login(r.old.generate({ timestamp: r.clock.t }));
  expect(res.status).toBe(200);
  r.step();
  return sessionCookie(res);
}

describe('totp: secret storage', () => {
  it('AES-256-GCM round trip, tamper and wrong key fail, plain fallback', () => {
    const key = parseSecretKey(KEY)!;
    const sealed = seal(key, 'JBSWY3DPEHPK3PXP', 'totp_secret');
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(open(key, sealed, 'totp_secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(open(key, sealed, 'totp_pending')).toBeNull(); // AAD binds the slot
    expect(open(Buffer.alloc(32, 8), sealed, 'totp_secret')).toBeNull();
    expect(open(null, sealed, 'totp_secret')).toBeNull();
    // Tampered ciphertext: flip one bit (always a change, unlike replacing a character).
    const parts = sealed.split(':');
    const ct = Buffer.from(parts[3]!, 'base64url');
    ct[0] = ct[0]! ^ 1;
    expect(open(key, [parts[0], parts[1], parts[2], ct.toString('base64url')].join(':'), 'totp_secret')).toBeNull();
    // Truncated auth tag (GCM would otherwise accept a shorter tag).
    const tag = Buffer.from(parts[2]!, 'base64url');
    for (const n of [4, 8, 12, 15]) {
      expect(open(key, [parts[0], parts[1], tag.subarray(0, n).toString('base64url'), parts[3]].join(':'), 'totp_secret'), `tag ${n}`).toBeNull();
    }
    expect(open(key, `${sealed}:extra`, 'totp_secret')).toBeNull();
    // With a key, plain: is refused unless explicitly allowed (the one-time upgrade).
    expect(open(key, 'plain:JBSWY3DPEHPK3PXP', 'totp_secret')).toBeNull();
    expect(open(key, 'plain:JBSWY3DPEHPK3PXP', 'totp_secret', { allowPlain: true })).toBe('JBSWY3DPEHPK3PXP');
    expect(open(null, 'plain:JBSWY3DPEHPK3PXP', 'totp_secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(seal(null, 'X', 'a')).toBe('plain:X');
    expect(() => parseSecretKey('c2hvcnQ=')).toThrow(/32 bytes/);
    expect(parseSecretKey('')).toBeNull();
  });

  it('with a key, a plain pending is refused; a plain stored secret is upgraded once', () => {
    const db = openDb(':memory:');
    const key = parseSecretKey(KEY)!;
    const A = new OTPAuth.Secret({ size: 20 }).base32;
    const B = new OTPAuth.Secret({ size: 20 }).base32;
    writePending(db, key, { secret: A, expiresAt: 9e15 });
    expect(readPending(db, key)!.secret).toBe(A);
    db.prepare("UPDATE kv SET value = ? WHERE key = 'totp_pending'").run(JSON.stringify({ s: `plain:${B}`, e: 9e15 }));
    expect(readPending(db, key)).toBeNull();
    expect(readPending(db, null)!.secret).toBe(B); // no key: plaintext mode

    db.prepare("INSERT INTO kv (key, value) VALUES ('totp_secret', ?)").run(`plain:${A}`);
    const s = new TotpStore({ db, key, envSecret: undefined, issuer: 'i', label: 'l', log: () => {} });
    expect(s.get()!.secret.base32).toBe(A);
    const after = kvGet(db, 'totp_secret')!;
    expect(after).toMatch(/^v1:/);
    expect(open(key, after, 'totp_secret')).toBe(A);
  });

  it('database wins over .env, logged without the secret', () => {
    const db = openDb(':memory:');
    const logs: string[] = [];
    const key = parseSecretKey(KEY);
    db.prepare("INSERT INTO kv (key, value) VALUES ('totp_secret', ?)").run(seal(key, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 'totp_secret'));
    const s = new TotpStore({ db, key, envSecret: SECRET, issuer: 'i', label: 'l', log: (m) => logs.push(m) });
    expect(s.get()!.secret.base32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(logs).toContain('[auth] TOTP 密钥来自数据库，.env 里的 TOTP_SECRET 已不再使用');
    for (const l of logs) expect(l).not.toMatch(/GEZDGNBV|JBSWY3DP/);
    // Undecryptable value: TOTP disabled rather than falling back to the old .env secret.
    const s2 = new TotpStore({ db, key: Buffer.alloc(32, 1), envSecret: SECRET, issuer: 'i', label: 'l', log: () => {} });
    expect(s2.get()).toBeNull();
  });
});

describe.each([
  ['with SECRET_KEY', KEY],
  ['without SECRET_KEY', undefined],
])('totp rebind (%s)', (_label, secretKey) => {
  it('full flow: rebind with current code → confirm with new code → old dead, new works, other sessions out', async () => {
    const r = rig({ secretKey });
    try {
      const other = await loggedIn(r);
      const me = await loggedIn(r);

      // Step 1 with the current code.
      const current = r.old.generate({ timestamp: r.clock.t });
      const res = await r.post('/api/private/security/totp/rebind', { code: current }, me);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await j(res);
      expect(body.otpauthUri).toMatch(/^otpauth:\/\/totp\/.+secret=[A-Z2-7]+/);
      expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(body.qrSvg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"><rect fill="#ffffff"/);
      expect(body.qrSvg).not.toMatch(/<script|on\w+=|href/i);
      expect(body.expiresAt).toBe(new Date(r.clock.t + 10 * 60_000).toISOString());
      // The code used for rebind can't log in afterwards (replay).
      expect((await r.login(current)).status).toBe(401);

      const pending = kvGet(r.db, 'totp_pending')!;
      if (secretKey) expect(pending).not.toContain(body.secret);
      const fresh = r.totpFor(body.secret);

      // Old secret still works until confirm.
      r.step();
      expect((await r.login(r.old.generate({ timestamp: r.clock.t }))).status).toBe(200);

      // Confirm with an old-secret code fails; with the new one succeeds.
      r.step();
      expect((await r.post('/api/private/security/totp/confirm', { code: r.old.generate({ timestamp: r.clock.t }) }, me)).status).toBe(401);
      const newCode = fresh.generate({ timestamp: r.clock.t });
      const ok = await r.post('/api/private/security/totp/confirm', { code: newCode }, me);
      expect(ok.status).toBe(200);
      expect(await j(ok)).toEqual({ ok: true });
      expect(kvGet(r.db, 'totp_pending')).toBeUndefined();

      const stored = kvGet(r.db, 'totp_secret')!;
      if (secretKey) {
        expect(stored).toMatch(/^v1:/);
        expect(stored).not.toContain(body.secret);
      } else expect(stored).toBe(`plain:${body.secret}`);

      // Sessions: mine stays, the other one is gone.
      const check = async (cookie: string) => (await r.app.request('/api/auth/check', { headers: { cookie } })).status;
      expect(await check(me)).toBe(204);
      expect(await check(other)).toBe(401);

      // The confirm code itself can't be replayed for login; old secret is dead; new secret logs in.
      expect((await r.login(newCode)).status).toBe(401);
      r.step();
      expect((await r.login(r.old.generate({ timestamp: r.clock.t }))).status).toBe(401);
      expect((await r.login(fresh.generate({ timestamp: r.clock.t }))).status).toBe(200);

      // Recovery-code regeneration also uses the new live instance.
      r.step();
      expect((await r.post('/api/private/security/recovery-codes', { code: fresh.generate({ timestamp: r.clock.t }) }, me)).status).toBe(200);

      // The secret appears in no other response.
      for (const url of ['/api/private/security', '/api/private/profile', '/api/private/server']) {
        const t = await (await r.app.request(url, { headers: { cookie: me } })).text();
        expect(t, url).not.toContain(body.secret);
      }
      for (const l of r.logs) expect(l).not.toContain(body.secret);
    } finally {
      r.restore();
    }
  });
});

describe('totp rebind: guards', () => {
  it('wrong current code → 401, 5 failures → 429 and login locked too', async () => {
    const r = rig();
    try {
      const me = await loggedIn(r);
      const wrong = (() => {
        const valid = new Set([-30_000, 0, 30_000].map((d) => r.old.generate({ timestamp: r.clock.t + d })));
        for (let i = 0; ; i++) if (!valid.has(String(i).padStart(6, '0'))) return String(i).padStart(6, '0');
      })();
      for (let i = 0; i < 4; i++) {
        const res = await r.post('/api/private/security/totp/rebind', { code: wrong }, me);
        expect(res.status).toBe(401);
        expect(await j(res)).toEqual({ error: 'invalid_code' });
      }
      expect((await r.post('/api/private/security/totp/rebind', { code: wrong }, me)).status).toBe(429);
      expect((await r.login(r.old.generate({ timestamp: r.clock.t }))).status).toBe(429);
      expect(kvGet(r.db, 'totp_pending')).toBeUndefined();
    } finally {
      r.restore();
    }
  });

  it('confirm: wrong code counts toward the limiter; expired → 410; none → 409; cancel deletes', async () => {
    const r = rig();
    try {
      const me = await loggedIn(r);
      const start = async () => {
        const b = await j(r.post('/api/private/security/totp/rebind', { code: r.old.generate({ timestamp: r.clock.t }) }, me));
        r.step();
        return b;
      };
      expect((await r.post('/api/private/security/totp/confirm', { code: '123456' }, me)).status).toBe(409);
      const a = await start();
      const b = await start(); // second rebind overwrites the first pending
      expect(b.secret).not.toBe(a.secret);
      expect((await r.post('/api/private/security/totp/confirm', { code: r.totpFor(a.secret).generate({ timestamp: r.clock.t }) }, me)).status).toBe(401);

      r.clock.t += 10 * 60_000;
      const exp = await r.post('/api/private/security/totp/confirm', { code: r.totpFor(b.secret).generate({ timestamp: r.clock.t }) }, me);
      expect(exp.status).toBe(410);
      expect(await j(exp)).toMatchObject({ error: 'pending_expired' });
      expect(kvGet(r.db, 'totp_pending')).toBeUndefined();

      await start();
      const del = await r.app.request('/api/private/security/totp/pending', { method: 'DELETE', headers: { cookie: me, origin: ORIGIN } });
      expect(del.status).toBe(204);
      expect(kvGet(r.db, 'totp_pending')).toBeUndefined();

      // Old secret is unchanged throughout.
      expect((await r.login(r.old.generate({ timestamp: r.clock.t }))).status).toBe(200);
    } finally {
      r.restore();
    }
  });

  it('401 without a session; Origin and Content-Type checked', async () => {
    const r = rig();
    try {
      for (const [m, u] of [
        ['POST', '/api/private/security/totp/rebind'],
        ['POST', '/api/private/security/totp/confirm'],
        ['DELETE', '/api/private/security/totp/pending'],
      ] as const) {
        expect((await r.app.request(u, { method: m })).status, u).toBe(401);
      }
      const me = await loggedIn(r);
      const code = r.old.generate({ timestamp: r.clock.t });
      expect((await r.post('/api/private/security/totp/rebind', { code }, me, { origin: 'https://evil.test' })).status).toBe(403);
      expect((await r.post('/api/private/security/totp/rebind', { code }, me, { 'content-type': 'text/plain' })).status).toBe(415);
      expect((await r.app.request('/api/private/security/totp/pending', { method: 'DELETE', headers: { cookie: me, origin: 'https://evil.test' } })).status).toBe(403);
    } finally {
      r.restore();
    }
  });

  it('works from an empty database with the secret only in .env; recovery codes untouched by confirm', async () => {
    const r = rig({ secretKey: KEY });
    try {
      generateRecoveryCodes(r.db, 10, r.clock.t);
      const before = r.db.prepare('SELECT code_hash FROM recovery_codes ORDER BY id').all();
      const me = await loggedIn(r);
      const b = await j(r.post('/api/private/security/totp/rebind', { code: r.old.generate({ timestamp: r.clock.t }) }, me));
      r.step();
      expect((await r.post('/api/private/security/totp/confirm', { code: r.totpFor(b.secret).generate({ timestamp: r.clock.t }) }, me)).status).toBe(200);
      expect(r.db.prepare('SELECT code_hash FROM recovery_codes ORDER BY id').all()).toEqual(before);
      // A fresh app on the same db (restart) reads the new secret from the database, not .env.
      const app2 = createApp({ config: r.config, db: r.db, now: () => r.clock.t });
      r.step();
      const res = await app2.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.3' }, body: JSON.stringify({ code: r.totpFor(b.secret).generate({ timestamp: r.clock.t }) }) });
      expect(res.status).toBe(200);
    } finally {
      r.restore();
    }
  });
});
