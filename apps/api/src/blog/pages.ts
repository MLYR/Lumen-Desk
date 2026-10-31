import fs from 'node:fs';
import path from 'node:path';
import { effectiveSummary, localDate, type CategoryRef, type ListRow, type NavPost, type PagerLinks, type PostRow } from './posts.js';
import type { TocItem } from './render.js';
import { escapeHtml } from './render.js';

const FALLBACK_SHELL = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{LD_TITLE}}</title>
<meta name="description" content="{{LD_DESCRIPTION}}">
<link rel="alternate" type="application/rss+xml" title="拾光台" href="/rss.xml">
</head>
<body>
<main>{{LD_CONTENT}}</main>
</body>
</html>
`;

const PLACEHOLDERS = ['{{LD_TITLE}}', '{{LD_DESCRIPTION}}', '{{LD_CONTENT}}'];

export const SITE_NAME = '拾光台';

/** Reads SHELL_DIR/blog.html once; falls back to a minimal shell when it's missing or incomplete. */
export function loadShell(shellDir: string): string {
  const file = path.join(shellDir, 'blog.html');
  try {
    const html = fs.readFileSync(file, 'utf8');
    const missing = PLACEHOLDERS.filter((p) => !html.includes(p));
    if (missing.length === 0) return html;
    console.warn(`[blog] ${file} lacks ${missing.join(', ')}; using the built-in shell`);
  } catch {
    console.warn(`[blog] ${file} not found; using the built-in shell`);
  }
  return FALLBACK_SHELL;
}

/** Fills the shell. title/description are plain text (escaped here); content is trusted HTML built below. */
export function fillShell(shell: string, title: string, description: string, content: string): string {
  // One pass over the shell only: placeholders inside user text are never re-expanded,
  // and the function replacer keeps `$&` etc. literal.
  const map: Record<string, string> = { TITLE: escapeHtml(title), DESCRIPTION: escapeHtml(description), CONTENT: content };
  return shell.replace(/\{\{LD_(TITLE|DESCRIPTION|CONTENT)\}\}/g, (_, k: string) => map[k]!);
}

const tagHref = (t: string) => `/blog/tags/${encodeURIComponent(t)}/`;
// Every href is URL-encoded first, then HTML-escaped where it's written out.
const postHref = (slug: string) => `/blog/${encodeURIComponent(slug)}/`;
const catHref = (slug: string) => `/blog/category/${encodeURIComponent(slug)}/`;
const attr = (s: string) => escapeHtml(s);

export interface ArticleParts {
  category: CategoryRef | null;
  toc: TocItem[];
  pager: PagerLinks;
  nav: string;
}

function tocList(toc: TocItem[]): string {
  // h3s nest under the preceding h2; an h3 before any h2 is listed at the top level.
  const out: string[] = [];
  let openL2 = false;
  let openL3 = false;
  const link = (t: TocItem) => `<a href="#${attr(encodeURIComponent(t.id))}">${escapeHtml(t.text)}</a>`;
  for (const t of toc) {
    if (t.level === 2) {
      if (openL3) out.push('</ol>');
      if (openL2) out.push('</li>');
      out.push(`<li class="l2">${link(t)}`);
      openL2 = true;
      openL3 = false;
    } else if (openL2) {
      if (!openL3) out.push('<ol>');
      out.push(`<li class="l3">${link(t)}</li>`);
      openL3 = true;
    } else {
      out.push(`<li class="l3">${link(t)}</li>`);
    }
  }
  if (openL3) out.push('</ol>');
  if (openL2) out.push('</li>');
  return `<ol>${out.join('')}</ol>`;
}

function pager(p: PagerLinks): string {
  const a = (cls: 'prev' | 'next', label: string, x: { slug: string; title: string }) =>
    `<a class="${cls}" href="${attr(postHref(x.slug))}" rel="${cls}"><span>${label}</span><strong>${escapeHtml(x.title)}</strong></a>`;
  const links = [p.prev ? a('prev', '上一篇', p.prev) : '', p.next ? a('next', '下一篇', p.next) : ''].filter(Boolean);
  if (!links.length) return '';
  return `\n    <nav class="post-pager" aria-label="上一篇和下一篇">\n      ${links.join('\n      ')}\n    </nav>`;
}

export function postPage(r: PostRow, { category, toc, pager: links, nav }: ArticleParts): string {
  const tags = JSON.parse(r.tags) as string[];
  const date = r.published_at ? localDate(r.published_at) : '';
  const meta = [
    date ? `<time datetime="${date}">${date}</time>` : '',
    category ? `<a class="cat" href="${attr(catHref(category.slug))}">${escapeHtml(category.name)}</a>` : '',
    ...tags.map((t) => `<a class="tag" href="${attr(tagHref(t))}">${escapeHtml(t)}</a>`),
  ].join('');
  const list = toc.length ? tocList(toc) : '';
  const inline = list ? `\n    <details class="toc-inline"><summary>本文目录</summary>${list}</details>` : '';
  const aside = list
    ? `\n  <aside class="post-toc" aria-label="本文目录">
    <p class="toc-title">本文目录</p>
    ${list}
    <div class="toc-progress" aria-hidden="true"><span></span></div>
  </aside>`
    : '';
  return `<div class="post-layout">
${nav}
  <article class="post">
    <header class="post-head">
      <a class="back" href="/blog/">← 全部文章</a>
      <h1 class="post-title">${escapeHtml(r.title)}</h1>
      <div class="post-meta">${meta}</div>
    </header>${inline}
    <div class="prose">${r.html}</div>${pager(links)}
  </article>${aside}
</div>`;
}

export interface NavCategory {
  id: number;
  slug: string;
  name: string;
}

/** Above this many published posts only the current group starts open. */
export const NAV_EXPAND_ALL_MAX = 50;

/**
 * Left-hand navigation. categories: public ones in sort order; posts: published, newest first.
 * Empty groups are left out; uncategorized posts (or posts whose category isn't listed) go last.
 */
export function blogNav(
  categories: NavCategory[],
  posts: NavPost[],
  current: { slug?: string; categorySlug?: string } = {},
): string {
  const byCat = new Map<number | null, NavPost[]>();
  const known = new Set(categories.map((c) => c.id));
  for (const p of posts) {
    const k = p.category_id !== null && known.has(p.category_id) ? p.category_id : null;
    const list = byCat.get(k) ?? [];
    list.push(p);
    byCat.set(k, list);
  }
  const currentCat = current.slug ? (posts.find((p) => p.slug === current.slug)?.category_id ?? null) : undefined;
  const expandAll = posts.length <= NAV_EXPAND_ALL_MAX;

  const group = (head: string, list: NavPost[], isCurrent: boolean) => {
    const items = list
      .map((p) => `        <li><a href="${attr(postHref(p.slug))}"${p.slug === current.slug ? ' aria-current="page"' : ''}>${escapeHtml(p.title)}</a></li>`)
      .join('\n');
    return `    <details class="nav-group"${expandAll || isCurrent ? ' open' : ''}>
      <summary>${head}<span class="n">${list.length}</span></summary>
      <ul>
${items}
      </ul>
    </details>`;
  };

  const groups: string[] = [];
  for (const c of categories) {
    const list = byCat.get(c.id);
    if (!list?.length) continue;
    const onCatPage = current.categorySlug === c.slug;
    const head = `<a href="${attr(catHref(c.slug))}"${onCatPage ? ' aria-current="page"' : ''}>${escapeHtml(c.name)}</a>`;
    groups.push(group(head, list, onCatPage || (currentCat !== undefined && currentCat === c.id)));
  }
  const none = byCat.get(null);
  if (none?.length) groups.push(group('<span>未分类</span>', none, currentCat !== undefined && (currentCat === null || !known.has(currentCat))));

  return `  <aside class="blog-nav" id="blog-nav" aria-label="文章导航">
    <div class="blog-nav-search"></div>
    <nav>
${groups.join('\n')}
    </nav>
    <p class="nav-foot"><a href="/blog/">全部文章</a> · <a href="/blog/tags/">标签</a> · <a href="/rss.xml">RSS</a></p>
  </aside>`;
}

/** List/category/tag pages: nav + the section, in the shared layout. */
export function listLayout(nav: string, section: string): string {
  return `<div class="post-layout list">
${nav}
${section}
</div>`;
}

/** List page section; posts must already be sorted by published_at descending. */
export function indexPage(heading: string, posts: ListRow[], opts: { empty?: string } = {}): string {
  const groups: string[] = [];
  let year = '';
  let items: string[] = [];
  const flush = () => {
    if (!items.length) return;
    groups.push(`  <div class="year-group">
    <h2 class="year">${year}</h2>
    <ul class="post-list">
${items.join('\n')}
    </ul>
  </div>`);
    items = [];
  };
  for (const r of posts) {
    const d = localDate(r.published_at!);
    const y = d.slice(0, 4);
    if (y !== year) {
      flush();
      year = y;
    }
    const tags = (JSON.parse(r.tags) as string[]).map(escapeHtml).join(' · ');
    items.push(
      `      <li><a href="${attr(postHref(r.slug))}"><span class="d">${d.slice(5)}</span><div><div class="t">${escapeHtml(r.title)}</div><div class="s">${escapeHtml(effectiveSummary(r))}</div></div><span class="tags">${tags}</span></a></li>`,
    );
  }
  flush();
  return `<section class="post-index">
  <h1 class="page-title">${escapeHtml(heading)}</h1>
${groups.join('\n')}${posts.length ? '' : `\n  <p class="empty">${escapeHtml(opts.empty ?? '还没有文章。')}</p>`}
</section>`;
}

/** /blog/tags/: every tag of published posts, most used first. */
export function tagsPage(tags: Array<{ name: string; count: number }>): string {
  const items = tags.map(
    (t) => `    <li><a class="tag" href="${escapeHtml(tagHref(t.name))}">${escapeHtml(t.name)} <span class="n">${t.count}</span></a></li>`,
  );
  return `<section class="post-index">
  <h1 class="page-title">标签</h1>
${items.length ? `  <ul class="tag-cloud">\n${items.join('\n')}\n  </ul>` : '  <p class="empty">还没有标签。</p>'}
</section>`;
}

export function notFoundPage(): string {
  return `<section class="post-index">
  <h1 class="page-title">找不到这篇文章</h1>
  <p class="empty">它可能还没发布，或者地址写错了。<a href="/blog/">回到文章列表</a></p>
</section>`;
}

function escapeXml(s: string): string {
  // Strip characters XML 1.0 forbids, then escape.
  return s.replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function rss(siteUrl: string, posts: ListRow[]): string {
  const items = posts
    .map((r) => {
      const link = `${siteUrl}${postHref(r.slug)}`;
      // Category first, then tags.
      const names = [...(r.cat_name !== null ? [r.cat_name] : []), ...(JSON.parse(r.tags) as string[])];
      const cats = names.map((t) => `      <category>${escapeXml(t)}</category>`).join('\n');
      return `    <item>
      <title>${escapeXml(r.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${new Date(r.published_at!).toUTCString()}</pubDate>
      <description>${escapeXml(effectiveSummary(r))}</description>
${cats}
    </item>`;
    })
    .join('\n');
  const last = posts[0]?.published_at ? `\n    <lastBuildDate>${new Date(posts[0].published_at).toUTCString()}</lastBuildDate>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${SITE_NAME}</title>
    <link>${escapeXml(`${siteUrl}/blog/`)}</link>
    <description>${SITE_NAME} · zreo 的技术博客</description>
    <language>zh-CN</language>
    <atom:link href="${escapeXml(`${siteUrl}/rss.xml`)}" rel="self" type="application/rss+xml"/>${last}
${items}
  </channel>
</rss>
`;
}

/** includeResume=false while the résumé is shown unmasked (that page is noindex). */
export function sitemap(siteUrl: string, posts: ListRow[], categorySlugs: string[], includeResume = true): string {
  const urls = [
    `  <url><loc>${escapeXml(`${siteUrl}/`)}</loc></url>`,
    `  <url><loc>${escapeXml(`${siteUrl}/blog/`)}</loc></url>`,
    ...(includeResume ? [`  <url><loc>${escapeXml(`${siteUrl}/resume/`)}</loc></url>`] : []),
    ...categorySlugs.map((s) => `  <url><loc>${escapeXml(`${siteUrl}${catHref(s)}`)}</loc></url>`),
    ...posts.map((r) => `  <url><loc>${escapeXml(`${siteUrl}${postHref(r.slug)}`)}</loc><lastmod>${r.updated_at.slice(0, 10)}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}
