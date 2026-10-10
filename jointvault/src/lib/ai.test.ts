import { describe, expect, it } from 'vitest';
import { isAiEnabled, planItemCategorization, type AiStatus } from './ai';
import type { Category } from './db/types';
import { resolveCategories } from './taxonomy';

/** Test kategorisi: ağaç alanları dolu, kalanı sahte. */
function cat(id: string, name: string, parent_id: string | null = null): Category {
  return { id, name, parent_id, user_id: null, created_at: '', updated_at: '' };
}

/*
 * `isAiEnabled` bir GÜVENLİK kapısıdır: `true` dönerse backend ~9 GB'lık model
 * süreçlerini başlatabilir. Bu yüzden yalnızca "açık true" kabul edilir; testler
 * asıl olarak ŞÜPHELİ girdilerin kapalı kaldığını çivilemeye odaklanır.
 */
describe('isAiEnabled', () => {
  it('ai_enabled açık true ise etkin sayar', () => {
    // Arrange
    const status: Pick<AiStatus, 'ai_enabled'> = { ai_enabled: true };

    // Act
    const result = isAiEnabled(status);

    // Assert
    expect(result).toBe(true);
  });

  it('ai_enabled false ise kapalı sayar', () => {
    expect(isAiEnabled({ ai_enabled: false })).toBe(false);
  });

  it('durum null/undefined ise kapalı sayar (henüz yüklenmedi)', () => {
    expect(isAiEnabled(null)).toBe(false);
    expect(isAiEnabled(undefined)).toBe(false);
  });

  it('alan eksikse kapalı sayar (01-04 öncesi eski backend)', () => {
    // Arrange: alanı hiç taşımayan gövde
    const legacy: { ai_enabled?: unknown } = {};

    // Act
    const result = isAiEnabled(legacy);

    // Assert
    expect(result).toBe(false);
  });

  it('boolean olmayan değerleri (truthy string/sayı) kapalı sayar', () => {
    // Arrange: `Boolean(...)` ile açık sayılacak tuzaklar
    const traps: Array<{ ai_enabled?: unknown }> = [
      { ai_enabled: 'true' },
      { ai_enabled: 'false' },
      { ai_enabled: 1 },
      { ai_enabled: null },
    ];

    // Act + Assert
    for (const trap of traps) {
      expect(isAiEnabled(trap)).toBe(false);
    }
  });
});

/*
 * Kullanıcının bildirdiği asıl hata: "pizza tarifi" ve "pizza yapımı" diye iki
 * ayrı kategori. Bu zincir, DB satırlarından başlayıp atamanın tek çocuğa
 * inmesine kadar uçtan uca çivilenir.
 */
describe('kategori hiyerarşisi (uçtan uca)', () => {
  const cats = [
    cat('p1', 'Yemek'),
    cat('c1', 'Pizza', 'p1'),
    cat('c2', 'Çorba', 'p1'),
    cat('p2', 'Teknoloji'),
  ];
  const names = cats.map((c) => c.name);

  it('pizza kaydı Yemek > Pizza olarak tek çocuğa iner', () => {
    const r = resolveCategories(['Pizza Tarifi'], names, {
      confidence: 0.9,
      minConfidence: 0.6,
      maxTotal: 1,
      categories: cats,
    });

    // "Pizza Tarifi" yeni bir kategori DEĞİLDİR — mevcut "Pizza"ya indirgenir.
    expect(r.names).toEqual(['Pizza']);
    expect(r.newNames).toEqual([]);
  });

  it('LLM üst + çocuk önerirse yalnız en derin (çocuk) atanır', () => {
    const r = resolveCategories(['Yemek', 'Çorba'], names, {
      confidence: 0.9,
      minConfidence: 0.6,
      maxTotal: 1,
      categories: cats,
    });

    expect(r.names).toEqual(['Çorba']);
  });

  it('yaprak olmayan düğüm artık atanabilir (Yemek)', () => {
    const r = resolveCategories(['Yemek'], names, {
      confidence: 0.9,
      minConfidence: 0.6,
      maxTotal: 1,
      categories: cats,
    });

    expect(r.names).toEqual(['Yemek']);
  });
});

/*
 * AI kapalıyken toplu kategorizasyonun kural tabanlı turu: LLM çağrılmaz,
 * deterministik eşleşme uygulanır, eşleşme yoksa kayıt başarısız sayılmaz.
 * (batchCategorizeItems Adım 3'ün saf kararı.)
 */
describe('planItemCategorization — AI kapalı deterministik', () => {
  const cats = ['Yapay Zeka', 'Pizza'];
  const tags = ['rust', 'video', 'tutorial'];

  it('AI kapalı: kısmi eşleşme (kategori var, etiket <2) deterministik uygulanır', () => {
    // Arrange: "pizza" + "rust" → 1 kategori, 1 etiket (tam eşik değil).
    const text = 'Pizza tarifi ve rust dersi';

    // Act
    const plan = planItemCategorization(text, cats, tags, { aiOn: false, minConfidence: 0.6 });

    // Assert
    expect(plan.kind).toBe('deterministic');
    if (plan.kind === 'deterministic') {
      expect(plan.result.categories).toEqual(['Pizza']);
      expect(plan.result.tags).toEqual(['rust']);
      expect(plan.result.source).toBe('deterministic');
    }
  });

  it('AI kapalı: eşleşme yoksa LLM turu YOK, kayıt atlanır (başarısız değil)', () => {
    const plan = planItemCategorization('alakasız bir metin', cats, tags, {
      aiOn: false,
      minConfidence: 0.6,
    });
    expect(plan.kind).toBe('skip');
  });

  it('AI açık: kısmi eşleşme LLM turuna gider (boşluğu kapatır)', () => {
    const plan = planItemCategorization('Pizza tarifi ve rust dersi', cats, tags, {
      aiOn: true,
      minConfidence: 0.6,
    });
    expect(plan.kind).toBe('llm');
  });

  it('AI açık: tam eşleşme (kategori + ≥2 etiket) LLM turunu atlar', () => {
    const plan = planItemCategorization('Pizza rust tutorial', cats, tags, {
      aiOn: true,
      minConfidence: 0.6,
    });
    expect(plan.kind).toBe('deterministic');
  });

  it('deterministik dal ağaç bağlamıyla EN DERİN kategoriyi seçer', () => {
    // Metinde hem "Yemek" hem "Çorba" geçiyor; kayıt "Yemek"e değil "Çorba"ya düşmeli.
    const catRows = [cat('1', 'Yemek'), cat('2', 'Çorba', '1')];
    const plan = planItemCategorization('Yemek ve çorba tarifi', ['Yemek', 'Çorba'], [], {
      aiOn: false,
      minConfidence: 0.6,
      categories: catRows,
    });
    expect(plan.kind).toBe('deterministic');
    if (plan.kind === 'deterministic') {
      expect(plan.result.categories).toEqual(['Çorba']);
    }
  });
});
