import type { DB } from '../db.js';
import { newSessionToken, sha256Hex } from './crypto.js';

export const SESSION_COOKIE = 'ld_session';
export const SESSION_TTL_S = 30 * 24 * 3600;

/** Creates a session and returns the raw token (only its hash is stored). */
export function createSession(db: DB, now = Date.now()): string {
  const token = newSessionToken();
  db.prepare('INSERT INTO sessions (token_hash, created, expires, last_seen) VALUES (?, ?, ?, ?)').run(
    sha256Hex(token),
    now,
    now + SESSION_TTL_S * 1000,
    now,
  );
  return token;
}

export function validateSession(db: DB, token: string | undefined, now = Date.now()): boolean {
  if (!token || token.length > 128) return false;
  const hash = sha256Hex(token);
  const row = db.prepare('SELECT expires, last_seen FROM sessions WHERE token_hash = ?').get(hash) as
    | { expires: number; last_seen: number }
    | undefined;
  if (!row) return false;
  if (row.expires <= now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return false;
  }
  // Avoid a write on every forward_auth call; a minute of resolution is enough.
  if (now - row.last_seen > 60_000) {
    db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now, hash);
  }
  return true;
}

export function deleteSession(db: DB, token: string | undefined): void {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256Hex(token));
}

export function deleteAllSessions(db: DB): number {
  return Number(db.prepare('DELETE FROM sessions').run().changes);
}

export function purgeExpiredSessions(db: DB, now = Date.now()): void {
  db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now);
}
