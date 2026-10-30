import { tx, type DB } from '../db.js';
import { ConflictError, InputError, NotFoundError } from '../http.js';
import { htmlToText, renderMarkdown } from './render.js';
import { dedupeTags, ensureCategoryByName, ensureTags, getCategory } from './taxonomy.js';

export { InputError, NotFoundError };

export type PostStatus = 'draft' | 'published';

export interface Post {
  id: number;
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  markdown: string;
  status: PostStatus;
  publishedAt: string | null;
  categoryId: number | null;
  category: CategoryRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryRef {
  slug: string;
  name: string;
}

export interface PostRow {
  id: number;
  slug: string;
  title: string;
  summary: string;
  tags: string;
  markdown: string;
  html: string;
  body_text: string;
  status: PostStatus;
  published_at: string | null;
  category_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Validated create/update payload. `slug` undefined means "generate" (create) or "keep" (update). */
export interface PostInput {
  title: string;
  slug?: string;
  summary: string;
  tags: string[];
  markdown: string;
  status: PostStatus;
  publishedAt?: string | null;
  /** undefined = keep (update) / none (create); null = uncategorized; string = category name, created if missing. */
  category?: number | string | null;
}

const slugTakenError = () => new ConflictError('slug_taken', 'slug 已被占用');

export const SLUG_RE = /^[a-z0-9-]{1,80}$/;
export const MAX_MARKDOWN_BYTES = 1024 * 1024;
/** Display dates (list grouping, slugs) use China Standard Time; there is no DST. */
const TZ_OFFSET_MS = 8 * 3600_000;
const SUMMARY_CHARS = 120;

const len = (s: string) => [...s].length;

export function localDate(iso: string): string {
  return new Date(Date.parse(iso) + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

export function normalizeDate(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const t = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(t)) throw new InputError('publishedAt 不是有效日期');
  return new Date(t).toISOString();
}

export function normalizeTags(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  const list = typeof v === 'string' ? v.split(/[,，]/) : Array.isArray(v) ? v : null;
  if (!list) throw new InputError('tags 必须是数组');
  const out: string[] = [];
  for (const t of list) {
    if (typeof t !== 'string' && typeof t !== 'number') throw new InputError('标签必须是文字');
    const s = String(t).trim();
    if (!s) continue;
    if (len(s) > 30 || /[\u0000-\u001f]/.test(s)) throw new InputError('标签最多 30 字');
    out.push(s);
  }
  out.splice(0, out.length, ...dedupeTags(out));
  if (out.length > 10) throw new InputError('最多 10 个标签');
  return out;
}

/** Validates a JSON body from the editor. Throws InputError with a user-facing message. */
export function parsePostInput(body: unknown): PostInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('请求体必须是对象');
  const b = body as Record<string, unknown>;
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  if (len(title) < 1 || len(title) > 200) throw new InputError('标题 1–200 字');
  let slug: string | undefined;
  if (b.slug !== undefined && b.slug !== null && b.slug !== '') {
    if (typeof b.slug !== 'string' || !SLUG_RE.test(b.slug)) throw new InputError('slug 只能是 a-z、0-9、-，最多 80 字');
    slug = b.slug;
  }
  const summary = b.summary === undefined || b.summary === null ? '' : b.summary;
  if (typeof summary !== 'string' || len(summary.trim()) > 500) throw new InputError('摘要最多 500 字');
  if (typeof b.markdown !== 'string') throw new InputError('缺少 markdown');
  if (Buffer.byteLength(b.markdown) > MAX_MARKDOWN_BYTES) throw new InputError('正文超过 1 MB');
  if (b.status !== 'draft' && b.status !== 'published') throw new InputError('status 必须是 draft 或 published');
  return {
    title,
    slug,
    summary: summary.trim(),
    tags: normalizeTags(b.tags),
    markdown: b.markdown,
    status: b.status,
    publishedAt: normalizeDate(b.publishedAt),
    category: parseCategoryField(b),
  };
}

/** `categoryId` wins over `category` (a name) when both are given. */
function parseCategoryField(b: Record<string, unknown>): PostInput['category'] {
  if (b.categoryId !== undefined) {
    if (b.categoryId === null) return null;
    if (!Number.isSafeInteger(b.categoryId) || (b.categoryId as number) < 1) throw new InputError('categoryId 必须是正整数或 null');
    return b.categoryId as number;
  }
  if (b.category === undefined) return undefined;
  if (b.category === null || b.category === '') return null;
  if (typeof b.category !== 'string') throw new InputError('category 必须是分类名');
  return b.category;
}

export function categoryRef(db: DB, id: number | null): CategoryRef | null {
  if (id === null) return null;
  const c = getCategory(db, id);
  return c ? { slug: c.slug, name: c.name } : null;
}

export function rowToPost(db: DB, r: PostRow): Post {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    tags: JSON.parse(r.tags) as string[],
    markdown: r.markdown,
    status: r.status,
    publishedAt: r.published_at,
    categoryId: r.category_id,
    category: categoryRef(db, r.category_id),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Stored summary, or the first 120 characters of the body text. */
export function effectiveSummary(r: Pick<PostRow, 'summary' | 'body_text'>): string {
  if (r.summary) return r.summary;
  const chars = [...r.body_text.slice(0, 2 * (SUMMARY_CHARS + 1))];
  return chars.length > SUMMARY_CHARS ? `${chars.slice(0, SUMMARY_CHARS).join('')}…` : chars.join('');
}

/** `/blog/tags/` is the tag index, so no post may own that path. */
const RESERVED_SLUGS = new Set(['tags']);

function slugTaken(db: DB, slug: string, exceptId?: number): boolean {
  if (RESERVED_SLUGS.has(slug)) return true;
  return db.prepare('SELECT 1 FROM posts WHERE slug = ? AND id IS NOT ?').get(slug, exceptId ?? null) !== undefined;
}

/** ASCII words of the title; Chinese-only titles fall back to YYYYMMDD-<n>. Auto slugs never collide. */
export function generateSlug(db: DB, title: string, nowMs: number): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    .replace(/-+$/, '');
  if (base) {
    if (!slugTaken(db, base)) return base;
    for (let n = 2; ; n++) if (!slugTaken(db, `${base}-${n}`)) return `${base}-${n}`;
  }
  const day = localDate(new Date(nowMs).toISOString()).replaceAll('-', '');
  for (let n = 1; ; n++) if (!slugTaken(db, `${day}-${n}`)) return `${day}-${n}`;
}

export function getRow(db: DB, id: number): PostRow | undefined {
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as PostRow | undefined;
}

export function getPublishedBySlug(db: DB, slug: string): PostRow | undefined {
  return db.prepare("SELECT * FROM posts WHERE slug = ? AND status = 'published'").get(slug) as PostRow | undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed: posts\.slug/.test(err.message);
}

/**
 * Create (id undefined) or update a post. Rendering happens first; everything after it is synchronous,
 * so the existence and slug checks can't race with other requests.
 */
export async function savePost(db: DB, input: PostInput, nowMs: number, id?: number): Promise<Post> {
  const html = await renderMarkdown(input.markdown);
  const bodyText = htmlToText(html);
  const existing = id === undefined ? undefined : getRow(db, id);
  if (id !== undefined && !existing) throw new NotFoundError();
  const now = new Date(nowMs).toISOString();

  let publishedAt: string | null;
  if (input.publishedAt !== undefined) publishedAt = input.publishedAt;
  else publishedAt = existing?.published_at ?? null;
  if (input.status === 'published' && !publishedAt) publishedAt = now;

  let slug: string;
  if (input.slug) {
    if (slugTaken(db, input.slug, existing?.id)) throw slugTakenError();
    slug = input.slug;
  } else {
    slug = existing?.slug ?? generateSlug(db, input.title, nowMs);
  }

  try {
    return tx(db, () => {
      let categoryId: number | null;
      if (input.category === undefined) categoryId = existing?.category_id ?? null;
      else if (input.category === null) categoryId = null;
      else if (typeof input.category === 'number') {
        if (!getCategory(db, input.category)) throw new InputError('分类不存在');
        categoryId = input.category;
      } else categoryId = ensureCategoryByName(db, input.category);
      const tags = ensureTags(db, input.tags);

      const values = [slug, input.title, input.summary, JSON.stringify(tags), input.markdown, html, bodyText, input.status, publishedAt, categoryId];
      if (existing) {
        db.prepare(
          `UPDATE posts SET slug=?, title=?, summary=?, tags=?, markdown=?, html=?, body_text=?, status=?, published_at=?, category_id=?, updated_at=?
           WHERE id=?`,
        ).run(...values, now, existing.id);
        return rowToPost(db, getRow(db, existing.id)!);
      }
      const r = db
        .prepare(
          `INSERT INTO posts (slug, title, summary, tags, markdown, html, body_text, status, published_at, category_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...values, now, now);
      return rowToPost(db, getRow(db, Number(r.lastInsertRowid))!);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw slugTakenError();
    throw err;
  }
}

export interface PublicItem {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  publishedAt: string;
  category: CategoryRef | null;
}

/** Columns used by lists, RSS and sitemap. body_text is cut to what effectiveSummary needs. */
export type ListRow = Pick<PostRow, 'slug' | 'title' | 'summary' | 'tags' | 'body_text' | 'updated_at'> & {
  published_at: string;
  cat_slug: string | null;
  cat_name: string | null;
};

export function listPublished(db: DB, opts: { limit?: number; tag?: string; categoryId?: number } = {}): ListRow[] {
  const where = ["p.status = 'published'"];
  const args: Array<string | number> = [];
  if (opts.tag !== undefined) {
    // Tags compare case-insensitively everywhere else; json_each + lower() keeps ASCII consistent here.
    where.push('EXISTS (SELECT 1 FROM json_each(p.tags) WHERE lower(value) = lower(?))');
    args.push(opts.tag);
  }
  if (opts.categoryId !== undefined) {
    where.push('p.category_id = ?');
    args.push(opts.categoryId);
  }
  let sql = `SELECT p.slug, p.title, p.summary, p.tags, substr(p.body_text, 1, ${SUMMARY_CHARS + 1}) AS body_text,
      p.published_at, p.updated_at, c.slug AS cat_slug, c.name AS cat_name
    FROM posts p LEFT JOIN categories c ON c.id = p.category_id
    WHERE ${where.join(' AND ')} ORDER BY p.published_at DESC, p.id DESC`;
  if (opts.limit !== undefined) {
    sql += ' LIMIT ?';
    args.push(opts.limit);
  }
  return db.prepare(sql).all(...args) as unknown as ListRow[];
}

export function toPublicItem(r: ListRow): PublicItem {
  return {
    slug: r.slug,
    title: r.title,
    summary: effectiveSummary(r),
    tags: JSON.parse(r.tags) as string[],
    publishedAt: r.published_at,
    category: r.cat_slug !== null && r.cat_name !== null ? { slug: r.cat_slug, name: r.cat_name } : null,
  };
}

export interface SearchItem {
  slug: string;
  title: string;
  snippet: string;
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** ~30 characters before the first hit and ~70 from it; only that window is sliced, never the whole body. */
export function makeSnippet(text: string, q: string): string {
  // toLowerCase can change length for a few letters; the hit offset is then approximate, which is fine for a snippet.
  const at = Math.max(0, text.toLowerCase().indexOf(q.toLowerCase()));
  const from = Math.max(0, at - 60);
  const to = Math.min(text.length, at + 140);
  const before = [...text.slice(from, at)];
  const after = [...text.slice(at, to)];
  const head = before.slice(-30);
  const tail = after.slice(0, 100 - head.length);
  const cutStart = from > 0 || head.length < before.length;
  const cutEnd = to < text.length || tail.length < after.length;
  const body = (head.join('') + tail.join('')).replace(LONE_SURROGATE, '');
  return `${cutStart ? '…' : ''}${body}${cutEnd ? '…' : ''}`;
}

/** Trigram FTS for queries of ≥ 3 characters; trigram can't index 2-char strings, so those use LIKE. */
export function searchPosts(db: DB, q: string): SearchItem[] {
  let rows: Array<Pick<PostRow, 'slug' | 'title' | 'body_text'>>;
  if (len(q) >= 3) {
    rows = db
      .prepare(
        `SELECT p.slug, p.title, p.body_text FROM posts_fts f JOIN posts p ON p.id = f.rowid
         WHERE posts_fts MATCH ? AND p.status = 'published' ORDER BY bm25(posts_fts, 5.0, 1.0) LIMIT 20`,
      )
      .all(`"${q.replaceAll('"', '""')}"`) as typeof rows;
  } else {
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    rows = db
      .prepare(
        `SELECT slug, title, body_text FROM posts
         WHERE status = 'published' AND (title LIKE ? ESCAPE '\\' OR body_text LIKE ? ESCAPE '\\')
         ORDER BY published_at DESC LIMIT 20`,
      )
      .all(like, like) as typeof rows;
  }
  return rows.map((r) => ({ slug: r.slug, title: r.title, snippet: makeSnippet(r.body_text, q) }));
}
