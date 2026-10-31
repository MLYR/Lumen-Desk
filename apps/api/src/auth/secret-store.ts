import crypto from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { kvGet, kvSet, type DB } from '../db.js';
import { makeTotp } from './totp.js';

/**
 * TOTP secret storage. kv.totp_secret holds the base32 secret, AES-256-GCM encrypted with SECRET_KEY
 * ("v1:<iv>:<tag>:<ciphertext>", base64url parts). Without SECRET_KEY it is stored as "plain:<base32>"
 * (local dev) and a warning is logged. The secret itself is never logged.
 */

export const SECRET_KV = 'totp_secret';
export const PENDING_KV = 'totp_pending';
export const PENDING_TTL_MS = 10 * 60_000;

export class SecretKeyError extends Error {}

/** SECRET_KEY must be 32 bytes, base64. Returns null when unset. Throws on a malformed key (fail fast). */
export function parseSecretKey(raw: string | undefined): Buffer | null {
  if (!raw?.trim()) return null;
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length !== 32) throw new SecretKeyError('SECRET_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)');
  return key;
}

const b64u = (b: Buffer) => b.toString('base64url');

export function seal(key: Buffer | null, plaintext: string, aad: string): string {
  if (!key) return `plain:${plaintext}`;
  const iv = crypto.randomBytes(IV_BYTES);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return `v1:${b64u(iv)}:${b64u(c.getAuthTag())}:${b64u(ct)}`;
}

const TAG_BYTES = 16;
const IV_BYTES = 12;

/**
 * Returns null when the value can't be opened (wrong key, tampered, truncated tag, encrypted but no key).
 * With a key configured, "plain:" values are refused: someone with write access to the database
 * must not be able to plant a secret of their choosing. allowPlain is only for the one-time upgrade
 * of a value written before SECRET_KEY was set (TotpStore rewrites it encrypted right away).
 */
export function open(key: Buffer | null, stored: string, aad: string, opts: { allowPlain?: boolean } = {}): string | null {
  if (stored.startsWith('plain:')) return !key || opts.allowPlain ? stored.slice(6) : null;
  if (!stored.startsWith('v1:') || !key) return null;
  const parts = stored.split(':');
  if (parts.length !== 4) return null;
  const [, ivB, tagB, ctB] = parts;
  const iv = Buffer.from(ivB!, 'base64url');
  const tag = Buffer.from(tagB!, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(Buffer.from(ctB!, 'base64url')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const isBase32 = (s: string) => /^[A-Z2-7]{16,128}=*$/.test(s);

export function newSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function writeSecret(db: DB, key: Buffer | null, secret: string): void {
  kvSet(db, SECRET_KV, seal(key, secret, SECRET_KV));
}

export interface Pending {
  secret: string;
  expiresAt: number;
}

export function writePending(db: DB, key: Buffer | null, p: Pending): void {
  kvSet(db, PENDING_KV, JSON.stringify({ s: seal(key, p.secret, PENDING_KV), e: p.expiresAt }));
}

export function readPending(db: DB, key: Buffer | null): Pending | null {
  const raw = kvGet(db, PENDING_KV);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { s: string; e: number };
    const secret = open(key, v.s, PENDING_KV);
    return secret && isBase32(secret) && Number.isFinite(v.e) ? { secret, expiresAt: v.e } : null;
  } catch {
    return null;
  }
}

export function clearPending(db: DB): void {
  db.prepare('DELETE FROM kv WHERE key = ?').run(PENDING_KV);
}

export interface TotpStoreOptions {
  db: DB;
  key: Buffer | null;
  envSecret: string | undefined;
  issuer: string;
  label: string;
  log?: (msg: string) => void;
}

/**
 * The live TOTP instance. Login and recovery-code regeneration call get() on every request,
 * so replace() (after a rebind) takes effect immediately without a restart.
 */
export class TotpStore {
  private current: OTPAuth.TOTP | null;

  constructor(private readonly o: TotpStoreOptions) {
    const log = o.log ?? console.warn;
    if (!o.key) log('[auth] SECRET_KEY is not set; the TOTP secret is stored unencrypted in the database');
    const stored = kvGet(o.db, SECRET_KV);
    let secret: string | null = null;
    if (stored !== undefined) {
      // The only place a "plain:" value is accepted with a key set: it is rewritten encrypted below.
      secret = open(o.key, stored, SECRET_KV, { allowPlain: true });
      if (!secret || !isBase32(secret)) {
        // Refuse to silently fall back to .env: that would resurrect an old, replaced secret.
        log('[auth] kv.totp_secret could not be decrypted (wrong or missing SECRET_KEY?); TOTP login is disabled');
        secret = null;
      } else if (o.envSecret) {
        log('[auth] TOTP 密钥来自数据库，.env 里的 TOTP_SECRET 已不再使用');
      }
      // Upgrade a plaintext value once a key is configured.
      if (secret && o.key && stored.startsWith('plain:')) writeSecret(o.db, o.key, secret);
    } else if (o.envSecret) {
      secret = o.envSecret;
    }
    this.current = secret ? this.make(secret) : null;
    if (!this.current && stored === undefined) log('[auth] no TOTP secret (run init-totp); only recovery codes can log in');
  }

  get(): OTPAuth.TOTP | null {
    return this.current;
  }

  make(secret: string): OTPAuth.TOTP {
    return makeTotp(secret, this.o.issuer, this.o.label);
  }

  /** Swaps the in-process instance (the DB write happens in the caller's transaction). */
  replace(secret: string): void {
    this.current = this.make(secret);
  }

  get key(): Buffer | null {
    return this.o.key;
  }
}
