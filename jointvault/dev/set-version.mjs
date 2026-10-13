/*
 * Sürümün TEK kaynağı `package.json`'dır (bkz. `docs/product-roadmap.md`, Faz 18).
 *
 * `node dev/set-version.mjs 1.0.0` üç dosyayı aynı sürümde buluşturur: paket
 * adı, kurulum dosyası adı ve `Cargo.toml` sürümü. Sürümü elle düzenlemek
 * yerine bunu çalıştır — "kurulum 1.0.0 ama exe 0.1.0" gibi bir kayma olamaz.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const write = (p, v) => writeFileSync(new URL(p, root), v);

const version = process.argv[2] ?? '';
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Kullanım: node dev/set-version.mjs <major.minor.patch>');
  process.exit(1);
}

/*
 * Yalnızca sürüm satırı değiştirilir (JSON.parse + stringify dizileri yeniden
 * biçimlendirip ilgisiz diff üretirdi). Dosya yine de parse edilir: geçersiz
 * JSON'a sürüm yazıp bozmak yerine burada dururuz.
 */
const setJsonVersion = (file) => {
  const text = read(file);
  const parsed = JSON.parse(text);
  if (typeof parsed.version !== 'string') {
    console.error(`${file}: "version" alanı yok.`);
    process.exit(1);
  }
  const line = /^  "version": "[^"]*"(,?)$/m;
  if (!line.test(text)) {
    console.error(`${file}: sürüm satırı beklenen biçimde bulunamadı.`);
    process.exit(1);
  }
  write(file, text.replace(line, `  "version": "${version}"$1`));
};

setJsonVersion('package.json');
setJsonVersion('src-tauri/tauri.conf.json');
// Eklenti aynı kurulum paketiyle dağıtılır; chrome://extensions'ta farklı bir
// sürüm görmek kafa karıştırır.
setJsonVersion('extension/manifest.json');

// Cargo.toml: `[package]` bölümünün sürümü = satır başındaki İLK `version = "..."`.
// (Bağımlılık sürümleri `{ version = ... }` içinde, satır başında değil.)
const cargo = read('src-tauri/Cargo.toml');
if (!/^version = "[^"]*"$/m.test(cargo)) {
  console.error('Cargo.toml: [package] version satırı bulunamadı.');
  process.exit(1);
}
write('src-tauri/Cargo.toml', cargo.replace(/^version = "[^"]*"$/m, `version = "${version}"`));

console.log(
  `Sürüm ${version} yazıldı → package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, extension/manifest.json`,
);
