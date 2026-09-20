/*
 * Açılış hatası sondası — üretim kodu DEĞİL.
 *
 * NE KANITLAR: kasa açılamadığında uygulamanın BOŞ KABUK ya da SONSUZ İSKELET
 * yerine ne olduğunu söylediğini, ve sorun giderildiğinde "Yeniden dene"nin
 * gerçekten kurtardığını.
 *
 * GERÇEK KASAYA DOKUNMAZ: uygulama `VITE_JV_DB` test dikişiyle, VAR OLMAYAN
 * bir klasörün içindeki bir dosyaya yönlendirilmiş olarak başlatılır (SQLite
 * klasörü kendisi oluşturmaz, bu yüzden açılış başarısız olur). Sonda eksik
 * klasörü oluşturur ve "Yeniden dene"nin kurtardığını doğrular.
 *
 * Neden "bozuk dosya sil" değil: SQLite bağlantısı dosyayı kilitli tutar,
 * silme denemesi EPERM ile düşer. Zaten gerçek hayattaki kurtarma da
 * "dosyayı yok et" değil, "engeli kaldır, tekrar dene"dir.
 *
 *   $env:VITE_JV_DB="sqlite:C:/gecici/yok-dizin/kasa.db"
 *   $env:JV_FIX_DIR="C:/gecici/yok-dizin"
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev        # pencere açıldıktan sonra, ikinci terminalde:
 *   npm run verify:boot-error
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT_DIR, endProbe, ensureOutDir, findAppPage, waitForCdp } from './lib/browser.mjs';

const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';
const FIX_DIR = process.env.JV_FIX_DIR;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  if (!FIX_DIR) {
    console.error('JV_FIX_DIR tanımlı değil: sonda hangi engeli kaldıracağını bilemez.');
    console.error('Uygulamayı `VITE_JV_DB` ile var olmayan bir klasöre yönlendirip tekrar dene.');
    return endProbe(2);
  }

  const browser = await waitForCdp(CDP);
  if (!browser) {
    console.error(`Uygulamaya bağlanılamadı (${CDP}).`);
    return endProbe(2);
  }

  const page = findAppPage(browser);
  if (!page) {
    console.error('Uygulama penceresi bulunamadı.');
    return endProbe(2);
  }
  console.log(`bağlandı: ${page.url()}`);
  await page.waitForLoadState('load');
  await sleep(1200);

  ensureOutDir();
  const results = [];
  const report = (label, ok, detail) => {
    results.push({ label, ok, detail: detail ?? null });
    console.log(`${ok ? 'GEÇTİ' : 'KALDI'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };

  /* --- 1. Bozuk kasayla açılış --- */
  const crashVisible = await page.getByText('Kasa açılamadı').isVisible().catch(() => false);
  report('bozuk kasada hata ekranı çıktı', crashVisible);
  report(
    'sonsuz iskelet yok',
    (await page.locator('.skeleton-paper').count()) === 0,
    `${await page.locator('.skeleton-paper').count()} iskelet öğesi`,
  );
  await page.screenshot({ path: resolve(OUT_DIR, 'boot-error.png'), fullPage: true });

  /* --- 2. Engeli kaldır ve yeniden dene --- */
  mkdirSync(FIX_DIR, { recursive: true });
  console.log(`engel kaldırıldı: ${FIX_DIR} oluşturuldu`);

  await page.getByRole('button', { name: 'Yeniden dene' }).click();
  await sleep(3000);

  const recovered = !(await page.getByText('Kasa açılamadı').isVisible().catch(() => false));
  report('yeniden dene sonrası hata ekranı kapandı', recovered);

  const shellVisible = await page
    .getByPlaceholder('Arşivde ara: başlık · not · URL')
    .isVisible()
    .catch(() => false);
  report('kabuk gerçekten çizildi (yakala çubuğu)', shellVisible);

  await page.screenshot({ path: resolve(OUT_DIR, 'boot-recovered.png'), fullPage: true });

  writeFileSync(
    resolve(OUT_DIR, 'boot-error-probe.json'),
    JSON.stringify(
      {
        kind: 'runtime-probe',
        synthetic: false,
        note: 'Gerçek kasaya dokunulmadı: uygulama VITE_JV_DB ile var olmayan bir klasördeki dosyaya yönlendirildi, sonda klasörü oluşturup kurtarmayı doğruladı.',
        capturedAt: new Date().toISOString(),
        appUrl: page.url(),
        fixDir: FIX_DIR,
        results,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('\nprovenance: boot-error-probe.json (boot-error.png + boot-recovered.png)');

  const failed = results.filter((r) => !r.ok).length;
  return endProbe(failed === 0 ? 0 : 1);
};

await main();
