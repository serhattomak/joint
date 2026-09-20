import { describe, expect, it } from 'vitest';
import { backupFileName, selectBackupsToPrune, type BackupInfo } from './backup';

const backup = (name: string, modified = 0): BackupInfo => ({
  name,
  size_bytes: 1024,
  modified_ms: modified,
});

describe('selectBackupsToPrune', () => {
  it('en yeni `keep` tanesini korur, gerisini siler', () => {
    // Arrange: liste en yeni önce gelir (Rust tarafı böyle sıralar).
    const list = [backup('a'), backup('b'), backup('c'), backup('d'), backup('e'), backup('f')];

    // Act
    const stale = selectBackupsToPrune(list, 5).map((b) => b.name);

    // Assert
    expect(stale).toEqual(['f']);
  });

  it('liste zaten sınırın altındaysa hiçbir şey silmez', () => {
    expect(selectBackupsToPrune([backup('a'), backup('b')], 5)).toEqual([]);
  });

  it('tam sınırdaysa hiçbir şey silmez', () => {
    const list = [backup('a'), backup('b'), backup('c'), backup('d'), backup('e')];
    expect(selectBackupsToPrune(list, 5)).toEqual([]);
  });

  it('keep=0 ise hepsini siler', () => {
    const list = [backup('a'), backup('b')];
    expect(selectBackupsToPrune(list, 0)).toHaveLength(2);
  });

  it('boş listede hiçbir şey silmez', () => {
    expect(selectBackupsToPrune([], 5)).toEqual([]);
  });
});

describe('backupFileName', () => {
  it('okunur damga biçiminde ad üretir', () => {
    // Arrange
    const date = new Date(2026, 8, 20, 15, 30, 45);

    // Act
    const name = backupFileName(date);

    // Assert
    expect(name).toBe('jointvault-20260920-153045.db');
  });

  it('tek haneli ay/gün/saati sıfırla doldurur', () => {
    // Arrange
    const date = new Date(2026, 0, 5, 9, 7, 3);

    // Act
    const name = backupFileName(date);

    // Assert
    expect(name).toBe('jointvault-20260105-090703.db');
  });

  it('.db uzantısıyla biter (Rust tarafı bu adları yedek sayar)', () => {
    expect(backupFileName().endsWith('.db')).toBe(true);
  });
});
