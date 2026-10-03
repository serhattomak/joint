/*
 * Şema göçleri (migrations).
 *
 * Öncesinde yalnızca `CREATE TABLE IF NOT EXISTS` vardı ve yeni kolonlar elle
 * `ALTER TABLE` ile ekleniyordu; "hangi sürümdeyim" diye bir kavram yoktu.
 * Sonuç: bir sonraki kolon eklemesi unutulursa **sessizce** uygulanmazdı —
 * hata da vermezdi.
 *
 * Artık her değişiklik numaralı bir göçtür ve `PRAGMA user_version` hangi
 * göçlerin uygulandığını söyler. Göçler YALNIZCA İLERİ yöndedir; geri dönüş
 * yedekten yapılır.
 *
 * Eski (sürümsüz) veritabanları şemayı zaten taşır: göç 1 idempotenttir,
 * göç 2-3 ise `duplicate column name` hatasını bilerek yok sayar. Böylece
 * mevcut arşivler veri kaybetmeden sürümlenir.
 */
import { describeError } from '../errors';
import schemaSql from './schema.sql?raw';
import { splitSqlStatements } from './sql-split';

export interface Migration {
  version: number;
  description: string;
  /** Sırayla çalıştırılacak ifadeler. */
  statements: string[];
  /** Bu göçte yok sayılabilecek hata deseni (ör. eski arşivde kolon zaten var). */
  ignore?: RegExp;
}

export interface MigrationExecutor {
  currentVersion: () => Promise<number>;
  execute: (sql: string) => Promise<void>;
  setVersion: (version: number) => Promise<void>;
}

export interface MigrationResult {
  from: number;
  to: number;
  applied: number[];
}

export const MIGRATIONS: Migration[] = [
  { version: 1, description: 'temel şema', statements: splitSqlStatements(schemaSql) },
  {
    version: 2,
    description: 'indirme durumu kolonları',
    statements: [
      'ALTER TABLE items ADD COLUMN local_path TEXT',
      "ALTER TABLE items ADD COLUMN download_status TEXT NOT NULL DEFAULT 'none'",
      'ALTER TABLE items ADD COLUMN download_error TEXT',
    ],
    ignore: /duplicate column name/i,
  },
  {
    version: 3,
    description: 'dönüştürülmüş dosya yolu',
    statements: ['ALTER TABLE items ADD COLUMN converted_path TEXT'],
    ignore: /duplicate column name/i,
  },
  {
    version: 4,
    description: 'sık filtrelenen kolonlara indeks',
    statements: [
      'CREATE INDEX IF NOT EXISTS idx_items_updated_at ON items(updated_at)',
      'CREATE INDEX IF NOT EXISTS idx_items_download_status ON items(download_status)',
      'CREATE INDEX IF NOT EXISTS idx_items_favorite ON items(favorite)',
    ],
  },
  {
    version: 5,
    description: 'sohbet oturumları ve mesajları',
    statements: [
      `CREATE TABLE IF NOT EXISTS ai_chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_updated ON ai_chat_sessions(pinned DESC, updated_at DESC)',
      `CREATE TABLE IF NOT EXISTS ai_chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES ai_chat_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        references_json TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session ON ai_chat_messages(session_id, created_at)',
      `CREATE VIRTUAL TABLE IF NOT EXISTS ai_chat_messages_fts USING fts5(
        message_id UNINDEXED, session_id UNINDEXED, content, tokenize = 'unicode61'
      )`,
    ],
  },
];

/** Sürümü `current` olan bir arşivden sonra uygulanacak göçleri sırayla döndürür. */
export const planMigrations = (current: number, migrations: Migration[] = MIGRATIONS): Migration[] =>
  migrations.filter((migration) => migration.version > current).sort((a, b) => a.version - b.version);

/**
 * Bekleyen göçleri uygular.
 *
 * `beforeApply` verilirse **ilk göç çalışmadan önce** bir kez çağrılır; yedek
 * alma yeri tam olarak burasıdır (göç geri alınamaz, yedek zorunlu).
 */
export async function runMigrations(
  exec: MigrationExecutor,
  migrations: Migration[] = MIGRATIONS,
  beforeApply?: (pending: Migration[]) => Promise<void>,
): Promise<MigrationResult> {
  const from = await exec.currentVersion();
  const pending = planMigrations(from, migrations);

  if (pending.length > 0 && beforeApply) {
    await beforeApply(pending);
  }

  for (const migration of pending) {
    for (const sql of migration.statements) {
      try {
        await exec.execute(sql);
      } catch (error) {
        if (!migration.ignore?.test(describeError(error))) throw error;
      }
    }
    await exec.setVersion(migration.version);
  }

  return {
    from,
    to: pending.at(-1)?.version ?? from,
    applied: pending.map((migration) => migration.version),
  };
}
