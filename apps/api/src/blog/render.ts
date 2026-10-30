import MarkdownIt, { type MarkdownIt as Md, type Token } from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import { createHighlighter, type Highlighter } from 'shiki';

const LANGS = [
  'ts', 'js', 'json', 'bash', 'shell', 'python', 'go', 'rust', 'java',
  'html', 'css', 'yaml', 'sql', 'diff', 'markdown', 'dockerfile',
];
const THEMES = { light: 'github-light', dark: 'github-dark' } as const;
export const MAX_HIGHLIGHT_CHARS = 64 * 1024;

let highlighterP: Promise<Highlighter> | undefined;
let md: Md | undefined;

/** Shiki is created once per process; the first render pays the startup cost. */
function getHighlighter(): Promise<Highlighter> {
  highlighterP ??= createHighlighter({ themes: Object.values(THEMES), langs: LANGS }).catch((err: unknown) => {
    highlighterP = undefined;
    throw err;
  });
  return highlighterP;
}

/** http(s), mailto, same-site relative paths and #fragments. Protocol-relative and other schemes are refused. */
export function isAllowedLink(url: string): boolean {
  const s = url.trim().toLowerCase();
  if (s.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/.test(s)) return /^(https?|mailto):/.test(s);
  return !s.startsWith('\\');
}

function build(hl: Highlighter): Md {
  const loaded = new Set(hl.getLoadedLanguages().map(String));
  const m: Md = new MarkdownIt({
    html: false,
    linkify: false,
    highlight: (code, lang) => {
      // Huge blocks skip Shiki (CPU); '' makes markdown-it emit an escaped <pre><code>.
      if (code.length > MAX_HIGHLIGHT_CHARS) return '';
      const l = lang.trim().toLowerCase();
      return hl.codeToHtml(code.replace(/\n$/, ''), { lang: loaded.has(l) ? l : 'text', themes: THEMES, defaultColor: false });
    },
  });
  m.validateLink = isAllowedLink;

  const defaultLinkOpen = m.renderer.rules.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
  m.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const token = tokens[idx]!;
    if (/^https?:/i.test(String(token.attrGet('href') ?? ''))) {
      token.attrSet('rel', 'noopener noreferrer');
      token.attrSet('target', '_blank');
    }
    return defaultLinkOpen(tokens, idx, opts, env, self);
  };
  const defaultImage = m.renderer.rules.image!;
  m.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const token = tokens[idx]!;
    token.attrSet('loading', 'lazy');
    token.attrSet('decoding', 'async');
    return defaultImage(tokens, idx, opts, env, self);
  };
  return m;
}

const SHIKI_COLOR = [/^#[0-9a-f]{3,8}$/i];
const SHIKI_STYLE: Record<string, RegExp[]> = {
  '--shiki-light': SHIKI_COLOR,
  '--shiki-dark': SHIKI_COLOR,
  '--shiki-light-bg': SHIKI_COLOR,
  '--shiki-dark-bg': SHIKI_COLOR,
  '--shiki-light-font-style': [/^(italic|normal|inherit)$/],
  '--shiki-dark-font-style': [/^(italic|normal|inherit)$/],
  '--shiki-light-font-weight': [/^(bold|normal|inherit|\d{3})$/],
  '--shiki-dark-font-weight': [/^(bold|normal|inherit|\d{3})$/],
  '--shiki-light-text-decoration': [/^(underline|line-through|none|inherit)$/],
  '--shiki-dark-text-decoration': [/^(underline|line-through|none|inherit)$/],
};
const ALIGN = { 'text-align': [/^(left|right|center)$/] };

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'blockquote', 'ul', 'ol', 'li',
    'strong', 'em', 's', 'code', 'pre', 'span', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target'],
    img: ['src', 'alt', 'title', 'loading', 'decoding'],
    pre: ['class', 'style', 'tabindex'],
    h2: ['id'],
    h3: ['id'],
    span: ['class', 'style'],
    ol: ['start'],
    th: ['style'],
    td: ['style'],
  },
  allowedClasses: { pre: ['shiki', 'shiki-themes', 'github-light', 'github-dark'], span: ['line'] },
  allowedStyles: { pre: SHIKI_STYLE, span: SHIKI_STYLE, th: ALIGN, td: ALIGN },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // Second guard behind the renderer: an h2/h3 id survives only in the generated format.
  transformTags: { h2: checkHeadingId, h3: checkHeadingId },
};

export interface TocItem {
  level: 2 | 3;
  id: string;
  text: string;
}

export interface Rendered {
  html: string;
  toc: TocItem[];
}

/** Markdown → sanitized HTML plus the h2/h3 table of contents (ids match the html). Raw HTML is shown as text. */
export async function renderPost(markdown: string): Promise<Rendered> {
  md ??= build(await getHighlighter());
  const env = {};
  const tokens = md.parse(markdown, env);
  const toc = addHeadingIds(tokens);
  return { html: sanitizeHtml(md.renderer.render(tokens, md.options, env), SANITIZE), toc };
}

/** The final whitelist pass on its own (exported for tests). */
export function sanitizePostHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE);
}

export async function renderMarkdown(markdown: string): Promise<string> {
  return (await renderPost(markdown)).html;
}

// ---------- heading anchors ----------

export const HEADING_ID_RE = /^h-[\p{L}\p{N}_-]{1,64}$/u;
const MAX_SLUG = 60;

function checkHeadingId(tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag {
  const { id, ...rest } = attribs;
  return { tagName, attribs: id !== undefined && HEADING_ID_RE.test(id) ? { ...rest, id } : rest };
}

/** Removes leading/trailing '-' without a regex (`-+$` backtracks quadratically on long dash runs). */
function trimDashes(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && s[a] === '-') a++;
  while (b > a && s[b - 1] === '-') b--;
  return s.slice(a, b);
}

/**
 * Heading text → slug: lowercase, whitespace → '-', keep only letters, digits, '-', '_',
 * trim '-', at most 60 characters. Each step is a single linear pass.
 */
export function slugifyHeading(text: string): string {
  const s = trimDashes(text.toLowerCase().replace(/\s/gu, '-').replace(/[^\p{L}\p{N}_-]/gu, ''));
  const chars = [...s];
  return chars.length > MAX_SLUG ? trimDashes(chars.slice(0, MAX_SLUG).join('')) : s;
}

function inlineText(t: Token | undefined): string {
  let out = '';
  for (const c of t?.children ?? []) {
    if (c.type === 'text' || c.type === 'code_inline' || c.type === 'image') out += c.content;
    else if (c.type === 'softbreak' || c.type === 'hardbreak') out += ' ';
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Only the first MAX_TOC_HEADINGS h2/h3 get ids and toc entries; more is never useful and bounds the work. */
const MAX_TOC_HEADINGS = 200;

/** Sets `id` on h2/h3 open tokens (unique per document, `h-` prefixed) and returns the toc. */
function addHeadingIds(tokens: Token[]): TocItem[] {
  const toc: TocItem[] = [];
  const used = new Set<string>();
  // Next suffix to try per base, so k duplicates cost O(k) rather than O(k²).
  const nextSuffix = new Map<string, number>();
  let empty = 0;
  for (let i = 0; i < tokens.length && toc.length < MAX_TOC_HEADINGS; i++) {
    const t = tokens[i]!;
    if (t.type !== 'heading_open' || (t.tag !== 'h2' && t.tag !== 'h3')) continue;
    const text = inlineText(tokens[i + 1]);
    const base = slugifyHeading(text) || `section-${++empty}`;
    let id = base;
    if (used.has(id)) {
      const chars = [...base];
      let n = nextSuffix.get(base) ?? 2;
      do {
        const suffix = `-${n++}`;
        // Keep the whole id within the 64-character whitelist limit.
        id = `${chars.slice(0, MAX_SLUG + 2 - suffix.length).join('')}${suffix}`;
      } while (used.has(id));
      nextSuffix.set(base, n);
    }
    used.add(id);
    const full = `h-${id}`;
    t.attrSet('id', full);
    toc.push({ level: t.tag === 'h2' ? 2 : 3, id: full, text });
  }
  return toc;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Plain text of rendered (already sanitized) HTML, for summaries and search. */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
