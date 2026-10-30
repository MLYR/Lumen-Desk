import fs from 'node:fs';
import path from 'node:path';
import { effectiveSummary, localDate, type ListRow, type PostRow } from './posts.js';
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
const postHref = (slug: string) => `/blog/${slug}/`;

export function postPage(r: PostRow): string {
  const tags = JSON.parse(r.tags) as string[];
  const date = r.published_at ? localDate(r.published_at) : '';
  const meta = [
    date ? `<time datetime="${date}">${date}</time>` : '',
    ...tags.map((t) => `<a class="tag" href="${escapeHtml(tagHref(t))}">${escapeHtml(t)}</a>`),
  ].join('');
  return `<article class="post">
  <header class="post-head">
    <a class="back" href="/blog/">← 全部文章</a>
    <h1 class="post-title">${escapeHtml(r.title)}</h1>
    <div class="post-meta">${meta}</div>
  </header>
  <div class="prose">${r.html}</div>
</article>`;
}

/** List page; posts must already be sorted by published_at descending. */
export function indexPage(heading: string, posts: ListRow[]): string {
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
      `      <li><a href="${postHref(r.slug)}"><span class="d">${d.slice(5)}</span><div><div class="t">${escapeHtml(r.title)}</div><div class="s">${escapeHtml(effectiveSummary(r))}</div></div><span class="tags">${tags}</span></a></li>`,
    );
  }
  flush();
  return `<section class="post-index">
  <h1 class="page-title">${escapeHtml(heading)}</h1>
${groups.join('\n')}${posts.length ? '' : '\n  <p class="empty">还没有文章。</p>'}
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
      const cats = (JSON.parse(r.tags) as string[]).map((t) => `      <category>${escapeXml(t)}</category>`).join('\n');
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

export function sitemap(siteUrl: string, posts: ListRow[]): string {
  const urls = [
    `  <url><loc>${escapeXml(`${siteUrl}/`)}</loc></url>`,
    `  <url><loc>${escapeXml(`${siteUrl}/blog/`)}</loc></url>`,
    ...posts.map((r) => `  <url><loc>${escapeXml(`${siteUrl}${postHref(r.slug)}`)}</loc><lastmod>${r.updated_at.slice(0, 10)}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}
