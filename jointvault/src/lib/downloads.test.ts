import { describe, expect, it } from 'vitest';
import { CATEGORY_FOLDER, destinationPath, sortTransfers } from './downloads';

describe('destinationPath (kategori klasörleri)', () => {
  it('açıkken dosyayı türüne göre alt klasöre koyar', () => {
    expect(destinationPath('C:\\dl\\', 'arsiv.zip', 'archive', true)).toBe(
      'C:\\dl/Sıkıştırılmış/arsiv.zip',
    );
    expect(destinationPath('C:\\dl', 'klip.mp4', 'video', true)).toBe('C:\\dl/Video/klip.mp4');
  });

  it('kapalıyken doğrudan indirme köküne koyar', () => {
    expect(destinationPath('C:\\dl\\', 'arsiv.zip', 'archive', false)).toBe('C:\\dl/arsiv.zip');
  });

  it('her kategori için bir klasör adı tanımlıdır', () => {
    const categories = ['video', 'audio', 'archive', 'document', 'program', 'other'] as const;
    for (const c of categories) {
      expect(CATEGORY_FOLDER[c]).toBeTruthy();
    }
  });
});

describe('sortTransfers', () => {
  const row = (title: string, size: number, createdAt: string) => ({ title, size, createdAt });

  const rows = [
    row('b.zip', 300, '2026-01-02T00:00:00Z'),
    row('a.mp4', 900, '2026-01-03T00:00:00Z'),
    row('c.mp3', 100, '2026-01-01T00:00:00Z'),
  ];

  it('ada ve boyuta göre sıralar', () => {
    expect(sortTransfers(rows, 'name').map((r) => r.title)).toEqual(['a.mp4', 'b.zip', 'c.mp3']);
    expect(sortTransfers(rows, 'size').map((r) => r.title)).toEqual(['a.mp4', 'b.zip', 'c.mp3']);
  });

  it('en yeni/en eski tarihe göre sıralar ve girdiyi değiştirmez', () => {
    expect(sortTransfers(rows, 'oldest').map((r) => r.title)).toEqual(['c.mp3', 'b.zip', 'a.mp4']);
    expect(sortTransfers(rows, 'newest').map((r) => r.title)).toEqual(['a.mp4', 'b.zip', 'c.mp3']);
    expect(rows.map((r) => r.title)).toEqual(['b.zip', 'a.mp4', 'c.mp3']);
  });
});
