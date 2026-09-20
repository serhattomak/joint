/*
 * Atomik yazma.
 *
 * ÖLÇÜLDÜ (dev/verify-transactions.mjs): plugin bir BAĞLANTI HAVUZU kullanıyor
 * ve ayrı çağrılara bölünmüş `BEGIN`/`COMMIT` ÇALIŞMIYOR — her çağrı başka bir
 * bağlantıya düşebiliyor. Denendi: `ROLLBACK` "no transaction is active" verdi
 * ve yazılan satır KALICI oldu.
 *
 * Çalışan tek yol, ifadeleri TEK çağrıda göndermek: `BEGIN; ...; COMMIT;`.
 * Bağlı parametreler bu biçimde de çalışır (ölçüldü).
 *
 * DİKKAT: blok yarıda hata verirse ilgili bağlantıda açık bir transaction
 * kalabilir; o bağlantı yeniden kullanılırsa sonraki `BEGIN` "cannot start a
 * transaction within a transaction" ile düşer. Bu yüzden hatada en iyi çabayla
 * `ROLLBACK` denenir (havuz genelde aynı boşta duran bağlantıyı verir).
 */
import type Database from '@tauri-apps/plugin-sql';

/** Yalnızca gereken yetenek: testler sahte bir bağlantı verebilsin. */
export type AtomicDb = Pick<Database, 'execute'>;

export async function runAtomic(db: AtomicDb, body: string, values: unknown[]): Promise<void> {
  try {
    await db.execute(`BEGIN; ${body} COMMIT;`, values);
  } catch (error) {
    await db.execute('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
