import type { Context } from 'hono';
import type { DB } from '../db.js';
import { lockedResponse } from '../http.js';
import { lockedFor, recordFailure, recordSuccess } from '../auth/ratelimit.js';

/**
 * Login-equivalent check of a 6-digit code: lock check → verify → record, all synchronous
 * (no await between them), sharing the login counters (5 per IP, global pause).
 * Returns the error response, or null when the code was accepted.
 */
export function checkCurrentTotp(
  c: Context,
  db: DB,
  ip: string,
  t: number,
  verify: (code: string, t: number) => boolean,
  code: string,
): Response | null {
  const locked = lockedFor(db, ip, t);
  if (locked > 0) return lockedResponse(c, locked);
  if (!(/^\d{6}$/.test(code) && verify(code, t))) {
    const lockMs = recordFailure(db, ip, t);
    if (lockMs > 0) return lockedResponse(c, lockMs);
    return c.json({ error: 'invalid_code' }, 401);
  }
  recordSuccess(db, ip);
  return null;
}
