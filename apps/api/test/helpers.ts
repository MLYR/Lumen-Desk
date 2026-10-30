import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as OTPAuth from 'otpauth';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';

export const SECRET = new OTPAuth.Secret({ size: 20 }).base32;

export const SHELL_FIXTURE = path.join(import.meta.dirname, 'fixtures', 'shell');

export function setup(start = Date.UTC(2026, 0, 1, 0, 0, 10), env: NodeJS.ProcessEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-api-'));
  const config = loadConfig({
    DATA_DIR: dataDir, TOTP_SECRET: SECRET, COOKIE_SECURE: 'true', TRUST_PROXY: 'true',
    SHELL_DIR: SHELL_FIXTURE,
    SITE_URL: 'https://blog.test',
    ...env,
  });
  const db = openDb(':memory:');
  const clock = { t: start };
  const app = createApp({ config, db, now: () => clock.t });
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(SECRET), digits: 6, period: 30 });
  const codeAt = (t = clock.t) => totp.generate({ timestamp: t });
  const login = (code: string, ip = '203.0.113.7') =>
    app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 10.0.0.1` },
      body: JSON.stringify({ code }),
    });
  const wrongCode = (t = clock.t) => {
    const valid = new Set([codeAt(t - 30_000), codeAt(t), codeAt(t + 30_000)]);
    for (let i = 0; ; i++) {
      const c = String(i).padStart(6, '0');
      if (!valid.has(c)) return c;
    }
  };
  return { app, db, config, clock, codeAt, login, wrongCode, dataDir };
}

export function sessionCookie(res: Response): string {
  const m = /ld_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '');
  if (!m) throw new Error('no session cookie');
  return `ld_session=${m[1]}`;
}

export const ORIGIN = 'https://blog.test';

/** setup() plus a logged-in cookie and request helpers. */
export async function authed(start?: number) {
  const s = setup(start);
  const cookie = sessionCookie(await s.login(s.codeAt()));
  const req = (url: string, init: RequestInit = {}) =>
    s.app.request(url, { ...init, headers: { cookie, ...(init.headers as Record<string, string>) } });
  const send = (method: string, url: string, body: unknown, headers: Record<string, string> = {}) =>
    req(url, { method, headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: JSON.stringify(body) });
  const create = async (body: Record<string, unknown>) => {
    const res = await send('POST', '/api/private/posts', { markdown: '正文', status: 'published', ...body });
    if (res.status !== 201) throw new Error(`create failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as Record<string, unknown> & { id: number; slug: string };
  };
  const upload = (url: string, form: FormData, headers: Record<string, string> = {}) =>
    req(url, { method: 'POST', body: form, headers: { origin: ORIGIN, ...headers } });
  return { ...s, cookie, req, send, create, upload };
}

