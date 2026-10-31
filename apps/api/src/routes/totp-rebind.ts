import type { Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { renderSVG } from 'uqr';
import type { Config } from '../config.js';
import { kvGet, kvSet, tx, type DB } from '../db.js';
import { errorResponse, limit, readJson, requireType, sameOrigin as sameOriginFor } from '../http.js';
import { clearPending, newSecret, PENDING_TTL_MS, readPending, writePending, writeSecret, type TotpStore } from '../auth/secret-store.js';
import { deleteOtherSessions, getSession, SESSION_COOKIE } from '../auth/sessions.js';
import { LAST_STEP_KEY, matchStep, verifyTotp } from '../auth/totp.js';
import { checkCurrentTotp } from './totp-guard.js';

export interface RebindDeps {
  config: Config;
  db: DB;
  now: () => number;
  totp: TotpStore;
  clientIp: (c: Context) => string;
}

/**
 * Two-step rebind of the authenticator (docs/contracts/totp-rebind.md). The old secret stays valid
 * until confirm succeeds. Both steps share the login limiter and run their checks synchronously.
 */
export function registerTotpRebind(app: Hono, { config, db, now, totp, clientIp }: RebindDeps): void {
  const sameOrigin = sameOriginFor(config.siteUrl);
  const codeBody = [sameOrigin, requireType('application/json'), limit(1024)] as const;

  const readCode = async (c: Context): Promise<string | Response> => {
    try {
      const body = (await readJson(c)) as { code?: unknown } | null;
      return typeof body?.code === 'string' ? body.code.trim() : '';
    } catch (err) {
      return errorResponse(c, err);
    }
  };

  app.post('/api/private/security/totp/rebind', ...codeBody, async (c) => {
    c.header('Cache-Control', 'no-store');
    const code = await readCode(c);
    if (code instanceof Response) return code;
    const t = now();
    // Current authenticator, with replay protection: the code can't be reused to log in afterwards.
    const denied = checkCurrentTotp(c, db, clientIp(c), t, (code6, at) => {
      const live = totp.get();
      return live !== null && verifyTotp(db, live, code6, at);
    }, code);
    if (denied) return denied;

    const secret = newSecret();
    const expiresAt = t + PENDING_TTL_MS;
    writePending(db, totp.key, { secret, expiresAt }); // overwrites any earlier pending
    const otpauthUri = totp.make(secret).toString();
    const svg = renderSVG(otpauthUri, { ecc: 'M', border: 4, pixelSize: 8, whiteColor: '#ffffff', blackColor: '#000000' });
    return c.json({ otpauthUri, qrSvg: svg, secret, expiresAt: new Date(expiresAt).toISOString() });
  });

  app.post('/api/private/security/totp/confirm', ...codeBody, async (c) => {
    c.header('Cache-Control', 'no-store');
    const code = await readCode(c);
    if (code instanceof Response) return code;
    const t = now();
    const pending = readPending(db, totp.key);
    if (!pending) return c.json({ error: 'no_pending', message: '请先重新开始绑定' }, 409);
    if (pending.expiresAt <= t) {
      clearPending(db);
      return c.json({ error: 'pending_expired', message: '二维码已过期，请重新开始' }, 410);
    }
    const fresh = totp.make(pending.secret);
    let step: number | null = null;
    const denied = checkCurrentTotp(c, db, clientIp(c), t, (code6, at) => (step = matchStep(db, fresh, code6, at, false)) !== null, code);
    if (denied) return denied;

    const keep = getSession(db, getCookie(c, SESSION_COOKIE), t);
    tx(db, () => {
      writeSecret(db, totp.key, pending.secret);
      clearPending(db);
      // The new code's step becomes the replay floor, so it can't be used again to log in.
      kvSet(db, LAST_STEP_KEY, String(Math.max(step!, Number(kvGet(db, LAST_STEP_KEY) ?? -1))));
      if (keep) deleteOtherSessions(db, keep.hash);
    });
    totp.replace(pending.secret);
    return c.json({ ok: true });
  });

  app.delete('/api/private/security/totp/pending', sameOrigin, (c) => {
    clearPending(db);
    return c.body(null, 204);
  });
}
