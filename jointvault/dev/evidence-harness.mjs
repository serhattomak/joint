/*
 * Sentetik kanıt turu — üretim kodu DEĞİL.
 *
 * NE KANITLAR: bileşen sözleşmeleri (select çözümü, damga sözlüğü, diyalog
 *   katmanları) ve kabuk/kütüphane düzeni.
 * NE KANITLAMAZ: gerçek arşiv verisiyle çalıştığını. Bu tur sentetik veriyle
 *   koşar; üretilen manifest `synthetic: true` taşır. Gerçek kayıtlarla kanıt
 *   ayrı bir iştir (bkz. dev/RECAPTURE.md → `npm run evidence:live`).
 *
 * Dev sunucusunu kendisi ayağa kaldırır, sırayla betikleri koşar, kapatır.
 * Sunucu zaten çalışıyorsa ona dokunmaz (dev/lib/dev-server.mjs kuralı).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_URL, OUT_DIR, PROJECT_ROOT, ensureOutDir } from './lib/browser.mjs';
import { startDevServer, stopDevServer } from './lib/dev-server.mjs';

const STEPS = ['verify-controls.mjs', 'shoot.mjs'];

const runStep = (script) => {
  console.log(`\n=== ${script} ===`);
  const result = spawnSync('node', [resolve(PROJECT_ROOT, 'dev', script)], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });
  return result.status ?? 1;
};

const writeManifest = (steps) => {
  const artifacts = readdirSync(ensureOutDir(), { recursive: true })
    .map((entry) => String(entry).replace(/\\/g, '/'))
    .filter((entry) => entry.endsWith('.png') || entry.endsWith('.json'))
    .sort();

  const manifest = {
    kind: 'harness',
    synthetic: true,
    note: 'Sentetik bileşen/kabuk kanıtı. Gerçek arşiv verisiyle çalıştığını KANITLAMAZ.',
    capturedAt: new Date().toISOString(),
    appUrl: APP_URL,
    steps,
    artifacts,
  };

  writeFileSync(resolve(OUT_DIR, 'harness-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\nmanifest: harness-manifest.json (${artifacts.length} dosya)`);
};

let server = null;
try {
  server = await startDevServer(PROJECT_ROOT, APP_URL);
  const steps = STEPS.map((script) => ({ script, exitCode: runStep(script) }));
  writeManifest(steps);

  const failed = steps.filter((step) => step.exitCode !== 0);
  if (failed.length > 0) {
    console.error(`\nBAŞARISIZ adım: ${failed.map((s) => s.script).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nsentetik kanıt turu temiz.');
  }
} catch (error) {
  console.error(`\nkanıt turu koşulamadı: ${error.message}`);
  process.exitCode = 1;
} finally {
  stopDevServer(server);
}
