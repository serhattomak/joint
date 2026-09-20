/*
 * Kanıt betiklerinin ortak ayarı — üretim kodu DEĞİL.
 *
 * Tarayıcı yolu bu makineye özgüdür; `JV_BROWSER` ile geçersiz kılınır, böylece
 * betikler başka bir kurulumda sessizce kırılmaz. Çıktı klasörü `JV_OUT` ile
 * değiştirilebilir; varsayılan `dev/out` (gitignore'da).
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(HERE, '../..');
export const DEV_DIR = resolve(HERE, '..');
export const OUT_DIR = process.env.JV_OUT ?? resolve(DEV_DIR, 'out');
export const APP_URL = process.env.JV_BASE_URL ?? 'http://localhost:5173';

const BROWSER_PATH =
  process.env.JV_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

/** Çıktı klasörünü hazırlar ve yolunu döndürür. */
export const ensureOutDir = (sub = '') => {
  const dir = sub ? resolve(OUT_DIR, sub) : OUT_DIR;
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** Kanıt tarayıcısını başlatır (sistemde kurulu Edge/Chromium üzerinden). */
export const launchEvidenceBrowser = () => chromium.launch({ executablePath: BROWSER_PATH });

/**
 * Sondayı bitirir: uygulamayı KAPATMADAN çıkar.
 *
 * `browser.close()` burada kasıtlı olarak KULLANILMAZ: bağlanılan (launch
 * edilmemiş) bir tarayıcıda Playwright onu kapatır — yani kanıt betiği
 * kullanıcının açık uygulama penceresini kapatır. Kısa bir bekleme (çıktının
 * boşalması için) ile süreçten çıkılır.
 *
 * DİKKAT: modül kökünde `return` geçersiz olduğu için sondalar gövdesini
 * `main()` içine alır ve `return endProbe(kod)` der; çağrıdan sonraki kod
 * çalışmasın diye akış orada biter.
 */
export const endProbe = (code) => {
  setTimeout(() => process.exit(code), 150);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * CDP ucuna bağlanmayı `timeoutMs` boyunca dener.
 * Uygulama henüz açılmamış olabilir; hemen pes etmek yanlış olur.
 * @returns bağlantı ya da süre dolduysa `null`
 */
export const waitForCdp = async (url, timeoutMs = 180_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await chromium.connectOverCDP(url);
    } catch {
      /* henüz hazır değil */
    }
    if (Date.now() > deadline) return null;
    console.log('uygulama bekleniyor…');
    await sleep(3000);
  }
};

/** Bağlanılan tarayıcıda UYGULAMA penceresini bulur (devtools/about:blank hariç). */
export const findAppPage = (browser) => {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      const url = page.url();
      if (url.startsWith('devtools://') || url === 'about:blank') continue;
      if (url.startsWith('http://localhost:5173') || url.includes('tauri')) return page;
    }
  }
  return null;
};
