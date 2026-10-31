import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Config } from './config.js';
import type { DB } from './db.js';
import { getHot } from './sources/aihot.js';
import { registerBlog } from './blog/routes.js';
import { lockedResponse } from './http.js';
import { registerSettings } from './routes/settings.js';
import { registerBookmarks } from './routes/bookmarks.js';
import { registerResume } from './routes/resume.js';
import { ServerCollector, type CollectorOptions } from './system/index.js';
import { lockedFor, recordFailure, recordSuccess } from './auth/ratelimit.js';
import { consumeRecoveryCode, RECOVERY_RE, normalizeRecovery } from './auth/recovery.js';
import { createSession, deleteSession, SESSION_COOKIE, SESSION_TTL_S, validateSession } from './auth/sessions.js';
import { verifyTotp } from './auth/totp.js';
import { parseSecretKey, TotpStore } from './auth/secret-store.js';

export interface AppDeps {
  config: Config;
  db: DB;
  now?: () => number;
  /** Server card collector overrides (fixture proc files, mocked probes). */
  server?: Partial<CollectorOptions>;
  /** Tests may share one store between app instances. */
  totpStore?: TotpStore;
}

export function createApp({ config, db, now = Date.now, server: serverOpts, totpStore }: AppDeps): Hono {
  const app = new Hono();
  const server = new ServerCollector({ db, dataDir: config.dataDir, hostRoot: config.hostRoot, siteUrl: config.siteUrl, now, ...serverOpts });
  // The live TOTP instance: read through totp.get() on every check, so a rebind applies at once.
  const totp =
    totpStore ??
    new TotpStore({ db, key: parseSecretKey(config.secretKey), envSecret: config.totpSecret, issuer: config.totpIssuer, label: config.totpLabel });

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
      if (isTotp) {
        const live = totp.get();
        ok = live !== null && verifyTotp(db, live, code, t);
      }
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

  registerBookmarks(app, { config, db, now });

  app.get('/api/private/server', async (c) => c.json(await server.collect()));

  registerBlog(app, { config, db, now });
  registerSettings(app, { config, db, now, totp, clientIp });
  registerResume(app, { config, db, now });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    console.error('[api] unhandled error:', err.message);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
