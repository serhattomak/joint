/*
 * Arka plan: üç iş.
 *
 * 1. **Aktarıcı** — uygulama kapalıyken kuyruğa giren kayıtları, uygulama
 *    ayağa kalkınca tek partide `/collect`'e gönderir.
 *    Tetikleyiciler: ~1 dk'lık alarm · tarayıcı açılışı · kurulum · popup isteği.
 *    `chrome.alarms` tarayıcı kapalıyken çalışmaz; "uygulama açıldığında" en geç
 *    tarayıcı açıkken bir dakika içinde gerçekleşir.
 *    Tekilleştirme uygulama tarafındadır (XSyncReviewDialog): zaten kayıtlı
 *    olanları KAYITLI/ÇİFT diye atlar. Buradaki kural yalnızca "aktarıldı →
 *    kuyruktan düş".
 *
 * 2. **İndirme devralma** (IDM'in "download takeover"ı) — tarayıcı bir indirme
 *    başlattığında istek `/download`a verilir; uygulama kabul ederse tarayıcı
 *    indirmesi iptal edilir ve dosya JointVault'un çok kanallı motoruyla iner.
 *
 *    SIRA BAĞLAYICI: **önce uygulamaya sorulur, sonra iptal edilir.** Uygulama
 *    kapalıysa tarayıcı indirmesine hiç dokunulmaz — dosya kaybolmaz, yalnızca
 *    hızlandırılmaz. Tersi sıra, uygulama kapalıyken indirmeyi kaybederdi.
 *
 * 3. **Kaynak koklama** (IDM'in "video sniffer"ı) — yanıt başlıkları okunup
 *    sayfadaki indirilebilir medya/arşiv kaynakları toplanır; araç çubuğunda
 *    sayaç rozeti, sayfanın üstünde yüzen panel ve popup'ta liste görünür.
 *
 * Ayrıca **sağ tık menüsü** kurulur: her öğe kullanıcı tarafından ayrı açılıp
 * kapatılabilir ve koşullu öğeler (sayfa içeriği, tüm kaynaklar) yalnız geçerli
 * oldukları sayfada görünür — desteklenmeyen sayfada ölü öğe durmaz.
 */
import { canonicalizeUrl, readOutbox, removeKeys } from './outbox.js';

const FLUSH_ALARM = 'jv-flush';
const DEFAULT_ENDPOINT = 'http://127.0.0.1:48120/collect';

/** IDM'in "File Types" listesi: bu uzantılar otomatik devralınır. */
const DEFAULT_CAPTURE = {
  enabled: true,
  extensions: [
    'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'dmg', 'img', 'torrent',
    'exe', 'msi', 'apk', 'deb', 'rpm',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'epub', 'csv',
    'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v',
    'mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus',
  ],
};

/** Sağ tık menüsü: her öğe ayrı açılıp kapatılabilir. */
const DEFAULT_MENUS = {
  link: true,
  image: true,
  media: true,
  selection: true,
  pageAsk: true,
  pageSilent: true,
  batch: true,
};

const MENU_LINK = 'jv-link';
const MENU_IMAGE = 'jv-image';
const MENU_MEDIA = 'jv-media';
const MENU_SELECTION = 'jv-selection';
const MENU_PAGE_ASK = 'jv-page-ask';
const MENU_PAGE_SILENT = 'jv-page-silent';
const MENU_BATCH = 'jv-batch';

/** Bağlantısı uygulamanın yt-dlp hattıyla indirilebilen siteler (tek liste). */
const PLATFORM_HOST_RE = /(^|\.)(x\.com|twitter\.com|instagram\.com|youtube\.com|youtu\.be)$/i;

/*
 * Koklama ölçütleri (tek yer).
 *
 * - `SNIFF_MIN_BYTES`: boyut biliniyorsa bunun altındaki kaynaklar listelenmez.
 *   Eşik olmadan liste ikonlar, parçalar ve önizlemelerle dolardı.
 * - Parça/manifest uzantı ve tipleri DIŞLANIR: HLS/DASH akışı tek bir "video"
 *   değil, yüzlerce küçük parçadır; IDM bunları da teke indirir. JointVault'un
 *   akış (stream) indirmesi yok, o yüzden gürültüyü hiç üretmiyoruz.
 * - `application/octet-stream` tek başına kanıt değildir; yalnız uzantısı
 *   tanıdığımız bir dosyaysa kabul edilir.
 */
const SNIFF_MIN_BYTES = 512 * 1024;
const SNIFF_MAX_PER_TAB = 50;
const SNIFF_EXCLUDE_TYPES = [
  'video/mp2t',
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'application/dash+xml',
];
const SNIFF_EXCLUDE_EXT = ['ts', 'm4s', 'mpd', 'm3u8', 'vtt'];
const GENERIC_TYPES = ['application/octet-stream', 'binary/octet-stream', ''];

/** `handOff` sonucu: `ok` · `rejected` · `offline`. */
const OK = 'ok';
const REJECTED = 'rejected';
const OFFLINE = 'offline';

const storage = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (values) => chrome.storage.local.set(values),
};

/* `storage.session` sekme başına koklananları tutar: sayfa yenilenince gider,
   diske yazılmaz, tarayıcı kapanınca temizlenir. Yoksa (eski Chrome) local'e düşer. */
const sessionStore = chrome.storage.session || chrome.storage.local;

/** Köprü uçları: kayıtlı adres `/collect` ile bitse de bitmese de çalışır. */
function endpoints(cfg) {
  const base = ((cfg && cfg.endpoint) || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT;
  const root = base.replace(/\/collect\/?$/, '');
  return { collect: root + '/collect', download: root + '/download' };
}

function ensureAlarm() {
  chrome.alarms.get(FLUSH_ALARM).then((alarm) => {
    if (!alarm) {
      chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 1, delayInMinutes: 0.1 });
    }
  });
}

/**
 * Kuyruğu aktar. Ağ yoksa ya da yetki reddedilirse kuyruk **silinmez**.
 * @returns {Promise<{state: string, pending?: number, sent?: number}>}
 */
async function flush() {
  const { items } = await readOutbox(storage);
  if (items.length === 0) return { state: 'empty' };

  const cfg = await chrome.storage.local.get({ endpoint: DEFAULT_ENDPOINT, token: '' });
  const token = (cfg.token || '').trim();

  let res;
  try {
    res = await fetch(endpoints(cfg).collect, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ items }),
    });
  } catch {
    return { state: 'offline', pending: items.length };
  }

  if (res.status === 401) return { state: 'unauthorized', pending: items.length };
  if (!res.ok) return { state: 'http-' + res.status, pending: items.length };

  const remaining = await removeKeys(
    storage,
    items.map((it) => canonicalizeUrl(it.url)),
  );
  return { state: 'sent', sent: items.length, pending: remaining };
}

// ------------------------------------------------------------- indirme devralma

async function captureSettings() {
  const { capture } = await chrome.storage.local.get({ capture: DEFAULT_CAPTURE });
  const merged = { ...DEFAULT_CAPTURE, ...capture };
  // Boş liste = varsayılan liste. Boş listeyi "hiçbir şeyi devralma" saymak,
  // ayarı bir kez boşaltan kullanıcı için sessiz bir kapanış olurdu.
  if (!Array.isArray(merged.extensions) || merged.extensions.length === 0) {
    merged.extensions = DEFAULT_CAPTURE.extensions;
  }
  return merged;
}

function menuSettings() {
  return chrome.storage.local
    .get({ menus: DEFAULT_MENUS })
    .then(({ menus }) => ({ ...DEFAULT_MENUS, ...(menus || {}) }));
}

function isPlatformUrl(url) {
  try {
    return PLATFORM_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Dosya adından uzantı; ad yoksa URL'nin son parçasından. */
function extensionOf(name) {
  const clean = String(name || '').split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  return dot > 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

function nameFromUrl(url) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(last);
  } catch {
    return '';
  }
}

/**
 * Yolun yalnızca dosya adı. `chrome.downloads` `filename` alanı **tam yerel
 * yoldur** (`C:\Users\x\Downloads\dosya.zip`); onu olduğu gibi uygulamaya
 * göndermek hedef yolu bozar.
 */
function baseName(path) {
  const parts = String(path || '').split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

/** İndirilecek adresin çerezleri (`name=value; …`). İzin yoksa boş. */
async function cookiesFor(url) {
  if (!chrome.cookies) return '';
  const list = await chrome.cookies.getAll({ url }).catch(() => []);
  return list.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Devralınan indirmeyi uygulamaya verir.
 * @returns {Promise<'ok'|'rejected'|'offline'>} `ok` = kabul edildi (iptal güvenli).
 */
async function handOff(target) {
  const url = target && target.url;
  if (!/^https?:/i.test(url || '')) return REJECTED;

  const cfg = await chrome.storage.local.get({ endpoint: DEFAULT_ENDPOINT, token: '' });
  const cookie = await cookiesFor(url);
  try {
    const res = await fetch(endpoints(cfg).download, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (cfg.token || '').trim(),
      },
      body: JSON.stringify({
        url,
        filename: target.filename || '',
        referer: target.referer || '',
        cookie,
        user_agent: navigator.userAgent,
      }),
    });
    return res.ok ? OK : REJECTED;
  } catch {
    // Uygulama kapalı: çağıran tarayıcı indirmesine DOKUNMAZ.
    return OFFLINE;
  }
}

/** Son devralınanı popup için kaydet (`outcome` ret ile kapalıyı ayırır). */
async function rememberCapture(entry) {
  await chrome.storage.local.set({ lastCapture: { ...entry, at: Date.now() } });
}

async function takeOver(url, referer) {
  const outcome = await handOff({ url, filename: '', referer });
  await rememberCapture({ url, filename: nameFromUrl(url) || url, outcome });
  return outcome;
}

/**
 * Sayfa adresini uygulamanın yt-dlp hattına verir (`mode: download`).
 * `silent` ise uygulama onay diyaloğunu açmaz ve varsayılan kaliteyle indirir.
 */
async function requestContentDownload({ url, title, silent }) {
  const cfg = await chrome.storage.local.get({ endpoint: DEFAULT_ENDPOINT, token: '' });
  let outcome = OFFLINE;
  try {
    const res = await fetch(endpoints(cfg).collect, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (cfg.token || '').trim(),
      },
      body: JSON.stringify({
        items: [{ url, title: title || null, thumbnail: null, site: null }],
        mode: 'download',
        kind: 'video',
        silent: silent === true,
      }),
    });
    outcome = res.ok ? OK : REJECTED;
  } catch {
    outcome = OFFLINE;
  }
  await rememberCapture({
    url,
    filename: silent ? 'İçerik (sormadan)' : 'İçerik (kalite seç)',
    outcome,
  });
  return outcome;
}

/**
 * Tarayıcı bir indirme başlattı. Dönen söz, yalnızca testte beklenebilsin diye
 * açıktır (Chrome bu olayda dönüş değerini yok sayar).
 */
async function handleCreated(item) {
  const cfg = await captureSettings();
  if (!cfg.enabled) return;
  // `item.filename` TAM yoldur; adı ayıkla, yoksa URL'den türet.
  const name = baseName(item.filename) || nameFromUrl(item.url);
  if (!cfg.extensions.includes(extensionOf(name))) return;

  // ÖNCE sor: uygulama kabul etmezse tarayıcı indirmesi kendi yolunda sürer.
  const outcome = await handOff({
    url: item.finalUrl || item.url,
    filename: name,
    referer: item.referrer || '',
  });
  if (outcome !== OK) return;

  await chrome.downloads.cancel(item.id).catch(() => {});
  await chrome.downloads.erase({ id: item.id }).catch(() => {});
  await rememberCapture({
    url: item.finalUrl || item.url,
    filename: name,
    outcome: OK,
  });
}

// ------------------------------------------------------- sağ tık menüsü

/**
 * Sağ tık menüsünü ayarlara ve sekmeye göre yeniden kurar.
 * `removeAll` + yeniden kur: koşullu öğelerin görünürlüğü **tek yerde** belirlenir.
 */
async function rebuildMenus(tab) {
  if (!chrome.contextMenus) return;
  const cfg = await menuSettings();
  await new Promise((resolve) => chrome.contextMenus.removeAll(() => resolve()));

  const add = (id, title, contexts) => chrome.contextMenus.create({ id, title, contexts });

  if (cfg.link) add(MENU_LINK, 'JointVault ile indir', ['link']);
  if (cfg.image) add(MENU_IMAGE, 'JointVault ile indir (fotoğraf)', ['image']);
  if (cfg.media) add(MENU_MEDIA, 'JointVault ile indir (video/ses)', ['video', 'audio']);
  if (cfg.selection) {
    add(MENU_SELECTION, 'JointVault ile indir (seçili bağlantı)', ['selection']);
  }

  if (isPlatformUrl(tab && tab.url)) {
    // Yalnız bağlantısı indirilebilen sitelerde: desteklenmeyen sayfada ölü
    // menü öğesi durmaz.
    if (cfg.pageAsk) add(MENU_PAGE_ASK, 'JointVault: içeriği indir (kalite seç)', ['page']);
    if (cfg.pageSilent) {
      add(MENU_PAGE_SILENT, 'JointVault: sormadan indir (varsayılan kalite)', ['page']);
    }
  }

  if (cfg.batch && tab && typeof tab.id === 'number') {
    const items = await resourcesOf(tab.id);
    if (items.length > 0) {
      add(MENU_BATCH, `JointVault: sayfadaki tüm kaynakları devral (${items.length})`, ['page']);
    }
  }
}

async function tabInfo(tabId) {
  return chrome.tabs.get(tabId).catch(() => null);
}

async function refreshMenusForActiveTab() {
  const [active] = await chrome.tabs
    .query({ active: true, lastFocusedWindow: true })
    .catch(() => []);
  await rebuildMenus(active || null);
}

async function handleMenuClick(info, tab) {
  const id = info.menuItemId;
  const referer = info.pageUrl || (tab && tab.url) || '';

  if (id === MENU_LINK || id === MENU_IMAGE || id === MENU_MEDIA) {
    const url = info.linkUrl || info.srcUrl;
    if (url) await takeOver(url, referer);
    return;
  }

  if (id === MENU_SELECTION) {
    // Seçim bağlantı değilse uygulama reddeder (400) ve hiçbir şey olmaz;
    // burada ayrıca doğrulamak ikinci bir gerçek yaratırdı.
    const url = (info.selectionText || '').trim();
    if (url) await takeOver(url, referer);
    return;
  }

  if (id === MENU_PAGE_ASK || id === MENU_PAGE_SILENT) {
    const url = info.pageUrl || (tab && tab.url);
    if (!url) return;
    await requestContentDownload({
      url,
      title: tab && tab.title ? tab.title.slice(0, 200) : null,
      silent: id === MENU_PAGE_SILENT,
    });
    return;
  }

  if (id === MENU_BATCH) {
    if (!tab || typeof tab.id !== 'number') return;
    const items = await resourcesOf(tab.id);
    if (items.length === 0) return;
    let outcome = OK;
    for (const item of items) {
      const result = await handOff({ url: item.url, filename: '', referer: tab.url || '' });
      if (result !== OK) outcome = result;
    }
    await rememberCapture({
      url: tab.url || '',
      filename: `${items.length} kaynak`,
      outcome,
    });
  }
}

// ------------------------------------------------------------------ koklama

function headerValue(headers, wanted) {
  const found = (headers || []).find((h) => String(h.name || '').toLowerCase() === wanted);
  return found ? found.value || '' : '';
}

/**
 * Bir yanıt indirilebilir bir kaynak mı? Değilse `null`.
 * Saf fonksiyon: testte doğrudan çağrılır (başlık listesi verilir).
 */
function sniffedResource(details) {
  const url = details.url || '';
  if (!/^https?:/i.test(url)) return null;
  const ext = extensionOf(nameFromUrl(url));
  if (SNIFF_EXCLUDE_EXT.includes(ext)) return null;

  const headers = details.responseHeaders || [];
  const ct = String(headerValue(headers, 'content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (SNIFF_EXCLUDE_TYPES.includes(ct)) return null;

  const rawLength = headerValue(headers, 'content-length');
  const size = rawLength ? Number.parseInt(rawLength, 10) || 0 : 0;

  let kind = null;
  if (ct.startsWith('video/')) kind = 'video';
  else if (ct.startsWith('audio/')) kind = 'audio';
  else if (ct === 'application/pdf') kind = 'document';
  else if (/zip|rar|7z|tar|compressed/.test(ct)) kind = 'archive';
  else if (/msdownload|android\.package|x-msi/.test(ct)) kind = 'program';
  else if (GENERIC_TYPES.includes(ct) && ext) kind = 'other';
  if (!kind) return null;

  if (size > 0) {
    if (size < SNIFF_MIN_BYTES) return null;
  } else if (!ct.startsWith('video/') && !ct.startsWith('audio/')) {
    // Boyut yok ve tip belirsiz: listeyi tahminle doldurmayız.
    return null;
  }
  return { url, kind, size };
}

const resourceKey = (tabId) => `res:${tabId}`;
const hiddenKey = (tabId) => `hide:${tabId}`;

async function resourcesOf(tabId) {
  if (typeof tabId !== 'number') return [];
  const key = resourceKey(tabId);
  const store = await sessionStore.get({ [key]: [] });
  return store[key] || [];
}

async function clearResources(tabId) {
  // Panel önbelleği de düşer: yeni adreste panel yeniden enjekte edilmeli.
  panelTabs.delete(tabId);
  await sessionStore.remove([resourceKey(tabId), hiddenKey(tabId)]);
  await paintBadge(tabId, 0);
  await rebuildMenus(await tabInfo(tabId));
}

async function paintBadge(tabId, count) {
  if (!chrome.action) return;
  await Promise.resolve(
    chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' }),
  ).catch(() => {});
  if (count > 0) {
    await Promise.resolve(
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#007aff' }),
    ).catch(() => {});
  }
}

/** Koklanan kaynağı sekme listesine ekler; rozeti, paneli ve menüyü tazeler. */
async function rememberResource(tabId, found) {
  const key = resourceKey(tabId);
  const list = await resourcesOf(tabId);
  if (list.some((r) => r.url === found.url)) return;
  const first = list.length === 0;
  const next = [...list, found].slice(-SNIFF_MAX_PER_TAB);
  await sessionStore.set({ [key]: next });
  await paintBadge(tabId, next.length);

  if (first) {
    // "Sayfadaki tüm kaynakları devral" ancak artık görünür olabilir.
    await rebuildMenus(await tabInfo(tabId));
  }

  const store = await sessionStore.get({ [hiddenKey(tabId)]: false });
  if (store[hiddenKey(tabId)]) return; // kullanıcı paneli kapattı

  await injectPanel(tabId);
  // Panel yoksa (henüz enjekte edilemedi) sessizce geç: popup listesi yeter.
  await Promise.resolve(
    chrome.tabs.sendMessage(tabId, { type: 'jv-resources-updated', items: next }),
  ).catch(() => {});
}

/** Panel enjekte edilmiş sekmeler (bu servis çalışanının ömrü boyunca). */
const panelTabs = new Set();

/** Yüzen paneli sayfaya enjekte eder; zaten varsa tekrar etmez. */
async function injectPanel(tabId) {
  if (!chrome.scripting) return;
  if (panelTabs.has(tabId)) return;
  panelTabs.add(tabId);
  const [probe] = await chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => Boolean(window.__jvPanelHost),
    })
    .catch(() => []);
  if (probe && probe.result) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: ['panel.js'] }).catch(() => {});
}

if (chrome.webRequest) {
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (details.tabId < 0) return;
      const found = sniffedResource(details);
      if (found) void rememberResource(details.tabId, found);
    },
    { urls: ['*://*/*'] },
    ['responseHeaders'],
  );
}

if (chrome.tabs) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    panelTabs.delete(tabId);
    void sessionStore.remove([resourceKey(tabId), hiddenKey(tabId)]);
  });
  // Yeni adrese gidildi: önceki sayfanın kaynakları geçersiz, menü de değişir.
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!info.url) return;
    void clearResources(tabId);
    if (tab && tab.active) void rebuildMenus(tab);
  });
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void tabInfo(tabId).then((tab) => rebuildMenus(tab));
  });
}

// ------------------------------------------------------------------ kablolama

if (chrome.downloads) {
  chrome.downloads.onCreated.addListener(handleCreated);
}

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener(handleMenuClick);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) void flush();
});

// Menü anahtarları değişince menü hemen tazelenir (yeniden yükleme gerekmez).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.menus) void refreshMenusForActiveTab();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void refreshMenusForActiveTab();
});
chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  void refreshMenusForActiveTab();
});

/*
 * Mesaj kapısı. Dönen sözler yalnızca testte beklenebilsin diye açıktır;
 * Chrome `sendResponse` ile yanıt bekler, bu yüzden `return true` şart.
 *
 * Sekme kimliği: içerik betiği (panel) kendi sekmesini bilmez → `sender.tab.id`.
 * Eklenti sayfası (popup) için `sender.tab` yoktur → `msg.tabId`.
 */
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg) return false;
  const tabId =
    (sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : null) ?? msg.tabId;

  if (msg.type === 'jv-flush') {
    flush().then(respond);
    return true;
  }
  if (msg.type === 'jv-resources') {
    resourcesOf(tabId).then((items) => respond({ items }));
    return true;
  }
  if (msg.type === 'jv-clear-resources') {
    clearResources(tabId).then(() => respond({ ok: true }));
    return true;
  }
  if (msg.type === 'jv-hide-panel') {
    sessionStore.set({ [hiddenKey(tabId)]: true }).then(() => respond({ ok: true }));
    return true;
  }
  if (msg.type === 'jv-handoff') {
    handOff({ url: msg.url, filename: '', referer: msg.referer || '' }).then((outcome) =>
      respond({ outcome }),
    );
    return true;
  }
  return false;
});

ensureAlarm();
void refreshMenusForActiveTab();

export { sniffedResource, isPlatformUrl, rebuildMenus, DEFAULT_MENUS, SNIFF_MIN_BYTES };
