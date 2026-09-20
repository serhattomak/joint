/*
 * Temiz profil yardımcıları — üretim kodu DEĞİL, sondaların ortak kalbi.
 *
 * NEDEN VAR: `component_download` gibi komutlar bileşen ZATEN ÇÖZÜLÜYORSA kısa
 * yoldan başarı döner; `resolve()` ise önce `components/`e, sonra uygulamanın
 * yanındaki gömülü sidecar'a bakar. Normal bir geliştirme makinesinde gömülü dosya
 * HEP vardır; bu yüzden "eksik bileşen"/"gerçek indirme" yolu asla çalışmaz ve
 * sonda hiçbir şey kanıtlamaz. Çözüm: sonda başında, çözümlemeyi GÖLGELEYEBİLECEK
 * her dosya geçici bir yedeğe TAŞINIR (SİLİNMEZ). Böylece `resolve()` boş döner.
 *
 * NEDEN ORTAK MODÜL: `verify-component-download.mjs` ve `verify-missing-component.mjs`
 * aynı tehlikeli dosya-taşıma mantığını iki kez yazarsa, gün gelir biri düzeltilir,
 * diğeri unutulur ve gerçek kullanıcı dosyaları yanlış yere taşınır. Bu yüzden
 * plan → yedekle (çökme güvenli manifest) → test artıklarını sil → geri koy dizisi
 * TEK yerde yaşar; her iki sonda da buradan içe aktarır.
 *
 * GÜVENLİK KURALLARI (değiştirilmemeli):
 *   - Asıl dosyalar SİLİNMEZ, taşınır. (Silinen yalnızca sondayı koşan sürecin
 *     kendi ürettiği test artıklarıdır — `removeTestArtifacts`.)
 *   - Geri koyarken hedef yol doluysa ÜZERİNE YAZILMAZ; gürültülü hata verilir.
 *   - Windows'ta `rename` yalnızca aynı birimde çalışır (bileşenler klasörü C:,
 *     depo D: olabilir) → kopyala-doğrula-sil'e düşülür.
 *   - Her taşımadan sonra `manifest.json` yazılır: süreç çökse bile ne kaldığı
 *     manifest'ten okunur (sessiz veri kaybı kabul edilemez).
 */
import {
  constants as FS_CONSTANTS,
  copyFileSync,
  existsSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { OUT_DIR, PROJECT_ROOT } from './browser.mjs';

/* --- sabitler -------------------------------------------------------------- */

// Bileşenler klasöründe `resolve()` tam olarak bu adları arar (`downloaded_file`).
export const COMPONENT_SHADOW_NAMES = ['ffmpeg.exe', 'ffprobe.exe'];

// Gömülü sidecar taraması `bundled_path` mantığını BİREBİR yansıtır: düz ad ya da
// `<ad>-<hedef-üçlü>.exe`. Elle liste tutmak, bir gün eklenen bir varyantı kaçırır.
export const BUNDLED_BASES = ['ffmpeg', 'ffprobe'];

// Varsayılan geçici çıktı klasörü: eski `verify-component-download` bunu kullanır.
// Temizlikte silinir; yalnızca sondanın kendi ürettiği veridir.
const DEFAULT_TMP_DIRS = [resolve(OUT_DIR, 'probe-tmp')];

/* --- saf yardımcılar ------------------------------------------------------- */

export const isBundledShadow = (name) => {
  const lower = name.toLowerCase();
  return BUNDLED_BASES.some(
    (base) => lower === `${base}.exe` || (lower.startsWith(`${base}-`) && lower.endsWith('.exe')),
  );
};

/* --- dosya taşıma (birimler arası güvenli) --------------------------------- */
// Windows'ta `rename` YALNIZCA aynı birimde çalışır; bileşenler klasörü (C:)
// ile depo (D:) farklı birimlerde olabilir. O yüzden kopyala-doğrula-sil'e düşeriz.
export const moveFile = (from, to) => {
  try {
    renameSync(from, to);
    return 'rename';
  } catch (renameError) {
    try {
      copyFileSync(from, to, FS_CONSTANTS.COPYFILE_EXCL);
    } catch (copyError) {
      throw new Error(`taşıma başarısız (${from} → ${to}): ${copyError.message} (rename: ${renameError.message})`);
    }
    if (statSync(to).size !== statSync(from).size) {
      throw new Error(`kopya boyutu uyuşmadı, kaynak korundu: ${from}`);
    }
    rmSync(from, { force: true });
    return 'copy';
  }
};

/* --- exc klasörünü bul ------------------------------------------------------ */
// `current_exe()` derleme moduna göre değişir: `cargo tauri dev` → `target/debug`,
// paket → `target/release`. Sırayla: ortam değişkeni → debug → hedef ağacında ara.
const EXE_NAME_RE = /^(app|jointvault)[^\\/]*\.exe$/i;

const scanForExeDir = (dir, depth, found) => {
  if (depth < 0) return found;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) scanForExeDir(full, depth - 1, found);
    else if (EXE_NAME_RE.test(entry.name)) found.add(dir);
  }
  return found;
};

export const findAppExeDir = () => {
  const override = process.env.JV_APP_EXE_DIR;
  if (override && existsSync(override)) return { dir: override, how: 'JV_APP_EXE_DIR' };
  const debugDir = resolve(PROJECT_ROOT, 'src-tauri/target/debug');
  if (existsSync(debugDir)) return { dir: debugDir, how: 'target/debug' };
  const found = [...scanForExeDir(resolve(PROJECT_ROOT, 'src-tauri/target'), 3, new Set())];
  if (found[0]) return { dir: found[0], how: 'target taraması' };
  return { dir: debugDir, how: 'varsayılan (exe bulunamadı)' };
};

/* --- plan + yedek + geri koy ------------------------------------------------ */

/**
 * Yedeklenecek gölge dosyaları topla. `extra`, standart iki kaynağın (exe yanı +
 * `components/`) yanına ek gölgeler koyar — ör. yt-dlp'nin `<indirme>/.tools`
 * altındaki DÜZ-adlı ffmpeg/ffprobe kopyaları: bunlar `ensure_ffmpeg_tools`
 * kısa yolunu tatmin eder ve kayıt boş olsa bile "eksik" durumunu maskeler.
 * Yalnızca var olan yollar plana girer (olmayanı taşımaya çalışmak hata olurdu).
 */
export const planShadows = ({ exeDir, componentsDir, extra = [] }) => {
  const plan = [];
  let exeNames = [];
  try {
    exeNames = readdirSync(exeDir);
  } catch (error) {
    console.error(`exe klasörü okunamadı (${exeDir}): ${error.message}`);
  }
  for (const name of exeNames) {
    if (isBundledShadow(name)) plan.push({ from: join(exeDir, name), kind: 'exe' });
  }
  for (const name of COMPONENT_SHADOW_NAMES) {
    const path = join(componentsDir, name);
    if (existsSync(path)) plan.push({ from: path, kind: 'components' });
  }
  for (const item of extra) {
    if (item?.from && existsSync(item.from)) plan.push({ from: item.from, kind: item.kind ?? 'extra' });
  }
  return plan;
};

export const writeManifest = (backupDir, entries) =>
  writeFileSync(
    join(backupDir, 'manifest.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), entries }, null, 2),
    'utf8',
  );

export const backupShadows = (plan, backupDir) => {
  const entries = [];
  for (const item of plan) {
    const to = join(backupDir, `${item.kind}__${basename(item.from)}`);
    const method = moveFile(item.from, to);
    entries.push({ ...item, to, method });
    // Her taşımadan sonra yaz: süreç çökerse bile ne kaldığı manifest'ten okunur.
    writeManifest(backupDir, entries);
    console.log(`     yedeklendi (${method}): ${item.from} → ${to}`);
  }
  return entries;
};

export const removeTestArtifacts = (componentsDir, pristine) => {
  const removed = [];
  let names = [];
  try {
    names = readdirSync(componentsDir);
  } catch {
    return removed;
  }
  for (const name of names) {
    // Yedeklenmiş olsun olmasın: temiz profilde kalan her ffmpeg/ffprobe testindir.
    const testShadow = COMPONENT_SHADOW_NAMES.includes(name);
    const testPart = name.endsWith('.part') && !pristine.has(name);
    if (testShadow || testPart) {
      rmSync(join(componentsDir, name), { force: true });
      removed.push(name);
    }
  }
  return removed;
};

export const restoreShadows = (entries) => {
  const out = [];
  for (const entry of entries) {
    if (!existsSync(entry.to)) {
      out.push({ ...entry, restored: false, reason: 'yedek dosyası yok' });
      continue;
    }
    if (existsSync(entry.from)) {
      out.push({ ...entry, restored: false, reason: 'hedef yol beklenmedik biçimde dolu' });
      continue;
    }
    try {
      const method = moveFile(entry.to, entry.from);
      out.push({ ...entry, restored: true, method, reason: null });
    } catch (error) {
      out.push({ ...entry, restored: false, reason: String(error?.message ?? error) });
    }
  }
  return out;
};

/**
 * İdempotent: test artıklarını siler, sonra yedekleri ESKİ YERİNE koyar.
 * `finally` içinden çağrılır; geri yüklenemeyen her yedek GÜRÜLTÜLÜ bildirilir.
 * `tmpDirs` yalnızca sondayı koşan sürecin ürettiği geçici klasörlerdir.
 */
export const cleanupProfile = (ctx, tmpDirs = DEFAULT_TMP_DIRS) => {
  const { state, report, errors } = ctx;
  if (state.cleaned) return;
  state.cleaned = true;

  if (state.componentsDir) {
    state.removed = removeTestArtifacts(state.componentsDir, state.pristine);
    if (state.removed.length > 0) {
      console.log(`     test artıkları silindi (bileşenler klasörü): ${state.removed.join(', ')}`);
    }
  }
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });

  const restored = restoreShadows(state.backupEntries);
  state.restoreReport = { restored, removedTestArtifacts: state.removed };
  const failed = restored.filter((entry) => !entry.restored);
  if (failed.length === 0) {
    report(`geri yükleme: ${restored.length} gölge dosya eski yerine kondu`, true);
    for (const entry of restored) console.log(`     geri kondu: ${entry.from}`);
  } else {
    report(
      'geri yükleme: TÜM gölge dosyalar eski yerine kondu',
      false,
      failed.map((entry) => `${entry.from} (${entry.reason})`).join(' · '),
    );
    for (const entry of failed) {
      const message = `YEDEK GERİ YÜKLENEMEDİ: ${entry.from} — yedek ${entry.to} konumunda duruyor (${entry.reason}). Elle geri taşıyın!`;
      errors.push({ step: 'restore', message });
      console.error(message);
    }
  }
};
