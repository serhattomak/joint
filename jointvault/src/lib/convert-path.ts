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
