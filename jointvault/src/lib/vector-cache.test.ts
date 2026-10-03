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
    const idx = await getVectorIndex(loader);
    expect(idx?.ids).toEqual(['a', 'b']);
    expect(idx?.dims).toBe(2);
    expect(Array.from(idx!.vectors[0])).toEqual([1, 0]);
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

  it('tavan aşılırsa null döner', async () => {
    invalidateVectorIndex();
    const loader = vi.fn(async () => [row('a', [1]), row('b', [1]), row('c', [1])]);
    expect(await getVectorIndex(loader, 2)).toBeNull();
  });

  it('boş girdide boş indeks', async () => {
    invalidateVectorIndex();
    const idx = await getVectorIndex(async () => []);
    expect(idx).toEqual({ ids: [], vectors: [], dims: 0 });
  });
});
