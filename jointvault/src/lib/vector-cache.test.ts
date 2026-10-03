import { describe, expect, it, vi } from 'vitest';
import { vectorToBase64 } from './chunker';
import { getVectorIndex, invalidateVectorIndex } from './vector-cache';
import type { ItemChunkRow } from './db/types';

const row = (id: string, vec: number[]): ItemChunkRow => ({
  id,
  item_id: 'i1',
  chunk_type: 'meta',
  chunk_text: 'x',
  start_seconds: null,
  end_seconds: null,
  embedding: vectorToBase64(vec),
  created_at: '',
});

describe('vector-cache', () => {
  it('embeddingleri çözer', async () => {
    invalidateVectorIndex();
    const loader = vi.fn(async () => [row('a', [1, 0]), row('b', [0, 1])]);
    const r = await getVectorIndex(loader);
    expect(r.kind).toBe('index');
    if (r.kind !== 'index') throw new Error('index bekleniyordu');
    expect(r.index.ids).toEqual(['a', 'b']);
    expect(r.index.dims).toBe(2);
    expect(Array.from(r.index.vectors[0])).toEqual([1, 0]);
  });

  it('ikinci çağrıda yükleyici tekrar çağrılmaz', async () => {
    invalidateVectorIndex();
    const loader = vi.fn(async () => [row('a', [1, 0])]);
    await getVectorIndex(loader);
    await getVectorIndex(loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('invalidate sonrası yeniden kurar', async () => {
    invalidateVectorIndex();
    const loader = vi.fn(async () => [row('a', [1, 0])]);
    await getVectorIndex(loader);
    invalidateVectorIndex();
    await getVectorIndex(loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('tavan aşılırsa satırları AKIŞKAN döndürür ve TEK tarama yapar', async () => {
    invalidateVectorIndex();
    const loader = vi.fn(async () => [row('a', [1]), row('b', [1]), row('c', [1])]);
    const r = await getVectorIndex(loader, 2);
    expect(r.kind).toBe('stream');
    if (r.kind !== 'stream') throw new Error('stream bekleniyordu');
    expect(r.rows).toHaveLength(3);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('boş girdide boş indeks', async () => {
    invalidateVectorIndex();
    const r = await getVectorIndex(async () => []);
    expect(r.kind).toBe('index');
    if (r.kind !== 'index') throw new Error('index bekleniyordu');
    expect(r.index).toEqual({ ids: [], vectors: [], dims: 0 });
  });
});
