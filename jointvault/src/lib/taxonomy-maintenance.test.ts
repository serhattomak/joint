import { describe, expect, it } from 'vitest';
import {
  duplicateGroups,
  parseMergeSuggestions,
  parseRestructPlan,
  validateRestructPlan,
} from './taxonomy-maintenance';

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

/*
 * Yeniden yapılandırma: kullanıcının "pizza tarifi" + "pizza yapımı" sorunu.
 * Model planı ÖNERİR; bu iki saf fonksiyon onu girdiye karşı doğrular ve
 * bozuk yanıtta çökmez.
 */
describe('parseRestructPlan', () => {
  const known = ['pizza tarifi', 'pizza yapımı', 'Python', 'Çorba'];

  it('iki seviyeli taşıma planını okur', () => {
    const json = JSON.stringify({
      moves: [{ from: 'pizza tarifi', toParent: 'Yemek', toChild: 'Pizza' }],
      merges: [{ canonical: 'Pizza', duplicates: ['pizza yapımı'] }],
    });
    const plan = parseRestructPlan(json, known);
    expect(plan.moves[0]).toEqual({ from: 'pizza tarifi', toChild: 'Pizza', toParent: 'Yemek' });
    expect(plan.merges[0]).toEqual({ canonical: 'Pizza', duplicates: ['pizza yapımı'] });
  });

  it('kaynakta aksan/harf farkını tolere eder (kanonik yazımla döner)', () => {
    const json = JSON.stringify({
      moves: [{ from: 'Pizza Tarifi', toParent: 'Yemek', toChild: 'Pizza' }],
    });
    // Aksan katlaması doğru: listede "pizza tarifi" var.
    expect(parseRestructPlan(json, known).moves[0].from).toBe('pizza tarifi');
  });

  it('girdide HİÇ olmayan kaynak adı geçirmez', () => {
    const json = JSON.stringify({
      moves: [{ from: 'Makarna Tarifi', toParent: 'Yemek', toChild: 'Makarna' }],
    });
    // "Makarna Tarifi" listede yok. Uygulama bunu yeni kategori olarak açıp
    // taşımayı sessizce kaybettirmemeli.
    expect(parseRestructPlan(json, known).moves).toEqual([]);
  });

  it('girdi adını kanonik YAZIMLA döndürür', () => {
    const json = JSON.stringify({ moves: [{ from: '  PIZZA TARİFİ ', toParent: '', toChild: '' }] });
    expect(parseRestructPlan(json, known).moves[0].from).toBe('pizza tarifi');
  });

  it('markdown sarmalı JSON u ayıklar', () => {
    const wrapped = 'plan:\n```json\n{"moves":[{"from":"Python","toParent":"","toChild":""}]}\n```';
    expect(parseRestructPlan(wrapped, known).moves[0].from).toBe('Python');
  });

  it('bozuk JSON ve boş yanıtta boş plan döner (çökmez)', () => {
    expect(parseRestructPlan('{bozuk', known)).toEqual({ moves: [], merges: [] });
    expect(parseRestructPlan('', known)).toEqual({ moves: [], merges: [] });
    expect(parseRestructPlan('markdown yok', known)).toEqual({ moves: [], merges: [] });
  });

  it('kanonikle aynı olan duplicate ı merge listesinde tutmaz', () => {
    const json = JSON.stringify({ merges: [{ canonical: 'Çorba', duplicates: ['Çorba'] }] });
    expect(parseRestructPlan(json, known).merges).toEqual([]);
  });
});

describe('validateRestructPlan — onay öncesi kapı', () => {
  const known = ['pizza tarifi', 'pizza yapımı', 'Python'];

  it('temiz planı kabul eder', () => {
    const plan = {
      moves: [
        { from: 'pizza tarifi', toParent: 'Yemek', toChild: 'Pizza' },
        { from: 'Python', toParent: '', toChild: '' },
      ],
      merges: [],
    };
    expect(validateRestructPlan(known, plan).ok).toBe(true);
  });

  it('girdide olmayan adı yakalar', () => {
    const plan = {
      moves: [{ from: 'uydurma', toParent: 'X', toChild: 'Y' }],
      merges: [],
    };
    const check = validateRestructPlan(known, plan);
    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(['uydurma']);
  });

  it('aynı kaynağın iki kez atanmasını yakalar', () => {
    const plan = {
      moves: [
        { from: 'pizza tarifi', toParent: 'Yemek', toChild: 'Pizza' },
        { from: 'pizza tarifi', toParent: 'Yemek', toChild: 'Pizza Dilimi' },
      ],
      merges: [],
    };
    const check = validateRestructPlan(known, plan);
    expect(check.ok).toBe(false);
    expect(check.duplicated).toEqual(['pizza tarifi']);
  });
});