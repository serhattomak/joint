/*
 * İndirme klasörü sondası — üretim kodu DEĞİL.
 *
 * NE KANITLAR: Ayarlar'daki "İndirme klasörü"nün yt-dlp indirmesini GERÇEKTEN
 * etkilediğini. Kod okuması yetmez; tıpkı izinlerde olduğu gibi son kararı
 * çalışan uygulama verir.
 *
 * Nasıl: ffmpeg ile 1 saniyelik küçük bir mp4 üretir, onu 127.0.0.1 üzerinde
 * servis eder, indirme klasörünü geçici bir dizine çevirir, indirmeyi başlatır
 * ve dönen dosya yolunun GERÇEKTEN o dizinde olduğunu doğrular. Sonunda eski
 * ayarı geri yükler ve geçici dizini siler.
 *
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
 *   npx tauri dev        # pencere açıldıktan sonra:
 *   npm run verify:download-dir
 */
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  OUT_DIR,
  PROJECT_ROOT,
  endProbe,
  ensureOutDir,
  findAppPage,
  waitForCdp,
} from './lib/browser.mjs';

const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';
const FFMPEG = resolve(PROJECT_ROOT, 'src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe');
const WORK = join(tmpdir(), `jv-dl-probe-${Date.now()}`);
const MP4 = join(WORK, 'probe.mp4');
const TARGET = join(WORK, 'hedef-klasor');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Gerçek ama küçük bir medya dosyası üret (yt-dlp bir medya dosyası indirsin). */
const makeMedia = () => {
  mkdirSync(WORK, { recursive: true });
  mkdirSync(TARGET, { recursive: true });
  const made = spawnSync(
    FFMPEG,
    ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=5', '-pix_fmt', 'yuv420p', MP4],
    { stdio: 'ignore' },
  );
  return made.status === 0 && existsSync(MP4);
};

const serveMedia = async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': statSync(MP4).size });
    createReadStream(MP4).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/probe.mp4` };
};

const main = async () => {
  if (!makeMedia()) {
    console.error('Test medyası üretilemedi (ffmpeg). Sonda durduruldu.');
    return endProbe(2);
  }
  console.log(`test medyası: ${statSync(MP4).size} bayt`);

  const { server, url } = await serveMedia();
  console.log(`yerel kaynak: ${url}`);

  const browser = await waitForCdp(CDP);
  if (!browser) {
    console.error(`Uygulamaya bağlanılamadı (${CDP}).`);
    console.error('Sırayla: pencereyi kapat → $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" → npx tauri dev');
    server.close();
    return endProbe(2);
  }

  const page = findAppPage(browser);
  if (!page) {
    console.error('Uygulama penceresi bulunamadı.');
    server.close();
    return endProbe(2);
  }
  console.log(`bağlandı: ${page.url()}`);
  await page.waitForLoadState('load');
  await sleep(800);

  const probe = await page.evaluate(
    async ({ targetDir, probeUrl }) => {
      const invoke = window.__TAURI_INTERNALS__?.invoke;
      if (!invoke) return { bridge: false };

      const original = await invoke('get_download_dir');
      await invoke('set_download_dir', { path: targetDir });

      let downloadedPath = null;
      let error = null;
      try {
        downloadedPath = await invoke('download_media', {
          payload: { item_id: `probe-${Date.now()}`, url: probeUrl, kind: 'video' },
        });
      } catch (e) {
        error = typeof e === 'string' ? e : (e?.message ?? String(e));
      }

      /* Her durumda eski klasöre dön: sonda kullanıcının ayarını değişmiş bırakmaz. */
      await invoke('set_download_dir', { path: original });

      return { bridge: true, original, targetDir, downloadedPath, error };
    },
    { targetDir: TARGET, probeUrl: url },
  );

  server.close();

  if (!probe.bridge) {
    console.error('Tauri köprüsü bulunamadı.');
    return endProbe(2);
  }

  const results = [];
  const report = (label, ok, detail) => {
    results.push({ label, ok, detail: detail ?? null });
    console.log(`${ok ? 'GEÇTİ' : 'KALDI'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };

  const returned = String(probe.downloadedPath ?? '').replace(/\\/g, '/');
  const target = TARGET.replace(/\\/g, '/');

  report('indirme hata vermeden tamamlandı', Boolean(probe.downloadedPath), probe.error ? `hata: ${probe.error.slice(0, 200)}` : null);
  report('dönen yol yapılandırılan klasörün altında', returned.startsWith(target), returned || '(yol yok)');
  report('dosya diskte gerçekten var', Boolean(returned) && existsSync(returned), returned || '(yol yok)');
  report('eski ayar geri yüklendi', Boolean(probe.original), String(probe.original ?? '').slice(0, 120));

  try {
    rmSync(WORK, { recursive: true, force: true });
  } catch {
    console.warn('geçici dizin silinemedi (kararı etkilemez)');
  }

  ensureOutDir();
  writeFileSync(
    resolve(OUT_DIR, 'download-dir-probe.json'),
    JSON.stringify(
      {
        kind: 'runtime-probe',
        synthetic: false,
        note: 'Gerçek indirme sınaması: ffmpeg ile üretilen 1 sn mp4, yerel HTTP kaynağından, geçici hedef klasöre. Sonunda eski ayar geri yüklendi ve geçici dizin silindi.',
        capturedAt: new Date().toISOString(),
        appUrl: page.url(),
        probe: { ...probe, error: probe.error ? probe.error.slice(0, 500) : null },
        results,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log('\nprovenance: download-dir-probe.json');

  const failed = results.filter((r) => !r.ok).length;
  return endProbe(failed === 0 ? 0 : 1);
};

await main();
