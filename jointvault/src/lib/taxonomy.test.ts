import { describe, expect, it } from 'vitest';
import type { Category } from './db/types';
import { indentedTaxonomyTree } from './taxonomy-view';
import {
  collapseToExisting,
  matchExisting,
  matchTaxonomyInText,
  normalizeKey,
  normalizeLlmSuggestion,
  normalizeTag,
  resolveCategories,
  resolveTags,
  shouldAutoApply,
} from './taxonomy';

/** Test kategorisi: yalnız ağaç alanları dolu (kalanı sahte). */
function cat(id: string, name: string, parent_id: string | null = null): Category {
  return { id, name, parent_id, user_id: null, created_at: '', updated_at: '' };
}

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
    /* Beklenen sonuç TEK mevcut etiket: bu davranışın sözleşmesi artık
       "yalnızca mevcut", eski test ise sınırsız yeni üretimi doğruluyordu
       (taksonomi şişmesi). Yeni etiket için ayrı senaryo aşağıda. */
    const r = resolveTags(['#Python', 'python', 'Rust', 'Go', 'C', 'Java'], ['Python']);
    expect(r).toEqual(['Python']);
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
    const empty = {
      categories: [],
      tags: [],
      summary: '',
      confidence: 0,
      newCategory: null,
      newTagReason: {},
    };
    expect(normalizeLlmSuggestion({})).toEqual(empty);
    expect(normalizeLlmSuggestion(null)).toEqual(empty);
  });

  it('geçerli alanları korur, yanlış tipleri atar', () => {
    expect(
      normalizeLlmSuggestion({ kategori: 'A', tags: [1, 'b'], confidence: 0.9 }),
    ).toEqual({
      categories: ['A'],
      tags: ['b'],
      summary: '',
      confidence: 0.9,
      newCategory: null,
      newTagReason: {},
    });
  });

  it('yeni kategori hiyerarşisini okur', () => {
    const r = normalizeLlmSuggestion({ yeni: { ust: 'Yemek', alt: 'Risotto' }, confidence: 0.8 });
    expect(r.newCategory).toEqual({ parent: 'Yemek', child: 'Risotto' });
  });

  it('eksik hiyerarşi (yalnız ust) yeni kategori sayılmaz', () => {
    expect(normalizeLlmSuggestion({ yeni: { ust: 'Yemek' } }).newCategory).toBeNull();
  });

  it('yeni etiketi gerekçesiyle birlikte ayırır', () => {
    const r = normalizeLlmSuggestion({
      tags: ['hamur'],
      yeni_etiket: 'italyan',
      yeni_etiket_gerekce: 'mutfak belirleyici',
    });
    expect(r.tags).toEqual(['hamur', 'italyan']);
    expect(r.newTagReason).toEqual({ italyan: 'mutfak belirleyici' });
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

describe('collapseToExisting — kopyayı var olan adına indirger', () => {
  it('"Pizza Tarifi" → "Pizza" (kullanıcının bildirdiği asıl hata)', () => {
    expect(collapseToExisting('Pizza Tarifi', ['Pizza', 'Çorba'])).toBe('Pizza');
  });

  it('"pizza yapımı" → "Pizza" (aksan/harf duyarsız)', () => {
    expect(collapseToExisting('pizza yapımı', ['Pizza'])).toBe('Pizza');
  });

  it('fazlalık 2 token\'ı aşarsa indirgemez', () => {
    expect(collapseToExisting('İtalyan Pizza Tarifi ve Sos', ['Pizza'])).toBeNull();
  });

  it('tam eşleşme bu fonksiyonun işi değildir', () => {
    expect(collapseToExisting('Pizza', ['Pizza'])).toBeNull();
  });

  it('mevcut ad çok kısaysa kararsız eşleşme yapmaz', () => {
    expect(collapseToExisting('Yapay Zeka Notları', ['AI'])).toBeNull();
  });

  it('ilgisiz adı eşlemez', () => {
    expect(collapseToExisting('Türk Mutfağı', ['Pizza'])).toBeNull();
  });
});

describe('resolveCategories — N seviye', () => {
  // Yemek > Tatlı > Sütlü Tatlı ; Yemek > Çorba ; Yazılım
  const cats = [
    cat('1', 'Yemek'), cat('2', 'Tatlı', '1'), cat('3', 'Sütlü Tatlı', '2'),
    cat('5', 'Çorba', '1'), cat('4', 'Yazılım'),
  ];

  it('YAPRAK OLMAYAN düğüme atamayı kabul eder (eski isBareParent kalktı)', () => {
    const r = resolveCategories(['Tatlı'], cats.map((c) => c.name), {
      confidence: 0.9, minConfidence: 0.6, maxTotal: 1, categories: cats,
    });
    expect(r.names).toEqual(['Tatlı']);
  });

  it('BİRDEN ÇOK uyan öneri geldiğinde EN DERİN olanı seçer', () => {
    // Model hem üstü hem çocuğu önermiş olabilir; atası asla kazanmaz.
    const r = resolveCategories(['Yemek', 'Çorba'], cats.map((c) => c.name), {
      confidence: 0.9, minConfidence: 0.6, maxTotal: 1, categories: cats,
    });
    expect(r.names).toEqual(['Çorba']);
  });

  it('en derin uyan seçildiğinde onu korur', () => {
    const r = resolveCategories(['Sütlü Tatlı'], cats.map((c) => c.name), {
      confidence: 0.9, minConfidence: 0.6, maxTotal: 1, categories: cats,
    });
    expect(r.names).toEqual(['Sütlü Tatlı']);
  });

  it('bağlam verilmezse düz davranış korunur (geriye dönük)', () => {
    const r = resolveCategories(['Tatlı'], ['Tatlı'], { confidence: 1, minConfidence: 0.6 });
    expect(r.names).toEqual(['Tatlı']);
  });

  it('kopyayı içerme ile var olan çocuğa indirger', () => {
    const r = resolveCategories(['Pizza Tarifi'], ['Yemek', 'Pizza'], {
      confidence: 1,
      minConfidence: 0.6,
      categories: [cat('1', 'Yemek'), cat('2', 'Pizza', '1')],
    });
    expect(r.names).toEqual(['Pizza']);
    expect(r.newNames).toEqual([]);
  });
});

describe('indentedTaxonomyTree', () => {
  it('seviyeyi girintiyle yazar', () => {
    expect(indentedTaxonomyTree([['Yemek'], ['Yemek', 'Tatlı'], ['Yazılım']]))
      .toBe('Yemek\n  Tatlı\nYazılım');
  });
  it('kardeşleri ve derin dalları sırayla yazar', () => {
    expect(indentedTaxonomyTree([['Yemek'], ['Yemek', 'Tatlı'], ['Yemek', 'Çorba'], ['Yemek', 'Tatlı', 'Sütlü Tatlı']]))
      .toBe('Yemek\n  Tatlı\n    Sütlü Tatlı\n  Çorba');
  });
});

describe('resolveTags — son tercih', () => {
  it('mevcut etiketleri her zaman alır', () => {
    const r = resolveTags(['python', 'rust'], ['python', 'rust']);
    expect(r).toEqual(['python', 'rust']);
  });

  it('güven/gerekçe verilmedikçe yeni etiket üretmez', () => {
    /* Varsayılan davranış: taksonomi şişmez. */
    const r = resolveTags(['yeni-etiket'], ['python']);
    expect(r).toEqual([]);
  });

  it('güven + gerekçe birlikte sağlanırsa 1 yeni etiket kabul eder', () => {
    const r = resolveTags(['yeni-etiket'], ['python'], {
      minConfidence: 0.6,
      confidence: 0.9,
      reasons: { 'yeni-etiket': 'kaydın ana konusu' },
    });
    expect(r).toEqual(['yeni-etiket']);
  });

  it('gerekçe boşsa yeni etiket reddedilir', () => {
    const r = resolveTags(['yeni-etiket'], ['python'], {
      minConfidence: 0.6,
      confidence: 0.9,
      reasons: { 'yeni-etiket': '   ' },
    });
    expect(r).toEqual([]);
  });

  it('düşük güvende yeni etiket reddedilir', () => {
    const r = resolveTags(['yeni-etiket'], ['python'], {
      minConfidence: 0.6,
      confidence: 0.3,
      reasons: { 'yeni-etiket': 'gerekçe' },
    });
    expect(r).toEqual([]);
  });

  it('mevcut etiketler sınıra rağmen korunur', () => {
    const r = resolveTags(
      ['python', 'rust', 'go', 'yeni'],
      ['python', 'rust', 'go'],
      { minConfidence: 0.6, confidence: 0.9, reasons: { yeni: 'gerekçe' }, max: 2 },
    );
    expect(r).toEqual(['python', 'rust']);
  });
});
