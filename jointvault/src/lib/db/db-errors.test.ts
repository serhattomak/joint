import { describe, expect, it } from 'vitest';
import { classifyDbError } from './db-errors';

describe('classifyDbError', () => {
  it('kilitli veritabanını tanır', () => {
    // Arrange + Act
    const result = classifyDbError('database is locked');

    // Assert
    expect(result.kind).toBe('locked');
  });

  it('bozuk dosyayı tanır', () => {
    expect(classifyDbError('file is not a database').kind).toBe('corrupt');
  });

  it('izin sorununu tanır', () => {
    expect(classifyDbError('attempt to write a readonly database').kind).toBe('unwritable');
  });

  it('şema sorununu tanır', () => {
    expect(classifyDbError('no such table: items').kind).toBe('schema');
  });

  it('tanınmayan hatayı unknown olarak sınıflar', () => {
    expect(classifyDbError('beklenmeyen bir şey').kind).toBe('unknown');
  });

  it('her sınıflandırma için kullanıcıya gösterilecek bir cümle döndürür', () => {
    // Arrange
    const samples = ['database is locked', 'not a database', 'readonly', 'no such table', 'x'];

    // Act
    const messages = samples.map((s) => classifyDbError(s).message);

    // Assert
    expect(messages.every((m) => m.trim().length > 10)).toBe(true);
  });

  it('ham hata metnini ayrıntı olarak korur', () => {
    // Arrange
    const raw = 'SqliteError: disk I/O error';

    // Act
    const result = classifyDbError(new Error(raw));

    // Assert
    expect(result.detail).toBe(raw);
  });
});
