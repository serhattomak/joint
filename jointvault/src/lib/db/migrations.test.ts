import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  planMigrations,
  runMigrations,
  type Migration,
  type MigrationExecutor,
} from './migrations';

/* Sürümler listeden TÜRETİLİR: yeni bir göç eklendiğinde bu testler kırılmamalı. */
const ALL_VERSIONS = MIGRATIONS.map((migration) => migration.version);
const LATEST = MIGRATIONS[MIGRATIONS.length - 1].version;

const sqliteExecutor = (db: DatabaseSync): MigrationExecutor => ({  currentVersion: async () => {
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

/* Eski kasa (1): bugünkü şemayı taşır ama sürümü 0'dır — bu değişiklikten önce
   oluşturulmuş HER kasa böyle. Göçler "duplicate column name" ile karşılaşır ve
   bunu yok sayması gerekir. */
const schemaAtVersionZero = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:');
  for (const sql of MIGRATIONS[0].statements) db.exec(sql);
  return db;
};

/* Eski kasa (2): kolonlar eklenmeden ÖNCEKİ items tablosu. Göçlerin gerçekten
   kolon eklediğini kanıtlar (yok sayılan bir hata değil, iş yapan bir göç). */
const preAlterDb = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE items (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT,
    note TEXT,
    platform TEXT NOT NULL DEFAULT 'other',
    thumbnail TEXT,
    favorite INTEGER NOT NULL DEFAULT 0,
    collection_id TEXT,
    user_id TEXT,
    created_at TEXT,
    updated_at TEXT
  )`);
  return db;
};

describe('planMigrations', () => {
  it('sıfır sürümde tüm göçleri döndürür', () => {
    expect(planMigrations(0).map((m) => m.version)).toEqual(ALL_VERSIONS);
  });

  it('uygulanmış göçleri atlar', () => {
    expect(planMigrations(2).map((m) => m.version)).toEqual(ALL_VERSIONS.filter((v) => v > 2));
  });

  it('güncel kasa için boş liste döndürür', () => {
    expect(planMigrations(LATEST)).toEqual([]);
  });

  it('sürümü daha yeni olsa bile boş liste döndürür', () => {
    /* İleriye dönük: kasa daha yeni bir sürümdeyse eski uygulama geri gitmemeli. */
    expect(planMigrations(99)).toEqual([]);
  });

  it('girdi sırası bozuk olsa da artan sırada döndürür', () => {
    // Arrange
    const shuffled: Migration[] = [
      { version: 3, description: 'c', statements: [] },
      { version: 1, description: 'a', statements: [] },
      { version: 2, description: 'b', statements: [] },
    ];

    // Act + Assert
    expect(planMigrations(0, shuffled).map((m) => m.version)).toEqual([1, 2, 3]);
  });
});

describe('runMigrations — taze kasa', () => {
  it('tüm göçleri uygular ve son sürüme çıkar', async () => {
    // Arrange
    const db = new DatabaseSync(':memory:');

    // Act
    const result = await runMigrations(sqliteExecutor(db));

    // Assert
    expect(result).toEqual({ from: 0, to: LATEST, applied: ALL_VERSIONS });
  });

  it('sürümü veritabanına yazar', async () => {
    // Arrange
    const db = new DatabaseSync(':memory:');

    // Act
    await runMigrations(sqliteExecutor(db));
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };

    // Assert
    expect(row.user_version).toBe(LATEST);
  });

  it('şemayı gerçekten kurar', async () => {
    // Arrange
    const db = new DatabaseSync(':memory:');

    // Act
    await runMigrations(sqliteExecutor(db));
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'items'")
      .all();

    // Assert
    expect(names).toHaveLength(1);
  });

  it('ikinci kez çağrıldığında hiçbir göç uygulamaz', async () => {
    // Arrange
    const db = new DatabaseSync(':memory:');
    const exec = sqliteExecutor(db);
    await runMigrations(exec);

    // Act
    const second = await runMigrations(exec);

    // Assert
    expect(second.applied).toEqual([]);
  });
});

describe('runMigrations — eski (sürümsüz) kasa', () => {
  it('şemayı zaten taşıyan kasada hata vermez', async () => {
    // Arrange
    const db = schemaAtVersionZero();

    // Act
    const result = await runMigrations(sqliteExecutor(db));

    // Assert
    expect(result.to).toBe(LATEST);
  });

  it('VERİYİ KORUR: göç öncesi satır yerinde kalır', async () => {
    /* Göçün amacı bu: şemayı ilerletmek, kaydı kaybetmemek. */
    // Arrange
    const db = schemaAtVersionZero();
    db.exec(
      "INSERT INTO items (id, url, platform, created_at, updated_at) VALUES ('i1', 'https://a', 'x', '2026-01-01', '2026-01-01')",
    );

    // Act
    await runMigrations(sqliteExecutor(db));
    const rows = db.prepare('SELECT url FROM items').all() as { url: string }[];

    // Assert
    expect(rows.map((r) => r.url)).toEqual(['https://a']);
  });

  it('kolonları eksik eski tabloya yeni kolonları EKLER', async () => {
    // Arrange
    const db = preAlterDb();

    // Act
    await runMigrations(sqliteExecutor(db));
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('items')")
      .all()
      .map((row) => String((row as { name: unknown }).name));

    // Assert
    expect(columns).toContain('converted_path');
  });
});

describe('runMigrations — yedek kancası', () => {
  it('bekleyen göç varsa beforeApply bir kez çağrılır', async () => {
    // Arrange
    const db = new DatabaseSync(':memory:');
    const calls: number[][] = [];

    // Act
    await runMigrations(sqliteExecutor(db), MIGRATIONS, async (pending) => {
      calls.push(pending.map((m) => m.version));
    });

    // Assert
    expect(calls).toEqual([ALL_VERSIONS]);
  });

  it('bekleyen göç yoksa beforeApply çağrılmaz', async () => {
    // Arrange
    const db = new DatabaseSync(':memory:');
    const exec = sqliteExecutor(db);
    await runMigrations(exec);
    let called = false;

    // Act
    await runMigrations(exec, MIGRATIONS, async () => {
      called = true;
    });

    // Assert
    expect(called).toBe(false);
  });
});
