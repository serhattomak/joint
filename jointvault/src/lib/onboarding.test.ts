import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isOnboarded, markOnboarded } from './onboarding';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
});

describe('onboarding', () => {
  it('başlangıçta tamamlanmamış', () => {
    expect(isOnboarded()).toBe(false);
  });

  it('markOnboarded sonrası tamamlanmış', () => {
    markOnboarded();
    expect(isOnboarded()).toBe(true);
  });
});
