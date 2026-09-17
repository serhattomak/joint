import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'D:/serhatdev/joint/.impeccable/review';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE });
const logs = [];

async function shoot({ name, url, w, h, theme, full, dismissWizard }) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    colorScheme: theme,
  });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('jointvault-theme', t);
    } catch {
      /* yok sayılır */
    }
  }, theme);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    // Tauri IPC yokluğu beklenen durum; yalnızca gerçek render hatalarını topla.
    if (!/invoke|transformCallback/.test(e.message)) logs.push(`[${name}] ${e.message}`);
  });
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
    document.documentElement.style.colorScheme = t;
  }, theme);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  if (dismissWizard) {
    try {
      await page.getByRole('button', { name: 'Atla' }).first().click({ timeout: 2500 });
      await page.waitForTimeout(300);
    } catch {
      /* sihirbaz yoksa sorun değil */
    }
  }
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  await ctx.close();
  console.log(`ok: ${name} (${w}px, ${theme}${full ? ', full' : ''})`);
}

await shoot({ name: 'desktop', url: 'http://localhost:5173/', w: 1440, h: 900, theme: 'dark', full: true, dismissWizard: true });
await shoot({ name: 'mobile', url: 'http://localhost:5173/', w: 390, h: 844, theme: 'dark', full: true, dismissWizard: true });
await shoot({ name: 'shell-light-1440', url: 'http://localhost:5173/', w: 1440, h: 900, theme: 'light', full: false, dismissWizard: true });
await shoot({ name: 'world-desktop', url: 'http://localhost:5173/dev/kitchen-sink.html', w: 1440, h: 1000, theme: 'dark', full: true });
await shoot({ name: 'world-light', url: 'http://localhost:5173/dev/kitchen-sink.html', w: 1440, h: 1000, theme: 'light', full: true });
await shoot({ name: 'world-mobile', url: 'http://localhost:5173/dev/kitchen-sink.html', w: 390, h: 900, theme: 'dark', full: true });

await browser.close();
console.log('--- render log ---');
console.log(logs.length ? logs.join('\n') : '(temiz: beklenmeyen render hatası yok)');
