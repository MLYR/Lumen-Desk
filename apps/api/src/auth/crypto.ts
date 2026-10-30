import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time comparison of two equal-length hex digests. */
export function hexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// No 0/o/1/l/i to avoid transcription mistakes.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newRecoveryCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
