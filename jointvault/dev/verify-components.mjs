/*
 * Bileşen durumu sondası — üretim kodu DEĞİL.
 *
 * NE KANITLAR: Bileşenler bölümünün gösterdiği durumun **gerçek** olduğunu.
 * "Kurulu" demek dosyanın var olması değil, çalışabilmesi demek; bu yüzden:
 *   1. Bölüm gerçekten çiziliyor mu (arayüz),
 *   2. Bildirilen her yol diskte VAR mı (bağımsız dosya kontrolü),
 *   3. Yeni kayıt ile ESKİ `health_check` aynı cevabı veriyor mu
 *      (iki ayrı kod yolunun çakışmaması — ayrışma borcunun testi).
 *
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev        # pencere açıldıktan sonra:
 *   npm run verify:components
 */
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT_DIR, endProbe, ensureOutDir, findAppPage, waitForCdp } from './lib/browser.mjs';

const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
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
  await sleep(1500);

  const results = [];
  const report = (label, ok, detail) => {
    results.push({ label, ok, detail: detail ?? null });
    console.log(`${ok ? 'GEÇTİ' : 'KALDI'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };

  /* --- Arayüz --- */
  await page.getByRole('button', { name: 'Ayarlar' }).first().click();
  await sleep(800);
  if (!(await page.getByText('Bileşenler').first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Bileşenler' }).first().click();
    await sleep(700);
  } else {
    await page.getByRole('button', { name: 'Bileşenler' }).first().click();
    await sleep(700);
  }
  report('Bileşenler bölümü çizildi', await page.getByText('ffmpeg').first().isVisible().catch(() => false));
  report(
    'durum damgası görünüyor (kurulu/eksik)',
    (await page.getByText('kurulu').count()) + (await page.getByText('eksik').count()) > 0,
  );

  /* --- Veri: iki kod yolu aynı şeyi söylüyor mu --- */
  const data = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const components = await invoke('components_status');
    const health = JSON.parse(await invoke('health_check'));
    const dir = await invoke('components_path');
    return { components, health, dir };
  });

  const byId = Object.fromEntries(data.components.map((c) => [c.id, c]));
  console.log(`bileşen klasörü: ${data.dir}`);
  for (const component of data.components) {
    console.log(
      `  ${component.id}: ${component.installed ? 'kurulu' : 'eksik'}` +
        `${component.source ? ` (${component.source})` : ''}` +
        `${component.version ? ` · ${component.version}` : ''}`,
    );
  }

  report(
    'ffmpeg: kayıt ile health_check AYNI cevabı veriyor',
    byId.ffmpeg?.installed === data.health.ffmpeg.available,
    `kayıt=${byId.ffmpeg?.installed} · health=${data.health.ffmpeg.available}`,
  );
  report(
    'ffprobe: kayıt ile health_check AYNI cevabı veriyor',
    byId.ffprobe?.installed === data.health.ffprobe.available,
    `kayıt=${byId.ffprobe?.installed} · health=${data.health.ffprobe.available}`,
  );

  /* --- Bağımsız dosya kontrolü: kurulu denen her bileşenin yolu diskte olmalı.
   * Bu kontrol VERİ DOSYALARINI da kapsar (`kind: "asset"`): kurulu bir `.gguf`
   * de "kuruludur" ve yolu diskte olmalıdır. */
  const claimed = data.components.filter((c) => c.installed);
  const claimedAssets = claimed.filter((c) => c.kind === 'asset');
  const missingOnDisk = claimed.filter((c) => !existsSync(c.path ?? ''));
  report(
    'kurulu denen her bileşenin dosyası diskte VAR (veri dosyaları dâhil)',
    missingOnDisk.length === 0,
    missingOnDisk.map((c) => c.id).join(', ') ||
      `${claimed.length} bileşen doğrulandı (${claimedAssets.length} veri dosyası)`,
  );

  /* --- Tür-farkında "kurulu" hükmü -----------------------------------------
   * Asset (veri dosyası: `.bin`/`.gguf`, cudart DLL kümesi) ÇALIŞTIRILMAZ:
   * `runnable === false`, `version === null` — bu KASITLI (7c-3 `kind` sözleşmesi).
   * Bu yüzden `runnable === Boolean(version)` iddiası YALNIZ binary'ler için
   * anlamlıdır. Asset'ler `installed` (dosya var) ile değerlendirilir: kurulu bir
   * model çalışmasa da "kullanılabilir" sayılır, aksi hâlde her açılışta yeniden
   * indirmeye çalışılırdı. Türü ayrıştırmayan genel bir kontrol, bir gün asset'e
   * yanlışlıkla çalıştırma yolu açılırsa sessiz kalırdı. */
  const binaries = data.components.filter((c) => c.kind !== 'asset');
  const assets = data.components.filter((c) => c.kind === 'asset');
  report(
    'binary: runnable alanı sürüm okumasıyla tutarlı',
    binaries.length > 0 && binaries.every((c) => c.runnable === Boolean(c.version)),
    `${binaries.length} araç`,
  );
  report(
    'asset: çalıştırılamaz (runnable=false, version=null); kuruluysa kullanılabilir',
    assets.length > 0 &&
      assets.every(
        (c) => c.runnable === false && c.version === null && (!c.installed || existsSync(c.path ?? '')),
      ),
    `${assets.length} veri dosyası`,
  );

  // "Kurulu ama kullanılamıyor" yalnız ÇALIŞTIRILAMAYAN ARAÇLAR için kusurdur;
  // kurulu veri dosyaları bu listeye GİRMEZ (onlar `kind` ile kullanılabilir).
  const broken = claimed.filter((c) => !(c.kind === 'asset' || c.runnable));
  console.log(
    `  kurulu ama kullanılamayan: ${broken.map((c) => c.id).join(', ') || '(yok)'}`,
  );

  ensureOutDir();
  await page.screenshot({ path: resolve(OUT_DIR, 'components.png'), fullPage: true });
  writeFileSync(
    resolve(OUT_DIR, 'components-probe.json'),
    JSON.stringify(
      {
        kind: 'runtime-probe',
        synthetic: false,
        note: 'Bileşen durumu: arayüz + dosya kontrolü + health_check tutarlılığı.',
        capturedAt: new Date().toISOString(),
        appUrl: page.url(),
        components: data.components,
        componentsDir: data.dir,
        results,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('\nprovenance: components-probe.json + components.png');

  const failed = results.filter((r) => !r.ok).length;
  return endProbe(failed === 0 ? 0 : 1);
};

await main();
