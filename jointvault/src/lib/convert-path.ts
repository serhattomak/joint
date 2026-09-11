import type { ConvertOp } from '@/lib/convert';

export const OP_LABEL: Record<ConvertOp, string> = { mp4: 'MP4', mp3: 'MP3', m4a: 'M4A', trim: 'Kırp' };

const OP_EXT: Record<Exclude<ConvertOp, 'trim'>, string> = { mp4: 'mp4', mp3: 'mp3', m4a: 'm4a' };

// ponytail: no node:path in browser bundle — plain string split handles / and \.
export function splitPath(p: string): { dir: string; sep: string; base: string } {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (i < 0) return { dir: '', sep: '/', base: p };
  return { dir: p.slice(0, i), sep: p[i], base: p.slice(i + 1) };
}

export function stemOf(base: string): { stem: string; ext: string } {
  const i = base.lastIndexOf('.');
  if (i <= 0) return { stem: base, ext: '' };
  return { stem: base.slice(0, i), ext: base.slice(i + 1) };
}

export function outputPathFor(inputPath: string, op: ConvertOp): string {
  const { dir, sep, base } = splitPath(inputPath);
  const { stem, ext } = stemOf(base);
  const outExt = op === 'trim' ? ext || 'mp4' : OP_EXT[op];
  const name = `${stem}-${op}.${outExt}`;
  return dir ? `${dir}${sep}${name}` : name;
}

export function basenameOf(p: string): string {
  return splitPath(p).base;
}

// Merge is standalone: deliberately NOT a ConvertOp member (A8 — ConverterStudio
// maps OP_LABEL keys into op buttons, an extra member would inject a Merge button there).
export function mergeOutputPath(firstInputPath: string): string {
  const { dir, sep, base } = splitPath(firstInputPath);
  const { stem } = stemOf(base);
  const name = `${stem}-merge.mp4`;
  return dir ? `${dir}${sep}${name}` : name;
}

// Silence is standalone: same A8 rationale as merge — ConvertOp untouched.
export function silenceOutputPath(inputPath: string, preset: string, preview: boolean): string {
  const { dir, sep, base } = splitPath(inputPath);
  const { stem } = stemOf(base);
  const name = preview ? `${stem}-sessizlik-onizleme.mp4` : `${stem}-sessizlik-${preset}.mp4`;
  return dir ? `${dir}${sep}${name}` : name;
}

// GIF/WebM is standalone: same A8 rationale — ConvertOp untouched.
export function gifOutputPath(inputPath: string, format: 'gif' | 'webm'): string {
  const { dir, sep, base } = splitPath(inputPath);
  const { stem } = stemOf(base);
  const name = `${stem}-anim.${format}`;
  return dir ? `${dir}${sep}${name}` : name;
}

// Subtitle is standalone: same A8 rationale — ConvertOp untouched.
// Transkript: <stem>-transkript.srt (önizleme amaçlı, arşive yazılmaz — A7).
export function transcriptSrtPath(inputPath: string): string {
  const { dir, sep, base } = splitPath(inputPath);
  const { stem } = stemOf(base);
  const name = `${stem}-transkript.srt`;
  return dir ? `${dir}${sep}${name}` : name;
}

// Gömülü çıktı: <stem>-altyazili.mp4 (vault'a bağlanır — A14).
export function embedOutputPath(videoPath: string): string {
  const { dir, sep, base } = splitPath(videoPath);
  const { stem } = stemOf(base);
  const name = `${stem}-altyazili.mp4`;
  return dir ? `${dir}${sep}${name}` : name;
}
