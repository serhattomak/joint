/*
 * Yabancı anahtar (foreign key) zorlaması sondası — üretim kodu DEĞİL.
 *
 * Neden ayrı bir sonda: şema `PRAGMA foreign_keys = ON` çalıştırıyor ama bu
 * ayar BAĞLANTIYA özeldir; plugin bir havuz kullanıyorsa her bağlantıya
 * uygulanmayabilir ve sessizce kapalı kalabilir. Ayetin çalıştığını okumak
 * yetmez — zorlamanın gerçekten olduğunu görmek gerekir.
 *
 * GEÇİCİ kasa kullanır (dikişler): bilerek geçersiz bir ilişki yazmayı dener.
 * Gerçek kasada bu deneme, ayar kapalıysa kasayı kirletirdi.
 *
 *   $env:VITE_JV_DB="sqlite:C:/gecici/kasa.db"
 *   $env:JV_DB_CONN="sqlite:C:/gecici/kasa.db"
 *   $env:JV_DB_FILE="C:/gecici/kasa.db"
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev        # pencere açıldıktan sonra:
 *   npm run verify:foreign-keys
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT_DIR, endProbe, ensureOutDir, findAppPage, waitForCdp } from './lib/browser.mjs';

const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';
const DB_CONN = process.env.JV_DB_CONN;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  if (!DB_CONN) {
    console.error('JV_DB_CONN tanımlı değil (geçici kasa bağlantısı gerekli).');
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
  await page.waitForLoadState('load');
  await sleep(2000);

  const results = [];
  const report = (label, ok, detail) => {
    results.push({ label, ok, detail: detail ?? null });
    console.log(`${ok ? 'GEÇTİ' : 'KALDI'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };

  const probe = await page.evaluate(async (db) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const pragma = await invoke('plugin:sql|select', { db, query: 'PRAGMA foreign_keys', values: [] });
    const before = await invoke('plugin:sql|select', {
      db,
      query: 'SELECT COUNT(*) AS n FROM item_tags',
      values: [],
    });

    let insertError = null;
    try {
      /* Olmayan bir öğeye ve etikete bağlanmaya çalış: zorlama varsa REDDEDİLMELİ. */
      await invoke('plugin:sql|execute', {
        db,
        query: "INSERT INTO item_tags (item_id, tag_id) VALUES ('yok-item', 'yok-etiket')",
        values: [],
      });
    } catch (error) {
      insertError = String(error);
    }

    const after = await invoke('plugin:sql|select', {
      db,
      query: 'SELECT COUNT(*) AS n FROM item_tags',
      values: [],
    });

    return {
      pragmaOn: pragma?.[0]?.foreign_keys ?? null,
      before: before?.[0]?.n ?? -1,
      after: after?.[0]?.n ?? -1,
      insertError,
    };
  }, DB_CONN);

  report('PRAGMA foreign_keys açık', probe.pragmaOn === 1, String(probe.pragmaOn));
  report(
    'geçersiz ilişki REDDEDİLDİ (zorlama gerçekten çalışıyor)',
    probe.insertError !== null,
    probe.insertError ? probe.insertError.slice(0, 200) : 'hata vermedi — FK kapalı olabilir',
  );
  report('reddedilen yazma kasayı kirletmedi', probe.before === probe.after, `${probe.before} → ${probe.after}`);

  ensureOutDir();
  writeFileSync(
    resolve(OUT_DIR, 'foreign-keys-probe.json'),
    JSON.stringify(
      {
        kind: 'runtime-probe',
        synthetic: false,
        note: 'Geçici kasa ile FK zorlaması: geçersiz ilişki yazma denemesi reddedilmeli.',
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
  console.log('\nprovenance: foreign-keys-probe.json');

  const failed = results.filter((r) => !r.ok).length;
  return endProbe(failed === 0 ? 0 : 1);
};

await main();
