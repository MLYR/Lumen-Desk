import fs from 'node:fs';
import path from 'node:path';
import { kvGet, kvSet, tx, type DB } from '../db.js';
import { InputError, NotFoundError } from '../http.js';
import {
  clip,
  countTree,
  type ExportFolder,
  HAS_CONTROL,
  MAX_DEPTH,
  MAX_FOLDER_NAME,
  MAX_ITEMS,
  MAX_TITLE,
  MAX_URL,
  type ParsedFolder,
  treeDepth,
} from './netscape.js';

/*
 * Tables (added to SCHEMA in db.ts):
 *   bookmark_folders(id, parent_id REFERENCES bookmark_folders ON DELETE CASCADE, name, sort, add_date, last_modified, created_at, updated_at)
 *   bookmarks(id, folder_id NOT NULL REFERENCES bookmark_folders ON DELETE CASCADE, title, url, sort, add_date, created_at, updated_at)
 *   bookmark_snapshots(id, reason CHECK IN (...), tree TEXT, count, created_at)
 * Times: created_at/updated_at ms; add_date/last_modified Unix seconds (as in the export).
 */

export class InvalidMoveError extends Error {}

export const LEGACY_FILE = 'bookmarks.json';
const MAX_SNAPSHOTS = 10;
/** A snapshot larger than this is refused: JSON.stringify/parse of the whole tree must fit the 256 MiB container. */
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MIGRATED_KEY = 'bookmarks_migrated';
export const BULK_DELETE_SNAPSHOT_OVER = 20;
const len = (s: string) => [...s].length;
const sec = (ms: number) => Math.floor(ms / 1000);

// ---------- read ----------

interface FolderRow {
  id: number;
  parent_id: number | null;
  name: string;
  sort: number;
  add_date: number | null;
  last_modified: number | null;
  created_at: number;
}
interface LinkRow {
  id: number;
  folder_id: number;
  title: string;
  url: string;
  sort: number;
  add_date: number | null;
  created_at: number;
}

interface Node {
  row: FolderRow;
  folders: Node[];
  links: LinkRow[];
}

function loadForest(db: DB): Node[] {
  const folders = db.prepare('SELECT id, parent_id, name, sort, add_date, last_modified, created_at FROM bookmark_folders ORDER BY sort, id').all() as unknown as FolderRow[];
  const links = db.prepare('SELECT id, folder_id, title, url, sort, add_date, created_at FROM bookmarks ORDER BY sort, id').all() as unknown as LinkRow[];
  const byId = new Map<number, Node>(folders.map((r) => [r.id, { row: r, folders: [], links: [] }]));
  const roots: Node[] = [];
  for (const n of byId.values()) {
    const parent = n.row.parent_id === null ? undefined : byId.get(n.row.parent_id);
    (parent ? parent.folders : roots).push(n);
  }
  for (const l of links) byId.get(l.folder_id)?.links.push(l);
  return roots;
}

/** GET /api/private/bookmarks: legacy fields (name, children?, links?) plus id and items. */
export interface ApiFolder {
  id: number;
  name: string;
  children?: ApiFolder[];
  links?: Array<[string, string]>;
  items: Array<{ id: number; title: string; url: string }>;
}

export function getTree(db: DB): ApiFolder[] {
  const conv = (n: Node): ApiFolder => {
    const out: ApiFolder = { id: n.row.id, name: n.row.name, items: n.links.map((l) => ({ id: l.id, title: l.title, url: l.url })) };
    if (n.folders.length) out.children = n.folders.map(conv);
    if (n.links.length) out.links = n.links.map((l) => [l.title, l.url]);
    return out;
  };
  return loadForest(db).map(conv);
}

export function hasBookmarks(db: DB): boolean {
  return db.prepare('SELECT 1 FROM bookmark_folders LIMIT 1').get() !== undefined;
}

/** Full tree with every date filled (created_at as fallback): export and snapshots. */
export function exportTree(db: DB): ExportFolder[] {
  const conv = (n: Node): ExportFolder => {
    const add = n.row.add_date ?? sec(n.row.created_at);
    return {
      name: n.row.name,
      addDate: add,
      lastModified: n.row.last_modified ?? add,
      folders: n.folders.map(conv),
      links: n.links.map((l) => ({ title: l.title, url: l.url, addDate: l.add_date ?? sec(l.created_at) })),
    };
  };
  return loadForest(db).map(conv);
}

// ---------- write whole trees (import, restore, migration) ----------

/** Inserts a parsed tree under parentId. Caller holds the transaction. */
function insertForest(db: DB, folders: ParsedFolder[], parentId: number | null, nowMs: number, startSort = 0): void {
  const insF = db.prepare('INSERT INTO bookmark_folders (parent_id, name, sort, add_date, last_modified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insL = db.prepare('INSERT INTO bookmarks (folder_id, title, url, sort, add_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const walk = (fs: ParsedFolder[], parent: number | null, base: number) => {
    fs.forEach((f, i) => {
      const id = Number(insF.run(parent, f.name, base + i, f.addDate, f.lastModified, nowMs, nowMs).lastInsertRowid);
      f.links.forEach((l, j) => insL.run(id, l.title, l.url, j, l.addDate, nowMs, nowMs));
      walk(f.folders, id, 0);
    });
  };
  walk(folders, parentId, startSort);
}

function clearAll(db: DB): void {
  db.exec('DELETE FROM bookmarks; DELETE FROM bookmark_folders;');
}

// ---------- snapshots ----------

export type SnapshotReason = 'import' | 'bulk-delete' | 'manual' | 'restore';

export function saveSnapshot(db: DB, reason: SnapshotReason, nowMs: number): number {
  const tree = exportTree(db);
  const { links } = countTree(tree);
  const json = JSON.stringify(tree);
  if (json.length > MAX_SNAPSHOT_BYTES) throw new InputError('书签太多，超过了快照的大小上限（8 MB）');
  const id = Number(db.prepare('INSERT INTO bookmark_snapshots (reason, tree, count, created_at) VALUES (?, ?, ?, ?)').run(reason, json, links, nowMs).lastInsertRowid);
  db.prepare('DELETE FROM bookmark_snapshots WHERE id NOT IN (SELECT id FROM bookmark_snapshots ORDER BY created_at DESC, id DESC LIMIT ?)').run(MAX_SNAPSHOTS);
  return id;
}

export function listSnapshots(db: DB): Array<{ id: number; reason: SnapshotReason; count: number; createdAt: string }> {
  return (db.prepare('SELECT id, reason, count, created_at FROM bookmark_snapshots ORDER BY created_at DESC, id DESC').all() as Array<Record<string, number | string>>).map((r) => ({
    id: Number(r.id),
    reason: r.reason as SnapshotReason,
    count: Number(r.count),
    createdAt: new Date(Number(r.created_at)).toISOString(),
  }));
}

/** Saves a 'restore' snapshot of the current tree, then replaces it with snapshot `id`. One transaction. */
export function restoreSnapshot(db: DB, id: number, nowMs: number): { folders: number; links: number } {
  return tx(db, () => {
    const row = db.prepare('SELECT tree FROM bookmark_snapshots WHERE id = ?').get(id) as { tree: string } | undefined;
    if (!row) throw new NotFoundError();
    const tree = JSON.parse(row.tree) as ExportFolder[];
    saveSnapshot(db, 'restore', nowMs);
    clearAll(db);
    insertForest(db, tree, null, nowMs);
    return countTree(tree);
  });
}

// ---------- import ----------

export function importTree(db: DB, tree: ParsedFolder[], mode: 'replace' | 'merge', nowMs: number, mergeName: string): { folders: number; links: number } {
  const counts = countTree(tree);
  // An empty file would wipe everything in replace mode: almost certainly the wrong file.
  if (counts.folders + counts.links === 0) throw new InputError('文件里没有书签');
  if (mode === 'merge' && treeDepth(tree) + 1 > MAX_DEPTH) throw new InputError(`合并后文件夹会超过 ${MAX_DEPTH} 层`);
  return tx(db, () => {
    saveSnapshot(db, 'import', nowMs);
    if (mode === 'replace') {
      clearAll(db);
      insertForest(db, tree, null, nowMs);
    } else {
      if (itemCount(db) + counts.folders + counts.links + 1 > MAX_ITEMS) throw new InputError(`合并后书签条目会超过 ${MAX_ITEMS} 条`);
      const sort = Number((db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM bookmark_folders WHERE parent_id IS NULL').get() as { n: number }).n);
      // Wrapper folder for the merge; top-level loose links in the file end up in its「未分类」child.
      insertForest(db, [{ name: mergeName, addDate: sec(nowMs), lastModified: sec(nowMs), folders: tree, links: [] }], null, nowMs, sort);
    }
    return counts;
  });
}

// ---------- migration from bookmarks.json ----------

type LegacyNode = { name?: unknown; children?: unknown; links?: unknown };

function legacyToParsed(nodes: unknown, depth = 1): ParsedFolder[] {
  if (!Array.isArray(nodes)) throw new Error('bookmarks.json: not an array');
  if (depth > MAX_DEPTH) throw new Error('bookmarks.json: nested too deep');
  return nodes.map((raw) => {
    const n = raw as LegacyNode;
    const name = typeof n.name === 'string' && n.name.trim() ? clip(n.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim(), MAX_FOLDER_NAME) : '未命名';
    const links = (Array.isArray(n.links) ? n.links : []).flatMap((l) => {
      if (!Array.isArray(l) || typeof l[1] !== 'string') return [];
      const url = l[1].trim();
      if (!url || url.length > MAX_URL || HAS_CONTROL.test(url)) return [];
      const t = typeof l[0] === 'string' ? l[0].replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
      return [{ title: clip(t || url, MAX_TITLE), url, addDate: null }];
    });
    return { name, addDate: null, lastModified: null, folders: n.children === undefined ? [] : legacyToParsed(n.children, depth + 1), links };
  });
}

/**
 * One-time move of DATA_DIR/bookmarks.json into SQLite. Runs only when the tables are empty and the
 * file exists. Insert happens in a transaction; the file is renamed to bookmarks.json.migrated only
 * after COMMIT. Any failure rolls back and leaves the file alone. Logs counts only, never content.
 * Dates: the old file has none, so add_date stays NULL and exports use created_at (= migration time).
 */
export function migrateLegacyFile(db: DB, dataDir: string, nowMs: number, log: (msg: string) => void = console.log): boolean {
  if (dataDir === ':memory:') return false;
  const file = path.join(dataDir, LEGACY_FILE);
  if (!fs.existsSync(file)) return false;
  // Once migrated, never re-import, even if the rename failed and the user later emptied the tree.
  if (kvGet(db, MIGRATED_KEY)) return false;
  if (hasBookmarks(db)) {
    log(`[bookmarks] ${LEGACY_FILE} ignored: the database already has bookmarks`);
    return false;
  }
  let tree: ParsedFolder[];
  try {
    tree = legacyToParsed(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    log(`[bookmarks] ${LEGACY_FILE} could not be read (${(err as Error).name}); left in place`);
    return false;
  }
  const counts = countTree(tree);
  try {
    tx(db, () => {
      if (hasBookmarks(db)) throw new Error('not empty');
      insertForest(db, tree, null, nowMs);
      kvSet(db, MIGRATED_KEY, String(nowMs));
    });
  } catch (err) {
    log(`[bookmarks] migration failed and was rolled back (${(err as Error).name}); ${LEGACY_FILE} left in place`);
    return false;
  }
  log(`[bookmarks] migrated ${counts.folders} folders and ${counts.links} links from ${LEGACY_FILE}`);
  try {
    fs.renameSync(file, `${file}.migrated`);
  } catch (err) {
    // The data is already in SQLite and the table is no longer empty, so this never re-imports.
    log(`[bookmarks] could not rename ${LEGACY_FILE} (${(err as NodeJS.ErrnoException).code ?? 'error'}); it is no longer read`);
  }
  return true;
}
// ---------- appended to store.ts: single-item CRUD ----------

function text(v: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof v !== 'string') throw new InputError(`${field} 必须是文字`);
  const s = v.trim();
  if ((!allowEmpty && !s) || len(s) > max) throw new InputError(`${field} ${allowEmpty ? '最多' : '1–'}${max} 字`);
  if (HAS_CONTROL.test(s)) throw new InputError(`${field} 不能含控制字符`);
  return s;
}
function url(v: unknown): string {
  if (typeof v !== 'string') throw new InputError('url 必须是文字');
  const s = v.trim();
  if (!s || s.length > MAX_URL || HAS_CONTROL.test(s)) throw new InputError(`url 不能为空、不能超过 ${MAX_URL} 字符、不能含控制字符`);
  return s; // any scheme: chrome://, file://, javascript: are stored as-is (the console never makes them clickable)
}
const optId = (v: unknown, field: string): number | null => {
  if (v === null) return null;
  if (!Number.isSafeInteger(v) || (v as number) < 1) throw new InputError(`${field} 必须是正整数或 null`);
  return v as number;
};
const reqId = (v: unknown, field: string): number => {
  const id = optId(v, field);
  if (id === null) throw new InputError(`${field} 必须是正整数`);
  return id;
};
const obj = (b: unknown) => {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new InputError('请求体必须是对象');
  return b as Record<string, unknown>;
};

const folderExists = (db: DB, id: number) => db.prepare('SELECT 1 FROM bookmark_folders WHERE id = ?').get(id) !== undefined;
const nextSort = (db: DB, table: 'bookmark_folders' | 'bookmarks', col: 'parent_id' | 'folder_id', parent: number | null) =>
  Number((db.prepare(`SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM ${table} WHERE ${col} IS ?`).get(parent) as { n: number }).n);
const itemCount = (db: DB) =>
  Number((db.prepare('SELECT (SELECT COUNT(*) FROM bookmarks) + (SELECT COUNT(*) FROM bookmark_folders) AS n').get() as { n: number }).n);

function folderDepth(db: DB, id: number | null): number {
  let d = 0;
  for (let cur = id; cur !== null && d <= MAX_DEPTH + 1; d++) {
    cur = (db.prepare('SELECT parent_id FROM bookmark_folders WHERE id = ?').get(cur) as { parent_id: number | null } | undefined)?.parent_id ?? null;
  }
  return d;
}
/** Height of the subtree rooted at id (1 = no subfolders). */
function subtreeHeight(db: DB, id: number): number {
  const row = db
    .prepare(
      `WITH RECURSIVE t(id, d) AS (SELECT ?, 1 UNION ALL SELECT f.id, t.d + 1 FROM bookmark_folders f JOIN t ON f.parent_id = t.id WHERE t.d <= ${MAX_DEPTH + 1})
       SELECT MAX(d) AS h FROM t`,
    )
    .get(id) as { h: number };
  return Number(row.h);
}
const SUBTREE = 'WITH RECURSIVE t(id) AS (SELECT ? UNION SELECT f.id FROM bookmark_folders f JOIN t ON f.parent_id = t.id)';

/** Is `target` the folder `id` itself or one of its descendants? */
function inSubtree(db: DB, id: number, target: number): boolean {
  return db.prepare(`${SUBTREE} SELECT 1 FROM t WHERE id = ?`).get(id, target) !== undefined;
}

export interface FolderOut {
  id: number;
  name: string;
  parentId: number | null;
  sort: number;
}
export interface LinkOut {
  id: number;
  folderId: number;
  title: string;
  url: string;
  sort: number;
}
const folderOut = (db: DB, id: number): FolderOut => {
  const r = db.prepare('SELECT id, name, parent_id, sort FROM bookmark_folders WHERE id = ?').get(id) as { id: number; name: string; parent_id: number | null; sort: number };
  return { id: r.id, name: r.name, parentId: r.parent_id, sort: r.sort };
};
const linkOut = (db: DB, id: number): LinkOut => {
  const r = db.prepare('SELECT id, folder_id, title, url, sort FROM bookmarks WHERE id = ?').get(id) as { id: number; folder_id: number; title: string; url: string; sort: number };
  return { id: r.id, folderId: r.folder_id, title: r.title, url: r.url, sort: r.sort };
};

export function createFolder(db: DB, body: unknown, nowMs: number): FolderOut {
  const b = obj(body);
  const name = text(b.name, 'name', MAX_FOLDER_NAME);
  const parentId = b.parentId === undefined ? null : optId(b.parentId, 'parentId');
  return tx(db, () => {
    if (parentId !== null && !folderExists(db, parentId)) throw new InputError('上级文件夹不存在');
    if (folderDepth(db, parentId) + 1 > MAX_DEPTH) throw new InputError(`文件夹最多 ${MAX_DEPTH} 层`);
    if (itemCount(db) + 1 > MAX_ITEMS) throw new InputError(`书签条目最多 ${MAX_ITEMS} 条`);
    const id = Number(
      db.prepare('INSERT INTO bookmark_folders (parent_id, name, sort, add_date, last_modified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(parentId, name, nextSort(db, 'bookmark_folders', 'parent_id', parentId), sec(nowMs), sec(nowMs), nowMs, nowMs).lastInsertRowid,
    );
    return folderOut(db, id);
  });
}

/** Rename and/or move. Moving into itself or a descendant is InvalidMoveError (400 invalid_move). */
export function updateFolder(db: DB, id: number, body: unknown, nowMs: number): FolderOut {
  const b = obj(body);
  const name = b.name === undefined ? undefined : text(b.name, 'name', MAX_FOLDER_NAME);
  const parentId = b.parentId === undefined ? undefined : optId(b.parentId, 'parentId');
  return tx(db, () => {
    const cur = db.prepare('SELECT parent_id FROM bookmark_folders WHERE id = ?').get(id) as { parent_id: number | null } | undefined;
    if (!cur) throw new NotFoundError();
    let sort: number | undefined;
    if (parentId !== undefined && parentId !== cur.parent_id) {
      if (parentId !== null) {
        if (!folderExists(db, parentId)) throw new InputError('目标文件夹不存在');
        if (inSubtree(db, id, parentId)) throw new InvalidMoveError();
      }
      if (folderDepth(db, parentId) + subtreeHeight(db, id) > MAX_DEPTH) throw new InputError(`文件夹最多 ${MAX_DEPTH} 层`);
      sort = nextSort(db, 'bookmark_folders', 'parent_id', parentId);
    }
    db.prepare(
      `UPDATE bookmark_folders SET name = COALESCE(?, name), parent_id = CASE WHEN ? THEN ? ELSE parent_id END,
         sort = COALESCE(?, sort), last_modified = ?, updated_at = ? WHERE id = ?`,
    ).run(name ?? null, sort !== undefined ? 1 : 0, parentId ?? null, sort ?? null, sec(nowMs), nowMs, id);
    return folderOut(db, id);
  });
}

/** Deletes the folder and everything under it (FK cascade); returns how many links went with it. */
export function deleteFolder(db: DB, id: number, nowMs: number): number {
  return tx(db, () => {
    if (!folderExists(db, id)) throw new NotFoundError();
    const links = Number((db.prepare(`${SUBTREE} SELECT COUNT(*) AS n FROM bookmarks WHERE folder_id IN (SELECT id FROM t)`).get(id) as { n: number }).n);
    if (links > BULK_DELETE_SNAPSHOT_OVER) saveSnapshot(db, 'bulk-delete', nowMs);
    db.prepare('DELETE FROM bookmark_folders WHERE id = ?').run(id);
    return links;
  });
}

export function createLink(db: DB, body: unknown, nowMs: number): LinkOut {
  const b = obj(body);
  const folderId = reqId(b.folderId, 'folderId');
  const u = url(b.url);
  const title = b.title === undefined || b.title === null || (typeof b.title === 'string' && !b.title.trim()) ? [...u].slice(0, MAX_TITLE).join('') : text(b.title, 'title', MAX_TITLE);
  return tx(db, () => {
    if (!folderExists(db, folderId)) throw new InputError('文件夹不存在');
    if (itemCount(db) + 1 > MAX_ITEMS) throw new InputError(`书签条目最多 ${MAX_ITEMS} 条`);
    const id = Number(
      db.prepare('INSERT INTO bookmarks (folder_id, title, url, sort, add_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(folderId, title, u, nextSort(db, 'bookmarks', 'folder_id', folderId), sec(nowMs), nowMs, nowMs).lastInsertRowid,
    );
    return linkOut(db, id);
  });
}

export function updateLink(db: DB, id: number, body: unknown, nowMs: number): LinkOut {
  const b = obj(body);
  const u = b.url === undefined ? undefined : url(b.url);
  let title = b.title === undefined ? undefined : typeof b.title === 'string' && !b.title.trim() ? '' : text(b.title, 'title', MAX_TITLE);
  const folderId = b.folderId === undefined ? undefined : reqId(b.folderId, 'folderId');
  return tx(db, () => {
    const cur = db.prepare('SELECT folder_id, url FROM bookmarks WHERE id = ?').get(id) as { folder_id: number; url: string } | undefined;
    if (!cur) throw new NotFoundError();
    if (title === '') title = [...(u ?? cur.url)].slice(0, MAX_TITLE).join('');
    let sort: number | undefined;
    if (folderId !== undefined && folderId !== cur.folder_id) {
      if (!folderExists(db, folderId)) throw new InputError('目标文件夹不存在');
      sort = nextSort(db, 'bookmarks', 'folder_id', folderId);
    }
    db.prepare('UPDATE bookmarks SET title = COALESCE(?, title), url = COALESCE(?, url), folder_id = COALESCE(?, folder_id), sort = COALESCE(?, sort), updated_at = ? WHERE id = ?').run(
      title ?? null,
      u ?? null,
      sort !== undefined ? folderId! : null,
      sort ?? null,
      nowMs,
      id,
    );
    return linkOut(db, id);
  });
}

export function deleteLink(db: DB, id: number): boolean {
  return Number(db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id).changes) > 0;
}

/** folders/links must be exactly the folder's children (each once). folderId null = top level (folders only). */
export function reorder(db: DB, body: unknown, nowMs: number): void {
  const b = obj(body);
  const folderId = b.folderId === undefined ? undefined : optId(b.folderId, 'folderId');
  if (folderId === undefined) throw new InputError('缺少 folderId');
  const ids = (v: unknown, f: string) => {
    if (v === undefined) return [] as number[];
    if (!Array.isArray(v) || !v.every((x) => Number.isSafeInteger(x))) throw new InputError(`${f} 必须是整数数组`);
    return v as number[];
  };
  const folders = ids(b.folders, 'folders');
  const links = ids(b.links, 'links');
  tx(db, () => {
    if (folderId !== null && !folderExists(db, folderId)) throw new NotFoundError();
    const same = (given: number[], actual: number[]) => {
      const g = new Set(given);
      return given.length === actual.length && g.size === given.length && actual.every((x) => g.has(x));
    };
    const curF = (db.prepare('SELECT id FROM bookmark_folders WHERE parent_id IS ?').all(folderId) as Array<{ id: number }>).map((r) => Number(r.id));
    const curL = folderId === null ? [] : (db.prepare('SELECT id FROM bookmarks WHERE folder_id = ?').all(folderId) as Array<{ id: number }>).map((r) => Number(r.id));
    if (!same(folders, curF) || !same(links, curL)) throw new InputError('folders 和 links 必须正好是这个文件夹下的全部子项');
    const uf = db.prepare('UPDATE bookmark_folders SET sort = ?, updated_at = ? WHERE id = ?');
    folders.forEach((id, i) => uf.run(i, nowMs, id));
    const ul = db.prepare('UPDATE bookmarks SET sort = ?, updated_at = ? WHERE id = ?');
    links.forEach((id, i) => ul.run(i, nowMs, id));
  });
}
