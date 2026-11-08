import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIPBOARD_WATCH_KEY, isWatchEnabled } from './clipboard-watch';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
});

describe('isWatchEnabled', () => {
  it('varsayılan açık', () => {
    expect(isWatchEnabled()).toBe(true);
  });

  it('off değeri kapatır', () => {
    localStorage.setItem(CLIPBOARD_WATCH_KEY, 'off');
    expect(isWatchEnabled()).toBe(false);
  });
});
