/*
 * Dönüşüm Merkezi sözlüğü: kaynak türleri, hedef matrisi, seçenekler ve ad üretimi.
 *
 * Rust tarafındaki `conversion/paths.rs` matrisi ile AYNI olmak zorunda. Burada
 * hedef listesi yalnızca arayüz içindir; güvenlik/doğrulama backend'de tekrar
 * yapılır (istemciye güvenilmez).
 */
import { basenameOf, splitPath, stemOf } from './convert-path';

export type SourceFamily =
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'pdf'
  | 'image'
  | 'audio'
  | 'video'
  | 'unknown';

export const FAMILY_LABEL: Record<Exclude<SourceFamily, 'unknown'>, string> = {
  document: 'Belge',
  spreadsheet: 'Tablo',
  presentation: 'Sunum',
  pdf: 'PDF',
  image: 'Görsel',
  audio: 'Ses',
  video: 'Video',
};

const EXT_FAMILY: Record<string, SourceFamily> = {
  docx: 'document',
  doc: 'document',
  odt: 'document',
  rtf: 'document',
  txt: 'document',
  html: 'document',
  htm: 'document',
  md: 'document',
  markdown: 'document',
  xlsx: 'spreadsheet',
  xls: 'spreadsheet',
  ods: 'spreadsheet',
  csv: 'spreadsheet',
  pptx: 'presentation',
  ppt: 'presentation',
  odp: 'presentation',
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  bmp: 'image',
  tif: 'image',
  tiff: 'image',
  gif: 'image',
  mp3: 'audio',
  m4a: 'audio',
  aac: 'audio',
  wav: 'audio',
  flac: 'audio',
  ogg: 'audio',
  oga: 'audio',
  opus: 'audio',
  wma: 'audio',
  aiff: 'audio',
  aif: 'audio',
  amr: 'audio',
  mp4: 'video',
  m4v: 'video',
  mkv: 'video',
  webm: 'video',
  mov: 'video',
  avi: 'video',
  wmv: 'video',
  flv: 'video',
  ts: 'video',
  mts: 'video',
  mpg: 'video',
  mpeg: 'video',
  '3gp': 'video',
};

export const extOfPath = (path: string): string => {
  const base = basenameOf(path);
  const index = base.lastIndexOf('.');
  return index > 0 ? base.slice(index + 1).toLowerCase() : '';
};

export function familyOfExt(ext: string): SourceFamily {
  return EXT_FAMILY[ext.trim().toLowerCase()] ?? 'unknown';
}

export function familyOfPath(path: string): SourceFamily {
  return familyOfExt(extOfPath(path));
}

export interface ConversionTarget {
  /** Hedef uzantı (kanonik): `jpg`, `tiff`, `docx`… */
  id: string;
  label: string;
  hint?: string;
}

const TARGET = (id: string, label: string, hint?: string): ConversionTarget => ({ id, label, hint });

/** Arayüzde gösterilen hedefler; `family` grubu başlığıdır. */
export const TARGETS: Record<Exclude<SourceFamily, 'unknown'>, ConversionTarget[]> = {
  document: [
    TARGET('pdf', 'PDF', 'Düzeni sabitler'),
    TARGET('docx', 'Word', 'DOCX'),
    TARGET('odt', 'ODT', 'OpenDocument'),
    TARGET('rtf', 'RTF'),
    TARGET('txt', 'Düz metin'),
    TARGET('html', 'HTML'),
    TARGET('md', 'Markdown'),
  ],
  spreadsheet: [
    TARGET('pdf', 'PDF', 'Sayfaları sabitler'),
    TARGET('xlsx', 'Excel', 'XLSX'),
    TARGET('ods', 'ODS', 'OpenDocument'),
    TARGET('csv', 'CSV'),
    TARGET('html', 'HTML'),
  ],
  presentation: [
    TARGET('pdf', 'PDF', 'Slaytları sabitler'),
    TARGET('pptx', 'PowerPoint', 'PPTX'),
    TARGET('odp', 'ODP', 'OpenDocument'),
  ],
  pdf: [
    TARGET('docx', 'Word', 'Metin tabanlı; düzen birebir değil'),
    TARGET('xlsx', 'Excel', 'Metin satırları; tablo yapısı yaklaşık'),
    TARGET('pptx', 'PowerPoint', 'Her sayfa görsel slayt'),
    TARGET('txt', 'Düz metin'),
    TARGET('md', 'Markdown'),
    TARGET('html', 'HTML'),
    TARGET('png', 'PNG', 'Sayfa başına görüntü'),
    TARGET('jpg', 'JPG', 'Sayfa başına görüntü'),
  ],
  image: [
    TARGET('png', 'PNG'),
    TARGET('jpg', 'JPG'),
    TARGET('webp', 'WebP'),
    TARGET('bmp', 'BMP'),
    TARGET('tiff', 'TIFF'),
    TARGET('gif', 'GIF'),
    TARGET('pdf', 'PDF', 'Görseli sayfaya yerleştirir'),
  ],
  audio: [
    TARGET('mp3', 'MP3'),
    TARGET('m4a', 'M4A', 'AAC'),
    TARGET('aac', 'AAC'),
    TARGET('wav', 'WAV'),
    TARGET('flac', 'FLAC'),
    TARGET('ogg', 'OGG', 'Vorbis'),
    TARGET('opus', 'Opus'),
  ],
  video: [
    TARGET('mp4', 'MP4', 'H.264 · en uyumlu'),
    TARGET('mkv', 'MKV'),
    TARGET('webm', 'WebM', 'VP9'),
    TARGET('mov', 'MOV'),
    TARGET('avi', 'AVI'),
    TARGET('gif', 'GIF', 'Kısa döngü'),
    TARGET('mp3', 'MP3', 'Sesi ayır'),
    TARGET('m4a', 'M4A', 'Sesi ayır'),
    TARGET('wav', 'WAV', 'Sesi ayır'),
  ],
};

export const DEFAULT_TARGET: Record<Exclude<SourceFamily, 'unknown'>, string> = {
  document: 'pdf',
  spreadsheet: 'pdf',
  presentation: 'pdf',
  pdf: 'docx',
  image: 'png',
  audio: 'mp3',
  video: 'mp4',
};

const AUDIO_TARGET_IDS = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus']);
const VIDEO_TARGET_IDS = new Set(['mp4', 'mkv', 'webm', 'mov', 'avi', 'gif']);

export function targetsFor(family: SourceFamily): ConversionTarget[] {
  if (family === 'unknown') return [];
  return TARGETS[family];
}

/** Karışık seçimde yalnızca TÜM kaynakların desteklediği hedefler ortak sayılır. */
export function commonTargets(families: SourceFamily[]): ConversionTarget[] {
  const known = families.filter((family): family is Exclude<SourceFamily, 'unknown'> => family !== 'unknown');
  if (known.length === 0) return [];
  const [first, ...rest] = known;
  const allowed = new Set(rest.map((family) => new Set(TARGETS[family].map((target) => target.id))));
  return TARGETS[first].filter((target) => [...allowed].every((set) => set.has(target.id)));
}

export function isAudioTarget(target: string): boolean {
  return AUDIO_TARGET_IDS.has(target);
}

export function isVideoTarget(target: string): boolean {
  return VIDEO_TARGET_IDS.has(target);
}

/** Hangi motor gerekli? Bileşen kapısı bunu kullanır (null = saf Rust). */
export function requiredComponent(
  family: SourceFamily,
  target: string,
): 'libreoffice' | 'pdfium' | 'ffmpeg' | null {
  if (family === 'document' || family === 'spreadsheet' || family === 'presentation') {
    return 'libreoffice';
  }
  if (family === 'pdf') {
    // PDF → PDF sıkıştırma lopdf ile yapılır; diğer her PDF işi PDFium ister.
    return target === 'pdf' ? null : 'pdfium';
  }
  if (family === 'audio' || family === 'video') return 'ffmpeg';
  return null;
}

export interface ConversionOptions {
  quality: 'compact' | 'balanced' | 'high';
  resolution: 'original' | '2160' | '1440' | '1080' | '720' | '480' | '360';
  fps: 'original' | '60' | '50' | '30' | '25' | '24' | '15';
  audio_bitrate: string;
  sample_rate: 'original' | '48000' | '44100' | '22050';
  channels: 'original' | 'mono' | 'stereo';
  mute: boolean;
  trim_start: string;
  trim_end: string;
  gif_fps: number;
  gif_width: number;
  page_range: string;
  dpi: number;
  image_quality: number;
  max_width: number;
  max_height: number;
  background: string;
  pdfa: boolean;
  pdfa_version: number;
  pdf_quality: 'screen' | 'ebook' | 'print';
  single_page_sheets: boolean;
  csv_delimiter: ',' | ';' | '\t';
  split_each: boolean;
  angle: 90 | 180 | 270;
  page_size: 'a4' | 'letter' | 'auto';
}

export const defaultOptions = (): ConversionOptions => ({
  quality: 'balanced',
  resolution: 'original',
  fps: 'original',
  audio_bitrate: '192',
  sample_rate: 'original',
  channels: 'original',
  mute: false,
  trim_start: '',
  trim_end: '',
  gif_fps: 12,
  gif_width: 480,
  page_range: '',
  dpi: 150,
  image_quality: 90,
  max_width: 0,
  max_height: 0,
  background: '#ffffff',
  pdfa: false,
  pdfa_version: 2,
  pdf_quality: 'print',
  single_page_sheets: false,
  csv_delimiter: ',',
  split_each: false,
  angle: 90,
  page_size: 'a4',
});

/** Seçeneklerin yalnızca hedefle ilgili olanları backend'e gönderilir. */
export function optionsForTarget(
  family: SourceFamily,
  target: string,
  options: ConversionOptions,
): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (family === 'audio' || family === 'video') {
    Object.assign(base, {
      quality: options.quality,
      resolution: options.resolution,
      fps: options.fps,
      audio_bitrate: options.audio_bitrate,
      sample_rate: options.sample_rate,
      channels: options.channels,
      mute: options.mute,
      trim_start: options.trim_start,
      trim_end: options.trim_end,
      gif_fps: options.gif_fps,
      gif_width: options.gif_width,
    });
  }
  if (family === 'image') {
    Object.assign(base, {
      max_width: options.max_width,
      max_height: options.max_height,
      image_quality: options.image_quality,
      background: options.background,
      page_size: options.page_size,
    });
  }
  if (family === 'pdf' && target !== 'pdf') {
    Object.assign(base, {
      page_range: options.page_range,
      dpi: options.dpi,
      image_quality: options.image_quality,
    });
  }
  if (family === 'document' || family === 'spreadsheet' || family === 'presentation') {
    Object.assign(base, {
      page_range: options.page_range,
      pdfa: options.pdfa,
      pdfa_version: options.pdfa_version,
      pdf_quality: options.pdf_quality,
      single_page_sheets: options.single_page_sheets,
      csv_delimiter: options.csv_delimiter,
    });
  }
  return base;
}

// --- çıktı adları -----------------------------------------------------------

const OUT_SUFFIX: Record<string, string> = {
  pdf: 'pdf',
  docx: 'docx',
  odt: 'odt',
  rtf: 'rtf',
  txt: 'txt',
  html: 'html',
  md: 'md',
  xlsx: 'xlsx',
  ods: 'ods',
  csv: 'csv',
  pptx: 'pptx',
  odp: 'odp',
  png: 'png',
  jpg: 'jpg',
  webp: 'webp',
  bmp: 'bmp',
  tiff: 'tiff',
  gif: 'gif',
  mp3: 'mp3',
  m4a: 'm4a',
  aac: 'aac',
  wav: 'wav',
  flac: 'flac',
  ogg: 'ogg',
  opus: 'opus',
  mkv: 'mkv',
  webm: 'webm',
  mov: 'mov',
  avi: 'avi',
};

export function conversionOutputPath(
  inputPath: string,
  target: string,
  outputDir?: string | null,
): string {
  const { dir, sep, base } = splitPath(inputPath);
  const { stem } = stemOf(base);
  const suffix = OUT_SUFFIX[target] ?? target;
  const name = `${stem}-${suffix}.${suffix}`;
  const targetDir = outputDir?.trim().replace(/[\\/]+$/, '') || dir;
  return targetDir ? `${targetDir}${sep || '\\'}${name}` : name;
}

export function pdfToolOutputPath(
  inputPath: string,
  tool: 'merge' | 'split' | 'rotate' | 'compress' | 'images_to_pdf',
  outputDir?: string | null,
): string {
  const { dir, sep, base } = splitPath(inputPath);
  const { stem } = stemOf(base);
  const suffix: Record<typeof tool, string> = {
    merge: 'birlestirilmis',
    split: 'bolunmus',
    rotate: 'dondurulmus',
    compress: 'sikistirilmis',
    images_to_pdf: 'gorseller',
  };
  const name = `${stem}-${suffix[tool]}.pdf`;
  const targetDir = outputDir?.trim().replace(/[\\/]+$/, '') || dir;
  return targetDir ? `${targetDir}${sep || '\\'}${name}` : name;
}
