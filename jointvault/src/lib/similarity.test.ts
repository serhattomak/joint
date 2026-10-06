import { describe, expect, it } from 'vitest';
import { cosine, meanVector } from './similarity';

describe('cosine', () => {
  it('dikey vektörler 0 döner', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it('paralel vektörler ölçekten bağımsız 1 döner', () => {
    expect(cosine([1, 1], [2, 2])).toBeCloseTo(1, 6);
  });

  it('sıfır vektör 0 döner (NaN değil)', () => {
    expect(cosine([0, 0], [1, 2])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });

  it('Float32Array girdisi de çalışır', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosine(a, b)).toBeCloseTo(0, 6);
  });
});

describe('meanVector', () => {
  it('boş küme uzunluğu 0 vektör döner', () => {
    expect(meanVector([]).length).toBe(0);
  });

  it('girdilerin bileşen ortalamasını alır', () => {
    const out = meanVector([new Float32Array([1]), new Float32Array([3])]);
    expect(out.length).toBe(1);
    expect(out[0]).toBeCloseTo(2, 6);
  });
});
