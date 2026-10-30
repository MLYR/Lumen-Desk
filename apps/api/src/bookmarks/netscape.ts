/**
 * Netscape bookmark file (what Chrome, Edge, Firefox and Safari export/import).
 * The parser is a single forward scan: every character is looked at a bounded number of times,
 * so hostile input (unclosed tags, huge attribute values) stays linear. No backtracking regexes.
 */

export interface ParsedLink {
  title: string;
  url: string;
  addDate: number | null;
}

export interface ParsedFolder {
  name: string;
  addDate: number | null;
  lastModified: number | null;
  folders: ParsedFolder[];
  links: ParsedLink[];
}

/** Same shape with every date filled in: what the exporter and snapshots use. */
export interface ExportLink {
  title: string;
  url: string;
  addDate: number;
}
export interface ExportFolder {
  name: string;
  addDate: number;
  lastModified: number;
  folders: ExportFolder[];
  links: ExportLink[];
}

export const MAX_DEPTH = 32;
export const MAX_ITEMS = 20_000;
export const MAX_TITLE = 300;
export const MAX_FOLDER_NAME = 100;
export const MAX_URL = 2048;

export class BookmarkParseError extends Error {}

/** Top-level browser container folders, flattened into the root (same rule as before P2.8, plus Safari). */
const WRAPPER_NAMES = new Set([
  '书签栏',
  '其他书签',
  '移动设备书签',
  'bookmarks bar',
  'bookmarks toolbar',
  'other bookmarks',
  'mobile bookmarks',
  'bookmarks menu',
  '收藏夹栏',
  '其他收藏夹',
  'favorites',
  '个人收藏',
]);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/** Bounded entity pattern: each '&' is tried against at most ~10 characters. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{1,8});/g, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex
export const HAS_CONTROL = /[\u0000-\u001f\u007f]/;

/** First `max` code points. Slices first so a 5 MiB title never becomes a 5M-element array. */
export const clip = (s: string, max: number) => {
  const chars = [...s.slice(0, max * 2)];
  return chars.length > max ? chars.slice(0, max).join('').trim() : s;
};
// Truncate before decoding: a single 5 MiB field of `&amp;` would otherwise expand in one replace()
// and can OOM the 256 MiB container. Entities are at most ~10 chars, so this keeps every visible char we'd keep.
const cleanText = (raw: string) => decodeEntities(raw.slice(0, MAX_TITLE * 10)).replace(CONTROL, ' ').trim();

const isNameChar = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45;
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13 || c === 12;

/** Attributes of one tag (the text between the tag name and '>'). Names upper-cased. Linear. */
function parseAttrs(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  const n = raw.length;
  let i = 0;
  while (i < n) {
    while (i < n && !isNameChar(raw.charCodeAt(i))) i++;
    const s = i;
    while (i < n && isNameChar(raw.charCodeAt(i))) i++;
    if (s === i) break;
    const name = raw.slice(s, i).toUpperCase();
    while (i < n && isSpace(raw.charCodeAt(i))) i++;
    if (raw[i] !== '=') {
      if (!out.has(name)) out.set(name, '');
      continue;
    }
    i++;
    while (i < n && isSpace(raw.charCodeAt(i))) i++;
    let value: string;
    const q = raw[i];
    if (q === '"' || q === "'") {
      const end = raw.indexOf(q, i + 1);
      const e = end < 0 ? n : end;
      value = raw.slice(i + 1, e);
      i = e + 1;
    } else {
      const s2 = i;
      while (i < n && !isSpace(raw.charCodeAt(i))) i++;
      value = raw.slice(s2, i);
    }
    // Oversized values are dropped later anyway (MAX_URL); don't decode them (memory, see cleanText).
    if (!out.has(name)) out.set(name, value.length > MAX_URL * 8 ? value : decodeEntities(value));
  }
  return out;
}

const dateAttr = (v: string | undefined): number | null => {
  if (v === undefined || !/^[0-9]{1,12}$/.test(v)) return null;
  return Number(v);
};

/**
 * Parses an exported bookmark file. Folders keep their file order, links theirs; within a folder
 * the app shows folders before links. Top-level browser containers are flattened; links directly
 * in the root (or in a container) go into a trailing「未分类」folder. Empty folders are kept.
 * Throws BookmarkParseError beyond MAX_DEPTH levels or MAX_ITEMS entries.
 */
export function parseBookmarksHtml(html: string): ParsedFolder[] {
  const root: ParsedFolder & { attrs?: Map<string, string> } = { name: '', addDate: null, lastModified: null, folders: [], links: [] };
  const wrappers = new WeakSet<ParsedFolder>();
  const stack: ParsedFolder[] = [root];
  let pending: ParsedFolder | null = null;
  let sawRootDl = false;
  let strayDl = 0;
  let items = 0;
  const n = html.length;
  let i = 0;

  const bump = () => {
    if (++items > MAX_ITEMS) throw new BookmarkParseError(`书签条目超过 ${MAX_ITEMS} 条`);
  };

  for (;;) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    let j = lt + 1;
    const closing = html.charCodeAt(j) === 47; // '/'
    if (closing) j++;
    let k = j;
    while (k < n && k - j < 16 && isNameChar(html.charCodeAt(k))) k++;
    const name = html.slice(j, k).toUpperCase();
    if (!name) {
      i = lt + 1;
      continue;
    }
    // Find the tag's '>', skipping quoted attribute values (a quote only opens right after '=').
    let e = k;
    let quote = 0;
    let prev = 0;
    for (; e < n; e++) {
      const c = html.charCodeAt(e);
      if (quote) {
        if (c === quote) quote = 0;
      } else if ((c === 34 || c === 39) && prev === 61) quote = c;
      else if (c === 62) break;
      if (!isSpace(c)) prev = c;
    }
    if (e >= n) break; // unterminated tag: nothing usable follows
    const attrsRaw = html.slice(k, e);
    i = e + 1;

    if (name === 'DL') {
      if (!closing) {
        if (pending) {
          stack.push(pending);
          pending = null;
          // root + one container level + MAX_DEPTH real levels
          if (stack.length > MAX_DEPTH + 2) throw new BookmarkParseError(`文件夹嵌套超过 ${MAX_DEPTH} 层`);
        } else if (!sawRootDl) sawRootDl = true;
        else strayDl++;
      } else {
        pending = null;
        if (strayDl > 0) strayDl--;
        else if (stack.length > 1) stack.pop();
      }
      continue;
    }
    if (closing || (name !== 'H3' && name !== 'A')) continue;

    // Text runs to the next '<' (browsers escape '<' in titles). Then swallow a matching close tag.
    const textEnd = html.indexOf('<', i);
    const end = textEnd < 0 ? n : textEnd;
    const text = cleanText(html.slice(i, end));
    i = end;
    if (textEnd >= 0 && html.charCodeAt(textEnd + 1) === 47) {
      let p = textEnd + 2;
      const s = p;
      while (p < n && p - s < 4 && isNameChar(html.charCodeAt(p))) p++;
      if (html.slice(s, p).toUpperCase() === name) {
        while (p < n && p - s < 16 && isSpace(html.charCodeAt(p))) p++;
        if (html.charCodeAt(p) === 62) i = p + 1;
      }
    }

    const attrs = parseAttrs(attrsRaw);
    const top = stack[stack.length - 1]!;
    if (name === 'H3') {
      bump();
      const folder: ParsedFolder = {
        name: clip(text, MAX_FOLDER_NAME) || '未命名',
        addDate: dateAttr(attrs.get('ADD_DATE')),
        lastModified: dateAttr(attrs.get('LAST_MODIFIED')),
        folders: [],
        links: [],
      };
      if (top === root && (attrs.has('PERSONAL_TOOLBAR_FOLDER') || attrs.has('UNFILED_BOOKMARKS_FOLDER') || WRAPPER_NAMES.has(folder.name.toLowerCase()))) {
        wrappers.add(folder);
      }
      top.folders.push(folder);
      pending = folder;
    } else {
      pending = null; // a link right after an H3 means that folder had no <DL>
      const url = (attrs.get('HREF') ?? '').trim();
      if (!url || url.length > MAX_URL || HAS_CONTROL.test(url)) continue;
      bump();
      top.links.push({ title: clip(text, MAX_TITLE) || url, url, addDate: dateAttr(attrs.get('ADD_DATE')) });
    }
  }

  const out: ParsedFolder[] = [];
  const loose: ParsedLink[] = [...root.links];
  for (const f of root.folders) {
    if (wrappers.has(f)) {
      out.push(...f.folders);
      loose.push(...f.links);
    } else out.push(f);
  }
  if (loose.length) out.push({ name: '未分类', addDate: null, lastModified: null, folders: [], links: loose });
  if (treeDepth(out) > MAX_DEPTH) throw new BookmarkParseError(`文件夹嵌套超过 ${MAX_DEPTH} 层`);
  return out;
}

/** Height of a forest (top-level folders = 1). */
export function treeDepth(folders: Array<{ folders: unknown[] }>): number {
  let max = 0;
  const walk = (fs: Array<{ folders: unknown[] }>, d: number) => {
    for (const f of fs) {
      if (d > max) max = d;
      walk(f.folders as Array<{ folders: unknown[] }>, d + 1);
    }
  };
  walk(folders, 1);
  return max;
}

export function countTree(folders: Array<{ folders: unknown[]; links: unknown[] }>): { folders: number; links: number } {
  let nf = 0;
  let nl = 0;
  const walk = (fs: Array<{ folders: unknown[]; links: unknown[] }>) => {
    for (const f of fs) {
      nf++;
      nl += f.links.length;
      walk(f.folders as typeof fs);
    }
  };
  walk(folders);
  return { folders: nf, links: nl };
}

const escText = (s: string) => s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
const escHref = (s: string) => s.replace(/[&"]/g, (c) => (c === '&' ? '&amp;' : '&quot;'));

/**
 * Chrome-style export. All site folders go under one「书签栏」with PERSONAL_TOOLBAR_FOLDER so
 * Chrome/Edge put them on the bookmarks bar. 4-space indent, '\n' line ends. Deterministic:
 * the container's dates are derived from its children (emptySec when there are none).
 */
export function exportBookmarksHtml(folders: ExportFolder[], emptySec: number): string {
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];
  // A loop, not Math.min(...spread): thousands of top-level folders must not hit the argument limit.
  let add = folders.length ? Infinity : emptySec;
  let mod = folders.length ? -Infinity : emptySec;
  for (const f of folders) {
    if (f.addDate < add) add = f.addDate;
    if (f.lastModified > mod) mod = f.lastModified;
  }
  lines.push(`    <DT><H3 ADD_DATE="${add}" LAST_MODIFIED="${mod}" PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>`, '    <DL><p>');
  const walk = (fs: ExportFolder[], pad: string) => {
    for (const f of fs) {
      lines.push(`${pad}<DT><H3 ADD_DATE="${f.addDate}" LAST_MODIFIED="${f.lastModified}">${escText(f.name)}</H3>`, `${pad}<DL><p>`);
      walk(f.folders, `${pad}    `);
      for (const l of f.links) lines.push(`${pad}    <DT><A HREF="${escHref(l.url)}" ADD_DATE="${l.addDate}">${escText(l.title)}</A>`);
      lines.push(`${pad}</DL><p>`);
    }
  };
  walk(folders, '        ');
  lines.push('    </DL><p>', '</DL><p>');
  return `${lines.join('\n')}\n`;
}
