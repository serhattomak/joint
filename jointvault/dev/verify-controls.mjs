/*
 * Kontrol doğrulaması — üretim kodu DEĞİL.
 * Tek başına: `npm run dev` çalışırken `node dev/verify-controls.mjs`
 * Topyekûn: `npm run evidence:harness` (dev sunucusunu kendisi ayağa kaldırır)
 * SENTETİK: bileşen sözleşmelerini doğrular, gerçek arşiv verisi kullanmaz.
 */
import { APP_URL, ensureOutDir, launchEvidenceBrowser } from './lib/browser.mjs';

const URL = `${APP_URL}/dev/verify-controls.html`;
const OUT = ensureOutDir('shots');

const browser = await launchEvidenceBrowser();
const ctx = await browser.newContext({
  viewport: { width: 1200, height: 900 },
  colorScheme: 'dark',
});
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => {
  // Tarayıcıda Tauri IPC yok; invoke/transformCallback hataları beklenen durum.
  if (!/invoke|transformCallback/.test(e.message)) pageErrors.push(e.message);
});

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

// ---------- 2b. Etiket anahtarları (Badge'e taşındı) ----------
const alphaChip = page.getByRole('button', { name: '#alpha' });
check('etiket çipi buton olarak çizildi', (await page.getByRole('button', { name: '#gama' }).count()) === 1, true);
check('seçili çip aria-pressed=true', await alphaChip.getAttribute('aria-pressed'), 'true');

const alphaClass = (await alphaChip.getAttribute('class')) ?? '';
check('seçili çip ultramarin tonlu', alphaClass.includes('bg-primary/10'), true);
check('hap biçimi kalmadı (seçili)', alphaClass.includes('rounded-full'), false);

const betaChip = page.getByRole('button', { name: '#beta' });
const betaClass = (await betaChip.getAttribute('class')) ?? '';
check('hap biçimi kalmadı (seçili değil)', betaClass.includes('rounded-full'), false);
check('seçili olmayan çip nötr', betaClass.includes('border-border'), true);

await betaChip.click();
await page.waitForTimeout(250);
check('tıklama seçimi değiştirdi', await betaChip.getAttribute('aria-pressed'), 'true');

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

// ---------- 4. Yüzey dumanı: gerçek Ayarlar yüzeyi ----------
/* Aynı belgede yalnızca hash değiştirmek reload tetiklemez; önce boşalt. */
await page.goto('about:blank');
await page.goto(`${URL}#surfaces`, { waitUntil: 'load', timeout: 30000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(900);

/* Yüzey artık diyalog değil tam sayfa görünüm (SettingsDialog → SettingsView);
   bu yüzden "diyalog pencereden taşmıyor" ölçümü kaldırıldı — karşılığı yok.
   NOT: sekme şeridi bugün düz <button> (role="tab" yok) — erişilebilirlik borcu,
   Faz 15'te kapanacak. Tezgâh bugünkü gerçeği ölçer, olması gerekeni değil. */
const tabButtons = await page.locator('aside nav button').count();
check('sekme şeridi çizildi (sol menü)', tabButtons >= 5, true);

/* SettingRow 'Görünüm' sekmesinde yaşar; yapay zekâ sekmesi kart düzeni kullanır. */
await page.getByRole('button', { name: 'Görünüm' }).click();
await page.waitForTimeout(500);
const settingRows = await page.locator('[data-slot="setting-row"]').count();
check('SettingRow çizildi (Görünüm)', settingRows >= 4, true);
console.log(`         (bilgi) Görünüm sekmesinde ${settingRows} SettingRow`);

await page.getByRole('button', { name: 'Konuşma (Whisper)' }).click();
await page.waitForTimeout(600);
check('damga çizildi (Konuşma)', (await page.locator('[data-state="none"]').count()) >= 1, true);
/* Tauri yok → model durumu bilinmiyor → her model "eksik" damgası taşır. */
check('damga sözcüğü basıldı: eksik', await page.getByText('eksik', { exact: true }).first().isVisible(), true);
check(
  'damga ikon taşıyor (svg)',
  (await page.locator('[data-state="none"] svg').count()) >= 1,
  true,
);

await page.getByRole('button', { name: 'Tanılama' }).click();
await page.waitForTimeout(700);
check('damga çizildi (Tanılama)', (await page.locator('[data-state="none"]').count()) >= 1, true);

await page.screenshot({ path: `${OUT}/verify-settings.png` });

// ---------- 5. Damga sözlüğü tam mı (tezgâh gerçeği çiziyor mu) ----------
await page.goto('about:blank');
await page.goto(`${APP_URL}/dev/kitchen-sink.html`, { waitUntil: 'load', timeout: 30000 });
await page.waitForTimeout(800);
const dict = await page.evaluate(() =>
  [...document.querySelectorAll('[data-state]')].map((el) => el.getAttribute('data-state')),
);
for (const s of ['none', 'queued', 'active', 'local', 'error', 'duplicate', 'favorite', 'converted']) {
  check(`sozlukte durum: ${s}`, dict.includes(s), true);
}

/* Asıl kusur: favori "local" yeşilini giyiyordu; dönüştürüldü de yeşil giymemeli. */
const colors = await page.evaluate(() => {
  const pick = (st) => {
    const el = document.querySelector(`[data-state="${st}"]`);
    return el ? getComputedStyle(el).color : null;
  };
  return { favorite: pick('favorite'), local: pick('local'), converted: pick('converted') };
});
check('favori arsiv yesilini giymiyor', colors.favorite !== colors.local, true);
check('donusturuldu arsiv yesilini giymiyor', colors.converted !== colors.local, true);

// ---------- rapor ----------
console.log(results.join('\n'));
console.log('\n--- sayfa hataları ---');
console.log(pageErrors.length ? pageErrors.join('\n') : '(temiz)');
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} geçti`);

await browser.close();
process.exit(failed === 0 ? 0 : 1);
