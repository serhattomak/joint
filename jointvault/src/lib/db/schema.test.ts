/*
 * Şema başlatma testi — dev/check-schema.mjs'in vitest karşılığı.
 *
 * initDb()'nin gerçek yolunu koşar: yorum satırlarını düşür, ';' ile böl, her
 * parçayı SQLite'a ver. Amaç, şema hatasının UYGULAMADA değil burada patlaması.
 *
 * Neden Node'un kendi sqlite'ı: client.ts Tauri SQL eklentisini içe aktardığı
 * için Node'da çalıştırılamaz; şema metni ve bölücü ise platformdan bağımsızdır.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from './sql-split';

const SCHEMA_SQL = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

interface SchemaRun {
  failures: { index: number; sql: string; message: string }[];
  tables: string[];
  indexes: string[];
}

const runSchema = (): SchemaRun => {
  const db = new DatabaseSync(':memory:');
  const failures: SchemaRun['failures'] = [];

  splitSqlStatements(SCHEMA_SQL).forEach((sql, index) => {
    try {
      db.exec(sql);
    } catch (error) {
      failures.push({ index: index + 1, sql, message: (error as Error).message });
    }
  });

  const names = (type: 'table' | 'index') =>
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all(type)
      .map((row) => String(row.name));

  return {
    failures,
    tables: names('table').filter((name) => !name.includes('_fts')),
    indexes: names('index').filter((name) => name.startsWith('idx_')),
  };
};

const run = runSchema();

describe('initDb şema yolu', () => {
  it('çalıştırılan her şema ifadesi hatasız geçer', () => {
    // Arrange: parçalar runSchema() içinde çalıştırıldı.
    // Act
    const { failures } = run;

    // Assert
    expect(failures.map((f) => `${f.index}. parça: ${f.message}`)).toEqual([]);
  });

  it('çekirdek tabloları oluşturur', () => {
    expect(run.tables).toEqual([
      'categories',
      'collections',
      'downloads',
      'item_analysis',
      'item_articles',
      'item_categories',
      'item_chunks',
      'item_tags',
      'items',
      'tags',
    ]);
  });

  it('idx_ önekli indeksleri oluşturur', () => {
    expect(run.indexes).toEqual([
      'idx_articles_scraped_at',
      'idx_chunks_item_id',
      'idx_chunks_type',
      'idx_downloads_category',
      'idx_downloads_created_at',
      'idx_downloads_status',
      'idx_item_analysis_status',
      'idx_item_categories_cat',
      'idx_item_tags_tag',
      'idx_items_collection',
      'idx_items_created_at',
      'idx_items_platform',
      'idx_items_title_nocase',
    ]);
  });

  it('parça sayısı tam beklenen değerde kalır (sessiz bölünme koruması)', () => {
    /* Bir yorumdaki ';' parçayı ortadan keserse sayı DÜŞER ve bu test haber verir.
       Şema bilinçli değişirse sayı da bilinçli güncellenir — değişim dedektörü. */
    // Arrange: parçalar splitSqlStatements ile üretildi.

    // Act
    const statementCount = splitSqlStatements(SCHEMA_SQL).length;

    // Assert
    expect(statementCount).toBe(25);
  });
});
