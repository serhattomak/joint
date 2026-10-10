import { describe, expect, it } from 'vitest';
import type { Category } from './db/types';
import { categoryPathLabel, categoryTreeOf, expandedForSearch, filterTree } from './taxonomy-view';

const cat = (id: string, name: string, parent_id: string | null = null): Category => ({
  id,
  name,
  parent_id,
  user_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

describe('categoryTreeOf', () => {
  it('iki seviyeli ağacı kurar', () => {
    const tree = categoryTreeOf([cat('p1', 'Yemek'), cat('c1', 'Pizza', 'p1')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('Yemek');
    expect(tree[0].children.map((c) => c.name)).toEqual(['Pizza']);
  });

  it('hiyerarşi öncesi düz arşivde hepsi kök görünür', () => {
    const tree = categoryTreeOf([cat('1', 'Pizza'), cat('2', 'Yemek')]);
    expect(tree.map((t) => t.name)).toEqual(['Pizza', 'Yemek']);
    expect(tree.every((t) => t.children.length === 0)).toBe(true);
  });

  it('kökleri alfabetik sıralar', () => {
    const tree = categoryTreeOf([cat('1', 'Yemek'), cat('2', 'Aile')]);
    expect(tree.map((t) => t.name)).toEqual(['Aile', 'Yemek']);
  });

  it('altları alfabetik sıralar', () => {
    const tree = categoryTreeOf([cat('p1', 'Yemek'), cat('c2', 'Çorba', 'p1'), cat('c1', 'Pizza', 'p1')]);
    expect(tree[0].children.map((c) => c.name)).toEqual(['Çorba', 'Pizza']);
  });

  it('sarkan referans (üstü silinmiş) kök sayılır, kaybolmaz', () => {
    const tree = categoryTreeOf([cat('c1', 'Pizza', 'yok')]);
    expect(tree.map((t) => t.name)).toEqual(['Pizza']);
  });

  it('üçüncü seviye de ağaçta kalır (görünüm kaybı olmasın)', () => {
    const tree = categoryTreeOf([
      cat('p1', 'Yemek'),
      cat('c1', 'Pizza', 'p1'),
      cat('g1', 'Margherita', 'c1'),
    ]);
    expect(tree[0].children[0].children[0].name).toBe('Margherita');
  });
});

describe('categoryPathLabel', () => {
  const cats = [cat('p1', 'Yemek'), cat('c1', 'Pizza', 'p1')];

  it('alt kategoriyi "Üst › Alt" olarak yazar', () => {
    expect(categoryPathLabel(cats, 'c1')).toBe('Yemek › Pizza');
  });

  it('kökte yalnız adı yazar', () => {
    expect(categoryPathLabel(cats, 'p1')).toBe('Yemek');
  });

  it('bilinmeyen id için null döner (çökmez)', () => {
    expect(categoryPathLabel(cats, 'yok')).toBeNull();
  });

  it('3 seviyeli tam yolu yazar', () => {
    const cats = [cat('1', 'Yemek'), cat('2', 'Tatlı', '1'), cat('3', 'Sütlü Tatlı', '2')];
    expect(categoryPathLabel(cats, '3')).toBe('Yemek › Tatlı › Sütlü Tatlı');
  });

  it('sarkan üst: eksik ata yola girmez, kategori KAYBOLMAZ', () => {
    // Üstü silinmiş satır (parent_id dolu ama karşılığı yok) ağaçtan düşmemeli.
    const cats = [cat('9', 'Yetim', 'silinmis')];
    expect(categoryPathLabel(cats, '9')).toBe('Yetim');
  });

  it('kendine referanslı bozuk veride sonsuz döngüye girmez', () => {
    const cats = [cat('1', 'A', '1')];
    expect(categoryPathLabel(cats, '1')).toBe('A');
  });
});

describe('filterTree', () => {
  it('eşleşen torun için ATALAR korunur (yol görünür kalır)', () => {
    const nodes = categoryTreeOf([cat('1', 'Yemek'), cat('2', 'Tatlı', '1'), cat('3', 'Sütlü Tatlı', '2')]);
    const out = filterTree(nodes, 'sütlü');
    expect(out.map((n) => n.name)).toEqual(['Yemek']);
    expect(out[0].children.map((n) => n.name)).toEqual(['Tatlı']);
    expect(out[0].children[0].children.map((n) => n.name)).toEqual(['Sütlü Tatlı']);
  });

  it('eşleşmeyen kardeş düşer', () => {
    const nodes = categoryTreeOf([cat('1', 'Yemek'), cat('2', 'Pizza', '1'), cat('3', 'Çorba', '1')]);
    const out = filterTree(nodes, 'pizza');
    expect(out.map((n) => n.name)).toEqual(['Yemek']);
    expect(out[0].children.map((n) => n.name)).toEqual(['Pizza']);
  });

  it('eşleşen kök korunur; eşleşmeyen torunları düşer', () => {
    const nodes = categoryTreeOf([cat('1', 'Yemek'), cat('2', 'Pizza', '1')]);
    const out = filterTree(nodes, 'yemek');
    expect(out.map((n) => n.name)).toEqual(['Yemek']);
    expect(out[0].children).toEqual([]);
  });

  it('ad Türkçe yerelle küçültülür (İ → i)', () => {
    const nodes = categoryTreeOf([cat('1', 'İstanbul')]);
    expect(filterTree(nodes, 'istanbul').map((n) => n.name)).toEqual(['İstanbul']);
  });

  it('diyakritik katlanmaz: "sutlu" ile "Sütlü" eşleşmez', () => {
    const nodes = categoryTreeOf([cat('1', 'Sütlü')]);
    expect(filterTree(nodes, 'sutlu')).toEqual([]);
  });

  it('needle zaten küçük harf olmalıdır (sözleşme): "YEMEK" eşleşmez', () => {
    // Çağıranlar (CategoryTree, CollectionsView) aramayı önce küçültür.
    const nodes = categoryTreeOf([cat('1', 'Yemek')]);
    expect(filterTree(nodes, 'YEMEK')).toEqual([]);
  });

  it('boş arama tüm ağacı döndürür; yalnız boşluk arama hiçbir şey döndürmez', () => {
    const nodes = categoryTreeOf([cat('1', 'Yemek'), cat('2', 'Pizza', '1')]);
    const all = filterTree(nodes, '');
    expect(all.map((n) => n.name)).toEqual(['Yemek']);
    expect(all[0].children.map((n) => n.name)).toEqual(['Pizza']);
    expect(filterTree(nodes, '   ')).toEqual([]);
  });
});

describe('expandedForSearch', () => {
  it('ARAMA derin torunla eşleşince ATALAR açılır', () => {
    const nodes = categoryTreeOf([cat('1', 'Yemek'), cat('2', 'Tatlı', '1'), cat('3', 'Sütlü Tatlı', '2')]);
    // "sütlü" yalnız yaprakta geçer; ebeveynleri kapalıysa sonuç görünmez olurdu.
    expect([...expandedForSearch(nodes, 'sütlü')]).toEqual(['1', '2']);
  });

  it('arama eşleşmezse hiçbir şey açılmaz', () => {
    const nodes = categoryTreeOf([cat('1', 'Yemek')]);
    expect(expandedForSearch(nodes, 'zzz').size).toBe(0);
  });

  it('boş aramada hiçbir şey açılmaz', () => {
    const nodes = categoryTreeOf([cat('1', 'Yemek'), cat('2', 'Tatlı', '1')]);
    expect(expandedForSearch(nodes, '   ').size).toBe(0);
  });

  it('kökün kendisi eşleşirse açılacak ata yoktur (boş küme)', () => {
    const nodes = categoryTreeOf([cat('1', 'Yemek'), cat('2', 'Tatlı', '1')]);
    expect([...expandedForSearch(nodes, 'yemek')]).toEqual([]);
  });
});