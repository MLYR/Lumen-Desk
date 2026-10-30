import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db.js';
import { authed, ORIGIN, sessionCookie, setup } from './helpers.js';

type Json = Record<string, any>;
const j = async (res: Response | Promise<Response>) => (await (await res).json()) as Json;

describe('taxonomy: migration', () => {
  it('seeds built-ins once; deleted ones stay deleted; old posts get category_id NULL and their tags in the vocabulary', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-tax-'));
    // A pre-P2.5 database: posts table without category_id, with a tag not in the built-ins.
    const old = new DatabaseSync(path.join(dir, 'lumen.db'));
    old.exec(`CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]', markdown TEXT NOT NULL, html TEXT NOT NULL, body_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('draft', 'published')), published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO posts (slug, title, tags, markdown, html, status, created_at, updated_at)
      VALUES ('old', 'Old', '["老标签","docker"]', 'x', '<p>x</p>', 'published', '2026-01-01', '2026-01-01');`);
    old.close();

    let db = openDb(dir);
    expect(db.prepare('SELECT category_id FROM posts').get()).toEqual({ category_id: null });
    expect((db.prepare('SELECT slug FROM categories ORDER BY sort').all() as Json[]).map((r) => r.slug)).toEqual(['frontend', 'backend', 'devops', 'ai', 'notes']);
    const tags = (db.prepare('SELECT name FROM tags').all() as Json[]).map((r) => r.name);
    expect(tags).toContain('Astro');
    expect(tags).toContain('老标签');
    // "docker" is the same tag as the built-in "Docker" (case-insensitive): no duplicate.
    expect(tags.filter((t) => t.toLowerCase() === 'docker')).toEqual(['Docker']);

    db.exec("DELETE FROM categories WHERE slug = 'ai'; DELETE FROM tags WHERE name = 'Astro';");
    db.close();
    for (let i = 0; i < 2; i++) {
      db = openDb(dir);
      expect(db.prepare("SELECT 1 FROM categories WHERE slug = 'ai'").get()).toBeUndefined();
      expect(db.prepare("SELECT 1 FROM tags WHERE name = 'Astro'").get()).toBeUndefined();
      expect(Number((db.prepare('SELECT COUNT(*) AS n FROM categories').get() as Json).n)).toBe(4);
      db.close();
    }
  });
});

describe('taxonomy: categories', () => {
  it('CRUD, slug generation, conflicts, delete nulls posts', async () => {
    const { req, send, create } = await authed();
    const list = await j(req('/api/private/categories'));
    expect(list.items).toHaveLength(5);
    expect(list.items[0]).toEqual({ id: expect.any(Number), slug: 'frontend', name: '前端', description: '', sort: 0, count: 0, draftCount: 0 });

    const r1 = await send('POST', '/api/private/categories', { name: 'Web Perf', description: '性能' });
    expect(r1.status).toBe(201);
    const perf = await j(r1);
    expect(perf).toMatchObject({ slug: 'web-perf', name: 'Web Perf', description: '性能', sort: 5 });
    expect((await j(send('POST', '/api/private/categories', { name: '读书' }))).slug).toBe('cat-1');
    expect((await j(send('POST', '/api/private/categories', { name: '生活' }))).slug).toBe('cat-2');

    const dupName = await send('POST', '/api/private/categories', { name: 'web perf' });
    expect(dupName.status).toBe(409);
    expect((await j(dupName)).error).toBe('name_taken');
    const dupSlug = await send('POST', '/api/private/categories', { name: 'X', slug: 'frontend' });
    expect(dupSlug.status).toBe(409);
    expect((await j(dupSlug)).error).toBe('slug_taken');
    expect((await send('POST', '/api/private/categories', { name: '' })).status).toBe(400);
    expect((await send('POST', '/api/private/categories', { name: '名'.repeat(21) })).status).toBe(400);
    expect((await send('POST', '/api/private/categories', { name: 'ok', slug: 'Bad_Slug' })).status).toBe(400);
    expect((await send('POST', '/api/private/categories', { name: 'ok', description: 'd'.repeat(201) })).status).toBe(400);

    const put = await send('PUT', `/api/private/categories/${perf.id}`, { name: '性能优化', slug: 'perf' });
    expect(put.status).toBe(200);
    expect(await j(put)).toMatchObject({ id: perf.id, slug: 'perf', name: '性能优化', description: '性能' });
    expect((await send('PUT', `/api/private/categories/${perf.id}`, { name: '前端' })).status).toBe(409);
    expect((await send('PUT', '/api/private/categories/99999', { name: 'zz' })).status).toBe(404);

    const p = await create({ title: 'p', categoryId: perf.id });
    expect(p).toMatchObject({ categoryId: perf.id, category: { slug: 'perf', name: '性能优化' } });
    expect((await req(`/api/private/categories/${perf.id}`, { method: 'DELETE', headers: { origin: ORIGIN } })).status).toBe(204);
    expect(await j(req(`/api/private/posts/${p.id}`))).toMatchObject({ categoryId: null, category: null });
    expect((await req(`/api/private/categories/${perf.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await req('/api/private/categories/1', { method: 'DELETE', headers: { origin: 'https://evil.test' } })).status).toBe(403);
  });

  it('order requires exactly all ids, and is not swallowed by /:id', async () => {
    const { req, send } = await authed();
    const ids = ((await j(req('/api/private/categories'))).items as Json[]).map((c) => c.id as number);
    const reversed = [...ids].reverse();
    expect((await send('PUT', '/api/private/categories/order', { ids: reversed })).status).toBe(204);
    expect(((await j(req('/api/private/categories'))).items as Json[]).map((c) => c.id)).toEqual(reversed);

    for (const bad of [ids.slice(1), [...ids, 999], [ids[0], ...ids.slice(0, -1)], [...ids.slice(0, -1), 999], 'x', [1.5]]) {
      const res = await send('PUT', '/api/private/categories/order', { ids: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(((await j(req('/api/private/categories'))).items as Json[]).map((c) => c.id)).toEqual(reversed);
  });

  it('posts take categoryId or a category name (auto-created); categoryId wins', async () => {
    const { req, send, create } = await authed();
    const a = await create({ title: 'a', category: '新分类' });
    expect(a.category).toEqual({ slug: 'cat-1', name: '新分类' });
    const b = await create({ title: 'b', category: '新分类' });
    expect(b.categoryId).toBe(a.categoryId);
    const fe = ((await j(req('/api/private/categories'))).items as Json[]).find((c) => c.slug === 'frontend')!;
    const c = await create({ title: 'c', categoryId: fe.id, category: '别的' });
    expect(c.category).toEqual({ slug: 'frontend', name: '前端' });
    expect(((await j(req('/api/private/categories'))).items as Json[]).some((x) => x.name === '别的')).toBe(false);

    // PUT without category keeps it; null clears it.
    const kept = await j(send('PUT', `/api/private/posts/${c.id}`, { title: 'c', markdown: 'x', status: 'published' }));
    expect(kept.categoryId).toBe(fe.id);
    const cleared = await j(send('PUT', `/api/private/posts/${c.id}`, { title: 'c', markdown: 'x', status: 'published', categoryId: null }));
    expect(cleared.category).toBeNull();
    expect((await send('POST', '/api/private/posts', { title: 'd', markdown: '', status: 'draft', categoryId: 99999 })).status).toBe(400);
    expect((await send('POST', '/api/private/posts', { title: 'd', markdown: '', status: 'draft', category: '名'.repeat(21) })).status).toBe(400);

    const list = await j(req('/api/private/posts'));
    expect(list.items.find((p: Json) => p.id === a.id)).toMatchObject({ categoryId: a.categoryId, category: { slug: 'cat-1', name: '新分类' } });
  });
});

describe('taxonomy: tags', () => {
  it('saving a post adds unknown tags and reuses the vocabulary spelling', async () => {
    const { req, create } = await authed();
    const p = await create({ title: 'p', tags: ['docker', 'DOCKER', '新标签'] });
    expect(p.tags).toEqual(['Docker', '新标签']);
    const tags = (await j(req('/api/private/tags'))).items as Json[];
    expect(tags.find((t) => t.name === '新标签')).toMatchObject({ count: 1, draftCount: 0 });
    expect(tags.find((t) => t.name === 'Astro')).toMatchObject({ count: 0, draftCount: 0 });
  });

  it('create, rename, merge (case-insensitive dedupe), delete', async () => {
    const { req, send, create } = await authed();
    expect((await send('POST', '/api/private/tags', { name: 'Rust' })).status).toBe(201);
    expect((await send('POST', '/api/private/tags', { name: 'rust' })).status).toBe(409);
    expect((await send('POST', '/api/private/tags', { name: 'x'.repeat(31) })).status).toBe(400);

    const a = await create({ title: 'a', tags: ['k8s', 'Docker'] });
    const b = await create({ title: 'b', tags: ['K8S'], status: 'draft' });
    const c = await create({ title: 'c', tags: ['Linux'] });

    // Rename k8s → Kubernetes: both posts (case-insensitive match).
    expect(await j(send('PUT', '/api/private/tags/rename', { from: 'k8s', to: 'Kubernetes' }))).toEqual({ updated: 2 });
    expect((await j(req(`/api/private/posts/${a.id}`))).tags).toEqual(['Kubernetes', 'Docker']);
    expect((await j(req(`/api/private/posts/${b.id}`))).tags).toEqual(['Kubernetes']);

    // Merge Kubernetes into existing "docker" (different case): post a has both → one, spelled "Docker".
    expect(await j(send('PUT', '/api/private/tags/rename', { from: 'Kubernetes', to: 'docker' }))).toEqual({ updated: 2 });
    expect((await j(req(`/api/private/posts/${a.id}`))).tags).toEqual(['Docker']);
    expect((await j(req(`/api/private/posts/${b.id}`))).tags).toEqual(['Docker']);
    const names = ((await j(req('/api/private/tags'))).items as Json[]).map((t) => t.name);
    expect(names).not.toContain('Kubernetes');
    expect(names.filter((n) => n.toLowerCase() === 'docker')).toEqual(['Docker']);

    // Case-only rename changes the spelling everywhere.
    expect(await j(send('PUT', '/api/private/tags/rename', { from: 'linux', to: 'LINUX' }))).toEqual({ updated: 1 });
    expect((await j(req(`/api/private/posts/${c.id}`))).tags).toEqual(['LINUX']);

    expect((await send('PUT', '/api/private/tags/rename', { from: 'nope', to: 'x' })).status).toBe(404);
    expect((await send('PUT', '/api/private/tags/rename', { from: '', to: 'x' })).status).toBe(400);

    expect((await req(`/api/private/tags/${encodeURIComponent('docker')}`, { method: 'DELETE', headers: { origin: ORIGIN } })).status).toBe(204);
    expect((await j(req(`/api/private/posts/${a.id}`))).tags).toEqual([]);
    expect((await req('/api/private/tags/nope', { method: 'DELETE' })).status).toBe(404);
  });

  it('rename runs in one transaction (a failure leaves nothing half-done)', async () => {
    const { db, send, req, create } = await authed();
    const a = await create({ title: 'a', tags: ['old'] });
    // Make the second post's tags JSON invalid so rewriting throws midway.
    await create({ title: 'b', tags: ['old'] });
    db.exec(`UPDATE posts SET tags = '["old"' WHERE title = 'b'`);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await send('PUT', '/api/private/tags/rename', { from: 'old', to: 'new' })).status).toBe(500);
    err.mockRestore();
    expect((await j(req(`/api/private/posts/${a.id}`))).tags).toEqual(['old']);
    expect(db.prepare("SELECT name FROM tags WHERE key = 'old'").get()).toEqual({ name: 'old' });
  });
});

describe('taxonomy: public views never leak drafts', () => {
  async function seed() {
    const s = await authed();
    const ids = Object.fromEntries(((await j(s.req('/api/private/categories'))).items as Json[]).map((c) => [c.slug, c.id]));
    await s.create({ title: 'Pub FE', slug: 'pub-fe', categoryId: ids.frontend, tags: ['Astro', '公开标签'], publishedAt: '2026-10-30T02:00:00Z' });
    await s.create({ title: 'Pub FE 2', slug: 'pub-fe2', categoryId: ids.frontend, tags: ['公开标签'], publishedAt: '2026-10-29T02:00:00Z' });
    await s.create({ title: 'Secret', slug: 'secret', status: 'draft', category: '秘密分类', tags: ['秘密标签', 'Astro'] });
    await s.create({ title: 'Draft FE', slug: 'draft-fe', status: 'draft', categoryId: ids.backend, tags: ['草稿标签'] });
    return s;
  }
  const SECRETS = /秘密|草稿标签|Secret|draft-fe|Draft FE/;

  it('/api/categories, /api/tags, /api/posts?category', async () => {
    const { app } = await seed();
    const cats = (await j(app.request('/api/categories'))).items as Json[];
    expect(cats.find((c) => c.slug === 'frontend')).toEqual({ slug: 'frontend', name: '前端', description: '', count: 2 });
    // Categories used only by drafts are hidden (backend here, and the draft-created 秘密分类);
    // unused ones (devops, ai, notes) are listed with count 0.
    expect(cats.map((c) => c.slug)).toEqual(['frontend', 'devops', 'ai', 'notes']);
    expect(cats.find((c) => c.slug === 'devops')).toMatchObject({ count: 0 });

    const tags = (await j(app.request('/api/tags'))).items as Json[];
    expect(tags).toEqual([
      { name: '公开标签', count: 2 },
      { name: 'Astro', count: 1 },
    ]);

    const fe = (await j(app.request('/api/posts?category=frontend'))).items as Json[];
    expect(fe.map((p) => p.slug)).toEqual(['pub-fe', 'pub-fe2']);
    expect(fe[0]!.category).toEqual({ slug: 'frontend', name: '前端' });
    expect((await j(app.request('/api/posts?category=cat-1'))).items).toEqual([]);
    expect((await j(app.request('/api/posts?category=backend'))).items).toEqual([]);

    for (const url of ['/api/categories', '/api/tags', '/api/posts', '/api/posts?category=cat-1']) {
      expect(await (await app.request(url)).text(), url).not.toMatch(SECRETS);
    }
  });

  it('HTML pages, RSS and sitemap', async () => {
    const { app } = await seed();
    const index = await (await app.request('/blog/')).text();
    // P2.7: the cat-bar is replaced by the left nav.
    expect(index).not.toContain('cat-bar');
    expect(index).toContain('<div class="post-layout list">');
    expect(index).toContain('<summary><a href="/blog/category/frontend/">前端</a><span class="n">2</span></summary>');
    expect(index).not.toContain('/blog/category/backend/');

    for (const url of ['/blog/category/frontend', '/blog/category/frontend/']) {
      const res = await app.request(url);
      expect(res.status, url).toBe(200);
      const html = await res.text();
      expect(html).toContain('<h1 class="page-title">分类 · 前端</h1>');
      expect(html).toContain('<a href="/blog/category/frontend/" aria-current="page">');
      expect(html).toContain('/blog/pub-fe/');
    }
    const empty = await app.request('/blog/category/devops/');
    expect(empty.status).toBe(200);
    expect(await empty.text()).toContain('<p class="empty">这个分类还没有文章。</p>');
    // backend only has a draft: treated like a missing category.
    expect((await app.request('/blog/category/backend/')).status).toBe(404);
    expect((await app.request('/blog/category/nope/')).status).toBe(404);
    expect((await app.request('/blog/category/cat-1/')).status).toBe(404); // draft-only category

    const post = await (await app.request('/blog/pub-fe/')).text();
    expect(post).toMatch(/<time datetime="2026-10-30">2026-10-30<\/time><a class="cat" href="\/blog\/category\/frontend\/">前端<\/a><a class="tag"/);

    for (const url of ['/blog/tags', '/blog/tags/']) {
      const html = await (await app.request(url)).text();
      expect(html).toContain('<h1 class="page-title">标签</h1>');
      expect(html.indexOf('公开标签')).toBeLessThan(html.indexOf('Astro'));
      expect(html).toContain(`href="/blog/tags/${encodeURIComponent('公开标签')}/"`);
    }

    const rss = await (await app.request('/rss.xml')).text();
    expect(rss).toMatch(/<description>[^<]*<\/description>\n      <category>前端<\/category>\n      <category>Astro<\/category>/);
    const sm = await (await app.request('/sitemap.xml')).text();
    expect(sm).toContain('<loc>https://blog.test/blog/category/frontend/</loc>');
    expect(sm).not.toContain('/blog/category/devops/');

    for (const url of ['/blog/', '/blog/tags/', '/blog/category/backend/', '/blog/category/frontend/', '/rss.xml', '/sitemap.xml', '/blog/pub-fe/']) {
      expect(await (await app.request(url)).text(), url).not.toMatch(SECRETS);
    }
  });

  it('escapes category names and descriptions everywhere', async () => {
    const { app, send, create } = await authed();
    const cat = await j(send('POST', '/api/private/categories', { name: '<b>&"x', slug: 'xss', description: '<script>alert(1)</script>' }));
    await create({ title: 't', slug: 't', categoryId: cat.id, tags: ['<i>'] });
    for (const url of ['/blog/', '/blog/category/xss/', '/blog/t/', '/blog/tags/', '/rss.xml']) {
      const body = await (await app.request(url)).text();
      expect(body, url).not.toMatch(/<b>|<script>alert|<i>/);
    }
    expect(await (await app.request('/blog/category/xss/')).text()).toContain('&#60;b&#62;&#38;&#34;x');
  });
});

describe('taxonomy: import / export', () => {
  it('frontmatter category round-trips and unknown categories are created', async () => {
    const { req, upload } = await authed();
    const form = new FormData();
    form.append('files', new File(['---\ntitle: A\nslug: a\ncategory: 前端\n---\nx'], 'a.md'));
    form.append('files', new File(['---\ntitle: B\nslug: b\ncategory: 读书笔记\n---\ny'], 'b.md'));
    const out = await j(upload('/api/private/posts/import', form));
    expect(out.errors).toEqual([]);
    const a = await j(req(`/api/private/posts/${out.imported[0].id}`));
    const b = await j(req(`/api/private/posts/${out.imported[1].id}`));
    expect(a.category).toEqual({ slug: 'frontend', name: '前端' });
    expect(b.category).toEqual({ slug: 'cat-1', name: '读书笔记' });

    const files = unzipSync(new Uint8Array(await (await req('/api/private/posts/export')).arrayBuffer()));
    expect(strFromU8(files['a.md']!)).toContain('category: 前端');
    expect(strFromU8(files['b.md']!)).toContain('category: 读书笔记');
  });
});

describe('profile', () => {
  it('defaults, public read, validated update', async () => {
    const { app, req, send } = await authed();
    const pub = await app.request('/api/profile');
    expect(pub.headers.get('cache-control')).toBe('public, max-age=60');
    const def = await j(pub);
    expect(def).toMatchObject({ name: 'zreo', bio: '', avatar: null, links: [] });
    expect(def.tagline).toMatch(/zreo/);
    expect(def.facts).toHaveLength(4);
    expect(await j(req('/api/private/profile'))).toEqual(def);

    const next = {
      name: '张三',
      tagline: '一句话',
      bio: '第一行\n第二行',
      avatar: '/uploads/should-be-ignored.webp',
      facts: [{ label: '职业', value: '程序员' }],
      links: [
        { label: 'GitHub', url: 'https://github.com/x' },
        { label: '邮箱', url: 'mailto:me@example.com' },
        { label: '旧站', url: 'http://old.example.com/' },
      ],
    };
    const put = await send('PUT', '/api/private/profile', next);
    expect(put.status).toBe(200);
    expect(await j(put)).toEqual({ ...next, avatar: null });
    expect(await j(app.request('/api/profile'))).toEqual({ ...next, avatar: null });
  });

  it('rejects bad links and over-long fields', async () => {
    const { send } = await authed();
    const base = { name: 'n', tagline: '', bio: '', facts: [], links: [] };
    const bad: Json[] = [
      { links: [{ label: 'x', url: 'javascript:alert(1)' }] },
      { links: [{ label: 'x', url: 'data:text/html,x' }] },
      { links: [{ label: 'x', url: 'ftp://example.com' }] },
      { links: [{ label: 'x', url: '//example.com' }] },
      { links: [{ label: 'x', url: '/relative' }] },
      { links: [{ label: 'x', url: 'https://' }] },
      { links: [{ label: '', url: 'https://a.com' }] },
      { links: Array.from({ length: 7 }, () => ({ label: 'x', url: 'https://a.com' })) },
      { name: '' },
      { name: 'n'.repeat(41) },
      { tagline: 't'.repeat(81) },
      { tagline: 'a\nb' },
      { bio: 'b'.repeat(501) },
      { facts: [{ label: 'l'.repeat(11), value: 'v' }] },
      { facts: [{ label: 'l', value: 'v'.repeat(61) }] },
      { facts: Array.from({ length: 7 }, () => ({ label: 'l', value: 'v' })) },
      { facts: 'nope' },
    ];
    for (const b of bad) {
      const res = await send('PUT', '/api/private/profile', { ...base, ...b });
      expect(res.status, JSON.stringify(b).slice(0, 80)).toBe(400);
    }
    expect((await send('PUT', '/api/private/profile', base, { origin: 'https://evil.test' })).status).toBe(403);
  });

  it('avatar: centre square 256×256 webp ≤50KB, no EXIF; delete resets', async () => {
    const { app, upload, req, dataDir } = await authed();
    // 600×300 with EXIF; left half red, right half blue → the centre crop has both.
    const w = 600;
    const h = 300;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) raw.set(x < w / 2 ? [255, 0, 0] : [0, 0, 255], (y * w + x) * 3);
    const jpg = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-exif' } })
      .toBuffer();
    expect((await sharp(jpg).metadata()).exif).toBeDefined();

    const form = new FormData();
    form.append('file', new File([jpg], 'me.jpg'));
    const res = await upload('/api/private/profile/avatar', form);
    expect(res.status).toBe(200);
    const { avatar } = await j(res);
    expect(avatar).toMatch(/^\/uploads\/[0-9a-f]{16}\.webp$/);
    const file = path.join(dataDir, avatar);
    const meta = await sharp(file).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 256, height: 256 });
    expect(meta.exif).toBeUndefined();
    expect(fs.statSync(file).size).toBeLessThanOrEqual(50 * 1024);
    expect(fs.readFileSync(file).includes('secret-exif')).toBe(false);
    const px = await sharp(file).raw().toBuffer();
    expect(px[0]).toBeGreaterThan(200); // left edge red
    expect(px[(256 - 1) * 3 + 2]).toBeGreaterThan(200); // right edge blue
    expect((await j(app.request('/api/profile'))).avatar).toBe(avatar);

    const bad = new FormData();
    bad.append('file', new File(['<svg/>'], 'a.png'));
    expect((await upload('/api/private/profile/avatar', bad)).status).toBe(415);

    expect((await req('/api/private/profile/avatar', { method: 'DELETE', headers: { origin: ORIGIN } })).status).toBe(204);
    expect((await j(app.request('/api/profile'))).avatar).toBeNull();
  });

  it('noisy avatars still fit 50KB', async () => {
    const { upload, dataDir } = await authed();
    const raw = Buffer.alloc(800 * 800 * 3);
    let x = 7;
    for (let i = 0; i < raw.length; i++) raw[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
    const png = await sharp(raw, { raw: { width: 800, height: 800, channels: 3 } }).png().toBuffer();
    const form = new FormData();
    form.append('file', new File([png], 'n.png'));
    const { avatar } = await j(upload('/api/private/profile/avatar', form));
    expect(fs.statSync(path.join(dataDir, avatar)).size).toBeLessThanOrEqual(50 * 1024);
  });
});

describe('security', () => {
  it('requires a session for every route', async () => {
    const { app } = setup();
    for (const [m, u] of [
      ['GET', '/api/private/security'],
      ['POST', '/api/private/security/sessions/revoke-others'],
      ['POST', '/api/private/security/sessions/revoke-all'],
      ['POST', '/api/private/security/recovery-codes'],
      ['GET', '/api/private/profile'],
      ['PUT', '/api/private/profile'],
      ['POST', '/api/private/profile/avatar'],
      ['DELETE', '/api/private/profile/avatar'],
      ['GET', '/api/private/categories'],
      ['PUT', '/api/private/categories/order'],
      ['GET', '/api/private/tags'],
      ['PUT', '/api/private/tags/rename'],
      ['DELETE', '/api/private/tags/x'],
    ] as const) {
      expect((await app.request(u, { method: m })).status, `${m} ${u}`).toBe(401);
    }
  });

  it('status, revoke-others keeps the current session, revoke-all clears it', async () => {
    const s = setup();
    const login = async () => {
      s.clock.t += 30_000;
      return sessionCookie(await s.login(s.codeAt()));
    };
    const a = await login();
    const b = await login();
    const c = await login();
    const check = async (cookie: string) => (await s.app.request('/api/auth/check', { headers: { cookie } })).status;
    const post = (url: string, cookie: string) => s.app.request(url, { method: 'POST', headers: { cookie, origin: ORIGIN } });

    const st = await j(s.app.request('/api/private/security', { headers: { cookie: b } }));
    expect(st).toEqual({ recoveryCodesLeft: 0, sessionCount: 3, currentSessionCreatedAt: new Date(s.clock.t - 30_000).toISOString() });

    expect((await post('/api/private/security/sessions/revoke-others', b)).status).toBe(204);
    expect([await check(a), await check(b), await check(c)]).toEqual([401, 204, 401]);

    const d = await login();
    const res = await post('/api/private/security/sessions/revoke-all', b);
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toMatch(/ld_session=;.*Max-Age=0/);
    expect([await check(b), await check(d)]).toEqual([401, 401]);
    expect((await s.app.request('/api/private/security/sessions/revoke-others', { method: 'POST', headers: { cookie: b, origin: 'https://evil.test' } })).status).toBe(401);
  });

  it('regenerates recovery codes with a TOTP; old codes stop working; no-store; replay refused', async () => {
    const { app, send, codeAt, clock, login, cookie } = await authed();
    clock.t += 30_000;
    const res = await send('POST', '/api/private/security/recovery-codes', { code: codeAt() });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { codes } = await j(res);
    expect(codes).toHaveLength(10);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);

    // Same TOTP again: replay.
    expect((await send('POST', '/api/private/security/recovery-codes', { code: codeAt() })).status).toBe(401);

    clock.t += 30_000;
    const again = await j(send('POST', '/api/private/security/recovery-codes', { code: codeAt() }));
    expect((await login(codes[0])).status).toBe(401); // old set is void
    expect((await login(again.codes[0])).status).toBe(200);
    expect((await j(app.request('/api/private/security', { headers: { cookie } }))).recoveryCodesLeft).toBe(9);

    expect((await send('POST', '/api/private/security/recovery-codes', { code: codeAt() }, { origin: 'https://evil.test' })).status).toBe(403);
    expect((await send('POST', '/api/private/security/recovery-codes', 'x', { 'content-type': 'text/plain' })).status).toBe(415);
  });

  it('wrong codes share the login limiter: 5 failures → 429, and login is locked too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { send, wrongCode, codeAt, login, clock } = await authed();
    const ip = { 'x-forwarded-for': '203.0.113.50' };
    for (let i = 0; i < 4; i++) {
      const r = await send('POST', '/api/private/security/recovery-codes', { code: wrongCode() }, ip);
      expect(r.status).toBe(401);
      expect(await j(r)).toEqual({ error: 'invalid_code' });
    }
    const fifth = await send('POST', '/api/private/security/recovery-codes', { code: wrongCode() }, ip);
    expect(fifth.status).toBe(429);
    expect(fifth.headers.get('retry-after')).toBe('900');
    clock.t += 30_000;
    expect((await send('POST', '/api/private/security/recovery-codes', { code: codeAt() }, ip)).status).toBe(429);
    expect((await login(codeAt(), '203.0.113.50')).status).toBe(429);
    warn.mockRestore();
  });
});

describe('security review round 2', () => {
  it('rejects invisible / bidi characters and dot-only tag names', async () => {
    const { send } = await authed();
    for (const name of ['\u200b', 'a\u202eb', 'x\ufeffy']) {
      expect((await send('POST', '/api/private/tags', { name })).status, JSON.stringify(name)).toBe(400);
      expect((await send('POST', '/api/private/categories', { name })).status, JSON.stringify(name)).toBe(400);
    }
    for (const name of ['.', '..', '...']) expect((await send('POST', '/api/private/tags', { name })).status, name).toBe(400);
    expect((await send('POST', '/api/private/tags', { name: 'a.b' })).status).toBe(201);
    const prof = (await j(send('GET', '/api/private/profile', undefined))) as Json;
    expect((await send('PUT', '/api/private/profile', { ...prof, name: '\u200b' })).status).toBe(400);
    expect((await send('PUT', '/api/private/profile', { ...prof, name: 'zr\u202eeo' })).status).toBe(400);
  });

  it('user-created categories stay hidden until something in them is published', async () => {
    const { app, send, create } = await authed();
    const made = (await j(send('POST', '/api/private/categories', { name: '自建分类', slug: 'mine' }))) as Json;
    const pub = async () => ((await j(app.request('/api/categories'))).items as Json[]).map((c) => c.slug);
    expect(await pub()).not.toContain('mine');
    expect((await app.request('/blog/category/mine/')).status).toBe(404);
    // A draft that later moves away must not expose the name either.
    const d = await create({ title: 'd', status: 'draft', categoryId: made.id });
    await send('PUT', `/api/private/posts/${d.id}`, { title: 'd', markdown: 'x', status: 'draft', categoryId: null });
    expect(await pub()).not.toContain('mine');
    await create({ title: 'p', categoryId: made.id });
    expect(await pub()).toContain('mine');
    // Built-ins with no posts are still listed.
    expect(await pub()).toEqual(expect.arrayContaining(['devops', 'ai', 'notes']));
  });
});
