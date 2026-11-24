import type { DB } from '../db.js';

export const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';
export const GITHUB_MAX_AGE_MS = 7 * 24 * 3600_000;
const TIMEOUT_MS = 15_000;

export interface ContributionDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface GithubResponse {
  enabled: boolean;
  username: string | null;
  profileUrl: string | null;
  totalContributions: number;
  weeks: ContributionDay[][];
  updatedAt: string | null;
}

interface StoredGithub {
  username: string;
  totalContributions: number;
  weeks: ContributionDay[][];
}

interface GithubRow {
  username: string | null;
  payload: string | null;
  fetched_at: number | null;
}

type FetchFn = typeof fetch;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const LEVEL_MAP: Record<string, 0 | 1 | 2 | 3 | 4> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const CONTRIBUTIONS_QUERY = `query($login: String!) {
  user(login: $login) {
    login
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
          }
        }
      }
    }
  }
}`;

function toLevel(raw: unknown, count: number): 0 | 1 | 2 | 3 | 4 {
  if (typeof raw === 'string' && raw in LEVEL_MAP) return LEVEL_MAP[raw]!;
  if (count <= 0) return 0;
  if (count <= 3) return 1;
  if (count <= 6) return 2;
  if (count <= 9) return 3;
  return 4;
}

export function mapGithubContributions(payload: unknown, fallbackUsername: string): StoredGithub | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as { errors?: unknown; data?: { user?: any } };
  if (Array.isArray(p.errors) && p.errors.length > 0) return null;

  const user = p.data?.user;
  const cal = user?.contributionsCollection?.contributionCalendar;
  if (!cal || !Array.isArray(cal.weeks)) return null;

  const weeks: ContributionDay[][] = [];
  let sum = 0;
  for (const w of cal.weeks.slice(0, 60)) {
    const rawDays = (w as { contributionDays?: unknown })?.contributionDays;
    if (!Array.isArray(rawDays)) continue;
    const days: ContributionDay[] = [];
    for (const d of rawDays.slice(0, 7)) {
      if (!d || typeof d !== 'object') continue;
      const date = typeof (d as { date?: unknown }).date === 'string' ? (d as { date: string }).date.trim() : '';
      const countRaw = Number((d as { contributionCount?: unknown }).contributionCount);
      if (!DATE_RE.test(date) || !Number.isFinite(countRaw) || countRaw < 0) continue;
      const count = Math.trunc(countRaw);
      sum += count;
      days.push({
        date,
        count,
        level: toLevel((d as { contributionLevel?: unknown }).contributionLevel, count),
      });
    }
    if (days.length) weeks.push(days);
  }
  if (!weeks.length) return null;

  const totalRaw = Number(cal.totalContributions);
  const totalContributions = Number.isFinite(totalRaw) && totalRaw >= 0 ? Math.trunc(totalRaw) : sum;
  const login = typeof user?.login === 'string' && user.login.trim() ? user.login.trim() : fallbackUsername;
  return { username: login, totalContributions, weeks };
}

export type GithubRefreshResult = 'updated' | 'unconfigured' | 'error';

export async function refreshGithub(
  db: DB,
  opts: { username?: string; token?: string; siteUrl: string; fetchFn?: FetchFn; now?: () => number },
): Promise<GithubRefreshResult> {
  const username = opts.username?.trim();
  const token = opts.token?.trim();
  if (!username || !token) return 'unconfigured';

  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? Date.now;
  db.prepare('INSERT OR IGNORE INTO github_cache (id) VALUES (1)').run();

  try {
    const res = await fetchFn(GITHUB_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': `lumen-desk/1.0 (+${opts.siteUrl})`,
      },
      body: JSON.stringify({ query: CONTRIBUTIONS_QUERY, variables: { login: username } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[github] fetch failed: HTTP ${res.status}`);
      return 'error';
    }
    const body = (await res.json()) as { errors?: Array<{ message?: unknown }> };
    if (Array.isArray(body?.errors) && body.errors.length > 0) {
      const msg = typeof body.errors[0]?.message === 'string' ? body.errors[0].message : 'GraphQL error';
      console.warn(`[github] GraphQL error: ${msg}`);
      return 'error';
    }
    const mapped = mapGithubContributions(body, username);
    if (!mapped) {
      console.warn('[github] unexpected GraphQL payload');
      return 'error';
    }
    db.prepare('UPDATE github_cache SET username = ?, payload = ?, fetched_at = ? WHERE id = 1').run(
      username.toLowerCase(),
      JSON.stringify(mapped),
      now(),
    );
    return 'updated';
  } catch (e) {
    console.warn(`[github] fetch failed: ${(e as Error).message}`);
    return 'error';
  }
}

export function getGithub(
  db: DB,
  opts: { username?: string; token?: string },
  now = Date.now(),
): GithubResponse {
  const username = opts.username?.trim();
  const token = opts.token?.trim();
  if (!username || !token) {
    return { enabled: false, username: null, profileUrl: null, totalContributions: 0, weeks: [], updatedAt: null };
  }

  const base: GithubResponse = {
    enabled: true,
    username,
    profileUrl: `https://github.com/${encodeURIComponent(username)}`,
    totalContributions: 0,
    weeks: [],
    updatedAt: null,
  };
  const row = db.prepare('SELECT username, payload, fetched_at FROM github_cache WHERE id = 1').get() as
    | GithubRow
    | undefined;
  if (!row?.payload || !row.fetched_at || row.username !== username.toLowerCase()) return base;
  if (now - row.fetched_at > GITHUB_MAX_AGE_MS) return base;

  try {
    const parsed = JSON.parse(row.payload) as StoredGithub;
    if (!Array.isArray(parsed?.weeks) || !parsed.weeks.length) return base;
    const login = typeof parsed.username === 'string' && parsed.username ? parsed.username : username;
    return {
      enabled: true,
      username: login,
      profileUrl: `https://github.com/${encodeURIComponent(login)}`,
      totalContributions: Number.isFinite(parsed.totalContributions) ? parsed.totalContributions : 0,
      weeks: parsed.weeks,
      updatedAt: new Date(row.fetched_at).toISOString(),
    };
  } catch {
    return base;
  }
}
