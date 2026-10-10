import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, type MigrationExecutor } from './migrations';
import { MAX_DEPTH } from '../taxonomy-tree';

/*
 * `resolveCategoryFilterIds`in SQL'i GERÇEK SQLite üzerinde.
 *
 * Sorgu client.ts'ten OKUNUR, kopyalanmaz: kopya zamanla sapar ve testi
 * yalancı yapar. `$1` bağlanır, `${MAX_DEPTH}` ise sabitten gerçek değere
 * çevrilir — böylece test hem sorguyu hem de gömme sayı OLMADIĞINI çivler.
 */
const clientSource = readFileSync(new URL('./client.ts', import.meta.url), 'utf8');
const sqlMatch = clientSource.match(/const CATEGORY_FILTER_IDS_SQL = `([\s\S]*?)`;/);
if (!sqlMatch) throw new Error('client.ts: CATEGORY_FILTER_IDS_SQL bulunamadı');
const categoryFilterIdsSql = sqlMatch[1].replace('${MAX_DEPTH}', String(MAX_DEPTH));

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

/** Üretim sorgusunu birebir çalıştırır; satır yoksa (client.ts) seçilen id döner. */
const subtreeIds = (id: string): string[] => {
  const rows = db.prepare(categoryFilterIdsSql).all({ $1: id }) as { id: string }[];
  return rows.map((r) => r.id);
};

/** Yemek > Tatlı > Sütlü Tatlı; Yazılım ayrı dal (kardeş değil, yabancı kök). */
const seed = (): void => {
  db.exec('DELETE FROM categories');
  const cat = db.prepare(
    'INSERT INTO categories (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  );
  cat.run('yemek', 'Yemek', null, '2026-01-01', '2026-01-01');
  cat.run('tatli', 'Tatlı', 'yemek', '2026-01-01', '2026-01-01');
  cat.run('sutlu', 'Sütlü Tatlı', 'tatli', '2026-01-01', '2026-01-01');
  cat.run('yazilim', 'Yazılım', null, '2026-01-01', '2026-01-01');
};

describe('resolveCategoryFilterIds SQL — özyinelemeli filtre', () => {
  beforeEach(seed);

  it('3 seviyeli ağaçta TÜM torunları toplar', () => {
    expect(subtreeIds('yemek').sort()).toEqual(['sutlu', 'tatli', 'yemek']);
  });

  it('yalnız kendi altını, kardeş dalı almaz', () => {
    expect(subtreeIds('tatli').sort()).toEqual(['sutlu', 'tatli']);
  });

  it('yaprak düğüm yalnız kendini döner', () => {
    expect(subtreeIds('sutlu')).toEqual(['sutlu']);
  });

  it('BOZUK VERİDE sonsuz döngüye girmez (kapıyı atlayan elle yazım)', () => {
    // A.parent=B, B.parent=A: döngü. depth sınırı sorguyu durdurmalı.
    // FK yüzünden önce ikisi de kök, sonra bağlar kurulur (kapı atlanır).
    db.exec('DELETE FROM categories');
    const cat = db.prepare(
      'INSERT INTO categories (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    cat.run('a', 'A', null, '2026-01-01', '2026-01-01');
    cat.run('b', 'B', null, '2026-01-01', '2026-01-01');
    db.exec("UPDATE categories SET parent_id = 'b' WHERE id = 'a'");
    db.exec("UPDATE categories SET parent_id = 'a' WHERE id = 'b'");

    const ids = subtreeIds('a');
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(MAX_DEPTH);
  });
});
