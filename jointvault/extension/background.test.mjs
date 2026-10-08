import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OUTBOX_KEY } from './outbox.js';

/*
 * background.js servis çalışanıdır: `chrome` ve `fetch` global olarak bekler.
 * Burada ikisini de sahteler, `jv-flush` mesajını tetikleyip aktarım
 * sözleşmesini doğrularız — 202 kuyruğu boşaltır, hata boşaltmaz.
 */

const RAW = { ok: true, status: 202, json: async () => ({ accepted: 2 }) };

function fakeChrome(store) {
  const messageListeners = [];
  return {
    messageListeners,
    api: {
      storage: {
        local: {
          get: async (keys) => {
            if (typeof keys === 'string') return { [keys]: store[keys] };
            const out = {};
            for (const [key, fallback] of Object.entries(keys)) out[key] = store[key] ?? fallback;
            return out;
          },
          set: async (values) => Object.assign(store, values),
        },
      },
      alarms: {
        get: async () => ({ name: 'jv-flush' }),
        create: () => {},
        onAlarm: { addListener: () => {} },
      },
      runtime: {
        onStartup: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: (fn) => messageListeners.push(fn) },
      },
    },
  };
}

const queueOf = (urls) => ({
  [OUTBOX_KEY]: { items: urls.map((url) => ({ url, title: null, thumbnail: null, site: null })) },
});

async function loadWorker(store, fetchImpl) {
  const chromeStub = fakeChrome(store);
  globalThis.chrome = chromeStub.api;
  globalThis.fetch = fetchImpl;
  await import('./background.js');
  return chromeStub;
}

const flush = (chromeStub) =>
  new Promise((resolve) => {
    chromeStub.messageListeners[0]({ type: 'jv-flush' }, {}, resolve);
  });

describe('background.js aktarım sözleşmesi', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete globalThis.chrome;
  });

  it('202 → tek partide gönderir ve kuyruğu boşaltır', async () => {
    const store = { ...queueOf(['https://x.com/i/status/1', 'https://x.com/i/status/2']), token: 't' };
    const calls = [];
    const chromeStub = await loadWorker(store, async (url, init) => {
      calls.push({ url, init });
      return RAW;
    });

    const result = await flush(chromeStub);

    expect(result).toEqual({ state: 'sent', sent: 2, pending: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:48120/collect');
    expect(JSON.parse(calls[0].init.body).items).toHaveLength(2);
    expect(store[OUTBOX_KEY].items).toEqual([]);
  });

  it('ağ yoksa kuyruk yerinde kalır', async () => {
    const store = { ...queueOf(['https://x.com/i/status/1']), token: 't' };
    const chromeStub = await loadWorker(store, async () => {
      throw new Error('ECONNREFUSED');
    });

    expect(await flush(chromeStub)).toEqual({ state: 'offline', pending: 1 });
    expect(store[OUTBOX_KEY].items).toHaveLength(1);
  });

  it('401 → kuyruk silinmez', async () => {
    const store = { ...queueOf(['https://x.com/i/status/1']), token: 'yanlış' };
    const chromeStub = await loadWorker(store, async () => ({ ok: false, status: 401 }));

    expect(await flush(chromeStub)).toEqual({ state: 'unauthorized', pending: 1 });
    expect(store[OUTBOX_KEY].items).toHaveLength(1);
  });

  it('boş kuyrukta istek atmaz', async () => {
    const store = { token: 't' };
    let called = 0;
    const chromeStub = await loadWorker(store, async () => {
      called += 1;
      return RAW;
    });

    expect(await flush(chromeStub)).toEqual({ state: 'empty' });
    expect(called).toBe(0);
  });
});
