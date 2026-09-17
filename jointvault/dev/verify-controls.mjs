/*
 * Kontrol doğrulaması — üretim kodu DEĞİL.
 * `npm run dev` çalışırken: node dev/verify-controls.mjs
 */
import { chromium } from 'playwright-core';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL = 'http://localhost:5173/dev/verify-controls.html';

const browser = await chromium.launch({ executablePath: EDGE });
const ctx = await browser.newContext({
  viewport: { width: 1200, height: 900 },
  colorScheme: 'dark',
});
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);

const results = [];
const check = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push(
    `${pass ? 'PASS' : 'FAIL'}  ${name}\n         beklenen: ${JSON.stringify(expected)}\n         gerçek:   ${JSON.stringify(actual)}`,
  );
};

const triggerText = async (label) =>
  (
    await page.locator(`button[aria-label="${label}"] [data-slot="select-value"]`).innerText()
  ).trim();

const log = async () => page.evaluate(() => window.__log);

// ---------- 1. Select: seçili etiket çözümü ----------
check('sentinel ("none") -> etiket', await triggerText('sentinel'), 'Koleksiyon yok');
check('numeric ("640") -> etiket', await triggerText('numeric'), '640px');
check('string ("tray") -> etiket', await triggerText('stringy'), 'Tepside çalışmaya devam et');
check('hint tetikleyiciye sızmıyor', await triggerText('hinted'), 'Video');
check('placeholder seçimi gölgelemiyor', await triggerText('withplaceholder'), 'Koleksiyon A');

// ---------- 2. tone="default" yıkıcı görünmemeli ----------
await page.locator('button[aria-label="open-tone"]').click();
await page.waitForTimeout(350);
const toneBtn = page.getByRole('button', { name: 'Yenile' });
const toneClass = (await toneBtn.getAttribute('class')) ?? '';
/*
 * Sınıf dizesinde alt dize aramak yanıltıcıdır: taban sınıf
 * `aria-invalid:border-destructive` taşır ve her butonda eşleşir.
 * Varyanta özgü token'a bakılır.
 */
check('tone=default birincil damga', toneClass.includes('bg-primary'), true);
check('tone=default yıkıcı dolgu yok', toneClass.includes('bg-destructive/10'), false);
await toneBtn.click();
await page.waitForTimeout(300);
check('tone çağrısı çalıştı', (await log()).includes('confirm:tone-default'), true);

// ---------- 3. Dialog içinde ConfirmDialog ----------
await page.locator('button[aria-label="open-organize"]').click();
await page.waitForTimeout(350);
check('dış diyalog açıldı', await page.getByText('Düzenle (taklit)').isVisible(), true);

await page.locator('button[aria-label="del-tag"]').click();
await page.waitForTimeout(350);
check('onay yaprağı açıldı', await page.getByText('tag silinsin mi?').isVisible(), true);

const silClass = (await page.getByRole('button', { name: 'Sil' }).getAttribute('class')) ?? '';
check('yıkıcı varyant dolgusu var', silClass.includes('bg-destructive/10'), true);

const alertRole = await page
  .evaluate(() => {
    const el = document.querySelector('[role="alertdialog"]');
    return el ? 'alertdialog' : 'yok';
  })
  .catch(() => 'yok');
check('onay yaprağı role', alertRole, 'alertdialog');

await page.getByRole('button', { name: 'Sil' }).click();
await page.waitForTimeout(400);
check('DOĞRU iş çalıştı (tag)', (await log()).at(-1), 'confirm:tag');
check('onay yaprağı kapandı', await page.getByText('tag silinsin mi?').isVisible(), false);
check('dış diyalog açık kaldı', await page.getByText('Düzenle (taklit)').isVisible(), true);

// İkinci tur: aynı yaprak, farklı iş — kapanış state'i doğru sıfırlıyor mu?
await page.locator('button[aria-label="del-collection"]').click();
await page.waitForTimeout(350);
check('ikinci tur başlık', await page.getByText('collection silinsin mi?').isVisible(), true);
await page.getByRole('button', { name: 'Sil' }).click();
await page.waitForTimeout(400);
check('DOĞRU iş çalıştı (collection)', (await log()).at(-1), 'confirm:collection');

// ---------- rapor ----------
console.log(results.join('\n'));
console.log('\n--- sayfa hataları ---');
console.log(pageErrors.length ? pageErrors.join('\n') : '(temiz)');
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} geçti`);

await browser.close();
process.exit(failed === 0 ? 0 : 1);
