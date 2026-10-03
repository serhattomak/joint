import { describe, expect, it } from 'vitest';
import {
  matchExisting,
  matchTaxonomyInText,
  normalizeKey,
  normalizeTag,
  resolveCategories,
  resolveTags,
} from './taxonomy';

describe('normalizeKey', () => {
  it('tr büyük/küçük + aksan + tire/noktalama', () => {
    expect(normalizeKey('Yapay Zekâ & Veri-Bilimi')).toBe('yapay zeka veri bilimi');
    expect(normalizeKey('YAPAY-ZEKA')).toBe('yapay zeka');
    expect(normalizeKey('Işık')).toBe('isik');
  });
});

describe('matchExisting', () => {
  it('aksan/harf duyarsız mevcut adı döndürür', () => {
    expect(matchExisting('yapay-zeka', ['Yapay Zeka', 'Müzik'])).toBe('Yapay Zeka');
    expect(matchExisting('yok', ['Müzik'])).toBeNull();
  });
});

describe('normalizeTag', () => {
  it('# söker, küçük harf, kırpar', () => {
    expect(normalizeTag('#Python')).toBe('python');
    expect(normalizeTag('   ')).toBeNull();
  });
});

describe('resolveCategories', () => {
  it('mevcuda eşler; yeni yalnız eşik üstü ve maxNew sınırında', () => {
    const r = resolveCategories(
      ['yapay-zeka', 'Astronomi', 'Biyoloji'],
      ['Yapay Zeka'],
      { confidence: 0.9, minConfidence: 0.6, maxNew: 1 },
    );
    expect(r.names).toEqual(['Yapay Zeka', 'Astronomi']);
    expect(r.newNames).toEqual(['Astronomi']);
  });

  it('düşük güvende yeni kategori açmaz', () => {
    const r = resolveCategories(['Astronomi'], ['Yapay Zeka'], {
      confidence: 0.3,
      minConfidence: 0.6,
      maxNew: 1,
    });
    expect(r.names).toEqual([]);
  });
});

describe('resolveTags', () => {
  it('# söker, tekilleştirir, sınırlar', () => {
    const r = resolveTags(['#Python', 'python', 'Rust', 'Go', 'C', 'Java'], ['Python']);
    expect(r).toEqual(['Python', 'rust', 'go', 'c', 'java']);
  });
});

describe('matchTaxonomyInText', () => {
  it('token sınırı + min uzunluk', () => {
    const r = matchTaxonomyInText('Yapay zeka ve rust dili', ['Yapay Zeka', 'AI'], ['rust', 'x']);
    expect(r.categories).toEqual(['Yapay Zeka']);
    expect(r.tags).toEqual(['rust']);
  });

  it('kısa adı eşlemez', () => {
    expect(matchTaxonomyInText('AI çağı', ['AI'], []).categories).toEqual([]);
  });
});
