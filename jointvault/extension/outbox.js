/*
 * Giden kutusu (outbox): uygulama kapalıyken toplanan kayıtlar burada bekler,
 * uygulama ayağa kalkınca tek partide aktarılır.
 *
 * `chrome`'a bağımlı DEĞİL: depolama adaptörü dışarıdan verilir (`get`/`set`), böylece
 * saf katman `npm run test` ile koşar (outbox.test.mjs).
 *
 * Tekilleştirme uygulamayla AYNI kimlik kuralını kullanır (`src/lib/urls.ts`
 * `canonicalizeUrl` portu) — kuyruk ile DB aynı şeye "aynı" demezse aktarımda
 * beklenmedik yinelenenler doğar.
 */

export const OUTBOX_KEY = 'jv_outbox';
/** Kuyruk tavanı: bu sayıyı aşarsa en eski kayıtlar düşer (sessizce değil, uyarıyla). */
export const MAX_ITEMS = 20000;

/**
 * Kimlik anahtarı: şema/host yazımı, `www`/`m` öneki, son eğik çizgi ve sorgu
 * gürültüsü farkını yok sayar. YouTube'un video kimliği sorgudadır, o yüzden
 * `?v=` korunur, `youtu.be/<id>` aynı forma iner.
 */
export function canonicalizeUrl(raw) {
  const input = String(raw ?? '').trim();
  if (!input) return input;
  let url;
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) ? input : `https://${input}`;
    url = new URL(withScheme);
  } catch {
    return input;
  }
  let host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'twitter.com' || host.endsWith('.twitter.com')) {
    host = host === 'twitter.com' ? 'x.com' : `${host.slice(0, -'twitter.com'.length)}x.com`;
  }
  if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
    return `https://www.youtube.com/watch?v=${id}`;
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    if (url.pathname === '/watch') {
      return `https://www.youtube.com/watch?v=${url.searchParams.get('v') ?? ''}`;
    }
    if (url.pathname.startsWith('/shorts/')) {
      return `https://www.youtube.com/watch?v=${url.pathname.split('/').filter(Boolean)[1] ?? ''}`;
    }
  }
  let path = url.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path === '/') path = '';
  return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}${path}`;
}

/**
 * Saf birleştirme: yeni kayıtları mevcut kuyruğa ekler, kanonik anahtarla
 * tekilleştirir, tavan aşılırsa **en eskileri** düşürür.
 * @returns {{queue: {items: Array<object>}, added: number, dropped: number}}
 */
export function mergeQueue(queue, items, cap = MAX_ITEMS) {
  const current = Array.isArray(queue?.items) ? queue.items : [];
  const seen = new Set();
  for (const it of current) {
    if (it && typeof it.url === 'string') seen.add(canonicalizeUrl(it.url));
  }
  const merged = current.slice();
  let added = 0;
  for (const raw of items || []) {
    if (!raw || typeof raw.url !== 'string') continue;
    const url = raw.url.trim();
    if (!url) continue;
    const key = canonicalizeUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      url,
      title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : null,
      thumbnail: typeof raw.thumbnail === 'string' && raw.thumbnail.trim() ? raw.thumbnail.trim() : null,
      site: typeof raw.site === 'string' && raw.site ? raw.site : null,
    });
    added += 1;
  }
  let dropped = 0;
  let kept = merged;
  if (merged.length > cap) {
    dropped = merged.length - cap;
    kept = merged.slice(dropped);
  }
  return { queue: { items: kept }, added, dropped };
}

async function readQueue(storage) {
  const got = await storage.get(OUTBOX_KEY);
  const raw = got?.[OUTBOX_KEY];
  return raw && Array.isArray(raw.items) ? { items: raw.items } : { items: [] };
}

async function writeQueue(storage, queue) {
  await storage.set({ [OUTBOX_KEY]: queue });
}

/** Kuyruğa ekle (popup, ağ hatası aldığında çağırır). */
export async function enqueue(storage, items) {
  const { queue, added, dropped } = mergeQueue(await readQueue(storage), items);
  await writeQueue(storage, queue);
  return { added, dropped, total: queue.items.length };
}

/** Bekleyen kayıt sayısı (popup çipi). */
export async function pendingCount(storage) {
  return (await readQueue(storage)).items.length;
}

/** Aktarılan kayıtları kuyruktan düş (aktarım sırasında eklenenlere dokunmaz). */
export async function removeKeys(storage, keys) {
  const queue = await readQueue(storage);
  const drop = new Set(keys);
  const items = queue.items.filter((it) => !drop.has(canonicalizeUrl(it.url)));
  await writeQueue(storage, { items });
  return items.length;
}

/** Aktarım için kuyruğun anlık görüntüsü. */
export async function readOutbox(storage) {
  return readQueue(storage);
}
