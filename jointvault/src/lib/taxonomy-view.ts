/**
 * Kategori ağacının görünüm tarafı (SAF — DB/IPC yok, Node'da test edilir).
 *
 * Hiyerarşi iki seviyedir; burada üçüncü seviye bir derinlikte olsa da aynı
 * ağaç çizilir. `listCategories` düz döndüğü için ağaç burada kurulur.
 */
import type { Category } from './db/types';

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

/** Kategoriyi "Üst › Alt" olarak okunur biçimde döndürür; kökte yalnız ad. */
export function categoryPathLabel(
  categories: Category[],
  categoryId: string,
): string | null {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const self = byId.get(categoryId);
  if (!self) return null;
  if (!self.parent_id) return self.name;
  const parent = byId.get(self.parent_id);
  return parent ? `${parent.name} › ${self.name}` : self.name;
}