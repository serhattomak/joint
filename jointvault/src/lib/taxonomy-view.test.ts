import { describe, expect, it } from 'vitest';
import type { Category } from './db/types';
import { categoryPathLabel, categoryTreeOf } from './taxonomy-view';

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
});