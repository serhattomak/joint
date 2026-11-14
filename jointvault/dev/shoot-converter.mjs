/*
 * Dönüştürücü ekran kanıtı — üretim kodu DEĞİL.
 *
 * `dev/converter-harness.html` (sentetik veri) üzerinde açık/koyu tema ve
 * 1440/1280/1024/768/390 genişliklerini çeker. Sunucu kendi başlatılmadıysa
 * ayağa kaldırılır; var olan sunucuya dokunulmaz.
 *
 *   node dev/shoot-converter.mjs
 */
import { APP_URL, PROJECT_ROOT, ensureOutDir, launchEvidenceBrowser } from './lib/browser.mjs';
import { startDevServer, stopDevServer } from './lib/dev-server.mjs';

const OUT = ensureOutDir('converter');

const SHOTS = [
  { name: 'convert-dark-1280', state: 'default', tab: 'convert', w: 1280, h: 800, theme: 'dark' },
  { name: 'convert-dark-1440', state: 'default', tab: 'convert', w: 1440, h: 900, theme: 'dark', full: true },
  { name: 'convert-light-1280', state: 'default', tab: 'convert', w: 1280, h: 800, theme: 'light' },
  { name: 'convert-dark-1024', state: 'default', tab: 'convert', w: 1024, h: 768, theme: 'dark', full: true },
  { name: 'convert-dark-768', state: 'default', tab: 'convert', w: 768, h: 1024, theme: 'dark', full: true },
  { name: 'convert-dark-390', state: 'default', tab: 'convert', w: 390, h: 844, theme: 'dark', full: true },
  { name: 'settings-dark-1280', state: 'default', tab: 'convert', w: 1280, h: 800, theme: 'dark', full: true, click: 'Düzenle' },
  { name: 'running-dark-1280', state: 'running', tab: 'convert', w: 1280, h: 800, theme: 'dark' },
  { name: 'empty-dark-1280', state: 'empty', tab: 'convert', w: 1280, h: 800, theme: 'dark' },
  { name: 'mixed-dark-1280', state: 'mixed', tab: 'convert', w: 1280, h: 800, theme: 'dark', full: true },
  { name: 'done-dark-1280', state: 'done', tab: 'convert', w: 1280, h: 800, theme: 'dark' },
  { name: 'pdf-dark-1280', state: 'default', tab: 'pdf', w: 1280, h: 800, theme: 'dark', full: true },
  { name: 'pdf-dark-768', state: 'default', tab: 'pdf', w: 768, h: 1024, theme: 'dark', full: true },
  { name: 'pdf-dark-390', state: 'default', tab: 'pdf', w: 390, h: 844, theme: 'dark', full: true },
];

const server = await startDevServer(PROJECT_ROOT, APP_URL);
const browser = await launchEvidenceBrowser();
const errors = [];

try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: shot.w, height: shot.h },
      deviceScaleFactor: 1,
      colorScheme: shot.theme,
    });
    await context.addInitScript((theme) => {
      try {
        localStorage.setItem('jointvault-theme', theme);
      } catch {
        /* yok sayılır */
      }
    }, shot.theme);
    const page = await context.newPage();
    page.on('pageerror', (error) => {
      // Tarayıcı tezgâhında Tauri IPC yok; bu iki hata beklenen durumdur.
      if (/invoke|transformCallback/.test(error.message)) return;
      errors.push(`[${shot.name}] ${error.message}`);
    });
    await page.goto(
      `${APP_URL}/dev/converter-harness.html?tab=${shot.tab}&state=${shot.state}`,
      { waitUntil: 'load', timeout: 30000 },
    );
    await page.evaluate((theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.documentElement.style.colorScheme = theme;
    }, shot.theme);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(450);
    if (shot.click) {
      await page.getByRole('button', { name: shot.click }).first().click();
      await page.waitForTimeout(250);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 1) console.log(`  ! yatay taşma: ${overflow}px`);
    if (shot.name === 'convert-dark-1280') {
      const action = await page.getByRole('button', { name: 'Dönüştür', exact: true }).boundingBox();
      const visible = action ? action.y + action.height <= shot.h : false;
      console.log(`  birincil eylem ilk ekranda: ${visible ? 'evet' : 'hayır'}`);
    }
    await page.screenshot({
      path: `${OUT}/${shot.name}.png`,
      fullPage: Boolean(shot.full),
    });
    await context.close();
    console.log(`ok: ${shot.name} (${shot.w}×${shot.h}, ${shot.theme})`);
  }
} finally {
  await browser.close();
  stopDevServer(server);
}

console.log('--- render log ---');
console.log(errors.length ? errors.join('\n') : '(temiz: beklenmeyen render hatası yok)');
