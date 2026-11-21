// Database layer — uses Node's built-in SQLite (node:sqlite), so there is
// nothing native to compile. All data lives in a single file in DATA_DIR.
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// DATA_DIR wins if set; on Railway, fall back to the attached volume's mount path.
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'balledge.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS articles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    slug         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    dek          TEXT NOT NULL DEFAULT '',
    category     TEXT NOT NULL DEFAULT 'NFL',
    hero_image   TEXT NOT NULL DEFAULT '',
    hero_caption TEXT NOT NULL DEFAULT '',
    body_html    TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'published'
    author_id    INTEGER REFERENCES users(id),
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    published_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_articles_pub ON articles(status, published_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Email subscribers. status: 'pending' (hasn't clicked the confirm link yet),
  -- 'active' (gets new-article emails) or 'unsubscribed'.
  CREATE TABLE IF NOT EXISTS subscribers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    token             TEXT NOT NULL UNIQUE,
    status            TEXT NOT NULL DEFAULT 'pending',
    created_at        INTEGER NOT NULL,
    confirm_sent_at   INTEGER,
    confirmed_at      INTEGER,
    unsubscribed_at   INTEGER
  );
`);

// Migrations for databases created by earlier versions.
const articleCols = db.prepare('PRAGMA table_info(articles)').all().map((c) => c.name);
if (!articleCols.includes('share_image')) {
  // 1200×630 crop of the hero image, used for link previews on X/Twitter, Facebook, etc.
  db.exec("ALTER TABLE articles ADD COLUMN share_image TEXT NOT NULL DEFAULT ''");
}
if (!articleCols.includes('emailed_at')) {
  // When the new-article email went out, and to how many subscribers.
  db.exec('ALTER TABLE articles ADD COLUMN emailed_at INTEGER');
  db.exec('ALTER TABLE articles ADD COLUMN emailed_count INTEGER NOT NULL DEFAULT 0');
}

const getSetting = (key, fallback = '') => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
};
const setSetting = (key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

module.exports = { db, DATA_DIR, UPLOAD_DIR, getSetting, setSetting };
