/*
 * Canlı kanıt yakalama — üretim kodu DEĞİL.
 *
 * Bitirme incelemesindeki tek açık kanıt boşluğunu kapatır: kabuk, atom katmanı ve
 * geçici düzeltmeler sentetik veriyle doğrulandı; gerçek SQL satırlarıyla hiç
 * yakalanmadı. Bu betik GERÇEK kasaya bağlanıp ekranı yeniden çeker.
 *
 * Neden Playwright tarayıcı başlatmıyor: uygulama bir Tauri/WebView2 penceresinde
 * çalışır. WebView2, Chromium uzaktan hata ayıklama portunu destekler; bu yüzden
 * mevcut pencereye CDP ile BAĞLANILIR, yeni tarayıcı açılmaz.
 *
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev
 *   node dev/recapture-live.mjs
 *
 * Betik kanıt üretmeyi REDDEDER:
 *   - 9222'ye bağlanamazsa ne yapılacağını söyler ve çıkar,
 *   - kasa boşsa (0 fiş) dosya yazmaz, çünkü boş arşivin fotoğrafı kanıt değildir,
 *   - her rasterin yanına provenance kaydı yazar (kaç gerçek satır, hangi URL, ne zaman).
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../.impeccable/review');
const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';
const APP = 'http://localhost:5173';

mkdirSync(OUT, { recursive: true });

function die(msg) {
  console.error(`\n${msg}\n`);
  process.exit(2);
}

let browser;
try {
  browser = await chromium.connectOverCDP(CDP);
} catch (e) {
  die(
    `WebView2 hata ayıklama portuna bağlanılamadı (${CDP}).\n` +
      `  ${e.message}\n\n` +
      'Sırayla:\n' +
      '  1) Çalışan JointVault penceresini kapat (eski süreç portu tutmaz).\n' +
      '  2) $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"\n' +
      '  3) npx tauri dev\n' +
      '  4) Uygulama açıldıktan sonra bu betiği tekrar çalıştır.',
  );
}

/* Uygulama penceresini seç: devtools değil, uygulama URL'ini taşıyan page. */
const contexts = browser.contexts();
let page = null;
for (const ctx of contexts) {
  for (const p of ctx.pages()) {
    const url = p.url();
    if (url.startsWith('devtools://') || url === 'about:blank') continue;
    if (url.startsWith(APP) || url.includes('tauri')) {
      page = p;
      break;
    }
  }
  if (page) break;
}
if (!page) {
  const seen = contexts.flatMap((c) => c.pages().map((p) => p.url()));
  die(`Uygulama penceresi bulunamadı. Görülen hedefler:\n  ${seen.join('\n  ') || '(yok)'}`);
}

console.log(`bağlandı: ${page.url()}`);
await page.waitForLoadState('load');
await page.evaluate(() => document.fonts.ready).catch(() => undefined);
await page.waitForTimeout(600);

/* Karşılama turu ilk açılışta ekranı kaplar; kanıt için kapatılır. */
try {
  await page.getByRole('button', { name: 'Atla' }).first().click({ timeout: 2500 });
  await page.waitForTimeout(300);
  console.log('karşılama turu atlandı');
} catch {
  /* tur yoksa sorun değil */
}

/* Kural şeridindeki toplam fiş sayısı — boş kasa kapısı. */
const readTotal = () =>
  page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-num]')) {
      const m = (el.textContent ?? '').match(/([\d.,\s]+)\s*fiş/);
      if (m) return Number(m[1].replace(/[^\d]/g, ''));
    }
    return null;
  });

const total = await readTotal();
const cards = await page.locator('.cv-card').count();
const rows = await page.locator('.cv-row').count();

if (total === null) {
  die(
    'Kural şeridindeki fiş sayısı okunamadı.\n' +
      '  Kasa görünümünde (Tümü) olduğundan emin ol; kanıt o ekrandan alınır.',
  );
}
if (total === 0) {
  die(
    'Kasa boş (0 fiş). Kanıt üretilmedi.\n' +
      '  Boş bir arşivin ekran görüntüsü, "gerçek veriyle çalışıyor" kanıtı değildir.\n' +
      '  Önce gerçek kayıt ekle (yakala çubuğuna link yapıştır ya da içe aktar), sonra tekrar çalıştır.',
  );
}

const shots = [];
async function shoot(name, viewport) {
  if (viewport) {
    try {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(500);
    } catch (e) {
      console.warn(`  ${name}: viewport ayarlanamadı (${e.message}) — pencere boyutu kullanılıyor`);
    }
  }
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  shots.push({ name, path, viewport: viewport ?? 'pencere' });
  console.log(`  yazıldı: ${name}.png`);
}

console.log(`kasa: ${total} fiş · ekranda ${cards} kart / ${rows} satır`);
console.log('çekiliyor:');
await shoot('live-desktop');
await shoot('live-mobile', { width: 390, height: 844 });

/* Provenance: her raster kendi kaynağını taşımalı (sözleşme · FINISH). */
const manifest = {
  capturedAt: new Date().toISOString(),
  source: 'gerçek SQL (Tauri/WebView2 penceresi, CDP ile bağlanıldı)',
  appUrl: page.url(),
  totalItems: total,
  renderedCards: cards,
  renderedRows: rows,
  userAgent: await page.evaluate(() => navigator.userAgent),
  shots,
};
writeFileSync(resolve(OUT, 'live-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log(`\nprovenance: live-manifest.json (${total} gerçek fiş)`);
console.log('kanıt boşluğu kapandı.');
await browser.close();
