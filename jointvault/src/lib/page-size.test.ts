import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_SIZES, readPageSize } from './page-size';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
});

describe('readPageSize', () => {
  it('geçerli kayıtlı boyutu döndürür', () => {
    localStorage.setItem('jv-page-size', String(PAGE_SIZES[2]));
    expect(readPageSize()).toBe(PAGE_SIZES[2]);
  });

  it('geçersiz/boş değerde 48 döndürür', () => {
    expect(readPageSize()).toBe(48);
    localStorage.setItem('jv-page-size', '999');
    expect(readPageSize()).toBe(48);
  });
});
