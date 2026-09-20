/*
 * Yedek / geri dönme / sıfırlama sondası — üretim kodu DEĞİL.
 *
 * NE KANITLAR:
 *   1. Açılışta günlük yedek gerçekten alınıyor.
 *   2. `VACUUM INTO` ile üretilen yedek listelenebiliyor.
 *   3. GERİ DÖNME veriyi gerçekten eski hâline çeviriyor (kayıt sayısı düşüyor).
 *   4. Sıfırlama dosyayı siliyor.
 *
 * GERÇEK KASAYA DOKUNMAZ: iki dikiş birlikte kullanılır — arayüzde `VITE_JV_DB`,
 * Rust'ta `JV_DB_FILE` — ve ikisi de geçici bir kasayı gösterir.
 *
 *   $env:VITE_JV_DB="sqlite:C:/gecici/kasa.db"
 *   $env:JV_DB_FILE="C:/gecici/kasa.db"
 *   $env:JV_VAULT_DIR="C:/gecici"
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev        # pencere açıldıktan sonra:
 *   npm run verify:backup
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OUT_DIR, endProbe, ensureOutDir, findAppPage, waitForCdp } from './lib/browser.mjs';

const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';
const DB_FILE = process.env.JV_DB_FILE;
const DB_CONN = process.env.JV_DB_CONN;
const VAULT_DIR = process.env.JV_VAULT_DIR;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Salt-okunur sayım: sondanın kasayı değiştirmeye hakkı yok. */
const countItems = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  const n = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  db.close();
  return n;
};

const main = async () => {
  if (!DB_FILE || !DB_CONN || !VAULT_DIR) {
    console.error('JV_DB_FILE, JV_DB_CONN ve JV_VAULT_DIR tanımlı olmalı.');
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
  await sleep(2500); // açılış + günlük yedek

  const results = [];
  const report = (label, ok, detail) => {
    results.push({ label, ok, detail: detail ?? null });
    console.log(`${ok ? 'GEÇTİ' : 'KALDI'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };

  const call = (cmd, args) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args]);

  /* --- 1. Dikişler tutuyor mu --- */
  const dbPath = await call('database_path');
  report('database_path geçici kasayı gösteriyor', resolve(dbPath) === resolve(DB_FILE), dbPath);

  const backupsPath = await call('backups_path');
  report('backups_path kasa klasörünün yanında', backupsPath.startsWith(VAULT_DIR), backupsPath);

  /* --- 2. Açılış yedeği alınmış mı --- */
  const bootBackups = existsSync(backupsPath) ? readdirSync(backupsPath).filter((f) => f.endsWith('.db')) : [];
  report('açılışta günlük yedek alındı', bootBackups.length >= 1, bootBackups.join(', ') || '(yok)');

  /* --- 3. Veri ekle, yedek al --- */
  const before = countItems(DB_FILE);
  await call('plugin:sql|execute', {
    db: DB_CONN,
    query: "INSERT INTO items (id, url, platform, created_at, updated_at) VALUES ('probe-1', 'https://a', 'x', '2026-01-01', '2026-01-01')",
    values: [],
  });
  const withOne = countItems(DB_FILE);
  report('kayıt eklendi', withOne === before + 1, `${before} → ${withOne}`);

  const snapshot = `elle-${Date.now()}.db`;
  await call('plugin:sql|execute', {
    db: DB_CONN,
    query: 'VACUUM INTO $1',
    values: [`${backupsPath.replace(/\\/g, '/')}/${snapshot}`],
  });
  report('VACUUM INTO ile yedek alındı', existsSync(join(backupsPath, snapshot)), snapshot);

  /* --- 4. Veriyi değiştir: geri dönüş görünür olsun --- */
  await call('plugin:sql|execute', {
    db: DB_CONN,
    query: "INSERT INTO items (id, url, platform, created_at, updated_at) VALUES ('probe-2', 'https://b', 'x', '2026-01-01', '2026-01-01')",
    values: [],
  });
  const withTwo = countItems(DB_FILE);
  report('ikinci kayıt eklendi (yedekten sonra)', withTwo === withOne + 1, `${withOne} → ${withTwo}`);

  /* --- 5. Geri dön --- */
  await call('plugin:sql|close', { db: DB_CONN });
  await sleep(500);
  const safety = await call('restore_backup', { name: snapshot });
  await sleep(500);

  const afterRestore = countItems(DB_FILE);
  report('geri dönme veriyi eski hâline çevirdi', afterRestore === withOne, `${withTwo} → ${afterRestore}`);
  report('geri dönme öncesi güvenlik kopyası alındı', Boolean(safety), safety);

  const listed = await call('list_backups');
  report('yedekler listelenebiliyor', Array.isArray(listed) && listed.length >= 2, `${listed.length} yedek`);

  /* --- 6. Sıfırla --- */
  await call('reset_database');
  await sleep(500);
  report('sıfırlama dosyayı sildi', !existsSync(DB_FILE));

  ensureOutDir();
  writeFileSync(
    resolve(OUT_DIR, 'backup-probe.json'),
    JSON.stringify(
      {
        kind: 'runtime-probe',
        synthetic: false,
        note: 'Geçici kasa ile yedek/geri dönme/sıfırlama. Gerçek kasaya dokunulmadı (VITE_JV_DB + JV_DB_FILE dikişleri).',
        capturedAt: new Date().toISOString(),
        appUrl: page.url(),
        dbFile: DB_FILE,
        backupsPath,
        counts: { before, withOne, withTwo, afterRestore },
        safety,
        listed,
        results,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('\nprovenance: backup-probe.json');

  const failed = results.filter((r) => !r.ok).length;
  return endProbe(failed === 0 ? 0 : 1);
};

await main();
