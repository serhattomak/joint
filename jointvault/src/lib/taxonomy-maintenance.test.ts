import { describe, expect, it } from 'vitest';
import type { Category } from './db/types';
import {
  categoryPathOf,
  duplicateGroups,
  mergeContextLines,
  parseMergeSuggestions,
  parseRestructPlan,
  preferCanonical,
  turkishScore,
  validateMergeGroups,
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

describe('preferCanonical', () => {
  it('Türkçe imlâ kullanım sayısından ÜSTÜNDÜR', () => {
    // Kullanıcının asıl örneği: 200 kayıtta "Yazilim", 2 kayıtta "Yazılım".
    expect(
      preferCanonical([
        { name: 'Yazilim', count: 200 },
        { name: 'Yazılım', count: 2 },
      ]),
    ).toBe('Yazılım');
  });

  it('imlâ eşitse düzgün harf durumu kazanır', () => {
    expect(preferCanonical([{ name: 'yazilim', count: 9 }, { name: 'Yazilim', count: 1 }])).toBe(
      'Yazilim',
    );
  });

  it('imlâ ve harf durumu eşitse kullanım sayısı kazanır', () => {
    // Aynı normalizeKey, aynı turkishScore (0), aynı harf durumu → sayı belirler.
    expect(
      preferCanonical([
        { name: 'Yapay Zeka', count: 1 },
        { name: 'Yapay-Zeka', count: 5 },
      ]),
    ).toBe('Yapay-Zeka');
  });

  it('HER ŞEY eşitse sonuç DETERMİNİSTİK (girdi sırasından bağımsız)', () => {
    const a = [
      { name: 'Aaa', count: 2 },
      { name: 'Aaa ', count: 2 },
    ];
    expect(preferCanonical(a)).toBe(preferCanonical([...a].reverse()));
  });

  it('turkishScore Türkçeye özgü harfleri sayar', () => {
    expect(turkishScore('Yazılım')).toBe(2);
    expect(turkishScore('Yazilim')).toBe(0);
    expect(turkishScore('ÇÖĞÜŞİ')).toBe(6);
  });

  it('ASCII I sayılmaz: yanlış imlâ doğru olandan skor ALMAZ', () => {
    // "İstanbul" (doğru, noktalı İ) 1; "Istanbul" (ASCII'ye kaçmış) 0 olmalı.
    // İkisi eşit skor alırsa kanonik seçim kullanım sayısına düşer ve
    // 200 kayıtlı yanlış yazım kazanır — düzeltmeye çalıştığımız hata.
    expect(turkishScore('İstanbul')).toBeGreaterThan(turkishScore('Istanbul'));
    expect(turkishScore('Istanbul')).toBe(0);
  });

  it('çok kullanılan ASCII yazım, az kullanılan doğru imlâyı YENMEZ', () => {
    expect(
      preferCanonical([
        { name: 'Istanbul', count: 200 },
        { name: 'İstanbul', count: 2 },
      ]),
    ).toBe('İstanbul');
  });
});

describe('duplicateGroups — imlâ', () => {
  it('"Yazilim"/"Yazılım"ı gruplar, kanonik "Yazılım"', () => {
    const g = duplicateGroups([
      { name: 'Yazilim', count: 200 },
      { name: 'Yazılım', count: 2 },
    ]);
    expect(g).toEqual([{ canonical: 'Yazılım', duplicates: ['Yazilim'] }]);
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

/* --- Bağlamlı birleştirme: yol, özet satırı ve ata-torun kapısı --- */

const cat = (id: string, name: string, parent_id: string | null = null): Category => ({
  id,
  name,
  parent_id,
  user_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

describe('categoryPathOf', () => {
  it('kökten yaprağa tam yolu döndürür', () => {
    const cats = [cat('1', 'Yemek'), cat('2', 'Tatlı', '1'), cat('3', 'Sütlü Tatlı', '2')];
    expect(categoryPathOf(cats, '3')).toEqual(['Yemek', 'Tatlı', 'Sütlü Tatlı']);
  });

  it('sarkan üstü kök sayar — kategori kaybolmaz', () => {
    expect(categoryPathOf([cat('1', 'Pizza', 'yok')], '1')).toEqual(['Pizza']);
  });

  it('bilinmeyen id için null', () => {
    expect(categoryPathOf([cat('1', 'Pizza')], 'yok')).toBeNull();
  });

  it('döngüde kilitlenmez', () => {
    // Bozuk veri: a → b → a. Sonsuz döngü olmamalı.
    const cats = [cat('a', 'A', 'b'), cat('b', 'B', 'a')];
    expect(categoryPathOf(cats, 'a')).toBeDefined();
  });
});

describe('validateMergeGroups', () => {
  const paths = new Map([
    ['Yemek', ['Yemek']],
    ['Tatlı', ['Yemek', 'Tatlı']],
    ['Tatlılar', ['Tatlılar']],
    ['Yazılım', ['Yazılım']],
  ]);

  it('ata-torun grubunu DÜŞÜRÜR (ağaç kendini yiyemez)', () => {
    // "Yemek" ile "Tatlı" (Yemek'in altı) birleştirilemez.
    expect(validateMergeGroups([['Yemek', 'Tatlı']], paths)).toEqual([]);
  });

  it('kardeş/ayrı grupları geçirir', () => {
    expect(validateMergeGroups([['Tatlılar', 'Tatlı'], ['Yazılım']], paths))
      .toEqual([['Tatlılar', 'Tatlı']]);
  });

  it('tek elemanlı grubu düşürür', () => {
    expect(validateMergeGroups([['Yazılım']], paths)).toEqual([]);
  });
});

describe('mergeContextLines', () => {
  it('tam yolu ve kayıt sayısını yazar', () => {
    const cats = [cat('1', 'Yemek'), cat('2', 'Tatlı', '1')];
    const lines = mergeContextLines(cats, new Map([['1', 5], ['2', 12]]));
    expect(lines).toContain('Yemek — 5 kayıt');
    expect(lines).toContain('Yemek › Tatlı — 12 kayıt');
  });

  it('sayısı olmayan kategori 0 kayıt okur', () => {
    expect(mergeContextLines([cat('1', 'Yemek')], new Map())).toEqual(['Yemek — 0 kayıt']);
  });
});