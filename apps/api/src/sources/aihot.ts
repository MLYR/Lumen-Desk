import type { DB } from '../db.js';

export const AIHOT_URL = 'https://aihot.news/api/v1/hot-topics';
export const AIHOT_SOURCE = { name: 'AIHOT', url: 'https://aihot.news' } as const;
export const MAX_AGE_MS = 7 * 24 * 3600_000;
const TIMEOUT_MS = 15_000;

export interface HotItem {
  rank: number;
  title: string;
  sourceCount: number;
  url: string;
}

export interface HotResponse {
  items: HotItem[];
  updatedAt: string | null;
  source: typeof AIHOT_SOURCE;
}

type FetchFn = typeof fetch;

interface CacheRow {
  items: string | null;
  etag: string | null;
  fetched_at: number | null;
  checked_at: number | null;
  retry_after_until: number;
}

function readRow(db: DB): CacheRow | undefined {
  return db.prepare('SELECT items, etag, fetched_at, checked_at, retry_after_until FROM aihot_cache WHERE id = 1').get() as
    | CacheRow
    | undefined;
}

function ensureRow(db: DB): void {
  db.prepare('INSERT OR IGNORE INTO aihot_cache (id) VALUES (1)').run();
}

/** Maps AIHOT `items[]` to our shape, tolerating missing/renamed fields. Keeps only https AIHOT links. */
export function mapItems(payload: unknown): HotItem[] {
  const raw = (payload as { items?: unknown })?.items;
  if (!Array.isArray(raw)) return [];
  const out: HotItem[] = [];
  raw.forEach((it: any, i: number) => {
    if (!it || typeof it !== 'object') return;
    const title = typeof it.title === 'string' ? it.title.trim() : '';
    const url = it.links?.aihot ?? it.aihotUrl ?? it.url;
    if (!title || typeof url !== 'string' || !/^https:\/\//i.test(url)) return;
    const rank = Number.isFinite(Number(it.rank)) ? Number(it.rank) : i + 1;
    const sc = Number(it.sourceCount ?? it.source_count ?? (Array.isArray(it.sourceNames) ? it.sourceNames.length : 0));
    out.push({ rank, title, sourceCount: Number.isFinite(sc) ? sc : 0, url });
  });
  return out.sort((a, b) => a.rank - b.rank).slice(0, 10);
}

/** Parses Retry-After (seconds or HTTP date) into ms; defaults to 10 minutes. */
function retryAfterMs(header: string | null, now: number): number {
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  return 10 * 60_000;
}

export type RefreshResult = 'updated' | 'not_modified' | 'rate_limited' | 'skipped' | 'error';

export async function refreshAihot(
  db: DB,
  opts: { siteUrl: string; fetchFn?: FetchFn; now?: () => number },
): Promise<RefreshResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? Date.now;
  ensureRow(db);
  const row = readRow(db)!;
  if (row.retry_after_until > now()) return 'skipped';

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip',
    'User-Agent': `lumen-desk/1.0 (+${opts.siteUrl})`,
  };
  if (row.etag && row.items) headers['If-None-Match'] = row.etag;

  try {
    const res = await fetchFn(AIHOT_URL, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const t = now();
    if (res.status === 304) {
      db.prepare('UPDATE aihot_cache SET checked_at = ? WHERE id = 1').run(t);
      return 'not_modified';
    }
    if (res.status === 429) {
      const until = t + retryAfterMs(res.headers.get('retry-after'), t);
      db.prepare('UPDATE aihot_cache SET checked_at = ?, retry_after_until = ? WHERE id = 1').run(t, until);
      console.warn(`[aihot] rate limited; next attempt after ${new Date(until).toISOString()}`);
      return 'rate_limited';
    }
    if (!res.ok) {
      console.warn(`[aihot] fetch failed: HTTP ${res.status}`);
      return 'error';
    }
    const items = mapItems(await res.json());
    // Full replacement on every 200, so retracted items disappear.
    db.prepare('UPDATE aihot_cache SET items = ?, etag = ?, fetched_at = ?, checked_at = ? WHERE id = 1').run(
      JSON.stringify(items),
      res.headers.get('etag'),
      t,
      t,
    );
    return 'updated';
  } catch (e) {
    console.warn(`[aihot] fetch failed: ${(e as Error).message}`);
    return 'error';
  }
}

export function getHot(db: DB, now = Date.now()): HotResponse {
  const row = readRow(db);
  const empty: HotResponse = { items: [], updatedAt: null, source: AIHOT_SOURCE };
  if (!row?.items || !row.fetched_at) return empty;
  // Terms: keep at most 7 days. `checked_at` (304) confirms the data is still current.
  const freshAt = Math.max(row.fetched_at, row.checked_at ?? 0);
  if (now - freshAt > MAX_AGE_MS) return empty;
  let items: HotItem[] = [];
  try {
    items = JSON.parse(row.items) as HotItem[];
  } catch {
    return empty;
  }
  return { items: items.slice(0, 10), updatedAt: new Date(freshAt).toISOString(), source: AIHOT_SOURCE };
}

/** Removes cached payloads older than 7 days. */
export function purgeStaleAihot(db: DB, now = Date.now()): void {
  db.prepare(
    'UPDATE aihot_cache SET items = NULL, etag = NULL, fetched_at = NULL WHERE id = 1 AND MAX(COALESCE(fetched_at,0), COALESCE(checked_at,0)) < ?',
  ).run(now - MAX_AGE_MS);
}
