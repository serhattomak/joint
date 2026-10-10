import { describe, expect, it } from 'vitest';
import { buildParentMap, isAiEnabled, type AiStatus } from './ai';
import { resolveCategories } from './taxonomy';

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
    { id: 'p1', name: 'Yemek', parent_id: null },
    { id: 'c1', name: 'Pizza', parent_id: 'p1' },
    { id: 'c2', name: 'Çorba', parent_id: 'p1' },
    { id: 'p2', name: 'Teknoloji', parent_id: null },
  ];

  it('child → parent haritası üretir', () => {
    expect(buildParentMap(cats)).toEqual(
      new Map([
        ['Pizza', 'Yemek'],
        ['Çorba', 'Yemek'],
      ]),
    );
  });

  it('hiyerarşi öncesi düz arşivde boş harita döner (çökmez)', () => {
    expect(buildParentMap([{ id: 'x', name: 'Pizza', parent_id: null }]).size).toBe(0);
  });

  it('pizza kaydı Yemek > Pizza olarak tek çocuğa iner', () => {
    const parents = buildParentMap(cats);
    const names = cats.map((c) => c.name);

    const r = resolveCategories(['Pizza Tarifi'], names, {
      confidence: 0.9,
      minConfidence: 0.6,
      maxTotal: 1,
      parents,
    });

    // "Pizza Tarifi" yeni bir kategori DEĞİLDİR — mevcut "Pizza"ya indirgenir.
    expect(r.names).toEqual(['Pizza']);
    expect(r.newNames).toEqual([]);
  });

  it('LLM üst + çocuk önerirse yalnız çocuk atanır', () => {
    const parents = buildParentMap(cats);
    const names = cats.map((c) => c.name);

    const r = resolveCategories(['Yemek', 'Çorba'], names, {
      confidence: 0.9,
      minConfidence: 0.6,
      maxTotal: 1,
      parents,
    });

    expect(r.names).toEqual(['Çorba']);
  });

  it('iç içe geçmiş taksonomide en derin çocuk kazanır', () => {
    const parents = buildParentMap(cats);
    // Model altın adıyla önce üstü önermiş olabilir.
    const r = resolveCategories(['Yemek', 'Pizza'], names2(cats), {
      confidence: 0.9,
      minConfidence: 0.6,
      maxTotal: 1,
      parents,
    });
    expect(r.names).toEqual(['Pizza']);
  });
});

function names2(cats: { name: string }[]): string[] {
  return cats.map((c) => c.name);
}
