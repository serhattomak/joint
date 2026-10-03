/*
 * Arayüz "eksik bileşen kapısı" sondası — üretim kodu DEĞİL (Faz 7c-2).
 *
 * NE KANITLAR: ffmpeg/ffprobe GİZLİYKEN bir medya aracı GERÇEK arayüzden
 * tetiklendiğinde (a) kurulum diyaloğunun açıldığını, (b) etiket/boyut + İndir ve
 * çalışırken İptal/ilerleme öğelerinin göründüğünü, (c) makine-okunur
 * `BILESEN_EKSIK` önekinin HİÇBİR render noktasında DOM'a sızmadığını,
 * (d) 7c-3'ten sonra whisper'ın da ffmpeg gibi kurulum diyaloğunu açtığını
 * (eski "indirilemeyen whisper → ölü diyalog yok, yalnız dürüst metin" dalı
 * KALDIRILDI) ve (e) gerçek kurulum sonrası orijinal eylemin otomatik yeniden
 * denendiğini.
 *
 * NEDEN DOSYALAR GEÇİCİ YEDEĞE ALINIR (temiz profil taklidi):
 * `resolve()` önce `components/`e, sonra uygulamanın YANINDAKİ gömülü sidecar'a
 * bakar. Geliştirme makinesinde gömülü ffmpeg HEP vardır; bu yüzden "eksik bileşen"
 * yolu taklit edilmeden ASLA çalışmaz ve sonda hiçbir şey kanıtlamaz. Mekanizma
 * `dev/lib/clean-profile.mjs`'te TEK yerde yaşar (7b/7c-1 ile paylaşılır).
 *
 * NEDEN KASAYA GEÇİCİ BİR "KAYNAK" TOHUMU EKLENİR:
 * Beş medya aracı da kaynak listesini `listItems()`ten (yerel dosyası olan kasa
 * öğeleri) okur; diğer yol yerel dosya seçicisidir ve Playwright OS diyaloğunu
 * süremez. Sahte bir kayıt olmadan HİÇBİR aracın düğmesine basılamaz — yani
 * kapı hiç tetiklenemez. Tohum YALNIZCA bir test düzeneğidir (setup): kapıyı
 * yine GERÇEK bir tıklama tetikler. Tohum kaydı `finally` içinde silinir ve
 * doğrudan SQLite dosyasına yazılır (`database_path` ile bulunur) — uygulamanın
 * bağlantı havuzuna dokunulmaz. Varsayım: üretim kasası kullanılıyor
 * (`VITE_JV_DB` override edilmemiş ya da `JV_DB_FILE` ile eşlenmiş); aksi hâlde
 * tohum görünmez ve sonda bunu "diyalog görünmedi" diye AÇIKÇA bildirir.
 *
 * Kullanım:
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev            # pencere açıldıktan sonra:
 *   npm run verify:component-gate              # gerçek ~186 MB indirme DAHİL
 *   npm run verify:component-gate -- --quick   # gerçek indirmeyi atla (dürüstçe "kanıtlanmadı")
 *
 * Bayraklar / ortam değişkenleri:
 *   --quick                    gerçek indirmeyi + yeniden deneme kanıtını atlar
 *   JV_REAL_DOWNLOAD=1         gerçek indirmeyi ZORLA (--quick'i geçersiz kılar)
 *   JV_REAL_DOWNLOAD=0         gerçek indirmeyi atla
 *   --with-regressions         sondadan SONRA 3 regresyon komutunu koşar (varsayılan: kapalı)
 *   JV_CDP=...                 CDP ucu (varsayılan http://127.0.0.1:9222)
 *   JV_APP_EXE_DIR=...         uygulamanın exe klasörü (otomatik bulunamazsa)
 *   JV_OUT=...                 çıktı klasörü (varsayılan dev/out)
 *
 * Çıkış kodları: 0 tüm kontroller geçti · 1 kalan kontrol/hata var · 2 uygulama kapalı.
 * Atlanan kontrol "GEÇTİ" SAYILMAZ; ayrı `skips` listesinde raporlanır.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
  planShadows,
  writeManifest,
} from './lib/clean-profile.mjs';

const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --- mod seçimi ------------------------------------------------------------ */
// 7b sondasıyla AYNI sözleşme: varsayılan gerçek indirme; `--quick` atlar; açık
// JV_REAL_DOWNLOAD değeri bayrağı geçersiz kılar (öngörülebilirlik).
const argv = new Set(process.argv.slice(2));
const quickFlag = argv.has('--quick') || process.env.JV_QUICK === '1';
const realEnv = (process.env.JV_REAL_DOWNLOAD ?? '').toLowerCase();
const forceReal = ['1', 'true', 'yes', 'on'].includes(realEnv);
const forceSkip = ['0', 'false', 'no', 'off'].includes(realEnv);
const RUN_REAL_DOWNLOAD = forceReal ? true : forceSkip ? false : !quickFlag;
const RUN_REGRESSIONS = argv.has('--with-regressions') || process.env.JV_WITH_REGRESSIONS === '1';

/* --- sabitler -------------------------------------------------------------- */

// Tel formatı üretimde TEK yerde (`components.rs:MISSING_PREFIX`). Sonda, arayüz
// sözleşmesini bağımsız doğrulayabilsin diye literal'i burada ÇİVLER (test sabiti);
// üretim koduna string kopyası eklenmez.
const MARKER = 'BILESEN_EKSIK';
const COMPONENT_ID = 'ffmpeg';
// Whisper motoru satırının kullanıcıya dönük etiketi (kayıt: `components.rs`).
const WHISPER_LABEL = 'Whisper motoru';
const TMP_DIR_NAME = 'component-gate-tmp';
const TITLE_A = 'Sonda kapı kaynağı A';
const TITLE_B = 'Sonda kapı kaynağı B';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

/* --- saf yardımcılar ------------------------------------------------------- */

const findById = (list, id) => (list ?? []).find((component) => component.id === id) ?? null;

const pick = (component) =>
  component
    ? {
        id: component.id,
        label: component.label,
        approx_mb: component.approx_mb,
        installed: component.installed,
        runnable: component.runnable,
        source: component.source,
        downloadable: component.downloadable,
        bundle: component.bundle,
      }
    : null;

/** `convert-path.ts:outputPathFor`ın birebir JS karşılığı (mp3 için). */
const mp3OutputPath = (inputPath) => {
  const i = Math.max(inputPath.lastIndexOf('/'), inputPath.lastIndexOf('\\'));
  const dir = i < 0 ? '' : inputPath.slice(0, i);
  const sep = i < 0 ? '/' : inputPath[i];
  const base = i < 0 ? inputPath : inputPath.slice(i + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot <= 0 ? base : base.slice(0, dot);
  return dir ? `${dir}${sep}${stem}-mp3.mp3` : `${stem}-mp3.mp3`;
};

/** 8 kHz, 16-bit, mono, kısa sessiz PCM WAV. ffmpeg gerçek bir ses dosyası görsün. */
const makeSilentWav = (seconds = 0.25, sampleRate = 8000) => {
  const samples = Math.floor(seconds * sampleRate);
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  return buf; // örnekler sıfır → sessizlik
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

const getDownloadDir = async (page) => {
  const result = await invokeRaw(page, 'get_download_dir', undefined);
  return result.ok ? String(result.value) : null;
};

const getDatabasePath = async (page) => {
  const result = await invokeRaw(page, 'database_path', undefined);
  if (!result.ok) throw new Error(`database_path başarısız: ${result.error}`);
  return String(result.value);
};

const readWhisperStatus = async (page) => {
  const result = await invokeRaw(page, 'whisper_status', undefined);
  if (!result.ok) return null;
  try {
    const raw = result.value;
    return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
  } catch {
    return null;
  }
};

/* --- tıklama yardımcıları -------------------------------------------------- */

const dismissOverlays = async (page) => {
  // İlk açılışta kurulum sihirbazı/tur açık olabilir; sessizce kapat.
  const atla = page.getByRole('button', { name: 'Atla', exact: true }).first();
  for (let i = 0; i < 3; i += 1) {
    if (await atla.isVisible().catch(() => false)) {
      await atla.click().catch(() => {});
      await sleep(400);
    }
  }
};

const openConverter = async (page) => {
  await page.getByRole('button', { name: 'Dönüştürücü', exact: true }).first().click();
  await sleep(800);
};

const openTool = async (page, title) => {
  await page.getByRole('button', { name: 'Araçlar', exact: true }).first().click();
  await sleep(600);
  await page.getByText(title, { exact: true }).first().click();
  await sleep(800);
};

const selectSource = async (page, title) => {
  const button = page.getByRole('button', { name: title, exact: true }).first();
  await button.waitFor({ state: 'visible', timeout: 12_000 });
  await button.click();
  await sleep(500);
};

/* --- diyalog yardımcıları -------------------------------------------------- */

const installDialogs = (page) => page.locator('[role="dialog"]').filter({ hasText: 'kurulacak' });

const isInstallDialogVisible = async (page) => {
  const dialogs = installDialogs(page);
  const count = await dialogs.count();
  for (let i = 0; i < count; i += 1) {
    if (await dialogs.nth(i).isVisible().catch(() => false)) return true;
  }
  return false;
};

const waitForInstallDialog = async (page, timeoutMs = 15_000) => {
  const dialogs = installDialogs(page);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const count = await dialogs.count();
    for (let i = 0; i < count; i += 1) {
      const dialog = dialogs.nth(i);
      if (await dialog.isVisible().catch(() => false)) return dialog;
    }
    if (Date.now() > deadline) return null;
    await sleep(300);
  }
};

const readDialog = async (dialog, label) => {
  const text = await dialog.innerText().catch(() => '');
  const size = text.match(/indirilecek:[^\n]*/);
  return {
    title: (text.split('\n')[0] ?? '').trim(),
    text,
    hasLabel: text.includes(label),
    hasSize: /\d+\s*MB/.test(text) || text.includes('boyut bilinmiyor'),
    sizeText: size ? size[0].trim() : null,
    indir: await dialog.getByRole('button', { name: 'İndir', exact: true }).isVisible().catch(() => false),
    iptal: await dialog.getByRole('button', { name: 'İptal', exact: true }).isVisible().catch(() => false),
    kapat: await dialog.getByRole('button', { name: 'Kapat', exact: true }).isVisible().catch(() => false),
  };
};

const closeInstallDialog = async (page) => {
  const dialog = installDialogs(page).first();
  const kapat = dialog.getByRole('button', { name: 'Kapat', exact: true });
  if (await kapat.isVisible().catch(() => false)) await kapat.click().catch(() => {});
  else await page.keyboard.press('Escape').catch(() => {});
  await waitUntil(async () => !(await isInstallDialogVisible(page)), 8_000, 200);
};

/* --- önek taraması --------------------------------------------------------- */
// Önekin sızabileceği ÜÇ yüzey ayrı ayrı sayılır: görünür metin (innerText),
// diyalog metinleri ve HTML serileştirmesi (page.content() ile eşdeğer). Amaç
// "önek hiçbir render noktasında yok" iddiasını ölçülebilir kılmak.
const scanMarker = (page) =>
  page.evaluate((marker) => {
    const countIn = (value) => (value ? value.split(marker).length - 1 : 0);
    const bodyText = document.body?.innerText ?? '';
    const dialogTexts = Array.from(
      document.querySelectorAll('[role="dialog"], [data-slot="dialog-content"]'),
    ).map((node) => node.innerText ?? '');
    const html = document.documentElement?.outerHTML ?? '';
    return {
      bodyCount: countIn(bodyText),
      dialogCount: dialogTexts.reduce((total, text) => total + countIn(text), 0),
      htmlCount: countIn(html),
      dialogTexts,
    };
  }, MARKER);

const markerClean = (scan) => scan.bodyCount === 0 && scan.dialogCount === 0 && scan.htmlCount === 0;
const markerDetail = (scan) =>
  `gövde=${scan.bodyCount} · diyalog=${scan.dialogCount} · html=${scan.htmlCount}`;

/* --- senaryo koşucu -------------------------------------------------------- */

/**
 * Gerçek arayüzden bir eylem tetikler ve kurulum diyaloğunu doğrular.
 * Diyaloğu KAPATIR (İndir'e basmaz) — ağır indirme yalnız retry senaryosunda.
 */
const dialogScenario = async (ctx, { name, open, trigger, label = COMPONENT_ID, triggerLabel = null }) => {
  const { page, report, artifact } = ctx;
  const entry = {
    name,
    uiDriven: true,
    trigger: triggerLabel,
    dialogFound: false,
    dialog: null,
    markerScan: null,
  };
  try {
    await open();
    await trigger();
    const dialog = await waitForInstallDialog(page, 15_000);
    if (!dialog) {
      report(`${name}: kurulum diyaloğu açıldı`, false, 'diyalog görünmedi');
      entry.markerScan = await scanMarker(page);
      report(`${name}: önek DOM'da YOK`, markerClean(entry.markerScan), markerDetail(entry.markerScan));
      artifact.screens.push(entry);
      return null;
    }
    entry.dialogFound = true;
    const info = await readDialog(dialog, label);
    entry.dialog = info;
    report(`${name}: kurulum diyaloğu görünür`, true, info.title);
    report(`${name}: etiket "${label}" diyalogda`, info.hasLabel);
    report(`${name}: boyut bilgisi görünüyor`, info.hasSize, info.sizeText ?? '(yok)');
    report(`${name}: İndir düğmesi görünüyor`, info.indir);
    entry.markerScan = await scanMarker(page);
    report(`${name}: önek DOM'da YOK`, markerClean(entry.markerScan), markerDetail(entry.markerScan));
    artifact.screens.push(entry);
    await closeInstallDialog(page);
    return entry;
  } catch (error) {
    const message = String(error?.message ?? error);
    entry.error = message;
    artifact.screens.push(entry);
    report(`${name}: senaryo tamamlandı`, false, message);
    await closeInstallDialog(page).catch(() => {});
    return null;
  }
};

/* --- adımlar --------------------------------------------------------------- */

const stepBaseline = async (ctx) => {
  const { page, report, artifact } = ctx;
  const status = await getComponents(page);
  const ffmpeg = findById(status, COMPONENT_ID);
  const ffprobe = findById(status, 'ffprobe');
  const whisper = findById(status, 'whisper');

  artifact.availability.before = { ffmpeg: pick(ffmpeg), ffprobe: pick(ffprobe), whisper: pick(whisper) };

  /*
   * Taban artık bir ÖN KOŞUL değil, kayıt: 7d'den sonra ffmpeg gömülü gelmiyor,
   * yani "kurulu değil" doğru başlangıçtır. Sonda zaten hiçbir şey gölgelemeden
   * gerçek "hiç ffmpeg yok" durumunu sınıyor — bu daha güçlü bir sınama.
   * Ölçüt "kurulu olmalı" değil, "bulunan durum kaydedildi".
   */
  report('taban: ffmpeg durumu kaydedildi', true, `installed=${ffmpeg?.installed} (7d: gömülü gelmez)`);
  report('taban: ffprobe durumu kaydedildi', true, `installed=${ffprobe?.installed} (7d: gömülü gelmez)`);
  // 7c-3: whisper artık kayıtta pinli indirme kaynağı taşır → Bileşenler'den
  // kurulabilir; arayüzdeki kurulum kapısı da ffmpeg ile aynı akıştan geçer.
  report(
    'taban: whisper indirilebilir (downloadable=true; 7c-3)',
    whisper?.downloadable === true,
    `downloadable=${whisper?.downloadable}`,
  );
  report(
    'taban: ffmpeg indirilebilir (downloadable=true)',
    ffmpeg?.downloadable === true,
    `downloadable=${ffmpeg?.downloadable}`,
  );
};

const stepHide = async (ctx) => {
  const { page, report, state, artifact } = ctx;
  const pathResult = await invokeRaw(page, 'components_path', undefined);
  if (!pathResult.ok) throw new Error(`components_path alınamadı: ${pathResult.error}`);
  state.componentsDir = String(pathResult.value);
  state.downloadDir = await getDownloadDir(page);

  // yt-dlp, `--ffmpeg-location` dizininde DÜZ adlı ffmpeg.exe/ffprobe.exe arar;
  // bu kopyalar kayıt boş olsa bile "eksik" durumunu maskeler → onlar da gizlenir.
  const extra = [];
  if (state.downloadDir) {
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) {
      const path = join(state.downloadDir, '.tools', name);
      if (existsSync(path)) extra.push({ from: path, kind: 'tools' });
    }
  }

  const plan = planShadows({ exeDir: state.exeDir, componentsDir: state.componentsDir, extra });
  state.backupDir = ensureOutDir(join('clean-profile-backup', `${STAMP}-gate`));
  console.log(`temiz profil: ${plan.length} gölge dosya yedeklenecek → ${state.backupDir}`);
  state.backupEntries = backupShadows(plan, state.backupDir);
  writeManifest(state.backupDir, state.backupEntries);
  state.pristine = new Set(readdirSync(state.componentsDir));

  const after = await getComponents(page);
  const ffmpeg = findById(after, COMPONENT_ID);
  const ffprobe = findById(after, 'ffprobe');
  artifact.cleanProfile = {
    exeDir: state.exeDir,
    exeDirHow: state.exeHow,
    componentsDir: state.componentsDir,
    downloadDir: state.downloadDir,
    toolsHidden: extra.map((entry) => entry.from),
    backedUp: state.backupEntries,
    after: { ffmpeg: pick(ffmpeg), ffprobe: pick(ffprobe) },
  };
  report('gizlendi: ffmpeg artık kurulu DEĞİL', ffmpeg?.installed === false, `installed=${ffmpeg?.installed}`);
  report('gizlendi: ffprobe artık kurulu DEĞİL', ffprobe?.installed === false, `installed=${ffprobe?.installed}`);
};

const stepSeed = async (ctx) => {
  const { page, report, state, artifact } = ctx;
  const dbPath = await getDatabasePath(page);
  state.dbPath = dbPath;

  // İki farklı gerçek dosya: MergeTool aynı yolu iki kez kuyruğa almaz.
  const inputA = join(state.tmpDir, 'gate-probe-a.wav');
  const inputB = join(state.tmpDir, 'gate-probe-b.wav');
  writeFileSync(inputA, makeSilentWav());
  writeFileSync(inputB, makeSilentWav());
  state.inputA = inputA;
  state.inputB = inputB;

  const iso = new Date().toISOString();
  state.seedRows = [
    { id: `gate-probe-${STAMP}-a`, url: 'https://example.invalid/gate-a', title: TITLE_A, localPath: inputA, createdAt: iso },
    { id: `gate-probe-${STAMP}-b`, url: 'https://example.invalid/gate-b', title: TITLE_B, localPath: inputB, createdAt: iso },
  ];
  state.seedIds = state.seedRows.map((row) => row.id);

  const db = new DatabaseSync(dbPath);
  try {
    const insert = db.prepare(
      `INSERT INTO items (id,url,title,note,platform,thumbnail,favorite,collection_id,user_id,
        local_path,download_status,download_error,converted_path,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const row of state.seedRows) {
      insert.run(row.id, row.url, row.title, null, 'other', null, 0, null, null, row.localPath, 'done', null, null, row.createdAt, row.createdAt);
    }
    const check = db.prepare('SELECT COUNT(*) AS n FROM items WHERE id IN (?, ?)').get(state.seedIds[0], state.seedIds[1]);
    report('tohum: iki test kaynağı kasaya yazıldı', check.n === 2, `db=${dbPath} · yazılan=${check.n}`);
  } finally {
    db.close();
  }

  artifact.seed = {
    dbPath,
    itemIds: state.seedIds,
    inputs: [inputA, inputB],
    note: 'Yalnızca test düzeneği; kapıyı gerçek arayüz tıklaması tetikler. finally içinde silinir.',
  };
};

/**
 * İndir/İptal kanıtı: diyaloğu aç, İndir'e bas, İptal'in/ilerlemenin belirdiğini
 * gör, İptal et. Ağır indirmeyi bitirmez — bu yüzden --quick'te de koşar.
 */
const stepInstallCancel = async (ctx) => {
  const { page, report, artifact, shot } = ctx;
  const entry = {
    name: 'Dönüştürücü — dönüştür (İndir + İptal kanıtı)',
    uiDriven: true,
    trigger: 'MP3 + "Dönüştür" düğmesi (gerçek arayüz)',
    dialogFound: false,
    dialog: null,
    iptalReached: false,
    markerScan: null,
  };
  try {
    await openConverter(page);
    await selectSource(page, TITLE_A);
    await page.getByRole('group', { name: 'İşlem' }).getByRole('button', { name: 'MP3', exact: true }).click();
    await page.getByRole('button', { name: 'Dönüştür', exact: true }).first().click();

    const dialog = await waitForInstallDialog(page, 15_000);
    if (!dialog) {
      report('Dönüştürücü (İndir/İptal): kurulum diyaloğu açıldı', false, 'diyalog görünmedi');
      entry.markerScan = await scanMarker(page);
      artifact.screens.push(entry);
      return;
    }
    entry.dialogFound = true;
    entry.dialog = await readDialog(dialog, COMPONENT_ID);
    report('Dönüştürücü (İndir/İptal): diyalog görünür', true, entry.dialog.title);
    report('Dönüştürücü (İndir/İptal): etiket + boyut görünüyor', entry.dialog.hasLabel && entry.dialog.hasSize, entry.dialog.sizeText ?? '');
    report('Dönüştürücü (İndir/İptal): İndir düğmesi görünüyor', entry.dialog.indir);
    entry.markerScan = await scanMarker(page);
    report('Dönüştürücü (İndir/İptal): önek DOM\'da YOK (İndir öncesi)', markerClean(entry.markerScan), markerDetail(entry.markerScan));
    await shot('component-gate-dialog.png');

    await dialog.getByRole('button', { name: 'İndir', exact: true }).click();
    entry.iptalReached = await waitUntil(
      () => dialog.getByRole('button', { name: 'İptal', exact: true }).isVisible().catch(() => false),
      30_000,
      250,
    );
    report('Dönüştürücü (İndir/İptal): indirme başlayınca İptal + ilerleme göründü', entry.iptalReached, entry.iptalReached ? 'İptal görünür' : 'İptal belirmedi (ağ hatası olabilir)');
    await shot('component-gate-running.png');

    if (entry.iptalReached) {
      await dialog.getByRole('button', { name: 'İptal', exact: true }).click();
      const settled = await waitUntil(
        () => dialog.getByRole('button', { name: 'Kapat', exact: true }).isVisible().catch(() => false),
        60_000,
        300,
      );
      const alertCount = await dialog.locator('[role="alert"]').count();
      report('Dönüştürücü (İndir/İptal): iptal hata sayılmadı (hata alanı boş)', settled && alertCount === 0, `oturdu=${settled} · role=alert=${alertCount}`);
    }
    await closeInstallDialog(page);
  } catch (error) {
    const message = String(error?.message ?? error);
    entry.error = message;
    report('Dönüştürücü (İndir/İptal): senaryo tamamlandı', false, message);
    await closeInstallDialog(page).catch(() => {});
  }
  artifact.screens.push(entry);
};

/**
 * Altyazı aracı (7c-3 sözleşmesi).
 *
 * Kurulum diyaloğu AÇILIR — ffmpeg de whisper da aynı ortak akıştan geçer:
 * - Motor çalışıyorsa (`whisper_available=true`) transkript önce ffmpeg ister →
 *   ffmpeg kurulum diyaloğu açılır.
 * - Motor eksikse backend `BILESEN_EKSIK:whisper` döner → whisper kurulum
 *   diyaloğu açılır. 7c-3'ten ÖNCEKİ "ölü diyalog yok, yalnız dürüst metin" dalı
 *   KALDIRILDI; bu yüzden artık burada diyalog BEKLENİR (eski dal artık yanlıştı).
 *
 * Tek istisna model ön kontrolüdür: seçili model diskte yoksa arayüz backend'e
 * gitmeden okunabilir bir uyarı gösterir (diyalog yok). Bu, whisper kapısının
 * ulaşılamadığı dürüst bir durumdur → "atlandı/kanıtlanmadı" yazılır, GEÇTİ değil.
 */
const stepSubtitleTool = async (ctx) => {
  const { page, report, skip, artifact, shot } = ctx;
  const status = await readWhisperStatus(page);
  const whisperAvailable = status?.whisper_available === true;
  // Arayüz `getWhisperModel()` ile aynı kural: yalnız "tiny"/"small" seçilir, aksi "base".
  const rawModel = await page
    .evaluate(() => window.localStorage.getItem('jv-whisper-model') ?? 'base')
    .catch(() => 'base');
  const selectedModel = rawModel === 'tiny' || rawModel === 'small' ? rawModel : 'base';
  const modelReady = status?.models?.[selectedModel] === true;
  const entry = {
    uiDriven: true,
    whisperAvailable,
    selectedModel,
    modelReady,
    mode: whisperAvailable
      ? 'ffmpeg kapısı (motor kullanılabilir)'
      : modelReady
        ? 'whisper kurulum kapısı (motor eksik, model var)'
        : 'model eksik (backend kapısına ulaşılamaz)',
    dialogs: [],
    dialogFound: false,
    guidanceFound: false,
    guidanceText: null,
    markerScan: null,
  };
  artifact.whisper = entry;
  try {
    await openTool(page, 'Altyazı');
    await selectSource(page, TITLE_A);
    await page.getByRole('button', { name: /Transkript üret/ }).first().click();

    // Diyalog YALNIZCA model hazırsa açılabilir: transkript önce modeli arar;
    // model yoksa backend'e hiç gidilmez (dürüst ön kontrol). Sabit `sleep` YOK.
    entry.dialogFound = await waitUntil(
      () => isInstallDialogVisible(page),
      modelReady ? 20_000 : 4_000,
      300,
    );

    if (modelReady && whisperAvailable) {
      // Motor çalışıyor: transkript önce ffmpeg ister → ffmpeg kapısı beklenir.
      const dialog = await waitForInstallDialog(page, 15_000);
      if (dialog) {
        const info = await readDialog(dialog, COMPONENT_ID);
        entry.dialogs.push({ trigger: 'Transkript üret', expected: COMPONENT_ID, dialog: info });
        report('Altyazı (transkript): ffmpeg kurulum diyaloğu açıldı', info.hasLabel && info.indir, info.sizeText ?? '');
        const scan = await scanMarker(page);
        report('Altyazı (transkript): önek DOM\'da YOK', markerClean(scan), markerDetail(scan));
        await closeInstallDialog(page);
      } else {
        report('Altyazı (transkript): ffmpeg kurulum diyaloğu açıldı', false, 'diyalog görünmedi');
      }
    } else if (modelReady) {
      // 7c-3 manşeti: whisper artık indirilebilir → kurulum diyaloğu beklenir.
      const dialog = await waitForInstallDialog(page, 15_000);
      if (dialog) {
        const info = await readDialog(dialog, WHISPER_LABEL);
        entry.dialogs.push({ trigger: 'Transkript üret', expected: 'whisper', dialog: info });
        report('whisper: kurulum diyaloğu açıldı (indirilebilir)', info.hasLabel && info.indir, info.sizeText ?? '');
        const scan = await scanMarker(page);
        report('whisper: önek DOM\'da YOK', markerClean(scan), markerDetail(scan));
        await shot('component-gate-whisper-dialog.png');
        await closeInstallDialog(page);
      } else {
        report('whisper: kurulum diyaloğu açıldı (indirilebilir)', false, 'diyalog görünmedi');
      }
    } else {
      // Model yok: arayüz backend'e gitmeden dürüst uyarı gösterir; whisper kapısı
      // bu ortamda SÜRÜLEMEZ → kanıtlanmadı (GEÇTİ sayılmaz).
      const modelBody = await page.evaluate(() => document.body?.innerText ?? '');
      const modelLine = modelBody.split(/\r?\n/).find((l) => /modeli indirilmedi/i.test(l)) ?? null;
      report(
        'whisper: model eksikken dürüst uyarı görünüyor (diyalog yok)',
        Boolean(modelLine) && !entry.dialogFound,
        modelLine ?? '(cümle bulunamadı)',
      );
      skip('whisper: motor eksikken kurulum diyaloğu açılır', `seçili model "${selectedModel}" indirilmemiş; backend kapısına ulaşılamıyor`);
    }

    // Eski "dürüst yönlendirme" (Ayarlar → Konuşma) dalı 7c-3'te KALDIRILDI:
    // hiçbir koşulda o metin görünmemeli.
    const body = await page.evaluate(() => document.body?.innerText ?? '');
    const legacyLine = body.split(/\r?\n/).find((l) => /kurulu değil/i.test(l) && /Konuşma/i.test(l)) ?? null;
    entry.guidanceFound = Boolean(legacyLine);
    entry.guidanceText = legacyLine;
    report('whisper: eski tek-yönlendirme metni DOM\'da YOK (dal kaldırıldı)', !legacyLine, legacyLine ?? '(yok)');

    // Göm/Çıkar YALNIZCA ffmpeg ister (whisper ön kontrolü yok) → her ortamda
    // ffmpeg kapısına ulaşır ve kurulum diyaloğunu açar.
    await page.getByRole('button', { name: /Altyazıyı çıkar/ }).first().click();
    const dialog = await waitForInstallDialog(page, 15_000);
    if (dialog) {
      const info = await readDialog(dialog, COMPONENT_ID);
      entry.dialogs.push({ trigger: 'Altyazıyı çıkar', expected: COMPONENT_ID, dialog: info });
      report('Altyazı (çıkar): ffmpeg kurulum diyaloğu açıldı', info.hasLabel && info.indir, info.sizeText ?? '');
      const scan = await scanMarker(page);
      report('Altyazı (çıkar): önek DOM\'da YOK', markerClean(scan), markerDetail(scan));
      await closeInstallDialog(page);
    } else {
      report('Altyazı (çıkar): ffmpeg kurulum diyaloğu açıldı', false, 'diyalog görünmedi');
    }
  } catch (error) {
    const message = String(error?.message ?? error);
    entry.error = message;
    report('whisper/altyazı: senaryo tamamlandı', false, message);
    await closeInstallDialog(page).catch(() => {});
  }
};

/** Gerçek indirmeyi yapar ve kurulum sonrası orijinal eylemin yeniden denendiğini doğrular. */
const stepRetry = async (ctx) => {
  const { page, report, artifact, state, shot } = ctx;
  const jobStarted = Date.now();
  const entry = { ran: false, installed: false, retried: false, outputPath: mp3OutputPath(state.inputA), outputExists: false, elapsedMs: null, error: null };
  artifact.retry = entry;

  try {
    await openConverter(page);
    await selectSource(page, TITLE_A);
    await page.getByRole('group', { name: 'İşlem' }).getByRole('button', { name: 'MP3', exact: true }).click();
    await page.getByRole('button', { name: 'Dönüştür', exact: true }).first().click();

    const dialog = await waitForInstallDialog(page, 15_000);
    if (!dialog) {
      entry.error = 'yeniden deneme: kurulum diyaloğu açılmadı';
      report('yeniden deneme: kurulum diyaloğu açıldı', false, entry.error);
      return;
    }
    entry.ran = true;
    await dialog.getByRole('button', { name: 'İndir', exact: true }).click();
    // Kurulum (indirme + doğrulama + çıkarma) tamamlanınca diyalog kendiliğinden kapanır.
    const closed = await waitUntil(async () => !(await isInstallDialogVisible(page)), 20 * 60_000, 2000);
    entry.elapsedMs = Date.now() - jobStarted;
    entry.installed = closed;
    report('yeniden deneme: gerçek kurulum tamamlandı (diyalog kapandı)', closed, closed ? `${Math.round(entry.elapsedMs / 1000)} sn` : 'zaman aşımı / hata');
    if (!closed) {
      await shot('component-gate-retry-failed.png');
      return;
    }

    // Kurulum başarısı → onInstalled → orijinal dönüştürme otomatik yeniden koşar.
    const outputsVisible = await waitUntil(
      async () => (await page.getByText('Bu oturumda üretilenler').count()) > 0,
      120_000,
      1000,
    );
    entry.outputExists = await waitUntil(() => existsSync(entry.outputPath), 120_000, 1000);
    entry.retried = outputsVisible || entry.outputExists;
    report(
      'yeniden deneme: orijinal eylem otomatik yeniden denendi ve sonuç üretti',
      entry.retried,
      `liste=${outputsVisible} · dosya=${entry.outputExists} · ${entry.outputPath}`,
    );
    const scan = await scanMarker(page);
    report('yeniden deneme: önek DOM\'da YOK', markerClean(scan), markerDetail(scan));
    await shot('component-gate-retry-ok.png');
  } catch (error) {
    entry.error = String(error?.message ?? error);
    report('yeniden deneme: senaryo tamamlandı', false, entry.error);
    await closeInstallDialog(page).catch(() => {});
  }
};

const stepGlobalMarkerScan = async (ctx) => {
  const { page, report, artifact } = ctx;
  const scan = await scanMarker(page);
  const content = await page.content().catch(() => '');
  const contentCount = content.split(MARKER).length - 1;
  artifact.markerScan = {
    scope: [
      'document.body.innerText',
      '[role="dialog"] / [data-slot="dialog-content"] innerText',
      'document.documentElement.outerHTML',
      'page.content() (tüm HTML)',
    ],
    ...scan,
    contentCount,
  };
  report('önek taraması (küresel): BILESEN_EKSIK DOM\'da YOK', markerClean(scan) && contentCount === 0, `${markerDetail(scan)} · page.content()=${contentCount}`);
};

const stepRestored = async (ctx) => {
  const { page, report, state, artifact } = ctx;
  const restored = state.restoreReport?.restored ?? [];
  /*
   * 7d'den sonra gömülü ffmpeg YOK — yani gölgelenecek dosya da yok. Bu bir hata
   * DEĞİL, daha GÜÇLÜ bir temiz profil: sonda hiçbir şeyi gizlemeden gerçek
   * "hiç ffmpeg yok" durumunu sınıyor. Ölçüt bu yüzden "en az bir yedek" değil,
   * "yedeklenen ne varsa hepsi geri kondu".
   */
  report(
    'geri yükleme: yedeklenen her dosya eski yerine kondu',
    restored.every((entry) => entry.restored),
    restored.length > 0
      ? `${restored.filter((entry) => entry.restored).length}/${restored.length}`
      : 'gölgelenecek dosya yok (7d: gömülü ffmpeg artık repoda değil) — daha güçlü temiz profil',
  );
  const status = await getComponents(page);
  const ffmpeg = findById(status, COMPONENT_ID);
  const ffprobe = findById(status, 'ffprobe');
  artifact.availability.after = { ffmpeg: pick(ffmpeg), ffprobe: pick(ffprobe) };

  /*
   * Doğru değişmez "ffmpeg kurulu olmalı" DEĞİL, "makine bulunduğu gibi
   * bırakılmalı". Sonda kendi indirdiğini temizler; geriye taban durumu kalır.
   */
  const before = artifact.availability.before ?? {};
  const sameAsFound = (id) =>
    Boolean(before[id]?.installed) === Boolean(findById(status, id)?.installed);
  report(
    'geri sonrası: makine bulunduğu gibi bırakıldı (ffmpeg)',
    sameAsFound(COMPONENT_ID),
    `önce=${before[COMPONENT_ID]?.installed} · sonra=${ffmpeg?.installed}`,
  );
  report(
    'geri sonrası: makine bulunduğu gibi bırakıldı (ffprobe)',
    sameAsFound('ffprobe'),
    `önce=${before.ffprobe?.installed} · sonra=${ffprobe?.installed}`,
  );
};

/* --- regresyon ------------------------------------------------------------- */

const stepRegressions = (ctx) => {
  const { report, artifact } = ctx;
  const commands = [
    { name: 'verify:components', line: 'npm run verify:components' },
    { name: 'verify:component-download --quick', line: 'npm run verify:component-download -- --quick' },
    { name: 'verify:missing-component', line: 'npm run verify:missing-component' },
  ];
  const out = [];
  for (const entry of commands) {
    const result = spawnSync(entry.line, { cwd: PROJECT_ROOT, shell: true, encoding: 'utf8', timeout: 20 * 60_000 });
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    const tail = text.split(/\r?\n/).slice(-5);
    out.push({ name: entry.name, command: entry.line, status: result.status, ok: result.status === 0, tail });
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
  await sleep(1500);

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

  const exeInfo = findAppExeDir();
  console.log(`exe klasörü: ${exeInfo.dir} (${exeInfo.how})`);
  if (!RUN_REAL_DOWNLOAD) {
    console.log('HIZLI MOD: gerçek ~186 MB indirme ve kurulum sonrası yeniden deneme ATLANDI.');
  }

  const startedAt = Date.now();
  const state = {
    exeDir: exeInfo.dir,
    exeHow: exeInfo.how,
    componentsDir: null,
    downloadDir: null,
    backupDir: null,
    backupEntries: [],
    pristine: new Set(),
    removed: [],
    restoreReport: null,
    cleaned: false,
    tmpDir,
    dbPath: null,
    seedRows: [],
    seedIds: [],
    inputA: null,
    inputB: null,
  };
  const artifact = {
    kind: 'component-gate-probe',
    synthetic: false,
    note: 'Faz 7c-2/7c-3: ffmpeg gizliyken arayüzden tetiklenen eksik bileşen diyaloğu (etiket+boyut+İndir/İptal), önek DOM\'da yok, whisper artık indirilebilir olduğu için aynı kurulum diyaloğunu açıyor ve (gerçek indirme koşulursa) kurulum sonrası otomatik yeniden deneme.',
    capturedAt: new Date().toISOString(),
    appUrl: page.url(),
    quick: quickFlag,
    realDownloadRequested: RUN_REAL_DOWNLOAD,
    exeDir: exeInfo.dir,
    exeDirHow: exeInfo.how,
    availability: { before: null, after: null },
    cleanProfile: null,
    seed: null,
    screens: [],
    notDriven: [],
    whisper: null,
    retry: null,
    regressions: { ran: false, commands: [
      'npm run verify:components',
      'npm run verify:component-download -- --quick',
      'npm run verify:missing-component',
    ] },
    markerScan: null,
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
    await dismissOverlays(page);
    await stepBaseline(ctx);
    await stepHide(ctx);
    await stepSeed(ctx);

    // 1) İndir/İptal kanıtı (diyalog + İndir + ilerleme/İptal) — ağır indirme bitmez.
    await stepInstallCancel(ctx);

    // 2) Diğer ekranlar: diyalog açılışı + önek taraması (İndir'e basılmaz).
    await dialogScenario(ctx, {
      name: 'Dönüştürücü — kırpma önizlemesi (media_probe)',
      open: () => openConverter(page),
      trigger: async () => {
        await selectSource(page, TITLE_A);
        await page.getByRole('group', { name: 'İşlem' }).getByRole('button', { name: 'Kırp', exact: true }).click();
      },
      triggerLabel: '"Kırp" sekmesi → media_probe (gerçek arayüz)',
    });
    await dialogScenario(ctx, {
      name: 'Birleştir (merge_media)',
      open: () => openTool(page, 'Birleştir'),
      trigger: async () => {
        const addButtons = page.getByRole('button', { name: /dosyasını sıraya ekle/ });
        await addButtons.nth(0).click();
        await addButtons.nth(1).click();
        await page.getByRole('button', { name: 'Birleştir', exact: true }).first().click();
      },
      triggerLabel: '2 kaynak +"Birleştir" (gerçek arayüz)',
    });
    await dialogScenario(ctx, {
      name: 'Sessizlik Kırpma (trim_silence)',
      open: () => openTool(page, 'Sessizlik Kırpma'),
      trigger: async () => {
        await selectSource(page, TITLE_A);
        await page.getByRole('button', { name: 'Temizle', exact: true }).first().click();
      },
      triggerLabel: '"Temizle" (gerçek arayüz)',
    });
    await dialogScenario(ctx, {
      name: 'GIF / WebM — kırpma önizlemesi (media_probe)',
      open: () => openTool(page, 'GIF / WebM'),
      trigger: () => selectSource(page, TITLE_A),
      triggerLabel: 'kaynak seçimi → TrimEditor media_probe (gerçek arayüz)',
    });

    // 3) Altyazı: motor eksikse whisper kurulum kapısı, motor varsa ffmpeg kapısı
    //    (7c-3: whisper artık indirilebilir; eski "yalnız dürüst metin" dalı YOK).
    //    Model eksikse arayüz dürüst model uyarısında durur (atlandı olarak yazılır).
    await stepSubtitleTool(ctx);

    // 4) Küresel önek taraması.
    await stepGlobalMarkerScan(ctx);

    // 5) Gerçek indirme + kurulum sonrası otomatik yeniden deneme (yalnız gerçek modda).
    if (RUN_REAL_DOWNLOAD) {
      await stepRetry(ctx);
    } else {
      artifact.retry = {
        skipped: true,
        reason: quickFlag ? '--quick' : 'JV_REAL_DOWNLOAD=0',
        unproven: 'gerçek kurulum sonrası orijinal eylemin otomatik yeniden denemesi',
      };
      skip('yeniden deneme: kurulum sonrası orijinal eylem otomatik başarılı', 'gerçek indirme atlandı');
      skip('gerçek indirme: ffmpeg + ffprobe kuruldu (downloaded)', 'gerçek indirme atlandı');
    }

    artifact.notDriven = [
      {
        screen: 'EditorDialog (Kırp) — kart eyleminden açılan diyalog',
        reason: 'Arşiv kartındaki "Dönüştür/Kırp" eylemi sürülmez; aynı TrimEditor media_probe kod yolu Dönüştürücü "Kırp" senaryosuyla kapsanır.',
      },
      {
        screen: 'GIF / WebM — kendi "Üret" (make_gif) kapısı',
        reason: 'media_probe başarısızken aralık 0/0 kaldığından "Üret" yerel doğrulamaya düşer ve kapıya ulaşmaz; GifTool yalnız media_probe kapısına kadar sürülür.',
      },
      {
        screen: 'downloads.ts → DB → DownloadsView/ItemViews/ItemRecord (saklanan ham sinyalin çözülmesi)',
        reason: 'Gerçek bir download_media hatası gerektirir; sonda bu yolu sürmez. Render sınırındaki çözümleme statik olarak denetlendi.',
      },
    ];
    // 7c-3: whisper artık indirilebilir olduğundan motor eksikken transkript
    // whisper kurulum diyaloğunu açar; göm/çıkar ise her ortamda ffmpeg kapısına
    // ulaşır (yukarıda sürüldü). Eski guardReady notu bu yüzden KALDIRILDI.
    // Yalnızca seçili model diskte yoksa backend kapısı sürülemez → dürüstçe bildir.
    if (artifact.whisper && artifact.whisper.mode === 'model eksik (backend kapısına ulaşılamaz)') {
      artifact.notDriven.push({
        screen: 'Altyazı — transkript whisper kurulum kapısı (transcribe → BILESEN_EKSIK:whisper)',
        reason: `Seçili whisper modeli ("${artifact.whisper.selectedModel}") diskte yok; arayüz model ön kontrolünde durur ve backend kapısına ulaşılmaz. Bu bir kusur değil, dürüst ön kontroldür; dal kanıtlanmadı.`,
      });
    }
  } catch (error) {
    const message = String(error?.stack ?? error?.message ?? error);
    errors.push({ step: 'fatal', message });
    report('sonda hatasız tamamlandı', false, String(error?.message ?? error));
    console.error(message);
  } finally {
    // Tohum kayıtları ÖNCE silinir (kasada iz bırakmasın), sonra gölgeler geri konur.
    try {
      if (state.dbPath && state.seedIds.length > 0) {
        const db = new DatabaseSync(state.dbPath);
        try {
          const del = db.prepare('DELETE FROM items WHERE id = ?');
          for (const id of state.seedIds) del.run(id);
          const left = db.prepare('SELECT COUNT(*) AS n FROM items WHERE id IN (?, ?)').get(state.seedIds[0], state.seedIds[1]);
          report('temizlik: tohum kayıtları silindi', left.n === 0, `kalan=${left.n}`);
        } finally {
          db.close();
        }
      }
    } catch (error) {
      const message = String(error?.message ?? error);
      errors.push({ step: 'seed-cleanup', message });
      report('temizlik: tohum kayıtları silindi', false, message);
      console.error(`tohum temizliği hatası: ${message}`);
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
  artifact.timings = { totalMs: Date.now() - startedAt };
  artifact.cleanProfile = {
    ...(artifact.cleanProfile ?? {}),
    exeDir: state.exeDir,
    exeDirHow: state.exeHow,
    componentsDir: state.componentsDir,
    downloadDir: state.downloadDir,
    backupDir: state.backupDir,
    backedUp: state.backupEntries,
    removedTestArtifacts: state.removed,
    restore: state.restoreReport,
  };

  try {
    writeFileSync(resolve(OUT_DIR, 'component-gate-probe.json'), JSON.stringify(artifact, null, 2), 'utf8');
    console.log('\nprovenance: component-gate-probe.json + component-gate-dialog.png + component-gate-whisper-dialog.png');
  } catch (error) {
    const message = String(error?.message ?? error);
    errors.push({ step: 'artifact', message });
    console.error(`artifact yazılamadı: ${message}`);
  }

  const failed = results.filter((entry) => !entry.ok).length;
  console.log(
    failed === 0 && errors.length === 0
      ? `\nSONUÇ: tüm kontroller GEÇTİ${skips.length > 0 ? ` (${skips.length} kontrol ATLANDI — kanıtlanmadı)` : ''}`
      : `\nSONUÇ: ${failed} kontrol KALDI · ${errors.length} hata${skips.length > 0 ? ` · ${skips.length} atlandı` : ''} (artifact: dev/out/component-gate-probe.json)`,
  );
  return endProbe(failed === 0 && errors.length === 0 ? 0 : 1);
};

await main();
