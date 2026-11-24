import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { GITHUB_MAX_AGE_MS, refreshGithub } from '../src/sources/github.js';
import { setup } from './helpers.js';

const sampleGraphql = {
  data: {
    user: {
      login: 'zreo-dev',
      contributionsCollection: {
        contributionCalendar: {
          totalContributions: 12,
          weeks: [
            {
              contributionDays: [
                { date: '2026-11-15', contributionCount: 0, contributionLevel: 'NONE' },
                { date: '2026-11-16', contributionCount: 2, contributionLevel: 'FIRST_QUARTILE' },
                { date: '2026-11-17', contributionCount: 4, contributionLevel: 'SECOND_QUARTILE' },
              ],
            },
            {
              contributionDays: [
                { date: '2026-11-22', contributionCount: 6, contributionLevel: 'FOURTH_QUARTILE' },
              ],
            },
          ],
        },
      },
    },
  },
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });

describe('/api/github', () => {
  it('validates GITHUB_USERNAME in loadConfig', () => {
    expect(() => loadConfig({ GITHUB_USERNAME: 'bad user!' })).toThrow(/GITHUB_USERNAME/);
    expect(() => loadConfig({ GITHUB_USERNAME: '-leading' })).toThrow(/GITHUB_USERNAME/);
    expect(loadConfig({ GITHUB_USERNAME: 'MLYR' }).githubUsername).toBe('MLYR');
  });

  it('returns enabled=false and skips fetch when unconfigured', async () => {
    const { app, db } = setup();
    const fetchFn = vi.fn<typeof fetch>();
    expect(await refreshGithub(db, { siteUrl: 'https://me.test', fetchFn })).toBe('unconfigured');
    expect(fetchFn).not.toHaveBeenCalled();

    const res = await app.request('/api/github');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await res.json()).toEqual({
      enabled: false,
      username: null,
      profileUrl: null,
      totalContributions: 0,
      weeks: [],
      updatedAt: null,
    });
  });

  it('fetches GraphQL contributions, never leaks token, retains cache on error, and expires stale cache', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const secretToken = 'ghp_test_secret_token_do_not_leak';
    const { app, db, clock, config } = setup(undefined, {
      GITHUB_USERNAME: 'zreo-dev',
      GITHUB_TOKEN: secretToken,
    });
    const now = () => clock.t;
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(json(sampleGraphql));

    expect(
      await refreshGithub(db, {
        username: config.githubUsername,
        token: config.githubToken,
        siteUrl: config.siteUrl,
        fetchFn,
        now,
      }),
    ).toBe('updated');

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/graphql');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${secretToken}`);
    expect(headers['User-Agent']).toBe(`lumen-desk/1.0 (+${config.siteUrl})`);

    const res = await app.request('/api/github');
    const text = await res.text();
    expect(text).not.toContain(secretToken);
    const body = JSON.parse(text);
    expect(body).toEqual({
      enabled: true,
      username: 'zreo-dev',
      profileUrl: 'https://github.com/zreo-dev',
      totalContributions: 12,
      weeks: [
        [
          { date: '2026-11-15', count: 0, level: 0 },
          { date: '2026-11-16', count: 2, level: 1 },
          { date: '2026-11-17', count: 4, level: 2 },
        ],
        [{ date: '2026-11-22', count: 6, level: 4 }],
      ],
      updatedAt: new Date(clock.t).toISOString(),
    });

    // GraphQL error keeps existing cache
    clock.t += 7200_000;
    fetchFn.mockResolvedValueOnce(json({ errors: [{ message: 'API rate limit exceeded' }] }));
    expect(
      await refreshGithub(db, {
        username: config.githubUsername,
        token: config.githubToken,
        siteUrl: config.siteUrl,
        fetchFn,
        now,
      }),
    ).toBe('error');
    expect((await (await app.request('/api/github')).json()).totalContributions).toBe(12);

    // Different configured username does not serve previous user's cache
    const switched = setup(clock.t, { GITHUB_USERNAME: 'someone-else', GITHUB_TOKEN: secretToken });
    const row = db.prepare('SELECT username, payload, fetched_at FROM github_cache WHERE id = 1').get() as {
      username: string;
      payload: string;
      fetched_at: number;
    };
    switched.db
      .prepare('INSERT INTO github_cache (id, username, payload, fetched_at) VALUES (1, ?, ?, ?)')
      .run(row.username, row.payload, row.fetched_at);
    const switchedBody = await (await switched.app.request('/api/github')).json();
    expect(switchedBody.enabled).toBe(true);
    expect(switchedBody.username).toBe('someone-else');
    expect(switchedBody.weeks).toEqual([]);

    // Older than 7 days expires cleanly
    clock.t += GITHUB_MAX_AGE_MS + 1;
    const stale = await (await app.request('/api/github')).json();
    expect(stale.enabled).toBe(true);
    expect(stale.weeks).toEqual([]);
    expect(stale.updatedAt).toBeNull();

    warn.mockRestore();
  });
});
