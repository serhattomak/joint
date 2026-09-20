import { describe, expect, it } from 'vitest';
import { isAiEnabled, type AiStatus } from './ai';

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
