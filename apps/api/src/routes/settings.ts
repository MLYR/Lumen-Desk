import path from 'node:path';
import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { errorResponse, limit, readJson, requireType, sameOrigin as sameOriginFor } from '../http.js';
import { getProfile, parseProfile, saveProfile, setAvatar } from '../profile.js';
import { countUnusedRecoveryCodes, generateRecoveryCodes } from '../auth/recovery.js';
import { countSessions, deleteAllSessions, deleteOtherSessions, getSession, SESSION_COOKIE } from '../auth/sessions.js';
import { verifyTotp } from '../auth/totp.js';
import type { TotpStore } from '../auth/secret-store.js';
import { checkCurrentTotp } from './totp-guard.js';
import { registerTotpRebind } from './totp-rebind.js';
import { imageErrorResponse, readImageField, storeAvatar } from '../blog/uploads.js';

export interface SettingsDeps {
  config: Config;
  db: DB;
  now: () => number;
  totp: TotpStore;
  clientIp: (c: Context) => string;
}

/** Profile (public + private) and account security. Register after the /api/private/* session middleware. */
export function registerSettings(app: Hono, { config, db, now, totp, clientIp }: SettingsDeps): void {
  const sameOrigin = sameOriginFor(config.siteUrl);
  const jsonWrite = [sameOrigin, requireType('application/json'), limit(64 * 1024)] as const;
  const uploadsDir = path.join(config.dataDir, 'uploads');

  // ---------- profile ----------

  app.get('/api/profile', (c) => {
    c.header('Cache-Control', 'public, max-age=60');
    return c.json(getProfile(db));
  });

  app.get('/api/private/profile', (c) => c.json(getProfile(db)));

  app.put('/api/private/profile', ...jsonWrite, async (c) => {
    try {
      return c.json(saveProfile(db, parseProfile(await readJson(c))));
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.post('/api/private/profile/avatar', sameOrigin, requireType('multipart/form-data'), limit(12 * 1024 * 1024), async (c) => {
    const img = await readImageField(c);
    if (img instanceof Response) return img;
    try {
      const avatar = await storeAvatar(uploadsDir, img);
      setAvatar(db, avatar);
      return c.json({ avatar });
    } catch (err) {
      return imageErrorResponse(c, err);
    }
  });

  // The old file stays in uploads: it is content-addressed and may also be used in a post.
  app.delete('/api/private/profile/avatar', sameOrigin, (c) => {
    setAvatar(db, null);
    return c.body(null, 204);
  });

  // ---------- security ----------

  const current = (c: Context) => getSession(db, getCookie(c, SESSION_COOKIE), now());

  app.get('/api/private/security', (c) => {
    const s = current(c);
    return c.json({
      recoveryCodesLeft: countUnusedRecoveryCodes(db),
      sessionCount: countSessions(db, now()),
      currentSessionCreatedAt: s ? new Date(s.created).toISOString() : null,
    });
  });

  app.post('/api/private/security/sessions/revoke-others', sameOrigin, (c) => {
    const s = current(c);
    if (!s) return c.json({ error: 'unauthorized' }, 401);
    deleteOtherSessions(db, s.hash);
    return c.body(null, 204);
  });

  app.post('/api/private/security/sessions/revoke-all', sameOrigin, (c) => {
    deleteAllSessions(db);
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: config.cookieSecure, httpOnly: true, sameSite: 'Strict' });
    return c.body(null, 204);
  });

  app.post('/api/private/security/recovery-codes', sameOrigin, requireType('application/json'), limit(1024), async (c) => {
    c.header('Cache-Control', 'no-store');
    let code = '';
    try {
      const body = (await readJson(c)) as { code?: unknown } | null;
      if (typeof body?.code === 'string') code = body.code.trim();
    } catch (err) {
      return errorResponse(c, err);
    }

    const t = now();
    const denied = checkCurrentTotp(c, db, clientIp(c), t, (code6, at) => {
      const live = totp.get();
      return live !== null && verifyTotp(db, live, code6, at);
    }, code);
    if (denied) return denied;
    // Replaces every old code in one transaction; the plaintext only ever appears in this response.
    return c.json({ codes: generateRecoveryCodes(db, 10, t) });
  });

  registerTotpRebind(app, { config, db, now, totp, clientIp });
}
