/*
 * Motor arşivi sondası — üretim kodu DEĞİL.
 *
 * NE KANITLAR: kayıtta (`components.rs`) yazan `wanted` dosya listelerinin
 * GERÇEK arşiv içeriğiyle uyuştuğunu. Bu, 7c-3'ün devrettiği doğrulanmamış
 * maddedir: AI motorunun DLL listesi llama.cpp'nın yayın yapılandırmasından
 * TÜRETİLMİŞTİ, arşivden numaralandırılmamıştı. Liste eksikse kurulum sessizce
 * yarım kalır ve `llama-server.exe` başlamaz.
 *
 * NASIL UCUZ KALIYOR: 242 MB + 373 MB arşivi indirmek yerine ZIP'in merkezi
 * dizini (central directory) HTTP **aralık isteğiyle** okunur. Merkezi dizin
 * arşivin sonundadır ve tüm dosya adlarını taşır; yani ~60 KB ile tam liste
 * alınır. (Aralık desteği doğrulandı: GitHub asset'leri HTTP 206 döner.)
 *
 *   node dev/verify-engine-archive.mjs
 *   node dev/verify-engine-archive.mjs --all   # indirilebilir TÜM zip'leri de sınar
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEV_DIR, endProbe } from './lib/browser.mjs';

/* --- ZIP merkezi dizini: arşivin sonundan tüm dosya adlarını oku ------------ */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;

/*
 * Aralık isteği neden `curl` ile? Node'un `fetch`i (undici) bu asset'lerde
 * `Range` gönderince HTTP 501 dönüyor; aynı istek `curl` ile 206 dönüyor.
 * Kanıtlanmış yolu kullanıyoruz — sonda "çalıştığını sandığı" bir şeyi
 * raporlamamalı.
 */
const TMP = join(tmpdir(), `jv-archive-${Date.now()}`);
const runCurl = (args) => execFileSync('curl.exe', args, { maxBuffer: 16 * 1024 * 1024 });

const fetchRange = (url, range, outName) => {
  mkdirSync(TMP, { recursive: true });
  const headersPath = join(TMP, `${outName}.headers`);
  const bodyPath = join(TMP, `${outName}.bin`);
  runCurl(['-sL', '-r', range, '-D', headersPath, '-o', bodyPath, url]);
  const headers = readFileSync(headersPath, 'utf8');
  const body = readFileSync(bodyPath);
  if (body.length === 0) throw new Error(`aralık isteği boş döndü: ${range}`);
  const cr = headers.match(/content-range:\s*bytes\s+(\d+)-(\d+)\/(\d+)/i);
  return { body, total: cr ? Number(cr[3]) : null };
};

/*
 * Boyut neden ayrı soruluyor? GitHub asset sunucusu SUFFIX aralığını
 * (`Range: bytes=-66000`) desteklemiyor — 501 döner. Bu yüzden önce `0-0` ile
 * toplam boyut öğrenilir, sonra MUTLAK aralıkla kuyruk okunur.
 */
const archiveSize = (url) => {
  const { total } = fetchRange(url, '0-0', 'size');
  if (!total) throw new Error('toplam boyut okunamadı (Content-Range yok)');
  return total;
};

/** Merkezi dizini okuyup dosya adlarını döndür (arşivi indirmeden). */
const listZipEntries = async (url) => {
  const size = archiveSize(url);
  const tailLen = Math.min(size, 66_000);
  const tail = fetchRange(url, `${size - tailLen}-${size - 1}`, 'tail').body;

  // EOCD arşivin sonundadır (yorum alanı yüzünden geriye doğru taranır).
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('EOCD bulunamadı (zip değil mi?)');

  const entryCount = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);

  const cd = fetchRange(url, `${cdOffset}-${cdOffset + cdSize - 1}`, 'cd').body;

  const names = [];
  let p = 0;
  for (let i = 0; i < entryCount; i += 1) {
    if (cd.readUInt32LE(p) !== CD_SIG) break;
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    names.push(cd.subarray(p + 46, p + 46 + nameLen).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { size, names };
};

const basename = (name) => name.replace(/\\/g, '/').split('/').pop();

/* --- Kayıttan zip spec'lerini çıkar (kaynak: components.rs) ---------------- */

const COMPONENTS_RS = resolve(DEV_DIR, '../src-tauri/src/components.rs');

/*
 * Kayıt tek dosyada ve düzenli, ama değerler SABİTLERDEN gelir
 * (`url: FFMPEG_TOOLS_URL`, `wanted: FFMPEG_TOOLS_WANTED`). Bu yüzden önce sabit
 * haritası kurulur, sonra her `DownloadSpec { ... }` bloğu dengeli parantezle
 * çıkarılıp değerler çözülür. Böylece sonda kayıtla AYNI kaynaktan beslenir;
 * ikinci bir elle-kopyalanmış liste tutulmaz.
 */
const parseSpecs = (source) => {
  const consts = new Map();
  for (const m of source.matchAll(/const\s+(\w+)\s*:\s*&str\s*=\s*"([^"]+)"/g)) {
    consts.set(m[1], m[2]);
  }
  /*
   * Dizi sabitleri: içinde HEM string literal HEM başka sabit adı olabilir
   * (`&[WHISPER_ENGINE_ARCHIVE_EXE, "whisper.dll", ...]`). İkisi de çözülmezse
   * sonda gerçek listeyi eksik sayar ve yanlış bir kırmızı üretir — ki bir kez
   * tam olarak bunu yaptı (whisper 5 yerine 4 göründü).
   */
  const resolveArrayItem = (raw) => {
    const v = raw.trim().replace(/,$/, '');
    if (v.startsWith('"')) return v.replace(/"/g, '');
    return consts.get(v);
  };
  // Dizilerde virgül YALNIZCA ayraçtır (adlar virgül içermez) → düz bölme doğru.
  const parseArrayBody = (body) =>
    body
      .split(',')
      .map(resolveArrayItem)
      .filter((x) => typeof x === 'string' && x.length > 0);

  for (const m of source.matchAll(/const\s+(\w+)\s*:\s*&\[&str\]\s*=\s*&\[([\s\S]*?)\]/g)) {
    consts.set(m[1], parseArrayBody(m[2]));
  }

  const resolveValue = (raw) => {
    const v = raw.trim().replace(/,$/, '');
    if (v.startsWith('"')) return v.replace(/"/g, '');
    if (v.startsWith('&[')) return parseArrayBody(v.replace(/^&\[|\]$/g, ''));
    return consts.get(v);
  };

  const specs = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf('DownloadSpec {', from);
    if (start < 0) break;
    // Dengeli parantezle bloğun sonunu bul (içinde `PayloadRule::Zip { .. }` var).
    let depth = 0;
    let end = start;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const block = source.slice(start, end + 1);
    from = end + 1;

    const urlMatch = block.match(/url:\s*([^,\n]+)/);
    const wantedMatch = block.match(/wanted:\s*([^,\n]+)/);
    const url = urlMatch ? resolveValue(urlMatch[1]) : undefined;
    const wanted = wantedMatch ? resolveValue(wantedMatch[1]) : undefined;
    if (typeof url === 'string') {
      specs.push({ url, wanted: Array.isArray(wanted) ? wanted : null });
    }
  }
  return specs;
};

const main = async () => {
  const all = process.argv.includes('--all');
  const source = readFileSync(COMPONENTS_RS, 'utf8');
  const specs = parseSpecs(source).filter((s) => all || s.wanted !== null);

  if (specs.length === 0) {
    console.error('Kayıttan zip spec okunamadı (components.rs deseni değişmiş olabilir).');
    return endProbe(2);
  }

  const results = [];
  const report = (label, ok, detail) => {
    results.push({ label, ok, detail: detail ?? null });
    console.log(`${ok ? 'GEÇTİ' : 'KALDI'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };

  for (const spec of specs) {
    const label = spec.url.split('/').pop();
    let listed;
    try {
      listed = await listZipEntries(spec.url);
    } catch (error) {
      report(`${label}: arşiv listesi okundu`, false, String(error?.message ?? error));
      continue;
    }

    const baseNames = listed.names.map(basename);
    report(
      `${label}: arşiv listesi aralık isteğiyle okundu (indirme yok)`,
      baseNames.length > 0,
      `${baseNames.length} girdi · ${(listed.size / 1024 / 1024).toFixed(1)} MB arşiv`,
    );

    if (!spec.wanted) continue;

    const lower = baseNames.map((n) => n.toLowerCase());
    const missing = spec.wanted.filter((w) => !lower.includes(w.toLowerCase()));
    report(
      `${label}: kayıttaki ${spec.wanted.length} dosyanın HEPSİ arşivde var`,
      missing.length === 0,
      missing.length === 0 ? spec.wanted.join(', ') : `EKSİK: ${missing.join(', ')}`,
    );

    // Bilgi: arşivde olup listeye alınmayan adaylar (eksik listeyi görmeyi kolaylaştırır).
    const unused = baseNames.filter(
      (n) => !spec.wanted.some((w) => w.toLowerCase() === n.toLowerCase()),
    );
    console.log(
      `     listeye alınmayanlar (${unused.length}): ${unused.slice(0, 12).join(', ')}${unused.length > 12 ? ' …' : ''}`,
    );
    /*
     * ASIL RİSK ters yöndür: `wanted` listesinde olmayan ama çalışma zamanında
     * GEREKEN bir DLL. Elle seçilmiş liste sessizce yarım kurulum üretir. Bu
     * yüzden arşivdeki .dll'ler ayrıca uyarı olarak sayılır (--verbose ile tam liste).
     */
    if (process.argv.includes('--verbose')) {
      console.log(`     ARŞİVDEKİ TÜM GİRDİLER (${baseNames.length}):`);
      for (const n of baseNames) console.log(`       ${n}`);
    } else {
      const dllsNotWanted = unused.filter((n) => n.toLowerCase().endsWith('.dll'));
      if (dllsNotWanted.length > 0) {
        console.log(
          `     DİKKAT: arşivde olup listeye alınmayan ${dllsNotWanted.length} DLL var (çalışma zamanında gerekebilir): ${dllsNotWanted.join(', ')}`,
        );
      }
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nSONUÇ: ${failed === 0 ? 'tüm kontroller GEÇTİ' : `${failed} kontrol KALDI`}`);
  return endProbe(failed === 0 ? 0 : 1);
};

await main();
