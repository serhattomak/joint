import { describe, expect, it } from 'vitest';
import { duplicateGroups, parseMergeSuggestions } from './taxonomy-maintenance';

describe('duplicateGroups', () => {
  it('normalizeKey eşleşenleri gruplar; kanonik en çok kullanılan', () => {
    const g = duplicateGroups([
      { name: 'Yapay Zeka', count: 5 },
      { name: 'yapay-zeka', count: 1 },
      { name: 'YAPAY ZEKA' },
      { name: 'Müzik', count: 3 },
    ]);
    expect(g).toEqual([{ canonical: 'Yapay Zeka', duplicates: ['yapay-zeka', 'YAPAY ZEKA'] }]);
  });

  it('yinelenen yoksa boş döner', () => {
    expect(duplicateGroups([{ name: 'A' }, { name: 'B' }])).toEqual([]);
  });
});

describe('parseMergeSuggestions', () => {
  const known = ['ai', 'yapay zeka', 'fotoğraf'];

  it('geçerli grupları döndürür, tek-elemanlıyı atar', () => {
    const out = parseMergeSuggestions('[[ "ai", "yapay zeka" ], ["fotoğraf"]]', known);
    expect(out).toEqual([['ai', 'yapay zeka']]);
  });

  it('bilinmeyen adları atar', () => {
    expect(parseMergeSuggestions('[["ai","bilinmeyen"]]', known)).toEqual([]);
  });

  it('bozuk metinde boş döner', () => {
    expect(parseMergeSuggestions('üzgünüm JSON yok', known)).toEqual([]);
    expect(parseMergeSuggestions('{bozuk', known)).toEqual([]);
  });
});
