import { BUILTIN_CATEGORIES, tagKey, tx, type DB } from '../db.js';
import { BAD_CHARS, ConflictError, InputError, NotFoundError, visible } from '../http.js';

const nameTaken = () => new ConflictError('name_taken', '名字已被占用');
const slugTaken = () => new ConflictError('slug_taken', 'slug 已被占用');

export const CATEGORY_SLUG_RE = /^[a-z0-9-]{1,40}$/;
const len = (s: string) => [...s].length;

export interface Category {
  id: number;
  slug: string;
  name: string;
  description: string;
  sort: number;
}

interface CategoryCountRow extends Category {
  count: number;
  draftCount: number;
}

// ---------- categories ----------

const COUNTED = `SELECT c.id, c.slug, c.name, c.description, c.sort,
  (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id AND p.status = 'published') AS count,
  (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id AND p.status = 'draft') AS draftCount
  FROM categories c`;

function countedRows(db: DB, where = '', ...args: Array<string | number>): CategoryCountRow[] {
  return (db.prepare(`${COUNTED} ${where} ORDER BY c.sort, c.id`).all(...args) as unknown as CategoryCountRow[]).map((r) => ({
    ...r,
    count: Number(r.count),
    draftCount: Number(r.draftCount),
  }));
}

/**
 * A category is public when it has a published post, or is a built-in with no posts at all.
 * User-created categories stay hidden until something in them is published, so a draft's
 * category name can't leak (e.g. after its only draft moves to another category).
 */
const BUILTIN_SLUGS = new Set(BUILTIN_CATEGORIES.map((c) => c.slug));
const isPublic = (r: CategoryCountRow) => r.count > 0 || (r.draftCount === 0 && BUILTIN_SLUGS.has(r.slug));

export function listCategoriesPrivate(db: DB): CategoryCountRow[] {
  return countedRows(db);
}

export function listCategoriesPublic(db: DB): Array<{ slug: string; name: string; description: string; count: number }> {
  return countedRows(db)
    .filter(isPublic)
    .map(({ slug, name, description, count }) => ({ slug, name, description, count }));
}

export function getPublicCategoryBySlug(db: DB, slug: string): CategoryCountRow | undefined {
  const r = countedRows(db, 'WHERE c.slug = ?', slug)[0];
  return r && isPublic(r) ? r : undefined;
}

export function getCategory(db: DB, id: number): Category | undefined {
  return db.prepare('SELECT id, slug, name, description, sort FROM categories WHERE id = ?').get(id) as Category | undefined;
}

function findCategoryByName(db: DB, name: string): Category | undefined {
  // NOCASE covers ASCII; compare in JS for the rest.
  const rows = db.prepare('SELECT id, slug, name, description, sort FROM categories').all() as unknown as Category[];
  const k = name.toLowerCase();
  return rows.find((r) => r.name.toLowerCase() === k);
}

function categorySlugTaken(db: DB, slug: string, exceptId?: number): boolean {
  return db.prepare('SELECT 1 FROM categories WHERE slug = ? AND id IS NOT ?').get(slug, exceptId ?? null) !== undefined;
}

/** ASCII names become slugs (`-2` on collision); names without ASCII letters/digits use `cat-<n>`. */
function generateCategorySlug(db: DB, name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 36)
    .replace(/-+$/, '');
  if (base) {
    if (!categorySlugTaken(db, base)) return base;
    for (let n = 2; ; n++) if (!categorySlugTaken(db, `${base}-${n}`)) return `${base}-${n}`;
  }
  for (let n = 1; ; n++) if (!categorySlugTaken(db, `cat-${n}`)) return `cat-${n}`;
}

export function validCategoryName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : '';
  if (len(name) < 1 || len(name) > 20 || BAD_CHARS.test(name) || !visible(name)) throw new InputError('分类名 1–20 字，不能含不可见字符');
  return name;
}

interface CategoryPatch {
  name?: string;
  slug?: string;
  description?: string;
}

function parseCategoryPatch(body: unknown, requireName: boolean): CategoryPatch {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('请求体必须是对象');
  const b = body as Record<string, unknown>;
  const out: CategoryPatch = {};
  if (requireName || b.name !== undefined) out.name = validCategoryName(b.name);
  if (b.slug !== undefined && b.slug !== null && b.slug !== '') {
    if (typeof b.slug !== 'string' || !CATEGORY_SLUG_RE.test(b.slug)) throw new InputError('slug 只能是 a-z、0-9、-，最多 40 字');
    out.slug = b.slug;
  }
  if (b.description !== undefined && b.description !== null) {
    if (typeof b.description !== 'string' || len(b.description.trim()) > 200) throw new InputError('描述最多 200 字');
    out.description = b.description.trim();
  }
  return out;
}

function insertCategory(db: DB, name: string, slug: string | undefined, description: string): Category {
  if (findCategoryByName(db, name)) throw nameTaken();
  if (slug && categorySlugTaken(db, slug)) throw slugTaken();
  const s = slug ?? generateCategorySlug(db, name);
  const sort = Number((db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM categories').get() as { n: number }).n);
  const r = db.prepare('INSERT INTO categories (slug, name, description, sort) VALUES (?, ?, ?, ?)').run(s, name, description, sort);
  return getCategory(db, Number(r.lastInsertRowid))!;
}

export function createCategory(db: DB, body: unknown): Category {
  const p = parseCategoryPatch(body, true);
  return tx(db, () => insertCategory(db, p.name!, p.slug, p.description ?? ''));
}

/** Used by post saves and imports: returns the id of the category with this name, creating it if needed. */
export function ensureCategoryByName(db: DB, rawName: string): number {
  const name = validCategoryName(rawName);
  return (findCategoryByName(db, name) ?? insertCategory(db, name, undefined, '')).id;
}

export function updateCategory(db: DB, id: number, body: unknown): Category {
  const p = parseCategoryPatch(body, false);
  return tx(db, () => {
    const cur = getCategory(db, id);
    if (!cur) throw new NotFoundError();
    if (p.name !== undefined) {
      const other = findCategoryByName(db, p.name);
      if (other && other.id !== id) throw nameTaken();
    }
    if (p.slug !== undefined && categorySlugTaken(db, p.slug, id)) throw slugTaken();
    db.prepare('UPDATE categories SET name = ?, slug = ?, description = ? WHERE id = ?').run(
      p.name ?? cur.name,
      p.slug ?? cur.slug,
      p.description ?? cur.description,
      id,
    );
    return getCategory(db, id)!;
  });
}

export function deleteCategory(db: DB, id: number): boolean {
  return tx(db, () => {
    db.prepare('UPDATE posts SET category_id = NULL WHERE category_id = ?').run(id);
    return Number(db.prepare('DELETE FROM categories WHERE id = ?').run(id).changes) > 0;
  });
}

/** ids must be exactly the set of all category ids, each once. */
export function reorderCategories(db: DB, body: unknown): void {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || !ids.every((i) => Number.isSafeInteger(i))) throw new InputError('ids 必须是整数数组');
  tx(db, () => {
    const all = (db.prepare('SELECT id FROM categories').all() as Array<{ id: number }>).map((r) => r.id);
    const given = new Set(ids as number[]);
    if (given.size !== ids.length || ids.length !== all.length || !all.every((id) => given.has(id))) {
      throw new InputError('ids 必须正好包含全部分类各一次');
    }
    const upd = db.prepare('UPDATE categories SET sort = ? WHERE id = ?');
    (ids as number[]).forEach((id, i) => upd.run(i, id));
  });
}

// ---------- tags ----------

export function validTagName(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') throw new InputError('标签必须是文字');
  const s = String(v).trim();
  if (len(s) < 1 || len(s) > 30 || BAD_CHARS.test(s) || !visible(s)) throw new InputError('标签 1–30 字，不能含不可见字符');
  // "." and ".." collapse under URL normalisation, so /blog/tags/../ and DELETE /tags/. would never reach them.
  if (/^\.+$/.test(s)) throw new InputError('标签不能只由 . 组成');
  return s;
}

/** Case-insensitive dedupe, first spelling wins. */
export function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags.filter((t) => {
    const k = tagKey(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Adds unknown tags to the vocabulary and returns the names spelled as in the vocabulary
 * (so "docker" saved against an existing "Docker" is stored as "Docker").
 */
export function ensureTags(db: DB, tags: string[]): string[] {
  if (!tags.length) return tags;
  const get = db.prepare('SELECT name FROM tags WHERE key = ?');
  const next = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM tags');
  const ins = db.prepare('INSERT INTO tags (key, name, sort) VALUES (?, ?, ?)');
  return dedupeTags(
    tags.map((t) => {
      const row = get.get(tagKey(t)) as { name: string } | undefined;
      if (row) return row.name;
      ins.run(tagKey(t), t, Number((next.get() as { n: number }).n));
      return t;
    }),
  );
}

interface TagUse {
  published: Map<string, number>;
  draft: Map<string, number>;
  /** First spelling seen per key, for tags that aren't in the vocabulary. */
  names: Map<string, string>;
}

function tagUsage(db: DB): TagUse {
  const rows = db.prepare("SELECT status, tags FROM posts WHERE tags != '[]'").all() as Array<{ status: string; tags: string }>;
  const use: TagUse = { published: new Map(), draft: new Map(), names: new Map() };
  for (const r of rows) {
    const m = r.status === 'published' ? use.published : use.draft;
    for (const t of dedupeTags(JSON.parse(r.tags) as string[])) {
      const k = tagKey(t);
      m.set(k, (m.get(k) ?? 0) + 1);
      if (!use.names.has(k)) use.names.set(k, t);
    }
  }
  return use;
}

export function listTagsPrivate(db: DB): Array<{ name: string; sort: number; count: number; draftCount: number }> {
  const use = tagUsage(db);
  const rows = db.prepare('SELECT key, name, sort FROM tags ORDER BY sort, name').all() as Array<{ key: string; name: string; sort: number }>;
  return rows.map((r) => ({ name: r.name, sort: Number(r.sort), count: use.published.get(r.key) ?? 0, draftCount: use.draft.get(r.key) ?? 0 }));
}

/** Only tags of published posts, most used first. Draft-only tags never appear. */
export function listTagsPublic(db: DB): Array<{ name: string; count: number }> {
  const use = tagUsage(db);
  const vocab = new Map((db.prepare('SELECT key, name FROM tags').all() as Array<{ key: string; name: string }>).map((r) => [r.key, r.name]));
  return [...use.published.entries()]
    .map(([k, count]) => ({ name: vocab.get(k) ?? use.names.get(k)!, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

export function createTag(db: DB, body: unknown): { name: string; sort: number } {
  const name = validTagName((body as { name?: unknown } | null)?.name);
  return tx(db, () => {
    if (db.prepare('SELECT 1 FROM tags WHERE key = ?').get(tagKey(name))) throw nameTaken();
    ensureTags(db, [name]);
    return db.prepare('SELECT name, sort FROM tags WHERE key = ?').get(tagKey(name)) as { name: string; sort: number };
  });
}

/** Rewrites every post's tags with fn; returns how many posts changed. Caller holds the transaction. */
function rewritePostTags(db: DB, fn: (tags: string[]) => string[]): number {
  const rows = db.prepare("SELECT id, tags FROM posts WHERE tags != '[]'").all() as Array<{ id: number; tags: string }>;
  const upd = db.prepare('UPDATE posts SET tags = ? WHERE id = ?');
  let n = 0;
  for (const r of rows) {
    const next = JSON.stringify(fn(JSON.parse(r.tags) as string[]));
    if (next !== r.tags) {
      upd.run(next, r.id);
      n++;
    }
  }
  return n;
}

const isUsed = (db: DB, key: string) =>
  (db.prepare("SELECT tags FROM posts WHERE tags != '[]'").all() as Array<{ tags: string }>).some((r) =>
    (JSON.parse(r.tags) as string[]).some((t) => tagKey(t) === key),
  );

/**
 * Renames `from` to `to`. If `to` already exists (case-insensitively) this merges the two;
 * posts that end up with both keep one. Tag links are rendered from posts.tags at request time,
 * so no stored HTML needs rewriting. One transaction.
 */
export function renameTag(db: DB, body: unknown): { updated: number } {
  const b = body as { from?: unknown; to?: unknown } | null;
  const from = validTagName(b?.from);
  const to = validTagName(b?.to);
  const fromKey = tagKey(from);
  const toKey = tagKey(to);
  return tx(db, () => {
    const fromRow = db.prepare('SELECT key, name, sort FROM tags WHERE key = ?').get(fromKey) as { sort: number } | undefined;
    if (!fromRow && !isUsed(db, fromKey)) throw new NotFoundError();
    const toRow = db.prepare('SELECT name FROM tags WHERE key = ?').get(toKey) as { name: string } | undefined;
    let finalName = to;
    if (toKey === fromKey) {
      if (fromRow) db.prepare('UPDATE tags SET name = ? WHERE key = ?').run(to, fromKey);
      else ensureTags(db, [to]);
    } else if (toRow) {
      finalName = toRow.name; // merge into the existing spelling
      db.prepare('DELETE FROM tags WHERE key = ?').run(fromKey);
    } else if (fromRow) {
      db.prepare('UPDATE tags SET key = ?, name = ? WHERE key = ?').run(toKey, to, fromKey);
    } else {
      ensureTags(db, [to]);
    }
    const updated = rewritePostTags(db, (tags) => dedupeTags(tags.map((t) => (tagKey(t) === fromKey ? finalName : t))));
    return { updated };
  });
}

export function deleteTag(db: DB, rawName: string): void {
  const key = tagKey(validTagName(rawName));
  tx(db, () => {
    const removed = Number(db.prepare('DELETE FROM tags WHERE key = ?').run(key).changes);
    const changed = rewritePostTags(db, (tags) => tags.filter((t) => tagKey(t) !== key));
    if (!removed && !changed) throw new NotFoundError();
  });
}
