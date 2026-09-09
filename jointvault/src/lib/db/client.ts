import Database from '@tauri-apps/plugin-sql';
import schema from './schema.sql?raw';
import type { Category, Collection, Item, Tag } from './types';

const DB_PATH = 'sqlite:jointvault.db';

// SQLite returns favorite as 0/1; map to boolean at the boundary.
type ItemRow = Omit<Item, 'favorite'> & { favorite: number };
const toItem = (r: ItemRow): Item => ({ ...r, favorite: r.favorite === 1 });

const now = (): string => new Date().toISOString();

let dbPromise: Promise<Database> | null = null;

async function initDb(): Promise<Database> {
  const db = await Database.load(DB_PATH);
  // ponytail: split on ';' so init works whether execute() allows multi-statement or not.
  for (const stmt of schema.split(';')) {
    const sql = stmt.trim();
    if (sql) await db.execute(sql);
  }
  await ensureDownloadColumns(db);
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

export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = initDb();
  return dbPromise;
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

export type ItemPatch = Partial<
  Pick<Item, 'url' | 'title' | 'note' | 'platform' | 'thumbnail' | 'collection_id' | 'local_path' | 'download_status' | 'download_error'>
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
}

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
  const from =
    'FROM items i LEFT JOIN item_categories ic ON ic.item_id = i.id LEFT JOIN item_tags it ON it.item_id = i.id';
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const [countRows] = [
    await db.select<{ n: number }[]>(`SELECT COUNT(DISTINCT i.id) AS n ${from} ${where}`, params),
  ];
  const total = countRows[0]?.n ?? 0;
  if (total === 0) return { rows: [], total };
  const rows = await db.select<ItemRow[]>(
    `SELECT DISTINCT i.* ${from} ${where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
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
