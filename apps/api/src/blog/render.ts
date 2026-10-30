import MarkdownIt, { type MarkdownIt as Md } from 'markdown-it';
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
};

/** Markdown → sanitized HTML. Raw HTML in the source is shown as text, never rendered. */
export async function renderMarkdown(markdown: string): Promise<string> {
  md ??= build(await getHighlighter());
  return sanitizeHtml(md.render(markdown), SANITIZE);
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
