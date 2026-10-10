/*
 * design.json mojibake onarımı — KURU ÇALIŞTIRMA varsayılan.
 *
 * Sorun: kayıt çift kodlanmış. UTF-8 baytları CP1252 gibi okunup yeniden UTF-8
 * yazılmış ("Gece Okuma OdasÄ±" ← "Gece Okuma Odası"). U+FFFD sayısı 0 olduğu için
 * bayt kaybı yok; çevrim tamamen geri alınabilir.
 *
 * Yöntem: her karakteri CP1252 baytına geri çevir, sonra UTF-8 çöz. Kararı
 * cevrimin kendisi verir — sonuç geçerli UTF-8 ise (U+FFFD yok) dize gerçekten
 * mojibake'ti. Karakter listesiyle kapı tutmak kırılgan: "OdasÄ±" listede olmayan
 * 'Ä' ile başlıyordu ve gözden kaçıyordu.
 *
 *   node dev/fix-design-json.mjs            → rapor (yazmaz)
 *   node dev/fix-design-json.mjs --write    → dosyaya yazar
 *
 * İDEMPOTENT: onarılmış dosyada ikinci çalıştırma 0 değişiklik bildirir.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = process.argv.find((a) => a.endsWith('.json'));
const WRITE = process.argv.includes('--write');

if (!TARGET) {
  console.error('Kullanım: node dev/fix-design-json.mjs <design.json> [--write]');
  process.exit(2);
}

/* CP1252: 0x80-0x9F aralığı latin1'den farklıdır ve mojibake bu karakterleri
   (akıllı tırnak, uzun tire, euro) içerir — latin1 tek başına yetmez. */
const CP1252_HIGH = {
  0x80: '\u20AC', 0x82: '\u201A', 0x83: '\u0192', 0x84: '\u201E', 0x85: '\u2026',
  0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02C6', 0x89: '\u2030', 0x8a: '\u0160',
  0x8b: '\u2039', 0x8c: '\u0152', 0x8e: '\u017D', 0x91: '\u2018', 0x92: '\u2019',
  0x93: '\u201C', 0x94: '\u201D', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
  0x98: '\u02DC', 0x99: '\u2122', 0x9a: '\u0161', 0x9b: '\u203A', 0x9c: '\u0153',
  0x9e: '\u017E', 0x9f: '\u0178',
};

const byteToChar = new Map();
for (let b = 0; b <= 0xff; b += 1) {
  const ch = CP1252_HIGH[b] ?? (b >= 0x80 && b <= 0x9f ? null : String.fromCharCode(b));
  if (ch !== null && !byteToChar.has(ch)) byteToChar.set(ch, b);
}

/*
 * Gerçek mojibake imzası: bir CP1252 karakteri ardından devam baytı aralığı.
 * Çıplak 'â' sayılmaz — "kâğıt" ve "hâlinde" onu meşru biçimde kullanır.
 */
const SIGNATURE = /Ã[\u0080-\u00BF]|Å[\u0080-\u00BF]|Â[\u0080-\u00BF]|â[\u0080-\u00BF]{1,2}/g;

/* kind: 'ascii' | 'changed' | 'already-correct' | 'unmappable' */
function repairString(s) {
  if (!/[^\u0000-\u007F]/.test(s)) return { value: s, kind: 'ascii' };
  const bytes = [];
  for (const ch of s) {
    const b = byteToChar.get(ch);
    /* Türkçe harflerin çoğu (ş ı ğ İ) CP1252'de yoktur; bu, dizenin zaten doğru
       kodlanmış olduğunun işaretidir — hasar değil. */
    if (b === undefined) return { value: s, kind: 'unmappable' };
    bytes.push(b);
  }
  const reversed = Buffer.from(bytes).toString('utf8');
  if (reversed.includes('\uFFFD') || reversed === s) return { value: s, kind: 'already-correct' };
  return { value: reversed, kind: 'changed' };
}

function walk(node) {
  if (typeof node === 'string') return repairString(node).value;
  if (Array.isArray(node)) return node.map(walk);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = walk(v);
    return out;
  }
  return node;
}

const original = readFileSync(TARGET, 'utf8');
const data = JSON.parse(original);

const counts = { ascii: 0, changed: 0, 'already-correct': 0, unmappable: 0 };
(function tally(node) {
  if (typeof node === 'string') {
    counts[repairString(node).kind] += 1;
    return;
  }
  if (Array.isArray(node)) return node.forEach(tally);
  if (node && typeof node === 'object') return Object.values(node).forEach(tally);
})(data);

const samples = [];
for (const [label, val] of [
  ['northStar', data.narrative?.northStar],
  ['colorMeta.graphite-rail.purpose', data.extensions?.colorMeta?.['graphite-rail']?.purpose],
  ['overview[0..70]', (data.narrative?.overview ?? '').slice(0, 70)],
]) {
  if (typeof val !== 'string') continue;
  const r = repairString(val);
  samples.push(`   ${label}\n      önce : ${val}\n      sonra: ${r.value}${r.kind === 'changed' ? '   ← değişti' : '   (zaten doğru)'}`);
}

const after = JSON.stringify(walk(data), null, 2);
const signaturesBefore = (original.match(SIGNATURE) ?? []).length;
const signaturesAfter = (after.match(SIGNATURE) ?? []).length;

console.log(`hedef            : ${TARGET}`);
console.log(`karakter          : ${original.length} -> ${after.length}`);
console.log(`değişen alan      : ${counts.changed}`);
console.log(`zaten doğru       : ${counts['already-correct']}`);
console.log(`eşlenemez (bilgi) : ${counts.unmappable}   (Türkçe harfler CP1252'de yok — hasar değil)`);
console.log(`ascii             : ${counts.ascii}`);
console.log(`imza önce/sonra   : ${signaturesBefore} -> ${signaturesAfter}`);
console.log(`\n--- örnekler ---\n${samples.join('\n')}`);

if (WRITE) {
  if (counts.changed === 0) {
    console.log('\nDeğişiklik yok — yazılmadı (zaten temiz).');
  } else {
    writeFileSync(TARGET, after, 'utf8');
    console.log(`\nYAZILDI (${counts.changed} alan onarıldı).`);
  }
} else {
  console.log('\nKURU ÇALIŞTIRMA (yazmadı). --write ile yaz.');
}
