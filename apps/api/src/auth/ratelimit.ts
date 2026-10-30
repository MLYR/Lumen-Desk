import { kvGet, kvSet, type DB } from '../db.js';

export const IP_MAX_FAILURES = 5;
export const IP_LOCK_MS = 15 * 60_000;
export const GLOBAL_MAX_FAILURES = 30;
export const GLOBAL_WINDOW_MS = 60 * 60_000;
export const GLOBAL_PAUSE_MS = 60 * 60_000;

const PAUSE_KEY = 'login_paused_until';

/** Returns ms until the caller may try again, or 0 if a login attempt is allowed. */
export function lockedFor(db: DB, ip: string, now: number, opts: { ignoreGlobal?: boolean } = {}): number {
  const pausedUntil = opts.ignoreGlobal ? 0 : Number(kvGet(db, PAUSE_KEY) ?? 0);
  const row = db.prepare('SELECT locked_until FROM ip_failures WHERE ip = ?').get(ip) as
    | { locked_until: number }
    | undefined;
  const until = Math.max(pausedUntil, row?.locked_until ?? 0);
  return until > now ? until - now : 0;
}

/** Records a failed attempt. Returns ms locked if this failure triggered a lock, else 0. */
export function recordFailure(db: DB, ip: string, now: number): number {
  db.prepare('INSERT INTO login_failures (ts) VALUES (?)').run(now);
  db.prepare('DELETE FROM login_failures WHERE ts <= ?').run(now - GLOBAL_WINDOW_MS);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM login_failures').get() as { n: number };
  let locked = 0;
  if (Number(n) > GLOBAL_MAX_FAILURES) {
    kvSet(db, PAUSE_KEY, String(now + GLOBAL_PAUSE_MS));
    db.exec('DELETE FROM login_failures');
    console.warn(`[auth] ${n} failed logins in the last hour; pausing all logins for 1 hour`);
    locked = GLOBAL_PAUSE_MS;
  }

  const row = db.prepare('SELECT count FROM ip_failures WHERE ip = ?').get(ip) as { count: number } | undefined;
  const count = (row?.count ?? 0) + 1;
  if (count >= IP_MAX_FAILURES) {
    db.prepare(
      'INSERT INTO ip_failures (ip, count, locked_until) VALUES (?, 0, ?) ON CONFLICT(ip) DO UPDATE SET count = 0, locked_until = excluded.locked_until',
    ).run(ip, now + IP_LOCK_MS);
    console.warn('[auth] IP locked for 15 minutes after repeated login failures');
    locked = Math.max(locked, IP_LOCK_MS);
  } else {
    db.prepare(
      'INSERT INTO ip_failures (ip, count, locked_until) VALUES (?, ?, 0) ON CONFLICT(ip) DO UPDATE SET count = excluded.count',
    ).run(ip, count);
  }
  return locked;
}

export function recordSuccess(db: DB, ip: string): void {
  db.prepare('DELETE FROM ip_failures WHERE ip = ?').run(ip);
}

/** Clears the global pause and all per-IP locks. */
export function unlockAll(db: DB): void {
  kvSet(db, PAUSE_KEY, '0');
  db.exec('DELETE FROM ip_failures; DELETE FROM login_failures;');
}
