/**
 * Kategori ağacının görünüm tarafı (SAF — DB/IPC yok, Node'da test edilir).
 *
 * Hiyerarşi N seviyeye açıktır; ağaç ve tam yol aynı derinlikte çizilir.
 * `listCategories` düz döndüğü için ağaç burada kurulur.
 */
import type { Category } from './db/types';
import { categoryPathOf } from './taxonomy-maintenance';

export interface CategoryTreeNode {
  id: string;
  name: string;
  parent_id: string | null;
  children: CategoryTreeNode[];
}

/**
 * Düz kategori listesinden kök + alt ağacı üretir.
 *
 * Hiyerarşi öncesi arşivlerde tüm satırlar köktür (`parent_id` null) ve
 * `children` hep boş döner — eski veri kendi kendini gösterir.
 * Üstü olmayan satır (sarkan referans) yine kök sayılır.
 */
export function categoryTreeOf(categories: Category[]): CategoryTreeNode[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const childrenOf = new Map<string, Category[]>();
  const roots: Category[] = [];

  for (const c of categories) {
    if (c.parent_id && byId.has(c.parent_id)) {
      const list = childrenOf.get(c.parent_id) ?? [];
      list.push(c);
      childrenOf.set(c.parent_id, list);
    } else {
      roots.push(c);
    }
  }

  const build = (node: Category): CategoryTreeNode => ({
    id: node.id,
    name: node.name,
    parent_id: node.parent_id,
    children: (childrenOf.get(node.id) ?? []).map(build),
  });

  const byName = (a: Category, b: Category) => a.name.localeCompare(b.name, 'tr');
  return roots.sort(byName).map(build);
}

/**
 * Arama metniyle eşleşen düğümlerin **atalarını** toplar (kendileri değil).
 *
 * Kullanıcı derin bir torunu aradığında ebeveynleri kapalıysa sonuç görünmez
 * kalırdı; bu küme, eşleşmeye giden yolu geçici olarak açar. Kök eşleşirse
 * ata yoktur → küme boş. Boş/boşluk arama eşleşme sayılmaz.
 */
export function expandedForSearch(nodes: CategoryTreeNode[], needle: string): Set<string> {
  const q = needle.trim().toLocaleLowerCase('tr');
  const open = new Set<string>();
  if (!q) return open;

  const walk = (list: CategoryTreeNode[], ancestors: string[]): void => {
    for (const node of list) {
      if (node.name.toLocaleLowerCase('tr').includes(q)) {
        for (const id of ancestors) open.add(id);
      }
      walk(node.children, [...ancestors, node.id]);
    }
  };
  walk(nodes, []);
  return open;
}

/**
 * Arama süzgeci: eşleşen düğümü ve eşleşmeye giden atalarını korur.
 * Eşleşen düğümün eşleşmeyen torunları düşer (iki seviyeli eski davranışla aynı).
 * `needle` zaten küçük harfe çevrilmiş olmalıdır.
 */
export function filterTree(nodes: CategoryTreeNode[], needle: string): CategoryTreeNode[] {
  const out: CategoryTreeNode[] = [];
  for (const node of nodes) {
    const children = filterTree(node.children, needle);
    if (children.length > 0 || node.name.toLocaleLowerCase('tr').includes(needle)) {
      out.push({ ...node, children });
    }
  }
  return out;
}

/**
 * Yol listesini girintili ağaca çevirir (prompt biçimi; SAF).
 *
 * Her yol `derinlik × 2 boşluk` ile yazılır. Girdi yolları herhangi bir sırada
 * gelebilir: önce düğüm ağacı kurulur, sonra kökten derine gezinilir, böylece
 * her çocuk üstünün HEMEN ardından gelir (kardeşler ilk görülme sırasında).
 * Modelin bir üstü kendi altıyla karıştırmaması için yol bağlamı korunur.
 */
export function indentedTaxonomyTree(paths: string[][]): string {
  interface Node {
    name: string;
    children: Map<string, Node>;
  }
  const roots = new Map<string, Node>();
  for (const path of paths) {
    let level = roots;
    for (const name of path) {
      let node = level.get(name);
      if (!node) {
        node = { name, children: new Map() };
        level.set(name, node);
      }
      level = node.children;
    }
  }

  const lines: string[] = [];
  const walk = (level: Map<string, Node>, depth: number): void => {
    for (const node of level.values()) {
      lines.push('  '.repeat(depth) + node.name);
      walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);
  return lines.join('\n');
}

/** Kategoriyi "Üst › Alt › Torun" tam yolu olarak döndürür; kökte yalnız ad. */
export function categoryPathLabel(
  categories: Category[],
  categoryId: string,
): string | null {
  // Yürüyüş, çevrim ve eksik ata mantığı `categoryPathOf`'ta tek yerde yaşar;
  // burada yalnızca okunur biçime çevrilir (kopyası yazılmaz).
  return categoryPathOf(categories, categoryId)?.join(' › ') ?? null;
}