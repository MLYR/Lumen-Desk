import * as OTPAuth from 'otpauth';
import { kvGet, kvSet, type DB } from '../db.js';

export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;

export function makeTotp(secretBase32: string, issuer = 'Lumen Desk', label = 'zreo'): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer,
    label,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export const LAST_STEP_KEY = 'totp_last_step';

/**
 * RFC 6238 check with a ±1 step window and replay protection: the matched
 * time-step must be strictly greater than the last accepted one.
 */
export function verifyTotp(db: DB, totp: OTPAuth.TOTP, code: string, nowMs: number): boolean {
  return matchStep(db, totp, code, nowMs, true) !== null;
}

/**
 * Matched time-step, or null. `replay` = also require step > the last accepted one and record it.
 * Rebind confirm uses replay=false for the *new* secret (its steps are independent of the old one's)
 * and then sets totp_last_step itself inside its transaction.
 */
export function matchStep(db: DB, totp: OTPAuth.TOTP, code: string, nowMs: number, replay: boolean): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = totp.validate({ token: code, timestamp: nowMs, window: 1 });
  if (delta === null) return null;
  const step = totp.counter({ timestamp: nowMs }) + delta;
  if (!replay) return step;
  const last = Number(kvGet(db, LAST_STEP_KEY) ?? -1);
  if (step <= last) return null;
  kvSet(db, LAST_STEP_KEY, String(step));
  return step;
}
