import { describe, expect, it } from 'vitest';
import { CATEGORY_FOLDER, destinationPath } from './downloads';

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
