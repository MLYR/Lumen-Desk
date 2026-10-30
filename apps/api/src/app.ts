import fs from 'node:fs/promises';
import os from 'node:os';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getConnInfo } from '@hono/node-server/conninfo';
import type * as OTPAuth from 'otpauth';
import type { Config } from './config.js';
import type { DB } from './db.js';
import { readBookmarks } from './bookmarks.js';
import { getHot } from './sources/aihot.js';
import { lockedFor, recordFailure, recordSuccess } from './auth/ratelimit.js';
import { consumeRecoveryCode, RECOVERY_RE, normalizeRecovery } from './auth/recovery.js';
import { createSession, deleteSession, SESSION_COOKIE, SESSION_TTL_S, validateSession } from './auth/sessions.js';
import { makeTotp, verifyTotp } from './auth/totp.js';

export interface AppDeps {
  config: Config;
  db: DB;
  now?: () => number;
}

export function createApp({ config, db, now = Date.now }: AppDeps): Hono {
  const app = new Hono();
  const totp: OTPAuth.TOTP | null = config.totpSecret
    ? makeTotp(config.totpSecret, config.totpIssuer, config.totpLabel)
    : null;
  if (!totp) console.warn('[auth] TOTP_SECRET is not set; only recovery codes can log in');

  const clientIp = (c: Context): string => {
    if (config.trustProxy) {
      const first = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (first) return first.slice(0, 64);
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
      return 'unknown';
    }
  };

  const hasSession = (c: Context) => validateSession(db, getCookie(c, SESSION_COOKIE), now());

  app.get('/api/healthz', (c) => c.text('ok'));

  app.post(
    '/api/auth/login',
    bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      // Cross-site forms can't send application/json without a CORS preflight.
      if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
        return c.json({ error: 'unsupported_media_type' }, 415);
      }
      const ip = clientIp(c);

      let code = '';
      try {
        const body = (await c.req.json()) as { code?: unknown };
        if (typeof body?.code === 'string') code = body.code.trim();
      } catch {
        return c.json({ error: 'invalid_request' }, 400);
      }

      // Everything below is synchronous: lock check, verify and recording happen in one
      // event-loop turn, so concurrent requests cannot all slip past the lock.
      const t = now();
      const isTotp = /^\d{6}$/.test(code);
      const isRecovery = !isTotp && RECOVERY_RE.test(normalizeRecovery(code));
      // Recovery codes skip the global pause (still limited per IP), so an attacker can't lock the owner out.
      const locked = lockedFor(db, ip, t, { ignoreGlobal: isRecovery });
      if (locked > 0) return lockedResponse(c, locked);

      let ok = false;
      if (isTotp) ok = totp !== null && verifyTotp(db, totp, code, t);
      else if (isRecovery) ok = consumeRecoveryCode(db, code, t);

      if (!ok) {
        const lockMs = recordFailure(db, ip, t);
        if (lockMs > 0) return lockedResponse(c, lockMs);
        return c.json({ error: 'invalid_code' }, 401);
      }

      recordSuccess(db, ip);
      setCookie(c, SESSION_COOKIE, createSession(db, t), {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'Strict',
        path: '/',
        maxAge: SESSION_TTL_S,
      });
      return c.json({ ok: true });
    },
  );

  app.post('/api/auth/logout', (c) => {
    deleteSession(db, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: config.cookieSecure, httpOnly: true, sameSite: 'Strict' });
    return c.body(null, 204);
  });

  app.get('/api/auth/check', (c) => {
    c.header('Cache-Control', 'no-store');
    return hasSession(c) ? c.body(null, 204) : c.body(null, 401);
  });

  app.get('/api/hot', (c) => {
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(getHot(db, now()));
  });

  // Defense in depth: Caddy forward_auth guards these too.
  app.use('/api/private/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (!hasSession(c)) return c.json({ error: 'unauthorized' }, 401);
    await next();
  });

  app.get('/api/private/bookmarks', async (c) => {
    const data = await readBookmarks(config.dataDir);
    if (!data) return c.json({ error: 'no_bookmarks' }, 404);
    return c.json(data);
  });

  app.get('/api/private/server', async (c) => {
    const [load1, load5, load15] = os.loadavg();
    const total = os.totalmem();
    const st = await fs.statfs(config.dataDir);
    return c.json({
      cpu: { cores: os.availableParallelism(), load1, load5, load15 },
      mem: { total, used: total - os.freemem() },
      disk: { total: st.blocks * st.bsize, used: (st.blocks - st.bfree) * st.bsize },
      uptime: process.uptime(),
      hostUptime: os.uptime(),
    });
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    console.error('[api] unhandled error:', err.message);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

function lockedResponse(c: Context, ms: number) {
  const retryAfter = Math.ceil(ms / 1000);
  c.header('Retry-After', String(retryAfter));
  return c.json({ error: 'locked', retryAfter }, 429);
}
