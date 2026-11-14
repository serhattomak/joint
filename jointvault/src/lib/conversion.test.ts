import { describe, expect, it } from 'vitest';
import {
  commonTargets,
  conversionOutputPath,
  familyOfPath,
  optionsForTarget,
  defaultOptions,
  pdfToolOutputPath,
  requiredComponent,
  targetsFor,
} from './conversion';

describe('conversion kataloğu', () => {
  it('uzantıdan aileyi tanır', () => {
    expect(familyOfPath('C:\\a\\rapor.docx')).toBe('document');
    expect(familyOfPath('a.xlsx')).toBe('spreadsheet');
    expect(familyOfPath('a.pptx')).toBe('presentation');
    expect(familyOfPath('a.pdf')).toBe('pdf');
    expect(familyOfPath('a.JPG')).toBe('image');
    expect(familyOfPath('a.flac')).toBe('audio');
    expect(familyOfPath('a.webm')).toBe('video');
    expect(familyOfPath('a.exe')).toBe('unknown');
  });

  it('hedef matrisi beklenen biçimleri taşır', () => {
    expect(targetsFor('pdf').map((target) => target.id)).toEqual([
      'docx',
      'xlsx',
      'pptx',
      'txt',
      'md',
      'html',
      'png',
      'jpg',
    ]);
    expect(targetsFor('video').map((target) => target.id)).toContain('gif');
    expect(targetsFor('audio').map((target) => target.id)).not.toContain('mp4');
  });

  it('karışık seçimde yalnız ortak hedefleri verir', () => {
    const common = commonTargets(['document', 'image']).map((target) => target.id);
    expect(common).toEqual(['pdf']);
    expect(commonTargets(['audio', 'video']).map((target) => target.id)).toEqual([
      'mp3',
      'm4a',
      'wav',
    ]);
  });

  it('motor kapısını aile/hedefe göre söyler', () => {
    expect(requiredComponent('document', 'pdf')).toBe('libreoffice');
    expect(requiredComponent('pdf', 'docx')).toBe('pdfium');
    expect(requiredComponent('pdf', 'pdf')).toBeNull();
    expect(requiredComponent('video', 'mp4')).toBe('ffmpeg');
    expect(requiredComponent('image', 'png')).toBeNull();
  });

  it('seçenekleri hedefe göre süzer', () => {
    const options = defaultOptions();
    const media = optionsForTarget('video', 'mp4', options);
    expect(media).toMatchObject({ quality: 'balanced', resolution: 'original' });
    const office = optionsForTarget('document', 'pdf', options);
    expect(office).toMatchObject({ pdf_quality: 'print', pdfa: false });
    expect(office).not.toHaveProperty('gif_fps');
  });

  it('çıktı adını kaynak yanına ve seçilen klasöre üretir', () => {
    expect(conversionOutputPath('C:\\v\\rapor.docx', 'pdf')).toBe(
      'C:\\v\\rapor-pdf.pdf',
    );
    expect(conversionOutputPath('C:\\v\\rapor.docx', 'pdf', 'D:\\çıktı\\')).toBe(
      'D:\\çıktı\\rapor-pdf.pdf',
    );
    expect(pdfToolOutputPath('C:\\v\\a.pdf', 'merge')).toBe(
      'C:\\v\\a-birlestirilmis.pdf',
    );
  });
});
