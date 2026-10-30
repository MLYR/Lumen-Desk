import fs from 'node:fs/promises';
import path from 'node:path';

export type Link = [title: string, url: string];
export interface BookmarkNode {
  name: string;
  children?: BookmarkNode[];
  links?: Link[];
}

/** Chrome/Edge/Firefox wrapper folders that get flattened away at the top level. */
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
]);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function stripTags(s: string): string {
  return decode(s.replace(/<[^>]*>/g, '')).trim();
}

interface Folder {
  name: string;
  attrs: string;
  children: Folder[];
  links: Link[];
}

/** Parses Netscape bookmark HTML: H3 = folder, A = link, DL = nesting. */
export function parseNetscapeBookmarks(html: string): BookmarkNode[] {
  const root: Folder = { name: '', attrs: '', children: [], links: [] };
  const stack: Folder[] = [root];
  let pending: Folder | null = null; // folder whose <DL> has not opened yet
  const re = /<DL\b[^>]*>|<\/DL\s*>|<H3\b([^>]*)>([\s\S]*?)<\/H3\s*>|<A\b([^>]*)>([\s\S]*?)<\/A\s*>/gi;
  let sawRootDl = false;
  for (let m: RegExpExecArray | null; (m = re.exec(html)); ) {
    const tag = m[0].slice(0, 3).toUpperCase();
    const top = stack[stack.length - 1]!;
    if (tag === '<DL') {
      if (pending) {
        stack.push(pending);
        pending = null;
      } else if (!sawRootDl) {
        sawRootDl = true; // outermost <DL> belongs to root
      }
    } else if (tag === '</D') {
      pending = null;
      if (stack.length > 1) stack.pop();
    } else if (tag === '<H3') {
      const folder: Folder = { name: stripTags(m[2] ?? ''), attrs: m[1] ?? '', children: [], links: [] };
      top.children.push(folder);
      pending = folder;
    } else {
      const href = /\bHREF\s*=\s*"([^"]*)"/i.exec(m[3] ?? '')?.[1];
      if (href) {
        const url = decode(href).trim();
        top.links.push([stripTags(m[4] ?? '') || url, url]);
      }
    }
  }

  // Flatten top-level wrapper folders (e.g. 书签栏) into the root.
  const isWrapper = (f: Folder) =>
    /PERSONAL_TOOLBAR_FOLDER|UNFILED_BOOKMARKS_FOLDER/i.test(f.attrs) || WRAPPER_NAMES.has(f.name.toLowerCase());
  const topFolders: Folder[] = [];
  const looseLinks: Link[] = [...root.links];
  for (const f of root.children) {
    if (isWrapper(f)) {
      topFolders.push(...f.children);
      looseLinks.push(...f.links);
    } else {
      topFolders.push(f);
    }
  }

  const toNode = (f: Folder): BookmarkNode | null => {
    const node: BookmarkNode = { name: f.name || '未命名' };
    const children = f.children.map(toNode).filter((n): n is BookmarkNode => n !== null);
    if (children.length) node.children = children;
    if (f.links.length) node.links = f.links;
    return children.length || f.links.length ? node : null;
  };
  const out = topFolders.map(toNode).filter((n): n is BookmarkNode => n !== null);
  if (looseLinks.length) out.push({ name: '未分类', links: looseLinks });
  return out;
}

export const BOOKMARKS_FILE = 'bookmarks.json';

export async function readBookmarks(dataDir: string): Promise<BookmarkNode[] | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, BOOKMARKS_FILE), 'utf8')) as BookmarkNode[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
