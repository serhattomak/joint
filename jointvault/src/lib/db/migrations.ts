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
 * mevcut kasalar veri kaybetmeden sürümlenir.
 */
import { describeError } from '../errors';
import schemaSql from './schema.sql?raw';
import { splitSqlStatements } from './sql-split';

export interface Migration {
  version: number;
  description: string;
  /** Sırayla çalıştırılacak ifadeler. */
  statements: string[];
  /** Bu göçte yok sayılabilecek hata deseni (ör. eski kasada kolon zaten var). */
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
];

/** Sürümü `current` olan bir kasadan sonra uygulanacak göçleri sırayla döndürür. */
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
