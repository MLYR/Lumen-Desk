import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openDb, kvGet } from '../src/db.js';
import { blogNav } from '../src/blog/pages.js';
import { pagerFor, rerenderPosts } from '../src/blog/posts.js';
import { HEADING_ID_RE, renderPost, sanitizePostHtml, slugifyHeading } from '../src/blog/render.js';
import { authed } from './helpers.js';

type Json = Record<string, any>;
const j = async (res: Response | Promise<Response>) => (await (await res).json()) as Json;

describe('reader: heading ids', () => {
  it('slugifies Chinese, special characters, whitespace and long titles', () => {
    expect(slugifyHeading('第一节 安装')).toBe('第一节-安装');
    expect(slugifyHeading('Hello, World! (v2)')).toBe('hello-world-v2');
    expect(slugifyHeading('  --a  b--  ')).toBe('a--b');
    expect(slugifyHeading('snake_case & dash-ed')).toBe('snake_case--dash-ed');
    expect(slugifyHeading('Ünïcödé 数字123')).toBe('ünïcödé-数字123');
    expect(slugifyHeading('!!!')).toBe('');
    expect([...slugifyHeading('长'.repeat(100))]).toHaveLength(60);
    expect(slugifyHeading(`${'a'.repeat(59)}----b`)).toBe('a'.repeat(59));
  });

  it('is linear on pathological input', () => {
    const t0 = performance.now();
    slugifyHeading(`a${'-'.repeat(200_000)}a${' '.repeat(200_000)}`);
    slugifyHeading('-'.repeat(400_000));
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('renders h2/h3 ids with h- prefix, dedupes, section-n for empty, and returns a matching toc', async () => {
    const { html, toc } = await renderPost(
      ['# 标题一', '## 第一节 安装', '### 1.1', '## 第一节 安装', '## !!!', '### `code` *em*', '#### 四级', '## ' + '长'.repeat(100), '## ' + '长'.repeat(100)].join('\n\n'),
    );
    expect(toc).toEqual([
      { level: 2, id: 'h-第一节-安装', text: '第一节 安装' },
      { level: 3, id: 'h-11', text: '1.1' },
      { level: 2, id: 'h-第一节-安装-2', text: '第一节 安装' },
      { level: 2, id: 'h-section-1', text: '!!!' },
      { level: 3, id: 'h-code-em', text: 'code em' },
      { level: 2, id: `h-${'长'.repeat(60)}`, text: '长'.repeat(100) },
      { level: 2, id: `h-${'长'.repeat(60)}-2`, text: '长'.repeat(100) },
    ]);
    for (const t of toc) {
      expect(t.id).toMatch(HEADING_ID_RE);
      expect(html).toContain(`<h${t.level} id="${t.id}">`);
    }
    expect(html).toContain('<h1>标题一</h1>');
    expect(html).toContain('<h4>四级</h4>');
  });

  it('raw HTML ids never survive (markdown escapes it; the sanitizer checks the format)', async () => {
    const { html } = await renderPost('<h2 id="javascript:alert(1)">x</h2>\n\n<h3 id="h-ok">y</h3>');
    expect(html).not.toMatch(/<h[23][^>]*id=/);
    expect(html).toContain('&lt;h2 id="javascript:alert(1)"&gt;');
  });

  it('the sanitizer keeps only well-formed h- ids on h2/h3', () => {
    expect(sanitizePostHtml('<h2 id="javascript:alert(1)">a</h2>')).toBe('<h2>a</h2>');
    expect(sanitizePostHtml('<h3 id="blog-search">a</h3>')).toBe('<h3>a</h3>');
    expect(sanitizePostHtml('<h2 id="h-">a</h2>')).toBe('<h2>a</h2>');
    expect(sanitizePostHtml(`<h2 id="h-${'x'.repeat(65)}">a</h2>`)).toBe('<h2>a</h2>');
    expect(sanitizePostHtml('<h2 id="h-a b">a</h2>')).toBe('<h2>a</h2>');
    expect(sanitizePostHtml('<h2 id="h-第一节-安装_2">a</h2>')).toBe('<h2 id="h-第一节-安装_2">a</h2>');
    expect(sanitizePostHtml('<h1 id="h-x">a</h1><p id="h-x">b</p>')).toBe('<h1>a</h1><p>b</p>');
  });
});

describe('reader: migration re-renders old posts once', () => {
  it('adds toc and ids without touching markdown, title, dates', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-p27-'));
    const old = new DatabaseSync(path.join(dir, 'lumen.db'));
    old.exec(`CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]', markdown TEXT NOT NULL, html TEXT NOT NULL, body_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('draft', 'published')), published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    const ins = old.prepare('INSERT INTO posts (slug, title, markdown, html, body_text, status, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    ins.run('one', '第一篇', '## 安装\n\n正文一\n\n### 细节\n\nx', '<h2>安装</h2><p>正文一</p>', '安装 正文一', 'published', '2026-10-01T00:00:00.000Z', '2026-09-30T00:00:00.000Z', '2026-10-02T00:00:00.000Z');
    ins.run('two', '草稿', '纯文字', '<p>纯文字</p>', '纯文字', 'draft', null, '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z');
    old.close();
    const before = new DatabaseSync(path.join(dir, 'lumen.db')).prepare('SELECT id, slug, title, markdown, published_at, created_at, updated_at, status FROM posts ORDER BY id').all();

    let db = openDb(dir);
    expect(kvGet(db, 'render_version')).toBeUndefined();
    expect(db.prepare("SELECT toc FROM posts WHERE slug = 'one'").get()).toEqual({ toc: '[]' });
    expect(await rerenderPosts(db)).toBe(2);
    // Search index survived the upgrade and follows the new body text.
    expect(db.prepare("SELECT rowid FROM posts_fts WHERE posts_fts MATCH '\"正文一\"'").all()).toEqual([{ rowid: 1 }]);
    db.exec("INSERT INTO posts_fts(posts_fts) VALUES ('integrity-check')");
    expect(kvGet(db, 'render_version')).toBe('2');
    const one = db.prepare("SELECT html, toc FROM posts WHERE slug = 'one'").get() as Json;
    expect(one.html).toContain('<h2 id="h-安装">安装</h2>');
    expect(JSON.parse(one.toc)).toEqual([
      { level: 2, id: 'h-安装', text: '安装' },
      { level: 3, id: 'h-细节', text: '细节' },
    ]);
    expect(db.prepare('SELECT id, slug, title, markdown, published_at, created_at, updated_at, status FROM posts ORDER BY id').all()).toEqual(before);
    db.close();

    // Second start: no re-render (html changed by hand stays as is).
    db = openDb(dir);
    db.exec("UPDATE posts SET html = '<p>marker</p>' WHERE slug = 'two'");
    expect(await rerenderPosts(db)).toBe(0);
    expect(db.prepare("SELECT html FROM posts WHERE slug = 'two'").get()).toEqual({ html: '<p>marker</p>' });
    db.close();
  });

  it('a fresh database is marked current right away', () => {
    const db = openDb(':memory:');
    expect(kvGet(db, 'render_version')).toBe('2');
  });
});

/** Fixture: two categories, an uncategorized post, a draft in its own category. */
async function seed() {
  const s = await authed();
  const ids = Object.fromEntries(((await j(s.req('/api/private/categories'))).items as Json[]).map((c) => [c.slug, c.id]));
  const md = '开头一段。\n\n## 第一节 安装\n\n内容。\n\n### 1.1 依赖\n\n```bash\npnpm install\n```\n\n## 第二节 <配置>\n\n更多内容。';
  await s.create({ title: 'FE 旧', slug: 'fe-old', categoryId: ids.frontend, publishedAt: '2026-10-01T02:00:00Z' });
  await s.create({ title: 'FE 中 & <b>', slug: 'fe-mid', categoryId: ids.frontend, publishedAt: '2026-10-10T02:00:00Z', markdown: md, tags: ['Astro'] });
  await s.create({ title: 'FE 新', slug: 'fe-new', categoryId: ids.frontend, publishedAt: '2026-10-20T02:00:00Z' });
  await s.create({ title: 'Ops 唯一', slug: 'ops-only', categoryId: ids.devops, publishedAt: '2026-10-15T02:00:00Z' });
  await s.create({ title: '无分类 A', slug: 'none-a', publishedAt: '2026-10-02T02:00:00Z' });
  await s.create({ title: '无分类 B', slug: 'none-b', publishedAt: '2026-10-05T02:00:00Z' });
  await s.create({ title: 'FE 草稿', slug: 'fe-draft', categoryId: ids.frontend, status: 'draft', publishedAt: '2026-10-12T02:00:00Z' });
  await s.create({ title: '秘密草稿', slug: 'secret', status: 'draft', category: '秘密分类' });
  return s;
}

const tocHrefs = (html: string, cls: string) => {
  const m = new RegExp(`<(?:aside|details) class="${cls}"[^]*?</(?:aside|details)>`).exec(html);
  return [...(m?.[0] ?? '').matchAll(/href="#([^"]+)"/g)].map((x) => decodeURIComponent(x[1]!.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))));
};

describe('reader: article page', () => {
  it('layout, toc ↔ heading ids, pager, nav', async () => {
    const { app } = await seed();
    const res = await app.request('/blog/fe-mid/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div class="post-layout">');
    expect(html).toContain('<aside class="blog-nav" id="blog-nav" aria-label="文章导航">');
    expect(html).toContain('<div class="blog-nav-search"></div>');
    expect(html).toContain('<header class="post-head">');
    expect(html).toContain('<a class="cat" href="/blog/category/frontend/">前端</a>');
    expect(html).toContain('<details class="toc-inline"><summary>本文目录</summary><ol>');
    expect(html).toContain('<aside class="post-toc" aria-label="本文目录">');
    expect(html).toContain('<div class="toc-progress" aria-hidden="true"><span></span></div>');

    // Every toc link (both copies) points at an id that exists in the body, and vice versa.
    const ids = [...html.matchAll(/<h[23] id="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids).toEqual(['h-第一节-安装', 'h-11-依赖', 'h-第二节-配置']);
    expect(tocHrefs(html, 'post-toc')).toEqual(ids);
    expect(tocHrefs(html, 'toc-inline')).toEqual(ids);
    expect(html).toContain(`<li class="l2"><a href="#${encodeURIComponent('h-第一节-安装')}">第一节 安装</a><ol><li class="l3">`);
    expect(html).toContain('>第二节 &#60;配置&#62;</a>');

    // Pager inside the category: older = prev, newer = next.
    expect(html).toContain(
      '<nav class="post-pager" aria-label="上一篇和下一篇">\n      <a class="prev" href="/blog/fe-old/" rel="prev"><span>上一篇</span><strong>FE 旧</strong></a>\n      <a class="next" href="/blog/fe-new/" rel="next"><span>下一篇</span><strong>FE 新</strong></a>\n    </nav>',
    );
    expect(html).toContain('<li><a href="/blog/fe-mid/" aria-current="page">FE 中 &#38; &#60;b&#62;</a></li>');
    expect(html).not.toMatch(/FE 草稿|fe-draft|秘密/);
  });

  it('pager edges: first/last in category, only-one, uncategorized group', async () => {
    const { app } = await seed();
    const page = async (slug: string) => (await app.request(`/blog/${slug}/`)).text();
    const newest = await page('fe-new');
    expect(newest).toContain('class="prev" href="/blog/fe-mid/"');
    expect(newest).not.toContain('class="next"');
    const oldest = await page('fe-old');
    expect(oldest).toContain('class="next" href="/blog/fe-mid/"');
    expect(oldest).not.toContain('class="prev"');
    const only = await page('ops-only');
    expect(only).not.toContain('post-pager');
    // No headings → no toc blocks.
    expect(only).not.toContain('post-toc');
    expect(only).not.toContain('toc-inline');
    const a = await page('none-a');
    expect(a).toContain('class="next" href="/blog/none-b/"');
    expect(a).not.toContain('class="prev"');
  });

  it('pager breaks publish-time ties by id', async () => {
    const s = await authed();
    const t = '2026-10-01T00:00:00Z';
    const p1 = await s.create({ title: '1', slug: 's1', publishedAt: t });
    const p2 = await s.create({ title: '2', slug: 's2', publishedAt: t });
    const row = s.db.prepare('SELECT id, category_id, published_at FROM posts WHERE id = ?').get(p1.id) as Json;
    expect(pagerFor(s.db, row as never)).toEqual({ next: { slug: 's2', title: '2' } });
    const row2 = s.db.prepare('SELECT id, category_id, published_at FROM posts WHERE id = ?').get(p2.id) as Json;
    expect(pagerFor(s.db, row2 as never)).toEqual({ prev: { slug: 's1', title: '1' } });
  });

  it('pager uses the index', async () => {
    const { db } = await authed();
    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT slug FROM posts WHERE status = 'published' AND category_id IS ? AND (published_at < ? OR (published_at = ? AND id < ?)) ORDER BY published_at DESC, id DESC LIMIT 1",
      )
      .all(1, 'x', 'x', 1) as Json[];
    expect(plan.map((p) => p.detail).join(' ')).toContain('posts_pager');
  });
});

describe('reader: nav', () => {
  it('groups by category sort, newest first, uncategorized last, no drafts', async () => {
    const { app } = await seed();
    const html = await (await app.request('/blog/')).text();
    expect(html).not.toContain('cat-bar');
    expect(html).toMatch(/^[^]*<div class="post-layout list">\n {2}<aside class="blog-nav"[^]*<\/aside>\n<section class="post-index">[^]*<\/section>\n<\/div>/);
    const groups = [...html.matchAll(/<summary>(.*?)<\/summary>/g)].map((m) => m[1]);
    expect(groups).toEqual([
      '<a href="/blog/category/frontend/">前端</a><span class="n">3</span>',
      '<a href="/blog/category/devops/">部署运维</a><span class="n">1</span>',
      '<span>未分类</span><span class="n">2</span>',
    ]);
    const fe = /前端<\/a>[^]*?<\/details>/.exec(html)![0];
    expect([...fe.matchAll(/href="\/blog\/([^/]+)\/"/g)].map((m) => m[1])).toEqual(['fe-new', 'fe-mid', 'fe-old']);
    expect((html.match(/<details class="nav-group" open>/g) ?? []).length).toBe(3); // ≤ 50 posts: all open
    expect(html).not.toMatch(/fe-draft|FE 草稿|秘密|\/blog\/category\/(backend|ai|notes|cat-1)\//);
    expect(html).toContain('<p class="nav-foot"><a href="/blog/">全部文章</a> · <a href="/blog/tags/">标签</a> · <a href="/rss.xml">RSS</a></p>');
  });

  it('category, tag and tags pages share the layout; category page marks itself current', async () => {
    const { app } = await seed();
    const cat = await (await app.request('/blog/category/frontend/')).text();
    expect(cat).toContain('<div class="post-layout list">');
    expect(cat).toContain('<summary><a href="/blog/category/frontend/" aria-current="page">前端</a>');
    for (const url of ['/blog/tags/', `/blog/tags/${encodeURIComponent('Astro')}/`]) {
      const html = await (await app.request(url)).text();
      expect(html, url).toContain('<div class="post-layout list">');
      expect(html, url).toContain('class="blog-nav"');
    }
    // 404 has no nav.
    expect(await (await app.request('/blog/nope/')).text()).not.toContain('blog-nav');
  });

  it('over 50 posts only the current group opens; escapes and encodes everything', () => {
    const posts = Array.from({ length: 51 }, (_, i) => ({ slug: `p${i}`, title: `T${i}`, category_id: i % 2 ? 1 : 2, published_at: '2026-01-01' }));
    const cats = [
      { id: 1, slug: 'one', name: '<一>' },
      { id: 2, slug: 'two', name: '"二"' },
    ];
    const html = blogNav(cats, posts, { slug: 'p1' });
    expect((html.match(/ open>/g) ?? []).length).toBe(1);
    expect(html).toContain('<details class="nav-group" open>\n      <summary><a href="/blog/category/one/">&#60;一&#62;</a>');
    expect(html).toContain('&#34;二&#34;');
    expect(blogNav(cats, posts, { categorySlug: 'two' })).toContain('<summary><a href="/blog/category/two/" aria-current="page">');
    expect((blogNav(cats, posts).match(/ open>/g) ?? []).length).toBe(0);
    const odd = blogNav([], [{ slug: 'a"b<c', title: 't', category_id: null, published_at: 'x' }]);
    expect(odd).toContain(`href="/blog/${encodeURIComponent('a"b<c')}/"`);
  });
});

describe('reader: samples for the web worker', () => {
  it('writes /tmp/p27-sample-article.html and /tmp/p27-sample-index.html (fixture shell)', async () => {
    const { app } = await seed();
    fs.writeFileSync('/tmp/p27-sample-article.html', await (await app.request('/blog/fe-mid/')).text());
    fs.writeFileSync('/tmp/p27-sample-index.html', await (await app.request('/blog/')).text());
    expect(fs.statSync('/tmp/p27-sample-article.html').size).toBeGreaterThan(0);
  });
});

describe('security review round 3', () => {
  it('many duplicate headings render in linear time and stay unique', async () => {
    const md = '## a\n\n'.repeat(20000) + Array.from({ length: 3000 }, (_, i) => `## ${'x'.repeat(70)}${i}\n`).join('');
    const t = Date.now();
    const { html, toc } = await renderPost(md);
    expect(Date.now() - t).toBeLessThan(3000);
    expect(toc.length).toBe(200); // capped
    expect(new Set(toc.map((x) => x.id)).size).toBe(200);
    expect(toc[1]!.id).toBe('h-a-2');
    for (const x of toc) expect(x.id).toMatch(HEADING_ID_RE);
    expect(html.match(/<h2 id=/g)?.length).toBe(200);
  });

  it('long headings that collide after truncation get distinct ids', async () => {
    const md = Array.from({ length: 30 }, (_, i) => `## ${'长'.repeat(80)}${i}`).join('\n\n');
    const { toc } = await renderPost(md);
    expect(new Set(toc.map((x) => x.id)).size).toBe(30);
    for (const x of toc) expect(x.id).toMatch(HEADING_ID_RE);
  });
});
