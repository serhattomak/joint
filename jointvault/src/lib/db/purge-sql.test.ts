import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type MigrationExecutor } from './migrations';

/*
 * `purgeTaxonomy`in SQL'i GERÇEK SQLite üzerinde.
 *
 * Saf mantık testi (taxonomy-purge.test.ts) "hangi metin gösterilir" diye
 * bakar; buradaki test SCHEMA sözleşmesini çiviler:
 *   - hiyerarşi (göç 8) alt kategorileri engellemez,
 *   - FK CASCADE kayıtları SİLMEZ, yalnız bağı düşürür,
 *   - silinen satır sayısı sildikten SONRA değil, ÖNCE sayılır.
 */

const executor = (db: DatabaseSync): MigrationExecutor => ({
  currentVersion: async () => {
    const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    return row?.user_version ?? 0;
  },
  execute: async (sql) => {
    db.exec(sql);
  },
  setVersion: async (version) => {
    db.exec(`PRAGMA user_version = ${version}`);
  },
});

let db: DatabaseSync;
beforeAll(async () => {
  db = new DatabaseSync(':memory:');
  await runMigrations(executor(db));
});

/** `purgeTaxonomy`in SQL'ini birebir çalıştırır (client.ts'teki sıra). */
const purge = (kind: 'categories' | 'tags'): { removed: number; itemIds: string[] } => {
  const linkTable = kind === 'categories' ? 'item_categories' : 'item_tags';
  const rootTable = kind === 'categories' ? 'categories' : 'tags';

  const itemIds = (
    db.prepare(`SELECT DISTINCT item_id FROM ${linkTable}`).all() as { item_id: string }[]
  ).map((r) => r.item_id);

  const countRow = db.prepare(`SELECT COUNT(*) AS n FROM ${rootTable}`).get() as { n: number };

  if (kind === 'categories') {
    db.exec('DELETE FROM categories WHERE parent_id IS NOT NULL');
  }
  db.exec(`DELETE FROM ${rootTable}`);

  return { removed: countRow.n, itemIds };
};

/** Testler birbirini kirletmesin: her seed önceki durumu tamamen siler. */
const seed = (): void => {
  db.exec('DELETE FROM item_tags');
  db.exec('DELETE FROM item_categories');
  db.exec('DELETE FROM tags');
  db.exec('DELETE FROM categories');
  db.exec('DELETE FROM items');

  db.exec("INSERT INTO items (id, url, platform) VALUES ('i1','https://a','x')");
  db.exec("INSERT INTO items (id, url, platform) VALUES ('i2','https://b','x')");
  // Yemek > Pizza hiyerarşisi
  db.exec(
    "INSERT INTO categories (id, name, created_at, updated_at) VALUES ('p1','Yemek','2026-01-01','2026-01-01')",
  );
  db.exec(
    "INSERT INTO categories (id, name, parent_id, created_at, updated_at) VALUES ('c1','Pizza','p1','2026-01-01','2026-01-01')",
  );
  db.exec(
    "INSERT INTO categories (id, name, created_at, updated_at) VALUES ('c2','Çorba','2026-01-01','2026-01-01')",
  );
  db.exec("INSERT INTO item_categories (item_id, category_id) VALUES ('i1','c1')");
  db.exec("INSERT INTO item_categories (item_id, category_id) VALUES ('i2','c2')");
  db.exec("INSERT INTO tags (id, name, created_at, updated_at) VALUES ('t1','hamur','2026-01-01','2026-01-01')");
  db.exec("INSERT INTO item_tags (item_id, tag_id) VALUES ('i1','t1')");
};

describe('purgeTaxonomy SQL — kategoriler', () => {
  it('hiyerarşili kategorileri siler; alt önce silinir (FK kırılmaz)', () => {
    // Arrange
    seed();
    db.exec('PRAGMA foreign_keys = ON');

    // Act
    const r = purge('categories');

    // Assert
    expect(r.removed).toBe(3); // Yemek + Pizza + Çorba — sayı ÖNCE alındı
    expect(db.prepare('SELECT COUNT(*) AS n FROM categories').get()).toEqual({ n: 0 });
  });

  it('kayıtların KENDİSİ silinmez, yalnız bağ düşer', () => {
    // Arrange
    seed();
    db.exec('PRAGMA foreign_keys = ON');

    // Act
    purge('categories');

    // Assert
    expect(db.prepare('SELECT COUNT(*) AS n FROM items').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM item_categories').get()).toEqual({ n: 0 });
  });

  it('etkilenen kayıt id\'lerini döner (indeks tazeleme için)', () => {
    // Arrange
    seed();

    // Act
    const r = purge('categories');

    // Assert
    expect(r.itemIds.sort()).toEqual(['i1', 'i2']);
  });

  it('boş tabloda sıfır döner, hata vermez', () => {
    // Arrange
    db.exec('DELETE FROM items');
    db.exec('DELETE FROM categories');

    // Act + Assert
    expect(purge('categories')).toEqual({ removed: 0, itemIds: [] });
  });
});

describe('purgeTaxonomy SQL — etiketler', () => {
  it('etiketleri ve bağlarını siler, kayıtlar kalır', () => {
    // Arrange
    seed();
    db.exec('PRAGMA foreign_keys = ON');

    // Act
    const r = purge('tags');

    // Assert
    expect(r.removed).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM tags').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM item_tags').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM items').get()).toEqual({ n: 2 });
  });

  it('kategorilere dokunmaz', () => {
    // Arrange
    seed();

    // Act
    purge('tags');

    // Assert
    expect(db.prepare('SELECT COUNT(*) AS n FROM categories').get()).toEqual({ n: 3 });
  });
});