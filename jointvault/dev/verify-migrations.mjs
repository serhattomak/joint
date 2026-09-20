/*
 * Göç sondası — üretim kodu DEĞİL.
 *
 * NE KANITLAR: göç sisteminin GERÇEK kasayı bozmadığını. Bu, değişikliğin en
 * riskli yoludur: mevcut kasa `user_version = 0` taşır ama şemayı zaten
 * içerir; göçlerin "kolon zaten var" hatasını yok sayıp sürümü ilerletmesi ve
 * KAYDI KORUMASI gerekir.
 *
 * Yaptığı: çalışan uygulamaya bağlanır, kabuğun çizildiğini (çökme ekranı
 * DEĞİL) doğrular, sonra veritabanı dosyasını salt-okunur açıp `user_version`
 * değerini ve kayıt sayısını okur.
 *
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev        # pencere açıldıktan sonra:
 *   npm run verify:migrations
 */
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OUT_DIR, endProbe, ensureOutDir, findAppPage, waitForCdp } from './lib/browser.mjs';

const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';
const EXPECTED_VERSION = 3;

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

  const crashed = await page.getByText('Kasa açılamadı').isVisible().catch(() => false);
  report('gerçek kasa ile açılışta çökme ekranı YOK', !crashed);

  const shellVisible = await page
    .getByPlaceholder('Arşivde ara: başlık · not · URL')
    .isVisible()
    .catch(() => false);
  report('kabuk çizildi (yakala çubuğu)', shellVisible);

  const appData = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (!invoke) return null;
    try {
      return await invoke('app_data_path');
    } catch {
      return null;
    }
  });
  if (!appData) {
    console.error('app_data_path alınamadı; DB dosyası bulunamaz.');
    return endProbe(2);
  }

  /* Salt-okunur: sondanın kasayı değiştirmeye hakkı yok. */
  const dbFile = join(appData, 'jointvault.db');
  console.log(`veritabanı: ${dbFile}`);

  let version = -1;
  let itemCount = -1;
  try {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    version = db.prepare('PRAGMA user_version').get().user_version;
    itemCount = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
    db.close();
  } catch (error) {
    console.error(`Veritabanı okunamadı (kilitli olabilir): ${error.message}`);
    return endProbe(2);
  }

  report(`göçler uygulandı (user_version = ${EXPECTED_VERSION})`, version === EXPECTED_VERSION, `bulunan: ${version}`);
  report('kayıtlar duruyor (items sayılabilir)', itemCount >= 0, `${itemCount} fiş`);

  /* Göçten ÖNCE alınan güvenlik kopyasıyla karşılaştırma: veri kaybı kanıtı. */
  const baselineFile = process.env.JV_BASELINE_DB;
  let baselineCount = null;
  if (baselineFile) {
    try {
      const baseline = new DatabaseSync(baselineFile, { readOnly: true });
      baselineCount = baseline.prepare('SELECT COUNT(*) AS n FROM items').get().n;
      baseline.close();
      report(
        'kayıt sayısı göçten önceki kopyayla AYNI',
        baselineCount === itemCount,
        `önce ${baselineCount} → sonra ${itemCount}`,
      );
    } catch (error) {
      report('güvenlik kopyası okunabildi', false, String(error));
    }
  } else {
    console.log('     (bilgi) JV_BASELINE_DB verilmedi; önce/sonra karşılaştırması yapılmadı');
  }

  ensureOutDir();
  writeFileSync(
    resolve(OUT_DIR, 'migrations-probe.json'),
    JSON.stringify(
      {
        kind: 'runtime-probe',
        synthetic: false,
        note: 'Gerçek kasa ile açılış: göçler uygulandıktan sonra sürüm ve kayıt sayısı salt-okunur doğrulanır.',
        capturedAt: new Date().toISOString(),
        appUrl: page.url(),
        dbFile,
        userVersion: version,
        itemCount,
        baselineCount,
        baselineFile: baselineFile ?? null,
        results,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('\nprovenance: migrations-probe.json');

  const failed = results.filter((r) => !r.ok).length;
  return endProbe(failed === 0 ? 0 : 1);
};

await main();
