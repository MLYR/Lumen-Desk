import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';
import { exportBookmarksHtml, MAX_DEPTH, MAX_ITEMS, parseBookmarksHtml } from '../src/bookmarks/netscape.js';
import { exportTree, getTree, migrateLegacyFile } from '../src/bookmarks/store.js';
import { authed, ORIGIN, setup } from './helpers.js';

// Synthetic data only (test/fixtures/). Never real bookmarks.
const fx = (name: string) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'bookmarks', `${name}.html`), 'utf8');
type Json = Record<string, any>;
const j = async (res: Response | Promise<Response>) => (await (await res).json()) as Json;

async function withBookmarks(file = 'chrome', mode = 'replace', start?: number) {
  const s = await authed(start);
  const form = new FormData();
  form.append('file', new File([fx(file)], `${file}.html`, { type: 'text/html' }));
  form.append('mode', mode);
  const res = await s.upload('/api/private/bookmarks/import', form);
  if (res.status !== 200) throw new Error(`import failed ${res.status} ${await res.text()}`);
  const tree = async () => (await j(s.req('/api/private/bookmarks'))) as unknown as Json[];
  const find = async (name: string) => {
    const walk = (ns: Json[]): Json | undefined => {
      for (const n of ns) {
        if (n.name === name) return n;
        const c = walk(n.children ?? []);
        if (c) return c;
      }
    };
    return walk(await tree());
  };
  return { ...s, tree, find, importResult: await j(res) };
}

describe('bookmarks: parser', () => {
  it('reads Chrome, Firefox and Safari exports', () => {
    const chrome = parseBookmarksHtml(fx('chrome'));
    expect(chrome.map((f) => f.name)).toEqual(['工作 & 学习', '空文件夹', '稍后阅读', '未分类']);
    const work = chrome[0]!;
    expect(work.addDate).toBe(1700000001);
    expect(work.links.map((l) => [l.title, l.url])).toEqual([
      ['文档 "引号" & <尖括号>', 'https://docs.example.test/search?q=a&lang="zh"'],
      ['浏览器设置', 'chrome://settings/'],
      ['小书签', 'javascript:(function(){alert("hi")})()'],
    ]);
    expect(work.folders[0]!.folders[0]!.folders[0]!.links[0]).toEqual({ title: '深层 <b> 链接', url: 'https://deep.example.test/a?x=1&y=2', addDate: 1700000009 });
    expect(chrome[3]!.links.map((l) => l.title)).toEqual(['书签栏上的散链接']);

    // Firefox: ICON/LAST_CHARSET/TAGS ignored, <DD> and <HR> skipped, toolbar + unfiled flattened.
    const ff = parseBookmarksHtml(fx('firefox'));
    expect(ff.map((f) => f.name)).toEqual(['开发 <Dev>', '未分类']);
    expect(ff[0]!.links).toEqual([{ title: 'Dev & Tools', url: 'https://dev.example.test/?a=1&b=2', addDate: 1600000006 }]);
    expect(ff[1]!.links.map((l) => l.title)).toEqual(['菜单里的链接', 'Other 链接']);

    // Safari: no ADD_DATE anywhere, Favorites flattened.
    const sf = parseBookmarksHtml(fx('safari'));
    expect(sf.map((f) => f.name)).toEqual(['阅读 "清单"', '未分类']);
    expect(sf[0]!.folders[0]!.links[0]).toEqual({ title: 'Safari & 子链接', url: 'https://sub.example.test/?q=a&b=c', addDate: null });
    expect(sf[1]!.links.map((l) => l.title)).toEqual(['根目录散链接', '个人收藏链接']);
  });

  it('is linear on 5 MiB of hostile input', () => {
    const inputs = [
      '<DT><A '.repeat(Math.ceil((5 * 1024 * 1024) / 8)),
      `<DL><p><DT><A HREF="${'x'.repeat(5 * 1024 * 1024)}`,
      `<DL><p><DT><H3>${'&amp'.repeat(1024 * 1024)}`,
      '<A HREF=x>'.repeat(500_000).slice(0, 5 * 1024 * 1024),
      `<!--${'-'.repeat(5 * 1024 * 1024)}`,
      `<DT><A HREF="a" ${'B="'.repeat(1_700_000)}`,
    ];
    for (const s of inputs) {
      const t0 = performance.now();
      try {
        parseBookmarksHtml(s);
      } catch {
        // over the item limit is fine; it must just be fast
      }
      expect(performance.now() - t0, s.slice(0, 20)).toBeLessThan(1000);
    }
  });

  it('limits depth to 32 and items to 20000', () => {
    const nest = (d: number) => `<DL><p>${'<DT><H3>f</H3><DL><p>'.repeat(d)}<DT><A HREF="https://x.example.test/">x</A>${'</DL><p>'.repeat(d)}</DL><p>`;
    expect(() => parseBookmarksHtml(nest(MAX_DEPTH))).not.toThrow();
    expect(() => parseBookmarksHtml(nest(MAX_DEPTH + 1))).toThrow(/32/);
    const many = (n: number) => `<DL><p><DT><H3>f</H3><DL><p>${'<DT><A HREF="https://x.example.test/">x</A>'.repeat(n)}</DL><p></DL><p>`;
    expect(() => parseBookmarksHtml(many(MAX_ITEMS - 1))).not.toThrow();
    expect(() => parseBookmarksHtml(many(MAX_ITEMS))).toThrow(/20000/);
  });

  it('skips links without a usable href and caps long titles', () => {
    const out = parseBookmarksHtml(
      `<DL><p><DT><H3>f</H3><DL><p><DT><A>no href</A><DT><A HREF="">empty</A><DT><A HREF="https://a.example.test/&#10;x">ctl</A><DT><A HREF="https://ok.example.test/"></A><DT><A HREF="https://t.example.test/">${'长'.repeat(400)}</A></DL><p></DL><p>`,
    );
    expect(out[0]!.links.map((l) => l.url)).toEqual(['https://ok.example.test/', 'https://t.example.test/']);
    expect(out[0]!.links[0]!.title).toBe('https://ok.example.test/');
    expect([...out[0]!.links[1]!.title]).toHaveLength(300);
  });
});

describe('bookmarks: export', () => {
  it('matches the contract format exactly', async () => {
    const { req } = await withBookmarks('chrome', 'replace', Date.UTC(2026, 9, 30, 20, 0, 0)); // 2026-10-31 in UTC+8
    const res = await req('/api/private/bookmarks/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="bookmarks_2026_10_31.html"');
    const html = await res.text();
    const lines = html.split('\n');
    expect(lines.slice(0, 10)).toEqual([
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<!-- This is an automatically generated file.',
      '     It will be read and overwritten.',
      '     DO NOT EDIT! -->',
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      '<TITLE>Bookmarks</TITLE>',
      '<H1>Bookmarks</H1>',
      '<DL><p>',
      '    <DT><H3 ADD_DATE="1700000001" LAST_MODIFIED="1793390400" PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>',
      '    <DL><p>',
    ]);
    expect(html).not.toContain('\r');
    expect(html.endsWith('    </DL><p>\n</DL><p>\n')).toBe(true);
    expect(html).toContain('        <DT><H3 ADD_DATE="1700000001" LAST_MODIFIED="1700000002">工作 &amp; 学习</H3>\n        <DL><p>');
    expect(html).toContain('            <DT><A HREF="https://docs.example.test/search?q=a&amp;lang=&quot;zh&quot;" ADD_DATE="1700000011">文档 &quot;引号&quot; &amp; &lt;尖括号&gt;</A>');
    expect(html).toContain('<DT><A HREF="chrome://settings/" ADD_DATE="1700000012">浏览器设置</A>');
    expect(html).toContain('<DT><A HREF="javascript:(function(){alert(&quot;hi&quot;)})()" ADD_DATE="1700000013">小书签</A>');
    expect(html).toContain('                        <DT><A HREF="https://deep.example.test/a?x=1&amp;y=2" ADD_DATE="1700000009">深层 &lt;b&gt; 链接</A>');
    fs.writeFileSync('/tmp/p28-sample-export.html', html);
  });

  it('round trip: export → parse → export is byte-identical; structure survives import', async () => {
    for (const f of ['chrome', 'firefox', 'safari']) {
      const { req } = await withBookmarks(f);
      const first = await (await req('/api/private/bookmarks/export')).text();
      const again = exportBookmarksHtml(
        parseBookmarksHtml(first).map(function fill(x): any {
          return { name: x.name, addDate: x.addDate!, lastModified: x.lastModified!, folders: x.folders.map(fill), links: x.links.map((l) => ({ ...l, addDate: l.addDate! })) };
        }),
        0,
      );
      expect(again, f).toBe(first);

      // And through the API: import the export into a fresh instance and export again.
      const other = await authed();
      const form = new FormData();
      form.append('file', new File([first], 'b.html'));
      expect((await other.upload('/api/private/bookmarks/import', form)).status).toBe(200);
      expect(await (await other.req('/api/private/bookmarks/export')).text(), f).toBe(first);
    }
  });

  it('chrome sample: folders, titles, urls, order unchanged after import + export', async () => {
    const { req } = await withBookmarks('chrome');
    const strip = (fs: any[]): any[] => fs.map((f) => ({ name: f.name, folders: strip(f.folders), links: f.links.map((l: any) => [l.title, l.url]) }));
    const exported = await (await req('/api/private/bookmarks/export')).text();
    expect(strip(parseBookmarksHtml(exported))).toEqual(strip(parseBookmarksHtml(fx('chrome'))));
  });
});

describe('bookmarks: API tree', () => {
  it('keeps the legacy shape (name, children, links) and adds id and items', async () => {
    const { tree } = await withBookmarks('chrome');
    const t = await tree();
    const work = t[0]!;
    expect(Object.keys(work).sort()).toEqual(['children', 'id', 'items', 'links', 'name']);
    expect(work.links).toEqual([
      ['文档 "引号" & <尖括号>', 'https://docs.example.test/search?q=a&lang="zh"'],
      ['浏览器设置', 'chrome://settings/'],
      ['小书签', 'javascript:(function(){alert("hi")})()'],
    ]);
    expect(work.items.map((i: Json) => i.title)).toEqual(work.links.map((l: string[]) => l[0]));
    expect(work.items[0]).toEqual({ id: expect.any(Number), title: '文档 "引号" & <尖括号>', url: 'https://docs.example.test/search?q=a&lang="zh"' });
    // empty folder: no children/links keys, items []
    expect(t[1]).toEqual({ id: expect.any(Number), name: '空文件夹', items: [] });
  });

  it('404 no_bookmarks when empty; 401 without a session', async () => {
    const { req } = await authed();
    const res = await req('/api/private/bookmarks');
    expect(res.status).toBe(404);
    expect(await j(res)).toEqual({ error: 'no_bookmarks' });
    const { app } = setup();
    for (const [m, u] of [
      ['GET', '/api/private/bookmarks'],
      ['POST', '/api/private/bookmarks/folders'],
      ['PUT', '/api/private/bookmarks/folders/1'],
      ['DELETE', '/api/private/bookmarks/folders/1'],
      ['POST', '/api/private/bookmarks/links'],
      ['PUT', '/api/private/bookmarks/links/1'],
      ['DELETE', '/api/private/bookmarks/links/1'],
      ['PUT', '/api/private/bookmarks/order'],
      ['POST', '/api/private/bookmarks/import'],
      ['GET', '/api/private/bookmarks/export'],
      ['GET', '/api/private/bookmarks/snapshots'],
      ['POST', '/api/private/bookmarks/snapshots'],
      ['POST', '/api/private/bookmarks/snapshots/1/restore'],
    ] as const) {
      expect((await app.request(u, { method: m })).status, `${m} ${u}`).toBe(401);
    }
  });
});

describe('bookmarks: CRUD', () => {
  it('folders and links: create, rename, move, delete', async () => {
    const { send, req, find } = await withBookmarks('chrome');
    const top = await j(send('POST', '/api/private/bookmarks/folders', { name: '新 <文件夹>', parentId: null }));
    expect(top).toMatchObject({ name: '新 <文件夹>', parentId: null });
    const sub = await send('POST', '/api/private/bookmarks/folders', { name: '子', parentId: top.id });
    expect(sub.status).toBe(201);
    const subF = await j(sub);

    const l = await send('POST', '/api/private/bookmarks/links', { folderId: subF.id, title: '', url: 'javascript:void(0)' });
    expect(l.status).toBe(201);
    const link = await j(l);
    expect(link).toMatchObject({ folderId: subF.id, title: 'javascript:void(0)', url: 'javascript:void(0)' });

    const upd = await j(send('PUT', `/api/private/bookmarks/links/${link.id}`, { title: '改名 & 移动', folderId: top.id }));
    expect(upd).toMatchObject({ title: '改名 & 移动', folderId: top.id, url: 'javascript:void(0)' });
    expect((await find('新 <文件夹>'))!.links).toEqual([['改名 & 移动', 'javascript:void(0)']]);

    expect(await j(send('PUT', `/api/private/bookmarks/folders/${subF.id}`, { name: '子2', parentId: null }))).toMatchObject({ name: '子2', parentId: null });

    expect((await req(`/api/private/bookmarks/links/${link.id}`, { method: 'DELETE', headers: { origin: ORIGIN } })).status).toBe(204);
    expect((await req(`/api/private/bookmarks/links/${link.id}`, { method: 'DELETE', headers: { origin: ORIGIN } })).status).toBe(404);

    const work = (await find('工作 & 学习'))!;
    const del = await req(`/api/private/bookmarks/folders/${work.id}`, { method: 'DELETE', headers: { origin: ORIGIN } });
    expect(del.status).toBe(204);
    expect(del.headers.get('x-deleted-count')).toBe('5');
    expect(await find('工作 & 学习')).toBeUndefined();
    expect(await find('L4 深层')).toBeUndefined();
  });

  it('validates input', async () => {
    const { send, find } = await withBookmarks('chrome');
    const f = (await find('空文件夹'))!;
    const bad: Array<[string, string, unknown]> = [
      ['POST', '/api/private/bookmarks/folders', { name: '', parentId: null }],
      ['POST', '/api/private/bookmarks/folders', { name: 'x'.repeat(101), parentId: null }],
      ['POST', '/api/private/bookmarks/folders', { name: 'a\u0007b', parentId: null }],
      ['POST', '/api/private/bookmarks/folders', { name: 'a', parentId: 99999 }],
      ['POST', '/api/private/bookmarks/links', { folderId: f.id, title: 't', url: '' }],
      ['POST', '/api/private/bookmarks/links', { folderId: f.id, title: 't', url: `https://x.test/${'a'.repeat(2048)}` }],
      ['POST', '/api/private/bookmarks/links', { folderId: f.id, title: 't', url: 'https://x.test/\n' + 'x' }],
      ['POST', '/api/private/bookmarks/links', { folderId: f.id, title: 'x'.repeat(301), url: 'https://x.test/' }],
      ['POST', '/api/private/bookmarks/links', { folderId: f.id, title: 'a\tb', url: 'https://x.test/' }],
      ['POST', '/api/private/bookmarks/links', { folderId: 99999, title: 't', url: 'https://x.test/' }],
      ['PUT', '/api/private/bookmarks/links/1', { folderId: 99999 }],
    ];
    for (const [m, u, b] of bad) expect((await send(m, u, b)).status, JSON.stringify(b).slice(0, 60)).toBe(400);
    // Any scheme is stored as-is.
    for (const url of ['chrome://flags', 'file:///etc/hosts', 'about:blank', 'javascript:alert(1)']) {
      expect((await send('POST', '/api/private/bookmarks/links', { folderId: f.id, title: 't', url })).status, url).toBe(201);
    }
    expect((await send('PUT', '/api/private/bookmarks/folders/99999', { name: 'x' })).status).toBe(404);
    expect((await send('POST', '/api/private/bookmarks/folders', { name: 'x', parentId: null }, { origin: 'https://evil.test' })).status).toBe(403);
  });

  it('refuses to move a folder into itself or a descendant', async () => {
    const { send, find } = await withBookmarks('chrome');
    const work = (await find('工作 & 学习'))!;
    const l3 = (await find('L3'))!;
    const l4 = (await find('L4 深层'))!;
    for (const target of [work.id, l3.id, l4.id]) {
      const res = await send('PUT', `/api/private/bookmarks/folders/${work.id}`, { parentId: target });
      expect(res.status).toBe(400);
      expect((await j(res)).error).toBe('invalid_move');
    }
    const l2 = (await find('L2'))!;
    expect((await send('PUT', `/api/private/bookmarks/folders/${l3.id}`, { parentId: l2.id })).status).toBe(200); // same parent, no-op
    expect((await send('PUT', `/api/private/bookmarks/folders/${l4.id}`, { parentId: null })).status).toBe(200);
    expect((await find('L4 深层'))).toBeDefined();
  });

  it('order needs exactly the folder children; /order and fixed paths are not taken by :id', async () => {
    const { send, find } = await withBookmarks('chrome');
    const work = (await find('工作 & 学习'))!;
    const linkIds = work.items.map((i: Json) => i.id);
    const folderIds = work.children.map((c: Json) => c.id);
    expect((await send('PUT', '/api/private/bookmarks/order', { folderId: work.id, folders: folderIds, links: [...linkIds].reverse() })).status).toBe(204);
    expect((await find('工作 & 学习'))!.links.map((l: string[]) => l[0])).toEqual(['小书签', '浏览器设置', '文档 "引号" & <尖括号>']);
    for (const links of [linkIds.slice(1), [...linkIds, linkIds[0]], [...linkIds.slice(1), 99999], [linkIds[0], linkIds[0], linkIds[1]]]) {
      expect((await send('PUT', '/api/private/bookmarks/order', { folderId: work.id, folders: folderIds, links })).status, JSON.stringify(links)).toBe(400);
    }
    expect((await send('PUT', '/api/private/bookmarks/order', { folderId: work.id, folders: [], links: linkIds })).status).toBe(400);
  });

  it('reorders top-level folders with folderId null', async () => {
    const { send, tree } = await withBookmarks('chrome');
    const ids = (await tree()).map((n) => n.id as number);
    expect((await send('PUT', '/api/private/bookmarks/order', { folderId: null, folders: [...ids].reverse(), links: [] })).status).toBe(204);
    expect((await tree()).map((n) => n.name)).toEqual(['未分类', '稍后阅读', '空文件夹', '工作 & 学习']);
    expect((await send('PUT', '/api/private/bookmarks/order', { folderId: null, folders: ids.slice(1) })).status).toBe(400);
  });
});

describe('bookmarks: import modes and snapshots', () => {
  it('merge puts the file under「导入 YYYY-MM-DD」; replace swaps everything; both snapshot first', async () => {
    const s = await withBookmarks('chrome', 'replace', Date.UTC(2026, 9, 30, 20, 0, 0));
    const form = new FormData();
    form.append('file', new File([fx('safari')], 's.html'));
    form.append('mode', 'merge');
    expect(await j(s.upload('/api/private/bookmarks/import', form))).toEqual({ folders: 3, links: 3 });
    const names = (await s.tree()).map((n) => n.name);
    expect(names).toEqual(['工作 & 学习', '空文件夹', '稍后阅读', '未分类', '导入 2026-10-31']);
    expect((await s.find('导入 2026-10-31'))!.children.map((c: Json) => c.name)).toEqual(['阅读 "清单"', '未分类']);

    const snaps = (await j(s.req('/api/private/bookmarks/snapshots'))).items as Json[];
    expect(snaps.map((x) => x.reason)).toEqual(['import', 'import']);
    expect(snaps[0]!.count).toBe(8);

    const rep = new FormData();
    rep.append('file', new File([fx('firefox')], 'f.html'));
    expect(await j(s.upload('/api/private/bookmarks/import', rep))).toEqual({ folders: 2, links: 3 });
    expect((await s.tree()).map((n) => n.name)).toEqual(['开发 <Dev>', '未分类']);
  });

  it('rejects bad imports and leaves data alone', async () => {
    const s = await withBookmarks('chrome');
    const before = await s.tree();
    const up = (body: string, extra: Record<string, string> = {}) => {
      const form = new FormData();
      form.append('file', new File([body], 'x.html'));
      for (const [k, v] of Object.entries(extra)) form.append(k, v);
      return s.upload('/api/private/bookmarks/import', form);
    };
    expect((await up('<html>nothing</html>')).status).toBe(400);
    expect((await up(fx('chrome'), { mode: 'append' })).status).toBe(400);
    expect((await up(`<DL><p>${'<DT><H3>f</H3><DL><p>'.repeat(40)}<DT><A HREF="https://x.test/">x</A>`)).status).toBe(400);
    expect((await s.upload('/api/private/bookmarks/import', new FormData())).status).toBe(400);
    const big = new FormData();
    big.append('file', new File([Buffer.alloc(5 * 1024 * 1024 + 1, 32)], 'big.html'));
    expect((await s.upload('/api/private/bookmarks/import', big)).status).toBe(413);
    const bin = new FormData();
    bin.append('file', new File([Buffer.from([0xff, 0xfe, 0x00])], 'b.html'));
    expect((await s.upload('/api/private/bookmarks/import', bin)).status).toBe(400);
    expect(await s.tree()).toEqual(before);
  });

  it('manual snapshot, keep at most 10, restore saves first and restores atomically', async () => {
    const s = await withBookmarks('chrome');
    const created = await s.send('POST', '/api/private/bookmarks/snapshots', {});
    expect(created.status).toBe(201);
    const snap = await j(created);
    expect(snap).toMatchObject({ reason: 'manual', count: 8 });

    // Change things, then restore.
    const work = (await s.find('工作 & 学习'))!;
    await s.req(`/api/private/bookmarks/folders/${work.id}`, { method: 'DELETE', headers: { origin: ORIGIN } });
    expect(await s.find('工作 & 学习')).toBeUndefined();
    const res = await s.send('POST', `/api/private/bookmarks/snapshots/${snap.id}/restore`, {});
    expect(res.status).toBe(200);
    expect(await j(res)).toEqual({ folders: 7, links: 8 });
    expect(await s.find('L4 深层')).toBeDefined();
    const items = (await j(s.req('/api/private/bookmarks/snapshots'))).items as Json[];
    expect(items[0]).toMatchObject({ reason: 'restore', count: 3 });

    for (let i = 0; i < 12; i++) {
      s.clock.t += 1000;
      await s.send('POST', '/api/private/bookmarks/snapshots', {});
    }
    expect(((await j(s.req('/api/private/bookmarks/snapshots'))).items as Json[]).length).toBe(10);
    expect((await s.send('POST', '/api/private/bookmarks/snapshots/99999/restore', {})).status).toBe(404);
    expect((await s.send('POST', `/api/private/bookmarks/snapshots/${snap.id}/restore`, {}, { origin: 'https://evil.test' })).status).toBe(403);
  });

  it('deleting a folder with over 20 links snapshots first', async () => {
    const s = await authed();
    const f = await j(s.send('POST', '/api/private/bookmarks/folders', { name: 'big', parentId: null }));
    for (let i = 0; i < 21; i++) await s.send('POST', '/api/private/bookmarks/links', { folderId: f.id, title: `t${i}`, url: `https://x.example.test/${i}` });
    const small = await j(s.send('POST', '/api/private/bookmarks/folders', { name: 'small', parentId: null }));
    await s.req(`/api/private/bookmarks/folders/${small.id}`, { method: 'DELETE', headers: { origin: ORIGIN } });
    expect((await j(s.req('/api/private/bookmarks/snapshots'))).items).toEqual([]);
    const del = await s.req(`/api/private/bookmarks/folders/${f.id}`, { method: 'DELETE', headers: { origin: ORIGIN } });
    expect(del.headers.get('x-deleted-count')).toBe('21');
    expect(((await j(s.req('/api/private/bookmarks/snapshots'))).items as Json[]).map((x) => x.reason)).toEqual(['bulk-delete']);
  });
});

describe('bookmarks: migration from bookmarks.json', () => {
  const legacy = [
    { name: 'A & <b>', children: [{ name: 'A1', links: [['t1', 'https://a1.example.test/?x=1&y=2']] }], links: [['t0', 'https://a.example.test/']] },
    { name: 'B', links: [['', 'chrome://version'], ['t3', 'javascript:void(0)']] },
  ];
  const quiet: string[] = [];
  const log = (m: string) => quiet.push(m);

  it('imports once, renames the file, never re-imports; logs counts only', () => {
    const { dataDir } = setup();
    const file = path.join(dataDir, 'bookmarks.json');
    fs.writeFileSync(file, JSON.stringify(legacy));
    const db = openDb(':memory:');
    quiet.length = 0;
    expect(migrateLegacyFile(db, dataDir, Date.UTC(2026, 9, 30), log)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(`${file}.migrated`)).toBe(true);
    expect(quiet).toEqual(['[bookmarks] migrated 3 folders and 4 links from bookmarks.json']);
    expect(getTree(db).map((n) => [n.name, n.links, n.children?.map((c) => c.name)])).toEqual([
      ['A & <b>', [['t0', 'https://a.example.test/']], ['A1']],
      ['B', [['chrome://version', 'chrome://version'], ['t3', 'javascript:void(0)']], undefined],
    ]);
    // Old file had no dates: export uses migration time.
    expect(exportTree(db)[0]!.links[0]!.addDate).toBe(Date.UTC(2026, 9, 30) / 1000);

    // Second start: file is gone; even if it came back, a non-empty table wins.
    fs.writeFileSync(file, JSON.stringify(legacy));
    quiet.length = 0;
    expect(migrateLegacyFile(db, dataDir, Date.now(), log)).toBe(false);
    expect(getTree(db)).toHaveLength(2);
    expect(fs.existsSync(file)).toBe(true);
    for (const m of quiet) expect(m).not.toMatch(/example\.test|t0|A1/);
  });

  it('rolls back and keeps the file when anything fails', () => {
    const { dataDir } = setup();
    const file = path.join(dataDir, 'bookmarks.json');
    fs.writeFileSync(file, '{not json');
    const db = openDb(':memory:');
    quiet.length = 0;
    expect(migrateLegacyFile(db, dataDir, Date.now(), log)).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('{not json');
    expect(quiet[0]).toMatch(/could not be read.*left in place/);

    // Valid JSON but the insert fails midway (a trigger aborts the 2nd folder): nothing stays.
    fs.writeFileSync(file, JSON.stringify(legacy));
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON bookmark_folders WHEN NEW.name = 'A1' BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    expect(migrateLegacyFile(db, dataDir, Date.now(), log)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bookmark_folders').get()).toEqual({ n: 0 });
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(`${file}.migrated`)).toBe(false);
  });

  it('no file: nothing happens', () => {
    const { dataDir } = setup();
    expect(migrateLegacyFile(openDb(':memory:'), dataDir, Date.now(), log)).toBe(false);
  });
});

describe('bookmarks: security review round 4', () => {
  it('a single field of 1M entities parses without blowing up memory', () => {
    const html = `<DL><p><DT><H3>${'&amp;'.repeat(1_000_000)}</H3><DL><p><DT><A HREF="${'&amp;'.repeat(1_000_000)}">t</A></DL><p></DL><p>`;
    const before = process.memoryUsage().heapUsed;
    const t = Date.now();
    const tree = parseBookmarksHtml(html);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(80 * 1024 * 1024);
    expect([...tree[0]!.name].length).toBeLessThanOrEqual(100);
    expect(tree[0]!.links).toEqual([]); // the oversized url is dropped
  });

  it('never re-imports bookmarks.json after a migration, even if the file is back and the tree is empty', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-bm-'));
    const legacy = JSON.stringify([{ name: 'F', links: [['a', 'https://a.example.test/']] }]);
    fs.writeFileSync(path.join(dir, 'bookmarks.json'), legacy);
    const db = openDb(dir);
    expect(migrateLegacyFile(db, dir, Date.now(), () => {})).toBe(true);
    db.exec('DELETE FROM bookmark_folders');
    fs.writeFileSync(path.join(dir, 'bookmarks.json'), legacy); // e.g. the rename had failed
    expect(migrateLegacyFile(db, dir, Date.now(), () => {})).toBe(false);
    expect(getTree(db)).toEqual([]);
  });
});
