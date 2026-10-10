/**
 * Kategori ağacının kapısı (SAF — DB/IPC yok, Node'da test edilir).
 *
 * Hiyerarşi N seviyeye (en fazla 5) açılır; buradaki denetimler olmadan
 * `parent_id`'de oluşan bir döngü sessiz bir hatadır: hiçbir şey fırlatmaz ama
 * `categoryTreeOf` çocukları özyinelemeli gezerken sonsuza kadar döner.
 * Bu yüzden her yazma (taşıma/oluşturma) önce buradan geçer.
 *
 * Bozuk veriye (döngü, sarkan üst) karşı tüm yürüyüşler `seen` kümesiyle
 * kilitlenmeden durur; bu fonksiyonlar asla sonsuz döngüye girmez.
 */
import type { Category } from './db/types';

/** İzin verilen en fazla seviye; kök 1'dir. */
export const MAX_DEPTH = 5;

/**
 * Kategorinin kökten uzaklığı; kök = 1, bilinmeyen id = 0.
 * Yukarı doğru yürür, `seen` ile döngüde kilitlenmeyi önler. Sarkan üst
 * (var olmayan parent_id) kök sayılır — `categoryTreeOf` ile aynı kabul.
 */
export function depthOf(categories: Category[], id: string): number {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const seen = new Set<string>();
  let depth = 0;
  let cur: string | null = id;
  while (cur && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    depth++;
    cur = byId.get(cur)!.parent_id;
  }
  return depth;
}

/**
 * `candidateId`'nin ataları arasında `ancestorId` var mı? Kendisi sayılmaz.
 * Döngü kuran veride bile durur.
 */
export function isDescendant(
  categories: Category[],
  candidateId: string,
  ancestorId: string,
): boolean {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const seen = new Set<string>();
  let cur: string | null = byId.get(candidateId)?.parent_id ?? null;
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    cur = byId.get(cur)?.parent_id ?? null;
  }
  return false;
}

/**
 * `id` dahil, altındaki en derin dalın düğüm sayısı; bilinmeyen id = 0.
 * Aşağı yürürken yol (`path`) kümesi döngüde kilitlenmeyi önler.
 */
export function subtreeDepth(categories: Category[], id: string): number {
  const byId = new Set(categories.map((c) => c.id));
  if (!byId.has(id)) return 0;

  const childrenOf = new Map<string, Category[]>();
  for (const c of categories) {
    if (c.parent_id) {
      const list = childrenOf.get(c.parent_id) ?? [];
      list.push(c);
      childrenOf.set(c.parent_id, list);
    }
  }

  const walk = (nodeId: string, path: Set<string>): number => {
    if (path.has(nodeId)) return 0; // bozuk veri: döngü
    const next = new Set(path).add(nodeId);
    let deepest = 0;
    for (const child of childrenOf.get(nodeId) ?? []) {
      const d = walk(child.id, next);
      if (d > deepest) deepest = d;
    }
    return 1 + deepest;
  };

  return walk(id, new Set());
}

/** Taşımanın geçerliliği; `reason` yalnızca reddedilince doludur (TR, kullanıcıya gösterilir). */
export interface GateResult {
  ok: boolean;
  reason: string | null;
}

const notFound: GateResult = { ok: false, reason: 'Kategori bulunamadı.' };

/**
 * Kategoriyi yeni üste taşımayı denetler. `newParentId` null ise köke taşınır.
 *
 * Taşma denetimi yalnız düğümün derinliğine değil, **altındaki dalın**
 * derinliğine bakar: `depthOf(yeni üst) + subtreeDepth(id) > MAX_DEPTH`.
 */
export function validateCategoryMove(
  categories: Category[],
  id: string,
  newParentId: string | null,
): GateResult {
  if (!categories.some((c) => c.id === id)) return notFound;

  if (newParentId === id) {
    return { ok: false, reason: 'Kategori kendisinin altına taşınamaz.' };
  }

  if (newParentId === null) return { ok: true, reason: null };

  if (!categories.some((c) => c.id === newParentId)) return notFound;

  if (isDescendant(categories, newParentId, id)) {
    return { ok: false, reason: 'Kategori kendi alt ağacındaki bir kategoriye taşınamaz.' };
  }

  if (depthOf(categories, newParentId) + subtreeDepth(categories, id) > MAX_DEPTH) {
    return { ok: false, reason: `En fazla ${MAX_DEPTH} seviye desteklenir.` };
  }

  return { ok: true, reason: null };
}

/**
 * Yeni kategori oluşturmayı denetler. `parentId` null ise kök oluşturulur.
 * Eklenecek düğüm yapraktır; yalnız üstün derinliği + 1 sınırı aşabilir.
 */
export function validateCategoryCreate(
  categories: Category[],
  parentId: string | null,
): GateResult {
  if (parentId === null) return { ok: true, reason: null };

  if (!categories.some((c) => c.id === parentId)) return notFound;

  if (depthOf(categories, parentId) + 1 > MAX_DEPTH) {
    return { ok: false, reason: `En fazla ${MAX_DEPTH} seviye desteklenir.` };
  }

  return { ok: true, reason: null };
}
