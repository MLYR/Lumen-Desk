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

const LAST_STEP_KEY = 'totp_last_step';

/**
 * RFC 6238 check with a ±1 step window and replay protection: the matched
 * time-step must be strictly greater than the last accepted one.
 */
export function verifyTotp(db: DB, totp: OTPAuth.TOTP, code: string, nowMs: number): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const delta = totp.validate({ token: code, timestamp: nowMs, window: 1 });
  if (delta === null) return false;
  const step = totp.counter({ timestamp: nowMs }) + delta;
  const last = Number(kvGet(db, LAST_STEP_KEY) ?? -1);
  if (step <= last) return false;
  kvSet(db, LAST_STEP_KEY, String(step));
  return true;
}
