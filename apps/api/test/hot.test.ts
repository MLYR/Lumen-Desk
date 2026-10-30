import { describe, expect, it, vi } from 'vitest';
import { refreshAihot } from '../src/sources/aihot.js';
import { setup } from './helpers.js';

const payload = {
  schemaVersion: 1,
  count: 12,
  items: Array.from({ length: 12 }, (_, i) => ({
    rank: 12 - i,
    id: `id${i}`,
    title: `Topic ${12 - i}`,
    source: { name: 'src' },
    links: { aihot: `https://aihot.news/items/id${i}`, original: 'https://example.test/' },
    sourceCount: i,
    signalCount: 1,
    sourceNames: [],
    latestAt: '2026-01-01T00:00:00.000Z',
  })),
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });

describe('/api/hot', () => {
  it('is empty before any fetch', async () => {
    const { app } = setup();
    const res = await app.request('/api/hot');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await res.json()).toEqual({ items: [], updatedAt: null, source: { name: 'AIHOT', url: 'https://aihot.news' } });
  });

  it('maps AIHOT items, caps at 10, and handles ETag / 304 / 429 / errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, db, clock } = setup();
    const now = () => clock.t;
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(json(payload, { headers: { etag: 'W/"v1"' } }));

    expect(await refreshAihot(db, { siteUrl: 'https://me.test', fetchFn, now })).toBe('updated');
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://aihot.news/api/v1/hot-topics');
    const h = init!.headers as Record<string, string>;
    expect(h['User-Agent']).toBe('lumen-desk/1.0 (+https://me.test)');
    expect(h['Accept-Encoding']).toBe('gzip');
    expect(h['If-None-Match']).toBeUndefined();

    const body = await (await app.request('/api/hot')).json();
    expect(body.items).toHaveLength(10);
    expect(body.items[0]).toEqual({ rank: 1, title: 'Topic 1', sourceCount: 11, url: 'https://aihot.news/items/id11' });
    expect(body.items.map((i: { rank: number }) => i.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(body.updatedAt).toBe(new Date(clock.t).toISOString());
    expect(body.source).toEqual({ name: 'AIHOT', url: 'https://aihot.news' });

    // 304: sends ETag, keeps items, bumps updatedAt
    clock.t += 600_000;
    fetchFn.mockResolvedValueOnce(new Response(null, { status: 304 }));
    expect(await refreshAihot(db, { siteUrl: 'https://me.test', fetchFn, now })).toBe('not_modified');
    expect((fetchFn.mock.calls[1]![1]!.headers as Record<string, string>)['If-None-Match']).toBe('W/"v1"');
    const after304 = await (await app.request('/api/hot')).json();
    expect(after304.items).toHaveLength(10);
    expect(after304.updatedAt).toBe(new Date(clock.t).toISOString());

    // 429: honors Retry-After, skips until then
    fetchFn.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '1200' } }));
    expect(await refreshAihot(db, { siteUrl: 'x', fetchFn, now })).toBe('rate_limited');
    clock.t += 600_000;
    expect(await refreshAihot(db, { siteUrl: 'x', fetchFn, now })).toBe('skipped');
    expect(fetchFn).toHaveBeenCalledTimes(3);

    // network failure keeps the last cache
    clock.t += 601_000;
    fetchFn.mockRejectedValueOnce(new Error('boom'));
    expect(await refreshAihot(db, { siteUrl: 'x', fetchFn, now })).toBe('error');
    expect((await (await app.request('/api/hot')).json()).items).toHaveLength(10);

    // full replacement on 200: retracted items disappear
    fetchFn.mockResolvedValueOnce(json({ items: [payload.items[11]] }));
    await refreshAihot(db, { siteUrl: 'x', fetchFn, now });
    expect((await (await app.request('/api/hot')).json()).items).toEqual([
      { rank: 1, title: 'Topic 1', sourceCount: 11, url: 'https://aihot.news/items/id11' },
    ]);

    // older than 7 days: served empty
    clock.t += 7 * 24 * 3600_000 + 1;
    const stale = await (await app.request('/api/hot')).json();
    expect(stale.items).toEqual([]);
    expect(stale.updatedAt).toBeNull();
    warn.mockRestore();
  });
});
