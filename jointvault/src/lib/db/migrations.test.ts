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

/* Eski arşiv (1): bugünkü şemayı taşır ama sürümü 0'dır — bu değişiklikten önce
   oluşturulmuş HER arşiv böyle. Göçler "duplicate column name" ile karşılaşır ve
   bunu yok sayması gerekir. */
const schemaAtVersionZero = (): DatabaseSync => {
  const db = new DatabaseSync(':memory:');
  for (const sql of MIGRATIONS[0].statements) db.exec(sql);
  return db;
};

/* Eski arşiv (2): kolonlar eklenmeden ÖNCEKİ items tablosu. Göçlerin gerçekten
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

  it('güncel arşiv için boş liste döndürür', () => {
    expect(planMigrations(LATEST)).toEqual([]);
  });

  it('sürümü daha yeni olsa bile boş liste döndürür', () => {
    /* İleriye dönük: arşiv daha yeni bir sürümdeyse eski uygulama geri gitmemeli. */
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

describe('runMigrations — taze arşiv', () => {
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

describe('runMigrations — eski (sürümsüz) arşiv', () => {
  it('şemayı zaten taşıyan arşivde hata vermez', async () => {
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

describe('runMigrations — göç 8 (kategori hiyerarşisi)', () => {
  it('mevcut kategorileri ve item bağlarını KORUR', async () => {
    /* Hiyerarşi eklemek veri kaybettirmemeli; `item_categories` satırları
       kritik — yanlış bir tablo yeniden kurma onları CASCADE ile silerdi. */
    // Arrange
    const db = schemaAtVersionZero();
    db.exec("INSERT INTO categories (id, name, created_at, updated_at) VALUES ('c1','Pizza','2026-01-01','2026-01-01')");
    db.exec("INSERT INTO categories (id, name, created_at, updated_at) VALUES ('c2','Yemek','2026-01-01','2026-01-01')");
    db.exec("INSERT INTO items (id, url, platform, created_at, updated_at) VALUES ('i1','https://a','x','2026-01-01','2026-01-01')");
    db.exec("INSERT INTO item_categories (item_id, category_id) VALUES ('i1','c1')");

    // Act
    await runMigrations(sqliteExecutor(db));

    // Assert
    const cats = db.prepare('SELECT id, name, parent_id FROM categories ORDER BY name').all();
    expect(cats).toEqual([
      { id: 'c1', name: 'Pizza', parent_id: null },
      { id: 'c2', name: 'Yemek', parent_id: null },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM item_categories').get()).toEqual({ n: 1 });
  });

  it('parent_id kolonunu ekler ve alt kategoriyi üste bağlar', async () => {
    // Arrange
    const db = new DatabaseSync(':memory:');
    await runMigrations(sqliteExecutor(db));
    db.exec("INSERT INTO categories (id, name, created_at, updated_at) VALUES ('p1','Yemek','2026-01-01','2026-01-01')");

    // Act
    db.exec("INSERT INTO categories (id, name, parent_id, created_at, updated_at) VALUES ('c1','Pizza','p1','2026-01-01','2026-01-01')");

    // Assert
    const rows = db
      .prepare("SELECT id FROM categories WHERE parent_id = 'p1'")
      .all()
      .map((r) => String((r as { id: unknown }).id));
    expect(rows).toEqual(['c1']);
  });

  it('ad benzersiz kalır: aynı ad iki üst altında da yazılamaz', async () => {
    /* Tasarım kararı: `name UNIQUE` KALIR. Aynı ad iki yerde durmak zaten
       hatadır ("Pizza" hem Yemek hem Test'te) ve kısıt, AI'ın tam olarak
       bu tür kopyayı üretmesini de engeller. Göçün gerekçesi migrations.ts'de. */
    // Arrange
    const db = new DatabaseSync(':memory:');
    await runMigrations(sqliteExecutor(db));
    db.exec("INSERT INTO categories (id, name, created_at, updated_at) VALUES ('p1','Yemek','2026-01-01','2026-01-01')");
    db.exec("INSERT INTO categories (id, name, created_at, updated_at) VALUES ('p2','Test','2026-01-01','2026-01-01')");
    db.exec("INSERT INTO categories (id, name, parent_id, created_at, updated_at) VALUES ('c1','Pizza','p1','2026-01-01','2026-01-01')");

    // Act + Assert
    expect(() =>
      db.exec("INSERT INTO categories (id, name, parent_id, created_at, updated_at) VALUES ('c2','Pizza','p2','2026-01-01','2026-01-01')"),
    ).toThrow(/UNIQUE/i);
  });

  it('aynı ad AYNI üst altında ikinci kez yazılamaz', async () => {
    // Arrange
    const db = new DatabaseSync(':memory:');
    await runMigrations(sqliteExecutor(db));
    db.exec("INSERT INTO categories (id, name, created_at, updated_at) VALUES ('p1','Yemek','2026-01-01','2026-01-01')");
    db.exec("INSERT INTO categories (id, name, parent_id, created_at, updated_at) VALUES ('c1','Pizza','p1','2026-01-01','2026-01-01')");

    // Act + Assert
    expect(() =>
      db.exec("INSERT INTO categories (id, name, parent_id, created_at, updated_at) VALUES ('c2','Pizza','p1','2026-01-01','2026-01-01')"),
    ).toThrow(/UNIQUE/i);
  });

  it('sürümsüz arşivde (kolon zaten varsa) hata vermez', async () => {
    /* `schemaAtVersionZero` bugünkü şemayı taşır; göç `duplicate column name`
       görür ve yok saymalıdır. */
    // Arrange
    const db = schemaAtVersionZero();

    // Act
    const result = await runMigrations(sqliteExecutor(db));

    // Assert
    expect(result.to).toBe(LATEST);
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

describe('runMigrations — göç 5 (sohbet)', () => {
  const chatTables = (db: DatabaseSync): string[] =>
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ai_chat_sessions','ai_chat_messages','ai_chat_messages_fts') ORDER BY name",
      )
      .all()
      .map((r) => String((r as { name: unknown }).name));

  it('taze arşivde sohbet tablolarını kurar', async () => {
    // Arrange
    const db = new DatabaseSync(':memory:');

    // Act
    await runMigrations(sqliteExecutor(db));

    // Assert
    expect(chatTables(db)).toEqual(['ai_chat_messages', 'ai_chat_messages_fts', 'ai_chat_sessions']);
  });

  it('eski arşivde veriyi koruyarak sohbet tablolarını ekler', async () => {
    // Arrange
    const db = schemaAtVersionZero();
    db.exec("INSERT INTO items (id, url, platform) VALUES ('i1', 'https://a', 'x')");

    // Act
    const result = await runMigrations(sqliteExecutor(db));

    // Assert
    expect(result.to).toBe(LATEST);
    expect(chatTables(db)).toContain('ai_chat_sessions');
    expect(db.prepare('SELECT COUNT(*) AS n FROM items').get()).toEqual({ n: 1 });
  });

  it('mesaj FTS tablosu MATCH ile aranabilir', async () => {
    // Arrange
    const db = new DatabaseSync(':memory:');
    await runMigrations(sqliteExecutor(db));

    // Act
    db.exec("INSERT INTO ai_chat_sessions (id, title) VALUES ('s1', 'Rust')");
    db.exec("INSERT INTO ai_chat_messages (id, session_id, role, content) VALUES ('m1','s1','user','async rust notlari')");
    db.exec("INSERT INTO ai_chat_messages_fts (message_id, session_id, content) VALUES ('m1','s1','async rust notlari')");
    const hits = db
      .prepare("SELECT message_id FROM ai_chat_messages_fts WHERE ai_chat_messages_fts MATCH 'rust'")
      .all();

    // Assert
    expect(hits.map((r) => String((r as { message_id: unknown }).message_id))).toEqual(['m1']);
  });

  it('arama sorgusu (alias + snippet) çalışır; silme FK olmadan da mesajları temizler', async () => {
    // Arrange
    const db = new DatabaseSync(':memory:');
    await runMigrations(sqliteExecutor(db));
    db.exec('PRAGMA foreign_keys = OFF'); // FK CASCADE\'a güvenmediğimizi kanıtla
    db.exec("INSERT INTO ai_chat_sessions (id, title) VALUES ('s1', 'Rust')");
    db.exec(
      "INSERT INTO ai_chat_messages (id, session_id, role, content, created_at) VALUES ('m1','s1','user','async rust notlari','2026-10-03T10:00:00Z')",
    );
    db.exec(
      "INSERT INTO ai_chat_messages_fts (message_id, session_id, content) VALUES ('m1','s1','async rust notlari')",
    );

    // Act — searchChatMessages ile BİREBİR aynı sorgu şekli
    const searchSql = `SELECT m.id AS messageId, s.title AS sessionTitle,
        snippet(ai_chat_messages_fts, 2, '', '', '…', 12) AS snippet
      FROM ai_chat_messages_fts f
      JOIN ai_chat_messages m ON m.id = f.message_id
      JOIN ai_chat_sessions s ON s.id = m.session_id
      WHERE ai_chat_messages_fts MATCH '"rust"' ORDER BY m.created_at DESC LIMIT 50`;
    const hits = db.prepare(searchSql).all();

    // Assert
    expect(hits.map((r) => String((r as { messageId: unknown }).messageId))).toEqual(['m1']);

    // deleteChatSession ile AYNI sıra: fts -> messages -> sessions
    db.exec("DELETE FROM ai_chat_messages_fts WHERE session_id = 's1'");
    db.exec("DELETE FROM ai_chat_messages WHERE session_id = 's1'");
    db.exec("DELETE FROM ai_chat_sessions WHERE id = 's1'");

    expect(db.prepare('SELECT COUNT(*) AS n FROM ai_chat_messages').get()).toEqual({ n: 0 });
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM ai_chat_messages_fts WHERE ai_chat_messages_fts MATCH 'rust'")
        .get(),
    ).toEqual({ n: 0 });
  });
});
