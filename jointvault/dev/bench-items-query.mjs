/*
 * Item sorgu ölçümü — üretim kodu DEĞİL.
 *
 * `listItemsPage`'in ürettiği SQL'i gerçek şemayla çalıştırır; EXPLAIN QUERY PLAN ve
 * medyan süre verir. Üç sürüm karşılaştırılır:
 *   1. bugün            — şemada hiç açık indeks yok, sorgu LEFT JOIN + DISTINCT
 *   2. bugün + indeks   — yalnızca indeks eklenir, sorgu şekli aynı kalır
 *   3. öneri + indeks   — katılımsız/EXISTS şekli + indeksler
 *
 *   node dev/bench-items-query.mjs [N] [--brief]
 */
import { DatabaseSync } from 'node:sqlite';

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 2000);
const BRIEF = process.argv.includes('--brief');

const PLATFORMS = ['instagram', 'tiktok', 'x', 'pinterest', 'youtube', 'other'];
const TITLES = [
  'Gece okuma notları', 'Arşiv kapağı çalışması', 'Kayıp kayıt', 'Uzun bir başlık örneği iki satıra taşar',
  'zebra sonuncu', 'Üsküdar akşamı', 'kısa', 'Veri matığı üzerine', 'Tensegrity kolon',
];

/* Sabit tohum: iki veritabanı birebir aynı veriyi taşısın diye. */
function makeRnd() {
  let s = 42;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

function buildDb() {
  const rnd = makeRnd();
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT NOT NULL, user_id TEXT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE items (id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT, note TEXT,
      platform TEXT NOT NULL DEFAULT 'other', thumbnail TEXT, favorite INTEGER NOT NULL DEFAULT 0,
      collection_id TEXT NULL REFERENCES collections(id) ON DELETE SET NULL, user_id TEXT NULL,
      local_path TEXT NULL, download_status TEXT NOT NULL DEFAULT 'none', download_error TEXT NULL,
      converted_path TEXT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, user_id TEXT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE item_tags (item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (item_id, tag_id));
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, user_id TEXT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE item_categories (item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, category_id));
  `);

  const insItem = db.prepare(
    `INSERT INTO items (id,url,title,note,platform,thumbnail,favorite,collection_id,user_id,
      local_path,download_status,download_error,converted_path,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insTag = db.prepare('INSERT INTO tags (id,name,user_id,created_at,updated_at) VALUES (?,?,?,?,?)');
  const insItemTag = db.prepare('INSERT INTO item_tags (item_id,tag_id) VALUES (?,?)');
  const insCat = db.prepare('INSERT INTO categories (id,name,user_id,created_at,updated_at) VALUES (?,?,?,?,?)');
  const insItemCat = db.prepare('INSERT INTO item_categories (item_id,category_id) VALUES (?,?)');
  const insCol = db.prepare('INSERT INTO collections (id,name,user_id,created_at,updated_at) VALUES (?,?,?,?,?)');

  const iso = new Date(0).toISOString();
  db.exec('BEGIN');
  for (let i = 0; i < 3; i += 1) insCol.run(`col-${i}`, `koleksiyon-${i}`, null, iso, iso);
  for (let i = 0; i < 20; i += 1) insTag.run(`tag-${i}`, `etiket-${i}`, null, iso, iso);
  for (let i = 0; i < 10; i += 1) insCat.run(`cat-${i}`, `kategori-${i}`, null, iso, iso);
  for (let i = 0; i < N; i += 1) {
    const id = `item-${i}`;
    const created = new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
    insItem.run(
      id, `https://example.invalid/kayit/${i}`, pick(TITLES),
      i % 5 === 0 ? 'not metni' : null, pick(PLATFORMS), null,
      i % 7 === 0 ? 1 : 0, i % 11 === 0 ? `col-${i % 3}` : null, null,
      i % 13 === 0 ? `C:\\yol\\dosya-${i}.mp4` : null, i % 3 === 0 ? 'done' : 'none',
      null, null, created, created,
    );
    /* Aynı (item, tag) çifti iki kez seçilebilir; PK reddeder — tekille. */
    const tagIds = new Set();
    const nTags = 1 + Math.floor(rnd() * 3);
    for (let t = 0; t < nTags; t += 1) tagIds.add(`tag-${Math.floor(rnd() * 20)}`);
    for (const t of tagIds) insItemTag.run(id, t);
    const catIds = new Set();
    for (let c = 0; c < Math.floor(rnd() * 3); c += 1) catIds.add(`cat-${Math.floor(rnd() * 10)}`);
    for (const c of catIds) insItemCat.run(id, c);
  }
  db.exec('COMMIT');
  return db;
}

/* Önerilen indeksler: sıralama, FK sütunu ve join tablolarının ikinci sütunu. */
function applyIndexes(db) {
  db.exec(`
    CREATE INDEX idx_items_created_at ON items(created_at);
    CREATE INDEX idx_items_title_nocase ON items(title COLLATE NOCASE);
    CREATE INDEX idx_items_collection ON items(collection_id);
    CREATE INDEX idx_items_platform ON items(platform);
    CREATE INDEX idx_item_tags_tag ON item_tags(tag_id, item_id);
    CREATE INDEX idx_item_categories_cat ON item_categories(category_id, item_id);
  `);
  db.exec('ANALYZE');
}

const FROM_JOIN =
  'FROM items i LEFT JOIN item_categories ic ON ic.item_id = i.id LEFT JOIN item_tags it ON it.item_id = i.id';

const SORT_SQL = {
  new: 'i.created_at DESC',
  old: 'i.created_at ASC',
  title: 'i.title COLLATE NOCASE ASC',
  'title-desc': 'i.title COLLATE NOCASE DESC',
};

/* 1-2. sürüm: bugünkü sorgu şekli */
const joinQuery = (sort, where = '', offset = 0) => ({
  count: `SELECT COUNT(DISTINCT i.id) AS n ${FROM_JOIN} ${where}`,
  page: `SELECT DISTINCT i.* ${FROM_JOIN} ${where} ORDER BY ${SORT_SQL[sort]} LIMIT 48 OFFSET ${offset}`,
});

const TAG_EXISTS = "EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = i.id AND it.tag_id = 'tag-3')";

/* 3. sürüm: katılım yoksa katılma; filtre varsa EXISTS ile süz. */
const shapedQuery = (sort, where = '', offset = 0) => ({
  count: `SELECT COUNT(*) AS n FROM items i ${where}`,
  page: `SELECT i.* FROM items i ${where} ORDER BY ${SORT_SQL[sort]} LIMIT 48 OFFSET ${offset}`,
});

const LIKE_WHERE = "WHERE (i.title LIKE '%okuma%' OR i.note LIKE '%okuma%' OR i.url LIKE '%okuma%')";

const scenarios = [
  { key: 'A', name: 'varsayılan görünüm (filtre yok, sort new)', q: () => joinQuery('new'), s: () => shapedQuery('new') },
  { key: 'B', name: 'başlığa göre sırala (COLLATE NOCASE)', q: () => joinQuery('title'), s: () => shapedQuery('title') },
  { key: 'C', name: "etikete göre süz (tag_id = 'tag-3')",
    q: () => joinQuery('new', "WHERE it.tag_id = 'tag-3'"),
    s: () => shapedQuery('new', `WHERE ${TAG_EXISTS}`) },
  { key: 'D', name: 'derin sayfa (OFFSET 1920)', q: () => joinQuery('new', '', 1920), s: () => shapedQuery('new', '', 1920) },
  { key: 'E', name: 'arama (LIKE %okuma%)', q: () => joinQuery('new', LIKE_WHERE), s: () => shapedQuery('new', LIKE_WHERE) },
];

function total(db, spec) {
  return timeIt(db, spec.count) + timeIt(db, spec.page);
}

function planOf(db, sql) {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all()
    .map((r) => r.detail)
    .join('\n      ');
}

function timeIt(db, sql, runs = 15) {
  const stmt = db.prepare(sql);
  const times = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    stmt.all();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

const plain = buildDb();
const indexed = buildDb();
applyIndexes(indexed);

const grid = scenarios.map((s) => ({
  ...s,
  today: total(plain, s.q()),
  todayIdx: total(indexed, s.q()),
  shaped: total(indexed, s.s()),
  planToday: planOf(plain, s.q().page),
  planShaped: planOf(indexed, s.s().page),
}));

const f = (n) => n.toFixed(2).padStart(8);
if (BRIEF) {
  console.log(`${String(N).padStart(6)} | ${grid.map((g) => f(g.today)).join('')} | ${grid.map((g) => f(g.todayIdx)).join('')} | ${grid.map((g) => f(g.shaped)).join('')}`);
} else {
  console.log(`satır: ${N} item · ${plain.prepare('SELECT COUNT(*) n FROM item_tags').get().n} item_tags · ` +
    `${plain.prepare('SELECT COUNT(*) n FROM item_categories').get().n} item_categories\n`);
  for (const g of grid) {
    console.log(`--- ${g.key}. ${g.name}`);
    console.log(`   1 bugün            ${g.today.toFixed(2)} ms`);
    console.log(`   2 bugün + indeks   ${g.todayIdx.toFixed(2)} ms`);
    console.log(`   3 öneri + indeks   ${g.shaped.toFixed(2)} ms`);
    console.log(`   plan 1:\n      ${g.planToday}`);
    console.log(`   plan 3:\n      ${g.planShaped}\n`);
  }
  console.log('--- indeks envanteri: bugün (sqlite_master) ---');
  for (const r of plain.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' ORDER BY tbl_name, name").all()) {
    console.log(`   ${r.tbl_name.padEnd(16)} ${r.name}`);
  }
  console.log('--- indeks envanteri: öneri ---');
  for (const r of indexed.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY tbl_name, name").all()) {
    console.log(`   ${r.tbl_name.padEnd(16)} ${r.name}`);
  }
}
