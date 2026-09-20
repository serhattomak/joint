import Database from '@tauri-apps/plugin-sql';
import schema from './schema.sql?raw';
import type { Category, Collection, HybridSearchResult, Item, ItemArticle, ItemChunkRow, Tag } from './types';
import { base64ToVector, cosineSimilarity, type ItemChunk } from '../chunker';
import { createRetryCache } from '../retry-cache';
import { splitSqlStatements } from './sql-split';

const DB_PATH = 'sqlite:jointvault.db';

// SQLite returns favorite as 0/1; map to boolean at the boundary.
type ItemRow = Omit<Item, 'favorite'> & { favorite: number };
const toItem = (r: ItemRow): Item => ({ ...r, favorite: r.favorite === 1 });

const now = (): string => new Date().toISOString();

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

async function initDb(): Promise<Database> {
  const db = await Database.load(DB_PATH);
  for (const sql of splitSqlStatements(schema)) {
    await db.execute(sql);
  }
  await ensureDownloadColumns(db);
  await ensureConvertedPath(db);
  return db;
}

// ponytail: existing DBs lack the download columns (added later). ALTER fails on
// second run (SQLite: duplicate column name), so ignore that error — keeps init
// green on both fresh (columns already in CREATE TABLE) and existing DBs.
async function ensureDownloadColumns(db: Database): Promise<void> {
  for (const sql of [
    'ALTER TABLE items ADD COLUMN local_path TEXT',
    "ALTER TABLE items ADD COLUMN download_status TEXT NOT NULL DEFAULT 'none'",
    'ALTER TABLE items ADD COLUMN download_error TEXT',
  ]) {
    try {
      await db.execute(sql);
    } catch (e) {
      if (!/duplicate column name/i.test(String(e))) throw e;
    }
  }
}

// ponytail: existing DBs lack converted_path (added later). Same duplicate-column-ignore
// keeps init green on fresh (column already in CREATE TABLE) and existing DBs.
async function ensureConvertedPath(db: Database): Promise<void> {
  try {
    await db.execute('ALTER TABLE items ADD COLUMN converted_path TEXT');
  } catch (e) {
    if (!/duplicate column name/i.test(String(e))) throw e;
  }
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
  return toItem(row);
}

export async function removeItem(id: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM items WHERE id = $1', [id]);
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
  downloadedOnly?: boolean;
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
  if (f.downloadedOnly) conds.push("i.download_status = 'done'");
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

export async function getOrCreateTag(name: string, user_id: string | null = null): Promise<Tag> {
  const db = await getDb();
  const [existing] = await db.select<Tag[]>('SELECT * FROM tags WHERE name = $1', [name]);
  if (existing) return existing;
  return createTag(name, user_id);
}

// --- item_tags ---

export async function getTagsForItem(item_id: string): Promise<Tag[]> {
  const db = await getDb();
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

export async function setTagsForItem(item_id: string, tag_ids: string[]): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM item_tags WHERE item_id = $1', [item_id]);
  for (const tag_id of tag_ids) {
    await db.execute('INSERT INTO item_tags (item_id, tag_id) VALUES ($1, $2)', [item_id, tag_id]);
  }
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
  await db.execute('DELETE FROM item_categories WHERE item_id = $1', [item_id]);
  for (const category_id of category_ids) {
    await db.execute('INSERT INTO item_categories (item_id, category_id) VALUES ($1, $2)', [item_id, category_id]);
  }
}

// --- backup (JSON export/import, merge by id) ---

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

export async function importVault(data: VaultBackup): Promise<{ added: number }> {
  if (!data || data.version !== 1 || typeof data.tables !== 'object') {
    throw new Error('Geçersiz yedek dosyası.');
  }
  const db = await getDb();
  let added = 0;
  for (const t of BACKUP_TABLES) {
    const rows = data.tables[t];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const cols = Object.keys(row).filter((c) => COL_RE.test(c));
      if (cols.length === 0) continue;
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const res = await db.execute(`INSERT OR IGNORE INTO ${t} (${cols.join(', ')}) VALUES (${placeholders})`, cols.map((c) => row[c]));
      added += res.rowsAffected;
    }
  }
  return { added };
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

  for (const chunk of chunks) {
    const chunkId = chunk.id || crypto.randomUUID();
    await db.execute(
      `INSERT INTO item_chunks (id, item_id, chunk_type, chunk_text, start_seconds, end_seconds, embedding, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        chunkId,
        itemId,
        chunk.chunkType,
        chunk.chunkText,
        chunk.startSeconds ?? null,
        chunk.endSeconds ?? null,
        chunk.embedding ?? null,
        chunk.createdAt ?? now(),
      ],
    );

    try {
      await db.execute(
        `INSERT INTO item_chunks_fts (chunk_id, item_id, chunk_text) VALUES ($1, $2, $3)`,
        [chunkId, itemId, chunk.chunkText],
      );
    } catch {
      // ignore FTS insert errors if virtual table is unavailable
    }
  }
}

export async function deleteItemChunks(itemId: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM item_chunks WHERE item_id = $1', [itemId]);
  try {
    await db.execute('DELETE FROM item_chunks_fts WHERE item_id = $1', [itemId]);
  } catch {
    // ignore
  }
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
  const vectorScores = new Map<string, { score: number; chunk: ItemChunkRow }>();

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

  let allChunks: ItemChunkRow[] = [];
  if (queryEmbedding && queryEmbedding.length > 0) {
    allChunks = await getAllChunksWithEmbeddings();
    const queryVec = queryEmbedding instanceof Float32Array ? queryEmbedding : new Float32Array(queryEmbedding);

    const scored = allChunks.map((c) => {
      let sim = 0;
      if (c.embedding) {
        try {
          const cVec = base64ToVector(c.embedding);
          sim = cosineSimilarity(queryVec, cVec);
        } catch {
          sim = 0;
        }
      }
      return { chunk: c, sim };
    });

    scored.sort((a, b) => b.sim - a.sim);
    const topVec = scored.slice(0, 50);
    topVec.forEach((s) => {
      vectorScores.set(s.chunk.id, { score: s.sim, chunk: s.chunk });
    });
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
  const scored = Array.from(chunkMap.values())
    .flatMap((entry) => (entry.chunk ? [{ ...entry, chunk: entry.chunk }] : []))
    .sort((a, b) => b.rrf - a.rrf)
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


