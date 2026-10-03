/*
 * Yerel AI "katılım" (opt-in) sondası — Faz 8b — üretim kodu DEĞİL.
 *
 * NE KANITLAR
 * -----------------------------------------------------------------------------
 * MANŞET: **Temiz kurulumda açılışta SIFIR llama-server süreci başlar ve HİÇBİR
 * şey indirilmez.** Düzeltilen kusur buydu: `AiConfig::default().auto_warmup =
 * Some(true)` + `lib.rs` setup içindeki `warmup_ai_on_startup` yüzünden uygulama,
 * AI "kapalı" olmasına rağmen iki llama-server (~9 GB) başlatıyordu.
 *
 *  1. DEĞİŞMEZ (temiz profil): model dizini YOK + config'te AÇIK `enabled` YOK
 *     iken açılışta 0 llama-server ve 0 yeni dosya (indirme). Göç kuralı:
 *     "kayıtlı `enabled` varsa o kazanır; yoksa AI etkin ⇔ motor + LLM kurulu".
 *     Model yok → motor+LLM'den biri yok → KAPALI. Config'teki açık dosya yolları
 *     (`llm_path`/`embed_path`/`engine_path`) da nötrlenir; aksi hâlde models
 *     dizini DIŞINDA bir .gguf göçü "kurulu" gösterip temiz profili maskelerdi.
 *  2. `ai_status.ai_enabled === false`; arayüz asistan + semantik arama
 *     yüzeylerinde DÜRÜST "AI kapalı" durumu ve GERÇEKTEN çalışan bir
 *     yönlendirme düğmesi gösterir (ölü düğme yok) — hata tonu değil, durum.
 *  3. REGRESYON (etkin kurulum): model dizini geri konunca mevcut kurulum ETKİN
 *     kalır (`ai_enabled === true`), `stored: false` yine kazanır, arayüzdeki
 *     rıza akışıyla ("Yerel AI'yı etkinleştir" → onay) açılır ve offload
 *     kararı+gerekçesi `ai_status`'ta görünür.
 *  4. GREP: `src/` altında SABİT donanım metni ('5070', 'GDDR', '10.5 GB') YOK;
 *     üretim kodunda (`src-tauri/src/`) yalnız YORUM ve `hardware.rs` test
 *     düzeneği olarak kalabilir; `ai.rs`'te `.arg("99")` sabiti YOK.
 *
 * NEDEN UYGULAMAYI SONDA BAŞLATIR (JV_APP_CMD)
 * -----------------------------------------------------------------------------
 * Açılışta-süreç-doğurmama bir AÇILIŞ davranışıdır: `start_watchdog` setup'ta
 * yöneticiyi başlatır ve config o an önbelleğe alınır. Dolayısıyla "AI kapalı
 * başlar" iddiası, uygulama TEMİZ PROFİL YERİNDEYKEN açılmadan sınanamaz —
 * çalışan bir uygulamayı sonradan ikna etmek yanlış kanıt olurdu. Bu yüzden
 * sonda: önce profili hazırlar, SONRA uygulamayı kendisi başlatır.
 *
 * Amaç "dünya hâlini" övmek DEĞİL, DEĞİŞMEZİ sınamak: RTX 5070 Ti beklentisi
 * sabit yazılmaz; offload kararı, `ai_status`'un BİLDİRDİĞİ vram/model_mb
 * sayılarından yeniden hesaplanıp karşılaştırılır (gerekçe↔karar tutarlılığı).
 *
 * GÜVENLİK / GERİ YÜKLEME (asla ihlal edilmez)
 * -----------------------------------------------------------------------------
 *  - Kullanıcı dosyaları SİLİNMEZ: model dizini ve config, `<yol>.probe-aside-<damga>`
 *    adıyla AYNI DİZİNE taşınır (aynı birim → anlık rename; 9 GB kopyalanmaz).
 *  - Her taşımadan sonra `manifest.json` yazılır (çökme güvenliği).
 *  - `finally` içinde HER ŞEY geri konur; geri konamayan varsa GÜRÜLTÜLÜ hata.
 *  - Sondanın başlattığı süreç ağacı `taskkill /T /F` ile kapatılır.
 *  - Yalnız `app.exe`/`jointvault*` (repo kökü altında) ve `llama-server.exe`
 *    kapatılır — başka hiçbir sürece dokunulmaz.
 *
 * KULLANIM
 * -----------------------------------------------------------------------------
 *   # Tek komut: profili hazırlar, uygulamayı başlatır, sınar, geri koyar.
 *   npm run verify:ai-optin
 *
 * Uygulama koşu sonunda DURMUŞ kalır (sonda başlattığı ağacı kapatır); istersen
 * yeniden başlatırsın.
 *
 * Ortam değişkenleri / bayraklar:
 *   JV_APP_CMD=...   uygulamayı başlatan komut (varsayılan: `npx tauri dev`).
 *   JV_CDP=...       CDP ucu (varsayılan http://127.0.0.1:9222)
 *   JV_CDP_TIMEOUT_MS=... açılış için CDP bekleme süresi (varsayılan 300000)
 *   JV_LLAMA_WINDOW_MS=...  "0 llama-server" gözlem penceresi (varsayılan 12000)
 *   JV_OUT=...       çıktı klasörü (varsayılan dev/out)
 *
 * Çıkış kodları: 0 tümü geçti (+atlananlar) · 1 kalan kontrol/hata varsa ·
 *               2 uygulamaya bağlanılamadı ya da ortam uygun değil.
 * Atlanan kontrol "GEÇTİ" SAYILMAZ; ayrı `skips` listesinde raporlanır.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';
import {
  OUT_DIR,
  PROJECT_ROOT,
  endProbe,
  ensureOutDir,
  findAppPage,
  waitForCdp,
} from './lib/browser.mjs';
import { moveFile } from './lib/clean-profile.mjs';

/* --- sabitler -------------------------------------------------------------- */

const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';
const CDP_PORT = (() => {
  try {
    return new URL(CDP).port || '9222';
  } catch {
    return '9222';
  }
})();

// Kayıttaki adların TEK kaynağı Rust'tır (`components.rs`); sonda arayüz
// sözleşmesini bağımsız doğrulayabilsin diye literal'i burada ÇİVLER (test sabiti).
const CONFIG_FILE = 'jointvault-ai-config.json';
const MODELS_DIR = 'jointvault-models';
const BINARIES_DIR = 'jointvault-binaries';
const COMPONENTS_SUBDIR = 'components';

// Göç kuralının "eski yapılandırma" taklidi: `enabled` alanı YOK, `auto_warmup`
// açık. Bu, `enabled` alanını hiç yazmamış bir kurulumun birebir şeklidir; göç
// kuralını (motor+LLM varlığına bakma) gerçekten çalıştırır.
const OLD_STYLE_CONFIG = {
  llm_path: null,
  embed_path: null,
  engine_path: null,
  external_api_url: null,
  idle_timeout_secs: 600,
  auto_warmup: true,
  temperature: 0.7,
  auto_apply_tags: false,
};

// VRAM payı `ai.rs:VRAM_RESERVE_MB` ile AYNI olmalı; offload kararını bağımsız
// yeniden hesaplamak için burada çivlenir (üretim kodu kopyalanmaz).
const VRAM_RESERVE_MB = 2048;
const ALL_GPU_LAYERS = 99;

// Sabit donanım metinleri: kullanıcıya dönük `src/` altında HİÇ kalmamalı.
const FRONTEND_HARDCODED = /5070|GDDR|10\.5 GB/;
// `src-tauri/src/` altında yalnız yorum ya da `hardware.rs` test düzeneği olabilir.
const BACKEND_HARDCODED = /5070|GDDR/;
const ARG_99_LITERAL = /\.arg\(\s*"99"\s*\)/;

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --- saf yardımcılar ------------------------------------------------------- */

const waitUntil = async (predicate, timeoutMs, intervalMs = 250) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) return false;
    await sleep(intervalMs);
  }
};

const readJsonFile = (path) => {
  if (!existsSync(path)) return { existed: false, raw: null, json: null, error: null };
  const raw = readFileSync(path, 'utf8');
  try {
    return { existed: true, raw, json: JSON.parse(raw), error: null };
  } catch (error) {
    return { existed: true, raw, json: null, error: String(error?.message ?? error) };
  }
};

const listFilesDeep = (dir) => {
  const out = [];
  const walk = (current) => {
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return; // yok/erişilemez: boş kabul et (varlık ayrıca raporlanır)
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  walk(dir);
  return out.sort((a, b) => a.localeCompare(b));
};

/*
 * İki dizin AYNI içeriğe mi sahip? Göreli yol + boyut karşılaştırılır.
 *
 * Neden gerekli: uygulama açılışta model dizinini yeniden oluşturabilir. "Hedef
 * dolu, geri yükleyemedim" demek o durumda YANLIŞ olur — istenen sonuç zaten
 * sağlanmış olabilir. Önce içerik sorulur; ancak gerçekten farklıysa hata verilir.
 */
const sameDirectoryContent = (a, b) => {
  const entriesOf = (dir) => {
    const map = new Map();
    for (const full of listFilesDeep(dir)) {
      let size = -1;
      try {
        size = statSync(full).size;
      } catch {
        // okunamayan dosya: boyut -1 kalır, karşılaştırma yine de yapılır
      }
      map.set(relative(dir, full).replace(/\\/g, '/'), size);
    }
    return map;
  };
  const ea = entriesOf(a);
  const eb = entriesOf(b);
  if (ea.size !== eb.size) return false;
  for (const [key, size] of ea) {
    if (eb.get(key) !== size) return false;
  }
  return true;
};

const snapshotFiles = (dirs) => {  const map = {};
  for (const dir of dirs) {
    if (!dir) continue;
    map[dir] = listFilesDeep(dir);
  }
  return map;
};

const newFiles = (before, after) => {
  const out = [];
  for (const [dir, files] of Object.entries(after)) {
    const known = new Set(before[dir] ?? []);
    for (const file of files) if (!known.has(file)) out.push(file);
  }
  return out;
};

const rel = (path) => relative(PROJECT_ROOT, path).split(sep).join('/');

const scanDir = (dir, regex) => {
  const matches = [];
  for (const file of listFilesDeep(dir)) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    text.split(/\r?\n/).forEach((line, index) => {
      if (regex.test(line)) matches.push({ file: rel(file), line: index + 1, text: line.trim() });
    });
  }
  return matches;
};

/* --- PowerShell köprüsü (yalnız Windows) ----------------------------------- */

const psQuote = (value) => `'${String(value).replace(/'/g, "''")}'`;

const runPowerShell = (script, timeout = 30_000) => {
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', timeout },
  );
  if (result.error) throw new Error(`powershell çalıştırılamadı: ${result.error.message}`);
  return result.stdout ?? '';
};

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

/**
 * Süreç listesi: yalnız repo kökü altındaki `app.exe`/`jointvault*` ve tüm
 * `llama-server.exe`. Başka hiçbir süreç okunmaz/öldürülmez.
 */
const collectProcesses = () => {
  const script = [
    `$ErrorActionPreference='SilentlyContinue';`,
    `$root=${psQuote(PROJECT_ROOT)};`,
    `$app=@(Get-Process -Name app,jointvault* -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.ToLower().StartsWith($root.ToLower()) } | ForEach-Object { [pscustomobject]@{ id=$_.Id; name=$_.ProcessName; path=$_.Path } });`,
    `$llama=@(Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ id=$_.Id; name=$_.ProcessName; path=$_.Path } });`,
    `[pscustomobject]@{ app=$app; llama=$llama } | ConvertTo-Json -Depth 4 -Compress`,
  ].join(' ');
  const text = runPowerShell(script).trim();
  if (!text) return { app: [], llama: [] };
  const parsed = JSON.parse(text);
  return { app: asArray(parsed.app), llama: asArray(parsed.llama) };
};

const killPids = (ids) => {
  if (ids.length === 0) return;
  const list = ids.map((id) => Number(id)).filter(Number.isFinite);
  if (list.length === 0) return;
  runPowerShell(
    `$ErrorActionPreference='SilentlyContinue'; foreach ($p in @(${list.join(',')})) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }`,
  );
};

const killSpawnedTree = (child) => {
  if (!child?.pid) return;
  spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
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

const invokeStrict = async (page, command, args) => {
  const result = await invokeRaw(page, command, args);
  if (!result.ok) throw new Error(`${command} başarısız: ${result.error}`);
  return result.value;
};

const getAiStatus = (page) => invokeStrict(page, 'ai_status', undefined);

const readString = async (page, command) => {
  const result = await invokeRaw(page, command, undefined);
  return result.ok ? String(result.value) : null;
};

/** Çalışan bir uygulamaya (varsa) kısa süreyle bağlanır; yoksa `null`. */
const tryConnect = async (timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await chromium.connectOverCDP(CDP);
    } catch {
      /* henüz yok */
    }
    if (Date.now() > deadline) return null;
    await sleep(1000);
  }
};

/* --- tauri.conf.json / yol türetme ----------------------------------------- */

const readIdentifier = () => {
  const path = resolve(PROJECT_ROOT, 'src-tauri/tauri.conf.json');
  const cfg = readJsonFile(path);
  if (!cfg.json?.identifier) throw new Error(`identifier okunamadı: ${path}`);
  return cfg.json.identifier;
};

const deriveAppDataDir = (identifier) => {
  const appData = process.env.APPDATA;
  if (!appData) throw new Error('APPDATA tanımlı değil; app_data_dir türetilemez.');
  return join(appData, identifier);
};

/* --- raporlama ------------------------------------------------------------- */

const createReporter = () => {
  const results = [];
  const skips = [];
  const errors = [];
  const report = (label, ok, detail) => {
    results.push({ label, ok: Boolean(ok), detail: detail ?? null });
    console.log(`${ok ? 'GEÇTİ' : 'KALDI'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };
  const skip = (label, reason) => {
    skips.push({ label, reason });
    console.log(`ATLANDI  ${label} — ${reason}`);
  };
  return { results, skips, errors, report, skip };
};

/* --- adımlar: keşif + hazırlık --------------------------------------------- */

const stepDiscover = async (ctx) => {
  const { state, report } = ctx;
  const identifier = readIdentifier();
  state.identifier = identifier;
  const derived = deriveAppDataDir(identifier);

  const browser = await tryConnect(4000);
  let fromApp = null;
  if (browser) {
    try {
      const page = findAppPage(browser);
      if (page) {
        const appData = await readString(page, 'app_data_path');
        const components = await readString(page, 'components_path');
        if (appData) fromApp = { appDataDir: appData, componentsDir: components };
      }
    } catch (error) {
      console.log(`     çalışan uygulamadan yol okunamadı: ${String(error?.message ?? error)}`);
    }
  }

  state.appDataDir = fromApp?.appDataDir ?? derived;
  state.componentsDir = fromApp?.componentsDir ?? join(state.appDataDir, COMPONENTS_SUBDIR);
  state.pathSource = fromApp
    ? 'çalışan uygulama (app_data_path/components_path)'
    : `türetildi: %APPDATA%\\${identifier}`;
  report('yol keşfi: app_data_dir belirlendi', true, `${state.appDataDir} (${state.pathSource})`);
};

const stepStage = async (ctx) => {
  const { state, report, artifact, errors } = ctx;
  const appData = state.appDataDir;
  const paths = {
    appData,
    configPath: join(appData, CONFIG_FILE),
    modelsPath: join(appData, MODELS_DIR),
    binariesPath: join(appData, BINARIES_DIR),
  };
  state.paths = paths;

  // 1) ÖNCE taban kaydı: ne varsa aynen saklanır (karşılaştırma + geri doğrulama).
  state.modelsBefore = existsSync(paths.modelsPath) ? readdirSync(paths.modelsPath).sort() : null;
  const cfgBefore = readJsonFile(paths.configPath);
  state.configBefore = {
    existed: cfgBefore.existed,
    raw: cfgBefore.raw,
    parseError: cfgBefore.error,
    enabledPresent:
      cfgBefore.json !== null && Object.prototype.hasOwnProperty.call(cfgBefore.json, 'enabled'),
    enabledValue: cfgBefore.json !== null ? (cfgBefore.json.enabled ?? null) : null,
  };
  state.filesBefore = snapshotFiles([state.componentsDir, paths.modelsPath, paths.binariesPath]);

  // Talimat: config'te AÇIK `enabled` varsa göç yolu maskelenir. Sonda bunu
  // yedekleyip `enabled`ı çıkararak göçü GERÇEKTEN çalıştırır ve `finally`de
  // orijinali geri koyar.
  report(
    'taban: AI yapılandırması okundu',
    true,
    cfgBefore.existed
      ? `dosya var · enabled=${state.configBefore.enabledPresent ? `açık (${JSON.stringify(state.configBefore.enabledValue)})` : 'YOK (göç yolu geçerli)'}`
      : 'dosya YOK (varsayılan disabled; göç yolu için eski-tip yapılandırma yazılacak)',
  );
  if (cfgBefore.error) {
    errors.push({ step: 'stage', message: `config ayrıştırılamadı: ${cfgBefore.error}` });
    console.error(`config ayrıştırılamadı, eski-tip yapılandırma yazılacak: ${cfgBefore.error}`);
  }
  report(
    'taban: model dizini kaydedildi',
    true,
    state.modelsBefore === null ? 'dizin YOK' : `${state.modelsBefore.length} öğe`,
  );

  // 2) Çalışan uygulama/llama varsa kapat ki dosyalar kilitli olmasın ve açılış
  //    gerçekten "temiz" olsun (yalnız bu ikisi; başka sürece dokunulmaz).
  await stopEverything(ctx, 'hazırlık öncesi');

  // 3) Yedek dizini (manifest buraya) + yerinde aside taşıma.
  const backupDir = ensureOutDir(join('ai-optin-backup', STAMP));
  state.backupDir = backupDir;
  const entries = [];

  if (existsSync(paths.modelsPath)) {
    const aside = `${paths.modelsPath}.probe-aside-${STAMP}`;
    if (existsSync(aside)) throw new Error(`model aside yolu zaten dolu: ${aside}`);
    state.modelsAside = aside;
    const method = moveFile(paths.modelsPath, aside);
    entries.push({ what: 'models', from: paths.modelsPath, to: aside, method });
    console.log(`     model dizini taşındı (${method}): ${paths.modelsPath} → ${aside}`);
  } else {
    state.modelsAside = null;
    console.log('     model dizini zaten yok: temiz profil ek iş gerektirmiyor');
  }

  if (cfgBefore.existed) {
    const aside = `${paths.configPath}.probe-aside-${STAMP}`;
    if (existsSync(aside)) throw new Error(`config aside yolu zaten dolu: ${aside}`);
    const method = moveFile(paths.configPath, aside);
    state.configAside = aside;
    const source =
      cfgBefore.json && typeof cfgBefore.json === 'object' && !Array.isArray(cfgBefore.json)
        ? { ...cfgBefore.json }
        : { ...OLD_STYLE_CONFIG };
    // `enabled`ı çıkar → göç yolu geçerli olsun. Ayrıca açık dosya yollarını
    // nötrle: aksi hâlde config'te `llm_path`/`embed_path` models dizini DIŞINDA
    // bir .gguf'a işaret ediyorsa göç onu "kurulu" sayar ve temiz profil
    // maskelenir (test yanlış yeşil olur). `finally` orijinali geri koyar.
    const neutralized = ['llm_path', 'embed_path', 'engine_path'].filter(
      (key) => source[key] !== null && source[key] !== undefined,
    );
    delete source.enabled;
    for (const key of neutralized) source[key] = null;
    state.neutralizedPaths = neutralized;
    writeFileSync(paths.configPath, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
    entries.push({ what: 'config', from: paths.configPath, to: aside, method });
    console.log(
      `     config yedeklendi; 'enabled' çıkarıldı${neutralized.length > 0 ? ` + yollar nötrlendi (${neutralized.join(', ')})` : ''} (${method})`,
    );
  } else {
    state.neutralizedPaths = [];
    state.configAside = null;
    state.configCreated = true;
    writeFileSync(paths.configPath, `${JSON.stringify(OLD_STYLE_CONFIG, null, 2)}\n`, 'utf8');
    entries.push({ what: 'config', from: null, to: paths.configPath, method: 'created' });
    console.log(`     eski-tip yapılandırma yazıldı ('enabled' yok): ${paths.configPath}`);
  }

  writeFileSync(
    join(backupDir, 'manifest.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), entries }, null, 2),
    'utf8',
  );
  artifact.cleanProfile = {
    appDataDir: state.appDataDir,
    pathSource: state.pathSource,
    configPath: paths.configPath,
    modelsPath: paths.modelsPath,
    // HAM config artifact'a YAZILMAZ: `external_api_url` bir anahtar taşıyabilir
    // (security-patterns: hassas veriyi logla/artifact'a koyma). Yalnız şekil.
    config: {
      existed: state.configBefore.existed,
      parseError: state.configBefore.parseError,
      enabledPresent: state.configBefore.enabledPresent,
      enabledValue: state.configBefore.enabledValue,
    },
    neutralizedPaths: state.neutralizedPaths ?? [],
    modelsBefore: state.modelsBefore,
  };
  report(
    'hazırlık: temiz profil kuruldu (modeller yok + config\'te enabled yok)',
    true,
    state.neutralizedPaths?.length > 0
      ? `ayrıca nötrlendi: ${state.neutralizedPaths.join(', ')}`
      : 'açık dosya yolu yoktu',
  );
};

/* --- adımlar: süreçler ----------------------------------------------------- */

const stopEverything = async (ctx, why) => {
  const { report } = ctx;
  const before = collectProcesses();
  const ids = [...before.app, ...before.llama].map((p) => p.id);
  if (ids.length > 0) {
    console.log(`     kapatılıyor (${why}): ${before.app.length} app · ${before.llama.length} llama-server`);
    killPids(ids);
  }
  const gone = await waitUntil(() => {
    const now = collectProcesses();
    return now.app.length === 0 && now.llama.length === 0;
  }, 20_000, 400);
  report(
    `süreçler: ${why} mevcut app/llama-server kapatıldı`,
    gone,
    `önce: app=${before.app.length} llama=${before.llama.length} · sonra: ${gone ? '0/0' : 'hâlâ var'}`,
  );
  return gone;
};

/* --- adımlar: başlatma ------------------------------------------------------ */

const dismissOverlays = async (page) => {
  const atla = page.getByRole('button', { name: 'Atla', exact: true }).first();
  for (let i = 0; i < 3; i += 1) {
    if (await atla.isVisible().catch(() => false)) {
      await atla.click().catch(() => {});
      await waitUntil(async () => !(await atla.isVisible().catch(() => false)), 3000, 200);
    }
  }
};

const stepLaunch = async (ctx) => {
  const { state, report, artifact } = ctx;
  artifact.appCmd = state.appCmd;
  artifact.launchedByProbe = true;

  // Profil `stepStage`te hazırlandı ve mevcut app/llama orada kapatıldı.
  // Yarış payı: eski `tauri dev` oturumu app'i geri doğurmuş olabilir; başlatmadan
  // hemen önce bir kez daha temizle (ek rapor satırı üretmeden).
  const leftovers = collectProcesses();
  const leftover = [...leftovers.app, ...leftovers.llama].map((p) => p.id);
  if (leftover.length > 0) killPids(leftover);

  const logPath = resolve(OUT_DIR, 'ai-optin-launch.log');
  writeFileSync(logPath, `\n=== ${new Date().toISOString()} · ${state.appCmd} ===\n`, { flag: 'a' });
  state.logFd = openSync(logPath, 'a');
  state.logPath = logPath;
  const env = { ...process.env };
  if (!env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS) {
    env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${CDP_PORT}`;
  }
  state.child = spawn(state.appCmd, {
    cwd: PROJECT_ROOT,
    shell: true,
    env,
    stdio: ['ignore', state.logFd, state.logFd],
  });
  console.log(`uygulama başlatıldı: ${state.appCmd} (log: ${rel(logPath)})`);

  const browser = await waitForCdp(CDP, state.cdpTimeoutMs);
  if (!browser) {
    state.unreachable = true;
    report(
      'uygulama başlatıldı ve CDP erişilebilir',
      false,
      `${state.cdpTimeoutMs} ms içinde ${CDP} yanıt vermedi${state.logPath ? ` (log: ${rel(state.logPath)})` : ''}`,
    );
    return false;
  }
  const page = findAppPage(browser);
  if (!page) {
    state.unreachable = true;
    report('uygulama başlatıldı ve CDP erişilebilir', false, 'uygulama penceresi bulunamadı');
    return false;
  }
  ctx.page = page;
  artifact.appUrl = page.url();
  report('uygulama başlatıldı ve CDP erişilebilir', true, page.url());

  await page.waitForLoadState('load').catch(() => {});
  await dismissOverlays(page);
  await waitUntil(
    () => page.getByRole('button', { name: 'Asistan' }).first().isVisible().catch(() => false),
    25_000,
  );

  // Yol doğrulama: hazırlık, uygulamanın GERÇEKTEN kullandığı dizinde mi yapıldı?
  const actual = await readString(page, 'app_data_path');
  const expected = state.appDataDir;
  const normalize = (value) => String(value ?? '').replace(/[\\/]+$/, '').toLowerCase();
  const matches = actual !== null && normalize(actual) === normalize(expected);
  state.pathMismatch = !matches;
  report(
    'yol doğrulaması: hazırlık dizini uygulamanın app_data_dir ile AYNI',
    matches,
    `beklenen=${expected} · uygulama=${actual ?? 'okunamadı'}`,
  );
  return matches;
};

/* --- adımlar: temiz profil doğrulaması ------------------------------------- */

const watchForProcesses = async (kind, windowMs) => {
  const deadline = Date.now() + windowMs;
  for (;;) {
    const list = collectProcesses()[kind];
    if (list.length > 0) return list;
    if (Date.now() > deadline) return null;
    await sleep(500);
  }
};

const watchForLlama = (windowMs) => watchForProcesses('llama', windowMs);

const uiShot = async (ctx, name) => {
  try {
    const path = resolve(OUT_DIR, name);
    await ctx.page.screenshot({ path, fullPage: true });
    console.log(`     ekran görüntüsü: ${rel(path)}`);
    return rel(path);
  } catch (error) {
    const message = `${name}: ${String(error?.message ?? error)}`;
    ctx.errors.push({ step: 'screenshot', message });
    console.error(`ekran görüntüsü alınamadı — ${message}`);
    return null;
  }
};

/*
 * Metne göre KESİN eşleşen düğme.
 *
 * Neden `getByRole(..., { name, exact: true })` YETMİYOR? Bu kod tabanındaki
 * düğmeler `<svg/><span>Metin</span><span></span>` biçiminde; boş `<span>`
 * erişilebilir ada fazladan boşluk katıyor ve tam eşleşme 0 dönüyor. Gevşek
 * eşleşme ise yanlış düğmeye uyabiliyor ("Ayarlar'dan Aç" → üst çubuktaki
 * "AI kapalı — Ayarlar'dan aç"). Metin regex'i ikisini de çözer.
 */
const buttonByText = (page, text) =>
  page
    .getByRole('button')
    .filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });

/** Başlık öğesi (h1..h6) — aynı boşluk sorunundan bağımsız kesin eşleşme. */
const headingByText = (page, text) =>
  page
    .locator('h1, h2, h3, h4, h5, h6')
    .filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });

/*
 * GÖRÜNÜR düğmeye tıkla.
 *
 * `.first()` de yetmez: bazı düğmeler masaüstü/mobil için İKİ KEZ çiziliyor;
 * gizli kopyaya denk gelirse tıklama HİÇ olmaz ve sonda yanlış ekranı inceler.
 */
const clickButton = async (page, name, { exact = true, timeout = 12_000 } = {}) => {
  const all = exact ? buttonByText(page, name) : page.getByRole('button', { name });
  const deadline = Date.now() + timeout;
  for (;;) {
    const n = await all.count().catch(() => 0);
    for (let i = 0; i < n; i += 1) {
      const el = all.nth(i);
      if (await el.isVisible().catch(() => false)) {
        await el.click();
        return;
      }
    }
    if (Date.now() > deadline) throw new Error(`görünür düğme bulunamadı: ${name}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

/**
 * Donanım tespitinin SÖZLEŞMESİ (kaynak ↔ alanlar). Sabit bir GPU adı iddiası
 * YOKTUR: yalnız "kaynak ne diyorsa o" denetlenir. Böylece başka bir makinede de
 * (nvidia-smi yok → wmi/unknown) sonda doğru şeyi sınar.
 */
const hardwareInvariant = (gpu) => {
  if (!gpu) return [{ label: 'donanım: ai_status.gpu alanı döndü', ok: false, detail: 'gpu yok' }];
  const checks = [
    {
      label: 'donanım: kaynak bilinen üç değerden biri (nvidia-smi|wmi|unknown)',
      ok: ['nvidia-smi', 'wmi', 'unknown'].includes(gpu.source),
      detail: `source=${gpu.source} · name=${gpu.name ?? 'null'} · vram_mb=${gpu.vram_mb ?? 'null'}`,
    },
  ];
  if (gpu.source === 'unknown') {
    checks.push({
      label: 'donanım (unknown): hem ad hem VRAM null (uydurma yok)',
      ok: gpu.name === null && gpu.vram_mb === null,
      detail: `name=${gpu.name} · vram=${gpu.vram_mb}`,
    });
  } else if (gpu.source === 'wmi') {
    checks.push({
      label: 'donanım (wmi): yalnız AD; VRAM null (AdapterRAM kullanılmaz)',
      ok: Boolean(gpu.name) && gpu.vram_mb === null,
      detail: `name=${gpu.name} · vram=${gpu.vram_mb}`,
    });
  } else {
    checks.push({
      label: 'donanım (nvidia-smi): ad + GERÇEK VRAM dolu ve pozitif',
      ok: Boolean(gpu.name) && Number.isInteger(gpu.vram_mb) && gpu.vram_mb > 0,
      detail: `name=${gpu.name} · vram=${gpu.vram_mb}`,
    });
  }
  return checks;
};

/**
 * Rıza onay diyaloğu. Rol adına GÜVENMEYİZ: Base UI sürümüne göre
 * `alertdialog`/`dialog` değişebilir. İki rolü birlikte arayıp İÇİNDE onay
 * düğmesi ("Etkinleştir") bulunanla daraltırız — böylece sayfadaki başka bir
 * `role="dialog"` kabuğu yanlışlıkla eşleşmez; sonda yanlış şeyi bildirmez.
 */
const consentDialog = (page) =>
  page
    .locator('[role="alertdialog"], [role="dialog"]')
    .filter({ has: page.getByRole('button', { name: 'Etkinleştir', exact: true }) })
    .last();

const stepDisabled = async (ctx) => {
  const { state, report, skip, artifact } = ctx;
  const { page } = ctx;

  // Hazırlık, uygulamanın GERÇEKTEN kullandığı dizinde yapılmadıysa "temiz
  // profil" uygulanmamıştır; o hâlde kalan kontroller gerçek profili ölçer ve
  // YANILTICI olur. Dürüstçe atlarız (yol doğrulaması zaten KALDI).
  if (state.pathMismatch) {
    skip(
      'temiz profil doğrulaması (süreç/indirme/arayüz)',
      'hazırlık dizini uygulamanın app_data_dir ile uyuşmadı — temiz profil uygulanmadı',
    );
    return;
  }

  // 1) "0 llama-server": negatif bir iddiadır; doğrudan beklenemez. Açılış
  //    ısıtması ~1.5 sn sonra tetiklendiği için gözlemlenebilir pencere boyunca
  //    süreç listesi izlenir. Süreç GÖRÜNÜRSE kanıt düşer (fail-fast).
  const appeared = await watchForLlama(state.llamaWindowMs);
  report(
    'temiz profil: açılışta 0 llama-server süreci',
    appeared === null,
    appeared
      ? `BEKLENMEDİK: ${appeared.map((p) => `#${p.id}`).join(', ')}`
      : `${state.llamaWindowMs} ms pencere boyunca 0`,
  );

  // 2) "0 indirme": bileşen/model/binary klasörlerinin dosya listesi diff'i.
  const filesAfter = snapshotFiles([state.componentsDir, state.paths.modelsPath, state.paths.binariesPath]);
  const added = newFiles(state.filesBefore, filesAfter);
  report(
    'temiz profil: hiçbir dosya indirilmedi (yeni dosya yok)',
    added.length === 0,
    added.length === 0 ? '0 yeni dosya' : added.map(rel).join(', '),
  );
  artifact.downloads = { before: state.filesBefore, after: filesAfter, newFiles: added.map(rel) };

  // 3) Kanonik durum: `ai_status`.
  const status = await getAiStatus(page);
  artifact.aiStatus = { ...(artifact.aiStatus ?? {}), disabled: status };
  report('temiz profil: ai_status.ai_enabled === false', status.ai_enabled === false, `ai_enabled=${status.ai_enabled}`);
  report(
    'temiz profil: model hazır değil (llm_ready/embed_ready false)',
    status.llm_ready === false && status.embed_ready === false,
    `llm_ready=${status.llm_ready} · embed_ready=${status.embed_ready}`,
  );
  report(
    'temiz profil: sunucular çalışmıyor (chat/embed false)',
    status.chat_server_running === false && status.embed_server_running === false,
    `chat=${status.chat_server_running} · embed=${status.embed_server_running}`,
  );

  // Donanım tespiti sözleşmesi: "ne tespit edildiyse o" (sabit GPU adı YOK).
  artifact.hardware = status.gpu ?? null;
  for (const check of hardwareInvariant(status.gpu)) {
    report(check.label, check.ok, check.detail);
  }

  // 4) Arayüz: semantik arama girişi (CaptureBar) dürüst "AI kapalı" gösterir.
  const captureOff = page.getByRole('button', { name: /AI kapalı — Ayarlar'dan aç/ }).first();
  const captureVisible = await waitUntil(() => captureOff.isVisible().catch(() => false), 10_000);
  report('arayüz (semantik): CaptureBar "AI kapalı — Ayarlar\'dan aç" gösteriyor', captureVisible);
  const shotCapture = await uiShot(ctx, 'ai-optin-disabled-capturebar.png');

  // 5) Yönlendirme düğmesi ÖLÜ DEĞİL: tıklanınca Ayarlar → AI açılır.
  if (captureVisible) {
    await captureOff.click().catch(() => {});
  } else {
    await clickButton(page, 'Ayarlar').catch(() => {});
  }
  const enableButton = page.getByRole('button', { name: "Yerel AI'yı etkinleştir" }).first();
  const settingsOpen = await waitUntil(() => enableButton.isVisible().catch(() => false), 10_000);
  report('arayüz: yönlendirme düğmesi Ayarlar → AI-Yerel AI kartını açtı (ölü düğme yok)', settingsOpen);

  let consentText = null;
  if (settingsOpen) {
    const card = page.getByText('Gerekli toplam indirme', { exact: true });
    const cardVisible = await card.isVisible().catch(() => false);
    report('arayüz (rıza): "Gerekli toplam indirme" + bileşen listesi görünüyor', cardVisible);
    report(
      'arayüz (rıza): "Yerel AI\'yı etkinleştir" düğmesi görünüyor',
      await enableButton.isVisible().catch(() => false),
    );
    await uiShot(ctx, 'ai-optin-disabled-settings.png');

    // Onay diyaloğu: ne indirileceğini ve TOPLAM boyutu ONAYDAN ÖNCE söyler.
    await enableButton.click().catch(() => {});
    const dialog = consentDialog(page);
    const dialogShown = await waitUntil(() => dialog.isVisible().catch(() => false), 8_000);
    if (dialogShown) {
      consentText = (await dialog.innerText().catch(() => '')) ?? '';
      report(
        'arayüz (rıza): onay diyaloğu "hiçbir indirme başlamaz" diyor',
        /hiçbir indirme başlamaz/.test(consentText),
      );
      report(
        'arayüz (rıza): onay diyaloğu toplam indirmeyi gösteriyor',
        /toplam indirme/i.test(consentText),
      );
      await uiShot(ctx, 'ai-optin-consent.png');
      await page.getByRole('button', { name: 'Vazgeç', exact: true }).first().click().catch(() => {});
      const closed = await waitUntil(async () => !(await dialog.isVisible().catch(() => false)), 5000);
      // Kapanmadıysa odak tuzağı sonraki tıklamaları bloklamasın (görünür davranış).
      if (!closed) await page.keyboard.press('Escape').catch(() => {});
    } else {
      report('arayüz (rıza): onay diyaloğu açıldı', false, 'diyalog görünmedi');
    }
  } else {
    skip('arayüz (rıza): onay diyaloğu ve toplam boyut', 'Ayarlar → AI kartı açılamadı');
  }
  artifact.ui = { shotCapture, consentText };

  // 6) Asistan görünümü: dürüst kapalı durum + çalışan düğme.
  /*
   * Önce Ayarlar'dan ÇIK: önceki adım "Ayarlar'dan Aç" ile settingsOnly moduna
   * girdi; o modda ana gezinme çalışmaz ve sonda yanlış ekranı inceler.
   */
  await clickButton(page, 'Arşive Dön', { exact: false }).catch(() => {});
  await waitUntil(
    () => buttonByText(page, 'Asistan').first().isVisible().catch(() => false),
    8_000,
  );
  await clickButton(page, 'Asistan').catch(() => {});
  /*
   * `.first()` YETMİYOR: bu kod tabanı bazı öğeleri masaüstü/mobil için İKİ KEZ
   * çiziyor (gizli kopya). `.first()` gizli kopyaya denk gelirse `isVisible()`
   * sonsuza kadar false kalır ve sonda ürün suçluymuş gibi "KALDI" der.
   * Bu yüzden görünür olan ilk eşleşme aranır.
   */
  const visibleFirst = async (locator) => {
    const n = await locator.count().catch(() => 0);
    for (let i = 0; i < n; i += 1) {
      const el = locator.nth(i);
      if (await el.isVisible().catch(() => false)) return true;
    }
    return false;
  };
  const offHeading = headingByText(page, 'AI kapalı');
  const offHeadingVisible = await waitUntil(() => visibleFirst(offHeading), 10_000);
  report('arayüz (asistan): "AI kapalı" başlığı görünüyor', offHeadingVisible);
  const openSettingsBtn = buttonByText(page, "Ayarlar'dan Aç");
  const openSettingsVisible = await waitUntil(() => visibleFirst(openSettingsBtn), 10_000);
  report('arayüz (asistan): "Ayarlar\'dan Aç" düğmesi görünüyor', openSettingsVisible);
  await uiShot(ctx, 'ai-optin-disabled-assistant.png');

  artifact.proves = [
    'Model dizini yok + config\'te açık `enabled` yok iken açılışta 0 llama-server süreci.',
    'Aynı koşulda bileşen/model/binary klasörlerine 0 yeni dosya (indirme yok).',
    'ai_status.ai_enabled=false; llm_ready/embed_ready=false; chat/embed server=false.',
    'Asistan + semantik arama yüzeyleri dürüst "AI kapalı" durumu ve çalışan yönlendirme düğmesi gösterir.',
    'Ayarlar → AI rıza akışı etkinleştirmeden önce bileşen listesi + toplam indirmeyi gösterir.',
  ];
};

/* --- adımlar: etkin kurulum regresyonu -------------------------------------- */

const expectedOffload = (status) => {
  const vram = status?.gpu?.vram_mb ?? null;
  const model = status?.offload?.model_mb ?? null;
  if (vram === null) return { mode: 'cpu', n: 0, why: 'VRAM okunamadı → CPU (fail-closed)' };
  if (model === null) return { mode: 'cpu', n: 0, why: 'model boyutu okunamadı → CPU' };
  return vram >= model + VRAM_RESERVE_MB
    ? { mode: 'gpu', n: ALL_GPU_LAYERS, why: `${vram} ≥ ${model}+${VRAM_RESERVE_MB}` }
    : { mode: 'cpu', n: 0, why: `${vram} < ${model}+${VRAM_RESERVE_MB}` };
};

const stepEnabled = async (ctx) => {
  const { state, report, skip, artifact, errors } = ctx;
  const { page } = ctx;

  if (state.pathMismatch) {
    skip('etkin kurulum regresyonu', 'hazırlık dizini uygulamanın app_data_dir ile uyuşmadı');
    return;
  }
  if (state.modelsBefore === null) {
    skip('etkin kurulum regresyonu', 'bu makinede model dizini yoktu; etkin kurulum kurulamaz');
    return;
  }

  // 1) Modelleri GERİ koy (uygulama çalışırken; çözümleme her çağrıda diskten).
  if (state.modelsAside) {
    if (existsSync(state.paths.modelsPath)) {
      const entries = readdirSync(state.paths.modelsPath);
      if (entries.length === 0) rmSync(state.paths.modelsPath, { recursive: true, force: true });
    }
    const method = moveFile(state.modelsAside, state.paths.modelsPath);
    state.modelsRestoredLive = method;
    console.log(`     model dizini geri kondu (${method}) — göç yolu artık motor+LLM görür`);
  }

  // 2) Göç kuralı: kayıtlı `enabled` YOK (açılışta çıkarılmıştı) + motor + LLM var
  //    → ETKİN. Bu, "mevcut kurulum etkin kalır" regresyonunun ta kendisidir.
  const migrated = await getAiStatus(page);
  artifact.aiStatus = { ...(artifact.aiStatus ?? {}), migrated };
  report(
    'regresyon (göç): modeller geri gelince mevcut kurulum ETKİN',
    migrated.ai_enabled === true,
    `ai_enabled=${migrated.ai_enabled} · engine_available=${migrated.engine_available} · llm_ready=${migrated.llm_ready}`,
  );

  // 3) AÇIK seçim kazanır: `enabled:false` yazılınca modeller dururken bile KAPALI.
  await invokeStrict(page, 'ai_save_config', { payload: { enabled: false } });
  const forcedOff = await getAiStatus(page);
  report(
    'regresyon: stored enabled=false modeller varken de kazanır (sessizce açılmaz)',
    forcedOff.ai_enabled === false,
    `ai_enabled=${forcedOff.ai_enabled}`,
  );

  // 4) Arayüz rıza akışıyla AÇ (asistan ekranındaki düğme → onay). Aynı zamanda
  //    yönlendirme düğmesinin çalıştığını da kanıtlar (ölü düğme yok).
  await clickButton(page, "Ayarlar'dan Aç").catch(() => {});
  const enableButton = page.getByRole('button', { name: "Yerel AI'yı etkinleştir" }).first();
  const cardReady = await waitUntil(() => enableButton.isVisible().catch(() => false), 10_000);
  if (cardReady) {
    await enableButton.click().catch(() => {});
    const dialog = consentDialog(page);
    if (await waitUntil(() => dialog.isVisible().catch(() => false), 8000)) {
      await page.getByRole('button', { name: 'Etkinleştir', exact: true }).first().click().catch(() => {});
      await waitUntil(async () => !(await dialog.isVisible().catch(() => false)), 8000);
    }
  }
  const enabledCard = page.getByRole('button', { name: "Yerel AI'yı kapat" }).first();
  const uiEnabled = await waitUntil(() => enabledCard.isVisible().catch(() => false), 12_000);
  report('arayüz (rıza): etkinleştirince kart "etkin" durumuna geçti', uiEnabled);
  artifact.ui = { ...(artifact.ui ?? {}), shotEnabled: await uiShot(ctx, 'ai-optin-enabled-settings.png') };

  const enabled = await getAiStatus(page);
  artifact.aiStatus = { ...(artifact.aiStatus ?? {}), enabled };
  report(
    'regresyon: etkinleştirilince ai_status.ai_enabled === true',
    enabled.ai_enabled === true,
    `ai_enabled=${enabled.ai_enabled}`,
  );

  // 5) Offload: karar, BİLDİRİLEN sayılardan yeniden hesaplanır (sabit değil).
  const offload = enabled.offload ?? null;
  const gpu = enabled.gpu ?? null;
  artifact.offload = { gpu, offload };
  const reason = String(offload?.reason ?? '');
  report(
    'offload: karar+gerekçe bildirildi (gerekçe boş değil)',
    offload !== null && reason.trim().length > 0,
    reason || '(gerekçe yok)',
  );
  if (offload && gpu) {
    const expected = expectedOffload(enabled);
    report(
      'offload: bildirilen vram/model ile YENİDEN hesap ↔ karar TUTARLI (değişmez)',
      offload.mode === expected.mode && offload.n_gpu_layers === expected.n,
      `beklenen ${expected.mode}/${expected.n} (${expected.why}) · karar ${offload.mode}/${offload.n_gpu_layers}`,
    );
    report(
      'offload (RTX 5070 Ti beklentisi): VRAM yeterli → mode=gpu, n_gpu_layers=99',
      expected.mode === 'gpu' && offload.mode === 'gpu' && offload.n_gpu_layers === 99,
      `vram_mb=${gpu.vram_mb} · model_mb=${offload.model_mb} · mode=${offload.mode} · ngl=${offload.n_gpu_layers}`,
    );
  } else {
    skip('offload: karar/gerekçe alanları', 'ai_status offload/gpu alanı dönmedi');
  }

  // 6) "Süreç başlar": etkin + ısıtma açıkken gerçek bir llama-server doğar.
  if (enabled.engine_available !== true) {
    skip('regresyon: etkin kurulumda llama-server başlar', 'motor (llama-server) bu makinede kurulu değil');
    return;
  }
  if (enabled.llm_ready !== true && enabled.embed_ready !== true) {
    skip('regresyon: etkin kurulumda llama-server başlar', 'indirilmiş model yok');
    return;
  }
  await invokeStrict(page, 'ai_save_config', { payload: { auto_warmup: true } }).catch((error) => {
    errors.push({ step: 'enabled', message: `auto_warmup yazılamadı: ${String(error?.message ?? error)}` });
  });
  // Isıtmayı ATEŞLE ve BEKLEMEDEN süreç listesini gözle (istek-anı yolu da aynı
  // kapıyı kullanır). `evaluate` içinde await EDİLMEZ: model yüklemesi uzun sürer.
  await page
    .evaluate(() => {
      window.__TAURI_INTERNALS__.invoke('ai_warmup').catch(() => {});
      return true;
    })
    .catch(() => {});
  const spawned = await watchForLlama(90_000);
  const afterSpawn = spawned ? await getAiStatus(page) : null;
  report(
    'regresyon: etkin kurulumda llama-server süreci başladı',
    spawned !== null,
    spawned
      ? `${spawned.length} süreç · chat_server_running=${afterSpawn?.chat_server_running}`
      : '90 sn içinde llama-server görünmedi',
  );
  artifact.spawn = { spawned: spawned ?? null, chatRunning: afterSpawn?.chat_server_running ?? null };
  await invokeRaw(page, 'ai_stop_server', undefined).catch(() => {});
};

/* --- adımlar: grep kanıtı --------------------------------------------------- */

const stepGrep = async (ctx) => {
  const { report, artifact } = ctx;
  const frontend = scanDir(resolve(PROJECT_ROOT, 'src'), FRONTEND_HARDCODED);
  report(
    "grep: src/ altında sabit donanım metni YOK ('5070' | 'GDDR' | '10.5 GB')",
    frontend.length === 0,
    frontend.length === 0 ? '0 eşleşme' : frontend.map((m) => `${m.file}:${m.line}`).join(', '),
  );

  const backend = scanDir(resolve(PROJECT_ROOT, 'src-tauri/src'), BACKEND_HARDCODED);
  const testModLine = (() => {
    const file = resolve(PROJECT_ROOT, 'src-tauri/src/hardware.rs');
    if (!existsSync(file)) return Number.MAX_SAFE_INTEGER;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const index = lines.findIndex((line) => /^\s*mod\s+tests\b/.test(line));
    return index < 0 ? Number.MAX_SAFE_INTEGER : index + 1;
  })();
  const allowed = backend.filter(
    (m) =>
      m.text.trim().startsWith('//') ||
      m.text.trim().startsWith('*') ||
      m.text.trim().startsWith('/*') ||
      (m.file === 'src-tauri/src/hardware.rs' && m.line > testModLine),
  );
  const disallowed = backend.filter((m) => !allowed.includes(m));
  report(
    'grep: src-tauri/src/ sabit donanım metni yalnız YORUM veya hardware.rs test düzeneği',
    disallowed.length === 0,
    disallowed.length === 0
      ? `${backend.length} eşleşme (hepsi yorum/test: ${backend.map((m) => `${m.file}:${m.line}`).join(', ') || 'yok'})`
      : disallowed.map((m) => `${m.file}:${m.line}`).join(', '),
  );

  const aiPath = resolve(PROJECT_ROOT, 'src-tauri/src/ai.rs');
  const aiText = existsSync(aiPath) ? readFileSync(aiPath, 'utf8') : '';
  const arg99 = ARG_99_LITERAL.test(aiText);
  report("grep: ai.rs üretim kodunda .arg(\"99\") sabiti YOK", !arg99, `eşleşme=${arg99}`);

  artifact.grep = {
    frontendPattern: String(FRONTEND_HARDCODED),
    frontendMatches: frontend,
    backendPattern: String(BACKEND_HARDCODED),
    backendMatches: backend,
    backendAllowed: allowed,
    backendDisallowed: disallowed,
    hardwareTestModLine: testModLine === Number.MAX_SAFE_INTEGER ? null : testModLine,
    arg99Literal: arg99,
  };
};

/* --- adımlar: geri yükleme -------------------------------------------------- */

const stopSpawnedApp = async (ctx) => {
  const { state } = ctx;
  if (state.child) {
    killSpawnedTree(state.child);
    state.child = null;
  }
  // `ai_stop_server` zaten çağrıldı ama emin ol: kalan llama-server süreçleri de
  // kapatılır (dosyaların serbest kalması için) — başka sürece dokunulmaz.
  const llama = collectProcesses().llama;
  if (llama.length > 0) killPids(llama.map((p) => p.id));
  await waitUntil(() => {
    const now = collectProcesses();
    return now.llama.length === 0 && now.app.length === 0;
  }, 20_000, 400);
};

const restoreEverything = async (ctx) => {
  const { state, errors } = ctx;
  const record = { config: null, models: null, appKilled: false };
  try {
    await stopSpawnedApp(ctx);
    record.appKilled = true;
  } catch (error) {
    errors.push({ step: 'restore-stop', message: String(error?.message ?? error) });
    console.error(`süreç kapatma hatası: ${String(error?.message ?? error)}`);
  }

  const { configPath, modelsPath } = state.paths ?? {};
  try {
    if (state.configAside) {
      if (existsSync(configPath)) rmSync(configPath, { force: true, recursive: true });
      const method = moveFile(state.configAside, configPath);
      record.config = { restored: true, method, from: state.configAside };
    } else if (state.configCreated) {
      if (existsSync(configPath)) rmSync(configPath, { force: true, recursive: true });
      record.config = { restored: true, method: 'created-removed', from: null };
    } else {
      record.config = { restored: true, method: 'untouched', from: null };
    }
  } catch (error) {
    record.config = { restored: false, reason: String(error?.message ?? error) };
    errors.push({ step: 'restore-config', message: String(error?.message ?? error) });
    console.error(`YAPILANDIRMA GERİ YÜKLENEMEDİ: ${String(error?.message ?? error)}`);
  }

  try {
    if (state.modelsAside) {
      let handled = false;
      /*
       * Sonda modelleri regresyon testinden ÖNCE erken geri koyar (göç yolunu
       * sınamak için). Bu yüzden `finally`'deki bu ikinci deneme, hedefi ZATEN
       * yerinde bulur ve "geri yüklenemedi" demek YANLIŞ olurdu. Önce şu sorulur:
       * yedek yok + hedef dolu ise iş çoktan yapılmıştır.
       */
      if (!existsSync(state.modelsAside) && existsSync(modelsPath)) {
        record.models = { restored: true, method: 'already-restored-earlier', from: state.modelsAside };
        handled = true;
      }
      if (!handled && existsSync(modelsPath)) {
        /*
         * Uygulama açılışta `jointvault-models/` dizinini YENİDEN oluşturur (yolu
         * çözerken `create_dir_all`). Boş bir dizin engel değildir — silinip
         * yedek geri konur. DOLU bir dizin ise veri kaybı riskidir; ama "geri
         * yüklenemedi" demek de yanlış olabilir: uygulama aynı dosyaları yeniden
         * üretmiş olabilir. Önce İÇERİK karşılaştırılır — aynıysa zaten istenen
         * durumdayız, farklıysa yüksek sesle hata verilir.
         */
        const targetEntries = readdirSync(modelsPath);
        if (targetEntries.length === 0) {
          rmSync(modelsPath, { recursive: true, force: true });
        } else if (sameDirectoryContent(state.modelsAside, modelsPath)) {
          rmSync(state.modelsAside, { recursive: true, force: true });
          record.models = { restored: true, method: 'already-identical', from: state.modelsAside };
          handled = true;
        } else {
          throw new Error(`model dizini beklenmedik biçimde dolu, üzerine yazılmadı: ${modelsPath}`);
        }
      }
      if (!handled) {
        const method = moveFile(state.modelsAside, modelsPath);
        record.models = { restored: true, method, from: state.modelsAside };
      }
    } else {
      record.models = { restored: true, method: 'untouched', from: null };
    }
  } catch (error) {
    record.models = { restored: false, reason: String(error?.message ?? error) };
    errors.push({ step: 'restore-models', message: String(error?.message ?? error) });
    console.error(`MODEL DİZİNİ GERİ YÜKLENEMEDİ: ${String(error?.message ?? error)} (aside: ${state.modelsAside})`);
  }

  if (state.logFd !== undefined) {
    try {
      closeSync(state.logFd);
    } catch {
      /* zaten kapalı */
    }
    state.logFd = undefined;
  }
  state.restoreRecord = record;
  return record;
};

const verifyRestored = async (ctx) => {
  const { state, report, errors } = ctx;
  const record = state.restoreRecord ?? {};
  report(
    'geri yükleme: yapılandırma eski hâline döndü',
    record.config?.restored === true,
    record.config?.restored ? `${record.config.method}` : record.config?.reason ?? 'koşmadı',
  );
  report(
    'geri yükleme: model dizini eski hâline döndü',
    record.models?.restored === true,
    record.models?.restored ? `${record.models.method}` : record.models?.reason ?? 'koşmadı',
  );

  const { configPath, modelsPath } = state.paths ?? {};
  if (!configPath) return;
  const after = readJsonFile(configPath);
  const before = state.configBefore ?? {};
  const configSame = before.existed ? after.existed && after.raw === before.raw : !after.existed;
  report(
    'geri doğrulama: yapılandırma bulunduğu gibi (bayt-bayt)',
    configSame,
    before.existed ? `önce=${before.raw?.length ?? 0}B · sonra=${after.raw?.length ?? 0}B` : 'dosya yoktu, hâlâ yok',
  );
  if (before.existed && !configSame) {
    errors.push({ step: 'verify-config', message: 'config içeriği orijinalinden farklı' });
  }

  const modelsAfter = existsSync(modelsPath) ? readdirSync(modelsPath).sort() : null;
  const modelsSame =
    (state.modelsBefore === null && modelsAfter === null) ||
    (state.modelsBefore !== null &&
      modelsAfter !== null &&
      state.modelsBefore.length === modelsAfter.length &&
      state.modelsBefore.every((name, i) => name === modelsAfter[i]));
  report(
    'geri doğrulama: model dizini bulunduğu gibi',
    modelsSame,
    state.modelsBefore === null
      ? `önce yoktu · sonra=${modelsAfter === null ? 'yok' : `${modelsAfter.length} öğe`}`
      : `önce ${state.modelsBefore.length} · sonra ${modelsAfter?.length ?? 'yok'}`,
  );
  if (!modelsSame) errors.push({ step: 'verify-models', message: 'model dizini içeriği orijinalinden farklı' });
};

/* --- akış ------------------------------------------------------------------ */

const main = async () => {
  if (process.platform !== 'win32') {
    console.error('Bu sonda Windows gerektirir (süreç listesi: PowerShell/taskkill).');
    return endProbe(2);
  }

  ensureOutDir();
  const { results, skips, errors, report, skip } = createReporter();
  const state = {
    appCmd: process.env.JV_APP_CMD ?? 'npx tauri dev',
    cdpTimeoutMs: Number(process.env.JV_CDP_TIMEOUT_MS ?? 300_000),
    llamaWindowMs: Number(process.env.JV_LLAMA_WINDOW_MS ?? 12_000),
    child: null,
    logFd: undefined,
    logPath: null,
    unreachable: false,
    pathMismatch: false,
    configCreated: false,
    configAside: null,
    modelsAside: null,
    neutralizedPaths: [],
    restoreRecord: null,
  };
  const artifact = {
    kind: 'ai-optin-probe',
    synthetic: false,
    note: 'Faz 8b: temiz profilde açılışta 0 llama-server + 0 indirme; dürüst AI-kapalı durumu; etkin kurulum regresyonu (göç + stored kazanır + offload kararı); sabit donanım metni grep kanıtı.',
    capturedAt: new Date().toISOString(),
    cdp: CDP,
    appCmd: state.appCmd,
    launchedByProbe: true,
    proves: [],
    doesNotProve: [],
  };
  const ctx = { page: null, report, skip, results, skips, errors, artifact, state };
  const startedAt = Date.now();

  try {
    await stepDiscover(ctx);
    await stepStage(ctx);
    await stepGrep(ctx);
    const launched = await stepLaunch(ctx);
    if (launched) {
      await stepDisabled(ctx);
      await stepEnabled(ctx);
    } else {
      skip('temiz profil doğrulaması (süreç/indirme/arayüz)', 'uygulamaya bağlanılamadı');
      skip('etkin kurulum regresyonu', 'uygulamaya bağlanılamadı');
    }
  } catch (error) {
    const message = String(error?.stack ?? error?.message ?? error);
    errors.push({ step: 'fatal', message });
    report('sonda hatasız tamamlandı', false, String(error?.message ?? error));
    console.error(message);
  } finally {
    try {
      await restoreEverything(ctx);
    } catch (error) {
      const message = String(error?.message ?? error);
      errors.push({ step: 'restore', message });
      console.error(`geri yükleme katmanı hatası: ${message}`);
    }
  }

  try {
    await verifyRestored(ctx);
  } catch (error) {
    const message = String(error?.message ?? error);
    errors.push({ step: 'verify-restore', message });
    report('geri doğrulama tamamlandı', false, message);
    console.error(message);
  }

  artifact.doesNotProve = [
    'Gerçek paketlenmiş kurulum değil: motor ikilileri (llama-server + CUDA) YERİNDE bırakıldı, yalnız model dizini gizlendi. Göç kuralı ikisini de istediği için sonuç aynıdır; ama installer kanıtı Faz 18 işidir.',
    '"0 indirme" yalnız dosya-listesi diff\'iyle gözlendi; ağ trafiği dinlenmedi.',
    'llama-server süreç listesi PowerShell ile okunur; kısa ömürlü geçici süreçler pencere dışında kaçmış olabilir.',
    'Transkript/embedding İÇERİĞİ ve model kalitesi sınanmadı.',
  ];
  artifact.results = results;
  artifact.skips = skips;
  artifact.errors = errors;
  artifact.exposedErrorCount = errors.length;
  artifact.timings = { totalMs: Date.now() - startedAt };
  artifact.restore = state.restoreRecord;

  try {
    writeFileSync(resolve(OUT_DIR, 'ai-optin-probe.json'), JSON.stringify(artifact, null, 2), 'utf8');
    console.log('\nprovenance: ai-optin-probe.json + ekran görüntüleri (ai-optin-*.png) + ai-optin-launch.log');
  } catch (error) {
    const message = String(error?.message ?? error);
    errors.push({ step: 'artifact', message });
    console.error(`artifact yazılamadı: ${message}`);
  }

  const failed = results.filter((entry) => !entry.ok).length;
  if (state.unreachable) {
    console.log(`\nSONUÇ: uygulamaya bağlanılamadı (exit 2) · ${failed} kontrol KALDI · ${errors.length} hata`);
    return endProbe(2);
  }
  console.log(
    failed === 0 && errors.length === 0
      ? `\nSONUÇ: tüm kontroller GEÇTİ${skips.length > 0 ? ` (${skips.length} kontrol ATLANDI — kanıtlanmadı)` : ''}`
      : `\nSONUÇ: ${failed} kontrol KALDI · ${errors.length} hata${skips.length > 0 ? ` · ${skips.length} atlandı` : ''} (artifact: dev/out/ai-optin-probe.json)`,
  );
  return endProbe(failed === 0 && errors.length === 0 ? 0 : 1);
};

await main();
