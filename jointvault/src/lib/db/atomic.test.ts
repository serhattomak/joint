import { describe, expect, it } from 'vitest';
import { runAtomic, type AtomicDb } from './atomic';

interface Call {
  query: string;
  values: unknown[];
}

const fakeDb = (failOn?: RegExp): { db: AtomicDb; calls: Call[] } => {
  const calls: Call[] = [];
  const db: AtomicDb = {
    execute: async (query: string, values?: unknown[]) => {
      calls.push({ query, values: values ?? [] });
      if (failOn?.test(query)) throw new Error('sahte hata');
      return { rowsAffected: 0, lastInsertId: 0 };
    },
  } as unknown as AtomicDb;
  return { db, calls };
};

describe('runAtomic', () => {
  it('ifadeleri TEK çağrıda BEGIN/COMMIT içine sarar', async () => {
    /* Havuz yüzünden tek çağrı şart; ayrı çağrılar farklı bağlantıya düşer. */
    // Arrange
    const { db, calls } = fakeDb();

    // Act
    await runAtomic(db, 'DELETE FROM t; INSERT INTO t VALUES ($1);', [1]);

    // Assert
    expect(calls).toHaveLength(1);
  });

  it('gövdeyi BEGIN ve COMMIT arasına koyar', async () => {
    // Arrange
    const { db, calls } = fakeDb();

    // Act
    await runAtomic(db, 'DELETE FROM t;', []);

    // Assert
    expect(calls[0]?.query).toBe('BEGIN; DELETE FROM t; COMMIT;');
  });

  it('bağlı parametreleri aynen geçirir', async () => {
    // Arrange
    const { db, calls } = fakeDb();

    // Act
    await runAtomic(db, 'INSERT INTO t VALUES ($1, $2);', ['a', 'b']);

    // Assert
    expect(calls[0]?.values).toEqual(['a', 'b']);
  });

  it('hata olursa ROLLBACK dener', async () => {
    /* Yarıda kalan transaction, o bağlantıyı zehirler; temizlik şart. */
    // Arrange
    const { db, calls } = fakeDb(/INSERT/);

    // Act
    await runAtomic(db, 'INSERT INTO t VALUES ($1);', [1]).catch(() => undefined);

    // Assert
    expect(calls.map((c) => c.query)).toContain('ROLLBACK');
  });

  it('hatayı yutmaz, çağırana iletir', async () => {
    // Arrange
    const { db } = fakeDb(/INSERT/);

    // Act + Assert
    await expect(runAtomic(db, 'INSERT INTO t VALUES ($1);', [1])).rejects.toThrow('sahte hata');
  });

  it('ROLLBACK de başarısız olsa bile asıl hatayı korur', async () => {
    // Arrange
    const db = {
      execute: async (query: string) => {
        throw new Error(query === 'ROLLBACK' ? 'geri alınamadı' : 'asıl hata');
      },
    } as unknown as AtomicDb;

    // Act + Assert
    await expect(runAtomic(db, 'BOZUK;', [])).rejects.toThrow('asıl hata');
  });
});
