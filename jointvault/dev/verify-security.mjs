/*
 * Güvenlik sertleştirme sondası — üretim kodu DEĞİL.
 *
 * NE KANITLAR (Faz 9 çıkış kriterleri):
 *   1. Tarayıcıdan 127.0.0.1:48120'ye yapılan istek REDDEDİLİR (Origin kapısı).
 *   2. İzinli kök DIŞINA dosya yazma/silme REDDEDİLİR; içine yazma çalışır.
 *   3. `-` ile başlayan girdi yt-dlp'ye argüman olarak GEÇMEZ.
 *   4. Çerez temizliği gerçeği söyler (dosya gidince true, gitmezse hata).
 *   5. Uygulama normal akışında çalışmaya devam eder (duman turu ayrıca koşar).
 *
 *   npm run verify:security          # uygulama CDP ile açıkken
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR, endProbe, ensureOutDir, waitForCdp } from './lib/browser.mjs';

const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';
const BRIDGE = 'http://127.0.0.1:48120';
const APPDATA = join(process.env.APPDATA ?? '', 'com.joint.vault');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * Tauri köprüsü OLAN sayfayı seç.
 *
 * `findAppPage` yalnızca URL'ye bakar; aynı origin'de açık başka bir sekme
 * (ör. geliştirici tezgâhı) varsa ona bağlanır ve tüm `invoke` çağrıları
 * "undefined (reading 'invoke')" ile düşer — ürün suçluymuş gibi. Köprü
 * varlığı ölçülerek seçilir.
 */
const pickTauriPage = async (browser) => {
  for (const context of browser.contexts()) {
    for (const candidate of context.pages()) {
      const url = candidate.url();
      if (url.startsWith('devtools://') || url === 'about:blank') continue;
      const hasBridge = await candidate
        .evaluate(() => Boolean(window.__TAURI_INTERNALS__?.invoke))
        .catch(() => false);
      if (hasBridge) return candidate;
    }
  }
  return null;
};

const main = async () => {
  const browser = await waitForCdp(CDP);
  if (!browser) {
    console.error(`Uygulamaya bağlanılamadı (${CDP}).`);
    return endProbe(2);
  }
  const page = await pickTauriPage(browser);
  if (!page) {
    console.error('Tauri köprüsü olan uygulama penceresi bulunamadı.');
    return endProbe(2);
  }
  await page.waitForLoadState('load');
  await sleep(800);

  const results = [];
  const report = (label, ok, detail) => {
    results.push({ label, ok, detail: detail ?? null });
    console.log(`${ok ? 'GEÇTİ' : 'KALDI'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };

  const token = existsSync(join(APPDATA, 'bridge_token'))
    ? readFileSync(join(APPDATA, 'bridge_token'), 'utf8').trim()
    : '';

  /* --- 1) Köprü: Origin kapısı --------------------------------------------- */
  const post = async (headers, body = { items: [] }) => {
    const res = await fetch(`${BRIDGE}/collect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return res.status;
  };

  // Tarayıcı sayfası kaynaklı istek: Origin web kaynağı → reddedilmeli.
  const webOrigin = await post({ authorization: `Bearer ${token}`, origin: 'https://evil.example' });
  report(
    'köprü: WEB sayfası kaynaklı istek reddedildi (Origin kapısı)',
    webOrigin === 401,
    `HTTP ${webOrigin}`,
  );

  // Eklenti kaynaklı + doğru token → kabul edilmeli (meşru yol bozulmadı).
  const extOrigin = await post({
    authorization: `Bearer ${token}`,
    origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
  });
  report(
    'köprü: eklenti kaynaklı istek kabul edildi (meşru yol bozulmadı)',
    extOrigin === 202,
    `HTTP ${extOrigin}`,
  );

  // Yanlış token → reddedilmeli.
  const badToken = await post({ authorization: 'Bearer yanlis-token' });
  report('köprü: yanlış token reddedildi', badToken === 401, `HTTP ${badToken}`);

  /* --- 2) Yol kapıları ------------------------------------------------------ */
  const invoke = (cmd, args) =>
    page.evaluate(
      async ({ c, a }) => {
        try {
          return { ok: true, value: await window.__TAURI_INTERNALS__.invoke(c, a) };
        } catch (e) {
          return { ok: false, error: String(e?.message ?? e) };
        }
      },
      { c: cmd, a: args },
    );

  const outside = join(process.env.TEMP ?? 'C:\\Windows\\Temp', `jv-security-${Date.now()}.txt`);
  const writeOutside = await invoke('write_text_file', { path: outside, content: 'x' });
  report(
    'yazma: izinli kök DIŞI reddedildi',
    !writeOutside.ok && /izin yok|Güvenlik/i.test(writeOutside.error ?? ''),
    writeOutside.ok ? 'YAZILDI (kötü)' : String(writeOutside.error).slice(0, 90),
  );

  const inside = join(APPDATA, `jv-security-inside-${Date.now()}.txt`);
  const writeInside = await invoke('write_text_file', { path: inside, content: 'ok' });
  report(
    'yazma: izinli kök İÇİ çalışıyor (meşru yol bozulmadı)',
    writeInside.ok && existsSync(inside),
    writeInside.ok ? 'yazıldı' : String(writeInside.error).slice(0, 90),
  );
  if (existsSync(inside)) rmSync(inside, { force: true });

  const delOutside = await invoke('delete_file', { path: outside });
  report(
    'silme: izinli kök DIŞI reddedildi',
    !delOutside.ok && /izin yok|Güvenlik/i.test(delOutside.error ?? ''),
    delOutside.ok ? 'SİLİNDİ (kötü)' : String(delOutside.error).slice(0, 90),
  );
  // Dışarıdaki dosya hiç oluşmadıysa da temizle (kapı yazmayı engelledi).
  if (existsSync(outside)) rmSync(outside, { force: true });

  /* --- 3) yt-dlp argüman enjeksiyonu ---------------------------------------- */
  const badUrl = await invoke('list_formats', {
    payload: { url: '--exec=calc' },
  });
  report(
    "yt-dlp: '-' ile başlayan girdi reddedildi",
    !badUrl.ok && /Geçersiz bağlantı/i.test(badUrl.error ?? ''),
    badUrl.ok ? 'GEÇTİ (kötü)' : String(badUrl.error).slice(0, 90),
  );

  const badScheme = await invoke('list_formats', { payload: { url: 'file:///C:/Windows/win.ini' } });
  report(
    'yt-dlp: http(s) dışı şema reddedildi',
    !badScheme.ok && /Geçersiz bağlantı/i.test(badScheme.error ?? ''),
    badScheme.ok ? 'GEÇTİ (kötü)' : String(badScheme.error).slice(0, 90),
  );

  /* --- 4) Çerez temizliği gerçeği söylüyor ---------------------------------- */
  const cookies = join(APPDATA, 'cookies.txt');
  const hadCookies = existsSync(cookies);
  if (!hadCookies) writeFileSync(cookies, '# probe\n', 'utf8');
  const cleared = await invoke('sync_clear_cookies_file', undefined);
  report(
    'çerez: temizlik gerçeği söylüyor (dosya gerçekten gitti)',
    cleared.ok && cleared.value === true && !existsSync(cookies),
    `value=${cleared.value} · dosya=${existsSync(cookies)}`,
  );

  ensureOutDir();
  writeFileSync(
    join(OUT_DIR, 'security-probe.json'),
    JSON.stringify(
      {
        kind: 'security-probe',
        synthetic: false,
        capturedAt: new Date().toISOString(),
        note: 'Köprü Origin kapısı, izinli kök kapıları, yt-dlp argüman guardı, çerez dürüstlüğü.',
        results,
      },
      null,
      2,
    ),
    'utf8',
  );

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nSONUÇ: ${failed === 0 ? 'tüm kontroller GEÇTİ' : `${failed} kontrol KALDI`}`);
  return endProbe(failed === 0 ? 0 : 1);
};

await main();
