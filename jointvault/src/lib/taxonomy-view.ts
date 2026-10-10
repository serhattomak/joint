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

/** Kategoriyi "Üst › Alt › Torun" tam yolu olarak döndürür; kökte yalnız ad. */
export function categoryPathLabel(
  categories: Category[],
  categoryId: string,
): string | null {
  // Yürüyüş, çevrim ve eksik ata mantığı `categoryPathOf`'ta tek yerde yaşar;
  // burada yalnızca okunur biçime çevrilir (kopyası yazılmaz).
  return categoryPathOf(categories, categoryId)?.join(' › ') ?? null;
}