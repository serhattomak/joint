PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_id TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT,
  note TEXT,
  platform TEXT NOT NULL DEFAULT 'other',
  thumbnail TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  collection_id TEXT NULL REFERENCES collections(id) ON DELETE SET NULL,
  user_id TEXT NULL,
  local_path TEXT NULL,
  download_status TEXT NOT NULL DEFAULT 'none',
  download_error TEXT NULL,
  converted_path TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  user_id TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  user_id TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS item_categories (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, category_id)
);

-- Indeksler. Olculdu: dev/bench-items-query.mjs
-- Sema her acilista bastan calistigi icin IF NOT EXISTS hem yeni hem mevcut
-- veritabanina uygulanir, ayri goc gerekmez.
-- (created_at, title) siralamayi karsilar: LIMIT 48 artik sadece 48 indeks
-- girdisi okur, tablo boyutundan bagimsiz hale gelir.
-- Not: bu dosya noktali virgul ile bolunerek calistirilir. initDb bolmeden once
-- yorum satirlarini dusurur (stripCommentLines), boylece bir yorumun icindeki
-- ayirac parcayi ortadan kesemez.
CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at);
CREATE INDEX IF NOT EXISTS idx_items_title_nocase ON items(title COLLATE NOCASE);
-- FK sutunu: SQLite cocuk sutuna otomatik indeks kurmaz.
CREATE INDEX IF NOT EXISTS idx_items_collection ON items(collection_id);
CREATE INDEX IF NOT EXISTS idx_items_platform ON items(platform);
-- Bilesik PK'nin ondeki sutunu item_id, ters sira ile suzmek gerekir.
CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id, item_id);
CREATE INDEX IF NOT EXISTS idx_item_categories_cat ON item_categories(category_id, item_id);

CREATE TABLE IF NOT EXISTS item_chunks (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  chunk_type TEXT NOT NULL,
  chunk_text TEXT NOT NULL,
  start_seconds REAL,
  end_seconds REAL,
  embedding TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_chunks_item_id ON item_chunks(item_id);
CREATE INDEX IF NOT EXISTS idx_chunks_type ON item_chunks(chunk_type);

CREATE VIRTUAL TABLE IF NOT EXISTS item_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  item_id UNINDEXED,
  chunk_text,
  tokenize = 'unicode61'
);
