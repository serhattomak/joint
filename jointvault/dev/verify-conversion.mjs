/*
 * Dönüşüm Merkezi uçtan uca sondası — üretim kodu DEĞİL.
 *
 * Ne kanıtlar: gerçek Tauri komutları (`convert_file`, `conversion_pdf_tool`)
 * LibreOffice + PDFium + ffmpeg + lopdf/printpdf ile dosya üretiyor mu; üretilen
 * DOCX/XLSX/PPTX tekrar PDF'e çevrilebiliyor mu; ses/video çıktıları ffprobe ile
 * okunabiliyor mu.
 *
 * Ön koşul: `npx tauri dev` + `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
 * ve Ayarlar → Bileşenler'de ffmpeg, LibreOffice, PDFium kurulu.
 *
 *   npm run verify:conversion
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitForCdp, findAppPage, endProbe, ensureOutDir } from './lib/browser.mjs';

const CDP = process.env.JV_CDP ?? 'http://127.0.0.1:9222';
const WORK = process.env.JV_CONV_DIR ?? join(tmpdir(), 'jv-conv-verify');
const results = [];

const report = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'GEÇTİ' : 'KALDI'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const magic = (path, expected) => {
  const bytes = readFileSync(path).subarray(0, expected.length);
  return bytes.equals(Buffer.from(expected));
};

const nonEmpty = (path, min = 32) => existsSync(path) && statSync(path).size >= min;

const ffprobeDuration = (ffprobe, path) => {
  try {
    const out = execFileSync(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path],
      { encoding: 'utf8' },
    ).trim();
    return Number.parseFloat(out);
  } catch {
    return 0;
  }
};

const runLo = (soffice, args, cwd) =>
  execFileSync(soffice, ['--headless', '--norestore', '--nofirststartwizard', ...args], {
    cwd,
    stdio: 'pipe',
    timeout: 120_000,
  });

const main = async () => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

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
  await page.waitForLoadState('load');
  await page.waitForTimeout(1200);

  const statuses = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('components_status'));
  const byId = Object.fromEntries(statuses.map((row) => [row.id, row]));
  for (const id of ['ffmpeg', 'ffprobe', 'libreoffice', 'pdfium']) {
    const row = byId[id];
    report(
      `bileşen: ${id}`,
      Boolean(row?.installed) && (row?.kind === 'asset' || row?.runnable),
      row ? `${row.source ?? 'yok'} · ${row.path ?? 'yol yok'}` : 'kayıt yok',
    );
  }
  if (results.some((item) => !item.ok)) return endProbe(1);

  const ffmpeg = byId.ffmpeg.path;
  const ffprobe = byId.ffprobe.path;
  const soffice = byId.libreoffice.path;

  // --- bağımsız fikstürler ------------------------------------------------
  const html = join(WORK, 'seed.html');
  writeFileSync(
    html,
    '<html><body><h1>JointVault Dönüşüm Testi</h1><p>Merhaba dünya. Bu bir metin aktarımıdır.</p>' +
      '<table><tr><td>Ad</td><td>Adet</td></tr><tr><td>Elma</td><td>3</td></tr></table></body></html>',
    'utf8',
  );
  const csv = join(WORK, 'seed.csv');
  writeFileSync(csv, 'ad,adet\nelma,3\narmut,5\n', 'utf8');

  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#9a3412:s=640x360', '-frames:v', '1', join(WORK, 'seed.png')]);
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', join(WORK, 'seed.wav')]);
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', join(WORK, 'seed.mp4')]);

  runLo(soffice, ['--convert-to', 'pdf', '--outdir', WORK, html], WORK);
  runLo(soffice, ['--convert-to', 'docx:MS Word 2007 XML', '--outdir', WORK, html], WORK);
  runLo(soffice, ['--convert-to', 'xlsx:Calc Office Open XML', '--outdir', WORK, csv], WORK);
  report('fikstür PDF', nonEmpty(join(WORK, 'seed.pdf')) && magic(join(WORK, 'seed.pdf'), '%PDF'));
  report('fikstür DOCX', nonEmpty(join(WORK, 'seed.docx')) && magic(join(WORK, 'seed.docx'), 'PK'));
  report('fikstür XLSX', nonEmpty(join(WORK, 'seed.xlsx')) && magic(join(WORK, 'seed.xlsx'), 'PK'));

  const convert = async (payload) => {
    try {
      return await page.evaluate(
        (p) => window.__TAURI_INTERNALS__.invoke('convert_file', { payload: p }),
        payload,
      );
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  };
  const pdfTool = async (payload) => {
    try {
      return await page.evaluate(
        (p) => window.__TAURI_INTERNALS__.invoke('conversion_pdf_tool', { payload: p }),
        payload,
      );
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  };
  const run = async (label, input, target, options, name, kind) => {
    const output = join(WORK, name);
    const result = await convert({
      job_id: `verify-${label.replace(/\W+/g, '-')}-${Date.now()}`,
      input_path: join(WORK, input),
      output_path: output,
      target,
      options: options ?? {},
    });
    const produced = result?.outputs?.[0];
    const ok = Boolean(produced) && nonEmpty(produced);
    report(label, ok, result?.error ?? `${produced ?? output} · ${ok ? statSync(produced).size : 0} bayt`);
    if (!ok) return null;
    if (kind === 'pdf') {
      const text = await convert({
        job_id: `verify-read-${Date.now()}`,
        input_path: produced,
        output_path: join(WORK, `${name}-read.txt`),
        target: 'txt',
        options: {},
      });
      report(`${label} → okunabilir PDF`, nonEmpty(join(WORK, `${name}-read.txt`), 1), text?.error ?? '');
    } else if (kind === 'pdf-image') {
      report(`${label} → PDF imzası`, magic(produced, '%PDF'));
    } else if (kind === 'zip') {
      const again = await convert({
        job_id: `verify-open-${Date.now()}`,
        input_path: produced,
        output_path: join(WORK, `${name}-roundtrip.pdf`),
        target: 'pdf',
        options: {},
      });
      report(
        `${label} → tekrar PDF`,
        nonEmpty(join(WORK, `${name}-roundtrip.pdf`)) && magic(join(WORK, `${name}-roundtrip.pdf`), '%PDF'),
        again?.error ?? '',
      );
    } else if (kind === 'audio' || kind === 'video') {
      const duration = ffprobeDuration(ffprobe, produced);
      report(`${label} → ffprobe`, duration > 0, `${duration.toFixed(2)} sn`);
    } else if (kind === 'image') {
      const magicOk =
        target === 'jpg'
          ? magic(produced, [0xff, 0xd8, 0xff])
          : target === 'gif'
            ? magic(produced, [0x47, 0x49, 0x46, 0x38])
            : target === 'webp'
              ? magic(produced, [0x52, 0x49, 0x46, 0x46]) &&
                readFileSync(produced).subarray(8, 12).toString('ascii') === 'WEBP'
              : magic(produced, [0x89, 0x50, 0x4e, 0x47]);
      report(`${label} → görüntü imzası`, magicOk);
    }
    return produced;
  };

  // --- ofis ---------------------------------------------------------------
  await run('DOCX → PDF', 'seed.docx', 'pdf', {}, 'docx.pdf', 'pdf');
  await run('DOCX → HTML', 'seed.docx', 'html', {}, 'docx.html');
  await run('DOCX → Markdown', 'seed.docx', 'md', {}, 'docx.md');
  await run('DOCX → ODT', 'seed.docx', 'odt', {}, 'docx.odt');
  await run('DOCX → RTF', 'seed.docx', 'rtf', {}, 'docx.rtf');
  await run('DOCX → TXT', 'seed.docx', 'txt', {}, 'docx.txt');
  await run('DOCX → PDF (sayfa 1, PDF/A)', 'seed.docx', 'pdf', { page_range: '1', pdfa: true }, 'docx-pdfa.pdf', 'pdf');
  await run('XLSX → PDF (tek sayfa)', 'seed.xlsx', 'pdf', { single_page_sheets: true }, 'xlsx.pdf', 'pdf');
  await run('XLSX → CSV', 'seed.xlsx', 'csv', { csv_delimiter: ',' }, 'xlsx.csv');
  await run('XLSX → ODS', 'seed.xlsx', 'ods', {}, 'xlsx.ods');
  await run('XLSX → HTML', 'seed.xlsx', 'html', {}, 'xlsx.html');
  await run('PDF → DOCX', 'seed.pdf', 'docx', { page_range: '1' }, 'pdf.docx', 'zip');
  await run('PDF → XLSX', 'seed.pdf', 'xlsx', { page_range: '1' }, 'pdf.xlsx', 'zip');
  const pptxOut = await run('PDF → PPTX', 'seed.pdf', 'pptx', { page_range: '1' }, 'pdf.pptx', 'zip');
  if (pptxOut) await run('PPTX → PDF', 'pdf.pptx', 'pdf', {}, 'pptx.pdf', 'pdf-image');
  await run('PDF → PNG', 'seed.pdf', 'png', { page_range: '1', dpi: 150 }, 'pdf.png', 'image');
  await run('PDF → JPG', 'seed.pdf', 'jpg', { page_range: '1', dpi: 100, image_quality: 80 }, 'pdf.jpg', 'image');
  await run('PNG → JPG', 'seed.png', 'jpg', { image_quality: 82 }, 'seed.jpg', 'image');
  await run('PNG → WebP (ölçek)', 'seed.png', 'webp', { max_width: 160, max_height: 120 }, 'seed.webp', 'image');
  await run('WAV → FLAC', 'seed.wav', 'flac', {}, 'seed.flac', 'audio');
  await run('MP4 → WebM', 'seed.mp4', 'webm', { quality: 'compact', resolution: '480' }, 'seed.webm', 'video');
  await run('MP4 → MP4 (kırp)', 'seed.mp4', 'mp4', { trim_start: '1', trim_end: '2', resolution: '480' }, 'seed-trim.mp4', 'video');
  await run('MP4 → GIF', 'seed.mp4', 'gif', { gif_fps: 10, gif_width: 320 }, 'seed.gif', 'image');

  // --- PDF araçları -------------------------------------------------------
  copyFileSync(join(WORK, 'seed.pdf'), join(WORK, 'seed2.pdf'));
  const tools = [
    ['PDF birleştir', 'merge', [join(WORK, 'seed.pdf'), join(WORK, 'seed2.pdf')], {}, 'merge.pdf'],
    ['PDF ayır', 'split', [join(WORK, 'seed.pdf')], { page_range: '1', split_each: false }, 'split.pdf'],
    ['PDF döndür', 'rotate', [join(WORK, 'seed.pdf')], { page_range: '1', angle: 90 }, 'rotate.pdf'],
    ['PDF sıkıştır', 'compress', [join(WORK, 'seed.pdf')], {}, 'compress.pdf'],
    ['Görsellerden PDF', 'images_to_pdf', [join(WORK, 'seed.png'), join(WORK, 'seed.jpg')], { page_size: 'a4' }, 'images.pdf'],
  ];
  for (const [label, tool, inputs, options, name] of tools) {
    const output = join(WORK, name);
    const result = await pdfTool({ job_id: `verify-pdf-tool-${Date.now()}`, tool, inputs, output_path: output, options });
    const ok = Boolean(result?.outputs?.length) && nonEmpty(output) && magic(output, '%PDF');
    report(label, ok, result?.error ?? `${output} · ${ok ? statSync(output).size : 0} bayt`);
  }

  // --- arayüz dumanı (boş durum + sekmeler) ------------------------------
  try {
    await page.getByRole('button', { name: 'Dönüştürücü' }).first().click({ timeout: 5000 });
    await page.waitForTimeout(500);
    report(
      'arayüz: Dönüştürücü açıldı',
      await page.getByRole('heading', { name: 'Dönüştürücü' }).first().isVisible(),
    );
    await page.getByRole('tab', { name: 'PDF araçları' }).first().click({ timeout: 3000 });
    await page.waitForTimeout(300);
    report('arayüz: PDF araçları sekmesi', await page.getByText('PDF araçları').first().isVisible());
    await page.getByRole('tab', { name: 'Geçmiş' }).first().click({ timeout: 3000 });
    await page.waitForTimeout(500);
    report('arayüz: Geçmiş sekmesi', await page.getByText('Dönüşüm geçmişi').first().isVisible());
    ensureOutDir('shots');
    await page.screenshot({ path: join(ensureOutDir('shots'), 'conversion-center.png'), fullPage: true });
  } catch (error) {
    report('arayüz dumanı', false, String(error));
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} geçti; çıktılar: ${WORK}`);
  endProbe(failed.length === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  endProbe(2);
});
