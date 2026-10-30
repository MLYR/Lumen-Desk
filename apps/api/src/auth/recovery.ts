import type { DB } from '../db.js';
import { hexEqual, newRecoveryCode, sha256Hex } from './crypto.js';

export const RECOVERY_RE = /^[a-z0-9]{4}-[a-z0-9]{4}$/;

export function normalizeRecovery(code: string): string {
  return code.trim().toLowerCase();
}

export function countUnusedRecoveryCodes(db: DB): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE used_at IS NULL').get() as { n: number };
  return Number(row.n);
}

/** Replaces all recovery codes with `count` fresh ones; returns the plaintext codes (shown once). */
export function generateRecoveryCodes(db: DB, count = 10, now = Date.now()): string[] {
  const codes = Array.from({ length: count }, newRecoveryCode);
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM recovery_codes');
    const ins = db.prepare('INSERT INTO recovery_codes (code_hash, created) VALUES (?, ?)');
    for (const c of codes) ins.run(sha256Hex(c), now);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return codes;
}

/** Checks a recovery code against all unused hashes (no early exit) and consumes it on match. */
export function consumeRecoveryCode(db: DB, code: string, now = Date.now()): boolean {
  const normalized = normalizeRecovery(code);
  if (!RECOVERY_RE.test(normalized)) return false;
  const hash = sha256Hex(normalized);
  const rows = db.prepare('SELECT id, code_hash FROM recovery_codes WHERE used_at IS NULL').all() as {
    id: number;
    code_hash: string;
  }[];
  let matchId: number | null = null;
  for (const r of rows) {
    if (hexEqual(r.code_hash, hash) && matchId === null) matchId = r.id;
  }
  if (matchId === null) return false;
  const res = db.prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL').run(now, matchId);
  return Number(res.changes) === 1;
}
