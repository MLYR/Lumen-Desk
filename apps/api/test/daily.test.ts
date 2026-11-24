import { describe, expect, it, vi } from 'vitest';
import { purgeStaleAihotDaily, refreshAihotDaily } from '../src/sources/aihot.js';
import { setup } from './helpers.js';

const sampleDaily = {
  schemaVersion: 1,
  report: {
    date: '2026-11-23',
    generatedAt: '2026-11-23T00:00:32.455Z',
    links: { aihot: 'https://aihot.news/daily/2026-11-23' },
    attribution: { name: 'AIHOT', url: 'https://aihot.news/daily/2026-11-23' },
    lead: {
      title: '头条标题',
      leadParagraph: '头条导读摘要。',
    },
    highlights: [
      {
        id: 'h1',
        title: '精选条目',
        summary: '精选摘要',
        source: { name: '来源A' },
        links: { aihot: 'https://aihot.news/items/h1', original: 'https://example.test/h1' },
      },
      {
        id: 'bad',
        title: '非法链接条目',
        summary: '应该被过滤',
        links: { aihot: 'javascript:alert(1)', original: 'https://example.test/bad' },
      },
    ],
    sections: [
      {
        label: '行业动态',
        items: [
          {
            id: 's1',
            title: '行业条目 1',
            summary: '摘要 1',
            source: { name: '来源B' },
            links: { aihot: 'https://aihot.news/items/s1', original: 'javascript:evil()' },
          },
        ],
      },
      {
        label: '空分类',
        items: [],
      },
    ],
    flashes: [
      {
        id: 'f1',
        title: '快讯 1',
        source: { name: '来源C' },
        publishedAt: '2026-11-22T09:35:58.183Z',
        links: { aihot: 'https://aihot.news/items/f1', original: 'http://example.test/f1' },
      },
    ],
  },
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });

describe('/api/daily', () => {
  it('is empty before any fetch', async () => {
    const { app } = setup();
    const res = await app.request('/api/daily');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await res.json()).toEqual({
      report: null,
      updatedAt: null,
      source: { name: 'AIHOT', url: 'https://aihot.news' },
    });
  });

  it('sanitizes report fields, enforces https links, and handles 304 / 429 / full replacement / 7-day cap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, db, clock } = setup();
    const now = () => clock.t;
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(json(sampleDaily, { headers: { etag: '"d1"' } }));

    expect(await refreshAihotDaily(db, { siteUrl: 'https://me.test', fetchFn, now })).toBe('updated');
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://aihot.news/api/v1/dailies/latest');
    const h = init!.headers as Record<string, string>;
    expect(h['User-Agent']).toBe('lumen-desk/1.0 (+https://me.test)');
    expect(h['Accept-Encoding']).toBe('gzip');
    expect(h['If-None-Match']).toBeUndefined();

    const body = await (await app.request('/api/daily')).json();
    expect(body.source).toEqual({ name: 'AIHOT', url: 'https://aihot.news' });
    expect(body.updatedAt).toBe(new Date(clock.t).toISOString());
    expect(body.report).toEqual({
      date: '2026-11-23',
      generatedAt: '2026-11-23T00:00:32.455Z',
      url: 'https://aihot.news/daily/2026-11-23',
      lead: { title: '头条标题', leadParagraph: '头条导读摘要。' },
      highlights: [
        {
          title: '精选条目',
          summary: '精选摘要',
          sourceName: '来源A',
          aihotUrl: 'https://aihot.news/items/h1',
          originalUrl: 'https://example.test/h1',
          publishedAt: null,
        },
      ],
      sections: [
        {
          label: '行业动态',
          items: [
            {
              title: '行业条目 1',
              summary: '摘要 1',
              sourceName: '来源B',
              aihotUrl: 'https://aihot.news/items/s1',
              originalUrl: null,
              publishedAt: null,
            },
          ],
        },
      ],
      flashes: [
        {
          title: '快讯 1',
          summary: '',
          sourceName: '来源C',
          aihotUrl: 'https://aihot.news/items/f1',
          originalUrl: 'http://example.test/f1',
          publishedAt: '2026-11-22T09:35:58.183Z',
        },
      ],
    });

    // 304: sends ETag, keeps report, bumps updatedAt
    clock.t += 3600_000;
    fetchFn.mockResolvedValueOnce(new Response(null, { status: 304 }));
    expect(await refreshAihotDaily(db, { siteUrl: 'https://me.test', fetchFn, now })).toBe('not_modified');
    expect((fetchFn.mock.calls[1]![1]!.headers as Record<string, string>)['If-None-Match']).toBe('"d1"');
    const after304 = await (await app.request('/api/daily')).json();
    expect(after304.report.date).toBe('2026-11-23');
    expect(after304.updatedAt).toBe(new Date(clock.t).toISOString());

    // 429: honors Retry-After and skips calls before deadline
    fetchFn.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '1200' } }));
    expect(await refreshAihotDaily(db, { siteUrl: 'https://me.test', fetchFn, now })).toBe('rate_limited');
    clock.t += 600_000;
    expect(await refreshAihotDaily(db, { siteUrl: 'https://me.test', fetchFn, now })).toBe('skipped');
    expect(fetchFn).toHaveBeenCalledTimes(3);

    // Network failure retains cached daily report
    clock.t += 601_000;
    fetchFn.mockRejectedValueOnce(new Error('timeout'));
    expect(await refreshAihotDaily(db, { siteUrl: 'https://me.test', fetchFn, now })).toBe('error');
    expect((await (await app.request('/api/daily')).json()).report.date).toBe('2026-11-23');

    // Full replacement on 200: retracted items vanish
    fetchFn.mockResolvedValueOnce(
      json({
        report: {
          date: '2026-11-24',
          links: { aihot: 'https://aihot.news/daily/2026-11-24' },
          lead: { title: '次日头条', leadParagraph: '次日摘要' },
          sections: [],
          flashes: [],
        },
      }),
    );
    expect(await refreshAihotDaily(db, { siteUrl: 'https://me.test', fetchFn, now })).toBe('updated');
    const next = await (await app.request('/api/daily')).json();
    expect(next.report.date).toBe('2026-11-24');
    expect(next.report.sections).toEqual([]);
    expect(next.report.highlights).toEqual([]);

    // Older than 7 days: served empty and purged
    clock.t += 7 * 24 * 3600_000 + 1;
    const stale = await (await app.request('/api/daily')).json();
    expect(stale.report).toBeNull();
    expect(stale.updatedAt).toBeNull();
    purgeStaleAihotDaily(db, clock.t);
    const row = db.prepare('SELECT payload, etag FROM aihot_daily_cache WHERE id = 1').get() as {
      payload: string | null;
      etag: string | null;
    };
    expect(row.payload).toBeNull();
    expect(row.etag).toBeNull();

    warn.mockRestore();
  });
});
