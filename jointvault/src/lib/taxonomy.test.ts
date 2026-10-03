import { describe, expect, it } from 'vitest';
import {
  matchExisting,
  matchTaxonomyInText,
  normalizeKey,
  normalizeLlmSuggestion,
  normalizeTag,
  resolveCategories,
  resolveTags,
  shouldAutoApply,
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

describe('normalizeKey — sembol ve Latin-dışı', () => {
  it('C/C++/C# ayırır', () => {
    expect(normalizeKey('C++')).toBe('c++');
    expect(normalizeKey('C#')).toBe('c#');
    expect(matchExisting('C#', ['C'])).toBeNull();
  });

  it('Latin-dışı harfleri korur', () => {
    expect(normalizeKey('Привет')).toBe('привет');
  });
});

describe('normalizeTag — boşluk sonrası hash', () => {
  it('baştaki boşluktan sonraki # söker', () => {
    expect(normalizeTag('  #Python')).toBe('python');
  });
});

describe('normalizeLlmSuggestion', () => {
  it('boş/eksik yanıtta çökmeden varsayılan döner', () => {
    expect(normalizeLlmSuggestion({})).toEqual({
      categories: [],
      tags: [],
      summary: '',
      confidence: 0,
    });
    expect(normalizeLlmSuggestion(null)).toEqual({
      categories: [],
      tags: [],
      summary: '',
      confidence: 0,
    });
  });

  it('geçerli alanları korur, yanlış tipleri atar', () => {
    expect(
      normalizeLlmSuggestion({ categories: ['A'], tags: [1, 'b'], confidence: 0.9 }),
    ).toEqual({ categories: ['A'], tags: ['b'], summary: '', confidence: 0.9 });
  });
});

describe('shouldAutoApply', () => {
  it('deterministik/both her zaman, llm eşiğe göre', () => {
    expect(shouldAutoApply('deterministic', 0, true, 0.6)).toBe(true);
    expect(shouldAutoApply('both', 0, true, 0.6)).toBe(true);
    expect(shouldAutoApply('llm', 0.5, true, 0.6)).toBe(false);
    expect(shouldAutoApply('llm', 0.6, true, 0.6)).toBe(true);
    expect(shouldAutoApply('llm', 0.9, false, 0.6)).toBe(false);
  });
});

describe('matchTaxonomyInText — iki tek-harfli token', () => {
  it('boşluk hariç 3 karakterden kısa adı eşlemez', () => {
    expect(matchTaxonomyInText('a b burada', ['a b'], []).categories).toEqual([]);
  });
});

describe('resolveCategories — toplam tavan', () => {
  it('mevcut eşleşmeleri en fazla maxTotal ile sınırlar', () => {
    const r = resolveCategories(['A', 'B', 'C'], ['A', 'B', 'C'], {
      confidence: 1,
      minConfidence: 0.6,
      maxTotal: 2,
    });
    expect(r.names).toEqual(['A', 'B']);
  });
});
