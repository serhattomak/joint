/*
 * İzin sondası — üretim kodu DEĞİL.
 *
 * NE KANITLAR: pano okuma/yazma ve `open_path` izinlerinin ÇALIŞMA ANINDA açık
 * olduğunu. Yapılandırma doğru görünse bile (bkz. gen/schemas/capabilities.json)
 * son kararı çalışan uygulama verir; bu betik ona sorar.
 *
 * YIKICI DEĞİL:
 *   - panoya yazdığı değer, az önce OKUDUĞU değerdir; pano içeriği değişmez.
 *   - `open_path`'e var olmayan bir yol verilir; hiçbir uygulama açılmaz.
 *
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev        # pencere açıldıktan sonra:
 *   node dev/verify-permissions.mjs
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { OUT_DIR, ensureOutDir, exitWithoutClosingApp } from './lib/browser.mjs';

const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';
const WAIT_MS = 180_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      return await chromium.connectOverCDP(CDP);
    } catch (error) {
      if (Date.now() > deadline) {
        console.error(
          `\nWebView2 hata ayıklama portuna bağlanılamadı (${CDP}).\n` +
            `  ${error.message}\n\n` +
            'Sırayla:\n' +
            '  1) Çalışan JointVault penceresini kapat (eski süreç portu tutmaz).\n' +
            '  2) $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"\n' +
            '  3) npx tauri dev\n' +
            '  4) Pencere açıldıktan sonra bu betiği tekrar çalıştır.',
        );
        process.exit(2);
      }
      console.log('uygulama bekleniyor…');
      await sleep(3000);
    }
  }
}

const browser = await connect();

let page = null;
for (const ctx of browser.contexts()) {
  for (const p of ctx.pages()) {
    const url = p.url();
    if (url.startsWith('devtools://') || url === 'about:blank') continue;
    if (url.startsWith('http://localhost:5173') || url.includes('tauri')) {
      page = p;
      break;
    }
  }
  if (page) break;
}
if (!page) {
  console.error('Uygulama penceresi bulunamadı.');
  exitWithoutClosingApp(2);
}
console.log(`bağlandı: ${page.url()}`);
await page.waitForLoadState('load');
await sleep(1000);

const probe = await page.evaluate(async () => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) return { bridge: false };

  const attempt = async (cmd, args) => {
    try {
      return { ok: true, value: await invoke(cmd, args) };
    } catch (error) {
      return {
        ok: false,
        error: typeof error === 'string' ? error : (error?.message ?? String(error)),
      };
    }
  };

  const read = await attempt('plugin:clipboard-manager|read_text');
  /* Panoya yazılan değer okunan değerdir → içerik değişmez. */
  const write = read.ok
    ? await attempt('plugin:clipboard-manager|write_text', { text: read.value })
    : { ok: null, skipped: 'okuma başarısız; yazma denenmedi' };
  const openMissing = await attempt('plugin:opener|open_path', {
    path: 'C:/__jointvault-izin-sondasi-yok__/yok.txt',
  });

  return { bridge: true, read, write, openMissing };
});

const DENIED = /not allowed|Permissions associated|forbidden|not permitted/i;
const verdict = (result) => {
  if (result?.ok === true) return 'İZİN VAR';
  if (result?.ok === false) return DENIED.test(result.error) ? 'İZİN YOK (reddedildi)' : 'izin var (çağrı hatası)';
  return 'DENENMEDİ';
};

const lines = [];
const report = (label, result) => {
  const v = verdict(result);
  lines.push(`${label}: ${v}`);
  if (result?.error) lines.push(`    hata: ${result.error.slice(0, 300)}`);
  console.log(`${label}: ${v}`);
  if (result?.error) console.log(`    hata: ${result.error.slice(0, 300)}`);
};

if (!probe.bridge) {
  console.error('Tauri köprüsü bulunamadı — doğru pencereye bağlanıldığından emin ol.');
  exitWithoutClosingApp(2);
}

console.log('');
report('pano okuma (allow-read-text)', probe.read);
report('pano yazma (allow-write-text)', probe.write);
report('open_path (allow-open-path)', probe.openMissing);

ensureOutDir();
const manifest = {
  kind: 'runtime-probe',
  synthetic: false,
  note: 'Çalışan uygulamada izin sondası. Yıkıcı değil: panoya okunan değer geri yazıldı, open_path var olmayan yola çağrıldı.',
  capturedAt: new Date().toISOString(),
  appUrl: page.url(),
  probe,
  verdicts: lines,
};
writeFileSync(resolve(OUT_DIR, 'permissions-probe.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log('\nprovenance: permissions-probe.json');

/* `browser.close()` YOK: bağlanılan tarayıcıda uygulama penceresini kapatır. */
const denied = [probe.read, probe.write, probe.openMissing].filter(
  (r) => r?.ok === false && DENIED.test(r.error),
);
if (denied.length > 0) {
  console.error(`\n${denied.length} izin REDDEDİLDİ — Faz 2 kapanamaz.`);
  exitWithoutClosingApp(1);
} else {
  console.log('\nizinlerin üçü de çalışma anında açık.');
  exitWithoutClosingApp(0);
}
