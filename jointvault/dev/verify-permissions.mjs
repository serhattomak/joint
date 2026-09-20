/*
 * İzin sondası — üretim kodu DEĞİL.
 *
 * NE KANITLAR: pano okuma/yazma ve `open_path` izinlerinin ÇALIŞMA ANINDA açık
 * olduğunu. Yapılandırma doğru görünse bile (bkz. gen/schemas/capabilities.json)
 * son kararı çalışan uygulama verir; bu betik ona sorar. `opener:allow-open-path`
 * için kapsam (scope) şart olduğu da tam olarak böyle anlaşıldı.
 *
 * YIKICI DEĞİL ama GÖRÜNÜR BİR YAN ETKİSİ VAR:
 *   - panoya yazdığı değer, az önce OKUDUĞU değerdir; pano içeriği değişmez.
 *   - `open_path`'e VAR OLMAYAN bir yol verilir; hiçbir uygulama açılmaz AMA
 *     kapsam kontrolü geçtiğinde Windows "dosya bulunamadı" penceresi açar.
 *     Bu BEKLENEN sonuçtur: tam da kanıtlanmak istenen şey, çağrının kapsam
 *     kontrolünü geçip işletim sistemine ulaştığıdır. Pencereyi kapatabilirsin.
 *     (Kapsam reddetseydi pencere hiç açılmaz, "Not allowed to open path"
 *     hatası dönerdi — hatanın kendisi kanıt olurdu.)
 *
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev        # pencere açıldıktan sonra:
 *   npm run verify:permissions
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT_DIR, endProbe, ensureOutDir, findAppPage, waitForCdp } from './lib/browser.mjs';

const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';

const DENIED = /not allowed|Permissions associated|forbidden|not permitted/i;

const verdict = (result) => {
  if (result?.ok === true) return 'İZİN VAR';
  if (result?.ok === false) {
    return DENIED.test(result.error) ? 'İZİN YOK (reddedildi)' : 'izin var (çağrı hatası)';
  }
  return 'DENENMEDİ';
};

const main = async () => {
  const browser = await waitForCdp(CDP);
  if (!browser) {
    console.error(`WebView2 hata ayıklama portuna bağlanılamadı (${CDP}).`);
    console.error('Sırayla: pencereyi kapat → $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" → npx tauri dev');
    return endProbe(2);
  }

  const page = findAppPage(browser);
  if (!page) {
    console.error('Uygulama penceresi bulunamadı.');
    return endProbe(2);
  }
  console.log(`bağlandı: ${page.url()}`);
  await page.waitForLoadState('load');
  await new Promise((r) => setTimeout(r, 1000));

  const probe = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (!invoke) return { bridge: false };

    const attempt = async (cmd, args) => {
      try {
        return { ok: true, value: await invoke(cmd, args) };
      } catch (error) {
        return {
          ok: false,
          error: typeof error === 'string' ? error : (error?.message ?? String(error)),
        };
      }
    };

    const read = await attempt('plugin:clipboard-manager|read_text');
    /* Panoya yazılan değer okunan değerdir → içerik değişmez. */
    const write = read.ok
      ? await attempt('plugin:clipboard-manager|write_text', { text: read.value })
      : { ok: null, skipped: 'okuma başarısız; yazma denenmedi' };
    const openMissing = await attempt('plugin:opener|open_path', {
      path: 'C:/__jointvault-izin-sondasi-yok__/yok.txt',
    });
    /* Faz 4 yardımcı komutu: hata ekranındaki "veri klasörünü aç" buna dayanır. */
    const appData = await attempt('app_data_path');

    return { bridge: true, read, write, openMissing, appData };
  });

  if (!probe.bridge) {
    console.error('Tauri köprüsü bulunamadı — doğru pencereye bağlanıldığından emin ol.');
    return endProbe(2);
  }

  const results = [];
  const report = (label, result) => {
    const v = verdict(result);
    results.push({ label, verdict: v, error: result?.error?.slice(0, 300) ?? null });
    console.log(`${label}: ${v}`);
    if (result?.error) console.log(`    hata: ${result.error.slice(0, 300)}`);
  };

  console.log('');
  console.log('NOT: `open_path` adımı Windows\'ta "dosya bulunamadı" penceresi açabilir.');
  console.log('     Bu BEKLENEN sonuçtur (kapsam geçti, işletim sistemi dosyayı aradı); pencereyi kapatabilirsin.\n');
  report('pano okuma (allow-read-text)', probe.read);
  report('pano yazma (allow-write-text)', probe.write);
  report('open_path (allow-open-path)', probe.openMissing);

  const appDataOk = probe.appData?.ok === true && typeof probe.appData.value === 'string';
  results.push({ label: 'app_data_path', verdict: appDataOk ? 'VAR' : 'YOK', error: probe.appData?.error ?? null });
  console.log(`app_data_path (Faz 4 yardımcı komutu): ${appDataOk ? 'VAR' : 'YOK'}`);
  if (probe.appData?.error) console.log(`    hata: ${probe.appData.error.slice(0, 200)}`);

  ensureOutDir();
  writeFileSync(
    resolve(OUT_DIR, 'permissions-probe.json'),
    JSON.stringify(
      {
        kind: 'runtime-probe',
        synthetic: false,
        note: 'Çalışan uygulamada izin sondası. Yıkıcı değil: panoya okunan değer geri yazıldı, open_path var olmayan yola çağrıldı.',
        capturedAt: new Date().toISOString(),
        appUrl: page.url(),
        probe,
        results,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('\nprovenance: permissions-probe.json');

  const denied = [probe.read, probe.write, probe.openMissing].filter(
    (r) => r?.ok === false && DENIED.test(r.error),
  );
  if (denied.length > 0) {
    console.error(`\n${denied.length} izin REDDEDİLDİ.`);
    return endProbe(1);
  }
  console.log('\nizinlerin üçü de çalışma anında açık.');
  return endProbe(0);
};

await main();
