import Database from '@tauri-apps/plugin-sql';
import type { Category, Collection, HybridSearchResult, Item, ItemArticle, ItemChunkRow, Tag } from './types';
import { base64ToVector, cosineSimilarity, type ItemChunk } from '../chunker';
import { createRetryCache } from '../retry-cache';
import { runAtomic } from './atomic';
import { createBackupWith, runDailyBackupIfDue } from './backup';
import { MIGRATIONS, runMigrations, type MigrationExecutor } from './migrations';
import { buildMergeBlob } from './merge-sql';
import { getVectorIndex, invalidateVectorIndex } from '../vector-cache';

/*
 * Veritabanı yolu.
 *
 * `VITE_JV_DB` yalnızca bir TEST DİKİŞİDİR: bozuk/eksik bir arşivle açılışın
 * davranışını (hata ekranı + "yeniden dene") gerçek arşive DOKUNMADAN
 * sınamak için. Tanımlı değilse üretim yolu kullanılır.
 */
const dbPathOverride: unknown = import.meta.env.VITE_JV_DB;
const DB_PATH =
  typeof dbPathOverride === 'string' && dbPathOverride.trim().length > 0
    ? dbPathOverride
    : 'sqlite:jointvault.db';

// SQLite returns favorite as 0/1; map to boolean at the boundary.
type ItemRow = Omit<Item, 'favorite'> & { favorite: number };
const toItem = (r: ItemRow): Item => ({ ...r, favorite: r.favorite === 1 });

const now = (): string => new Date().toISOString();

/** meta chunk'lar (başlık/etiket/kategori taşır) hafifçe öne alınır. */
const META_BOOST = 0.002;

/** İndekslenen metni değişen öğeler için tazelik olayı yayar (webview dışında no-op). */
function emitItemIndexDirty(id: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('vault-item-index-dirty', { detail: { id } }));
}

export function getDb(): Promise<Database> {
  return dbCache.get();
}

/* Başarısız başlatma önbelleğe ALINMAZ (bkz. retry-cache): aksi hâlde tek bir
   geçici hata oturumun tamamını kilitler ve "yeniden dene" yolu kalmazdı. */
const dbCache = createRetryCache(initDb);

/** Başarısız başlatmayı unutturur; "yeniden dene" bunu çağırır. */
export function resetDb(): void {
  dbCache.reset();
}

/**
 * Açılış yedeği (günde en fazla bir kez) + kırpma.
 * Bağlantı burada sağlanır, böylece backup modülü client'a bağımlı olmaz.
 */
export async function runDailyBackup(): Promise<string | null> {
  return runDailyBackupIfDue(await getDb());
}

/** Son başarıyla açılan bağlantı: `closeDb` yalnızca gerçekten açılmış olanı kapatır. */
let liveDb: Database | null = null;

async function initDb(): Promise<Database> {
  const db = await Database.load(DB_PATH);

  await runMigrations(migrationExecutor(db), MIGRATIONS, async (pending) => {
    /* Göç geri alınamaz: yedek ZORUNLU. Taze arşivde (items tablosu yok)
       kaybedilecek bir şey olmadığı için yedek atlanır. */
    if (!(await hasExistingVault(db))) return;
    await createBackupWith(db);
    console.info(`[db] göç öncesi yedek alındı (${pending.length} göç bekliyordu)`);
  });

  liveDb = db;
  return db;
}

const hasExistingVault = async (db: Database): Promise<boolean> => {
  const rows = await db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'",
  );
  return rows.length > 0;
};

/**
 * Bağlantı havuzunu kapatır ve önbelleği sıfırlar.
 * Yedekten geri dönme ve sıfırlama, canlı dosyanın üzerine yazmadan ÖNCE bunu
 * çağırmalıdır: açık bir SQLite dosyası kilitlidir (Windows'ta üzerine yazma
 * başarısız olur).
 */
export async function closeDb(): Promise<void> {
  const db = liveDb;
  liveDb = null;
  dbCache.reset();
  if (db) await db.close().catch(() => undefined);
}

/* Göç çalıştırıcısı: SQL'i plugin'e devreder, sürümü `PRAGMA user_version`'da tutar.
   `beforeApply` kancası boş bırakıldı; göç öncesi zorunlu yedek oraya bağlanacak. */
function migrationExecutor(db: Database): MigrationExecutor {
  return {
    currentVersion: async () => {
      const rows = await db.select<{ user_version: number }[]>('PRAGMA user_version');
      return rows[0]?.user_version ?? 0;
    },
    execute: async (sql) => {
      await db.execute(sql);
    },
    setVersion: async (version) => {
      await db.execute(`PRAGMA user_version = ${version}`);
    },
  };
}

// --- items ---

export interface NewItem {
  url: string;
  title?: string | null;
  note?: string | null;
  platform?: string;
  thumbnail?: string | null;
  collection_id?: string | null;
  user_id?: string | null;
}

export async function createItem(input: NewItem): Promise<Item> {
  const db = await getDb();
  const item: ItemRow = {
    id: crypto.randomUUID(),
    url: input.url,
    title: input.title ?? null,
    note: input.note ?? null,
    platform: input.platform ?? 'other',
    thumbnail: input.thumbnail ?? null,
    favorite: 0,
    collection_id: input.collection_id ?? null,
    user_id: input.user_id ?? null,
    // ponytail: DB defaults cover these (INSERT omits them); literal needs them for the ItemRow type.
    local_path: null,
    download_status: 'none',
    download_error: null,
    converted_path: null,
    created_at: now(),
    updated_at: now(),
  };
  await db.execute(
    `INSERT INTO items (id, url, title, note, platform, thumbnail, favorite, collection_id, user_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [item.id, item.url, item.title, item.note, item.platform, item.thumbnail, item.favorite, item.collection_id, item.user_id, item.created_at, item.updated_at],
  );
  return toItem(item);
}

export async function listItems(): Promise<Item[]> {
  const db = await getDb();
  const rows = await db.select<ItemRow[]>('SELECT * FROM items ORDER BY created_at DESC');
  return rows.map(toItem);
}

export async function getItem(id: string): Promise<Item | null> {
  const db = await getDb();
  const rows = await db.select<ItemRow[]>('SELECT * FROM items WHERE id = $1', [id]);
  return rows[0] ? toItem(rows[0]) : null;
}

export type ItemPatch = Partial<
  Pick<Item, 'url' | 'title' | 'note' | 'platform' | 'thumbnail' | 'collection_id' | 'local_path' | 'download_status' | 'download_error' | 'converted_path'>
>;

export async function updateItem(id: string, patch: ItemPatch): Promise<Item> {
  const db = await getDb();
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  const sets = [...entries.map(([k], i) => `${k} = $${i + 1}`), `updated_at = $${entries.length + 1}`];
  await db.execute(`UPDATE items SET ${sets.join(', ')} WHERE id = $${entries.length + 2}`, [
    ...entries.map(([, v]) => v),
    now(),
    id,
  ]);
  const [row] = await db.select<ItemRow[]>('SELECT * FROM items WHERE id = $1', [id]);

  // İndekslenen metin (başlık/not/platform/url) değiştiyse arama tazelensin.
  if (entries.some(([k]) => k === 'title' || k === 'note' || k === 'platform' || k === 'url')) {
    emitItemIndexDirty(id);
  }

  return toItem(row);
}

export async function removeItem(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM items WHERE id = $1', [id]);
  invalidateVectorIndex();
}

export async function toggleFavorite(id: string): Promise<Item> {
  const db = await getDb();
  await db.execute('UPDATE items SET favorite = 1 - favorite, updated_at = $1 WHERE id = $2', [now(), id]);
  const [row] = await db.select<ItemRow[]>('SELECT * FROM items WHERE id = $1', [id]);
  return toItem(row);
}

export async function searchItems(q: string): Promise<Item[]> {
  const db = await getDb();
  const like = `%${q}%`;
  const rows = await db.select<ItemRow[]>(
    'SELECT * FROM items WHERE title LIKE $1 OR note LIKE $1 OR url LIKE $1 ORDER BY created_at DESC',
    [like],
  );
  return rows.map(toItem);
}

export interface ItemFilters {
  query?: string;
  platform?: string; // 'all' or slug
  collectionId?: string; // 'all' or id
  categoryId?: string; // 'all' or id
  tagId?: string; // 'all' or id
  favoritesOnly?: boolean;
  /** Üç durumlu favori filtresi: true = yalnız favoriler, false = yalnız favori olmayanlar. */
  favorite?: boolean;
  /** Yalnızca diske inmiş kayıtlar (local_path dolu). */
  localOnly?: boolean;
  /** Üç durumlu yerel filtre: true = yalnız yerel, false = yalnız yerel olmayan. */
  hasLocal?: boolean;
  downloadedOnly?: boolean;
  /** Son N gündür eklenen kayıtlar (created_at >= şimdi - N gün). */
  sinceDays?: number;
  sort?: ItemSort;
}

/* Sıralama beyaz listesi: SQL'e yalnızca bu sabitler girer, kullanıcı girdisi asla. */
export type ItemSort = 'new' | 'old' | 'title' | 'title-desc';

export const ITEM_SORTS: readonly ItemSort[] = ['new', 'old', 'title', 'title-desc'];

const SORT_SQL: Record<ItemSort, string> = {
  new: 'i.created_at DESC',
  old: 'i.created_at ASC',
  title: 'i.title COLLATE NOCASE ASC',
  'title-desc': 'i.title COLLATE NOCASE DESC',
};

// Sayfalı okuma: filtre SQL'de, sayım DISTINCT ile, satır çekimi LIMIT/OFFSET.
// Arama tüm tabloya karşı LIKE ile çalışır; ekrana sadece sayfa gelir.
export async function listItemsPage(
  limit: number,
  offset: number,
  f: ItemFilters = {},
): Promise<{ rows: Item[]; total: number }> {
  const db = await getDb();
  const conds: string[] = [];
  const params: unknown[] = [];
  const q = f.query?.trim();
  if (q) {
    conds.push('(i.title LIKE ? OR i.note LIKE ? OR i.url LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  if (f.platform && f.platform !== 'all') {
    conds.push('i.platform = ?');
    params.push(f.platform);
  }
  if (f.collectionId && f.collectionId !== 'all') {
    conds.push('i.collection_id = ?');
    params.push(f.collectionId);
  }
  if (f.categoryId && f.categoryId !== 'all') {
    conds.push('ic.category_id = ?');
    params.push(f.categoryId);
  }
  if (f.tagId && f.tagId !== 'all') {
    conds.push('it.tag_id = ?');
    params.push(f.tagId);
  }
  if (f.favoritesOnly) conds.push('i.favorite = 1');
  if (f.favorite === true) conds.push('i.favorite = 1');
  if (f.favorite === false) conds.push('i.favorite = 0');
  if (f.localOnly) conds.push('i.local_path IS NOT NULL');
  if (f.hasLocal === true) conds.push('i.local_path IS NOT NULL');
  if (f.hasLocal === false) conds.push('i.local_path IS NULL');
  if (f.downloadedOnly) conds.push("i.download_status = 'done'");
  if (typeof f.sinceDays === 'number' && f.sinceDays > 0) {
    conds.push('i.created_at >= ?');
    params.push(new Date(Date.now() - f.sinceDays * 86_400_000).toISOString());
  }
  /*
   * Taksonomi katılımı yalnızca gerçekten gerektiğinde yapılır. LEFT JOIN
   * bire-çok olduğu için satırları çoğaltır, DISTINCT de bunları geri toplar;
   * filtresiz görünümde bu tamamen boşuna. Ölçüm (dev/bench-items-query.mjs):
   * katılımsız + indeksli yol LIMIT'i tablo boyutundan bağımsız kılar.
   * Etiket/kategori süzmesinde ise katılım korunur — ölçümde EXISTS'ten hızlı.
   */
  const joinsTaxonomy = Boolean(f.categoryId && f.categoryId !== 'all') || Boolean(f.tagId && f.tagId !== 'all');
  const from = joinsTaxonomy
    ? 'FROM items i LEFT JOIN item_categories ic ON ic.item_id = i.id LEFT JOIN item_tags it ON it.item_id = i.id'
    : 'FROM items i';
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const [countRows] = [
    await db.select<{ n: number }[]>(
      `SELECT COUNT(${joinsTaxonomy ? 'DISTINCT i.id' : '*'}) AS n ${from} ${where}`,
      params,
    ),
  ];
  const total = countRows[0]?.n ?? 0;
  if (total === 0) return { rows: [], total };
  const rows = await db.select<ItemRow[]>(
    `SELECT ${joinsTaxonomy ? 'DISTINCT i.*' : 'i.*'} ${from} ${where} ORDER BY ${SORT_SQL[f.sort ?? 'new']} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return { rows: rows.map(toItem), total };
}

// ponytail: thin wrapper over updateItem — translates short keys to columns, refreshes updated_at.
export async function setDownloadState(
  id: string,
  patch: { status: Item['download_status']; local_path?: string | null; error?: string | null },
): Promise<Item> {
  return updateItem(id, {
    download_status: patch.status,
    ...(patch.local_path !== undefined ? { local_path: patch.local_path } : {}),
    ...(patch.error !== undefined ? { download_error: patch.error } : {}),
  });
}

// --- collections ---

export async function createCollection(name: string, user_id: string | null = null): Promise<Collection> {
  const db = await getDb();
  const row: Collection = { id: crypto.randomUUID(), name, user_id, created_at: now(), updated_at: now() };
  await db.execute('INSERT INTO collections (id, name, user_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)', [
    row.id,
    row.name,
    row.user_id,
    row.created_at,
    row.updated_at,
  ]);
  return row;
}

export async function listCollections(): Promise<Collection[]> {
  const db = await getDb();
  return db.select<Collection[]>('SELECT * FROM collections ORDER BY created_at DESC');
}

export async function updateCollection(id: string, name: string): Promise<Collection> {
  const db = await getDb();
  await db.execute('UPDATE collections SET name = $1, updated_at = $2 WHERE id = $3', [name, now(), id]);
  const [row] = await db.select<Collection[]>('SELECT * FROM collections WHERE id = $1', [id]);
  return row;
}

export async function removeCollection(id: string): Promise<void> {
  const db = await getDb();
  // Schema has no enforced FK here; null out in code.
  await db.execute('UPDATE items SET collection_id = NULL, updated_at = $1 WHERE collection_id = $2', [now(), id]);
  await db.execute('DELETE FROM collections WHERE id = $1', [id]);
}

// --- tags ---

export async function createTag(name: string, user_id: string | null = null): Promise<Tag> {
  const db = await getDb();
  const row: Tag = { id: crypto.randomUUID(), name, user_id, created_at: now(), updated_at: now() };
  await db.execute('INSERT INTO tags (id, name, user_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)', [
    row.id,
    row.name,
    row.user_id,
    row.created_at,
    row.updated_at,
  ]);
  return row;
}

export async function listTags(): Promise<Tag[]> {
  const db = await getDb();
  return db.select<Tag[]>('SELECT * FROM tags ORDER BY name ASC');
}

export async function updateTag(id: string, name: string): Promise<Tag> {
  const db = await getDb();
  await db.execute('UPDATE tags SET name = $1, updated_at = $2 WHERE id = $3', [name, now(), id]);
  const [row] = await db.select<Tag[]>('SELECT * FROM tags WHERE id = $1', [id]);
  return row;
}

export async function removeTag(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM tags WHERE id = $1', [id]);
}

/**
 * `duplicateIds` etiketlerindeki üyeleri `canonicalId`'ye taşır, sonra
 * fazlalıkları siler. FK CASCADE boşalan item_tags satırlarını temizler.
 */
export async function mergeTags(canonicalId: string, duplicateIds: string[]): Promise<void> {
  if (duplicateIds.length === 0) return;
  const db = await getDb();
  const inClause = duplicateIds.map((_, i) => `$${i + 2}`).join(', ');
  await runAtomic(
    db,
    `INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT item_id, $1 FROM item_tags WHERE tag_id IN (${inClause}); ` +
      `DELETE FROM tags WHERE id IN (${inClause}); `,
    [canonicalId, ...duplicateIds],
  );
}

/** Bir etikete bağlı öğe id'leri (birleştirme sonrası indeks tazeleme için). */
export async function getItemIdsForTag(tagId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ item_id: string }[]>(
    'SELECT item_id FROM item_tags WHERE tag_id = $1',
    [tagId],
  );
  return rows.map((r) => r.item_id);
}

export async function getOrCreateTag(name: string, user_id: string | null = null): Promise<Tag> {
  const db = await getDb();
  const [existing] = await db.select<Tag[]>('SELECT * FROM tags WHERE name = $1', [name]);
  if (existing) return existing;
  return createTag(name, user_id);
}

// --- item_tags ---

export async function getTagsForItem(item_id: string): Promise<Tag[]> {  const db = await getDb();
  return db.select<Tag[]>('SELECT t.* FROM tags t JOIN item_tags it ON it.tag_id = t.id WHERE it.item_id = $1', [item_id]);
}

// ponytail: tek JOIN ile tüm eşleşmeler — filtre değişiminde N+1 IPC yerine 1 tur.
export async function getAllTagsByItem(): Promise<Record<string, Tag[]>> {
  const db = await getDb();
  const rows = await db.select<(Tag & { item_id: string })[]>(
    'SELECT t.*, it.item_id FROM tags t JOIN item_tags it ON it.tag_id = t.id',
  );
  const map: Record<string, Tag[]> = {};
  for (const r of rows) {
    const { item_id, ...tag } = r;
    (map[item_id] ??= []).push(tag);
  }
  return map;
}

/**
 * Atomik yazma + hata temizliği.
 *
 * Tek çağrılık transaction'da blok yarıda kalırsa ilgili bağlantıda AÇIK bir
 * transaction kalır ve bu tüm veritabanını kilitleyebilir. ÖLÇÜLDÜ: FK ihlali
 * sonrası sonraki yazmalar "database is locked" ile düştü ve her sorgu ~5,5 sn
 * sürdü (kilit beklemesi). Ayrı bir `ROLLBACK` çağrısı o bağlantıyı tutturamaz
 * — havuz onu başka bir bağlantıya gönderir.
 *
 * Kesin çözüm havuzu kapatmaktır: SQLite, bağlantı kapanırken açık transaction'ı
 * geri alır. Bedeli, hatadan sonraki ilk sorgunun bağlantıyı yeniden kurmasıdır
 * — bir hatanın ardından birkaç milisaniye, kilitli bir arşivden iyidir.
 */
async function runAtomicSafe(db: Database, body: string, values: unknown[]): Promise<void> {
  try {
    await runAtomic(db, body, values);
  } catch (error) {
    await closeDb();
    throw error;
  }
}

export async function setTagsForItem(item_id: string, tag_ids: string[]): Promise<void> {
  const db = await getDb();
  const values: unknown[] = [item_id];
  const statements = ['DELETE FROM item_tags WHERE item_id = $1;'];
  if (tag_ids.length > 0) {
    /* Etiket başına ayrı INSERT yerine tek çok-satırlı INSERT: N+1 çağrı yerine 1. */
    const tuples = tag_ids.map((tag_id) => {
      values.push(tag_id);
      return `($1, $${values.length})`;
    });
    statements.push(`INSERT INTO item_tags (item_id, tag_id) VALUES ${tuples.join(', ')};`);
  }
  await runAtomicSafe(db, statements.join(' '), values);
}

// --- categories (mirror of tags: broad topics, many-to-many) ---

export async function createCategory(name: string, user_id: string | null = null): Promise<Category> {
  const db = await getDb();
  const row: Category = { id: crypto.randomUUID(), name, user_id, created_at: now(), updated_at: now() };
  await db.execute('INSERT INTO categories (id, name, user_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)', [
    row.id,
    row.name,
    row.user_id,
    row.created_at,
    row.updated_at,
  ]);
  return row;
}

export async function listCategories(): Promise<Category[]> {
  const db = await getDb();
  return db.select<Category[]>('SELECT * FROM categories ORDER BY name ASC');
}

export async function updateCategory(id: string, name: string): Promise<Category> {
  const db = await getDb();
  await db.execute('UPDATE categories SET name = $1, updated_at = $2 WHERE id = $3', [name, now(), id]);
  const [row] = await db.select<Category[]>('SELECT * FROM categories WHERE id = $1', [id]);
  return row;
}

export async function removeCategory(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM categories WHERE id = $1', [id]);
}

/** `mergeTags`'in kategori karşılığı. */
export async function mergeCategories(canonicalId: string, duplicateIds: string[]): Promise<void> {
  if (duplicateIds.length === 0) return;
  const db = await getDb();
  const inClause = duplicateIds.map((_, i) => `$${i + 2}`).join(', ');
  await runAtomic(
    db,
    `INSERT OR IGNORE INTO item_categories (item_id, category_id) SELECT item_id, $1 FROM item_categories WHERE category_id IN (${inClause}); ` +
      `DELETE FROM categories WHERE id IN (${inClause}); `,
    [canonicalId, ...duplicateIds],
  );
}

/** Bir kategoriye bağlı öğe id'leri (birleştirme sonrası indeks tazeleme için). */
export async function getItemIdsForCategory(categoryId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ item_id: string }[]>(
    'SELECT item_id FROM item_categories WHERE category_id = $1',
    [categoryId],
  );
  return rows.map((r) => r.item_id);
}

export async function getOrCreateCategory(name: string, user_id: string | null = null): Promise<Category> {
  const db = await getDb();
  const [existing] = await db.select<Category[]>('SELECT * FROM categories WHERE name = $1', [name]);
  if (existing) return existing;
  return createCategory(name, user_id);
}

export async function getCategoriesForItem(item_id: string): Promise<Category[]> {
  const db = await getDb();
  return db.select<Category[]>(
    'SELECT c.* FROM categories c JOIN item_categories ic ON ic.category_id = c.id WHERE ic.item_id = $1',
    [item_id],
  );
}

// ponytail: tek JOIN ile tüm eşleşmeler — filtre değişiminde N+1 IPC yerine 1 tur.
export async function getAllCategoriesByItem(): Promise<Record<string, Category[]>> {
  const db = await getDb();
  const rows = await db.select<(Category & { item_id: string })[]>(
    'SELECT c.*, ic.item_id FROM categories c JOIN item_categories ic ON ic.category_id = c.id',
  );
  const map: Record<string, Category[]> = {};
  for (const r of rows) {
    const { item_id, ...cat } = r;
    (map[item_id] ??= []).push(cat);
  }
  return map;
}

export async function setCategoriesForItem(item_id: string, category_ids: string[]): Promise<void> {
  const db = await getDb();
  const values: unknown[] = [item_id];
  const statements = ['DELETE FROM item_categories WHERE item_id = $1;'];
  if (category_ids.length > 0) {
    const tuples = category_ids.map((category_id) => {
      values.push(category_id);
      return `($1, $${values.length})`;
    });
    statements.push(`INSERT INTO item_categories (item_id, category_id) VALUES ${tuples.join(', ')};`);
  }
  await runAtomicSafe(db, statements.join(' '), values);
}

// --- backup (JSON export/import, merge by id) ---

// item_analysis kasıtlı hariç: `items` ile birlikte yedeklenmez, türev tablolarla tutarlı.
const BACKUP_TABLES = ['items', 'collections', 'tags', 'categories', 'item_tags', 'item_categories'] as const;

export interface VaultBackup {
  version: 1;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export async function exportVault(): Promise<VaultBackup> {
  const db = await getDb();
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of BACKUP_TABLES) {
    tables[t] = await db.select<Record<string, unknown>[]>(`SELECT * FROM ${t}`);
  }
  return { version: 1, exportedAt: new Date().toISOString(), tables };
}

const COL_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Yedek tablolarındaki toplam satır: içe aktarmada "kaç eklendi" için. */
const countBackupRows = async (db: Database): Promise<number> => {
  let total = 0;
  for (const table of BACKUP_TABLES) {
    const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table}`);
    total += rows[0]?.n ?? 0;
  }
  return total;
};

/* SQLite'ın bağlı değişken sınırına takılmamak için içe aktarma parçalanır.
   Parçalar kendi içinde atomiktir ve `INSERT OR IGNORE` sayesinde yarıda kalan
   bir içe aktarma güvenle tekrar denenebilir. */
const IMPORT_CHUNK_VALUES = 400;

export async function importVault(data: VaultBackup): Promise<{ added: number }> {
  if (!data || data.version !== 1 || typeof data.tables !== 'object') {
    throw new Error('Geçersiz yedek dosyası.');
  }
  const db = await getDb();
  const before = await countBackupRows(db);

  let statements: string[] = [];
  let values: unknown[] = [];

  const flush = async (): Promise<void> => {
    if (statements.length === 0) return;
    await runAtomicSafe(db, statements.join(' '), values);
    statements = [];
    values = [];
  };

  for (const table of BACKUP_TABLES) {
    const rows = data.tables[table];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const cols = Object.keys(row).filter((c) => COL_RE.test(c));
      if (cols.length === 0) continue;
      if (values.length + cols.length > IMPORT_CHUNK_VALUES) await flush();
      const placeholders = cols
        .map((col) => {
          values.push(row[col]);
          return `$${values.length}`;
        })
        .join(', ');
      statements.push(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders});`);
    }
  }
  await flush();

  return { added: (await countBackupRows(db)) - before };
}

// --- item_chunks & hybrid semantic search ---

export async function saveItemChunks(itemId: string, chunks: ItemChunk[]): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM item_chunks WHERE item_id = $1', [itemId]);
  try {
    await db.execute('DELETE FROM item_chunks_fts WHERE item_id = $1', [itemId]);
  } catch {
    // FTS table might not be initialized yet in edge cases
  }

  if (chunks.length === 0) {
    invalidateVectorIndex();
    return;
  }

  // Id'leri BİR KEZ sabitle: item_chunks ve FTS aynı id ile eşleşmeli.
  const rows = chunks.map((chunk) => ({ ...chunk, id: chunk.id || crypto.randomUUID() }));

  // item_chunks: toplu çok-satırlı INSERT (8 kolon × 100 = 800 parametre < 999).
  const CHUNK_BATCH = 100;
  for (let i = 0; i < rows.length; i += CHUNK_BATCH) {
    const values: unknown[] = [];
    const tupleSql = rows
      .slice(i, i + CHUNK_BATCH)
      .map((chunk) => {
        const base = values.length;
        values.push(
          chunk.id,
          itemId,
          chunk.chunkType,
          chunk.chunkText,
          chunk.startSeconds ?? null,
          chunk.endSeconds ?? null,
          chunk.embedding ?? null,
          chunk.createdAt ?? now(),
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
      })
      .join(', ');
    await db.execute(
      `INSERT INTO item_chunks (id, item_id, chunk_type, chunk_text, start_seconds, end_seconds, embedding, created_at) VALUES ${tupleSql}`,
      values,
    );
  }

  // item_chunks_fts: toplu (3 kolon × 200 = 600 parametre).
  const FTS_BATCH = 200;
  try {
    for (let i = 0; i < rows.length; i += FTS_BATCH) {
      const values: unknown[] = [];
      const tupleSql = rows
        .slice(i, i + FTS_BATCH)
        .map((chunk) => {
          const base = values.length;
          values.push(chunk.id, itemId, chunk.chunkText);
          return `($${base + 1}, $${base + 2}, $${base + 3})`;
        })
        .join(', ');
      await db.execute(
        `INSERT INTO item_chunks_fts (chunk_id, item_id, chunk_text) VALUES ${tupleSql}`,
        values,
      );
    }
  } catch {
    // ignore FTS insert errors if virtual table is unavailable
  }

  invalidateVectorIndex();
}

export async function deleteItemChunks(itemId: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM item_chunks WHERE item_id = $1', [itemId]);
  try {
    await db.execute('DELETE FROM item_chunks_fts WHERE item_id = $1', [itemId]);
  } catch {
    // ignore
  }
  invalidateVectorIndex();
}

export async function getChunksByItem(itemId: string): Promise<ItemChunkRow[]> {
  const db = await getDb();
  return db.select<ItemChunkRow[]>(
    'SELECT * FROM item_chunks WHERE item_id = $1 ORDER BY COALESCE(start_seconds, 0) ASC',
    [itemId],
  );
}

export async function getChunksMissingEmbeddings(limit = 100): Promise<ItemChunkRow[]> {
  const db = await getDb();
  return db.select<ItemChunkRow[]>(
    'SELECT * FROM item_chunks WHERE embedding IS NULL OR embedding = "" LIMIT $1',
    [limit],
  );
}

export async function updateChunkEmbedding(id: string, embeddingBase64: string): Promise<void> {
  const db = await getDb();
  await db.execute('UPDATE item_chunks SET embedding = $1 WHERE id = $2', [embeddingBase64, id]);
  invalidateVectorIndex();
}

/**
 * Embedding'leri TOPLU yazar (satır başına ayrı IPC yerine parti).
 * Yeniden indeksleme/eksik tamamlama bu yolu kullanır.
 */
export async function setChunkEmbeddingsBatch(
  rows: { id: string; embedding: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const body = slice
      .map((_, j) => `UPDATE item_chunks SET embedding = $${j * 2 + 1} WHERE id = $${j * 2 + 2};`)
      .join(' ');
    const values = slice.flatMap((r) => [r.embedding, r.id]);
    await runAtomic(db, body, values);
  }
  invalidateVectorIndex();
}

export async function getAllChunksWithEmbeddings(): Promise<ItemChunkRow[]> {
  const db = await getDb();
  return db.select<ItemChunkRow[]>(
    'SELECT * FROM item_chunks WHERE embedding IS NOT NULL AND embedding != ""',
  );
}

/**
 * Reciprocal Rank Fusion (RRF) ile hibrit arama.
 * FTS5 tam metin eşleşmesi ve BGE-M3 kosinüs benzerliğini harmanlar.
 */
export async function searchHybridChunks(
  query: string,
  queryEmbedding: number[] | Float32Array | null,
  limit = 20,
): Promise<HybridSearchResult[]> {
  const db = await getDb();
  const ftsScores = new Map<string, number>();
  const vectorScores = new Map<string, { score: number; chunk?: ItemChunkRow }>();

  const cleanQuery = query.trim().replace(/['"*^]/g, ' ');
  if (cleanQuery) {
    try {
      const tokens = cleanQuery.split(/\s+/).filter(Boolean);
      if (tokens.length > 0) {
        const ftsQuery = tokens.map((t) => `"${t}"*`).join(' OR ');
        const rows = await db.select<{ chunk_id: string }[]>(
          `SELECT chunk_id FROM item_chunks_fts WHERE item_chunks_fts MATCH $1 LIMIT 50`,
          [ftsQuery],
        );
        rows.forEach((r, idx) => {
          ftsScores.set(r.chunk_id, idx + 1);
        });
      }
    } catch {
      try {
        const rows = await db.select<{ id: string }[]>(
          `SELECT id FROM item_chunks WHERE chunk_text LIKE $1 LIMIT 50`,
          [`%${cleanQuery}%`],
        );
        rows.forEach((r, idx) => {
          ftsScores.set(r.id, idx + 1);
        });
      } catch {
        // ignore
      }
    }
  }

  if (queryEmbedding && queryEmbedding.length > 0) {
    const queryVec =
      queryEmbedding instanceof Float32Array ? queryEmbedding : new Float32Array(queryEmbedding);

    // Önbellekten: base64'ü SORGU BAŞINA değil, bir kez çöz.
    const lookup = await getVectorIndex(() => getAllChunksWithEmbeddings());
    if (lookup.kind === 'index') {
      const { ids, vectors } = lookup.index;
      const scored = vectors.map((vec, i) => ({
        id: ids[i],
        sim: cosineSimilarity(queryVec, vec),
      }));
      scored.sort((a, b) => b.sim - a.sim);
      for (const s of scored.slice(0, 50)) vectorScores.set(s.id, { score: s.sim });
    } else {
      // ponytail: tavan aşıldı — yükleyicinin döndürdüğü satırlarla akışkan yol
      // (ikinci kez tarama YOK).
      const scored = lookup.rows.map((c) => {
        let sim = 0;
        if (c.embedding) {
          try {
            sim = cosineSimilarity(queryVec, base64ToVector(c.embedding));
          } catch {
            sim = 0;
          }
        }
        return { chunk: c, sim };
      });
      scored.sort((a, b) => b.sim - a.sim);
      for (const s of scored.slice(0, 50)) {
        vectorScores.set(s.chunk.id, { score: s.sim, chunk: s.chunk });
      }
    }
  }

  const k = 60;
  const chunkMap = new Map<string, { chunk?: ItemChunkRow; rrf: number; source: 'fts' | 'vector' | 'both' }>();

  for (const [id, rank] of ftsScores.entries()) {
    const entry = chunkMap.get(id) ?? { rrf: 0, source: 'fts' };
    entry.rrf += 1 / (k + rank);
    entry.source = 'fts';
    chunkMap.set(id, entry);
  }

  let vecRank = 1;
  for (const [id, data] of vectorScores.entries()) {
    const entry = chunkMap.get(id);
    if (entry) {
      entry.rrf += 1 / (k + vecRank);
      entry.source = 'both';
      entry.chunk = data.chunk;
    } else {
      chunkMap.set(id, {
        chunk: data.chunk,
        rrf: 1 / (k + vecRank),
        source: 'vector',
      });
    }
    vecRank++;
  }

  const missingIds = Array.from(chunkMap.keys()).filter((id) => !chunkMap.get(id)?.chunk);
  if (missingIds.length > 0) {
    const inClause = missingIds.map((_, i) => `$${i + 1}`).join(', ');
    const fetched = await db.select<ItemChunkRow[]>(
      `SELECT * FROM item_chunks WHERE id IN (${inClause})`,
      missingIds,
    );
    for (const ch of fetched) {
      const entry = chunkMap.get(ch.id);
      if (entry) entry.chunk = ch;
    }
  }

  /* `chunk` alanı isteğe bağlıdır. flatMap ile süzmek TS'in daraltma yapmasını
     sağlar; aksi hâlde `!` ile susturmak gerekirdi. */
  const ranked = Array.from(chunkMap.values())
    .flatMap((entry) => (entry.chunk ? [{ ...entry, chunk: entry.chunk }] : []))
    .map((entry) => ({
      ...entry,
      finalScore: entry.rrf + (entry.chunk.chunk_type === 'meta' ? META_BOOST : 0),
    }))
    .sort((a, b) => b.finalScore - a.finalScore);

  // Aynı öğeden en fazla 2 chunk: referanslar çeşitlensin, tek öğe doldurmasın.
  const perItem = new Map<string, number>();
  const scored = ranked
    .filter((entry) => {
      const n = perItem.get(entry.chunk.item_id) ?? 0;
      if (n >= 2) return false;
      perItem.set(entry.chunk.item_id, n + 1);
      return true;
    })
    .slice(0, limit);

  const itemIds = Array.from(new Set(scored.map((entry) => entry.chunk.item_id)));
  if (itemIds.length === 0) return [];

  const inItemsClause = itemIds.map((_, i) => `$${i + 1}`).join(', ');
  const itemRows = await db.select<ItemRow[]>(
    `SELECT * FROM items WHERE id IN (${inItemsClause})`,
    itemIds,
  );
  const itemMap = new Map<string, Item>();
  for (const ir of itemRows) {
    itemMap.set(ir.id, toItem(ir));
  }

  const results: HybridSearchResult[] = [];
  for (const entry of scored) {
    const ch = entry.chunk;
    const it = itemMap.get(ch.item_id);
    if (it) {
      results.push({
        chunk: ch,
        item: it,
        score: entry.rrf,
        matchSource: entry.source,
      });
    }
  }

  return results;
}

// --- Taksonomi & Koleksiyon Özetleri (CollectionsView için) ---

export interface CollectionWithCount extends Collection {
  count: number;
  previewThumbnails: string[];
}

export interface CategoryWithCount extends Category {
  count: number;
}

export interface TagWithCount extends Tag {
  count: number;
}

export async function listCollectionsWithCounts(): Promise<CollectionWithCount[]> {
  const db = await getDb();
  const cols = await listCollections();
  const counts = await db.select<{ collection_id: string; count: number }[]>(
    'SELECT collection_id, COUNT(*) as count FROM items WHERE collection_id IS NOT NULL GROUP BY collection_id',
  );
  const previews = await db.select<{ collection_id: string; thumbnail: string }[]>(
    'SELECT collection_id, thumbnail FROM items WHERE collection_id IS NOT NULL AND thumbnail IS NOT NULL AND thumbnail != "" ORDER BY created_at DESC',
  );

  const countMap = new Map<string, number>();
  for (const c of counts) countMap.set(c.collection_id, c.count);

  const previewMap = new Map<string, string[]>();
  for (const p of previews) {
    const list = previewMap.get(p.collection_id) ?? [];
    if (list.length < 4) {
      list.push(p.thumbnail);
      previewMap.set(p.collection_id, list);
    }
  }

  return cols.map((col) => ({
    ...col,
    count: countMap.get(col.id) ?? 0,
    previewThumbnails: previewMap.get(col.id) ?? [],
  }));
}

export async function listCategoriesWithCounts(): Promise<CategoryWithCount[]> {
  const db = await getDb();
  const cats = await listCategories();
  const counts = await db.select<{ category_id: string; count: number }[]>(
    'SELECT category_id, COUNT(*) as count FROM item_categories GROUP BY category_id',
  );
  const countMap = new Map<string, number>();
  for (const c of counts) countMap.set(c.category_id, c.count);

  return cats.map((cat) => ({
    ...cat,
    count: countMap.get(cat.id) ?? 0,
  }));
}

export async function listTagsWithCounts(): Promise<TagWithCount[]> {
  const db = await getDb();
  const tags = await listTags();
  const counts = await db.select<{ tag_id: string; count: number }[]>(
    'SELECT tag_id, COUNT(*) as count FROM item_tags GROUP BY tag_id',
  );
  const countMap = new Map<string, number>();
  for (const c of counts) countMap.set(c.tag_id, c.count);

  return tags.map((t) => ({
    ...t,
    count: countMap.get(t.id) ?? 0,
  }));
}

// --- IDM Turbo Download Jobs ---

export type DownloadStatus = 'active' | 'queued' | 'paused' | 'completed' | 'error';
export type DownloadCategory = 'video' | 'audio' | 'archive' | 'document' | 'program' | 'other';

export interface DownloadJob {
  id: string;
  url: string;
  filename: string;
  destination_path: string;
  file_size: number;
  downloaded_size: number;
  status: DownloadStatus;
  category: DownloadCategory;
  threads: number;
  speed_bps: number;
  eta_secs: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewDownloadJob {
  id?: string;
  url: string;
  filename: string;
  destination_path: string;
  file_size?: number;
  threads?: number;
  category?: DownloadCategory;
  status?: DownloadStatus;
}

export function detectCategoryFromFilename(name: string): DownloadCategory {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', '3gp'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma'].includes(ext)) return 'audio';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'dmg'].includes(ext)) return 'archive';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'epub'].includes(ext)) return 'document';
  if (['exe', 'msi', 'apk', 'deb', 'rpm', 'appimage'].includes(ext)) return 'program';
  return 'other';
}

export async function createDownloadJob(input: NewDownloadJob): Promise<DownloadJob> {
  const db = await getDb();
  const id = input.id ?? crypto.randomUUID();
  const category = input.category ?? detectCategoryFromFilename(input.filename);
  const row: DownloadJob = {
    id,
    url: input.url,
    filename: input.filename,
    destination_path: input.destination_path,
    file_size: input.file_size ?? 0,
    downloaded_size: 0,
    status: input.status ?? 'active',
    category,
    threads: input.threads ?? 8,
    speed_bps: 0,
    eta_secs: 0,
    error_message: null,
    created_at: now(),
    updated_at: now(),
  };

  await db.execute(
    `INSERT INTO downloads (id, url, filename, destination_path, file_size, downloaded_size, status, category, threads, speed_bps, eta_secs, error_message, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      row.id,
      row.url,
      row.filename,
      row.destination_path,
      row.file_size,
      row.downloaded_size,
      row.status,
      row.category,
      row.threads,
      row.speed_bps,
      row.eta_secs,
      row.error_message,
      row.created_at,
      row.updated_at,
    ],
  );
  return row;
}

export async function listDownloadJobs(statusFilter?: DownloadStatus): Promise<DownloadJob[]> {
  const db = await getDb();
  if (statusFilter) {
    return db.select<DownloadJob[]>('SELECT * FROM downloads WHERE status = $1 ORDER BY created_at DESC', [statusFilter]);
  }
  return db.select<DownloadJob[]>('SELECT * FROM downloads ORDER BY created_at DESC');
}

export async function getDownloadJob(id: string): Promise<DownloadJob | null> {
  const db = await getDb();
  const rows = await db.select<DownloadJob[]>('SELECT * FROM downloads WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function updateDownloadJob(id: string, patch: Partial<DownloadJob>): Promise<void> {
  const db = await getDb();
  const sets: string[] = ['updated_at = $1'];
  const values: unknown[] = [now()];
  let idx = 2;

  if (patch.filename !== undefined) { sets.push(`filename = $${idx++}`); values.push(patch.filename); }
  if (patch.destination_path !== undefined) { sets.push(`destination_path = $${idx++}`); values.push(patch.destination_path); }
  if (patch.file_size !== undefined) { sets.push(`file_size = $${idx++}`); values.push(patch.file_size); }
  if (patch.downloaded_size !== undefined) { sets.push(`downloaded_size = $${idx++}`); values.push(patch.downloaded_size); }
  if (patch.status !== undefined) { sets.push(`status = $${idx++}`); values.push(patch.status); }
  if (patch.category !== undefined) { sets.push(`category = $${idx++}`); values.push(patch.category); }
  if (patch.threads !== undefined) { sets.push(`threads = $${idx++}`); values.push(patch.threads); }
  if (patch.speed_bps !== undefined) { sets.push(`speed_bps = $${idx++}`); values.push(patch.speed_bps); }
  if (patch.eta_secs !== undefined) { sets.push(`eta_secs = $${idx++}`); values.push(patch.eta_secs); }
  if (patch.error_message !== undefined) { sets.push(`error_message = $${idx++}`); values.push(patch.error_message); }

  values.push(id);
  await db.execute(`UPDATE downloads SET ${sets.join(', ')} WHERE id = $${idx}`, values);
}

export async function removeDownloadJob(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM downloads WHERE id = $1', [id]);
}

export async function clearCompletedDownloads(): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM downloads WHERE status = $1', ['completed']);
}

export async function getArticleForItem(itemId: string): Promise<ItemArticle | null> {
  const db = await getDb();
  const rows = await db.select<ItemArticle[]>('SELECT * FROM item_articles WHERE item_id = $1', [itemId]);
  return rows[0] ?? null;
}

export async function saveArticleForItem(article: ItemArticle): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO item_articles (
      item_id, title, content_text, content_markdown, author, published_at,
      reading_time_mins, lead_image, images_json, videos_json, site_name, scraped_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT(item_id) DO UPDATE SET
      title = excluded.title,
      content_text = excluded.content_text,
      content_markdown = excluded.content_markdown,
      author = excluded.author,
      published_at = excluded.published_at,
      reading_time_mins = excluded.reading_time_mins,
      lead_image = excluded.lead_image,
      images_json = excluded.images_json,
      videos_json = excluded.videos_json,
      site_name = excluded.site_name,
      scraped_at = excluded.scraped_at`,
    [
      article.item_id,
      article.title,
      article.content_text,
      article.content_markdown,
      article.author,
      article.published_at,
      article.reading_time_mins,
      article.lead_image,
      article.images_json,
      article.videos_json,
      article.site_name,
      article.scraped_at || now(),
    ],
  );
}

export async function deleteArticleForItem(itemId: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM item_articles WHERE item_id = $1', [itemId]);
}

export async function listItemsWithoutArticle(): Promise<Item[]> {
  const db = await getDb();
  const rows = await db.select<ItemRow[]>(
    `SELECT i.* FROM items i
     LEFT JOIN item_articles a ON i.id = a.item_id
     WHERE a.item_id IS NULL
     ORDER BY i.created_at DESC`,
  );
  return rows.map(toItem);
}

export async function hasArticleForItem(itemId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    'SELECT COUNT(*) as count FROM item_articles WHERE item_id = $1',
    [itemId],
  );
  return (rows[0]?.count ?? 0) > 0;
}

export async function getArticleItemIds(itemIds?: string[]): Promise<Set<string>> {
  const db = await getDb();
  if (itemIds && itemIds.length === 0) return new Set();
  const query =
    itemIds && itemIds.length > 0
      ? `SELECT item_id FROM item_articles WHERE item_id IN (${itemIds.map((_, i) => `$${i + 1}`).join(', ')})`
      : 'SELECT item_id FROM item_articles';
  const rows = await db.select<{ item_id: string }[]>(query, itemIds && itemIds.length > 0 ? itemIds : []);
  return new Set(rows.map((r) => r.item_id));
}

export async function listDownloadedItems(): Promise<Item[]> {
  const db = await getDb();
  const rows = await db.select<ItemRow[]>(
    `SELECT * FROM items 
     WHERE download_status = 'done' OR local_path IS NOT NULL OR download_status IN ('active', 'queued')
     ORDER BY updated_at DESC`,
  );
  return rows.map(toItem);
}

/** Kayıt künyesi için yazarlar (tek sorgu; N+1 değil). */
export async function listArticleAuthors(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.select<{ item_id: string; author: string | null }[]>(
    'SELECT item_id, author FROM item_articles WHERE author IS NOT NULL',
  );
  const out: Record<string, string> = {};
  for (const r of rows) if (r.author) out[r.item_id] = r.author;
  return out;
}

// --- defter (notebook): kategori sayfalarına okunabilir derlem ---

export interface NotebookSummary {
  category_id: string;
  summary: string;
  model: string | null;
  generated_at: string;
}

export interface NotebookItemRow extends Item {
  content_text: string | null;
  content_markdown: string | null;
  images_json: string | null;
  videos_json: string | null;
  author: string | null;
  published_at: string | null;
}

export async function getCategorySummary(categoryId: string): Promise<NotebookSummary | null> {
  const db = await getDb();
  const rows = await db.select<NotebookSummary[]>(
    'SELECT category_id, summary, model, generated_at FROM notebook_summaries WHERE category_id = $1',
    [categoryId],
  );
  return rows[0] ?? null;
}

export async function saveCategorySummary(
  categoryId: string,
  summary: string,
  model: string | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO notebook_summaries (category_id, summary, model, generated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(category_id) DO UPDATE SET
       summary = excluded.summary,
       model = excluded.model,
       generated_at = excluded.generated_at`,
    [categoryId, summary, model, now()],
  );
}

/** Kategorize edilmemiş kayıtlar — defterin "Sınıflandırılmamış" sayfası kaynağı. */
export async function listItemsMissingCategory(): Promise<Item[]> {
  const db = await getDb();
  const rows = await db.select<ItemRow[]>(
    `SELECT i.* FROM items i
     WHERE NOT EXISTS (SELECT 1 FROM item_categories ic WHERE ic.item_id = i.id)
     ORDER BY i.created_at DESC`,
  );
  return rows.map(toItem);
}

/**
 * Defter sayfa kayıtları: item alanları + makale içeriği tek sorguda
 * (sayfa başına 48 satır; N+1 okuma yerine JOIN).
 */
export async function listNotebookItems(
  categoryId: string | null,
  limit = 48,
  offset = 0,
  sort: 'new' | 'old' = 'new',
): Promise<{ rows: NotebookItemRow[]; total: number }> {
  const db = await getDb();
  const dir = sort === 'old' ? 'ASC' : 'DESC';
  const join = categoryId === null ? '' : 'JOIN item_categories ic ON ic.item_id = i.id';
  const where =
    categoryId === null ? 'NOT EXISTS (SELECT 1 FROM item_categories c WHERE c.item_id = i.id)' : '';
  const filter = categoryId === null ? 'WHERE ' + where : 'WHERE ic.category_id = $1';
  const params = categoryId === null ? [] : [categoryId];
  const totals = await db.select<{ count: number }[]>(
    `SELECT COUNT(*) as count FROM items i ${join} ${filter}`,
    params,
  );
  const base = categoryId === null ? 1 : 2;
  const rows = await db.select<
    (ItemRow & {
      content_text: string | null;
      content_markdown: string | null;
      images_json: string | null;
      videos_json: string | null;
      author: string | null;
      published_at: string | null;
    })[]
  >(
    `SELECT i.*, a.content_text, a.content_markdown, a.images_json, a.videos_json, a.author, a.published_at
     FROM items i
     LEFT JOIN item_articles a ON a.item_id = i.id
     ${join}
     ${filter}
     ORDER BY i.created_at ${dir}
     LIMIT $${base} OFFSET $${base + 1}`,
    [...params, limit, offset],
  );
  return { rows: rows.map(toNotebookRow), total: totals[0]?.count ?? 0 };
}

const toNotebookRow = (
  r: ItemRow & {
    content_text: string | null;
    content_markdown: string | null;
    images_json: string | null;
    videos_json: string | null;
    author: string | null;
    published_at: string | null;
  },
): NotebookItemRow => ({
  ...toItem(r),
  content_text: r.content_text,
  content_markdown: r.content_markdown,
  images_json: r.images_json,
  videos_json: r.videos_json,
  author: r.author,
  published_at: r.published_at,
});

/**
 * Birleştirme: tek transaction (runAtomicSafe) — junction union, scalar patch,
 * article taşıma/kaldırma, fts temizliği ve artık silme. Kapı: K organizasyon.
 */
export async function mergeItems(
  targetId: string,
  victimIds: string[],
  patch: {
    note: string;
    favorite: boolean;
    title: string | null;
    thumbnail: string | null;
    created_at: string;
  },
): Promise<void> {
  if (victimIds.length === 0) return;
  const db = await getDb();
  /* Tek parametreli blob gövde: values cümle başına sırayla bağlanır
     (plugin-sql ölçülmüş davranış) ve her cümle aynı blob'u görür. */
  const { body, values } = buildMergeBlob(
    {
      target: targetId,
      note: patch.note,
      favorite: patch.favorite,
      title: patch.title,
      thumbnail: patch.thumbnail,
      created_at: patch.created_at,
      updated_at: now(),
    },
    victimIds,
  );
  await runAtomicSafe(db, body, values);
  invalidateVectorIndex();
}


