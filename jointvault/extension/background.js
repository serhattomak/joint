/*
 * Arka plan aktarıcı: uygulama kapalıyken kuyruğa giren kayıtları, uygulama
 * ayağa kalkınca tek partide `/collect`'e gönderir.
 *
 * Tetikleyiciler: ~1 dk'lık alarm · tarayıcı açılışı · kurulum · popup isteği.
 * `chrome.alarms` tarayıcı kapalıyken çalışmaz; "uygulama açıldığında" en geç
 * tarayıcı açıkken bir dakika içinde gerçekleşir.
 *
 * Tekilleştirme uygulama tarafındadır (XSyncReviewDialog): zaten kayıtlı olanları
 * KAYITLI/ÇİFT diye atlar. Buradaki kural yalnızca "aktarıldı → kuyruktan düş".
 */
import { canonicalizeUrl, readOutbox, removeKeys } from './outbox.js';

const FLUSH_ALARM = 'jv-flush';
const DEFAULT_ENDPOINT = 'http://127.0.0.1:48120/collect';

const storage = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (values) => chrome.storage.local.set(values),
};

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
  const endpoint = (cfg.endpoint || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT;
  const token = (cfg.token || '').trim();

  let res;
  try {
    res = await fetch(endpoint, {
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

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) void flush();
});

chrome.runtime.onStartup.addListener(ensureAlarm);
chrome.runtime.onInstalled.addListener(ensureAlarm);

// Popup "şimdi aktar" ister: yanıt, durumu göstermesi için döner.
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg && msg.type === 'jv-flush') {
    flush().then(respond);
    return true;
  }
  return false;
});

ensureAlarm();
