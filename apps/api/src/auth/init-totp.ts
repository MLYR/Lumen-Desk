import { kvGet, tx, type DB } from '../db.js';
import { generateRecoveryCodes } from './recovery.js';
import { newSecret, PENDING_KV, SECRET_KV, writeSecret } from './secret-store.js';
import { LAST_STEP_KEY } from './totp.js';
import { countUnusedRecoveryCodes } from './recovery.js';

export class InitRefused extends Error {}

export interface InitResult {
  secret: string;
  codes: string[];
  /** Sessions signed out (database mode). */
  sessionsRevoked: number;
}

/**
 * init-totp's work, testable without a process. Database mode (default): one transaction writes the
 * secret, deletes any pending rebind, resets the replay floor, replaces the recovery codes and signs
 * out every session (a CLI reset means every device logs in again). --print-env: nothing but the
 * recovery codes is written, and it is refused when the database already has a secret (the .env
 * value would be ignored).
 */
export function initTotp(db: DB, key: Buffer | null, opts: { force: boolean; printEnv: boolean; now: number }): InitResult {
  const hasSecret = kvGet(db, SECRET_KV) !== undefined;
  if (opts.printEnv && hasSecret) {
    throw new InitRefused('数据库里已有密钥，.env 的值不会生效；请用 --force 写入数据库（不加 --print-env）');
  }
  const codesLeft = countUnusedRecoveryCodes(db);
  if (!opts.force && (codesLeft > 0 || hasSecret)) {
    const what = [hasSecret ? 'a TOTP secret' : '', codesLeft ? `${codesLeft} unused recovery codes` : ''].filter(Boolean).join(' and ');
    throw new InitRefused(`Refusing to overwrite: ${what} already exist. Re-run with --force.`);
  }
  const secret = newSecret();
  if (opts.printEnv) return { secret, codes: generateRecoveryCodes(db, 10, opts.now), sessionsRevoked: 0 };
  let sessionsRevoked = 0;
  let codes: string[] = [];
  tx(db, () => {
    writeSecret(db, key, secret);
    db.prepare('DELETE FROM kv WHERE key IN (?, ?)').run(PENDING_KV, LAST_STEP_KEY);
    sessionsRevoked = Number(db.prepare('DELETE FROM sessions').run().changes);
    codes = generateRecoveryCodes(db, 10, opts.now, { inTransaction: true });
  });
  return { secret, codes, sessionsRevoked };
}
