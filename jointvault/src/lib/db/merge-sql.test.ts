import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type MigrationExecutor } from './migrations';
import { buildMergeBlob, type MergePayload } from './merge-sql';

/* mergeItems'in gerçek SQL'i gerçek SQLite üzerinde: COALESCE koruması (C1),
   article taşıma/atma, junction union, cascade ve tek-parametre blob binding.
   runAtomic'in kurduğu tek call BEGIN..COMMIT gövdesini aynen çalıştırır. */

const executor = (db: DatabaseSync): MigrationExecutor => ({
  currentVersion: async () => {
    const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    return row?.user_version ?? 0;
  },
  execute: async (sql) => {
    db.exec(sql);
    return undefined;
  },
  setVersion: async (version) => {
    // PRAGMA cobbled param kabul etmez; sürüm MIGRATIONS'tan gelir.
    db.exec(`PRAGMA user_version = ${Number(version)}`);
    return undefined;
  },
});

const db = new DatabaseSync(':memory:');

beforeAll(async () => {
  await runMigrations(executor(db));
});

const insertItem = (
  id: string,
  extra: { title?: string | null; note?: string | null; thumbnail?: string | null; favorite?: number } = {},
): void => {
  db.prepare(
    'INSERT INTO items (id, url, title, note, platform, thumbnail, favorite) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, `https://x.com/a/status/${id}`, extra.title ?? null, extra.note ?? null, 'x', extra.thumbnail ?? null, extra.favorite ?? 0);
};

const insertArticle = (itemId: string, text: string, scrapedAt = '2026-01-01T00:00:00Z'): void => {
  db.prepare('INSERT INTO item_articles (item_id, content_text, scraped_at) VALUES (?, ?, ?)').run(itemId, text, scrapedAt);
};

const payloadOf = (target: string, over: Partial<MergePayload> = {}): MergePayload => ({
  target,
  note: 'birleşik not',
  favorite: false,
  title: null,
  thumbnail: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-03T00:00:00Z',
  ...over,
});

/** plugin-sql'in davranışını taklit eder: her ifade ayrı prepare/run,
 *  tek parametreye blob bağlanır (exec param bağlamaz). BEGIN/COMMIT
 *  gövdede değildir — runAtomic kendi sarar. */
const runMerge = (payload: MergePayload, victims: string[]): void => {
  const { body, values } = buildMergeBlob(payload, victims);
  for (const raw of body.split(';')) {
    const stmt = raw.trim();
    if (!stmt) continue;
    const prepared = db.prepare(stmt);
    try {
      if (stmt.includes('?')) prepared.run(values[0] as string);
      else prepared.run();
    } catch (e) {
      console.error('[merge-probe]', (e as Error).message, '«', stmt.slice(0, 90));
      throw e;
    }
  }
};

describe('buildMergeBlob — gerçek SQLite üzerinde', () => {
  it('hedef title/thumbnail doluyken COALESCE korur; not/favorite/tarih uygulanır', () => {
    db.exec('DELETE FROM items;');
    db.exec('DELETE FROM items;');
    insertItem('t', { title: 'Korumalı başlık', thumbnail: 'thumb.png', favorite: 0 });
    insertItem('v1', { title: null, note: 'victim notu', favorite: 1 });
    insertArticle('t', 'hedef metin');
    insertArticle('v1', 'victim metin');

    runMerge(payloadOf('t', { created_at: '2026-01-02T00:00:00Z' }), ['v1']);

    const row = db.prepare('SELECT * FROM items WHERE id = ?').get('t') as Record<string, unknown>;
    expect(row.title).toBe('Korumalı başlık');
    expect(row.thumbnail).toBe('thumb.png');
    expect(row.note).toBe('birleşik not');
    expect(row.favorite).toBe(0);
    expect(row.created_at).toBe('2026-01-02T00:00:00Z');
    expect(db.prepare('SELECT COUNT(*) c FROM items').get() as { c: number }).toEqual({ c: 1 });
    const arts = db.prepare('SELECT item_id FROM item_articles').all() as { item_id: string }[];
    expect(arts.map((a) => a.item_id)).toEqual(['t']);
  });

  it('hedef başlığı boşken patch değeri yazılır; favorite OR davranışı, created_at patch ile', () => {
    db.exec('DELETE FROM items;');
    insertItem('t2', { title: null, thumbnail: null });
    insertItem('v2', { favorite: 1 });
    insertArticle('v2', 'victim metin', '2026-01-02T00:00:00Z');

    runMerge(
      payloadOf('t2', { title: 'Yeni başlık', thumbnail: 'kapak.png', favorite: true }),
      ['v2'],
    );

    const row = db.prepare('SELECT title, thumbnail, favorite FROM items WHERE id = ?').get('t2') as {
      title: string;
      thumbnail: string;
      favorite: number;
    };
    expect(row.title).toBe('Yeni başlık');
    expect(row.thumbnail).toBe('kapak.png');
    expect(row.favorite).toBe(1);
  });

  it('junction union: victim etiket/kategori hedefe taşınır, victim cascade ile gider', () => {
    db.exec('DELETE FROM items;');
    insertItem('t3');
    insertItem('v3');
    db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run('tag3', 'etiket3');
    db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)').run('v3', 'tag3');
    db.prepare('INSERT INTO categories (id, name) VALUES (?, ?)').run('cat3', 'kategori3');
    db.prepare('INSERT INTO item_categories (item_id, category_id) VALUES (?, ?)').run('v3', 'cat3');

    runMerge(payloadOf('t3'), ['v3']);

    const tags = db.prepare('SELECT item_id FROM item_tags WHERE tag_id = ?').all('tag3') as { item_id: string }[];
    expect(tags.map((r) => r.item_id)).toEqual(['t3']);
    const cats = db.prepare('SELECT item_id FROM item_categories WHERE category_id = ?').all('cat3') as { item_id: string }[];
    expect(cats.map((r) => r.item_id)).toEqual(['t3']);
    const orphan = db.prepare('SELECT COUNT(*) c FROM tags WHERE id = ?').get('tag3') as { c: number };
    expect(orphan.c).toBe(1); // etiket kendisi korunur; tekil kayıt artık yok
  });

  it('hedefte article varken victim article taşınmaz; victimla birlikte silinir', () => {
    db.exec('DELETE FROM items;');
    insertItem('t4');
    insertItem('v4');
    insertArticle('t4', 'hedef metin var');
    insertArticle('v4', 'victim metin var');

    runMerge(payloadOf('t4'), ['v4']);

    const arts = db.prepare('SELECT item_id, content_text FROM item_articles').all() as {
      item_id: string;
      content_text: string;
    }[];
    expect(arts).toEqual([{ item_id: 't4', content_text: 'hedef metin var' }]);
  });

  it('hedefte article yokken en eski scraped_at victim article hedefe taşınır; kalanlar gider', () => {
    db.exec('DELETE FROM items;');
    insertItem('t5');
    insertItem('v5');
    insertItem('v6');
    insertArticle('v6', 'eski victim metin', '2026-01-05T00:00:00Z');
    insertArticle('v5', 'yen victim metin', '2026-01-10T00:00:00Z');

    runMerge(payloadOf('t5'), ['v5', 'v6']);

    const arts = db.prepare('SELECT item_id, content_text FROM item_articles').all() as {
      item_id: string;
      content_text: string;
    }[];
    expect(arts).toEqual([{ item_id: 't5', content_text: 'eski victim metin' }]);
  });
});
