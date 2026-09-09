import Database from '@tauri-apps/plugin-sql';
import schema from './schema.sql?raw';
import type { Collection, Item, Tag } from './types';

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
  return db;
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

export type ItemPatch = Partial<Pick<Item, 'url' | 'title' | 'note' | 'platform' | 'thumbnail' | 'collection_id'>>;

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

export async function setTagsForItem(item_id: string, tag_ids: string[]): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM item_tags WHERE item_id = $1', [item_id]);
  for (const tag_id of tag_ids) {
    await db.execute('INSERT INTO item_tags (item_id, tag_id) VALUES ($1, $2)', [item_id, tag_id]);
  }
}
