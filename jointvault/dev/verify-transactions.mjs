/*
 * Transaction yeteneği sondası — üretim kodu DEĞİL.
 *
 * NEDEN: `tauri-plugin-sql` bir BAĞLANTI HAVUZU kullanır. `BEGIN` ile `COMMIT`
 * ayrı çağrılara bölünürse havuz her çağrıya farklı bir bağlantı verebilir ve
 * transaction sessizce etkisiz kalır — yani "atomik" sandığımız yazma yolu
 * aslında atomik olmaz. Bu, kod okuyarak değil ancak ölçerek anlaşılır.
 *
 * Ölçtüğü üç şey:
 *   1. Çok ifadeli tek çağrı kabul ediliyor mu? (`a; b`)
 *   2. Ayrı çağrılarla BEGIN/ROLLBACK gerçekten geri alıyor mu?
 *   3. BEGIN ... ROLLBACK tek çağrıda geri alıyor mu?
 *
 * GEÇİCİ kasa kullanır (dikişler); gerçek kasaya dokunmaz.
 *
 *   $env:VITE_JV_DB="sqlite:C:/gecici/kasa.db"
 *   $env:JV_DB_CONN="sqlite:C:/gecici/kasa.db"
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev        # pencere açıldıktan sonra:
 *   npm run verify:transactions
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

  const out = await page.evaluate(async (db) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const exec = (query, values = []) => invoke('plugin:sql|execute', { db, query, values });
    const count = async () => {
      const rows = await invoke('plugin:sql|select', {
        db,
        query: 'SELECT COUNT(*) AS n FROM items',
        values: [],
      });
      return rows[0].n;
    };
    const attempt = async (label, fn) => {
      try {
        await fn();
        return { label, ok: true };
      } catch (e) {
        return { label, ok: false, error: String(e).slice(0, 200) };
      }
    };

    const results = {};
    const counts = {};

    /* 1) Çok ifadeli tek çağrı */
    results.multiStatement = await attempt('multi', () =>
      exec("CREATE TABLE t_probe (x INTEGER); INSERT INTO t_probe (x) VALUES (1)"),
    );

    /* 2) Ayrı çağrılarla transaction */
    counts.before2 = await count();
    results.begin = await attempt('begin', () => exec('BEGIN'));
    results.insertInTx = await attempt('insert', () =>
      exec(
        "INSERT INTO items (id, url, platform, created_at, updated_at) VALUES ('tx1', 'https://tx1', 'x', '2026-01-01', '2026-01-01')",
      ),
    );
    results.rollback = await attempt('rollback', () => exec('ROLLBACK'));
    counts.after2 = await count();
    results.separateCallsRolledBack = counts.after2 === counts.before2;

    /* 2b) Açık transaction temizliği.
       Yukarıdaki bozuk deneme, bağlantıda ASILI bir transaction bıraktı; aynı
       bağlantı yeniden kullanılırsa sonraki `BEGIN` "cannot start a transaction
       within a transaction" ile düşer. Uygulamanın `runAtomic` içindeki en iyi
       çaba ROLLBACK'inin karşılığı budur — gerçekten temizliyor mu? */
    results.cleanupRollbacks = [];
    for (let i = 0; i < 3; i++) {
      results.cleanupRollbacks.push(await attempt(`rollback-${i}`, () => exec('ROLLBACK')));
    }

    /* 3) Tek çağrıda transaction */
    counts.before3 = await count();
    results.singleCallTransaction = await attempt('single', () =>
      exec(
        "BEGIN; INSERT INTO items (id, url, platform, created_at, updated_at) VALUES ('tx2', 'https://tx2', 'x', '2026-01-01', '2026-01-01'); ROLLBACK;",
      ),
    );
    counts.after3 = await count();
    results.singleCallRolledBack = counts.after3 === counts.before3;

    /* 4) Tek çağrıda COMMIT (gerçek kullanım) */
    counts.before4 = await count();
    results.singleCallCommit = await attempt('commit', () =>
      exec(
        "BEGIN; INSERT INTO items (id, url, platform, created_at, updated_at) VALUES ('tx3', 'https://tx3', 'x', '2026-01-01', '2026-01-01'); COMMIT;",
      ),
    );
    counts.after4 = await count();
    results.singleCallCommitted = counts.after4 === counts.before4 + 1;

    results.counts = counts;

    /* 5) Tek çağrılık transaction + BAĞLI PARAMETRE (gerçek kullanım böyle olur) */
    const uniqueId = `txp-${Date.now()}`;
    counts.before5 = await count();
    results.paramInTransaction = await attempt('param', () =>
      exec(
        'BEGIN; INSERT INTO items (id, url, platform, created_at, updated_at) VALUES ($1, $2, $3, $4, $5); COMMIT;',
        [uniqueId, 'https://param', 'x', '2026-01-01', '2026-01-01'],
      ),
    );
    counts.after5 = await count();
    const found = await invoke('plugin:sql|select', {
      db,
      query: 'SELECT id FROM items WHERE id = $1',
      values: [uniqueId],
    });
    results.paramRowWritten = found.length === 1;
    results.counts = counts;

    /* 6) GERÇEK SENARYO: atomiklik veri kaybını önlüyor mu?
       Uygulamanın kullandığı ifadenin AYNISI: önce sil, sonra ekle. Ekleme
       başarısız olursa (FK ihlali) silmenin de geri alınması gerekir — yoksa
       kullanıcının etiketleri kaybolur. */
    const itemId = `atom-item-${Date.now()}`;
    const tagId = `atom-tag-${Date.now()}`;
    await exec('INSERT INTO items (id, url, platform, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)', [
      itemId,
      'https://atom',
      'x',
      '2026-01-01',
      '2026-01-01',
    ]);
    await exec('INSERT INTO tags (id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)', [
      tagId,
      tagId,
      '2026-01-01',
      '2026-01-01',
    ]);

    const body = 'DELETE FROM item_tags WHERE item_id = $1; INSERT INTO item_tags (item_id, tag_id) VALUES ($1, $2);';
    const tagsOf = async () => {
      const rows = await invoke('plugin:sql|select', {
        db,
        query: 'SELECT COUNT(*) AS n FROM item_tags WHERE item_id = $1',
        values: [itemId],
      });
      return rows[0].n;
    };

    results.atomicWrite = await attempt('atomic-write', () => exec(`BEGIN; ${body} COMMIT;`, [itemId, tagId]));
    results.tagsAfterValidWrite = await tagsOf();

    /* Geçersiz etiket → FK ihlali; silme GERİ ALINMALI. */
    results.atomicFailingWrite = await attempt('atomic-fail', () =>
      exec(`BEGIN; ${body} COMMIT;`, [itemId, 'yok-boyle-tag']),
    );
    results.tagsAfterFailedWrite = await tagsOf();
    results.atomicityPreservedData = results.tagsAfterFailedWrite === results.tagsAfterValidWrite;

    /* 7) Yarıda kalan blok bağlantıyı zehirledi mi? Sonraki yazma çalışmalı. */
    results.writeAfterFailure = await attempt('after-fail', () => exec(`BEGIN; ${body} COMMIT;`, [itemId, tagId]));

    /* 7b) Zehirlenmiş bağlantının KESİN temizliği: havuzu kapat.
       SQLite, bağlantı kapanırken açık transaction'ı geri alır. Uygulamanın
       `runAtomicSafe` içinde yaptığı tam olarak bu. */
    results.poolClose = await attempt('pool-close', () => invoke('plugin:sql|close', { db }));
    results.writeAfterPoolClose = await attempt('after-pool-close', () =>
      exec(`BEGIN; ${body} COMMIT;`, [itemId, tagId]),
    );

    /* 8) İndeksler gerçekten kullanılıyor mu? */
    const plan = async (query) => {
      const rows = await invoke('plugin:sql|select', { db, query, values: [] });
      return rows.map((r) => r.detail).join(' | ');
    };
    results.plans = {
      updatedAt: await plan('EXPLAIN QUERY PLAN SELECT * FROM items ORDER BY updated_at DESC'),
      favorite: await plan('EXPLAIN QUERY PLAN SELECT * FROM items WHERE favorite = 1'),
      downloadStatus: await plan("EXPLAIN QUERY PLAN SELECT * FROM items WHERE download_status = 'done'"),
    };

    await attempt('cleanup', () => exec('DROP TABLE IF EXISTS t_probe'));
    return results;
  }, DB_CONN);

  console.log(JSON.stringify(out, null, 2));

  ensureOutDir();
  writeFileSync(
    resolve(OUT_DIR, 'transactions-probe.json'),
    JSON.stringify(
      {
        kind: 'runtime-probe',
        synthetic: false,
        note: 'Plugin bağlantı havuzunun transaction davranışı (geçici kasa).',
        capturedAt: new Date().toISOString(),
        appUrl: page.url(),
        out,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('\nprovenance: transactions-probe.json');
  return endProbe(0);
};

await main();
