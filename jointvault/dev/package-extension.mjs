/*
 * Eklentiyi Chrome Web Store'a yüklenecek ZIP olarak paketler.
 * Windows hedefli: Compress-Archive kullanır (ek bağımlılık yok).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = path.join(root, 'extension');
const outDir = path.join(root, 'dev', 'out');

const manifest = JSON.parse(readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const version = manifest.version ?? '0.0.0';
const zipPath = path.join(outDir, `jointvault-collector-${version}.zip`);

mkdirSync(outDir, { recursive: true });

const result = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path "${extensionDir}\\*" -DestinationPath "${zipPath}" -Force`,
  ],
  { stdio: 'inherit' },
);

if (result.status !== 0) {
  console.error('Eklenti paketlenemedi. Windows PowerShell gerekli.');
  process.exit(result.status ?? 1);
}

console.log(`Hazır: ${zipPath}`);
