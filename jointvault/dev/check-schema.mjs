/*
 * Şema başlatma kontrolü — üretim kodu DEĞİL.
 *
 * initDb()'nin gerçek yolunu koşar: yorum satırlarını düşür, ';' ile böl, her
 * parçayı SQLite'a ver. Amaç, şema hatasının UYGULAMADA değil burada patlaması.
 *
 * Neden gerekli: bir `--` yorumunun içindeki ';' parçayı ortadan kesip artık
 * satırı yorum olmaktan çıkarıyor ve sözdizimi hatası veriyordu. initDb patlayınca
 * getDb() reddediyor ve uygulama hiçbir kaydı göstermiyor. Derleme bunu göremez
 * (`schema.sql?raw` sadece metin) ve bench şemayı tek `exec` ile çalıştırdığı için
 * bölme yolunu hiç görmüyordu.
 *
 *   node dev/check-schema.mjs
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = new URL('../src/lib/db/schema.sql', import.meta.url);

/* initDb() ile aynı iki satır. Kasıtlı olarak kopya: client.ts Tauri SQL
   eklentisini içe aktardığı için Node'da doğrudan çalıştırılamıyor. */
const stripCommentLines = (sql) => sql.replace(/^[ \t]*--[^\n]*$/gm, '');

const raw = readFileSync(SCHEMA, 'utf8');
const statements = stripCommentLines(raw)
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

const db = new DatabaseSync(':memory:');
const failures = [];

statements.forEach((sql, i) => {
  try {
    db.exec(sql);
  } catch (e) {
    failures.push({ index: i + 1, sql, message: e.message });
  }
});

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);
const indexes = db
  .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
  .all()
  .map((r) => r.name);

console.log(`parça           : ${statements.length}`);
console.log(`tablo           : ${tables.length}  ${tables.join(', ')}`);
console.log(`idx_ indeksi    : ${indexes.length}  ${indexes.join(', ')}`);

/* Ham bölme hâlâ bozuluyor mu — düzeltmenin gerçekten bir şey yaptığının kanıtı. */
let rawWouldFail = false;
try {
  const probe = new DatabaseSync(':memory:');
  for (const s of raw.split(';').map((x) => x.trim()).filter(Boolean)) probe.exec(s);
} catch {
  rawWouldFail = true;
}
console.log(`ham bölme       : ${rawWouldFail ? 'bozuluyor (yorum düşürme gerekli)' : 'bozulmuyor'}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} parça PATLADI:\n`);
  for (const f of failures) {
    console.error(`--- ${f.index}. parça: ${f.message}`);
    console.error(f.sql.split('\n').map((l) => `    | ${l}`).join('\n'));
    console.error('');
  }
  process.exit(1);
}

console.log('\ninitDb yolu temiz — şema başlatmada hata yok.');
