/**
 * Çözülmüş vektör önbelleği.
 *
 * Arama her sorguda TÜM embedding'leri base64'ten çözüyordu; bu, sorgu başına
 * büyük maliyetti. Burada bir kez çözülür, bellekte tutulur; yazma/silme
 * işlemleri `invalidateVectorIndex` ile önbelleği düşürür.
 */
import { base64ToVector } from './chunker';
import type { ItemChunkRow } from './db/types';

export interface VectorIndex {
  ids: string[];
  vectors: Float32Array[];
  dims: number;
}

/**
 * Arama sonucu: ya bellekteki indeks (hızlı yol) ya da tavan aşıldığında
 * ÇAĞIRANA geri verilen satırlar (akışkan yol). Satırlar burada döner, böylece
 * çağıran ikinci bir tam tarama yapmaz.
 */
export type VectorLookup =
  | { kind: 'index'; index: VectorIndex }
  | { kind: 'stream'; rows: ItemChunkRow[] };

/*
 * ponytail: bellek tavanı. Bundan fazla chunk'ta tüm vektörleri bellekte tutmak
 * yerine çağıran AKIŞKAN yola (satır satır çöz) düşer. Yükseltme noktası:
 * sqlite-vec ya da Rust'ta paralel tarama.
 */
export const VECTOR_CACHE_MAX = 50_000;

let cached: VectorIndex | null = null;

export function invalidateVectorIndex(): void {
  cached = null;
}

export async function getVectorIndex(
  loader: () => Promise<ItemChunkRow[]>,
  max: number = VECTOR_CACHE_MAX,
): Promise<VectorLookup> {
  if (cached) return { kind: 'index', index: cached };

  const rows = (await loader()).filter((r) => r.embedding);
  if (rows.length > max) return { kind: 'stream', rows };

  const ids: string[] = [];
  const vectors: Float32Array[] = [];
  for (const r of rows) {
    if (!r.embedding) continue;
    try {
      vectors.push(base64ToVector(r.embedding));
      ids.push(r.id);
    } catch {
      // bozuk embedding satırı atlanır
    }
  }

  cached = { ids, vectors, dims: vectors[0]?.length ?? 0 };
  return { kind: 'index', index: cached };
}
