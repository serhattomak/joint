/*
 * Eksik bileşen sondası — üretim kodu DEĞİL.
 *
 * NE KANITLAR (Faz 7c-1 çıkış ölçütü): ffmpeg KURULU DEĞİLKEN her medya komutunun
 * ham bir OS hatası ya da sessiz bir no-op yerine **yapılandırılmış** bir durum
 * döndürdüğünü: `BILESEN_EKSIK:ffmpeg` + ikinci satırda okunabilir Türkçe ayrıntı.
 * Ayrıca `health_check`/`components_status`'un "eksik" durumunu dürüstçe (hata
 * değil, `available:false`) bildirdiğini ve 7a paritesinin eksikken de tuttuğunu.
 *
 * NEDEN DOSYALAR GEÇİCİ YEDEĞE ALINIR (temiz profil taklidi):
 * `resolve()` önce `components/`e, sonra uygulamanın YANINDAKİ gömülü sidecar'a
 * bakar. Geliştirme makinesinde gömülü ffmpeg HEP vardır; bu yüzden "eksik bileşen"
 * yolu elle taklit edilmeden ASLA çalışmaz ve sonda hiçbir şey kanıtlamaz. Bu yüzden
 * gölgeleyebilecek her dosya (exe yanındaki gömülü kopyalar + `components/`teki
 * indirilmiş kopyalar + yt-dlp'nin `<indirme>/.tools` altındaki DÜZ-adlı kopyaları)
 * `finally` içinde geri konmak üzere geçici bir yedeğe TAŞINIR (SİLİNMEZ). Mekanizma
 * `dev/lib/clean-profile.mjs`'te TEK yerde yaşar (bkz. o dosyadaki gerekçe).
 *
 * Kullanım:
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev            # pencere açıldıktan sonra:
 *   npm run verify:missing-component
 *
 * Ortam değişkenleri:
 *   JV_CDP=...           CDP ucu (varsayılan http://127.0.0.1:9222)
 *   JV_APP_EXE_DIR=...   uygulamanın exe klasörü (otomatik bulunamazsa)
 *   JV_OUT=...           çıktı klasörü (varsayılan dev/out)
 *
 * Çıkış kodları: 0 tümü geçti · 1 kalan kontrol/hata var · 2 uygulama kapalı.
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OUT_DIR, endProbe, ensureOutDir, findAppPage, waitForCdp } from './lib/browser.mjs';
import {
  backupShadows,
  cleanupProfile,
  findAppExeDir,
  planShadows,
  writeManifest,
} from './lib/clean-profile.mjs';

const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --- sabitler -------------------------------------------------------------- */

// Tel formatı: üretimde TEK tanım `components.rs:MISSING_PREFIX`. Sonda, arayüz
// sözleşmesini bağımsız doğrulayabilsin diye literal'i BURADA çiviler (bir testin
// sabiti çivmesi gibi); üretim koduna string kopyası eklenmez.
const MISSING_PREFIX = 'BILESEN_EKSIK:';
const COMPONENT_ID = 'ffmpeg';
const FAKE_DIR_NAME = 'missing-probe-tmp';
// `.invalid` TLD (RFC 2606): asla çözülmez — yanlışlıkla ağa çıkılsa bile beklemez.
const FAKE_URL = 'https://example.invalid/jointvault-missing-component-probe.mp4';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

/* --- saf yardımcılar ------------------------------------------------------- */

const findById = (list, id) => (list ?? []).find((component) => component.id === id) ?? null;

// Kaydın yalnızca sözleşmeye bakan alanları (artifact şişmesin).
const pick = (component) =>
  component
    ? {
        id: component.id,
        installed: component.installed,
        runnable: component.runnable,
        source: component.source,
        version: component.version,
        path: component.path,
      }
    : null;

const pickFf = (list) => ({
  ffmpeg: pick(findById(list, 'ffmpeg')),
  ffprobe: pick(findById(list, 'ffprobe')),
});

// `components.rs:parse_missing_signal`in birebir JS karşılığı: önek BAŞTA olmalı,
// yalnızca ilk satır (id) okunur; boş id reddedilir (fail closed). Test kodunun
// üretimi taklit etmesi serbesttir — burada amaç üretim mantığını çalmak değil,
// tel sözleşmesini bağımsız doğrulamak.
const parseMissingSignal = (error) => {
  const rest = String(error ?? '').trim();
  if (!rest.startsWith(MISSING_PREFIX)) return null;
  const id = (rest.slice(MISSING_PREFIX.length).split(/\r?\n/)[0] ?? '').trim();
  return id.length > 0 ? id : null;
};

// `components.rs:parse_missing_detail`: önekten SONRAKİ satır kullanıcı metnidir.
// Varlığı, önekin kullanıcıya YALNIZ başına gösterilmediğinin kanıtıdır.
const parseMissingDetail = (error) => {
  const rest = String(error ?? '').trim();
  if (!rest.startsWith(MISSING_PREFIX)) return null;
  const parts = rest.split(/\r?\n/);
  if (parts.length < 2) return null;
  const detail = parts.slice(1).join('\n').trim();
  return detail.length > 0 ? detail : null;
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

const getHealth = async (page) => {
  const result = await invokeRaw(page, 'health_check', undefined);
  if (!result.ok) throw new Error(`health_check başarısız: ${result.error}`);
  const raw = result.value;
  try {
    return JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
  } catch (error) {
    throw new Error(`health_check JSON ayrıştırılamadı: ${String(error?.message ?? error)}`);
  }
};

const getDownloadDir = async (page) => {
  const result = await invokeRaw(page, 'get_download_dir', undefined);
  return result.ok ? String(result.value) : null;
};

/*
 * Bileşenler sekmesini aç ve BÖLÜMÜN GERÇEKTEN ÇİZİLMESİNİ BEKLE.
 *
 * Sabit `sleep` yetmiyordu: ilk koşuda bir kez "0 satır" yanlış-düşüşü üretti
 * (sekme geçişi bir yarışta kayboldu). Ölçüt artık gözlemlenebilir bir DOM
 * durumu: bölüm başlığı/uyarısı görünene kadar bekle. Sonda yanlış şeyi
 * bildirirse kanıt da yanlış olur.
 */
const openComponentsSection = async (page) => {
  await page.getByRole('button', { name: 'Ayarlar' }).first().click().catch(() => {});
  await sleep(600);
  await page.getByRole('button', { name: 'Bileşenler' }).first().click().catch(() => {});
  // "Durumu yenile" düğmesi yalnız Bileşenler bölümü çizilince var olur.
  const ready = page.getByRole('button', { name: 'Durumu yenile', exact: true }).first();
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (await ready.isVisible().catch(() => false)) return;
    if (Date.now() > deadline) return; // bölüm açılamadı: çağıran yine de raporlar
    await sleep(300);
  }
};

/* --- senaryolar ------------------------------------------------------------ */

// yt-dlp, `--ffmpeg-location` dizininde DÜZ adlı ffmpeg.exe/ffprobe.exe arar ve
// `ensure_ffmpeg_tools` bunlar varsa KAYDA HİÇ BAKMADAN kısa yoldan döner. Eksik
// durumu gerçekten sınamak için bu kopyalar da gizlenmeli; yoksa `download_media`
// kapıyı atlar ve "eksik bileşen" sinyali yerine ağa çıkmaya çalışır.
const toolsExtras = (downloadDir) => {
  if (!downloadDir) return [];
  return ['ffmpeg.exe', 'ffprobe.exe']
    .map((name) => join(downloadDir, '.tools', name))
    .filter((path) => existsSync(path))
    .map((from) => ({ from, kind: 'tools' }));
};

/**
 * Şekil-geçerli (shape-valid) ama sahte yollu yükler. Önemli: bazı komutlar girdi
 * doğrulamasını kapıdan ÖNCE yapar (ör. `download_media` önce `item_id`/`url`/`kind`
 * okur); eksik bileşen durumunun maskelenmemesi için yük GERÇEK bir çağrınınkine
 * benzemelidir. `outputs`, "yarım çıktı oluşmadı" kontrolünün baktığı yollardır.
 */
const buildCases = (tmpDir) => {
  const input = join(tmpDir, 'probe-input.mp4');
  const input2 = join(tmpDir, 'probe-input-2.mp4');
  const srt = join(tmpDir, 'probe-subtitle.srt');
  const outConvert = join(tmpDir, 'probe-convert.mp4');
  const outGif = join(tmpDir, 'probe-gif.gif');
  const outMerge = join(tmpDir, 'probe-merge.mp4');
  const outTrim = join(tmpDir, 'probe-trim.mp4');
  const outEmbed = join(tmpDir, 'probe-embed.mp4');
  const outExtract = join(tmpDir, 'probe-extract.srt');
  return [
    {
      command: 'convert_media',
      args: {
        payload: {
          input_path: input,
          output_path: outConvert,
          job_id: 'missing-probe-convert',
          op: { kind: 'mp3' },
        },
      },
      outputs: [outConvert],
    },
    {
      command: 'make_gif',
      args: {
        payload: {
          input_path: input,
          output_path: outGif,
          job_id: 'missing-probe-gif',
          format: 'gif',
          from: '0',
          to: '1',
          width: 320,
          fps: 10,
        },
      },
      outputs: [outGif],
    },
    {
      command: 'merge_media',
      args: {
        payload: {
          input_paths: [input, input2],
          output_path: outMerge,
          job_id: 'missing-probe-merge',
        },
      },
      outputs: [outMerge],
    },
    {
      command: 'trim_silence',
      args: {
        payload: {
          input_path: input,
          output_path: outTrim,
          job_id: 'missing-probe-silence',
          preset: 'normal',
          preview: false,
        },
      },
      outputs: [outTrim],
    },
    { command: 'media_probe', args: { payload: { input_path: input } }, outputs: [] },
    {
      command: 'embed_subtitle',
      validationFirst: true,
      args: {
        payload: {
          video_path: input,
          srt_path: srt,
          output_path: outEmbed,
          job_id: 'missing-probe-embed',
        },
      },
      outputs: [outEmbed],
    },
    {
      command: 'extract_subtitle',
      validationFirst: true,
      args: {
        payload: {
          video_path: input,
          output_srt: outExtract,
          job_id: 'missing-probe-extract',
          stream_index: 0,
        },
      },
      outputs: [outExtract],
    },
    {
      command: 'download_media',
      validationFirst: true,
      args: {
        payload: {
          item_id: 'missing-probe-download',
          url: FAKE_URL,
          kind: 'video',
          quality: '720',
        },
      },
      outputs: [],
    },
  ];
};

/* --- adımlar --------------------------------------------------------------- */

const stepBaseline = async (ctx) => {
  const { page, report, artifact } = ctx;
  const status = await getComponents(page);
  const health = await getHealth(page);
  const ffmpeg = findById(status, 'ffmpeg');
  const ffprobe = findById(status, 'ffprobe');

  artifact.availability.before = {
    status: pickFf(status),
    health: { ffmpeg: health?.ffmpeg ?? null, ffprobe: health?.ffprobe ?? null },
  };

  /*
   * Taban bir ÖN KOŞUL değil, kayıt: 7d'den sonra ffmpeg gömülü gelmiyor.
   * "Kurulu değil" doğru başlangıçtır; sonda zaten gerçek "hiç ffmpeg yok"
   * durumunu sınar (gölgelenecek dosya kalmasa bile).
   */
  report('taban: ffmpeg durumu kaydedildi', true, `installed=${ffmpeg?.installed} (7d: gömülü gelmez)`);
  report('taban: ffprobe durumu kaydedildi', true, `installed=${ffprobe?.installed} (7d: gömülü gelmez)`);
  report(
    'taban (7a parite): ffmpeg kayıt ↔ health AYNI',
    ffmpeg?.installed === health?.ffmpeg?.available,
    `kayıt=${ffmpeg?.installed} · health=${health?.ffmpeg?.available}`,
  );
  report(
    'taban (7a parite): ffprobe kayıt ↔ health AYNI',
    ffprobe?.installed === health?.ffprobe?.available,
    `kayıt=${ffprobe?.installed} · health=${health?.ffprobe?.available}`,
  );
};

const stepHide = async (ctx) => {
  const { page, report, state, artifact } = ctx;
  const pathResult = await invokeRaw(page, 'components_path', undefined);
  if (!pathResult.ok) throw new Error(`components_path alınamadı: ${pathResult.error}`);
  state.componentsDir = String(pathResult.value);
  state.downloadDir = await getDownloadDir(page);

  const extra = toolsExtras(state.downloadDir);
  const plan = planShadows({ exeDir: state.exeDir, componentsDir: state.componentsDir, extra });
  state.backupDir = ensureOutDir(join('clean-profile-backup', `${STAMP}-missing`));
  console.log(`temiz profil: ${plan.length} gölge dosya yedeklenecek → ${state.backupDir}`);
  state.backupEntries = backupShadows(plan, state.backupDir);
  writeManifest(state.backupDir, state.backupEntries);
  state.pristine = new Set(readdirSync(state.componentsDir));

  const before = artifact.availability.before?.status ?? pickFf(await getComponents(page));
  const after = pickFf(await getComponents(page));
  artifact.cleanProfile = {
    exeDir: state.exeDir,
    exeDirHow: state.exeHow,
    componentsDir: state.componentsDir,
    downloadDir: state.downloadDir,
    toolsHidden: extra.map((entry) => entry.from),
    backedUp: state.backupEntries,
    before,
    after,
  };

  report(
    'gizlendi: ffmpeg artık kurulu DEĞİL',
    after.ffmpeg?.installed === false,
    `önce: ${before.ffmpeg?.installed} (${before.ffmpeg?.source ?? '-'}) → sonra: ${after.ffmpeg?.installed}`,
  );
  report(
    'gizlendi: ffprobe artık kurulu DEĞİL',
    after.ffprobe?.installed === false,
    `önce: ${before.ffprobe?.installed} (${before.ffprobe?.source ?? '-'}) → sonra: ${after.ffprobe?.installed}`,
  );
  if (extra.length > 0) {
    report(
      `gizlendi: yt-dlp .tools kopyaları da yedeklendi (${extra.length})`,
      true,
      extra.map((entry) => entry.from).join(', '),
    );
  }
};

/**
 * Sıralama sondası: ŞEKİLSİZ (`payload: {}`) bir istekle her komutu çağırır ve
 * dönen hatayı sınıflar. `gate-first` → kapı (require_tool) girdi doğrulamasından
 * ÖNCE, yani eksik bileşen bozuk istekte bile görünür. `validation-first` → komut
 * önce girdiyi doğrular; şekilsiz bir istek eksik bileşen durumunu MASKELEYEBİLİR
 * (istemci doğru yük gönderirse kapıya yine ulaşılır — bu yüzden bu bir BULGUDUR,
 * kırılma değil; artifact'a yazılır).
 */
const classifyOrdering = (result) => {
  if (result.ok) return 'succeeded';
  return parseMissingSignal(result.error) ? 'gate-first' : 'validation-first';
};

const stepOrdering = async (ctx) => {
  const { page, report, artifact, cases } = ctx;
  artifact.ordering = [];
  for (const testCase of cases) {
    const result = await invokeRaw(page, testCase.command, { payload: {} });
    const kind = classifyOrdering(result);
    const firstLine = result.ok ? null : String(result.error).split(/\r?\n/)[0];
    artifact.ordering.push({ command: testCase.command, kind, error: firstLine });
    if (kind === 'validation-first') {
      report(
        `sıralama: ${testCase.command} — girdi doğrulaması KAPIDAN ÖNCE (eksik bileşen maskelenebilir)`,
        true,
        firstLine ?? '',
      );
    } else if (kind === 'gate-first') {
      report(`sıralama: ${testCase.command} — kapı ilk (şekilsiz istekte bile sinyal)`, true);
    } else {
      report(`sıralama: ${testCase.command} — beklenmedik başarı`, false);
    }
  }
  const validationFirst = artifact.ordering
    .filter((entry) => entry.kind === 'validation-first')
    .map((entry) => entry.command);
  artifact.validationBeforeGate = validationFirst;
  if (validationFirst.length > 0) {
    console.log(`     NOT: doğrulama kapıdan ÖNCE olan komutlar: ${validationFirst.join(', ')}`);
  }
};

const stepSignals = async (ctx) => {
  const { page, report, artifact, cases } = ctx;
  artifact.commands = [];
  for (const testCase of cases) {
    const result = await invokeRaw(page, testCase.command, testCase.args);
    const rejected = result.ok === false;
    const signalId = rejected ? parseMissingSignal(result.error) : null;
    const detail = rejected ? parseMissingDetail(result.error) : null;
    const created = (testCase.outputs ?? []).filter((path) => existsSync(path));
    const structured = rejected && signalId === COMPONENT_ID;
    const readable = Boolean(detail) && detail.includes(COMPONENT_ID) && !detail.includes(MISSING_PREFIX);

    report(
      `${testCase.command}: BILESEN_EKSIK:${COMPONENT_ID} döndü (ham OS hatası yok)`,
      structured,
      rejected ? String(result.error).split(/\r?\n/)[0] : 'beklenmedik başarı',
    );
    report(
      `${testCase.command}: ikinci satır okunabilir Türkçe ayrıntı taşıyor`,
      readable,
      detail ?? '(ayrıntı satırı yok)',
    );
    report(
      `${testCase.command}: yarım çıktı oluşmadı`,
      created.length === 0,
      created.length > 0 ? created.join(', ') : `${(testCase.outputs ?? []).length} yol kontrol edildi`,
    );

    artifact.commands.push({
      command: testCase.command,
      validationBeforeGate: Boolean(testCase.validationFirst),
      rejected,
      signalId,
      signalOk: structured,
      detail,
      outputs: testCase.outputs ?? [],
      outputCreated: created,
    });
  }

  // Sessizlik testi: `detect_silences` eskiden eksik ffmpeg'de boş liste dönüyordu ve
  // `trim_silence` "sessizlik yok" sanıp BAŞARIYLA dönüyordu. Artık sinyal dönmeli.
  const trim = artifact.commands.find((entry) => entry.command === 'trim_silence');
  report(
    'sessizlik testi: trim_silence "sessizlik yok" (boş sonuç) yoluna düşmedi, sinyal döndü',
    Boolean(trim) && trim.rejected && trim.signalId === COMPONENT_ID,
    trim ? `rejected=${trim.rejected} · sinyal=${trim.signalId ?? '-'}` : 'trim_silence koşmadı',
  );
};

const stepHonesty = async (ctx) => {
  const { page, report, artifact } = ctx;
  const status = await getComponents(page);
  const health = await getHealth(page);
  const ffmpeg = findById(status, 'ffmpeg');
  const ffprobe = findById(status, 'ffprobe');

  artifact.availability.during = {
    status: pickFf(status),
    health: { ffmpeg: health?.ffmpeg ?? null, ffprobe: health?.ffprobe ?? null },
  };

  report(
    'eksikken: health_check okunabildi ve JSON şekli korundu',
    Boolean(health?.ffmpeg) && Boolean(health?.ffprobe),
    `ffmpeg=${JSON.stringify(health?.ffmpeg)}`,
  );
  report(
    'eksikken: health_check ffmpeg available:false (hata DEĞİL)',
    health?.ffmpeg?.available === false,
    `available=${health?.ffmpeg?.available}`,
  );
  report(
    'eksikken: health_check ffprobe available:false (hata DEĞİL)',
    health?.ffprobe?.available === false,
    `available=${health?.ffprobe?.available}`,
  );
  report('eksikken: components_status ffmpeg kurulu değil', ffmpeg?.installed === false, `installed=${ffmpeg?.installed}`);
  report('eksikken: components_status ffprobe kurulu değil', ffprobe?.installed === false, `installed=${ffprobe?.installed}`);
  report(
    'eksikken (7a parite): ffmpeg kayıt ↔ health AYNI',
    ffmpeg?.installed === health?.ffmpeg?.available,
    `kayıt=${ffmpeg?.installed} · health=${health?.ffmpeg?.available}`,
  );
  report(
    'eksikken (7a parite): ffprobe kayıt ↔ health AYNI',
    ffprobe?.installed === health?.ffprobe?.available,
    `kayıt=${ffprobe?.installed} · health=${health?.ffprobe?.available}`,
  );
};

const stepScreenshot = async (ctx) => {
  const { page, report, errors } = ctx;
  try {
    await openComponentsSection(page);
    // Satırlar `components_status` dönünce çizilir: sabit bekleme yerine damgayı
    // gözlemle (yarış yok). Bölüm zaten açıksa ilk turda döner.
    let eksikRows = 0;
    const deadline = Date.now() + 10_000;
    for (;;) {
      eksikRows = await page.getByText('eksik').count();
      if (eksikRows > 0 || Date.now() > deadline) break;
      await sleep(300);
    }
    report('arayüz: Bileşenler bölümü eksik durumu gösteriyor', eksikRows > 0, `${eksikRows} satır`);
    await ctx.shot('missing-component-ayarlar.png');
  } catch (error) {
    const message = String(error?.message ?? error);
    errors.push({ step: 'screenshot', message });
    report('arayüz: Bileşenler bölümü eksik durumu gösteriyor', false, message);
    console.error(`ekran görüntüsü adımı başarısız: ${message}`);
  }
};

const stepRestored = async (ctx) => {
  const { page, report, state, artifact } = ctx;
  const restored = state.restoreReport?.restored ?? [];
  report(
    'geri yükleme: yedeklenen her dosya eski yerine kondu',
    /*
     * 7d'den sonra gömülü ffmpeg repoda DEĞİL: gizlenecek dosya kalmaması doğru
     * sonuçtur (daha güçlü temiz profil). Ölçüt bu yüzden "en az bir yedek" değil,
     * "yedeklenen ne varsa hepsi geri kondu".
     */
    restored.every((entry) => entry.restored),
    restored.length > 0
      ? `${restored.filter((entry) => entry.restored).length}/${restored.length}`
      : 'gizlenecek dosya yok (7d: gömülü ffmpeg artık repoda değil)',
  );

  const status = await getComponents(page);
  const health = await getHealth(page);
  const ffmpeg = findById(status, 'ffmpeg');
  const ffprobe = findById(status, 'ffprobe');
  artifact.availability.after = {
    status: pickFf(status),
    health: { ffmpeg: health?.ffmpeg ?? null, ffprobe: health?.ffprobe ?? null },
  };

  /*
   * "Yeniden available:true" beklemek 7d'den sonra YANLIŞ: gömülü ffmpeg yok, yani
   * geri yükleme sonrası doğru durum "başlangıçtaki durum". Değişmez: makine
   * bulunduğu gibi bırakılır — dünya hâli (ffmpeg kurulu) değil.
   */
  const before = artifact.availability?.before?.health ?? {};
  report(
    'geri sonrası: health_check ffmpeg başlangıçtaki durumda',
    health?.ffmpeg?.available === Boolean(before.ffmpeg?.available),
    `önce=${before.ffmpeg?.available} · sonra=${health?.ffmpeg?.available}`,
  );
  report(
    'geri sonrası: health_check ffprobe başlangıçtaki durumda',
    health?.ffprobe?.available === Boolean(before.ffprobe?.available),
    `önce=${before.ffprobe?.available} · sonra=${health?.ffprobe?.available}`,
  );
  report(
    'geri sonrası (7a parite): ffmpeg kayıt ↔ health AYNI',
    ffmpeg?.installed === health?.ffmpeg?.available,
    `kayıt=${ffmpeg?.installed} · health=${health?.ffmpeg?.available}`,
  );
  report(
    'geri sonrası (7a parite): ffprobe kayıt ↔ health AYNI',
    ffprobe?.installed === health?.ffprobe?.available,
    `kayıt=${ffprobe?.installed} · health=${health?.ffprobe?.available}`,
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
  const tmpDir = ensureOutDir(FAKE_DIR_NAME);

  const exeInfo = findAppExeDir();
  console.log(`exe klasörü: ${exeInfo.dir} (${exeInfo.how})`);

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
  };
  const cases = buildCases(tmpDir);
  const artifact = {
    kind: 'missing-component-probe',
    synthetic: false,
    note: 'Faz 7c-1: ffmpeg/ffprobe gizlenince her medya komutu BILESEN_EKSIK:ffmpeg + okunabilir ayrıntı döndürüyor; health_check dürüst; 7a paritesi eksikken de tutuyor.',
    capturedAt: new Date().toISOString(),
    appUrl: page.url(),
    exeDir: exeInfo.dir,
    exeDirHow: exeInfo.how,
    availability: { before: null, during: null, after: null },
    commands: [],
    ordering: [],
    validationBeforeGate: [],
    cleanProfile: null,
  };
  const ctx = {
    page,
    report,
    results,
    errors,
    state,
    artifact,
    cases,
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
    await stepHide(ctx);
    await stepOrdering(ctx);
    await stepSignals(ctx);
    await stepHonesty(ctx);
    await stepScreenshot(ctx);
  } catch (error) {
    const message = String(error?.stack ?? error?.message ?? error);
    errors.push({ step: 'fatal', message });
    report('sonda hatasız tamamlandı', false, String(error?.message ?? error));
    console.error(message);
  } finally {
    // Gölgeler HER durumda geri konur; geri konamayan varsa gürültülü bildirilir.
    try {
      cleanupProfile(ctx, [tmpDir]);
    } catch (error) {
      const message = String(error?.message ?? error);
      errors.push({ step: 'cleanup', message });
      console.error(`temizlik hatası: ${message}`);
    }
  }

  // Geri yükleme sonrası tabanın döndüğünü doğrula (finally'den SONRA).
  try {
    await stepRestored(ctx);
  } catch (error) {
    const message = String(error?.message ?? error);
    errors.push({ step: 'restore-check', message });
    report('geri sonrası taban doğrulandı', false, message);
    console.error(message);
  }

  artifact.results = results;
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
    writeFileSync(resolve(OUT_DIR, 'missing-component-probe.json'), JSON.stringify(artifact, null, 2), 'utf8');
    console.log('\nprovenance: missing-component-probe.json + missing-component-ayarlar.png');
  } catch (error) {
    const message = String(error?.message ?? error);
    errors.push({ step: 'artifact', message });
    console.error(`artifact yazılamadı: ${message}`);
  }

  const failed = results.filter((entry) => !entry.ok).length;
  console.log(
    failed === 0 && errors.length === 0
      ? '\nSONUÇ: tüm kontroller GEÇTİ'
      : `\nSONUÇ: ${failed} kontrol KALDI · ${errors.length} hata (artifact: dev/out/missing-component-probe.json)`,
  );
  return endProbe(failed === 0 && errors.length === 0 ? 0 : 1);
};

await main();
