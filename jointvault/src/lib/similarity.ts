import { invoke } from '@tauri-apps/api/core';

/**
 * Saf benzerlik yardımcıları (defter tekrar tespiti).
 * Vektörler BGE-M3 embedding'lerinden gelir; aynı boyut DB değişmezliğidir.
 */
export function cosine(
  a: number[] | Float32Array,
  b: number[] | Float32Array,
): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den === 0 ? 0 : dot / den;
}

export function meanVector(vecs: Float32Array[]): Float32Array {
  if (vecs.length === 0) return new Float32Array(0);
  const len = vecs[0].length;
  const out = new Float32Array(len);
  for (const v of vecs) {
    for (let i = 0; i < len; i++) {
      out[i] += v[i];
    }
  }
  for (let i = 0; i < len; i++) {
    out[i] /= vecs.length;
  }
  return out;
}

/** Rust `dedupe_candidates` kabığı: eşik üstü bağlı bileşenleri döndürür. */
export function findSimilarGroups(
  vectors: number[][],
  threshold: number,
): Promise<number[][]> {
  return invoke('dedupe_candidates', { vectors, threshold });
}
