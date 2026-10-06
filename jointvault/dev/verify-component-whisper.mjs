/*
 * Bileşen birleştirme + GERÇEK TRANSKRİPSİYON sondası (Faz 7c-3 → 8a) — üretim
 * kodu DEĞİL.
 *
 * NE KANITLAR:
 *  1. Kayıt/indirilebilirlik: whisper, beş whisper modeli, llama motoru, CUDA
 *     çalışma zamanı, Qwen ve BGE'nin TAMAMI Bileşenler'den indirilebilir;
 *     yt-dlp paketle gömülü kalır ve İNDİRİLEMEZ (tek istisna).
 *  2. TEK YOL (8a): repoda (`src-tauri/binaries/`) gömülü whisper YOKTUR; whisper
 *     yalnızca Bileşenler'den indirilerek çalışır. 7c-3'te gömülü kopya DLL'siz
 *     olduğu için 0xC0000135 ile çöküyordu; tek yol kalınca bu kusur inşa gereği
 *     imkânsız olur. Bu yüzden sonda artık "gömülü whisper kurulu olmalı" gibi bir
 *     DÜNYA HÂLİ varsaymaz (7d dersi): gömülü kopyanın YOKLUĞU doğru durumdur ve
 *     yalnız DEĞİŞMEZ sınanır.
 *  3. MANSET — GERÇEK TRANSKRİPSİYON: arayüzden indirilen motor, ffmpeg ile
 *     üretilen kısa bir ses üzerinde `transcribe`i UÇTAN UCA tamamlar ve bir `.srt`
 *     dosyası üretir. Kanıtlanan: motor ÇALIŞIR ve boru hattı biter (0xC0000135
 *     DLL çökmesi YOKTUR). DİKKAT: ses bir SİNÜS TONUDUR, içinde KONUŞMA YOKTUR;
 *     transkriptin İÇERİĞİ anlamsızdır ve KANIT SAYILMAZ. ffmpeg ya da kurulu
 *     model yoksa bu adım DÜRÜSTÇE atlanır (GEÇTİ değil).
 *  4. Asset satırı: kurulu bir veri dosyası (`.bin`/`.gguf`, cudart DLL kümesi)
 *     "kurulu" gösterir, "çalıştırılamıyor" DEĞİL; ve bir daha indirmeye
 *     sunulmaz. Kurulu asset yoksa `whisper-model-tiny` (74 MB) ile kurulum
 *     kanıtlanır (--quick/JV_REAL_DOWNLOAD=0 bu indirmeyi atlar → "kanıtlanmadı").
 *  5. Eksik yt-dlp: `list_formats` yapılandırılmış `BILESEN_EKSIK:yt-dlp` +
 *     okunabilir Türkçe ayrıntı döndürür (ham OS hatası yok).
 *  6. Bileşenler ekranı TÜM kaydı çizer: 13 bileşen / 12 paket grubu; gösterilen
 *     boyutlar KAYITTAN gelir (`components.rs` → `components_status` → DOM);
 *     arayüzde sabit sayı yok.
 *
 * NEDEN TEMİZ PROFİL (gölge): `resolve()` önce `components/`e, sonra exe yanındaki
 * gömülü kopyaya bakar. Geliştirme makinesinde indirilmiş whisper ve gömülü
 * `yt-dlp.exe` HEP vardır; gölgelenmezlerse `is_installed` kısa yolu gerçek
 * indirmeyi atlar ve sonda hiçbir şey kanıtlamaz. Gölge mekanizması
 * `dev/lib/clean-profile.mjs`'te TEK yerde yaşar.
 *
 * NEDEN ffmpeg GÖLGELENMEZ: transkript boru hattı GERÇEK ffmpeg ister (16 kHz mono
 * WAV'a çevirme). ffmpeg'i de gölgelersek `transcribe` `BILESEN_EKSIK:ffmpeg` ile
 * durur ve MANŞET kanıtı imkânsız olur. Bu sonda whisper'ın tek yolunu sınadığı
 * için yalnız whisper + yt-dlp gölgelenir, ffmpeg kurulu kalır (7d'den beri zaten
 * repoda gömülü gelmez). Gölgelenmeyen ffmpeg'i temizlik de SİLMEZ: bu yüzden
 * `cleanupProfile`e `componentShadowNames` listesi geçirilir (bkz. clean-profile).
 *
 * GÜVENLİK: sonda yalnızca kendi ürettiği test artıklarını (geçici ses/`.srt`,
 * indirdiği model) siler; kullanıcı dosyalarına dokunmaz.
 *
 * Kullanım:
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev            # pencere açıldıktan sonra:
 *   npm run verify:component-whisper               # ~4 MB motor GERÇEKTEN kurulur
 *   npm run verify:component-whisper -- --quick    # ~74 MB model indirmesini atlar
 *
 * Bayraklar / ortam değişkenleri:
 *   --quick                model (asset) indirmesini atlar; ~4 MB motor YİNE kurulur
 *   JV_REAL_DOWNLOAD=0     TÜM gerçek indirmeleri atlar (motor dâhil); transkript
 *                          adımı da dürüstçe atlanır (motor kurulu olmaz)
 *   JV_REAL_DOWNLOAD=1     model indirmesini zorla (--quick'i geçersiz kılar)
 *   --with-regressions      sondadan SONRA 3 regresyon komutunu koşar
 *   JV_CDP / JV_APP_EXE_DIR / JV_OUT   diğer sondalarla aynı
 *
 * Transkript adımı GERÇEK ffmpeg + diskte kurulu bir whisper modeli ister; ikisi
 * de yoksa "atlandı/kanıtlanmadı" yazılır (KALDI değil).
 *
 * Çıkış kodları: 0 tümü geçti · 1 kalan kontrol/hata · 2 uygulama kapalı.
 * Atlanan kontrol "GEÇTİ" SAYILMAZ; `skips` listesinde raporlanır.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  OUT_DIR,
  PROJECT_ROOT,
  endProbe,
  ensureOutDir,
  findAppPage,
  waitForCdp,
} from './lib/browser.mjs';
import {
  backupShadows,
  cleanupProfile,
  findAppExeDir,
  isBundledShadow,
  planShadows,
  writeManifest,
} from './lib/clean-profile.mjs';

const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';
const COMPONENTS_RS = resolve(PROJECT_ROOT, 'src-tauri/src/components.rs');
// 8a değişmezi: paketleme kaynağı. Burada whisper izi OLMAMALI (tek yol: indirme).
// `target/` bir inşa çıktısıdır (dünya hâli) ama `binaries/` kaynak ağacıdır →
// burada sınanabilir bir değişmezdir.
const BINARIES_DIR = resolve(PROJECT_ROOT, 'src-tauri/binaries');
// Transkript boru hattı gerçek ffmpeg ister: ffmpeg/ffprobe adları gölge planından
// ÇIKARILIR. Ad eşleştirmesi ortak `isBundledShadow` kuralıyla yapılır (düz ad ya
// da `ffmpeg-<üçlü>.exe`) — elle liste, bir gün eklenen varyantı kaçırırdı.
// Transkript için tercih sırası: diskte OLAN ilk model kullanılır (base dengeli;
// büyük modeller yalnızca son çare — 2 sn'lik ton için gereksiz yavaş olurlar).
const TRANSCRIBE_MODEL_ORDER = ['base', 'tiny', 'small', 'large-v3-q5_0', 'large-v3'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --- mod seçimi ------------------------------------------------------------ */
const argv = new Set(process.argv.slice(2));
const quickFlag = argv.has('--quick') || process.env.JV_QUICK === '1';
const realEnv = (process.env.JV_REAL_DOWNLOAD ?? '').toLowerCase();
const forceReal = ['1', 'true', 'yes', 'on'].includes(realEnv);
const forceSkip = ['0', 'false', 'no', 'off'].includes(realEnv);
// ~4 MB motor: ucuz ve manşet kanıt → varsayılan AÇIK; --quick onu ATLAMAZ,
// yalnızca açık JV_REAL_DOWNLOAD=0 kapatır.
const RUN_ENGINE_INSTALL = forceReal ? true : forceSkip ? false : true;
// ~74 MB model (asset) indirmesi: mevcut desen → --quick atlar.
const RUN_MODEL_INSTALL = forceReal ? true : forceSkip ? false : !quickFlag;
const RUN_REGRESSIONS = argv.has('--with-regressions') || process.env.JV_WITH_REGRESSIONS === '1';

/* --- sabitler -------------------------------------------------------------- */
// Tel formatı üretimde TEK yerde (`components.rs:MISSING_PREFIX`). Sonda,
// sözleşmeyi bağımsız doğrulayabilsin diye literal'i burada ÇİVLER (test sabiti).
const MISSING_PREFIX = 'BILESEN_EKSIK:';
const WHISPER_ID = 'whisper';
const YTDLP_ID = 'yt-dlp';
const WHISPER_LABEL = 'Whisper motoru';
const TINY_ID = 'whisper-model-tiny';
const TINY_LABEL = 'Whisper modeli (tiny)';
const TINY_FILE = 'ggml-tiny.bin';
// `.invalid` TLD (RFC 2606): asla çözülmez. Kapı ağa çıkmadan reddettiği için
// ağ trafiği oluşmaz; yine de yanlışlıkla çıkılsa bile beklemez.
const FAKE_URL = 'https://example.invalid/jointvault-whisper-probe.mp4';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const TMP_DIR_NAME = 'component-whisper-tmp';

const EXPECTED_IDS = [
  'ffmpeg',
  'ffprobe',
  'yt-dlp',
  'whisper',
  'whisper-model-tiny',
  'whisper-model-base',
  'whisper-model-small',
  'whisper-model-large-v3-q5_0',
  'whisper-model-large-v3',
  'llama-engine',
  'llama-cudart',
  'ai-model-llm',
  'ai-model-embed',
];
// yt-dlp DIŞINDA hepsi indirilebilir olmalı (12 satır).
const DOWNLOADABLE_IDS = EXPECTED_IDS.filter((id) => id !== YTDLP_ID);
// 13 bileşen, ffmpeg+ffprobe TEK arşivi paylaşır → arayüzde 12 paket grubu.
const GROUP_COUNT = 12;
// Whisper motorunun arşivden çıkardığı dosyalar (kayıt: `WHISPER_ENGINE_WANTED`).
const WHISPER_ENGINE_FILES = ['whisper.exe', 'whisper.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu.dll'];
// Gölgelenmesi/geri alınması gereken whisper adları (`whisper-cli.exe` arşiv adı).
const WHISPER_ARTIFACT_NAMES = [...WHISPER_ENGINE_FILES, 'whisper-cli.exe'];
const YTDLP_ARTIFACT_NAMES = ['yt-dlp.exe'];
const ALL_ARTIFACT_NAMES = [...WHISPER_ARTIFACT_NAMES, ...YTDLP_ARTIFACT_NAMES];

/* --- saf yardımcılar ------------------------------------------------------- */

const findById = (list, id) => (list ?? []).find((component) => component.id === id) ?? null;

// Kaydın yalnızca sözleşmeye bakan alanları (artifact şişmesin).
const pick = (component) =>
  component
    ? {
        id: component.id,
        label: component.label,
        approx_mb: component.approx_mb,
        kind: component.kind,
        installed: component.installed,
        runnable: component.runnable,
        path: component.path,
        source: component.source,
        version: component.version,
        downloadable: component.downloadable,
        bundle: component.bundle,
        framework: component.framework,
      }
    : null;

/**
 * Kurulu bir bileşen KULLANILABİLİR mi? Arayüzdeki `isUsable` ve Rust'taki
 * `components::is_usable` kuralının birebir aynısı:
 *   installed && (kind === 'asset' || runnable)
 * Asset hiç çalışmaz ama kuruluysa kullanılabilir sayılır; aksi hâlde her
 * açılışta yeniden indirilmeye çalışılırdı.
 */
const isUsable = (component) =>
  Boolean(component) &&
  component.installed === true &&
  (component.kind === 'asset' || component.runnable === true);

/** Arayüzdeki `groupComponents`un birebir karşılığı: paket kimliğine göre grupla. */
const groupComponents = (rows) => {
  const buckets = new Map();
  const order = [];
  for (const component of rows ?? []) {
    const key = component.bundle ?? `component:${component.id}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key).push(component);
  }
  return order.map((key) => {
    const groupRows = buckets.get(key);
    return {
      key,
      rows: groupRows,
      primary: groupRows.find((row) => row.downloadable) ?? groupRows[0],
      needsInstall: groupRows.some((row) => row.downloadable === true && !isUsable(row)),
    };
  });
};

// `components.rs:parse_missing_signal`in birebir JS karşılığı (fail closed).
const parseMissingSignal = (error) => {
  const rest = String(error ?? '').trim();
  if (!rest.startsWith(MISSING_PREFIX)) return null;
  const id = (rest.slice(MISSING_PREFIX.length).split(/\r?\n/)[0] ?? '').trim();
  return id.length > 0 ? id : null;
};

// `components.rs:parse_missing_detail`: önekten SONRAKİ satır kullanıcı metnidir.
const parseMissingDetail = (error) => {
  const rest = String(error ?? '').trim();
  if (!rest.startsWith(MISSING_PREFIX)) return null;
  const parts = rest.split(/\r?\n/);
  if (parts.length < 2) return null;
  const detail = parts.slice(1).join('\n').trim();
  return detail.length > 0 ? detail : null;
};

/**
 * `components.rs`'ten (id → approx_mb) çıkarır (saf).
 *
 * Neden kaynak dosyadan? "Boyut arayüzde sabit yazılmış olabilir" iddiasını ancak
 * KAYITTAN bağımsız okuyarak çürütebiliriz; `components_status` tek başına kendi
 * kendini doğrular. `id` alanı `approx_mb`'den ÖNCE gelir (Spec alan sırası sabit);
 * bu yüzden sıralı tarama iç içe `DownloadSpec { ... }` bloklarından etkilenmez.
 */
const parseRegistrySizes = (source) => {
  const constants = new Map();
  for (const match of source.matchAll(/const\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*u32\s*=\s*(\d+)\s*;/g)) {
    constants.set(match[1], Number(match[2]));
  }
  const sizes = new Map();
  let pendingId = null;
  for (const match of source.matchAll(/id:\s*"([^"]+)"|approx_mb:\s*([A-Za-z0-9_]+)/g)) {
    if (match[1] !== undefined) {
      pendingId = match[1];
      continue;
    }
    if (pendingId === null) continue;
    const raw = match[2];
    sizes.set(pendingId, /^\d+$/.test(raw) ? Number(raw) : constants.get(raw) ?? null);
    pendingId = null;
  }
  return sizes;
};

const waitUntil = async (predicate, timeoutMs, intervalMs = 300) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) return false;
    await sleep(intervalMs);
  }
};

/* --- CDP köprüsü ----------------------------------------------------------- */

const invokeRaw = (page, command, args) =>
  page.evaluate(
    async ({ command: cmd, args: payload }) => {
      try {
        return { ok: true, value: await window.__TAURI_INTERNALS__.invoke(cmd, payload) };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    },
    { command, args },
  );

const getComponents = async (page) => {
  const result = await invokeRaw(page, 'components_status', undefined);
  if (!result.ok) throw new Error(`components_status başarısız: ${result.error}`);
  return result.value;
};

const getWhisperStatus = async (page) => {
  const result = await invokeRaw(page, 'whisper_status', undefined);
  if (!result.ok) return null;
  try {
    const raw = result.value;
    return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
  } catch {
    return null;
  }
};

/* --- arayüz yardımcıları --------------------------------------------------- */

const dismissOverlays = async (page) => {
  // İlk açılışta kurulum sihirbazı/tur açık olabilir; gözlemlenebilir koşulla
  // bekle ve sessizce kapat (sabit sleep yok).
  for (let i = 0; i < 3; i += 1) {
    const atla = page.getByRole('button', { name: 'Atla', exact: true }).first();
    const seen = await waitUntil(() => atla.isVisible().catch(() => false), i === 0 ? 3_000 : 800, 250);
    if (!seen) return;
    await atla.click().catch(() => {});
  }
};

/**
 * Bileşenler sekmesini aç ve BÖLÜMÜN ÇİZİLMESİNİ BEKLE. Sabit `sleep` yetmez
 * (sekme geçişi yarışta kaybolabiliyor); ölçüt gözlemlenebilir bir DOM durumu:
 * "Durumu yenile" düğmesi yalnız bölüm çizilince var olur.
 */
const openComponentsSection = async (page) => {
  await page.getByRole('button', { name: 'Ayarlar' }).first().click().catch(() => {});
  await page.getByRole('button', { name: 'Bileşenler' }).first().click().catch(() => {});
  const ready = page.getByRole('button', { name: 'Durumu yenile', exact: true }).first();
  return waitUntil(() => ready.isVisible().catch(() => false), 15_000, 300);
};

const refreshComponents = async (page) => {
  await page.getByRole('button', { name: 'Durumu yenile', exact: true }).first().click().catch(() => {});
};

/*
 * Satır `<span>`i = etiketle BAŞLAYAN ve bir DURUM DAMGASIYLA BİTEN span.
 * Damga koşulu neden gerekli? Ayarlar sekmesi açıklaması "ffmpeg, ffprobe, ..."
 * da etiketle başlar; damga koşulu (kurulu/eksik/çalıştırılamıyor) onu dışlar.
 */
/** Etiketle başlayıp damgayla biten satır `<span>`inin metni, yoksa null. */
const readRowText = (page, label) =>
  page
    .evaluate((wanted) => {
      const matches = Array.from(document.querySelectorAll('span')).find((span) => {
        const text = (span.textContent ?? '').trim();
        return text.startsWith(wanted) && /(kurulu|eksik|çalıştırılamıyor)$/.test(text);
      });
      return matches ? matches.textContent.trim() : null;
    }, label)
    .catch(() => null);

const waitForRow = async (page, label, needle, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await readRowText(page, label);
    if (last && last.includes(needle)) return last;
    if (Date.now() > deadline) return last;
    await sleep(300);
  }
};

/**
 * Bileşenler bölümünün gözlemlenebilir durumu (tek evaluate):
 *  - rows: her etiket için satırın görünen metni,
 *  - sizes: DOM'daki `~N MB` sayıları,
 *  - indirButtons: GÖRÜNÜR "İndir" düğmesi sayısı (kurulum gereken grup sayısı).
 */
const readScreen = (page, labels) =>
  page.evaluate((wanted) => {
    const spans = Array.from(document.querySelectorAll('span'));
    const rows = {};
    for (const label of wanted) {
      // Etiketle başla + durum damgasıyla bit (sekme açıklamasını dışlar).
      const el = spans.find((span) => {
        const text = (span.textContent ?? '').trim();
        return text.startsWith(label) && /(kurulu|eksik|çalıştırılamıyor)$/.test(text);
      });
      rows[label] = el ? el.textContent.trim() : null;
    }
    const sizes = Array.from(document.body.innerText.matchAll(/~(\d+)\s*MB/g)).map((m) =>
      Number(m[1]),
    );
    const indirButtons = Array.from(document.querySelectorAll('button')).filter(
      (button) => button.offsetParent !== null && (button.textContent ?? '').trim() === 'İndir',
    ).length;
    return { rows, sizes, indirButtons };
  }, labels);

/**
 * Bir bileşenin grubunun "İndir" düğmesini bulur.
 *
 * Neden SIRA ile? ComponentsSection, indirme eylemlerini gruplarla AYNI sırada
 * çizer (`groups.map`), her kurulum-gereken grup için TEK İndir düğmesi. Bu yüzden
 * görünür İndir düğmelerinin n'incisi, kurulum-gereken grupların n'incisine denk
 * gelir. Etikete göre `following::` XPath'ine göre bu yaklaşım gözlemlenebilir
 * veriyle (components_status) hizalanır; yanlış düğmeye basılırsa kurulum kontrolü
 * zaten KALDI verir.
 */
const installButtonFor = (page, rows, componentId) => {
  const needs = groupComponents(rows).filter((group) => group.needsInstall);
  const index = needs.findIndex((group) => group.rows.some((row) => row.id === componentId));
  return {
    index,
    button: index >= 0 ? page.getByRole('button', { name: 'İndir', exact: true }).nth(index) : null,
  };
};

/* --- gölge planı ----------------------------------------------------------- */

/** Ad bir gölge adına uyar mı: düz ad ya da `<kök>-*.exe` biçimi. */
const matchesShadowName = (name, wanted) => {
  const lower = name.toLowerCase();
  return wanted.some((base) => {
    const stem = base.replace(/\.exe$/, '');
    return lower === base || (lower.startsWith(`${stem}-`) && lower.endsWith('.exe'));
  });
};

/** Bir klasörün ad kümesi; klasör yoksa boş küme (sonda asla throw etmesin). */
const listDirNames = (dir) => {
  try {
    return new Set(readdirSync(dir));
  } catch {
    return new Set();
  }
};

/** exe yanı + `components/` içinde whisper/yt-dlp izlerini topla (yalnız var olanlar). */
const collectExtraShadows = (exeDir, componentsDir) => {
  const out = [];
  const scan = (dir, kind) => {
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (matchesShadowName(name, ALL_ARTIFACT_NAMES)) out.push({ from: join(dir, name), kind });
    }
  };
  scan(exeDir, 'exe');
  scan(componentsDir, 'components');
  return out;
};

/**
 * Verilen klasörlerdeki whisper izlerini topla (`matchesShadowName` kuralıyla:
 * düz ad ya da `<kök>-*.exe`). `binaries/` için bu bir DEĞİŞMEZ sınamasıdır
 * (kaynak ağacı), exe yanı için yalnız envanterdir (inşa çıktısı = dünya hâli).
 */
const collectWhisperArtifacts = (dirs) => {
  const found = [];
  for (const dir of dirs) {
    for (const name of listDirNames(dir)) {
      if (matchesShadowName(name, WHISPER_ARTIFACT_NAMES)) found.push(join(dir, name));
    }
  }
  return found;
};

/**
 * Sondanın KENDİ indirdiği test artıklarını siler (kullanıcı verisine dokunmaz):
 * gölge öncesi listeye (`pristine`) girmeyen whisper/`yt-dlp` adları, `.part`
 * dosyaları ve sonda tarafından indirilmiş model. Silinmezse gölge geri
 * yüklenirken hedef yol dolu kalır ve "geri yüklenemedi" hatası doğar.
 */
const removeProbeArtifacts = (ctx) => {
  const { state } = ctx;
  // Gölgeleme hiç yapılmadıysa silinecek bir sonda artığı da yoktur: mevcut
  // kullanıcı/uygulama dosyalarına asla dokunmayız (fail-closed).
  if (!state.shadowed) return;
  const removed = [];
  if (state.componentsDir) {
    let names = [];
    try {
      names = readdirSync(state.componentsDir);
    } catch {
      names = [];
    }
    for (const name of names) {
      const lower = name.toLowerCase();
      const isProbeFile =
        ALL_ARTIFACT_NAMES.includes(lower) || (lower.endsWith('.part') && !state.pristine.has(name));
      if (isProbeFile && !state.pristine.has(name)) {
        rmSync(join(state.componentsDir, name), { force: true });
        removed.push(name);
      }
    }
  }
  const model = state.downloadedModel;
  if (model?.path && !model.existedBefore && existsSync(model.path)) {
    rmSync(model.path, { force: true });
    removed.push(model.path);
  }
  state.removedTestArtifacts = removed;
  if (removed.length > 0) console.log(`     sonda artıkları silindi: ${removed.join(', ')}`);
};

/* --- adımlar --------------------------------------------------------------- */

const stepBaseline = async (ctx) => {
  const { page, report, artifact, state } = ctx;
  const rows = await getComponents(page);
  const whisperStatus = await getWhisperStatus(page);
  state.baselineComponents = rows;
  state.baselineWhisper = whisperStatus;
  state.labelById = Object.fromEntries(rows.map((component) => [component.id, component.label]));
  state.modelsDir = whisperStatus?.models_dir ?? null;

  const byId = Object.fromEntries(rows.map((component) => [component.id, component]));
  artifact.baseline = { components: rows.map(pick), whisperStatus };

  report(
    `taban: kayıt ${EXPECTED_IDS.length} bileşen döndürüyor`,
    rows.length === EXPECTED_IDS.length && EXPECTED_IDS.every((id) => byId[id]),
    `sayı=${rows.length} · idler=${rows.map((component) => component.id).join(',')}`,
  );
  const wrong = DOWNLOADABLE_IDS.filter((id) => byId[id]?.downloadable !== true);
  report(
    `taban: ${DOWNLOADABLE_IDS.length} bileşen indirilebilir (whisper + modeller + llama + AI dâhil)`,
    wrong.length === 0,
    wrong.length ? `eksik: ${wrong.join(', ')}` : DOWNLOADABLE_IDS.join(', '),
  );
  report(
    'taban: yt-dlp TEK indirilemez bileşen (paketle gömülü)',
    byId[YTDLP_ID]?.downloadable === false && byId[YTDLP_ID]?.kind === 'binary',
    `yt-dlp downloadable=${byId[YTDLP_ID]?.downloadable}`,
  );

  /*
   * 8a (7d dersi): "dünya hâli" varsayımı YOK. Artık gömülü whisper YOKTUR ve
   * yokluğu DOĞRU durumdur. Sınanan değişmezler:
   *   - whisper indirilebilir olmalı (tek yol: indirme),
   *   - kaynak ağacında (`binaries/`) gömülü whisper izi OLMAMALI.
   * Tabanın o anki durumu (daha önce indirilmişse kurulu olabilir) yalnızca KAYIT
   * olarak raporlanır; "kurulu olmalı" DENMEZ.
   */
  const whisper = byId[WHISPER_ID];
  report(
    'taban: whisper durumu kaydedildi (8a: gömülü kopya yok, indirme tek yol)',
    true,
    `installed=${whisper?.installed} · source=${whisper?.source ?? '-'} · runnable=${whisper?.runnable}`,
  );
  report(
    'taban: whisper indirilebilir (downloadable=true — tek yol)',
    whisper?.downloadable === true,
    `downloadable=${whisper?.downloadable}`,
  );

  const bundledInRepo = collectWhisperArtifacts([BINARIES_DIR]);
  const bundledBesideExe = collectWhisperArtifacts([state.exeDir]);
  artifact.baseline.bundledWhisper = {
    binariesDir: BINARIES_DIR,
    inRepo: bundledInRepo,
    besideExe: bundledBesideExe,
  };
  report(
    'taban: repoda gömülü whisper YOK (src-tauri/binaries — 8a değişmezi)',
    bundledInRepo.length === 0,
    bundledInRepo.length ? `bulundu: ${bundledInRepo.join(', ')}` : 'temiz',
  );
  // Exe yanı bir inşa çıktısıdır (dünya hâli), değişmez değil: gerçek durum
  // raporlanır (GEÇTİ/KALDI değil). Varsa zaten gölgeleneceği için sonda devam eder.
  report(
    'taban: exe yanındaki gömülü whisper envanteri kaydedildi (dünya hâli)',
    true,
    bundledBesideExe.length ? `${bundledBesideExe.length} dosya: ${bundledBesideExe.join(', ')}` : `${state.exeDir} temiz`,
  );
};

const stepRegistry = async (ctx) => {
  const { page, report, artifact, state } = ctx;
  const source = readFileSync(COMPONENTS_RS, 'utf8');
  const registry = parseRegistrySizes(source);
  state.registrySizes = registry;
  const rows = state.baselineComponents ?? (await getComponents(page));

  const found = EXPECTED_IDS.filter((id) => typeof registry.get(id) === 'number');
  artifact.registry = {
    source: COMPONENTS_RS,
    sizes: Object.fromEntries(EXPECTED_IDS.filter((id) => registry.has(id)).map((id) => [id, registry.get(id)])),
  };

  const mismatches = [];
  for (const id of EXPECTED_IDS) {
    const expected = registry.get(id);
    const actual = findById(rows, id)?.approx_mb;
    if (typeof expected !== 'number' || actual !== expected) {
      mismatches.push(`${id}: kayıt=${expected ?? '?'} status=${actual ?? '?'}`);
    }
  }
  report(
    `kayıt kaynağı: ${EXPECTED_IDS.length} id için approx_mb okundu`,
    found.length === EXPECTED_IDS.length,
    `${found.length}/${EXPECTED_IDS.length}`,
  );
  report(
    'boyutlar kayıttan geliyor (components_status === components.rs)',
    mismatches.length === 0,
    mismatches.join(' · ') ||
      EXPECTED_IDS.map((id) => `${id}=${registry.get(id)}`).join(', '),
  );
};

const stepHide = async (ctx) => {
  const { page, report, state, artifact } = ctx;
  const pathResult = await invokeRaw(page, 'components_path', undefined);
  if (!pathResult.ok) throw new Error(`components_path alınamadı: ${pathResult.error}`);
  state.componentsDir = String(pathResult.value);

  const extra = collectExtraShadows(state.exeDir, state.componentsDir);
  /*
   * ffmpeg/ffprobe gölge planından ÇIKARILIR: transkript kanıtı GERÇEK ffmpeg
   * ister (dosya başındaki not). Temizlik de onları silmemelidir; aksi hâlde
   * `removeTestArtifacts` (ffmpeg-adı silen ortak mantık) kullanıcının kurulu
   * ffmpeg'ini yok ederdi. Bu yüzden hem plandan çıkarılır hem de
   * `componentShadowNames` BOŞ bırakılır (bkz. clean-profile.mjs).
   */
  const plan = planShadows({ exeDir: state.exeDir, componentsDir: state.componentsDir, extra }).filter(
    (item) => !isBundledShadow(basename(item.from)),
  );
  state.componentShadowNames = [];
  state.backupDir = ensureOutDir(join('clean-profile-backup', `${STAMP}-whisper`));
  console.log(`temiz profil: ${plan.length} gölge dosya yedeklenecek → ${state.backupDir}`);
  console.log('     not: ffmpeg/ffprobe KASITLI olarak gölgelenmez (transkript kanıtı ffmpeg ister).');
  state.backupEntries = backupShadows(plan, state.backupDir);
  state.shadowed = true;
  writeManifest(state.backupDir, state.backupEntries);
  state.pristine = new Set(readdirSync(state.componentsDir));

  const rows = await getComponents(page);
  state.hiddenComponents = rows;
  artifact.cleanProfile = {
    exeDir: state.exeDir,
    exeDirHow: state.exeHow,
    componentsDir: state.componentsDir,
    extraShadows: extra,
    ffmpegLeftInstalled: true,
    componentShadowNames: state.componentShadowNames,
    backedUp: state.backupEntries,
    after: rows.map(pick),
  };

  const whisper = findById(rows, WHISPER_ID);
  const ytdlp = findById(rows, YTDLP_ID);
  report(
    'gizlendi: whisper artık kurulu DEĞİL (gerçek indirme yolu açık)',
    whisper?.installed === false,
    `installed=${whisper?.installed}`,
  );
  report(
    'gizlendi: yt-dlp artık kurulu DEĞİL (eksik sinyal yolu açık)',
    ytdlp?.installed === false,
    `installed=${ytdlp?.installed}`,
  );
};

const stepScreen = async (ctx) => {
  const { page, report, skip, artifact, state } = ctx;
  const opened = await openComponentsSection(page);
  report('arayüz: Bileşenler bölümü çizildi', opened, opened ? '"Durumu yenile" görünür' : 'bölüm açılamadı');
  if (!opened) return;

  // Taze durum: gölgelerden SONRA yenile ve whisper satırının "eksik" olduğunu bekle.
  await refreshComponents(page);
  await waitForRow(page, WHISPER_LABEL, 'eksik', 15_000);

  const rows = state.hiddenComponents ?? (await getComponents(page));
  const labels = EXPECTED_IDS.map((id) => state.labelById[id] ?? id);
  const screen = await readScreen(page, labels);
  const groups = groupComponents(rows);
  artifact.screen = {
    labels,
    rows: screen.rows,
    sizes: screen.sizes,
    indirButtons: screen.indirButtons,
    groups: groups.map((group) => ({
      key: group.key,
      rows: group.rows.map((row) => row.id),
      needsInstall: group.needsInstall,
      primary: group.primary?.id,
    })),
  };

  const unseen = labels.filter((label) => screen.rows[label] === null);
  report(
    `arayüz: ${EXPECTED_IDS.length} bileşenin tamamı çizildi`,
    unseen.length === 0,
    unseen.length ? `görünmeyen: ${unseen.join(' | ')}` : `${labels.length} satır`,
  );
  report(
    `arayüz: ${GROUP_COUNT} paket grubu (ffmpeg+ffprobe tek arşiv)`,
    groups.length === GROUP_COUNT,
    `grup=${groups.length}`,
  );

  // Boyutlar: görünen her sayı kayıttaki bir değer olmalı; kurulum gereken her
  // grubun boyutu da görünmeli. Böylece "arayüzde sabit sayı yazılmış" yolu kapanır.
  const registryValues = new Set([...state.registrySizes.values()].filter((v) => typeof v === 'number'));
  const bogus = screen.sizes.filter((size) => !registryValues.has(size));
  const needed = groups
    .filter((group) => group.needsInstall)
    .map((group) => ({ id: group.primary?.id, mb: group.primary?.approx_mb }));
  const missingSizes = needed.filter(({ mb }) => !screen.sizes.includes(mb));
  report(
    'arayüz: gösterilen her boyut kayıttan (uydurma sayı yok)',
    bogus.length === 0,
    bogus.length ? `kayıtta olmayan: ${bogus.join(', ')}` : `görünen=${[...new Set(screen.sizes)].join(', ')}`,
  );
  report(
    'arayüz: kurulum gereken her grubun boyutu görünüyor',
    needed.length > 0 && missingSizes.length === 0,
    missingSizes.length
      ? `eksik: ${missingSizes.map((s) => `${s.id}=${s.mb}`).join(', ')}`
      : needed.map((s) => `${s.id}=${s.mb}`).join(', '),
  );

  // İndir düğmesi sayısı: İNDİRME GEREKEN grup sayısına eşit olmalı. Kurulu bir
  // asset "kurulu" sayıldığı için bu sayıya GİRMEZ.
  const expectedIndir = groups.filter((group) => group.needsInstall).length;
  report(
    'arayüz: İndir düğmesi yalnız kurulum gereken gruplarda',
    screen.indirButtons === expectedIndir,
    `arayüz=${screen.indirButtons} · beklenen=${expectedIndir}`,
  );

  // Kurulu asset satırı "kurulu" göstermeli, "çalıştırılamıyor" DEĞİL.
  const installedAssets = rows.filter((component) => component.kind === 'asset' && component.installed);
  artifact.screen.installedAssets = installedAssets.map((component) => component.id);
  const badAssetRows = installedAssets.filter((component) => {
    const row = screen.rows[state.labelById[component.id] ?? component.id];
    return !row || !row.includes('kurulu') || row.includes('çalıştırılamıyor');
  });
  if (installedAssets.length > 0) {
    report(
      'arayüz: kurulu veri dosyaları "kurulu" gösteriyor (asla "çalıştırılamıyor")',
      badAssetRows.length === 0,
      badAssetRows.map((component) => component.id).join(', ') ||
        installedAssets.map((component) => component.id).join(', '),
    );
  } else {
    // Kurulu asset yoksa bu turda kanıtlanamaz; stepAssets tiny model kurup
    // (izin varsa) aynı iddiayı sınar. Burada "geçti" DENMEZ.
    skip(
      'arayüz: kurulu veri dosyaları "kurulu" gösteriyor',
      'kurulu veri dosyası yok; stepAssets kurulumla kanıtlayacak',
    );
  }
  await ctx.shot('component-whisper-screen.png');
};

const stepYtDlp = async (ctx) => {
  const { page, report, artifact } = ctx;
  const result = await invokeRaw(page, 'list_formats', { payload: { url: FAKE_URL } });
  const signal = result.ok ? null : parseMissingSignal(result.error);
  const detail = result.ok ? null : parseMissingDetail(result.error);
  artifact.ytdlp = {
    command: 'list_formats',
    url: FAKE_URL,
    rejected: result.ok === false,
    signalId: signal,
    detail,
    rawFirstLine: result.ok ? null : String(result.error).split(/\r?\n/)[0],
  };
  report(
    'yt-dlp eksik: list_formats REDDETTİ (ham OS hatası yok)',
    result.ok === false,
    result.ok ? 'beklenmedik başarı' : String(result.error).split(/\r?\n/)[0],
  );
  report(
    'yt-dlp eksik: yapılandırılmış BILESEN_EKSIK:yt-dlp sinyali',
    signal === YTDLP_ID,
    `sinyal=${signal ?? '-'}`,
  );
  report(
    'yt-dlp eksik: ikinci satır okunabilir Türkçe ayrıntı ve öneksiz',
    Boolean(detail) && detail.includes(YTDLP_ID) && !detail.includes(MISSING_PREFIX),
    detail ?? '(ayrıntı yok)',
  );
};

const stepWhisperInstall = async (ctx) => {
  const { page, report, skip, artifact, state, shot } = ctx;
  const entry = { ran: false, ok: false, elapsedMs: null, statusAfter: null, whisperStatusAfter: null, files: null };
  artifact.whisperInstall = entry;

  if (!RUN_ENGINE_INSTALL) {
    skip('whisper: Bileşenler\'den gerçek kurulum + runnable', 'JV_REAL_DOWNLOAD=0');
    entry.skipped = 'JV_REAL_DOWNLOAD=0';
    return;
  }

  const { index, button } = installButtonFor(page, state.hiddenComponents, WHISPER_ID);
  report(
    'whisper kurulum: arayüzde İndir düğmesi bulundu',
    button !== null,
    button !== null ? `${WHISPER_LABEL} (kurulum-gereken grup sırası=${index})` : 'düğme konumu hesaplanamadı',
  );
  if (!button) {
    entry.skipped = 'İndir düğmesi konumu hesaplanamadı';
    await shot('component-whisper-no-button.png');
    return;
  }
  await button.scrollIntoViewIfNeeded().catch(() => {});
  const visible = await button.isVisible().catch(() => false);
  report('whisper kurulum: İndir düğmesi görünür', visible, visible ? WHISPER_LABEL : 'düğme görünmedi');
  if (!visible) {
    entry.skipped = 'İndir düğmesi görünmedi';
    await shot('component-whisper-no-button.png');
    return;
  }

  const started = Date.now();
  // GERÇEK arayüz akışı: komutu doğrudan çağırmıyoruz, düğmeye basıyoruz.
  await button.click();
  entry.ran = true;

  // İlerleme çubuğu belirirse kanıt olarak sakla (beklemek zorunlu değil; indirme
  // çok hızlıysa kaçabilir — bu yüzden asıl ölçüt aşağıdaki durum sorgusudur).
  const progressSeen = await waitUntil(
    () => page.getByLabel(`${WHISPER_LABEL} indirme ilerlemesi`).first().isVisible().catch(() => false),
    6_000,
    200,
  );
  if (progressSeen) await shot('component-whisper-downloading.png');

  // Gözlemlenebilir bitiş koşulu: satır hem KURULU hem ÇALIŞTIRILABİLİR olmalı.
  const done = await waitUntil(
    async () => {
      const rows = await getComponents(page);
      const whisper = findById(rows, WHISPER_ID);
      return whisper?.installed === true && whisper?.runnable === true;
    },
    10 * 60_000,
    1500,
  );
  entry.elapsedMs = Date.now() - started;
  entry.ok = done;

  const rows = await getComponents(page);
  const whisper = findById(rows, WHISPER_ID);
  const whisperStatus = await getWhisperStatus(page);
  entry.statusAfter = pick(whisper);
  entry.whisperStatusAfter = whisperStatus;

  report('whisper kurulum: bileşen kuruldu (installed=true)', whisper?.installed === true, `installed=${whisper?.installed}`);
  report('whisper kurulum: kaynak "downloaded" (gömülü DEĞİL)', whisper?.source === 'downloaded', `source=${whisper?.source ?? '-'}`);
  report(
    'whisper kurulum: MANŞET — app onu ÇALIŞTIRILABİLİR bildiriyor (DLL kusuru giderildi)',
    whisper?.runnable === true,
    `runnable=${whisper?.runnable} · version=${whisper?.version ?? '-'} · ${done ? `${Math.round(entry.elapsedMs / 1000)} sn` : 'zaman aşımı'}`,
  );
  report(
    'whisper kurulum: whisper_status.whisper_available=true',
    whisperStatus?.whisper_available === true,
    `available=${whisperStatus?.whisper_available}`,
  );

  // Dosya kanıtı: exe + DLL'ler `components/` altında YAN YANA olmalı (kusurun kökü buydu).
  const dir = whisper?.path ? dirname(whisper.path) : null;
  const files = dir
    ? WHISPER_ENGINE_FILES.map((name) => ({ name, exists: existsSync(join(dir, name)) }))
    : [];
  entry.files = { dir, files };
  report(
    'whisper kurulum: whisper.exe + DLL\'ler components/ altında YAN YANA',
    files.length > 0 && files.every((file) => file.exists),
    dir ? files.map((file) => `${file.name}=${file.exists}`).join(' · ') : 'yol yok',
  );
  report(
    'whisper kurulum: exe bileşenler klasörüne yazıldı',
    Boolean(whisper?.path?.startsWith(state.componentsDir)),
    whisper?.path ?? '-',
  );

  // Arayüz damgası: whisper satırı "kurulu" olmalı (gözlemlenebilir koşula bekle).
  await refreshComponents(page);
  const rowText = await waitForRow(page, WHISPER_LABEL, 'kurulu', 15_000);
  report('whisper kurulum: arayüz satırı "kurulu" gösteriyor', Boolean(rowText && rowText.includes('kurulu')), rowText ?? '(satır yok)');
  await shot('component-whisper-installed.png');
};

/**
 * MANŞET (8a): indirilen whisper motoruyla GERÇEK transkripsiyon.
 *
 * Ne KANITLAR: motorun ÇALIŞTIĞINI ve boru hattının (ffmpeg → 16 kHz mono WAV →
 * whisper.cpp CLI → `.srt`) uçtan uca TAMAMLANDIĞINI; yani 0xC0000135 DLL
 * çökmesinin OLMADIĞINI.
 *
 * Ne KANITLAMAZ (dürüstlük): transkriptin İÇERİĞİNİ. Üretilen ses bir sinüs
 * tonudur; İÇİNDE KONUŞMA YOKTUR. Whisper bir ton/parazit üzerinde uydurma ya da
 * boş segment üretebilir; bu yüzden metin ANLAMSIZDIR ve kanıt sayılmaz.
 *
 * Ön koşullar (kurulu motor, kurulu ffmpeg, diskte model) yoksa adım KALDI değil
 * "ATLANDI / kanıtlanmadı" olarak raporlanır — sahte başarı üretilmez.
 */
const stepTranscribe = async (ctx) => {
  const { page, report, skip, artifact, shot } = ctx;
  const entry = {
    ran: false,
    skipped: null,
    enginePath: null,
    ffmpegPath: null,
    model: null,
    modelsPresent: [],
    modelFile: null,
    language: 'auto',
    audioPath: null,
    audioBytes: null,
    ok: false,
    error: null,
    dllCrashHint: null,
    srtPath: null,
    srtExists: false,
    srtBytes: null,
    previewLength: null,
    elapsedMs: null,
    proves: 'indirilen whisper motoru çalışır ve transkripsiyon boru hattı (0xC0000135 olmadan) tamamlanır',
    doesNotProve: 'transkriptin içeriği/doğruluğu — ses 2 sn sinüs tonu, içinde konuşma yok',
    cleanup: 'test sesi ve üretilen .srt, sondanın geçici klasörüyle birlikte silinir',
  };
  artifact.transcribe = entry;
  const skipLabel = 'whisper transkript: indirilen motorla GERÇEK transkripsiyon (.srt üretir)';

  try {
    const rows = await getComponents(page);
    const whisper = findById(rows, WHISPER_ID);
    const ffmpeg = findById(rows, 'ffmpeg');
    entry.enginePath = whisper?.path ?? null;
    entry.ffmpegPath = ffmpeg?.installed === true ? ffmpeg.path : null;

    // (1) Motor kurulu + çalıştırılabilir olmalı; değilse transkript denenemez.
    if (whisper?.installed !== true || whisper?.runnable !== true) {
      entry.skipped = `whisper kurulu/çalıştırılabilir değil (installed=${whisper?.installed} · runnable=${whisper?.runnable})`;
      skip(skipLabel, entry.skipped);
      return;
    }
    // (2) ffmpeg gerçek boru hattı için zorunlu (7d'den beri gömülü gelmez).
    if (!entry.ffmpegPath) {
      entry.skipped = 'ffmpeg kurulu değil (kayıttan çözülemedi)';
      skip(skipLabel, entry.skipped);
      return;
    }

    // (3) Model: diskte OLAN birini kullan (kayıttaki whisper modelleri).
    const status = await getWhisperStatus(page);
    const modelsDir = status?.models_dir ?? ctx.state.modelsDir ?? null;
    const present = TRANSCRIBE_MODEL_ORDER.filter((model) => status?.models?.[model] === true);
    entry.modelsPresent = present;
    if (present.length === 0) {
      entry.skipped = `diskte whisper modeli yok (models=${JSON.stringify(status?.models ?? null)})`;
      skip(skipLabel, entry.skipped);
      return;
    }
    entry.model = present[0];
    entry.modelFile = modelsDir ? join(modelsDir, `ggml-${entry.model}.bin`) : null;

    // (4) ffmpeg (kayıttan) ile kısa ses üret. Sinüs tonu: İÇİNDE KONUŞMA YOK.
    const audio = join(ctx.state.tmpDir, `whisper-probe-ses-${STAMP}.wav`);
    entry.audioPath = audio;
    const made = spawnSync(
      entry.ffmpegPath,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=2',
        '-ac',
        '1',
        '-ar',
        '16000',
        audio,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    const audioReady = made.status === 0 && existsSync(audio);
    entry.audioBytes = audioReady ? statSync(audio).size : null;
    report(
      'whisper transkript: ffmpeg ile kısa test sesi üretildi (sinüs tonu — konuşma YOK)',
      audioReady,
      audioReady
        ? `${audio} · ${entry.audioBytes} bayt`
        : `ffmpeg exit=${made.status} · ${String(made.stderr ?? '').trim().split(/\r?\n/).slice(-1)[0] ?? ''}`,
    );
    if (!audioReady) {
      entry.skipped = 'test sesi üretilemedi (ffmpeg)';
      skip(skipLabel, entry.skipped);
      return;
    }

    // (5) GERÇEK çağrı: transcribe({ input_path, model, language, job_id }).
    const started = Date.now();
    const result = await invokeRaw(page, 'transcribe', {
      payload: {
        input_path: audio,
        model: entry.model,
        language: entry.language,
        job_id: `probe-transcribe-${Date.now()}`,
      },
    });
    entry.elapsedMs = Date.now() - started;
    entry.ran = true;
    entry.ok = result.ok === true;

    if (result.ok) {
      const raw = result.value;
      const parsed = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
      entry.language = parsed.language ?? entry.language;
      entry.srtPath = parsed.srt_path ?? null;
      entry.previewLength = typeof parsed.preview === 'string' ? parsed.preview.length : null;
      entry.srtExists = Boolean(entry.srtPath) && existsSync(entry.srtPath);
      entry.srtBytes = entry.srtExists ? statSync(entry.srtPath).size : null;
    } else {
      entry.error = String(result.error ?? '(bilinmeyen hata)');
      // DLL çökmesinin imzası hata metninde geçmeli; geçmiyorsa farklı bir hata var.
      entry.dllCrashHint = /0xC0000135|3221225781/i.test(entry.error) ? 'eşleşti' : 'yok';
    }

    report(
      'whisper transkript: MANŞET — indirilen motorla transcribe hatasız tamamlandı',
      entry.ok,
      entry.ok ? `${entry.model} · ${entry.elapsedMs} ms` : entry.error,
    );
    report(
      'whisper transkript: üretilen .srt diskte GERÇEKTEN var',
      entry.srtExists,
      entry.srtPath ?? '(yol yok)',
    );
    // Dürüstlük kaydı (her koşulda GEÇTİ sayılmaz; bilgi satırı): kanıtın SINIRI.
    report(
      'whisper transkript: kanıt sınırı — motor koştu, transkript İÇERİĞİ kanıt DEĞİL (ses ton)',
      true,
      `önizleme=${entry.previewLength ?? '-'} karakter · .srt=${entry.srtBytes ?? '-'} bayt · ${entry.doesNotProve}`,
    );
    if (!entry.ok) {
      report(
        'whisper transkript: hata 0xC0000135 (DLL çökmesi) DEĞİL',
        entry.dllCrashHint === 'yok',
        `ipucu=${entry.dllCrashHint} · hata=${entry.error}`,
      );
    }
    await shot('component-whisper-transcribe.png');
  } catch (error) {
    const message = String(error?.stack ?? error?.message ?? error);
    entry.error = message;
    ctx.errors.push({ step: 'transcribe', message });
    report(skipLabel, false, String(error?.message ?? error));
    console.error(message);
  }
};

const stepAssets = async (ctx) => {
  const { page, report, skip, artifact, state, shot } = ctx;
  const entry = { installedAtBaseline: [], downloaded: null, rows: [], skipped: null };
  artifact.assetRows = entry;

  let rows = await getComponents(page);
  let assets = rows.filter((component) => component.kind === 'asset' && component.installed);
  entry.installedAtBaseline = assets.map((component) => component.id);

  if (assets.length === 0) {
    // Hiç kurulu veri dosyası yok: gerçek bir model kurarak yolu kanıtla (varsa).
    if (!RUN_MODEL_INSTALL) {
      entry.skipped = 'kurulu asset yok ve model indirmesi kapalı';
      skip(
        'asset: kurulu veri dosyası satırı "kurulu" ve yeniden indirmeye kapalı',
        'kurulu asset yok; model indirmesi kapalı (--quick / JV_REAL_DOWNLOAD=0)',
      );
      return;
    }
    const { button } = installButtonFor(page, rows, TINY_ID);
    const visible = button ? await button.isVisible().catch(() => false) : false;
    report('asset kurulum: tiny model İndir düğmesi bulundu', visible, visible ? TINY_LABEL : 'düğme görünmedi');
    if (!visible) {
      entry.skipped = 'tiny İndir düğmesi görünmedi';
      skip('asset: kurulu veri dosyası satırı "kurulu" ve yeniden indirmeye kapalı', 'tiny İndir düğmesi görünmedi');
      return;
    }
    const before = listDirNames(state.modelsDir);
    await button.click();
    const done = await waitUntil(
      async () => findById(await getComponents(page), TINY_ID)?.installed === true,
      20 * 60_000,
      2000,
    );
    // Model klasörünü kurulumdan SONRA da sor: taban `whisper_status` okunamadıysa
    // (modelsDir null) indirilen dosyayı ancak böyle bulup temizleyebiliriz.
    const afterStatus = await getWhisperStatus(page);
    const modelsDir = state.modelsDir ?? afterStatus?.models_dir ?? null;
    entry.downloaded = { id: TINY_ID, done, modelsDir };
    report('asset kurulum: tiny model Bileşenler\'den kuruldu', done, done ? 'installed=true' : 'zaman aşımı');
    if (done && !modelsDir) {
      report('asset kurulum: indirilen model yolu bilinmiyor (temizlik yapılamadı)', false, 'whisper_status.models_dir yok');
    }
    state.downloadedModel = modelsDir
      ? { path: join(modelsDir, TINY_FILE), existedBefore: before.has(TINY_FILE) }
      : null;
    rows = await getComponents(page);
    assets = rows.filter((component) => component.kind === 'asset' && component.installed);
  } else {
    console.log(`     kurulu veri dosyaları tabandan kullanılıyor (ek indirme YOK): ${entry.installedAtBaseline.join(', ')}`);
  }

  if (assets.length === 0) {
    entry.skipped = entry.skipped ?? 'kurulu asset yok';
    skip('asset: kurulu veri dosyası satırı "kurulu" ve yeniden indirmeye kapalı', 'kurulu asset yok');
    return;
  }

  // Ekranı tazele; her asset satırı "kurulu" görünene kadar bekle (sabit sleep yok).
  await openComponentsSection(page);
  await refreshComponents(page);
  const labels = assets.map((component) => state.labelById[component.id] ?? component.label);
  for (const label of labels) await waitForRow(page, label, 'kurulu', 15_000);

  for (const asset of assets) {
    const label = state.labelById[asset.id] ?? asset.label;
    const rowText = await readRowText(page, label);
    const record = {
      id: asset.id,
      kind: asset.kind,
      installed: asset.installed,
      runnable: asset.runnable,
      version: asset.version,
      downloadable: asset.downloadable,
      usable: isUsable(asset),
      rowText,
    };
    entry.rows.push(record);
    report(`asset ${asset.id}: dosya var (installed=true)`, asset.installed === true);
    report(`asset ${asset.id}: kind="asset" (veri dosyası)`, asset.kind === 'asset', `kind=${asset.kind}`);
    report(
      `asset ${asset.id}: runnable=false + version=null (çalıştırılmaz — KASITLI)`,
      asset.runnable === false && asset.version === null,
      `runnable=${asset.runnable} version=${asset.version}`,
    );
    report(`asset ${asset.id}: kurulu olduğu için KULLANILABİLİR sayılır (isUsable)`, isUsable(asset) === true);
    report(
      `asset ${asset.id}: arayüz "kurulu" gösteriyor ("çalıştırılamıyor" DEĞİL)`,
      Boolean(rowText && rowText.includes('kurulu') && !rowText.includes('çalıştırılamıyor')),
      rowText ?? '(satır yok)',
    );
  }

  // "Bir daha indirmeye sunulmaz": kurulu asset grubu İndir düğmesi göstermemeli.
  const groups = groupComponents(rows);
  const assetIds = new Set(assets.map((asset) => asset.id));
  const offeredAssets = groups.filter(
    (group) => group.needsInstall && group.rows.some((row) => assetIds.has(row.id)),
  );
  report(
    'asset: kurulu veri dosyaları yeniden indirmeye SUNULMUYOR',
    offeredAssets.length === 0,
    offeredAssets.map((group) => group.key).join(', ') || `${assets.length} asset grubu`,
  );
  await shot('component-whisper-assets.png');
};

const stepRestored = async (ctx) => {
  const { page, report, state, artifact } = ctx;
  const restored = state.restoreReport?.restored ?? [];
  report(
    'geri yükleme: gölgelenen HER dosya eski yerine kondu',
    /*
     * 8a ölçütü "en az bir yedek" DEĞİL, "gölgelenen ne varsa hepsi geri kondu".
     * Artık gömülü whisper repoda yok; sonda yalnızca yt-dlp (gömülü) ve varsa
     * indirilmiş whisper'ı gölgeler. 0 gölge de geçerli bir sonuçtur.
     */
    restored.every((entry) => entry.restored),
    restored.length
      ? `${restored.filter((entry) => entry.restored).length}/${restored.length}`
      : 'gölgelenecek dosya yok (8a: gömülü whisper yok; yt-dlp gömülü, indirilmiş kopya yoksa)',
  );

  const rows = await getComponents(page);
  const whisper = findById(rows, WHISPER_ID);
  const ytdlp = findById(rows, YTDLP_ID);
  artifact.availability = {
    before: artifact.baseline?.components ?? null,
    after: { whisper: pick(whisper), ytdlp: pick(ytdlp) },
  };

  /*
   * 8a değişmezi (7d dersi): "gömülü whisper yeniden kurulu olmalı" DEĞİL —
   * gömülü whisper artık yok. Doğru ölçüt "makine bulunduğu gibi bırakıldı":
   * tabanda kurulu olan, geri sonrası da kurulu olmalı (ve tersi).
   */
  const beforeWhisper = findById(state.baselineComponents ?? [], WHISPER_ID);
  const beforeYtdlp = findById(state.baselineComponents ?? [], YTDLP_ID);
  report(
    'geri sonrası: makine bulunduğu gibi bırakıldı (whisper)',
    Boolean(beforeWhisper?.installed) === Boolean(whisper?.installed),
    `önce=${beforeWhisper?.installed} · sonra=${whisper?.installed} · source=${whisper?.source ?? '-'}`,
  );
  report(
    'geri sonrası: makine bulunduğu gibi bırakıldı (yt-dlp)',
    Boolean(beforeYtdlp?.installed) === Boolean(ytdlp?.installed),
    `önce=${beforeYtdlp?.installed} · sonra=${ytdlp?.installed} · source=${ytdlp?.source ?? '-'}`,
  );
};

/* --- regresyon ------------------------------------------------------------- */

const stepRegressions = (ctx) => {
  const { report, artifact } = ctx;
  const commands = [
    { name: 'verify:components', line: 'npm run verify:components' },
    { name: 'verify:missing-component', line: 'npm run verify:missing-component' },
    { name: 'verify:component-download --quick', line: 'npm run verify:component-download -- --quick' },
  ];
  const out = [];
  for (const entry of commands) {
    const result = spawnSync(entry.line, { cwd: PROJECT_ROOT, shell: true, encoding: 'utf8', timeout: 20 * 60_000 });
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    out.push({
      name: entry.name,
      command: entry.line,
      status: result.status,
      ok: result.status === 0,
      tail: text.split(/\r?\n/).slice(-5),
    });
    report(`regresyon: ${entry.name}`, result.status === 0, `exit=${result.status}`);
  }
  artifact.regressions = { ran: true, commands: commands.map((entry) => entry.line), results: out };
};

/* --- akış ------------------------------------------------------------------ */

const main = async () => {
  const browser = await waitForCdp(CDP);
  if (!browser) {
    console.error(`Uygulamaya bağlanılamadı (${CDP}).`);
    return endProbe(2);
  }
  const page = findAppPage(browser);
  if (!page) {
    console.error('Uygulama penceresi bulunamadı.');
    return endProbe(2);
  }
  console.log(`bağlandı: ${page.url()}`);
  await page.waitForLoadState('load');
  // Uygulama kabuğu çizilene kadar bekle (gözlemlenebilir DOM koşulu; sabit sleep
  // yerine): "Ayarlar" düğmesi yalnız kabuk hazır olunca görünür.
  await waitUntil(
    () => page.getByRole('button', { name: 'Ayarlar' }).first().isVisible().catch(() => false),
    60_000,
    400,
  );

  const results = [];
  const errors = [];
  const skips = [];
  const report = (label, ok, detail) => {
    results.push({ label, ok: Boolean(ok), detail: detail ?? null });
    console.log(`${ok ? 'GEÇTİ' : 'KALDI'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };
  const skip = (label, reason) => {
    skips.push({ label, reason });
    console.log(`ATLANDI  ${label} — ${reason}`);
  };
  ensureOutDir();
  const tmpDir = ensureOutDir(TMP_DIR_NAME);

  await dismissOverlays(page);

  const exeInfo = findAppExeDir();
  console.log(`exe klasörü: ${exeInfo.dir} (${exeInfo.how})`);
  if (!RUN_ENGINE_INSTALL) console.log('HIZLI MOD: whisper motoru (~4 MB) indirmesi de ATLANDI (JV_REAL_DOWNLOAD=0).');
  if (RUN_ENGINE_INSTALL && !RUN_MODEL_INSTALL) console.log('HIZLI MOD: yalnız model (~74 MB) indirmesi ATLANDI (--quick).');

  const startedAt = Date.now();
  const state = {
    exeDir: exeInfo.dir,
    exeHow: exeInfo.how,
    componentsDir: null,
    backupDir: null,
    backupEntries: [],
    pristine: new Set(),
    shadowed: false,
    removed: [],
    removedTestArtifacts: [],
    restoreReport: null,
    cleaned: false,
    // Sondanın kendi geçici klasörü (test sesi + üretilen `.srt` burada yaşar).
    tmpDir,
    // Temizlikte YALNIZ bu adlar silinir (bkz. clean-profile.mjs). Whisper sondası
    // ffmpeg'i gölgelemediği için boş: aksi hâlde ffmpeg.exe silinirdi.
    componentShadowNames: [],
    baselineComponents: null,
    baselineWhisper: null,
    hiddenComponents: null,
    labelById: {},
    modelsDir: null,
    registrySizes: new Map(),
    downloadedModel: null,
  };
  const artifact = {
    kind: 'component-whisper-probe',
    synthetic: false,
    note: 'Faz 7c-3 → 8a: whisper + modeller + llama/AI indirilebilir; yt-dlp gömülü kalır. 8a: repoda gömülü whisper YOK (tek yol indirme) ve arayüzden indirilen motorla GERÇEK transkripsiyon koşar. BU YALNIZCA motorun çalıştığını/boru hattının bittiğini kanıtlar (0xC0000135 yok); transkriptin İÇERİĞİNİ kanıtlamaz — ses sinüs tonu, içinde konuşma yok (bkz. transcribe.doesNotProve). Kurulu asset "kurulu" görünür ve yeniden indirmeye sunulmaz; eksik yt-dlp BILESEN_EKSIK:yt-dlp döndürür; Bileşenler ekranı 13 satır/12 grubu kayıttan gelen boyutlarla çizer. Geri sonrası ölçüt "makine bulunduğu gibi bırakıldı".',
    capturedAt: new Date().toISOString(),
    appUrl: page.url(),
    quick: quickFlag,
    flags: { engineInstall: RUN_ENGINE_INSTALL, modelInstall: RUN_MODEL_INSTALL },
    // İndirme politikası: hangi indirmeler koşar, hangileri KASITLI olarak
    // yapılmaz (çok GB'lık olanlar hiç indirilmez → "kanıtlanmadı", geçti değil).
    downloadPolicy: {
      engine: RUN_ENGINE_INSTALL ? 'koşar (~4 MB; varsayılan, --quick ATLAMAZ)' : 'atlandı (JV_REAL_DOWNLOAD=0)',
      modelTiny: RUN_MODEL_INSTALL
        ? 'kurulu asset yoksa koşar (~74 MB)'
        : 'atlandı (--quick / JV_REAL_DOWNLOAD=0)',
      multiGb:
        'llama-engine (242 MB), llama-cudart (373 MB), Qwen (~8.5 GB), BGE (605 MB), base/small/large-v3-q5_0 (~1.0 GB)/large-v3 (~3.0 GB) modelleri BU SONDA HİÇ İNDİRİLMEZ — yalnız indirilebilirlik bayrakları doğrulanır; kurulumları kanıtlanmadı',
      transcribe:
        'arayüzden indirilen motor + kurulu ffmpeg + diskte model varsa koşar; biri yoksa DÜRÜSTÇE atlanır (kanıtlanmadı)',
    },
    baseline: null,
    registry: null,
    cleanProfile: null,
    screen: null,
    ytdlp: null,
    whisperInstall: null,
    // MANŞET kanıtı (8a): indirilen motorla gerçek transkripsiyon (içerik değil).
    transcribe: null,
    assetRows: null,
    availability: { before: null, after: null },
    regressions: {
      ran: false,
      commands: [
        'npm run verify:components',
        'npm run verify:missing-component',
        'npm run verify:component-download -- --quick',
      ],
    },
    results: [],
    skips: [],
    errors: [],
  };
  const ctx = {
    page,
    report,
    skip,
    results,
    skips,
    errors,
    state,
    artifact,
    shot: async (name) => {
      try {
        const path = resolve(OUT_DIR, name);
        await page.screenshot({ path, fullPage: true });
        console.log(`     ekran görüntüsü: ${path}`);
        return path;
      } catch (error) {
        const message = `${name}: ${String(error?.message ?? error)}`;
        errors.push({ step: 'screenshot', message });
        console.error(`ekran görüntüsü alınamadı — ${message}`);
        return null;
      }
    },
  };

  try {
    await stepBaseline(ctx);
    await stepRegistry(ctx);
    await stepHide(ctx);
    await stepScreen(ctx);
    await stepYtDlp(ctx);
    await stepWhisperInstall(ctx);
    // MANŞET (8a): indirilen motorla GERÇEK transkripsiyon. ffmpeg ya da kurulu
    // model yoksa adım dürüstçe ATLANIR (KALDI değil) — bkz. stepTranscribe.
    await stepTranscribe(ctx);
    await stepAssets(ctx);
  } catch (error) {
    const message = String(error?.stack ?? error?.message ?? error);
    errors.push({ step: 'fatal', message });
    report('sonda hatasız tamamlandı', false, String(error?.message ?? error));
    console.error(message);
  } finally {
    // ÖNCE sondanın indirdiği test artıkları silinir, SONRA gölgeler geri konur;
    // aksi hâlde hedef yol dolu kalır ve geri yükleme haklı olarak reddedilir.
    try {
      removeProbeArtifacts(ctx);
    } catch (error) {
      const message = String(error?.message ?? error);
      errors.push({ step: 'artifact-cleanup', message });
      console.error(`test artığı temizliği hatası: ${message}`);
    }
    try {
      cleanupProfile(ctx, [tmpDir]);
    } catch (error) {
      const message = String(error?.message ?? error);
      errors.push({ step: 'cleanup', message });
      console.error(`temizlik hatası: ${message}`);
    }
  }

  try {
    await stepRestored(ctx);
  } catch (error) {
    const message = String(error?.message ?? error);
    errors.push({ step: 'restore-check', message });
    report('geri sonrası taban doğrulandı', false, message);
    console.error(message);
  }

  if (RUN_REGRESSIONS) {
    try {
      stepRegressions(ctx);
    } catch (error) {
      const message = String(error?.message ?? error);
      errors.push({ step: 'regressions', message });
      console.error(message);
    }
  } else {
    console.log('\nNOT: regresyon sondaları bu koşuda ÇALIŞTIRILMADI. Koşmak için --with-regressions kullan ya da elle:');
    for (const command of artifact.regressions.commands) console.log(`  ${command}`);
  }

  artifact.results = results;
  artifact.skips = skips;
  artifact.errors = errors;
  artifact.exposedErrorCount = errors.length;
  artifact.timings = {
    totalMs: Date.now() - startedAt,
    whisperInstallMs: artifact.whisperInstall?.elapsedMs ?? null,
    transcribeMs: artifact.transcribe?.elapsedMs ?? null,
  };
  artifact.cleanProfile = {
    ...(artifact.cleanProfile ?? {}),
    exeDir: state.exeDir,
    exeDirHow: state.exeHow,
    componentsDir: state.componentsDir,
    backupDir: state.backupDir,
    componentShadowNames: state.componentShadowNames ?? null,
    ffmpegLeftInstalled: true,
    backedUp: state.backupEntries,
    removedTestArtifacts: state.removedTestArtifacts ?? [],
    cleanupRemoved: state.removed ?? [],
    restore: state.restoreReport,
  };

  try {
    writeFileSync(resolve(OUT_DIR, 'component-whisper-probe.json'), JSON.stringify(artifact, null, 2), 'utf8');
    console.log('\nprovenance: component-whisper-probe.json + component-whisper-*.png');
  } catch (error) {
    const message = String(error?.message ?? error);
    errors.push({ step: 'artifact', message });
    console.error(`artifact yazılamadı: ${message}`);
  }

  const failed = results.filter((entry) => !entry.ok).length;
  console.log(
    failed === 0 && errors.length === 0
      ? `\nSONUÇ: tüm kontroller GEÇTİ${skips.length > 0 ? ` (${skips.length} kontrol ATLANDI — kanıtlanmadı)` : ''}`
      : `\nSONUÇ: ${failed} kontrol KALDI · ${errors.length} hata${skips.length > 0 ? ` · ${skips.length} atlandı` : ''} (artifact: dev/out/component-whisper-probe.json)`,
  );
  return endProbe(failed === 0 && errors.length === 0 ? 0 : 1);
};

await main();
