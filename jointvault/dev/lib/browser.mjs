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
