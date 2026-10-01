import { describe, expect, it } from 'vitest';
import { pushDest, stepDest, type NavHistory } from './nav-history';

type V = 'all' | 'favorites' | 'stats' | 'ai';

const start = (): NavHistory<V> => ({ stack: ['all'], index: 0 });

describe('pushDest', () => {
  it('yeni hedefi sona ekler ve indexi sona alır', () => {
    // Arrange + Act
    const h = pushDest(pushDest(start(), 'favorites'), 'stats');

    // Assert
    expect(h.stack).toEqual(['all', 'favorites', 'stats']);
    expect(h.index).toBe(2);
  });

  it('aynı hedefte yığını değiştirmez', () => {
    // Arrange
    const h0 = start();

    // Act
    const h1 = pushDest(h0, 'all');

    // Assert
    expect(h1).toBe(h0);
  });

  it('geri gidildikten sonra yeni gezinme ileri yığınını kırpar', () => {
    // Arrange
    const h = pushDest(pushDest(start(), 'favorites'), 'stats');
    const back = stepDest(h, -1);

    // Act
    const branched = pushDest(back, 'ai');

    // Assert
    expect(branched.stack).toEqual(['all', 'favorites', 'ai']);
    expect(branched.index).toBe(2);
  });
});

describe('stepDest', () => {
  it('baştan geri gidilemez', () => {
    const h0 = start();
    expect(stepDest(h0, -1)).toBe(h0);
  });

  it('sondan ileri gidilemez', () => {
    const h = pushDest(start(), 'stats');
    expect(stepDest(h, 1)).toBe(h);
  });

  it('arada adım atar ve yığını korur', () => {
    const h = pushDest(pushDest(start(), 'favorites'), 'stats');
    const back = stepDest(h, -1);
    expect(back.index).toBe(1);
    expect(back.stack).toEqual(h.stack);
  });
});
