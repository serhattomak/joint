import { ensureOutDir, launchEvidenceBrowser } from './lib/browser.mjs';

const OUT = ensureOutDir('detail');

const browser = await launchEvidenceBrowser();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('jointvault-theme', 'dark');
  } catch {
    /* yok sayılır */
  }
});
const page = await ctx.newPage();
await page.goto('http://localhost:5173/dev/kitchen-sink.html', { waitUntil: 'load' });
await page.evaluate(() => {
  document.documentElement.classList.add('dark');
  document.documentElement.style.colorScheme = 'dark';
});
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

const targets = [
  ['stamps', page.locator('section').nth(0)],
  ['buttons', page.locator('section').nth(2)],
  ['fields', page.locator('section').nth(3)],
  ['progress', page.locator('section').nth(4)],
  ['tabs', page.locator('section').nth(5)],
  ['card', page.locator('article').first()],
  ['row', page.locator('.cv-row').first()],
];

for (const [name, loc] of targets) {
  await loc.screenshot({ path: `${OUT}/detail-${String(name)}-dark.png` });
  console.log(`ok: detail-${String(name)}-dark`);
}

await browser.close();
