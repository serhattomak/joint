import { describe, expect, it } from 'vitest';
import type { Category } from './db/types';
import {
  MAX_DEPTH,
  depthOf,
  isDescendant,
  subtreeDepth,
  validateCategoryMove,
  validateCategoryCreate,
} from './taxonomy-tree';

const cat = (id: string, name: string, parent_id: string | null = null): Category => ({
  id,
  name,
  parent_id,
  user_id: null,
  created_at: 'c',
  updated_at: 'u',
});

// Yemek > Tatlı > Sütlü Tatlı
const tree = [cat('1', 'Yemek'), cat('2', 'Tatlı', '1'), cat('3', 'Sütlü Tatlı', '2'), cat('4', 'Yazılım')];

describe('depthOf', () => {
  it('kök 1, torun artar', () => {
    expect(depthOf(tree, '1')).toBe(1);
    expect(depthOf(tree, '3')).toBe(3);
  });
  it('bilinmeyen id 0', () => expect(depthOf(tree, 'yok')).toBe(0));
});

describe('isDescendant', () => {
  it('torunu bulur, kendini saymaz', () => {
    expect(isDescendant(tree, '3', '1')).toBe(true);
    expect(isDescendant(tree, '1', '1')).toBe(false);
    expect(isDescendant(tree, '4', '1')).toBe(false);
  });
});

describe('subtreeDepth', () => {
  it('en derin dalı verir', () => {
    expect(subtreeDepth(tree, '1')).toBe(3);
    expect(subtreeDepth(tree, '3')).toBe(1);
  });
});

describe('validateCategoryMove', () => {
  it('kendine bağlamayı reddeder', () => {
    expect(validateCategoryMove(tree, '1', '1').ok).toBe(false);
  });
  it('SOYUNDAN birine bağlamayı reddeder (döngü)', () => {
    // Yemek'i Sütlü Tatlı'nın altına taşımak döngü kurar.
    expect(validateCategoryMove(tree, '1', '3').ok).toBe(false);
  });
  it('derinlik taşmasını reddeder', () => {
    // 5 seviyelik dal: a > b > c > d > e. Yemek'i (a) e'nin altına koymak
    // hem döngü kurar hem taşar; ikisi de reddedilir.
    const deep = [cat('a', 'A'), cat('b', 'B', 'a'), cat('c', 'C', 'b'), cat('d', 'D', 'c'), cat('e', 'E', 'd')];
    expect(depthOf(deep, 'e')).toBe(5);
    expect(validateCategoryMove(deep, 'a', 'e').ok).toBe(false);
    // Bağımsız vaka: derinlik taşması tek başına reddettirir — x'in dalı 1,
    // e'nin derinliği 5, 5 + 1 = 6 > MAX_DEPTH. Döngü yoktur.
    const flat = [cat('x', 'X'), cat('y', 'Y')];
    expect(isDescendant([...deep, ...flat], 'e', 'x')).toBe(false);
    expect(validateCategoryMove([...deep, ...flat], 'x', 'e').ok).toBe(false);
  });
  it('geçerli taşımayı kabul eder', () => {
    expect(validateCategoryMove(tree, '4', '1').ok).toBe(true);
  });
  it('köke (null) taşımayı kabul eder', () => {
    expect(validateCategoryMove(tree, '3', null).ok).toBe(true);
  });
});

describe('validateCategoryCreate', () => {
  it('5. seviyenin altına eklemeyi reddeder', () => {
    const deep = [cat('a', 'A'), cat('b', 'B', 'a'), cat('c', 'C', 'b'), cat('d', 'D', 'c'), cat('e', 'E', 'd')];
    expect(validateCategoryCreate(deep, 'e').ok).toBe(false);
  });
  it('4. seviyenin altına eklemeyi kabul eder', () => {
    const deep = [cat('a', 'A'), cat('b', 'B', 'a'), cat('c', 'C', 'b'), cat('d', 'D', 'c')];
    expect(validateCategoryCreate(deep, 'd').ok).toBe(true);
  });
  it('köke eklemeyi kabul eder', () => expect(validateCategoryCreate(tree, null).ok).toBe(true));
});

// Ek kapı: MAX_DEPTH gerçekten 5 olmalı (planın çekirdek değeri).
describe('MAX_DEPTH', () => {
  it('5', () => expect(MAX_DEPTH).toBe(5));
});
