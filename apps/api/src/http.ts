import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

/** 400 invalid_request with a user-facing message. */
export class InputError extends Error {}
/** 404 not_found. */
export class NotFoundError extends Error {}
/** 409 with a specific error code (slug_taken, name_taken). */
export class ConflictError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const tooLarge = (c: Context) => c.json({ error: 'payload_too_large' }, 413);
export const limit = (maxSize: number) => bodyLimit({ maxSize, onError: tooLarge });

export function safeOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** If Origin is present it must be SITE_URL's origin or match the request Host; otherwise 403 bad_origin. */
export function sameOrigin(siteUrl: string): MiddlewareHandler {
  const siteOrigin = safeOrigin(siteUrl);
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (origin !== undefined) {
      const o = safeOrigin(origin);
      const host = c.req.header('host');
      const ok = o !== null && (o === siteOrigin || (host !== undefined && new URL(o).host === host.toLowerCase()));
      if (!ok) return c.json({ error: 'bad_origin' }, 403);
    }
    await next();
  };
}

export const requireType =
  (type: 'application/json' | 'multipart/form-data'): MiddlewareHandler =>
  async (c, next) => {
    const ct = c.req.header('content-type')?.toLowerCase() ?? '';
    if (!ct.startsWith(type)) return c.json({ error: 'unsupported_media_type' }, 415);
    await next();
  };

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new InputError('请求体不是有效的 JSON');
  }
}

/** Maps the error classes above to JSON responses; anything else is rethrown (500). */
export function errorResponse(c: Context, err: unknown) {
  if (err instanceof InputError) return c.json({ error: 'invalid_request', message: err.message }, 400);
  if (err instanceof ConflictError) return c.json({ error: err.code, message: err.message }, 409);
  if (err instanceof NotFoundError) return c.json({ error: 'not_found' }, 404);
  throw err;
}

/** 429 with Retry-After, shared by login and recovery-code regeneration. */
export function lockedResponse(c: Context, ms: number) {
  const retryAfter = Math.ceil(ms / 1000);
  c.header('Retry-After', String(retryAfter));
  return c.json({ error: 'locked', retryAfter }, 429);
}

/** Zero-width and bidi-override characters: invisible, and can visually reorder text. */
export const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/;
/** Control characters plus INVISIBLE; for single-line names. */
export const BAD_CHARS = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/;
/** At least one character that isn't whitespace. */
export const visible = (s: string): boolean => /\S/u.test(s);
