import { describe, expect, it } from 'vitest';
import { buildItemChunks, buildMetaChunks } from './chunker';

describe('buildMetaChunks', () => {
  it('kategorileri meta metnine yazar', () => {
    const chunks = buildMetaChunks('i1', { title: 'Tarif', categories: ['Yemek', 'Sağlık'] });
    expect(chunks[0]?.chunkType).toBe('meta');
    expect(chunks[0]?.chunkText).toContain('Kategoriler: Yemek, Sağlık');
  });

  it('kategori yoksa satır yazmaz', () => {
    const chunks = buildMetaChunks('i1', { title: 'Tarif' });
    expect(chunks[0]?.chunkText).not.toContain('Kategoriler');
  });
});

describe('buildItemChunks', () => {
  it('meta+not+transcript+makale türlerini birlikte üretir', () => {
    const srt = '1\n00:00:00,000 --> 00:00:02,000\nmerhaba dünya\n';
    const chunks = buildItemChunks('i1', {
      title: 'T',
      note: 'notum',
      tags: ['x'],
      categories: ['Yemek'],
      srt,
      article: 'uzun makale metni',
    });
    const types = chunks.map((c) => c.chunkType);
    expect(types).toContain('meta');
    expect(types).toContain('note');
    expect(types).toContain('transcript');
    expect(types).toContain('article');
  });

  it('boş girdide boş dizi döner', () => {
    expect(buildItemChunks('i1', {})).toEqual([]);
  });
});
