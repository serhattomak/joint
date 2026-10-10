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
  -- Hiyerarşi: null = üst seviye, doluysa üst kategorinin id'si (iki seviye).
  -- Göç 8 mevcut arşivlere bu kolonu ekler; buradaki tanım yalnızca taze
  -- arşivler içindir ve aynı kısıtları taşır.
  parent_id TEXT NULL REFERENCES categories(id) ON DELETE SET NULL,
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
-- Hiyerarşi: alt kategori listeleri ve üst seçimi altlarını toplama.
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

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

CREATE TABLE IF NOT EXISTS downloads (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  filename TEXT NOT NULL,
  destination_path TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  downloaded_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  category TEXT NOT NULL DEFAULT 'other',
  threads INTEGER NOT NULL DEFAULT 8,
  speed_bps INTEGER NOT NULL DEFAULT 0,
  eta_secs INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
CREATE INDEX IF NOT EXISTS idx_downloads_created_at ON downloads(created_at);
CREATE INDEX IF NOT EXISTS idx_downloads_category ON downloads(category);

CREATE TABLE IF NOT EXISTS item_articles (
  item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  title TEXT,
  content_text TEXT NOT NULL,
  content_markdown TEXT,
  author TEXT,
  published_at TEXT,
  reading_time_mins INTEGER NOT NULL DEFAULT 1,
  lead_image TEXT,
  images_json TEXT,
  videos_json TEXT,
  site_name TEXT,
  scraped_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_scraped_at ON item_articles(scraped_at);

CREATE TABLE IF NOT EXISTS item_analysis (
  id                TEXT PRIMARY KEY,
  item_id           TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending',
  contains_recipe   INTEGER,
  confidence        REAL,
  language          TEXT,
  summary           TEXT,
  recipe_json       TEXT,
  topics_json       TEXT,
  keywords_json     TEXT,
  visual_notes_json TEXT,
  transcript_source TEXT,
  transcript_path   TEXT,
  model_versions_json TEXT,
  error_message     TEXT,
  analyzed_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_item_analysis_status ON item_analysis(status);

