import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OUTBOX_KEY } from './outbox.js';

/*
 * background.js servis çalışanıdır: `chrome`, `fetch` ve `navigator` global
 * olarak bekler. Burada hepsini sahteler ve dört sözleşmeyi doğrularız:
 *
 *  1. Aktarım: 202 kuyruğu boşaltır, hata boşaltmaz.
 *  2. İndirme devralma: uygulama kabul ederse tarayıcı indirmesi iptal edilir;
 *     uygulama kapalı/reddederse indirmeye **hiç dokunulmaz** (dosya kaybı yok).
 *  3. Kaynak koklama: yalnız gerçek medya/arşiv yanıtları listelenir.
 *  4. Sağ tık menüsü: koşullu öğeler yalnız geçerli oldukları sayfada kurulur,
 *     kapatılan öğe hiç kurulmaz ve her öğe doğru hatta gider.
 */

const RAW = { ok: true, status: 202, json: async () => ({ accepted: 2 }) };

const readKeys = async (store, keys) => {
  if (typeof keys === 'string') return { [keys]: store[keys] };
  const out = {};
  for (const [key, fallback] of Object.entries(keys)) out[key] = store[key] ?? fallback;
  return out;
};

function fakeChrome(store) {
  const messageListeners = [];
  const downloadListeners = [];
  const menuClickListeners = [];
  const webRequestListeners = [];
  const tabRemovedListeners = [];
  const tabUpdatedListeners = [];
  const tabActivatedListeners = [];
  const storageChangedListeners = [];
  const calls = {
    cancel: [],
    erase: [],
    /** Menü kurulumları: her `removeAll` yeni bir nesil açar. */
    menus: [],
    badges: [],
    injected: 0,
  };
  let activeTab = null;

  return {
    messageListeners,
    downloadListeners,
    menuClickListeners,
    webRequestListeners,
    tabRemovedListeners,
    tabUpdatedListeners,
    tabActivatedListeners,
    storageChangedListeners,
    calls,
    setActiveTab: (tab) => {
      activeTab = tab;
    },
    api: {
      storage: {
        local: {
          get: (keys) => readKeys(store, keys),
          set: async (values) => Object.assign(store, values),
        },
        session: {
          get: (keys) => readKeys(store, keys),
          set: async (values) => Object.assign(store, values),
          remove: async (keys) => {
            for (const key of [].concat(keys)) delete store[key];
          },
        },
        onChanged: { addListener: (fn) => storageChangedListeners.push(fn) },
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
      downloads: {
        onCreated: { addListener: (fn) => downloadListeners.push(fn) },
        cancel: async (id) => {
          calls.cancel.push(id);
        },
        erase: async (query) => {
          calls.erase.push(query);
        },
      },
      contextMenus: {
        removeAll: (cb) => {
          calls.menus.push([]);
          if (cb) cb();
        },
        create: (opts) => {
          calls.menus[calls.menus.length - 1].push(opts.id);
        },
        onClicked: { addListener: (fn) => menuClickListeners.push(fn) },
      },
      cookies: {
        getAll: async () => [
          { name: 'sid', value: 'abc' },
          { name: 'theme', value: 'dark' },
        ],
      },
      webRequest: {
        onHeadersReceived: { addListener: (fn) => webRequestListeners.push(fn) },
      },
      tabs: {
        query: async () => (activeTab ? [activeTab] : []),
        get: async (id) => (activeTab && activeTab.id === id ? activeTab : { id }),
        onRemoved: { addListener: (fn) => tabRemovedListeners.push(fn) },
        onUpdated: { addListener: (fn) => tabUpdatedListeners.push(fn) },
        onActivated: { addListener: (fn) => tabActivatedListeners.push(fn) },
        sendMessage: async () => {},
      },
      action: {
        setBadgeText: async (arg) => {
          calls.badges.push(arg);
        },
        setBadgeBackgroundColor: async () => {},
      },
      scripting: {
        executeScript: async () => {
          calls.injected += 1;
          return [];
        },
      },
    },
  };
}

const queueOf = (urls) => ({
  [OUTBOX_KEY]: { items: urls.map((url) => ({ url, title: null, thumbnail: null, site: null })) },
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function loadWorker(store, fetchImpl) {
  const chromeStub = fakeChrome(store);
  globalThis.chrome = chromeStub.api;
  globalThis.fetch = fetchImpl;
  // `navigator` Node'da salt-okunur bir getter'dır; `vi.stubGlobal` ile kurulur.
  vi.stubGlobal('navigator', { userAgent: 'TestAgent/1' });
  const mod = await import('./background.js');
  // Modül açılışta menüleri kurar; testin ölçtüğü nesil ondan SONRA gelmeli.
  await settle();
  return { chromeStub, mod };
}

const flush = (chromeStub) =>
  new Promise((resolve) => {
    chromeStub.messageListeners[0]({ type: 'jv-flush' }, {}, resolve);
  });

const headers = (...pairs) => pairs.map(([name, value]) => ({ name, value }));

/** En son kurulan menü öğeleri. */
const lastMenus = (chromeStub) => chromeStub.calls.menus.at(-1) ?? [];

describe('background.js aktarım sözleşmesi', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete globalThis.chrome;
    vi.unstubAllGlobals();
  });

  it('202 → tek partide gönderir ve kuyruğu boşaltır', async () => {
    const store = { ...queueOf(['https://x.com/i/status/1', 'https://x.com/i/status/2']), token: 't' };
    const calls = [];
    const { chromeStub } = await loadWorker(store, async (url, init) => {
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
    const { chromeStub } = await loadWorker(store, async () => {
      throw new Error('ECONNREFUSED');
    });

    expect(await flush(chromeStub)).toEqual({ state: 'offline', pending: 1 });
    expect(store[OUTBOX_KEY].items).toHaveLength(1);
  });

  it('401 → kuyruk silinmez', async () => {
    const store = { ...queueOf(['https://x.com/i/status/1']), token: 'yanlış' };
    const { chromeStub } = await loadWorker(store, async () => ({ ok: false, status: 401 }));

    expect(await flush(chromeStub)).toEqual({ state: 'unauthorized', pending: 1 });
    expect(store[OUTBOX_KEY].items).toHaveLength(1);
  });

  it('boş kuyrukta istek atmaz', async () => {
    const store = { token: 't' };
    let called = 0;
    const { chromeStub } = await loadWorker(store, async () => {
      called += 1;
      return RAW;
    });

    expect(await flush(chromeStub)).toEqual({ state: 'empty' });
    expect(called).toBe(0);
  });
});

describe('background.js indirme devralma sözleşmesi', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete globalThis.chrome;
    vi.unstubAllGlobals();
  });

  const ZIP = {
    id: 7,
    url: 'https://example.com/dosya.zip',
    finalUrl: '',
    filename: 'C:\\Users\\x\\Downloads\\dosya.zip',
    referrer: 'https://example.com/sayfa',
  };

  it('uygulama kabul ederse tarayıcı indirmesi iptal edilir ve başlıklar gider', async () => {
    const store = { token: 't' };
    const calls = [];
    const { chromeStub } = await loadWorker(store, async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 202 };
    });

    await chromeStub.downloadListeners[0](ZIP);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:48120/download');
    const body = JSON.parse(calls[0].init.body);
    expect(body.url).toBe('https://example.com/dosya.zip');
    expect(body.referer).toBe('https://example.com/sayfa');
    expect(body.cookie).toBe('sid=abc; theme=dark');
    expect(body.user_agent).toBe('TestAgent/1');

    expect(chromeStub.calls.cancel).toEqual([7]);
    expect(chromeStub.calls.erase).toEqual([{ id: 7 }]);
    expect(store.lastCapture).toMatchObject({ filename: 'dosya.zip', outcome: 'ok' });
  });

  it('uygulama kapalıysa indirmeye DOKUNULMAZ (dosya kaybı yok)', async () => {
    const store = { token: 't' };
    const { chromeStub } = await loadWorker(store, async () => {
      throw new Error('ECONNREFUSED');
    });

    await chromeStub.downloadListeners[0](ZIP);

    expect(chromeStub.calls.cancel).toEqual([]);
    expect(chromeStub.calls.erase).toEqual([]);
  });

  it('yetki reddedilirse (401) indirmeye dokunulmaz', async () => {
    const store = { token: 'yanlış' };
    const { chromeStub } = await loadWorker(store, async () => ({ ok: false, status: 401 }));

    await chromeStub.downloadListeners[0](ZIP);

    expect(chromeStub.calls.cancel).toEqual([]);
  });

  it('listede olmayan uzantı hiç sorulmaz', async () => {
    const store = { token: 't' };
    let called = 0;
    const { chromeStub } = await loadWorker(store, async () => {
      called += 1;
      return { ok: true, status: 202 };
    });

    await chromeStub.downloadListeners[0]({ ...ZIP, filename: 'sayfa.html' });

    expect(called).toBe(0);
    expect(chromeStub.calls.cancel).toEqual([]);
  });

  it('devralma kapalıysa hiç sorulmaz', async () => {
    const store = { token: 't', capture: { enabled: false } };
    let called = 0;
    const { chromeStub } = await loadWorker(store, async () => {
      called += 1;
      return { ok: true, status: 202 };
    });

    await chromeStub.downloadListeners[0](ZIP);

    expect(called).toBe(0);
  });
});

describe('background.js sağ tık menüsü sözleşmesi', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete globalThis.chrome;
    vi.unstubAllGlobals();
  });

  const PLATFORM_TAB = { id: 3, url: 'https://www.youtube.com/watch?v=abc', title: 'Video' };
  const PLAIN_TAB = { id: 4, url: 'https://example.com/sayfa', title: 'Sayfa' };

  it('dört koşulsuz öğe her zaman kurulur', async () => {
    const { chromeStub, mod } = await loadWorker({ token: 't' }, async () => RAW);

    await mod.rebuildMenus(PLAIN_TAB);

    expect(lastMenus(chromeStub)).toEqual([
      'jv-link',
      'jv-image',
      'jv-media',
      'jv-selection',
    ]);
  });

  it('sayfa içeriği öğeleri YALNIZ desteklenen sitede görünür', async () => {
    const { chromeStub, mod } = await loadWorker({ token: 't' }, async () => RAW);

    await mod.rebuildMenus(PLATFORM_TAB);
    expect(lastMenus(chromeStub)).toContain('jv-page-ask');
    expect(lastMenus(chromeStub)).toContain('jv-page-silent');

    await mod.rebuildMenus(PLAIN_TAB);
    expect(lastMenus(chromeStub)).not.toContain('jv-page-ask');
    expect(lastMenus(chromeStub)).not.toContain('jv-page-silent');
  });

  it('platform eşleşmesi alt alan adlarını da kapsar', async () => {
    const { mod } = await loadWorker({ token: 't' }, async () => RAW);
    expect(mod.isPlatformUrl('https://m.youtube.com/x')).toBe(true);
    expect(mod.isPlatformUrl('https://x.com/a')).toBe(true);
    expect(mod.isPlatformUrl('https://www.instagram.com/p/x/')).toBe(true);
    expect(mod.isPlatformUrl('https://youtube.com.evil.test/x')).toBe(false);
    expect(mod.isPlatformUrl('https://example.com')).toBe(false);
  });

  it('kapatılan öğe hiç kurulmaz', async () => {
    const store = { token: 't', menus: { image: false, selection: false } };
    const { chromeStub, mod } = await loadWorker(store, async () => RAW);

    await mod.rebuildMenus(PLATFORM_TAB);

    const ids = lastMenus(chromeStub);
    expect(ids).not.toContain('jv-image');
    expect(ids).not.toContain('jv-selection');
    expect(ids).toContain('jv-link');
  });

  it('"tüm kaynakları devral" yalnız kaynak bulunan sayfada kurulur', async () => {
    const store = {
      token: 't',
      'res:4': [{ url: 'https://example.com/a.mp4', kind: 'video', size: 8388608 }],
    };
    const { chromeStub, mod } = await loadWorker(store, async () => RAW);

    await mod.rebuildMenus(PLAIN_TAB);
    expect(lastMenus(chromeStub)).toContain('jv-batch');

    await mod.rebuildMenus({ id: 9, url: 'https://example.com/bos' });
    expect(lastMenus(chromeStub)).not.toContain('jv-batch');
  });

  it('bağlantı öğesi URL\'yi doğrudan motora verir', async () => {
    const store = { token: 't' };
    const calls = [];
    const { chromeStub } = await loadWorker(store, async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 202 };
    });

    await chromeStub.menuClickListeners[0](
      { menuItemId: 'jv-link', linkUrl: 'https://example.com/arsiv.rar', pageUrl: 'https://example.com/' },
      PLAIN_TAB,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:48120/download');
    expect(JSON.parse(calls[0].init.body).url).toBe('https://example.com/arsiv.rar');
    expect(chromeStub.calls.cancel).toEqual([]);
  });

  it('"kalite seç" sayfa adresini uygulamanın yt-dlp hattına verir (diyalog açar)', async () => {
    const store = { token: 't' };
    const calls = [];
    const { chromeStub } = await loadWorker(store, async (url, init) => {
      calls.push({ url, init });
      return RAW;
    });

    await chromeStub.menuClickListeners[0](
      { menuItemId: 'jv-page-ask', pageUrl: PLATFORM_TAB.url },
      PLATFORM_TAB,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://127.0.0.1:48120/collect');
    const body = JSON.parse(calls[0].init.body);
    expect(body.mode).toBe('download');
    expect(body.silent).toBe(false);
    expect(body.items[0].url).toBe(PLATFORM_TAB.url);
  });

  it('"sormadan indir" sessiz bayrağıyla gönderir', async () => {
    const store = { token: 't' };
    const calls = [];
    const { chromeStub } = await loadWorker(store, async (url, init) => {
      calls.push({ url, init });
      return RAW;
    });

    await chromeStub.menuClickListeners[0](
      { menuItemId: 'jv-page-silent', pageUrl: PLATFORM_TAB.url },
      PLATFORM_TAB,
    );

    expect(JSON.parse(calls[0].init.body).silent).toBe(true);
    expect(store.lastCapture).toMatchObject({ outcome: 'ok' });
  });

  it('"tüm kaynakları devral" her kaynağı ayrı ayrı devreder', async () => {
    const store = {
      token: 't',
      'res:4': [
        { url: 'https://example.com/a.mp4', kind: 'video', size: 8388608 },
        { url: 'https://example.com/b.zip', kind: 'archive', size: 2097152 },
      ],
    };
    const calls = [];
    const { chromeStub } = await loadWorker(store, async (url, init) => {
      calls.push(JSON.parse(init.body).url);
      return { ok: true, status: 202 };
    });

    await chromeStub.menuClickListeners[0]({ menuItemId: 'jv-batch' }, PLAIN_TAB);

    expect(calls).toEqual(['https://example.com/a.mp4', 'https://example.com/b.zip']);
    expect(store.lastCapture).toMatchObject({ filename: '2 kaynak', outcome: 'ok' });
  });
});

describe('background.js kaynak koklama sözleşmesi', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete globalThis.chrome;
    vi.unstubAllGlobals();
  });

  /** Saf süzgeç: hangi yanıt kaynak sayılır. */
  async function sniff(url, ...pairs) {
    const { mod } = await loadWorker({ token: 't' }, async () => RAW);
    return mod.sniffedResource({ url, responseHeaders: headers(...pairs) });
  }

  it('büyük medya ve arşiv yanıtlarını listeler', async () => {
    expect(
      await sniff('https://x/klip.mp4', ['content-type', 'video/mp4'], ['content-length', '8388608']),
    ).toMatchObject({ kind: 'video', size: 8388608 });
    expect(
      await sniff('https://x/sarki.mp3', ['content-type', 'audio/mpeg'], ['content-length', '4194304']),
    ).toMatchObject({ kind: 'audio' });
    expect(
      await sniff('https://x/arsiv.zip', ['content-type', 'application/zip'], ['content-length', '2097152']),
    ).toMatchObject({ kind: 'archive' });
    expect(
      await sniff('https://x/kur.exe', ['content-type', 'application/x-msdownload'], ['content-length', '5242880']),
    ).toMatchObject({ kind: 'program' });
    expect(
      await sniff('https://x/belge.pdf', ['content-type', 'application/pdf'], ['content-length', '1048576']),
    ).toMatchObject({ kind: 'document' });
  });

  it('küçük kaynakları atlar (ikon, parça, önizleme)', async () => {
    expect(
      await sniff('https://x/kucuk.mp4', ['content-type', 'video/mp4'], ['content-length', '102400']),
    ).toBeNull();
  });

  it('sayfa ve belirsiz yanıtları listelemez', async () => {
    expect(
      await sniff('https://x/sayfa', ['content-type', 'text/html'], ['content-length', '9999999']),
    ).toBeNull();
    expect(
      await sniff('https://x/bilinmeyen', ['content-type', 'application/octet-stream'], ['content-length', '9999999']),
    ).toBeNull();
  });

  it('akış parçalarını ve manifestleri listelemez', async () => {
    expect(await sniff('https://x/v.m3u8', ['content-type', 'application/vnd.apple.mpegurl'])).toBeNull();
    expect(
      await sniff('https://x/seg.ts', ['content-type', 'video/mp2t'], ['content-length', '9999999']),
    ).toBeNull();
  });

  it('boyutu bilinmeyen gerçek medya akışını yine de listeler', async () => {
    expect(await sniff('https://x/canli', ['content-type', 'video/webm'])).toMatchObject({
      kind: 'video',
      size: 0,
    });
  });

  it('uzantısı tanınan octet-stream dosyayı listeler', async () => {
    expect(
      await sniff('https://x/kurulum.exe', ['content-type', 'application/octet-stream'], ['content-length', '5242880']),
    ).toMatchObject({ kind: 'other' });
  });

  it('yakalanınca listeye ekler, rozeti tazeler ve paneli enjekte eder', async () => {
    const store = { token: 't' };
    const { chromeStub } = await loadWorker(store, async () => RAW);

    chromeStub.webRequestListeners[0]({
      tabId: 5,
      url: 'https://example.com/klip.mp4',
      responseHeaders: headers(['content-type', 'video/mp4'], ['content-length', '8388608']),
    });

    await vi.waitFor(() => {
      expect(store['res:5']).toHaveLength(1);
    });
    expect(store['res:5'][0]).toMatchObject({ url: 'https://example.com/klip.mp4', kind: 'video' });
    expect(chromeStub.calls.badges.at(-1)).toEqual({ tabId: 5, text: '1' });
    expect(chromeStub.calls.injected).toBeGreaterThan(0);
  });

  it('aynı kaynağı iki kez eklemez', async () => {
    const store = { token: 't' };
    const { chromeStub } = await loadWorker(store, async () => RAW);
    const details = {
      tabId: 6,
      url: 'https://example.com/klip.mp4',
      responseHeaders: headers(['content-type', 'video/mp4'], ['content-length', '8388608']),
    };

    chromeStub.webRequestListeners[0](details);
    await vi.waitFor(() => expect(store['res:6']).toHaveLength(1));
    chromeStub.webRequestListeners[0](details);
    await settle();

    expect(store['res:6']).toHaveLength(1);
  });

  it('sekme kapanınca ve adres değişince liste temizlenir', async () => {
    const store = { token: 't', 'res:9': [{ url: 'https://x/a.mp4', kind: 'video', size: 1 }] };
    const { chromeStub } = await loadWorker(store, async () => RAW);

    chromeStub.tabRemovedListeners[0](9);
    await vi.waitFor(() => expect(store['res:9']).toBeUndefined());

    store['res:10'] = [{ url: 'https://x/b.mp4', kind: 'video', size: 1 }];
    chromeStub.tabUpdatedListeners[0](10, { url: 'https://x/yeni' }, { id: 10, url: 'https://x/yeni' });
    await vi.waitFor(() => expect(store['res:10']).toBeUndefined());
  });
});
