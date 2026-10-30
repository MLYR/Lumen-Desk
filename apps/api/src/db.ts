import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created    INTEGER NOT NULL,
  expires    INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
CREATE TABLE IF NOT EXISTS recovery_codes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL,
  created   INTEGER NOT NULL,
  used_at   INTEGER
);
CREATE TABLE IF NOT EXISTS ip_failures (
  ip           TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS login_failures (
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS login_failures_ts ON login_failures(ts);
CREATE TABLE IF NOT EXISTS aihot_cache (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  items             TEXT,
  etag              TEXT,
  fetched_at        INTEGER,
  checked_at        INTEGER,
  retry_after_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  tags         TEXT NOT NULL DEFAULT '[]',
  markdown     TEXT NOT NULL,
  html         TEXT NOT NULL,
  body_text    TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL CHECK (status IN ('draft', 'published')),
  published_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS posts_published ON posts(status, published_at);
CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
  title, body_text, content='posts', content_rowid='id', tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid, title, body_text) VALUES (new.id, new.title, new.body_text);
END;
CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, body_text) VALUES ('delete', old.id, old.title, old.body_text);
END;
CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts, rowid, title, body_text) VALUES ('delete', old.id, old.title, old.body_text);
  INSERT INTO posts_fts(rowid, title, body_text) VALUES (new.id, new.title, new.body_text);
END;
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0
);
-- Tag vocabulary. key = name.toLowerCase() (JS), so uniqueness is case-insensitive beyond ASCII too.
CREATE TABLE IF NOT EXISTS tags (
  key  TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
`;

export const BUILTIN_CATEGORIES: ReadonlyArray<{ slug: string; name: string }> = [
  { slug: 'frontend', name: '前端' },
  { slug: 'backend', name: '后端' },
  { slug: 'devops', name: '部署运维' },
  { slug: 'ai', name: 'AI' },
  { slug: 'notes', name: '随笔' },
];
export const BUILTIN_TAGS: readonly string[] = ['Astro', 'TypeScript', 'Node.js', 'Docker', 'Linux', 'Caddy', 'SQLite', '性能', '工具', '踩坑'];

export const tagKey = (name: string): string => name.toLowerCase();

/** Bump when renderer output changes (2: heading ids + toc). */
export const RENDER_VERSION = '2';
export const RENDER_VERSION_KEY = 'render_version';

function hasColumn(db: DB, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column);
}

/** Idempotent data migrations that plain CREATE IF NOT EXISTS can't express. */
function migrate(db: DB): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!hasColumn(db, 'posts', 'category_id')) {
      // Existing posts get NULL (uncategorized). Deleting a category also nulls it explicitly in code.
      db.exec('ALTER TABLE posts ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL');
    }
    db.exec('CREATE INDEX IF NOT EXISTS posts_category ON posts(category_id)');
    if (!hasColumn(db, 'posts', 'toc')) db.exec("ALTER TABLE posts ADD COLUMN toc TEXT NOT NULL DEFAULT '[]'");
    // Pager lookups: same category (NULL = uncategorized), ordered by publish time.
    db.exec('CREATE INDEX IF NOT EXISTS posts_pager ON posts(status, category_id, published_at, id)');
    // Nothing to re-render in an empty database; rerenderPosts() handles existing posts (it's async: Shiki).
    if (kvGet(db, RENDER_VERSION_KEY) !== RENDER_VERSION && !db.prepare('SELECT 1 FROM posts LIMIT 1').get()) {
      kvSet(db, RENDER_VERSION_KEY, RENDER_VERSION);
    }

    // Built-ins are written once; anything the user deletes later stays deleted.
    if (kvGet(db, 'taxonomy_seeded') === undefined) {
      const cat = db.prepare('INSERT OR IGNORE INTO categories (slug, name, sort) VALUES (?, ?, ?)');
      BUILTIN_CATEGORIES.forEach((c, i) => cat.run(c.slug, c.name, i));
      const tag = db.prepare('INSERT OR IGNORE INTO tags (key, name, sort) VALUES (?, ?, ?)');
      BUILTIN_TAGS.forEach((t, i) => tag.run(tagKey(t), t, i));
      kvSet(db, 'taxonomy_seeded', '1');
    }

    // Tags already used by posts belong in the vocabulary (pre-P2.5 databases, or rows edited by hand).
    const used = db.prepare('SELECT DISTINCT j.value AS name FROM posts, json_each(posts.tags) j').all() as Array<{ name: unknown }>;
    if (used.length) {
      const next = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM tags');
      const ins = db.prepare('INSERT OR IGNORE INTO tags (key, name, sort) VALUES (?, ?, ?)');
      for (const { name } of used) {
        if (typeof name === 'string' && name) ins.run(tagKey(name), name, Number((next.get() as { n: number }).n));
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Runs fn in a transaction (synchronous, so nothing else can interleave). */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Opens (and migrates) the SQLite database. Pass ':memory:' as dataDir for tests. */
export function openDb(dataDir: string): DB {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    file = path.join(dataDir, 'lumen.db');
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  const hadFts = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'posts_fts'").get() !== undefined;
  db.exec(SCHEMA);
  // An external-content FTS table created over existing rows starts empty; index them now, or the
  // update trigger's 'delete' for an unindexed row corrupts the index.
  if (!hadFts) db.exec("INSERT INTO posts_fts(posts_fts) VALUES ('rebuild')");
  migrate(db);
  return db;
}

export function kvGet(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function kvSet(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
