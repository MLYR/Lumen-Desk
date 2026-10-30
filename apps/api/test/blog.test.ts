import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { renderMarkdown } from '../src/blog/render.js';
import { fillShell } from '../src/blog/pages.js';
import { importToInput } from '../src/blog/frontmatter.js';
import { makeSnippet } from '../src/blog/posts.js';
import { SECRET, sessionCookie, setup } from './helpers.js';

const ORIGIN = 'https://blog.test';

async function authed(start?: number) {
  const s = setup(start);
  const cookie = sessionCookie(await s.login(s.codeAt()));
  const req = (url: string, init: RequestInit = {}) =>
    s.app.request(url, { ...init, headers: { cookie, ...(init.headers as Record<string, string>) } });
  const send = (method: string, url: string, body: unknown, headers: Record<string, string> = {}) =>
    req(url, { method, headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: JSON.stringify(body) });
  const create = async (body: Record<string, unknown>) => {
    const res = await send('POST', '/api/private/posts', { markdown: '正文', status: 'published', ...body });
    expect(res.status).toBe(201);
    return (await res.json()) as Record<string, unknown> & { id: number; slug: string };
  };
  const upload = (url: string, form: FormData, headers: Record<string, string> = {}) =>
    req(url, { method: 'POST', body: form, headers: { origin: ORIGIN, ...headers } });
  return { ...s, cookie, req, send, create, upload };
}

describe('blog: private CRUD', () => {
  it('rejects every private blog route without a session', async () => {
    const { app } = setup();
    const calls: Array<[string, string]> = [
      ['GET', '/api/private/posts'],
      ['GET', '/api/private/posts/1'],
      ['POST', '/api/private/posts'],
      ['PUT', '/api/private/posts/1'],
      ['DELETE', '/api/private/posts/1'],
      ['POST', '/api/private/posts/import'],
      ['POST', '/api/private/preview'],
      ['POST', '/api/private/uploads'],
      ['GET', '/api/private/posts/export'],
    ];
    for (const [method, url] of calls) {
      const res = await app.request(url, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      expect(res.status, `${method} ${url}`).toBe(401);
    }
  });

  it('creates, reads, updates, lists and deletes', async () => {
    const { req, send, clock } = await authed();
    const res = await send('POST', '/api/private/posts', {
      title: 'Hello World',
      markdown: '# 标题\n\n第一段',
      status: 'draft',
      tags: ['部署', '前端', '部署'],
    });
    expect(res.status).toBe(201);
    const post = (await res.json()) as Record<string, unknown>;
    expect(post).toMatchObject({ slug: 'hello-world', title: 'Hello World', status: 'draft', tags: ['部署', '前端'], publishedAt: null, summary: '' });
    expect(post).not.toHaveProperty('html');

    const got = await req(`/api/private/posts/${post.id}`);
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual(post);

    clock.t += 60_000;
    const put = await send('PUT', `/api/private/posts/${post.id}`, { title: 'Hello World', markdown: '改过', status: 'published' });
    expect(put.status).toBe(200);
    const updated = (await put.json()) as Record<string, unknown>;
    expect(updated).toMatchObject({ slug: 'hello-world', markdown: '改过', status: 'published', publishedAt: new Date(clock.t).toISOString() });
    expect(updated.updatedAt).not.toBe(post.updatedAt);

    const list = (await (await req('/api/private/posts')).json()) as { items: unknown[] };
    expect(list.items).toEqual([
      { id: post.id, slug: 'hello-world', title: 'Hello World', status: 'published', tags: [], publishedAt: updated.publishedAt, updatedAt: updated.updatedAt },
    ]);

    expect((await req(`/api/private/posts/${post.id}`, { method: 'DELETE', headers: { origin: ORIGIN } })).status).toBe(204);
    expect((await req(`/api/private/posts/${post.id}`)).status).toBe(404);
    expect((await req(`/api/private/posts/${post.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await send('PUT', `/api/private/posts/${post.id}`, { title: 'x', markdown: '', status: 'draft' })).status).toBe(404);
  });

  it('keeps publishedAt across edits and accepts an explicit one', async () => {
    const { send, create, clock } = await authed();
    const p = await create({ title: 'A', publishedAt: '2025-05-01T00:00:00Z' });
    expect(p.publishedAt).toBe('2025-05-01T00:00:00.000Z');
    clock.t += 1000;
    const res = await send('PUT', `/api/private/posts/${p.id}`, { title: 'A', markdown: 'x', status: 'draft' });
    expect(((await res.json()) as Record<string, unknown>).publishedAt).toBe('2025-05-01T00:00:00.000Z');
  });

  it('generates slugs: ASCII title, date+n for Chinese titles, -2 on collision; explicit duplicate is 409', async () => {
    const { send, create } = await authed(Date.UTC(2026, 9, 29, 20, 0, 0)); // 2026-10-30 04:00 in UTC+8
    expect((await create({ title: '部署记录' })).slug).toBe('20261030-1');
    expect((await create({ title: '第二篇' })).slug).toBe('20261030-2');
    expect((await create({ title: 'Caddy + Docker 部署！' })).slug).toBe('caddy-docker');
    expect((await create({ title: 'caddy docker' })).slug).toBe('caddy-docker-2');
    const dup = await send('POST', '/api/private/posts', { title: 'x', slug: 'caddy-docker', markdown: '', status: 'draft' });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: 'slug_taken' });
    expect((await send('POST', '/api/private/posts', { title: 'x', slug: 'tags', markdown: '', status: 'draft' })).status).toBe(409);
    expect((await create({ title: 'Tags' })).slug).toBe('tags-2');
  });

  it('validates input', async () => {
    const { send } = await authed();
    const bad = [
      { title: '', markdown: '', status: 'draft' },
      { title: 'a'.repeat(201), markdown: '', status: 'draft' },
      { title: 'a', markdown: '', status: 'live' },
      { title: 'a', slug: 'Bad Slug', markdown: '', status: 'draft' },
      { title: 'a', markdown: 1, status: 'draft' },
      { title: 'a', markdown: '', status: 'draft', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) },
      { title: 'a', markdown: '', status: 'draft', tags: ['x'.repeat(31)] },
      { title: 'a', markdown: '', status: 'draft', publishedAt: 'not a date' },
      { title: 'a', markdown: '', status: 'draft', summary: 's'.repeat(501) },
      [],
    ];
    for (const b of bad) {
      const res = await send('POST', '/api/private/posts', b);
      expect(res.status, JSON.stringify(b).slice(0, 80)).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_request' });
    }
    const big = await send('POST', '/api/private/posts', { title: 'a', markdown: 'x'.repeat(1024 * 1024 + 1), status: 'draft' });
    expect(big.status).toBe(400);
  });

  it('checks Origin and Content-Type on writes', async () => {
    const { req, send, create } = await authed();
    const evil = await send('POST', '/api/private/posts', { title: 'a', markdown: '', status: 'draft' }, { origin: 'https://evil.test' });
    expect(evil.status).toBe(403);
    expect(await evil.json()).toEqual({ error: 'bad_origin' });
    expect((await send('POST', '/api/private/posts', { title: 'a', markdown: '', status: 'draft' }, { origin: 'null' })).status).toBe(403);

    // Origin matching the request Host is accepted too (IP access before the domain is live).
    const viaHost = await send('POST', 'http://203.0.113.1/api/private/posts', { title: 'a', markdown: '', status: 'draft' }, { origin: 'http://203.0.113.1', host: '203.0.113.1' });
    expect(viaHost.status).toBe(201);

    // No Origin header (curl, same-origin GET-ish clients) is allowed.
    const noOrigin = await req('/api/private/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'b', markdown: '', status: 'draft' }) });
    expect(noOrigin.status).toBe(201);

    const form = await req('/api/private/posts', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: ORIGIN },
      body: JSON.stringify({ title: 'a', markdown: '', status: 'draft' }),
    });
    expect(form.status).toBe(415);

    const p = await create({ title: 'del' });
    expect((await req(`/api/private/posts/${p.id}`, { method: 'DELETE', headers: { origin: 'https://evil.test' } })).status).toBe(403);
  });

  it('renders a preview', async () => {
    const { send } = await authed();
    const res = await send('POST', '/api/private/preview', { markdown: '**粗** <script>x</script>' });
    expect(res.status).toBe(200);
    const { html } = (await res.json()) as { html: string };
    expect(html).toContain('<strong>粗</strong>');
    expect(html).not.toContain('<script');
  });
});

describe('blog: rendering', () => {
  it('drops scripts, raw HTML and javascript: links', async () => {
    const html = await renderMarkdown(
      [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '<a href="javascript:alert(1)">raw</a>',
        '[js](javascript:alert(1)) [js2](JAVASCRIPT:alert(1)) [data](data:text/html,x) [proto](//evil.test/x)',
        '![img](javascript:alert(1))',
        '[ok](https://example.com) [rel](/blog/x/) [hash](#top) [mail](mailto:a@example.com)',
        '![pic](/uploads/abc.webp)',
      ].join('\n\n'),
    );
    // Only real tags/attributes matter; the same characters as escaped text are harmless.
    expect(html).not.toMatch(/<script|<[a-z]+[^>]*\s(?:href|src|onerror)="?(?:x|javascript|data|\/\/)/i);
    expect([...html.matchAll(/<(\w+)/g)].map((m) => m[1])).toEqual(['p', 'p', 'p', 'p', 'p', 'p', 'a', 'a', 'a', 'a', 'p', 'img']);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<a href="https://example.com" rel="noopener noreferrer" target="_blank">ok</a>');
    expect(html).toContain('<a href="/blog/x/">rel</a>');
    expect(html).toContain('<a href="#top">hash</a>');
    expect(html).toContain('<a href="mailto:a@example.com">mail</a>');
    expect(html).toContain('<img src="/uploads/abc.webp" alt="pic" loading="lazy" decoding="async" />');
  });

  it('highlights code with dual Shiki themes and treats unknown languages as text', async () => {
    const html = await renderMarkdown('```ts\nconst a = 1\n```\n\n```klingon\n<b>x</b>\n```');
    expect(html).toContain('<pre class="shiki shiki-themes github-light github-dark"');
    expect(html).toMatch(/style="--shiki-light:#[0-9A-Fa-f]+;--shiki-dark:#[0-9A-Fa-f]+"/);
    expect(html).not.toMatch(/style="[^"]*(?<!-)color:/);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('blog: public', () => {
  it('lists only published posts, newest first, with tag filter and limit', async () => {
    const { app, create } = await authed();
    await create({ title: 'old', tags: ['部署'], publishedAt: '2025-01-01T00:00:00Z', markdown: '旧文章正文' });
    await create({ title: 'new', tags: ['前端'], publishedAt: '2026-01-01T00:00:00Z', summary: '手写摘要' });
    await create({ title: 'secret draft', status: 'draft', tags: ['部署'] });

    const res = await app.request('/api/posts');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    const { items } = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(items).toEqual([
      { slug: 'new', title: 'new', summary: '手写摘要', tags: ['前端'], publishedAt: '2026-01-01T00:00:00.000Z' },
      { slug: 'old', title: 'old', summary: '旧文章正文', tags: ['部署'], publishedAt: '2025-01-01T00:00:00.000Z' },
    ]);
    expect(((await (await app.request('/api/posts?limit=1')).json()) as { items: unknown[] }).items).toHaveLength(1);
    const tagged = (await (await app.request(`/api/posts?tag=${encodeURIComponent('部署')}`)).json()) as { items: Array<{ slug: string }> };
    expect(tagged.items.map((i) => i.slug)).toEqual(['old']);
    expect((await app.request('/api/posts?limit=0')).status).toBe(400);
    expect((await app.request('/api/posts?limit=51')).status).toBe(400);
  });

  it('serves HTML pages in the shell, with and without trailing slash; drafts and unknown slugs are 404', async () => {
    const { app, create } = await authed();
    await create({ title: 'Hello <World>', slug: 'hello', tags: ['部署', 'a&b'], publishedAt: '2026-10-30T02:00:00Z', markdown: '正文 **粗**' });
    await create({ title: '草稿', slug: 'draft-post', status: 'draft' });

    for (const url of ['/blog/hello', '/blog/hello/']) {
      const res = await app.request(url);
      expect(res.status, url).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^text\/html/);
      expect(res.headers.get('cache-control')).toBe('public, max-age=60');
      const html = await res.text();
      expect(html).toContain('data-shell="fixture"');
      expect(html).toContain('<title>Hello &#60;World&#62; · 拾光台</title>');
      expect(html).toContain('<h1 class="post-title">Hello &#60;World&#62;</h1>');
      expect(html).toContain('<time datetime="2026-10-30">2026-10-30</time>');
      expect(html).toContain(`<a class="tag" href="/blog/tags/${encodeURIComponent('部署')}/">部署</a>`);
      expect(html).toContain('a&#38;b');
      expect(html).toContain('<div class="prose"><p>正文 <strong>粗</strong></p>');
    }

    for (const url of ['/blog/draft-post', '/blog/draft-post/', '/blog/missing', '/blog/a/b/c', '/blog/BAD']) {
      const res = await app.request(url);
      expect(res.status, url).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/^text\/html/);
      expect(await res.text()).not.toContain('草稿');
    }

    for (const url of ['/blog', '/blog/']) {
      const html = await (await app.request(url)).text();
      expect(html).toContain('<h1 class="page-title">博客</h1>');
      expect(html).toContain('<h2 class="year">2026</h2>');
      expect(html).toContain('<a href="/blog/hello/"><span class="d">10-30</span>');
      expect(html).not.toContain('draft-post');
      expect(html).not.toContain('class="empty"');
    }

    for (const url of [`/blog/tags/${encodeURIComponent('部署')}`, `/blog/tags/${encodeURIComponent('部署')}/`, `/blog/tags/${encodeURIComponent('a&b')}/`]) {
      const res = await app.request(url);
      expect(res.status, url).toBe(200);
      expect(await res.text()).toContain('/blog/hello/');
    }
    expect((await app.request(`/blog/tags/${encodeURIComponent('部署')}/`).then((r) => r.text()))).toContain('<h1 class="page-title">标签 · 部署</h1>');
    expect((await app.request('/blog/tags/nothing')).status).toBe(404);
  });

  it('shows the empty state and falls back to the built-in shell', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-api-'));
    const config = loadConfig({ DATA_DIR: dataDir, TOTP_SECRET: SECRET, SHELL_DIR: path.join(dataDir, 'nope') });
    const app = createApp({ config, db: openDb(':memory:') });
    const html = await (await app.request('/blog/')).text();
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<title>博客 · 拾光台</title>');
    expect(html).toContain('<p class="empty">还没有文章。</p>');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not found'));
    warn.mockRestore();
  });

  it('RSS and sitemap list only published posts and no private paths', async () => {
    const { app, create } = await authed();
    await create({ title: 'Pub & One', slug: 'pub', publishedAt: '2026-10-30T02:00:00Z', summary: '摘要 <b>' });
    await create({ title: 'Hidden', slug: 'hidden-draft', status: 'draft' });

    const rss = await app.request('/rss.xml');
    expect(rss.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8');
    const xml = await rss.text();
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<title>Pub &#38; One</title>');
    expect(xml).toContain('<link>https://blog.test/blog/pub/</link>');
    expect(xml).toContain('<description>摘要 &#60;b&#62;</description>');
    expect(xml).toContain('<pubDate>Fri, 30 Oct 2026 02:00:00 GMT</pubDate>');

    const sm = await (await app.request('/sitemap.xml')).text();
    expect(sm).toContain('<loc>https://blog.test/</loc>');
    expect(sm).toContain('<loc>https://blog.test/blog/</loc>');
    expect(sm).toContain('<loc>https://blog.test/blog/pub/</loc>');
    for (const body of [xml, sm]) {
      expect(body).not.toMatch(/hidden-draft|Hidden|\/login|\/console|\/api\/private/);
    }
  });

  it('search: trigram for ≥3 chars (Chinese substrings), LIKE for 2, published only', async () => {
    const { app, create, send } = await authed();
    await create({ title: '服务器部署记录', slug: 'deploy', markdown: '用 Caddy 和 Docker Compose 部署到轻量服务器上。' });
    await create({ title: 'Draft', slug: 'draft', status: 'draft', markdown: '轻量服务器的草稿' });
    const search = async (q: string) => {
      const res = await app.request(`/api/search?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
      return ((await res.json()) as { items: Array<{ slug: string; title: string; snippet: string }> }).items;
    };
    expect((await search('轻量服务')).map((i) => i.slug)).toEqual(['deploy']);
    expect((await search('部署记')).map((i) => i.slug)).toEqual(['deploy']);
    expect((await search('compose')).map((i) => i.slug)).toEqual(['deploy']);
    expect((await search('部署')).map((i) => i.slug)).toEqual(['deploy']);
    expect(await search('不存在的词')).toEqual([]);
    expect(await search('%_')).toEqual([]);
    expect(await search('"a" OR b*')).toEqual([]);
    const [hit] = await search('Docker');
    expect(hit!.snippet).toContain('Docker Compose');
    expect(hit!.snippet).not.toMatch(/</);

    expect((await app.request('/api/search?q=x')).status).toBe(400);
    expect((await app.request(`/api/search?q=${'x'.repeat(51)}`)).status).toBe(400);

    // The index follows updates.
    const created = await create({ title: 'Kubernetes 笔记', slug: 'k8s', markdown: '集群调度' });
    expect((await search('集群调度')).map((i) => i.slug)).toEqual(['k8s']);
    await send('PUT', `/api/private/posts/${created.id}`, { title: 'Kubernetes 笔记', slug: 'k8s', markdown: '换成别的', status: 'published' });
    expect(await search('集群调度')).toEqual([]);
  });
});

describe('blog: import / export', () => {
  it('imports .md files with frontmatter: draft by default, draft:false publishes', async () => {
    const { upload } = await authed();
    const form = new FormData();
    form.append('files', new File(['---\ntitle: 默认草稿\ntags: 部署, 前端\n---\n正文 A'], 'a.md'));
    form.append('files', new File(['---\ntitle: Published One\nslug: pub-one\ndate: 2026-10-30\ndraft: false\nsummary: 摘要\n---\n正文 B'], 'b.md'));
    form.append('files', new File(['---\npublished: true\n---\n# 从标题取\n\n正文 C'], 'c.md'));
    form.append('files', new File(['没有 frontmatter'], 'my-note.md'));
    form.append('files', new File(['---\ntitle: [unclosed\n---\nx'], 'bad.md'));
    const res = await upload('/api/private/posts/import', form);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { imported: Array<Record<string, unknown>>; errors: Array<Record<string, unknown>> };
    expect(out.imported.map(({ slug, title, status }) => ({ slug, title, status }))).toEqual([
      { slug: expect.stringMatching(/^\d{8}-1$/), title: '默认草稿', status: 'draft' },
      { slug: 'pub-one', title: 'Published One', status: 'published' },
      { slug: expect.stringMatching(/^\d{8}-2$/), title: '从标题取', status: 'published' },
      { slug: 'my-note', title: 'my-note', status: 'draft' },
    ]);
    expect(out.errors).toEqual([{ file: 'bad.md', error: 'invalid_request', message: expect.any(String) }]);
  });

  it('import reports slug conflicts and rejects bad requests', async () => {
    const { upload, create, send } = await authed();
    await create({ title: 'x', slug: 'taken' });
    const form = new FormData();
    form.append('files', new File(['---\nslug: taken\n---\nx'], 't.md'));
    const out = (await (await upload('/api/private/posts/import', form)).json()) as { errors: unknown[] };
    expect(out.errors).toEqual([{ file: 't.md', error: 'slug_taken', message: expect.any(String) }]);

    expect((await upload('/api/private/posts/import', new FormData())).status).toBe(400);
    expect((await send('POST', '/api/private/posts/import', {})).status).toBe(415);
    const tooMany = new FormData();
    for (let i = 0; i < 21; i++) tooMany.append('files', new File(['x'], `${i}.md`));
    expect((await upload('/api/private/posts/import', tooMany)).status).toBe(400);
  });

  it('exports a zip with one frontmatter .md per post that re-imports identically', async () => {
    const { req, create } = await authed();
    await create({ title: '中文标题', slug: 'zh', tags: ['部署'], summary: '摘要', publishedAt: '2026-10-30T02:00:00Z', markdown: '# 正文\n\n内容' });
    await create({ title: 'Draft: yes', slug: 'dr', status: 'draft', markdown: 'draft body' });
    const res = await req('/api/private/posts/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="lumen-desk-posts-\d{8}\.zip"$/);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['dr.md', 'zh.md']);
    const zh = strFromU8(files['zh.md']!);
    expect(zh).toMatch(/^---\n/);
    expect(zh).toContain('title: 中文标题');
    expect(zh).toContain('draft: false');
    expect(zh.endsWith('# 正文\n\n内容')).toBe(true);
    expect(strFromU8(files['dr.md']!)).toContain('draft: true');

    // Round trip into a fresh instance.
    const other = await authed();
    const form = new FormData();
    for (const [name, data] of Object.entries(files)) form.append('files', new File([strFromU8(data)], name));
    const out = (await (await other.upload('/api/private/posts/import', form)).json()) as { imported: Array<{ id: number }> };
    expect(out.imported).toHaveLength(2);
    const back = await Promise.all(out.imported.map(async (i) => (await other.req(`/api/private/posts/${i.id}`)).json()));
    const pick = (p: Record<string, unknown>) => ({ slug: p.slug, title: p.title, summary: p.summary, tags: p.tags, markdown: p.markdown, status: p.status, publishedAt: p.publishedAt });
    const orig = await Promise.all([1, 2].map(async (id) => (await req(`/api/private/posts/${id}`)).json()));
    expect(back.map((p) => pick(p as Record<string, unknown>))).toEqual(orig.map((p) => pick(p as Record<string, unknown>)));
  });
});

describe('blog: uploads', () => {
  const noisePng = (w: number, h: number) => {
    const raw = Buffer.alloc(w * h * 3);
    let x = 12345;
    for (let i = 0; i < raw.length; i++) {
      x = (x * 1103515245 + 12345) >>> 0;
      raw[i] = x >>> 24;
    }
    return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  };

  it('converts to webp ≤150KB, ≤1600px, content-addressed and world-readable', async () => {
    const { upload, dataDir } = await authed();
    // A smooth gradient: fits at full 1600px.
    const w = 2400;
    const h = 1200;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([(x * 255) / w, (y * 255) / h, 128], (y * w + x) * 3);
    const png = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const send = () => {
      const form = new FormData();
      // Misleading name: type comes from the bytes.
      form.append('file', new File([png], 'photo.txt', { type: 'text/plain' }));
      return upload('/api/private/uploads', form);
    };
    const res = await send();
    expect(res.status).toBe(200);
    const out = (await res.json()) as { url: string; width: number; height: number; bytes: number };
    expect(out.url).toMatch(/^\/uploads\/[0-9a-f]{16}\.webp$/);
    expect(out).toMatchObject({ width: 1600, height: 800 });
    expect(out.bytes).toBeLessThanOrEqual(150 * 1024);

    const file = path.join(dataDir, out.url);
    const meta = await sharp(file).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(fs.statSync(file).size).toBe(out.bytes);
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o644);
      expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o755);
    }

    const again = (await (await send()).json()) as { url: string };
    expect(again.url).toBe(out.url);
    expect(fs.readdirSync(path.dirname(file))).toEqual([path.basename(file)]);
  });

  it('shrinks incompressible images until they fit 150KB', async () => {
    const { upload } = await authed();
    const png = await noisePng(2400, 1200);
    expect(png.length).toBeGreaterThan(300 * 1024);
    const form = new FormData();
    form.append('file', new File([png], 'noise.png'));
    const out = (await (await upload('/api/private/uploads', form)).json()) as { width: number; height: number; bytes: number };
    expect(out.bytes).toBeLessThanOrEqual(150 * 1024);
    expect(out.width).toBeLessThan(1600);
    expect(out.width / out.height).toBeCloseTo(2, 1);
  });

  it('rejects non-images, bad origin and oversize bodies', async () => {
    const { upload } = await authed();
    const form = new FormData();
    form.append('file', new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'x.png', { type: 'image/png' }));
    const res = await upload('/api/private/uploads', form);
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: 'unsupported_media_type' });

    const tiny = new FormData();
    tiny.append('file', new File([await noisePng(8, 8)], 'a.png'));
    expect((await upload('/api/private/uploads', tiny, { origin: 'https://evil.test' })).status).toBe(403);

    expect((await upload('/api/private/uploads', new FormData())).status).toBe(400);

    const big = new FormData();
    big.append('file', new File([Buffer.alloc(10 * 1024 * 1024 + 1)], 'big.png'));
    expect((await upload('/api/private/uploads', big)).status).toBe(413);
  });
});

describe('blog: migration', () => {
  it('upgrades a pre-blog database and can run repeatedly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-db-'));
    const { DatabaseSync } = await import('node:sqlite');
    const old = new DatabaseSync(path.join(dir, 'lumen.db'));
    old.exec("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO kv VALUES ('k', 'v');");
    old.close();
    for (let i = 0; i < 2; i++) {
      const db = openDb(dir);
      expect(db.prepare("SELECT value FROM kv WHERE key = 'k'").get()).toEqual({ value: 'v' });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('posts', 'posts_fts') ORDER BY name").all()).toEqual([{ name: 'posts' }, { name: 'posts_fts' }]);
      db.close();
    }
  });
});

describe('blog: security regressions', () => {
  it('fillShell substitutes in one pass; placeholders in user text stay literal', async () => {
    const shell = '<title>{{LD_TITLE}}</title><meta content="{{LD_DESCRIPTION}}"><main>{{LD_CONTENT}}</main>';
    const out = fillShell(shell, 'T {{LD_CONTENT}} $&', 'D {{LD_DESCRIPTION}} {{LD_TITLE}}', '<p>BODY</p>');
    expect(out).toBe('<title>T {{LD_CONTENT}} $&#38;</title><meta content="D {{LD_DESCRIPTION}} {{LD_TITLE}}"><main><p>BODY</p></main>');
    expect(out.split('BODY')).toHaveLength(2);

    // Through the real page: title and summary containing placeholders.
    const { app, create } = await authed();
    await create({ title: '标题 {{LD_CONTENT}}', slug: 'ph', summary: '摘要 {{LD_DESCRIPTION}}', markdown: 'UNIQUE_BODY' });
    const html = await (await app.request('/blog/ph/')).text();
    expect(html).toContain('<title>标题 {{LD_CONTENT}} · 拾光台</title>');
    expect(html).toContain('content="摘要 {{LD_DESCRIPTION}}"');
    expect(html.split('UNIQUE_BODY')).toHaveLength(2);
  });

  it('title fallback regex is linear on pathological heading lines', () => {
    const line = `# a${' #'.repeat(100_000)} b`;
    expect(line.length).toBeGreaterThanOrEqual(200_000);
    const t0 = performance.now();
    const out = importToInput(`${line}\n\nbody`, 'x.md');
    expect(performance.now() - t0).toBeLessThan(200);
    expect(String(out.title).startsWith('a #')).toBe(true);

    const t1 = performance.now();
    importToInput(`#  ${'#'.repeat(200_000)}x`, 'y.md');
    importToInput(`# ${' \t#'.repeat(70_000)}`, 'z.md');
    expect(performance.now() - t1).toBeLessThan(200);
    expect(importToInput('# 标题 ##\n', 'a.md').title).toBe('标题');
  });

  it('skips Shiki for code blocks over 64 KB but still escapes them', async () => {
    const big = `<script>${'x'.repeat(64 * 1024)}</script>`;
    const html = await renderMarkdown(`\`\`\`ts\n${big}\n\`\`\``);
    expect(html.startsWith('<pre><code>&lt;script&gt;')).toBe(true);
    expect(html).not.toContain('shiki');
    expect(html).not.toContain('<script');
    const small = await renderMarkdown('```ts\nconst a = 1\n```');
    expect(small).toContain('class="shiki');
  });

  it('makeSnippet works on long bodies without scanning them', () => {
    const body = `${'前'.repeat(500_000)}命中关键词${'后'.repeat(500_000)}`;
    const t0 = performance.now();
    const s = makeSnippet(body, '命中关键词');
    expect(performance.now() - t0).toBeLessThan(50);
    expect(s).toBe(`…${'前'.repeat(30)}命中关键词${'后'.repeat(65)}…`);
    expect(makeSnippet('短文 Docker', 'docker')).toBe('短文 Docker');
    expect(makeSnippet('没有命中', '关键词')).toBe('没有命中');
    // Astral characters are never split into lone surrogates.
    expect(makeSnippet(`${'😀'.repeat(100)}x`, 'x')).toBe(`…${'😀'.repeat(30)}x`);
  });

  it('lists still show summaries from the truncated body column', async () => {
    const { app, create } = await authed();
    await create({ title: 'long', slug: 'long', markdown: '字'.repeat(5000) });
    const { items } = (await (await app.request('/api/posts')).json()) as { items: Array<{ summary: string }> };
    expect(items[0]!.summary).toBe(`${'字'.repeat(120)}…`);
  });

  it('rejects images over 24 megapixels with 413 payload_too_large', async () => {
    const { upload } = await authed();
    // 5000×5000 = 25 MP; a flat colour PNG is only a few KB.
    const png = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#808080' } }).png().toBuffer();
    expect(png.length).toBeLessThan(1024 * 1024);
    const form = new FormData();
    form.append('file', new File([png], 'huge.png'));
    const res = await upload('/api/private/uploads', form);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'payload_too_large' });
  });
});
