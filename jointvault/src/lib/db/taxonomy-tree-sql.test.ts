import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, type MigrationExecutor } from './migrations';
import type { Category } from './types';
import { validateCategoryCreate, validateCategoryMove } from '../taxonomy-tree';

/*
 * Hiyerarşi YAZMA yolunun SQL'i GERÇEK SQLite üzerinde.
 *
 * client.ts Node'da içe alınamaz (Tauri SQL eklentisi). Bu yüzden üretim SQL'i
 * ve kullanıcıya gösterilen Türkçe metin client.ts KAYNAĞINDAN okunur,
 * kopyalanmaz — kopya zamanla sapar ve testi yalancı yapar. Kapı ise gerçek
 * `validateCategory*` fonksiyonlarıdır. Test, `moveCategory`nin sırasını
 * (önce kapı, sonra UPDATE) ve `updateCategory`nin ad çakışması hatasını çivler.
 */
const clientSource = readFileSync(new URL('./client.ts', import.meta.url), 'utf8');

/** `moveCategory`nin ürettiği UPDATE; test aynı sorguyu çalıştırır. */
const MOVE_SQL_PATTERN = /UPDATE categories SET parent_id = \$1, updated_at = \$2 WHERE id = \$3/;

/** Kaynaktan okunur; testte sabit string tekrarı yok. RED'de yer tutucu dolar. */
const collisionMessage =
  clientSource.match(/throw new Error\('(Bu adda bir kategori zaten var\.)'\)/)?.[1] ??
  'EKSİK: ad çakışması mesajı client.ts’te bulunamadı';

const moveSql = (): string => {
  const m = clientSource.match(MOVE_SQL_PATTERN);
  if (!m) throw new Error('client.ts: moveCategory UPDATE sorgusu bulunamadı');
  return m[0];
};

/** Tek bir üst düzey fonksiyonun gövdesini kabaca keser (iç içe `}` girintili). */
const functionBody = (name: string): string => {
  const start = clientSource.indexOf(`export async function ${name}(`);
  return clientSource.slice(start, clientSource.indexOf('\n}', start));
};

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
  db.exec('PRAGMA foreign_keys = ON');
});

/*
 * Yemek > Tatlı > Sütlü (tatlı KÖK DEĞİL: taşıma testi ancak böyle anlamlı),
 * a > b > c > d > e (5. seviye), Yazılım ayrı kök.
 */
const seed = (): void => {
  db.exec('DELETE FROM categories');
  const cat = db.prepare(
    'INSERT INTO categories (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  );
  cat.run('yemek', 'Yemek', null, '2026-01-01', '2026-01-01');
  cat.run('tatli', 'Tatlı', 'yemek', '2026-01-01', '2026-01-01');
  cat.run('sutlu', 'Sütlü', 'tatli', '2026-01-01', '2026-01-01');
  cat.run('yazilim', 'Yazılım', null, '2026-01-01', '2026-01-01');
  cat.run('a', 'A', null, '2026-01-01', '2026-01-01');
  cat.run('b', 'B', 'a', '2026-01-01', '2026-01-01');
  cat.run('c', 'C', 'b', '2026-01-01', '2026-01-01');
  cat.run('d', 'D', 'c', '2026-01-01', '2026-01-01');
  cat.run('e', 'E', 'd', '2026-01-01', '2026-01-01');
};

const categories = (): Category[] =>
  db.prepare('SELECT * FROM categories').all() as unknown as Category[];

/** `moveCategory`nin sırası: kapı → (yalnız geçerse) üretim UPDATE'i. */
const move = (id: string, parentId: string | null): void => {
  const gate = validateCategoryMove(categories(), id, parentId);
  if (!gate.ok) throw new Error(gate.reason!);
  db.prepare(moveSql()).run({ $1: parentId, $2: '2026-01-02', $3: id });
};

/** `createCategory`nin sırası: kapı → (yalnız geçerse) INSERT. */
const create = (name: string, parentId: string | null): void => {
  const gate = validateCategoryCreate(categories(), parentId);
  if (!gate.ok) throw new Error(gate.reason!);
  db.prepare(
    'INSERT INTO categories (id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run('fazla', name, parentId, '2026-01-02', '2026-01-02');
};

/** `updateCategory`nin ad çakışması çevirisi: UNIQUE → net Türkçe hata. */
const rename = (id: string, name: string): void => {
  try {
    db.prepare('UPDATE categories SET name = ?, updated_at = ? WHERE id = ?').run(
      name,
      '2026-01-02',
      id,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) throw new Error(collisionMessage);
    throw error;
  }
};

describe('hiyerarşi yazma yolu — kapı + SQL', () => {
  beforeEach(seed);

  it('geçerli taşıma parent_id yazar', () => {
    // tatlı KÖK DEĞİL (üstü Yemek): taşımadan önce null değil, kanıt var.
    expect(categories().find((c) => c.id === 'tatli')?.parent_id).toBe('yemek');

    move('tatli', null);

    expect(db.prepare("SELECT parent_id FROM categories WHERE id='tatli'").get()).toEqual({
      parent_id: null,
    });
  });

  it('SOYUNDAN birine taşımayı reddeder ve veriyi DEĞİŞTİRMEZ', () => {
    // Sütlü, Yemek'in torunu; yemek oraya taşınamaz. Reddedilirse yemek kök kalır.
    expect(() => move('yemek', 'sutlu')).toThrow(/alt ağacındaki/);
    expect(db.prepare("SELECT parent_id FROM categories WHERE id='yemek'").get()).toEqual({
      parent_id: null,
    });
  });

  it('client.ts yazma yolları kapıdan geçer (kaynak sırası)', () => {
    // Reddedilen taşımada hiçbir UPDATE üretilmemeli: moveCategory gövdesinde
    // validateCategoryMove çağrısı, UPDATE'i içeren db.execute'tan önce gelir.
    const moveBody = functionBody('moveCategory');
    const gateAt = moveBody.indexOf('validateCategoryMove(');
    const updateAt = moveBody.indexOf(moveSql());
    expect(gateAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(gateAt);

    // createCategory de aynı kapıdan geçer (derinlik denetimi).
    expect(functionBody('createCategory')).toMatch(/validateCategoryCreate\(/);
  });

  it('5. seviyenin altına kategori AÇMAYI reddeder', () => {
    // e = 5. seviye; altına eklemek 6 olur.
    expect(() => create('Fazla', 'e')).toThrow(/seviye/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM categories WHERE name='Fazla'").get()).toEqual({
      n: 0,
    });
  });

  it('var olan ada yeniden adlandırmayı anlaşılır hatayla reddeder', () => {
    expect(() => rename('yazilim', 'Yemek')).toThrow(/zaten var/);
  });

  it('UNIQUE ihlali SQLite düzeyinde gerçekten tetiklenir', () => {
    // Yukarıdaki çevirinin dayandığı ham sinyal: UPDATE adı çakıştırınca UNIQUE.
    expect(() =>
      db
        .prepare('UPDATE categories SET name = ?, updated_at = ? WHERE id = ?')
        .run('Yemek', '2026-01-02', 'yazilim'),
    ).toThrow(/UNIQUE constraint failed/i);
  });

  it('updateCategory yalnız UNIQUE\'i çevirir, diğer hataları aynen bırakır (kaynak sözleşmesi)', () => {
    const body = functionBody('updateCategory');
    expect(body).toMatch(/UNIQUE constraint failed/i);
    expect(body).toContain(collisionMessage);
    expect(body).toMatch(/throw error;/); // UNIQUE dışındaki hatalar aynen yükselir
  });
});
