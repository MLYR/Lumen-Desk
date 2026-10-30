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
`;

/** Opens (and migrates) the SQLite database. Pass ':memory:' as dataDir for tests. */
export function openDb(dataDir: string): DB {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    file = path.join(dataDir, 'lumen.db');
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function kvGet(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function kvSet(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
