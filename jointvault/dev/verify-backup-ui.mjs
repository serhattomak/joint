/*
 * Yedek arayüzü sondası — üretim kodu DEĞİL.
 *
 * NE KANITLAR: Ayarlar → Yedekleme sekmesindeki yeni "Kasa yedekleri" bölümünün
 * GERÇEK uygulamada çizildiğini ve gerçek yedeği listelediğini. Birim testler
 * mantığı kanıtlar; arayüzün gerçekten orada olduğunu yalnızca uygulama söyler.
 *
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev        # pencere açıldıktan sonra:
 *   npm run verify:backup-ui
 */
import { writeFileSync } from 'node:fs';
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
  /* Sayfayı tazele: açılış yedeği boot'ta alınır; HMR tek başına onu çalıştırmaz. */
  await page.reload();
  await page.waitForLoadState('load');
  await sleep(4000);

  const results = [];
  const report = (label, ok, detail) => {
    results.push({ label, ok, detail: detail ?? null });
    console.log(`${ok ? 'GEÇTİ' : 'KALDI'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };

  /* Ray'dan Ayarlar'a, sonra Yedekleme sekmesine */
  await page.getByRole('button', { name: 'Ayarlar' }).first().click();
  await sleep(800);

  if (!(await page.getByText('Kasa yedekleri').isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Yedekleme' }).first().click();
    await sleep(900);
  }
  report('Kasa yedekleri bölümü çizildi', await page.getByText('Kasa yedekleri').isVisible().catch(() => false));
  report(
    '"Şimdi yedekle" düğmesi var',
    await page.getByRole('button', { name: 'Şimdi yedekle' }).isVisible().catch(() => false),
  );
  report(
    '"Veritabanını sıfırla" düğmesi var',
    await page.getByRole('button', { name: 'Veritabanını sıfırla' }).isVisible().catch(() => false),
  );

  /* Sıfırlama onayı YAZILI olmalı: düğme, doğru metin yazılana kadar kapalı. */
  await page.getByRole('button', { name: 'Veritabanını sıfırla' }).click();
  await sleep(600);
  const resetButton = page.getByRole('button', { name: 'Sıfırla' });
  report('sıfırla düğmesi metin yazılmadan kapalı', await resetButton.isDisabled(), 'yazılı onay');
  await page.getByLabel('Sıfırlama onayı').fill('SIFIRLA');
  await sleep(300);
  report('metin girilince sıfırla düğmesi açılıyor', !(await resetButton.isDisabled()));
  await page.getByRole('button', { name: 'Vazgeç' }).click();
  await sleep(400);

  /* Gerçek yedek listeleniyor mu (açılışta günlük yedek alınır) */
  const rows = await page.locator('text=/jointvault-\\d{8}-\\d{6}\\.db/').count();
  report('gerçek yedek listede görünüyor', rows >= 1, `${rows} yedek satırı`);

  ensureOutDir();
  await page.screenshot({ path: resolve(OUT_DIR, 'backup-ui.png'), fullPage: true });
  writeFileSync(
    resolve(OUT_DIR, 'backup-ui-probe.json'),
    JSON.stringify(
      {
        kind: 'runtime-probe',
        synthetic: false,
        note: 'Gerçek uygulamada yedek arayüzü: bölüm çizimi, yazılı sıfırlama onayı, yedek listesi.',
        capturedAt: new Date().toISOString(),
        appUrl: page.url(),
        results,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('\nprovenance: backup-ui-probe.json + backup-ui.png');

  const failed = results.filter((r) => !r.ok).length;
  return endProbe(failed === 0 ? 0 : 1);
};

await main();
