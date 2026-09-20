/*
 * Bileşen indirme sondası — üretim kodu DEĞİL.
 *
 * NE KANITLAR: `component_download.rs` motorunun (Faz 7b) gerçek yollarda doğru
 * davrandığını — pin bütünlüğü, çevrimdışı red, sha256 reddi, iptal temizliği ve
 * bir kez GERÇEK tam indirme.
 *
 * NEDEN "TEMİZ PROFİL" TAKLİT EDİLİR (betiğin kalbi):
 * `component_download`, bileşen zaten ÇÖZÜLÜYORSA indirmeye hiç başlamadan başarı
 * döner. `resolve()` ise önce indirilenler klasörüne, sonra UYGULAMANIN YANINDAKİ
 * gömülü sidecar'a bakar (`target/debug/ffmpeg.exe` / `ffmpeg-x86_64-...exe`).
 * Normal bir geliştirme makinesinde gömülü dosya HEP vardır; bu yüzden gerçek
 * indirme yolu ASLA çalışmaz ve sonda hiçbir şey kanıtlamaz.
 *
 * Çözüm: sonda başında, indirmeyi GÖLGELEYEBİLECEK her dosya (exe klasöründeki
 * gömülü sidecar'lar + bileşenler klasöründeki indirilmiş kopyalar) geçici bir
 * yedeğe TAŞINIR (silinmez). Böylece `resolve()` boş döner ve indirme yolu açılır.
 * Sonda sonunda — `finally` içinde — test kendi indirdiklerini SİLER, sonra TÜM
 * yedekleri ESKİ YERİNE geri taşır. Makine tam olarak bulunduğu gibi bırakılır.
 * Geri yüklenemeyen bir yedek olursa bu GÜRÜLTÜLÜ biçimde bildirilir: sessiz veri
 * kaybı kabul edilemez.
 *
 * Kullanım:
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev            # pencere açıldıktan sonra:
 *   npm run verify:component-download              # gerçek ~186 MB indirme DAHİL
 *   npm run verify:component-download -- --quick   # yalnız hızlı yollar (indirme YOK)
 *
 * Bayraklar / ortam değişkenleri:
 *   --quick              yalnız adım 6'yı (gerçek indirme) atlar
 *   JV_REAL_DOWNLOAD=1   gerçek indirmeyi ZORLA (--quick'i geçersiz kılar)
 *   JV_REAL_DOWNLOAD=0   gerçek indirmeyi atla
 *   JV_APP_EXE_DIR=...   uygulamanın exe klasörü (otomatik bulunamazsa)
 *   JV_CDP=...           CDP ucu (varsayılan http://127.0.0.1:9222)
 *   JV_OFFLINE_URL=...   çevrimdışı senaryosunun hedefi (varsayılan 127.0.0.1:9)
 *   JV_OUT=...           çıktı klasörü (varsayılan dev/out)
 *
 * Çıkış kodları: 0 tümü geçti · 1 kalan kontrol/hata var · 2 uygulama kapalı.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  OUT_DIR,
  PROJECT_ROOT,
  endProbe,
  ensureOutDir,
  findAppPage,
  waitForCdp,
} from './lib/browser.mjs';
// Temiz profil (gölge dosyaları yedekle/geri koy) TEK yerde yaşar: bu tehlikeli
// dosya-taşıma mantığı `verify-missing-component.mjs` ile paylaşılır. Eskiden bu
// dosyanın içindeydi; davranışı birebir korunur, yalnızca içe aktarılır.
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
// Varsayılan AÇIK: kabul kriteri "bir kez gerçek indirme" istiyor. `--quick`
// atlar; açık bir JV_REAL_DOWNLOAD değeri bayrağı geçersiz kılar (öngörülebilir).
const argv = new Set(process.argv.slice(2));
const quickFlag = argv.has('--quick') || process.env.JV_QUICK === '1';
const realEnv = (process.env.JV_REAL_DOWNLOAD ?? '').toLowerCase();
const forceReal = ['1', 'true', 'yes', 'on'].includes(realEnv);
const forceSkip = ['0', 'false', 'no', 'off'].includes(realEnv);
const RUN_REAL_DOWNLOAD = forceReal ? true : forceSkip ? false : !quickFlag;

/* --- sabitler -------------------------------------------------------------- */
const COMPONENTS_RS = resolve(PROJECT_ROOT, 'src-tauri/src/components.rs');
const GITHUB_API = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags';
// Gölge dosya adları/kuralları artık `lib/clean-profile.mjs` içinde yaşar
// (COMPONENT_SHADOW_NAMES, BUNDLED_BASES, isBundledShadow): iki sonda ortak kullanır.
const OFFLINE_URL = process.env.JV_OFFLINE_URL ?? 'https://127.0.0.1:9/does-not-exist';
const MISMATCH_FALLBACK_URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-20-13-11/checksums.sha256';
const MISMATCH_FILE = 'mismatch-probe.sha256';
const OFFLINE_FILE = 'offline-probe.bin';
const WRONG_SHA256 = '0'.repeat(64);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

/* --- küçük, saf yardımcılar ------------------------------------------------ */

const readPin = (source, constant) => {
  const match = source.match(new RegExp(`${constant}\\s*:\\s*&str\\s*=\\s*"([^"]+)"`));
  return match?.[1] ?? null;
};

const releaseTagOf = (url) => url.match(/\/download\/([^/]+)\//)?.[1] ?? null;

/** Pinlenmiş URL'nin kardeş asset'i (aynı sürüm yolu, farklı dosya adı). */
const siblingAssetUrl = (pinnedUrl, assetName) => pinnedUrl.replace(/\/[^/]+$/, `/${assetName}`);

const findById = (list, id) => (list ?? []).find((c) => c.id === id) ?? null;

const pick = (component) =>
  component
    ? {
        id: component.id,
        installed: component.installed,
        runnable: component.runnable,
        source: component.source,
        version: component.version,
        path: component.path,
        downloadable: component.downloadable,
        bundle: component.bundle,
        framework: component.framework,
      }
    : null;

const pickFf = (list) => ({
  ffmpeg: pick(findById(list, 'ffmpeg')),
  ffprobe: pick(findById(list, 'ffprobe')),
});

const listPartFiles = (dir) => {
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.part'));
  } catch {
    return [];
  }
};

const fmtSeconds = (ms) => `${(ms / 1000).toFixed(1)} sn`;

/* --- CDP / sayfa köprüleri ------------------------------------------------- */

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

const openComponentsSection = async (page) => {
  await page.getByRole('button', { name: 'Ayarlar' }).first().click().catch(() => {});
  await sleep(800);
  await page.getByRole('button', { name: 'Bileşenler' }).first().click().catch(() => {});
  await sleep(700);
};

/*
 * KESİN eşleşme şart. Gevşek `name: 'İndir'` alt-dize eşleştiği için önce yan
 * menüdeki "İndirme Yöneticisi"ni, sonra Ayarlar'daki "İndirme" sekmesini
 * yakalıyordu; `.first()` yan menüye basıp bölümden TAMAMEN çıkıyordu. Bu yüzden
 * ilk koşuda iptal senaryosu sessizce hiç başlamadı (yanlış-pozitif "düğme var").
 */
const downloadButtons = (page) => page.getByRole('button', { name: 'İndir', exact: true });
const cancelButtons = (page) => page.getByRole('button', { name: 'İptal', exact: true });

/**
 * "İndir" düğmesi görünene kadar bekle. Sabit bir bekleme YETMEZ: `Durumu yenile`
 * tıklaması bir yarışta kaybolabilir ya da UI durumu geç yansıtır. Bulunamazsa
 * kör bir "KALDI" yerine ham durumu (backend + görünür düğmeler) döndürür, böylece
 * hata kendini açıklar.
 */
const waitForDownloadButton = async (page, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  let retriedRefresh = false;
  for (;;) {
    if (await downloadButtons(page).first().isVisible().catch(() => false)) {
      return { found: true, diagnostics: null };
    }
    if (Date.now() > deadline) break;
    if (!retriedRefresh && Date.now() > deadline - 8_000) {
      retriedRefresh = true;
      await page
        .getByRole('button', { name: 'Durumu yenile', exact: true })
        .first()
        .click()
        .catch(() => {});
    }
    await sleep(400);
  }
  const status = await invokeRaw(page, 'components_status', undefined);
  const texts = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .filter((b) => b.offsetParent !== null)
        .map((b) => (b.textContent ?? '').trim()),
    )
    .catch(() => []);
  return {
    found: false,
    diagnostics: `backend=${JSON.stringify(status).slice(0, 500)} · düğmeler=${texts.join(' | ')}`,
  };
};

const readProgress = (page) =>
  page.evaluate(() => window.__jvProgress ?? []).catch(() => []);

/** `component-download-progress` olaylarını sayfaya bağla (en iyi çaba). */
const startProgressCapture = async (page) =>
  page.evaluate(async () => {
    window.__jvProgress = [];
    const internals = window.__TAURI_INTERNALS__;
    if (!internals?.invoke || !internals?.transformCallback) return 'internals yok';
    try {
      const handler = internals.transformCallback((event) => {
        window.__jvProgress.push(event?.payload ?? event);
      });
      await internals.invoke('plugin:event|listen', {
        event: 'component-download-progress',
        target: { kind: 'Any' },
        handler,
      });
      return 'ok';
    } catch (error) {
      return `dinleme kurulamadı: ${String(error?.message ?? error)}`;
    }
  });

/** Arayüzün ürettiği jobId'yi yakala: UI `crypto.randomUUID()` kullanıyor. */
const installUuidSpy = (page) =>
  page
    .evaluate(() => {
      if (window.__jvUuidSpy) return true;
      const original = crypto.randomUUID.bind(crypto);
      window.__jvLastJobId = null;
      crypto.randomUUID = () => {
        const id = original();
        window.__jvLastJobId = id;
        return id;
      };
      window.__jvUuidSpy = true;
      return true;
    })
    .catch(() => false);

const readLastJobId = (page) =>
  page.evaluate(() => window.__jvLastJobId ?? null).catch(() => null);

const waitForValue = async (read, predicate, timeoutMs, intervalMs = 200) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    if (Date.now() > deadline) return value ?? null;
    await sleep(intervalMs);
  }
};

/** İlk taze ilerleme olayının jobId'sini döndür (yoksa UUID casusuna düş). */
const waitForJobId = async (page, eventsBefore, timeoutMs) =>
  waitForValue(
    async () => {
      const events = await readProgress(page);
      const fresh = events.slice(eventsBefore).filter((event) => event?.jobId);
      return fresh[0]?.jobId ?? (await readLastJobId(page));
    },
    (value) => Boolean(value),
    timeoutMs,
  );

/**
 * Bayt gelene kadar bekle. `jobId` yoksa ESKİ olaylara güvenmeyiz (yanlış "ilerleme
 * var" sonucu doğurur); bu durumda arayüzdeki ilerleme göstergesine düşeriz.
 */
const waitForProgress = async (page, jobId, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  const domProgressVisible = () =>
    page.getByLabel(/indirme ilerlemesi/).first().isVisible().catch(() => false);

  for (;;) {
    if (jobId) {
      const events = await readProgress(page);
      const mine = events.filter((event) => event.jobId === jobId);
      const bytes = mine.reduce((max, event) => Math.max(max, Number(event.downloadedBytes) || 0), 0);
      if (bytes > 0) {
        // `domVisible` bilinçli olarak kontrol EDİLMEDİ (null): bayt kanıtı zaten var.
        return { bytes, count: mine.length, lastPhase: mine.at(-1)?.phase ?? null, viaEvents: true, domVisible: null };
      }
    } else if (await domProgressVisible()) {
      return { bytes: 0, count: 0, lastPhase: null, viaEvents: false, domVisible: true };
    }
    if (Date.now() > deadline) break;
    await sleep(400);
  }
  return { bytes: 0, count: 0, lastPhase: null, viaEvents: false, domVisible: await domProgressVisible() };
};

/** İndirme satırının yeniden boşta (İndir düğmesi) olmasını bekle. */
const waitForDownloadIdle = async (page, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const idle = await downloadButtons(page)
      .first()
      .isVisible()
      .catch(() => false);
    if (idle) return true;
    if (Date.now() > deadline) return false;
    await sleep(500);
  }
};

const runVersion = (exePath, needle) => {
  try {
    const result = spawnSync(exePath, ['-version'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const first = text.trim().split(/\r?\n/)[0] ?? '';
    return { ok: text.includes(needle), detail: first || `exit=${result.status}` };
  } catch (error) {
    return { ok: false, detail: String(error?.message ?? error) };
  }
};

/* --- adım 1: pin bütünlüğü ------------------------------------------------- */

const checkPinIntegrity = async (pinnedUrl, pinnedSha) => {
  const assetName = basename(new URL(pinnedUrl).pathname);
  const tag = releaseTagOf(pinnedUrl);
  const response = await fetch(`${GITHUB_API}/${tag}`, {
    headers: { 'User-Agent': 'JointVault/1.0', Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
  const release = await response.json();
  const asset = (release.assets ?? []).find((item) => item.name === assetName);
  const digest = String(asset?.digest ?? '').replace(/^sha256:/i, '').toLowerCase();
  return {
    tag,
    assetName,
    assetSize: asset?.size ?? null,
    pinnedSha256: pinnedSha.toLowerCase(),
    publisherDigest: digest || null,
    match: Boolean(asset) && digest === pinnedSha.toLowerCase(),
  };
};

const stepPinIntegrity = async (ctx) => {
  const { report, artifact } = ctx;
  const source = readFileSync(COMPONENTS_RS, 'utf8');
  const pinnedUrl = readPin(source, 'FFMPEG_TOOLS_URL');
  const pinnedSha = readPin(source, 'FFMPEG_TOOLS_SHA256');
  report('pinlenmiş URL + sha256 `components.rs`’ten okundu', Boolean(pinnedUrl && pinnedSha));
  if (!pinnedUrl || !pinnedSha) {
    artifact.pins = { pinnedUrl, pinnedSha256: pinnedSha, match: false, error: 'sabitler okunamadı' };
    return;
  }
  try {
    const pin = await checkPinIntegrity(pinnedUrl, pinnedSha);
    artifact.pins = { pinnedUrl, ...pin };
    report(
      'pinlenmiş sha256, yayıncının GitHub asset digest’iyle AYNI',
      pin.match,
      `asset=${pin.assetName} · yayıncı=${pin.publisherDigest} · pin=${pin.pinnedSha256}`,
    );
  } catch (error) {
    const message = String(error?.message ?? error);
    artifact.pins = { pinnedUrl, pinnedSha256: pinnedSha, match: false, error: message };
    ctx.errors.push({ step: 'pin-integrity', message });
    report('pinlenmiş sha256 yayıncı digest’iyle doğrulanabildi', false, message);
  }
};

/* --- adım 2: temiz profil (yedekle) ---------------------------------------- */

const stepCleanProfile = async (ctx) => {
  const { page, report, state, artifact } = ctx;

  const pathResult = await invokeRaw(page, 'components_path', undefined);
  if (!pathResult.ok) throw new Error(`components_path alınamadı: ${pathResult.error}`);
  state.componentsDir = String(pathResult.value);
  mkdirSync(state.componentsDir, { recursive: true });

  const before = await getComponents(page);
  const plan = planShadows({ exeDir: state.exeDir, componentsDir: state.componentsDir });
  state.backupDir = ensureOutDir(join('clean-profile-backup', STAMP));
  console.log(`temiz profil: ${plan.length} gölge dosya yedeklenecek → ${state.backupDir}`);
  state.backupEntries = backupShadows(plan, state.backupDir);
  writeManifest(state.backupDir, state.backupEntries);
  state.pristine = new Set(readdirSync(state.componentsDir));

  const after = await getComponents(page);
  const beforePick = pickFf(before);
  const afterPick = pickFf(after);

  artifact.cleanProfile = {
    exeDir: state.exeDir,
    exeDirHow: state.exeHow,
    componentsDir: state.componentsDir,
    backedUp: state.backupEntries,
    before: beforePick,
    after: afterPick,
  };

  report(
    'temiz profil gerçek: ffmpeg artık kurulu DEĞİL (indirme yolu açık)',
    afterPick.ffmpeg?.installed === false,
    `önce: ${beforePick.ffmpeg?.installed} (${beforePick.ffmpeg?.source ?? '-'}) → sonra: ${afterPick.ffmpeg?.installed}`,
  );
  report(
    'temiz profil gerçek: ffprobe artık kurulu DEĞİL (indirme yolu açık)',
    afterPick.ffprobe?.installed === false,
    `önce: ${beforePick.ffprobe?.installed} (${beforePick.ffprobe?.source ?? '-'}) → sonra: ${afterPick.ffprobe?.installed}`,
  );
};

/* --- adım 3: çevrimdışı ---------------------------------------------------- */

const stepOffline = async (ctx) => {
  const { page, report, artifact } = ctx;
  const destDir = ensureOutDir('probe-tmp');
  const target = join(destDir, OFFLINE_FILE);
  const part = `${target}.part`;
  rmSync(target, { force: true });
  rmSync(part, { force: true });

  const result = await invokeRaw(page, 'component_download_probe', {
    payload: {
      url: OFFLINE_URL,
      sha256: WRONG_SHA256,
      destDir,
      fileName: OFFLINE_FILE,
      jobId: 'probe-offline',
    },
  });
  const message = String(result.ok ? '' : (result.error ?? ''));

  // Offline mesajı: "Sunucuya ulaşılamadı (çevrimdışı olabilir)..." beklenir.
  const comprehensible =
    !result.ok && /ulaşılamadı/i.test(message) && /çevrimdışı|bağlantı/i.test(message);

  report('çevrimdışı: indirme REDDEDİLDİ', !result.ok, result.ok ? 'beklenmedik başarı' : 'reddedildi');
  report('çevrimdışı: hata mesajı anlaşılır (ulaşılamadı / çevrimdışı / bağlantı)', comprehensible, message);
  report('çevrimdışı: hedef dosya oluşmadı', !existsSync(target));
  report('çevrimdışı: `.part` kalmadı', !existsSync(part));

  artifact.offline = {
    url: OFFLINE_URL,
    rejected: !result.ok,
    message,
    targetExists: existsSync(target),
    partExists: existsSync(part),
  };
};

/* --- adım 4: sha256 uyuşmazlığı -------------------------------------------- */

const fetchSha256 = async (url) => {
  const response = await fetch(url, { headers: { 'User-Agent': 'JointVault/1.0' } });
  if (!response.ok) throw new Error(`küçük dosya indirilemedi (HTTP ${response.status}): ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { sha256: createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length };
};

const stepShaMismatch = async (ctx) => {
  const { page, report, artifact } = ctx;
  const destDir = ensureOutDir('probe-tmp');
  const target = join(destDir, MISMATCH_FILE);
  const part = `${target}.part`;
  const url = artifact.pins?.pinnedUrl
    ? siblingAssetUrl(artifact.pins.pinnedUrl, 'checksums.sha256')
    : MISMATCH_FALLBACK_URL;

  const probe = (sha256) =>
    invokeRaw(page, 'component_download_probe', {
      payload: { url, sha256, destDir, fileName: MISMATCH_FILE, jobId: 'probe-sha256' },
    });

  // KONTROL: doğru özet kabul edilmeli. Aksi hâlde "yanlış özet reddedildi" sonucu
  // ağ hatasından ayırt edilemez — bu yüzden önce po(zitif) kontrol koşar.
  rmSync(target, { force: true });
  rmSync(part, { force: true });
  let control = { ok: false, message: 'hesaplanamadı' };
  try {
    const expected = await fetchSha256(url);
    const result = await probe(expected.sha256);
    control = { ok: result.ok === true, message: result.error ?? '', expected, installed: existsSync(target) };
  } catch (error) {
    control = { ok: false, message: String(error?.message ?? error) };
    ctx.errors.push({ step: 'sha256-control', message: control.message });
  }
  report(
    'sha256 KONTROL: doğru özetle küçük dosya kuruldu (ağ yolu sağlam)',
    control.ok && control.installed === true,
    control.message || `${control.expected?.bytes ?? '?'} bayt`,
  );
  rmSync(target, { force: true });
  rmSync(part, { force: true });

  const result = await probe(WRONG_SHA256);
  const message = String(result.ok ? '' : (result.error ?? ''));
  report(
    'sha256 uyuşmazlığı: indirme REDDEDİLDİ',
    !result.ok,
    result.ok ? 'beklenmedik başarı' : 'reddedildi',
  );
  report(
    'sha256 uyuşmazlığı: mesaj "doğrulanamadı" diyor',
    /doğrulanamadı/i.test(message) && /sha256/i.test(message),
    message,
  );
  report('sha256 uyuşmazlığı: dosya KURULMADI', !existsSync(target));
  report('sha256 uyuşmazlığı: `.part` kalmadı', !existsSync(part));

  artifact.shaMismatch = {
    url,
    control: { ok: control.ok, message: control.message, expected: control.expected ?? null },
    rejected: !result.ok,
    message,
    targetExists: existsSync(target),
    partExists: existsSync(part),
  };
};

/* --- adım 5: indirme ortasında iptal --------------------------------------- */

const stepCancel = async (ctx) => {
  const { page, report, state, artifact } = ctx;

  // Arayüz açılışta (yedeklemeden ÖNCE) durumu okudu; tazelemek ZORUNLU yoksa
  // İndir düğmesi görünmez (satırlar hâlâ "kurulu" sanılır). Sekmeyi de garanti
  // et: önceki bir adım başka görünüme kaçmış olabilir.
  await openComponentsSection(page);
  await page.getByRole('button', { name: 'Durumu yenile', exact: true }).first().click().catch(() => {});
  await installUuidSpy(page);

  const probeBtn = await waitForDownloadButton(page);
  report('iptal senaryosu: arayüzde İndir düğmesi var', probeBtn.found, probeBtn.diagnostics ?? undefined);
  if (!probeBtn.found) return;

  const start = downloadButtons(page).first();
  const eventsBefore = (await readProgress(page)).length;
  await start.click();

  const jobId = await waitForJobId(page, eventsBefore, 30_000);
  report('iptal senaryosu: indirme başladı (jobId yakalandı)', Boolean(jobId), jobId ?? 'yakalanamadı');

  const progress = await waitForProgress(page, jobId, 45_000);
  report(
    'iptal senaryosu: ilerleme bayt geldiğini gösteriyor',
    progress.bytes > 0 || progress.domVisible === true,
    progress.bytes > 0
      ? `${progress.bytes} bayt · ${progress.count} olay`
      : `olay yok; arayüz ilerleme göstergesi=${progress.domVisible}`,
  );
  await ctx.shot('component-download-progress.png');

  // İlerleme şeridi gerçekten çizildi mi: iptal düğmesi yalnız indirme sürerken var.
  const cancelVisible = await cancelButtons(page)
    .first()
    .isVisible()
    .catch(() => false);
  report('iptal senaryosu: arayüz iptal düğmesini gösteriyor (şerit çizildi)', cancelVisible);

  // jobId yoksa iptal EDİLEMEZ: null göndermek backend'de anlamsız bir argüman
  // hatası üretir ve asıl sorunu gizler. Eksikliği açıkça raporla.
  if (!jobId) {
    report('iptal senaryosu: component_cancel işi buldu', false, 'jobId yakalanamadı; iptal edilecek iş yok');
  } else {
    const cancelResult = await invokeRaw(page, 'component_cancel', { jobId });
    report(
      'iptal senaryosu: component_cancel işi buldu',
      cancelResult.ok && cancelResult.value === true,
      JSON.stringify(cancelResult),
    );
  }

  const idle = await waitForDownloadIdle(page, 60_000);
  await sleep(800);
  const parts = listPartFiles(state.componentsDir);
  const ffmpegInstalled = existsSync(join(state.componentsDir, 'ffmpeg.exe'));
  const status = await getComponents(page);
  const ffmpeg = pick(findById(status, 'ffmpeg'));

  report('iptal senaryosu: indirme yerleşti (arayüz boşta)', idle);
  report('iptal sonrası `.part` KALMADI', parts.length === 0, parts.join(', ') || '(temiz)');
  report('iptal sonrası ffmpeg.exe KURULMADI', !ffmpegInstalled);
  report('iptal sonrası durum yeniden "eksik"', ffmpeg?.installed === false, `installed=${ffmpeg?.installed}`);
  await ctx.shot('component-download-cancelled.png');

  artifact.cancel = {
    jobId: jobId ?? null,
    progress,
    partsAfter: parts,
    ffmpegInstalled,
    ffmpegAfter: ffmpeg,
  };
};

/* --- adım 6: gerçek tam indirme -------------------------------------------- */

const stepRealDownload = async (ctx) => {
  const { page, report, state, artifact } = ctx;
  const jobId = `probe-real-${Date.now()}`;
  const eventsBefore = (await readProgress(page)).length;
  const started = Date.now();

  // evaluate'i indirme boyunca BLOKE ETME: CDP protokol zaman aşımına takılmasın.
  // Sonucu pencere üzerinde bir "promise kutusu"na yaz, ayrı kısa yoklamalarla oku.
  await page.evaluate((id) => {
    window.__jvProbeResult = { pending: true };
    window.__TAURI_INTERNALS__
      .invoke('component_download', { payload: { component_id: 'ffmpeg', job_id: id } })
      .then((out) => {
        window.__jvProbeResult = { ok: true, out };
      })
      .catch((error) => {
        window.__jvProbeResult = { ok: false, error: String(error?.message ?? error) };
      });
  }, jobId);

  const result = await waitForValue(
    () => page.evaluate(() => window.__jvProbeResult ?? null).catch(() => null),
    (value) => value && value.pending !== true,
    20 * 60_000,
    2000,
  );
  const elapsedMs = Date.now() - started;
  const finished = Boolean(result && result.pending !== true);
  const succeeded = Boolean(result && result.ok === true);

  report('gerçek indirme: komut makul sürede döndü', finished, finished ? fmtSeconds(elapsedMs) : 'zaman aşımı');
  report('gerçek indirme: komut BAŞARIYLA döndü', succeeded, result?.error ?? '');

  const status = await getComponents(page);
  const ffmpeg = pick(findById(status, 'ffmpeg'));
  const ffprobe = pick(findById(status, 'ffprobe'));

  report(
    'gerçek indirme: ffmpeg kurulu + çalıştırılabilir + kaynak "downloaded"',
    ffmpeg?.installed === true && ffmpeg?.runnable === true && ffmpeg?.source === 'downloaded',
    JSON.stringify(ffmpeg),
  );
  report(
    'gerçek indirme: ffprobe kurulu + çalıştırılabilir + kaynak "downloaded"',
    ffprobe?.installed === true && ffprobe?.runnable === true && ffprobe?.source === 'downloaded',
    JSON.stringify(ffprobe),
  );
  report(
    'gerçek indirme: sürüm dizesi okundu',
    typeof ffmpeg?.version === 'string' && ffmpeg.version.length > 0,
    ffmpeg?.version ?? '(yok)',
  );
  report(
    'gerçek indirme: her iki dosya diskte VAR',
    Boolean(ffmpeg?.path && existsSync(ffmpeg.path)) && Boolean(ffprobe?.path && existsSync(ffprobe.path)),
    `${ffmpeg?.path ?? '-'} · ${ffprobe?.path ?? '-'}`,
  );
  report(
    'gerçek indirme: dosyalar bileşenler klasörüne yazıldı',
    Boolean(ffmpeg?.path?.startsWith(state.componentsDir)) && Boolean(ffprobe?.path?.startsWith(state.componentsDir)),
    state.componentsDir,
  );

  const ffmpegRun = ffmpeg?.path ? runVersion(ffmpeg.path, 'ffmpeg version') : { ok: false, detail: 'yol yok' };
  const ffprobeRun = ffprobe?.path ? runVersion(ffprobe.path, 'ffprobe version') : { ok: false, detail: 'yol yok' };
  report('gerçek indirme: ffmpeg.exe -version "ffmpeg version" yazdırıyor', ffmpegRun.ok, ffmpegRun.detail);
  report('gerçek indirme: ffprobe.exe -version "ffprobe version" yazdırıyor', ffprobeRun.ok, ffprobeRun.detail);

  const events = (await readProgress(page)).slice(eventsBefore).filter((event) => event.jobId === jobId);
  const maxBytes = events.reduce((max, event) => Math.max(max, Number(event.downloadedBytes) || 0), 0);
  const phases = [...new Set(events.map((event) => event.phase))];
  const totalBytes = events.at(-1)?.totalBytes ?? null;
  report(
    'gerçek indirme: ilerleme olayları bayt bildirdi',
    maxBytes > 0,
    `en fazla ${maxBytes} bayt · toplam=${totalBytes ?? '?'} · fazlar=${phases.join('/') || '-'}`,
  );

  artifact.realDownload = {
    jobId,
    elapsedMs,
    success: succeeded,
    error: result?.error ?? null,
    maxDownloadedBytes: maxBytes,
    totalBytes,
    phases,
    eventCount: events.length,
    ffmpeg,
    ffprobe,
    runs: { ffmpeg: ffmpegRun, ffprobe: ffprobeRun },
  };

  // Arayüzü tazele ve "kurulu" damgasını görüntüle. Sekmeyi önce garanti et:
  // yoksa bölüm DOM'da yoktur ve satır sayısı yanlışlıkla 0 çıkar.
  await openComponentsSection(page);
  await page.getByRole('button', { name: 'Durumu yenile', exact: true }).first().click().catch(() => {});
  await sleep(1500);
  const kuruluRows = await page.getByText('kurulu').count();
  report('gerçek indirme: arayüz "kurulu" gösteriyor', kuruluRows >= 2, `${kuruluRows} satır`);
  await ctx.shot('component-download-installed.png');
};

/* --- adım 7: 7a regresyon koruması ----------------------------------------- */

const stepRegression = async (ctx) => {
  const { page, report, state } = ctx;
  const status = await getComponents(page);
  const health = await invokeRaw(page, 'health_check', undefined);

  let parsed = null;
  try {
    parsed = health.ok ? JSON.parse(health.value) : null;
  } catch {
    parsed = null;
  }
  report('regresyon: health_check okunabildi', Boolean(parsed));
  if (!parsed) return;

  const ffmpeg = findById(status, 'ffmpeg');
  const ffprobe = findById(status, 'ffprobe');
  report(
    'regresyon (7a): ffmpeg kayıt ↔ health_check AYNI',
    ffmpeg?.installed === parsed.ffmpeg?.available,
    `kayıt=${ffmpeg?.installed} · health=${parsed.ffmpeg?.available}`,
  );
  report(
    'regresyon (7a): ffprobe kayıt ↔ health_check AYNI',
    ffprobe?.installed === parsed.ffprobe?.available,
    `kayıt=${ffprobe?.installed} · health=${parsed.ffprobe?.available}`,
  );

  const missing = state.backupEntries.filter((entry) => !existsSync(entry.from));
  report(
    'regresyon: yedeklenen gölge dosyaların hepsi eski yerinde',
    missing.length === 0,
    missing.map((entry) => entry.from).join(', ') || `${state.backupEntries.length} dosya`,
  );
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
  const report = (label, ok, detail) => {
    results.push({ label, ok, detail: detail ?? null });
    console.log(`${ok ? 'GEÇTİ' : 'KALDI'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };
  ensureOutDir();

  const exeInfo = findAppExeDir();
  console.log(`exe klasörü: ${exeInfo.dir} (${exeInfo.how})`);
  if (quickFlag && RUN_REAL_DOWNLOAD) {
    console.log('NOT: --quick verildi ama JV_REAL_DOWNLOAD gerçek indirmeyi zorluyor.');
  }
  if (!RUN_REAL_DOWNLOAD) {
    console.log('HIZLI MOD: gerçek ~186 MB indirme ATLANDI (--quick ya da JV_REAL_DOWNLOAD=0).');
  }

  const startedAt = Date.now();
  const state = {
    exeDir: exeInfo.dir,
    exeHow: exeInfo.how,
    componentsDir: null,
    backupDir: null,
    backupEntries: [],
    pristine: new Set(),
    removed: [],
    restoreReport: null,
    cleaned: false,
  };
  const artifact = {
    kind: 'component-download-probe',
    synthetic: false,
    note: 'Faz 7b bileşen indirme motoru: pin bütünlüğü, temiz profil, çevrimdışı red, sha256 reddi, iptal temizliği ve (varsayılan) gerçek tam indirme.',
    capturedAt: new Date().toISOString(),
    appUrl: page.url(),
    quick: quickFlag,
    realDownloadRequested: RUN_REAL_DOWNLOAD,
    exeDir: exeInfo.dir,
    exeDirHow: exeInfo.how,
  };
  const ctx = {
    page,
    report,
    results,
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
    await openComponentsSection(page);
    const captureMode = await startProgressCapture(page);
    report('ilerleme olayları dinlenebiliyor (component-download-progress)', captureMode === 'ok', captureMode);

    await stepPinIntegrity(ctx);
    await stepCleanProfile(ctx);
    await stepOffline(ctx);
    await stepShaMismatch(ctx);
    await stepCancel(ctx);
    if (RUN_REAL_DOWNLOAD) {
      await stepRealDownload(ctx);
    } else {
      artifact.realDownload = { skipped: true, reason: quickFlag ? '--quick' : 'JV_REAL_DOWNLOAD=0' };
    }

    cleanupProfile(ctx); // geri yükleme + test artıkları (adım 7'den ÖNCE)
    await stepRegression(ctx);
  } catch (error) {
    const message = String(error?.stack ?? error?.message ?? error);
    errors.push({ step: 'fatal', message });
    report('sonda hatasız tamamlandı', false, String(error?.message ?? error));
    console.error(message);
  } finally {
    try {
      cleanupProfile(ctx);
    } catch (error) {
      const message = String(error?.message ?? error);
      errors.push({ step: 'cleanup', message });
      console.error(`temizlik hatası: ${message}`);
    }
  }

  artifact.results = results;
  artifact.errors = errors;
  artifact.exposedErrorCount = errors.length;
  artifact.timings = {
    totalMs: Date.now() - startedAt,
    realDownloadMs: artifact.realDownload?.elapsedMs ?? null,
  };
  artifact.cleanProfile = {
    ...(artifact.cleanProfile ?? {}),
    exeDir: state.exeDir,
    exeDirHow: state.exeHow,
    backupDir: state.backupDir,
    backedUp: state.backupEntries,
    removedTestArtifacts: state.removed,
    restore: state.restoreReport,
  };

  try {
    writeFileSync(resolve(OUT_DIR, 'component-download-probe.json'), JSON.stringify(artifact, null, 2), 'utf8');
    console.log('\nprovenance: component-download-probe.json + ekran görüntüleri');
  } catch (error) {
    const message = String(error?.message ?? error);
    errors.push({ step: 'artifact', message });
    console.error(`artifact yazılamadı: ${message}`);
  }

  const failed = results.filter((entry) => !entry.ok).length;
  console.log(
    failed === 0 && errors.length === 0
      ? '\nSONUÇ: tüm kontroller GEÇTİ'
      : `\nSONUÇ: ${failed} kontrol KALDI · ${errors.length} hata (artifact: dev/out/component-download-probe.json)`,
  );
  return endProbe(failed === 0 && errors.length === 0 ? 0 : 1);
};

await main();
