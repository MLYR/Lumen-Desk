import fs from 'node:fs';
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { ExportFolder } from './bookmarks/netscape.js';
import { countTree, MAX_DEPTH, MAX_FOLDER_NAME, MAX_ITEMS, MAX_TITLE, MAX_URL, treeDepth } from './bookmarks/netscape.js';
import { exportTree, replaceTreeInTx, saveSnapshot } from './bookmarks/store.js';
import { htmlToText, renderPost } from './blog/render.js';
import { parsePostInput, type PostInput, type PostRow } from './blog/posts.js';
import {
  CATEGORY_SLUG_RE,
  ensureTags,
  validCategoryName,
  validTagName,
} from './blog/taxonomy.js';
import { kvSet, RENDER_VERSION, RENDER_VERSION_KEY, tagKey, tx, type DB } from './db.js';
import { InputError } from './http.js';
import { getProfile, parseProfile, type Profile } from './profile.js';
import { getResume, getSettings, parseResume, parseSettings, saveResume, saveSettings } from './resume.js';

/*
 * Full backup format (version 1):
 *
 *   manifest.json   format/version/counts/exportedAt
 *   content.json    posts, taxonomy, bookmark tree, profile, résumé
 *   uploads/<name>  images referenced by posts, profile and old avatars
 *
 * Deliberately excluded: TOTP secret, recovery codes, sessions, login rate limits, AIHOT cache and
 * bookmark snapshots. This is a content backup, not a copy of the SQLite file.
 */

export const BACKUP_FORMAT = 'lumen-desk-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 40 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;
const MAX_CONTENT_BYTES = 32 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_UPLOADS_TOTAL = 40 * 1024 * 1024;
const MAX_UPLOAD_FILES = 500;
const MAX_POSTS = 2000;
const MAX_CATEGORIES = 500;
const MAX_TAGS = 2000;
const TZ_OFFSET_MS = 8 * 3600_000;
const UPLOAD_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const UPLOAD_EXT_RE = /\.(?:webp|png|jpe?g|gif|avif)$/i;
const AVATAR_RE = /^\/uploads\/[0-9a-f]{16}\.webp$/;
const BAD_TEXT = /[\u0000-\u001f\u007f]/;
const BAD_MULTILINE = /[\u0000-\u0009\u000b-\u001f\u007f]/;

export interface BackupCounts {
  posts: number;
  categories: number;
  tags: number;
  folders: number;
  bookmarks: number;
  uploads: number;
}

export interface BuiltBackup {
  data: Uint8Array;
  filename: string;
  counts: BackupCounts;
}

interface CategoryBackup {
  slug: string;
  name: string;
  description: string;
  sort: number;
}

interface TagBackup {
  name: string;
  sort: number;
}

interface PreparedPost {
  input: PostInput;
  slug: string;
  categorySlug: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  html: string;
  bodyText: string;
  toc: string;
}

const len = (s: string) => [...s].length;
const nowIso = (ms: number) => new Date(ms).toISOString();

function localStamp(ms: number): string {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 16).replace(/\D/g, '');
}

function isoDateOr(v: unknown, fallback: string): string {
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return fallback;
}

function record(v: unknown, where: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new InputError(`${where} 格式不对`);
  return v as Record<string, unknown>;
}

function array(v: unknown, where: string, max: number): unknown[] {
  if (!Array.isArray(v)) throw new InputError(`${where} 必须是数组`);
  if (v.length > max) throw new InputError(`${where} 超过 ${max} 条`);
  return v;
}

function text(v: unknown, where: string, min: number, max: number, multiline = false): string {
  if (typeof v !== 'string') throw new InputError(`${where} 必须是文字`);
  const s = v.trim();
  if (len(s) < min || len(s) > max) throw new InputError(min ? `${where} 要 ${min}–${max} 字` : `${where} 最多 ${max} 字`);
  if ((multiline ? BAD_MULTILINE : BAD_TEXT).test(s)) throw new InputError(`${where} 含有不允许的字符`);
  return s;
}

function integer(v: unknown, fallback: number, where: string): number {
  if (v === undefined || v === null) return fallback;
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw new InputError(`${where} 必须是非负整数`);
  return v as number;
}

function readCategories(v: unknown): CategoryBackup[] {
  const out: CategoryBackup[] = [];
  const slugs = new Set<string>();
  const names = new Set<string>();
  array(v, 'categories', MAX_CATEGORIES).forEach((raw, i) => {
    const o = record(raw, `categories[${i}]`);
    const name = validCategoryName(o.name);
    const slug = typeof o.slug === 'string' && CATEGORY_SLUG_RE.test(o.slug) ? o.slug : '';
    if (!slug) throw new InputError(`categories[${i}].slug 只能是 a-z、0-9、-，最多 40 字`);
    const description = o.description === undefined || o.description === null ? '' : text(o.description, `categories[${i}].description`, 0, 200);
    const sort = integer(o.sort, i, `categories[${i}].sort`);
    if (slugs.has(slug)) throw new InputError(`分类 slug 重复：${slug}`);
    if (names.has(name.toLowerCase())) throw new InputError(`分类名重复：${name}`);
    slugs.add(slug);
    names.add(name.toLowerCase());
    out.push({ slug, name, description, sort });
  });
  return out;
}

function readTags(v: unknown): TagBackup[] {
  const out: TagBackup[] = [];
  const keys = new Set<string>();
  array(v, 'tags', MAX_TAGS).forEach((raw, i) => {
    const o = record(raw, `tags[${i}]`);
    const name = validTagName(o.name);
    const key = tagKey(name);
    if (keys.has(key)) throw new InputError(`标签重复：${name}`);
    keys.add(key);
    out.push({ name, sort: integer(o.sort, i, `tags[${i}].sort`) });
  });
  return out;
}

interface ReadBookmarks {
  tree: ExportFolder[];
  folders: number;
  links: number;
}

function readBookmarks(v: unknown): ReadBookmarks {
  let items = 0;
  const walk = (raw: unknown, depth: number, where: string): ExportFolder[] => {
    if (depth > MAX_DEPTH) throw new InputError(`文件夹最多 ${MAX_DEPTH} 层`);
    return array(raw, where, MAX_ITEMS).map((entry, i) => {
      const o = record(entry, `${where}[${i}]`);
      const name = text(o.name, `${where}[${i}].name`, 1, MAX_FOLDER_NAME);
      const addDate = integer(o.addDate, 0, `${where}[${i}].addDate`);
      const lastModified = integer(o.lastModified, addDate, `${where}[${i}].lastModified`);
      const folders = o.folders === undefined || o.folders === null ? [] : walk(o.folders, depth + 1, `${where}[${i}].folders`);
      const linksRaw = o.links === undefined || o.links === null ? [] : array(o.links, `${where}[${i}].links`, MAX_ITEMS);
      const links = linksRaw.map((linkRaw, j) => {
        const l = record(linkRaw, `${where}[${i}].links[${j}]`);
        return {
          title: typeof l.title === 'string' ? text(l.title, `${where}[${i}].links[${j}].title`, 0, MAX_TITLE) : '',
          url: text(l.url, `${where}[${i}].links[${j}].url`, 1, MAX_URL),
          addDate: integer(l.addDate, addDate, `${where}[${i}].links[${j}].addDate`),
        };
      });
      items += 1 + links.length;
      if (items > MAX_ITEMS) throw new InputError(`书签条目超过 ${MAX_ITEMS} 条`);
      return { name, addDate, lastModified, folders, links };
    });
  };
  const tree = walk(v, 1, 'bookmarks');
  const { folders, links } = countTree(tree);
  return { tree, folders, links };
}

function readProfile(v: unknown, uploads: Map<string, Uint8Array>): Profile {
  const o = record(v, 'profile');
  const parsed = parseProfile(o);
  let avatar: string | null = null;
  if (o.avatar !== undefined && o.avatar !== null) {
    if (typeof o.avatar !== 'string' || !AVATAR_RE.test(o.avatar)) throw new InputError('profile.avatar 不是站内头像路径');
    avatar = o.avatar;
    const name = avatar.slice('/uploads/'.length);
    if (!uploads.has(name)) throw new InputError('备份里缺少头像文件');
  }
  return { ...parsed, avatar };
}

function readUploads(entries: Record<string, Uint8Array>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  let total = 0;
  for (const [key, data] of Object.entries(entries)) {
    if (!key.startsWith('uploads/')) continue;
    const name = key.slice('uploads/'.length);
    if (!name || name.endsWith('/')) continue;
    if (!UPLOAD_NAME_RE.test(name) || !UPLOAD_EXT_RE.test(name)) throw new InputError(`备份里有不允许的图片文件名：${name}`);
    if (out.has(name)) throw new InputError(`备份里的图片重复：${name}`);
    if (data.length > MAX_UPLOAD_BYTES) throw new InputError(`图片 ${name} 超过 12 MB`);
    total += data.length;
    if (total > MAX_UPLOADS_TOTAL) throw new InputError('上传文件总计超过 40 MB');
    out.set(name, data);
  }
  if (out.size > MAX_UPLOAD_FILES) throw new InputError(`图片超过 ${MAX_UPLOAD_FILES} 个`);
  return out;
}

function readPostRows(db: DB): PostRow[] {
  return db.prepare('SELECT * FROM posts ORDER BY id').all() as unknown as PostRow[];
}

/** Builds the ZIP entirely in memory. Reads uploads from DATA_DIR/uploads. */
export function buildBackup(db: DB, dataDir: string, nowMs: number): BuiltBackup {
  const categories = db.prepare('SELECT slug, name, description, sort FROM categories ORDER BY sort, id').all() as unknown as CategoryBackup[];
  const tags = db.prepare('SELECT name, sort FROM tags ORDER BY sort, key').all() as unknown as TagBackup[];
  const rows = readPostRows(db);
  const categoriesById = new Map<number, { slug: string; name: string }>();
  for (const r of db.prepare('SELECT id, slug, name FROM categories').all() as Array<{ id: number; slug: string; name: string }>) {
    categoriesById.set(Number(r.id), { slug: r.slug, name: r.name });
  }

  const posts = rows.map((r) => {
    let tagsInPost: string[] = [];
    try {
      const parsed = JSON.parse(r.tags) as unknown;
      if (Array.isArray(parsed)) tagsInPost = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      // A hand-edited database can have bad JSON; the backup should still be exportable.
    }
    const category = r.category_id === null ? null : categoriesById.get(Number(r.category_id)) ?? null;
    return {
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      tags: tagsInPost,
      markdown: r.markdown,
      status: r.status,
      publishedAt: r.published_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      category: category?.slug ?? null,
    };
  });

  const tree = exportTree(db);
  const bookmarkCounts = countTree(tree);
  const profile = getProfile(db);
  const resume = getResume(db);
  const resumeSettings = getSettings(db);

  const uploadsDir = path.join(dataDir, 'uploads');
  const uploadEntries: Record<string, Uint8Array> = {};
  let uploadBytes = 0;
  if (fs.existsSync(uploadsDir)) {
    for (const ent of fs.readdirSync(uploadsDir, { withFileTypes: true })) {
      if (!ent.isFile() || !UPLOAD_NAME_RE.test(ent.name) || !UPLOAD_EXT_RE.test(ent.name)) continue;
      const data = fs.readFileSync(path.join(uploadsDir, ent.name));
      if (data.length > MAX_UPLOAD_BYTES) throw new InputError(`图片 ${ent.name} 超过 12 MB，无法打包`);
      uploadBytes += data.length;
      if (uploadBytes > MAX_UPLOADS_TOTAL) throw new InputError('上传文件总计超过 40 MB，无法打包');
      uploadEntries[`uploads/${ent.name}`] = new Uint8Array(data);
    }
  }
  if (Object.keys(uploadEntries).length > MAX_UPLOAD_FILES) throw new InputError(`图片超过 ${MAX_UPLOAD_FILES} 个，无法打包`);
  if (posts.length > MAX_POSTS) throw new InputError(`文章超过 ${MAX_POSTS} 篇，无法打包`);
  if (categories.length > MAX_CATEGORIES) throw new InputError(`分类超过 ${MAX_CATEGORIES} 个，无法打包`);
  if (tags.length > MAX_TAGS) throw new InputError(`标签超过 ${MAX_TAGS} 个，无法打包`);
  if (bookmarkCounts.folders + bookmarkCounts.links > MAX_ITEMS) throw new InputError(`书签条目超过 ${MAX_ITEMS} 条，无法打包`);
  if (treeDepth(tree) > MAX_DEPTH) throw new InputError(`文件夹超过 ${MAX_DEPTH} 层，无法打包`);
  if (profile.avatar && !uploadEntries[`uploads/${profile.avatar.slice('/uploads/'.length)}`]) {
    throw new InputError('头像文件不在上传目录，无法打包');
  }

  const counts: BackupCounts = {
    posts: posts.length,
    categories: categories.length,
    tags: tags.length,
    folders: bookmarkCounts.folders,
    bookmarks: bookmarkCounts.links,
    uploads: Object.keys(uploadEntries).length,
  };
  const exportedAt = nowIso(nowMs);
  const manifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    counts,
    note: '不包含验证器、恢复码、登录会话、限流记录和 AIHOT 缓存',
  };
  const content = {
    posts,
    categories,
    tags,
    bookmarks: tree,
    profile,
    resume,
    resumeSettings,
  };
  const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
  const contentBytes = strToU8(JSON.stringify(content, null, 2));
  if (contentBytes.length > MAX_CONTENT_BYTES) throw new InputError('内容数据超过 32 MB，无法打包');
  if (manifestBytes.length + contentBytes.length + uploadBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new InputError('备份内容解压后超过 80 MB，无法打包');
  }
  const files: Record<string, Uint8Array> = {
    'manifest.json': manifestBytes,
    'content.json': contentBytes,
    ...uploadEntries,
  };
  const data = zipSync(files, { level: 6 });
  if (data.length > MAX_BACKUP_BYTES) throw new InputError('备份超过 40 MB，无法下载');
  return {
    data,
    filename: `lumen-desk-backup-${localStamp(nowMs)}.zip`,
    counts,
  };
}

function decodeJson(entries: Record<string, Uint8Array>, name: string): unknown {
  const raw = entries[name];
  if (!raw) throw new InputError(`备份缺少 ${name}`);
  if (raw.length > MAX_CONTENT_BYTES) throw new InputError(`${name} 超过 32 MB`);
  try {
    return JSON.parse(strFromU8(raw)) as unknown;
  } catch {
    throw new InputError(`${name} 不是有效的 JSON`);
  }
}

async function readPosts(v: unknown, categories: CategoryBackup[], nowMs: number): Promise<PreparedPost[]> {
  const bySlug = new Map(categories.map((c) => [c.slug, c.name]));
  const slugs = new Set<string>();
  const now = nowIso(nowMs);
  const out: PreparedPost[] = [];
  for (const [i, raw] of array(v, 'posts', MAX_POSTS).entries()) {
    const o = record(raw, `posts[${i}]`);
    if (typeof o.slug !== 'string' || !o.slug) throw new InputError(`posts[${i}].slug 不能为空`);
    const categorySlug = o.category === undefined || o.category === null || o.category === '' ? null : String(o.category);
    if (categorySlug !== null && !bySlug.has(categorySlug)) throw new InputError(`posts[${i}] 的分类不存在：${categorySlug}`);
    const input = parsePostInput({
      title: o.title,
      slug: o.slug,
      summary: o.summary ?? '',
      tags: o.tags ?? [],
      markdown: o.markdown,
      status: o.status,
      publishedAt: o.publishedAt ?? null,
      // parsePostInput expects a category name; the backup stores its stable URL slug.
      category: categorySlug === null ? null : bySlug.get(categorySlug),
    });
    if (!input.slug) throw new InputError(`posts[${i}].slug 不能为空`);
    if (input.slug === 'tags') throw new InputError(`posts[${i}].slug 不能使用保留路径 tags`);
    if (slugs.has(input.slug)) throw new InputError(`文章 slug 重复：${input.slug}`);
    slugs.add(input.slug);
    const createdAt = isoDateOr(o.createdAt, now);
    const updatedAt = isoDateOr(o.updatedAt, createdAt);
    const { html, toc } = await renderPost(input.markdown);
    out.push({
      input,
      slug: input.slug,
      categorySlug,
      publishedAt: input.publishedAt ?? (input.status === 'published' ? now : null),
      createdAt,
      updatedAt,
      html,
      bodyText: htmlToText(html),
      toc: JSON.stringify(toc),
    });
  }
  return out;
}

/**
 * Restores a backup into an existing database. Renders every post before opening the transaction;
 * images are written first, then all relational/content changes commit atomically.
 */
export async function importBackup(db: DB, dataDir: string, zip: Uint8Array, nowMs: number): Promise<BackupCounts> {
  if (!zip.length) throw new InputError('备份文件是空的');
  if (zip.length > MAX_BACKUP_BYTES) throw new InputError('备份超过 40 MB');
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new InputError('不是有效的 ZIP 备份文件');
  }
  let uncompressed = 0;
  for (const data of Object.values(entries)) {
    uncompressed += data.length;
    if (uncompressed > MAX_UNCOMPRESSED_BYTES) throw new InputError('备份解压后超过 80 MB');
  }

  const manifest = record(decodeJson(entries, 'manifest.json'), 'manifest.json');
  if (manifest.format !== BACKUP_FORMAT || manifest.version !== BACKUP_VERSION) {
    throw new InputError('不是受支持的 Lumen Desk 备份');
  }
  const content = record(decodeJson(entries, 'content.json'), 'content.json');
  const categories = readCategories(content.categories);
  const tags = readTags(content.tags);
  const bookmarks = readBookmarks(content.bookmarks);
  const uploads = readUploads(entries);
  const profile = readProfile(content.profile, uploads);
  const resume = content.resume === null || content.resume === undefined ? null : parseResume(content.resume, nowMs);
  if (resume && typeof (content.resume as Record<string, unknown>).updatedAt === 'string') {
    resume.updatedAt = isoDateOr((content.resume as Record<string, unknown>).updatedAt, resume.updatedAt);
  }
  const resumeSettings = content.resumeSettings === undefined || content.resumeSettings === null
    ? { revealPublic: false }
    : parseSettings(content.resumeSettings);
  const posts = await readPosts(content.posts, categories, nowMs);

  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o755 });
  for (const [name, data] of uploads) {
    const file = path.join(uploadsDir, name);
    fs.writeFileSync(file, data, { mode: 0o644 });
    try {
      fs.chmodSync(file, 0o644);
    } catch {
      // Best effort; the API can still read a file with the process umask.
    }
  }

  // A restore should be undoable for bookmarks, but a too-large old tree must not block the restore.
  try {
    saveSnapshot(db, 'import', nowMs);
  } catch {
    // Snapshot is best effort.
  }

  tx(db, () => {
    // Delete posts first: the FTS delete trigger needs the old rows. Categories/tags have no FKs.
    db.exec('DELETE FROM posts; DELETE FROM categories; DELETE FROM tags;');

    const insCategory = db.prepare('INSERT INTO categories (slug, name, description, sort) VALUES (?, ?, ?, ?)');
    const categoryIds = new Map<string, number>();
    for (const c of categories) {
      categoryIds.set(c.slug, Number(insCategory.run(c.slug, c.name, c.description, c.sort).lastInsertRowid));
    }

    const insTag = db.prepare('INSERT INTO tags (key, name, sort) VALUES (?, ?, ?)');
    for (const t of tags) insTag.run(tagKey(t.name), t.name, t.sort);

    const insPost = db.prepare(
      `INSERT INTO posts (slug, title, summary, tags, markdown, html, body_text, toc, status, published_at, category_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const p of posts) {
      // A hand-edited backup may omit a tag from the vocabulary; keep the post and add it back.
      const postTags = ensureTags(db, p.input.tags);
      insPost.run(
        p.slug,
        p.input.title,
        p.input.summary,
        JSON.stringify(postTags),
        p.input.markdown,
        p.html,
        p.bodyText,
        p.toc,
        p.input.status,
        p.publishedAt,
        p.categorySlug === null ? null : categoryIds.get(p.categorySlug) ?? null,
        p.createdAt,
        p.updatedAt,
      );
    }
    // The external-content FTS table is rebuilt from the restored rows, avoiding stale rowids.
    db.prepare("INSERT INTO posts_fts(posts_fts) VALUES ('rebuild')").run();

    replaceTreeInTx(db, bookmarks.tree, nowMs);

    kvSet(db, 'profile', JSON.stringify(profile));
    if (resume) saveResume(db, resume);
    else db.prepare("DELETE FROM kv WHERE key = 'resume'").run();
    saveSettings(db, resumeSettings);
    // These flags stop the startup migration from re-seeding deleted taxonomy or re-importing old files.
    kvSet(db, 'taxonomy_seeded', '1');
    kvSet(db, 'bookmarks_migrated', '1');
    kvSet(db, RENDER_VERSION_KEY, RENDER_VERSION);
  });

  return {
    posts: posts.length,
    categories: categories.length,
    tags: tags.length,
    folders: bookmarks.folders,
    bookmarks: bookmarks.links,
    uploads: uploads.size,
  };
}
