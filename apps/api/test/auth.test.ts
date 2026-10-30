import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { generateRecoveryCodes } from '../src/auth/recovery.js';
import { sessionCookie, setup } from './helpers.js';

describe('auth', () => {
  it('correct TOTP sets a hardened session cookie and check returns 204', async () => {
    const { app, login, codeAt } = setup();
    const res = await login(codeAt());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const sc = res.headers.get('set-cookie')!;
    expect(sc).toMatch(/^ld_session=[A-Za-z0-9_-]{43};/);
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('Secure');
    expect(sc).toContain('SameSite=Strict');
    expect(sc).toContain('Path=/');
    expect(sc).toContain('Max-Age=2592000');

    const check = await app.request('/api/auth/check', { headers: { cookie: sessionCookie(res) } });
    expect(check.status).toBe(204);
  });

  it('accepts codes from the previous step (window ±1) but not older', async () => {
    const { login, codeAt, clock } = setup();
    expect((await login(codeAt(clock.t - 60_000))).status).toBe(401);
    expect((await login(codeAt(clock.t - 30_000))).status).toBe(200);
  });

  it('wrong code returns 401 invalid_code', async () => {
    const { login, wrongCode } = setup();
    const res = await login(wrongCode());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_code' });
  });

  it('rejects replay of the same code and of older steps', async () => {
    const { login, codeAt, clock } = setup();
    const code = codeAt();
    expect((await login(code)).status).toBe(200);
    expect((await login(code)).status).toBe(401);
    // previous step is still inside the window but older than the used one
    expect((await login(codeAt(clock.t - 30_000))).status).toBe(401);
    clock.t += 30_000;
    expect((await login(codeAt())).status).toBe(200);
  });

  it('locks an IP after 5 consecutive failures, for 15 minutes', async () => {
    const { login, wrongCode, codeAt, clock } = setup();
    for (let i = 0; i < 4; i++) expect((await login(wrongCode())).status).toBe(401);
    const fifth = await login(wrongCode());
    expect(fifth.status).toBe(429);
    expect(await fifth.json()).toEqual({ error: 'locked', retryAfter: 900 });
    expect(fifth.headers.get('retry-after')).toBe('900');

    // even a correct code is refused while locked
    const locked = await login(codeAt());
    expect(locked.status).toBe(429);
    // other IPs unaffected
    expect((await login(wrongCode(), '198.51.100.2')).status).toBe(401);

    clock.t += 15 * 60_000 + 1000;
    expect((await login(codeAt())).status).toBe(200);
  });

  it('success resets the per-IP failure counter', async () => {
    const { login, wrongCode, codeAt, clock } = setup();
    for (let i = 0; i < 4; i++) await login(wrongCode());
    expect((await login(codeAt())).status).toBe(200);
    clock.t += 30_000;
    for (let i = 0; i < 4; i++) expect((await login(wrongCode())).status).toBe(401);
  });

  it('pauses all logins after >30 failures in an hour', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { login, wrongCode, codeAt } = setup();
    let last: Response | undefined;
    for (let i = 0; i < 31; i++) last = await login(wrongCode(), `192.0.2.${i}`);
    expect(last!.status).toBe(429);
    const other = await login(codeAt(), '192.0.2.200');
    expect(other.status).toBe(429);
    expect((await other.json()).retryAfter).toBe(3600);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('recovery codes still work during the global pause; unlockAll clears it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { login, wrongCode, codeAt, db } = setup();
    for (let i = 0; i < 31; i++) await login(wrongCode(), `192.0.2.${i}`);
    const [code] = generateRecoveryCodes(db, 10);
    expect((await login(code!, '192.0.2.201')).status).toBe(200);
    const { unlockAll } = await import('../src/auth/ratelimit.js');
    unlockAll(db);
    expect((await login(codeAt(), '192.0.2.202')).status).toBe(200);
    warn.mockRestore();
  });

  it('concurrent wrong codes from one IP cannot exceed the per-IP limit', async () => {
    const { login, wrongCode, db } = setup();
    const res = await Promise.all(Array.from({ length: 20 }, () => login(wrongCode())));
    expect(res.filter((r) => r.status === 401).length).toBe(4);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM login_failures').get() as { n: number };
    expect(Number(n)).toBe(5);
  });

  it('rejects non-JSON content types (cross-site form posts)', async () => {
    const { app } = setup();
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ code: '123456' }),
    });
    expect(res.status).toBe(415);
  });

  it('recovery code works exactly once', async () => {
    const { login, db } = setup();
    const [code] = generateRecoveryCodes(db, 10);
    expect((await login(code!.toUpperCase())).status).toBe(200);
    expect((await login(code!)).status).toBe(401);
    const rows = db.prepare('SELECT code_hash FROM recovery_codes').all() as { code_hash: string }[];
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.code_hash))).toBe(true);
  });

  it('rejects bodies over 1KB', async () => {
    const { app } = setup();
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '2000' },
      body: JSON.stringify({ code: 'x'.repeat(1990) }),
    });
    expect(res.status).toBe(413);
  });

  it('stores only token hashes; logout deletes the session', async () => {
    const { app, db, login, codeAt } = setup();
    const cookie = sessionCookie(await login(codeAt()));
    const token = cookie.split('=')[1]!;
    const row = db.prepare('SELECT token_hash FROM sessions').get() as { token_hash: string };
    expect(row.token_hash).not.toContain(token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);

    const out = await app.request('/api/auth/logout', { method: 'POST', headers: { cookie } });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toMatch(/ld_session=;.*Max-Age=0/);
    expect((await app.request('/api/auth/check', { headers: { cookie } })).status).toBe(401);
  });
});

describe('private routes', () => {
  it('return 401 without a session cookie', async () => {
    const { app } = setup();
    for (const p of ['/api/private/bookmarks', '/api/private/server']) {
      const res = await app.request(p);
      expect(res.status).toBe(401);
    }
    expect((await app.request('/api/auth/check')).status).toBe(401);
    expect(
      (await app.request('/api/private/bookmarks', { headers: { cookie: 'ld_session=forged' } })).status,
    ).toBe(401);
  });

  it('serve bookmarks and server stats with a session', async () => {
    const { app, db, login, codeAt, dataDir } = setup();
    const cookie = sessionCookie(await login(codeAt()));

    const missing = await app.request('/api/private/bookmarks', { headers: { cookie } });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'no_bookmarks' });

    // P2.8: bookmarks live in SQLite (bookmarks.json is only read by the one-time migration).
    fs.writeFileSync(path.join(dataDir, 'bookmarks.json'), JSON.stringify([{ name: 'A', links: [['x', 'https://x.test/']] }]));
    expect((await app.request('/api/private/bookmarks', { headers: { cookie } })).status).toBe(404);
    db.exec(`INSERT INTO bookmark_folders (id, name, created_at, updated_at) VALUES (1, 'A', 0, 0);
             INSERT INTO bookmarks (id, folder_id, title, url, created_at, updated_at) VALUES (2, 1, 'x', 'https://x.test/', 0, 0);`);
    const bm = await app.request('/api/private/bookmarks', { headers: { cookie } });
    expect(bm.status).toBe(200);
    expect(bm.headers.get('cache-control')).toBe('no-store');
    expect(await bm.json()).toEqual([{ id: 1, name: 'A', links: [['x', 'https://x.test/']], items: [{ id: 2, title: 'x', url: 'https://x.test/' }] }]);

    const srv = await app.request('/api/private/server', { headers: { cookie } });
    expect(srv.status).toBe(200);
    const s = await srv.json();
    expect(s.cpu.cores).toBeGreaterThan(0);
    expect(s.mem.total).toBeGreaterThan(s.mem.used);
    expect(s.disk.total).toBeGreaterThan(0);
    expect(typeof s.uptime).toBe('number');
    expect(typeof s.hostUptime).toBe('number');
  });

  it('healthz returns ok', async () => {
    const { app } = setup();
    const res = await app.request('/api/healthz');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});
