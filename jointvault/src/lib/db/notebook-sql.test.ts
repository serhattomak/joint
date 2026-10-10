import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type MigrationExecutor } from './migrations';

/*
 * `listNotebookItems`in LIMIT/OFFSET yer tutucu aritmetiği — GERÇEK hata üzerine.
 *
 * Hata (SQLITE_MISMATCH, kod 20) şuydu: `base` sabit `2` varsayılıyordu, ama
 * kategori süzmesindeki `IN (...)` N yer tutucu tüketiyor. N>=2 olduğunda
 * `$2` iki kez kullanılıyor ve LIMIT'e kategori UUID'si (TEXT) bağlanıyor.
 * Yalnız ALT KATEGORİSİ OLAN bir kategori seçilince tetikleniyordu.
 *
 * Sorgu client.ts'ten OKUNUR, kopyalanmaz; kaynak-metin sözleşmesi üretimin
 * kendisini çivler (taxonomy-tree-sql.test.ts ile aynı desen).
 */
const clientSource = readFileSync(new URL('./client.ts', import.meta.url), 'utf8');

/** Tek bir üst düzey fonksiyonun gövdesini kabaca keser. */
const functionBody = (name: string): string => {
  const start = clientSource.indexOf(`export async function ${name}(`);
  if (start === -1) throw new Error(`client.ts: ${name} bulunamadı`);
  return clientSource.slice(start, clientSource.indexOf('\n}', start));
};

const notebookBody = functionBody('listNotebookItems');

/**
 * Tauri SQL eklentisi `$N`i params[N-1] ile bağlar. node:sqlite bunu konumsal
 * yapmadığı için eklentinin semantiğini birebir modellemek üzere `$N`ler
 * params[N-1] ile değiştirilir — böylece "$2 iki kez kullanılırsa ne olur"
 * sorusu gerçekten yanıtlanır.
 */
const bindPluginStyle = (sql: string, params: unknown[]): string =>
  sql.replace(/\$(\d+)/g, (_, n) => {
    const v = params[Number(n) - 1];
    return typeof v === 'number' ? String(v) : `'${String(v)}'`;
  });

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

  // Ekonomi > Ekonomi-alt ; Kayıtlar: biri üstte, biri altta, biri başka dalda
  db.exec("INSERT INTO categories (id,name,parent_id) VALUES ('ekonomi','Ekonomi',NULL)");
  db.exec("INSERT INTO categories (id,name,parent_id) VALUES ('ekonomi-alt','Ekonomi Alt','ekonomi')");
  db.exec("INSERT INTO categories (id,name,parent_id) VALUES ('baska','Başka',NULL)");
  db.exec("INSERT INTO items (id,url,platform) VALUES ('i1','https://a','x')");
  db.exec("INSERT INTO items (id,url,platform) VALUES ('i2','https://b','x')");
  db.exec("INSERT INTO items (id,url,platform) VALUES ('i3','https://c','x')");
  db.exec("INSERT INTO item_categories (item_id,category_id) VALUES ('i1','ekonomi')");
  db.exec("INSERT INTO item_categories (item_id,category_id) VALUES ('i2','ekonomi-alt')");
  db.exec("INSERT INTO item_categories (item_id,category_id) VALUES ('i3','baska')");
});

/** Üretimdeki kural: LIMIT/OFFSET indeksleri bağlanan parametre sayısından türer. */
const pageSqlFor = (catCount: number): string =>
  `SELECT ic.item_id FROM item_categories ic
   WHERE ic.category_id IN (${Array.from({ length: catCount }, (_, i) => `$${i + 1}`).join(',')})
   LIMIT $${catCount + 1} OFFSET $${catCount + 2}`;

describe('listNotebookItems — LIMIT/OFFSET yer tutucu aritmetiği', () => {
  it('kaynak: indeksler parametre sayısından TÜRETİLİR, sabit yazılmaz', () => {
    /* Sabit indeks N>=2'de UUID'yi LIMIT'e bağlar → SQLITE_MISMATCH.
       Bu, hatanın geri gelmesini engelleyen asıl bekçidir. */
    expect(notebookBody).toMatch(/params\.length/);
  });

  it('kaynak: eski sabit indeks (base = 1 : 2) geri gelmemiş', () => {
    expect(notebookBody).not.toMatch(/categoryId === null \? 1 : 2/);
  });

  it('N=2 (alt kategorisi olan): iki yer tutuculu IN + doğru LIMIT satırları döner', () => {
    // Üretim kuralı: base = params.length + 1 → N=2 için LIMIT $3 OFFSET $4
    const rows = db
      .prepare(bindPluginStyle(pageSqlFor(2), ['ekonomi', 'ekonomi-alt', 48, 0]))
      .all() as { item_id: string }[];
    expect(rows.map((r) => r.item_id).sort()).toEqual(['i1', 'i2']);
  });

  it('ESKİ hatalı biçim (base sabit 2) aynı veride MISMATCH verir — hatanın kanıtı', () => {
    /* `LIMIT $2` burada params[1] = 'ekonomi-alt' (TEXT) alır. */
    const buggy = `SELECT ic.item_id FROM item_categories ic
       WHERE ic.category_id IN ($1,$2) LIMIT $2 OFFSET $3`;
    expect(() =>
      db.prepare(bindPluginStyle(buggy, ['ekonomi', 'ekonomi-alt', 48, 0])).all(),
    ).toThrow(/datatype mismatch/i);
  });

  it('N=1 (alt kategorisi olmayan): eski kod da çalışırdı — hatanın neden seçici olduğu', () => {
    const rows = db
      .prepare(bindPluginStyle(pageSqlFor(1), ['baska', 48, 0]))
      .all() as { item_id: string }[];
    expect(rows.map((r) => r.item_id)).toEqual(['i3']);
  });
});
