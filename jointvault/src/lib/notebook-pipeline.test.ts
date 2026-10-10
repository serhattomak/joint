import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item } from './db/types';
import { readNotebookThreshold, writeNotebookThreshold } from './notebook-pipeline';

/* node ortamında localStorage yok: Map-tabanlı sahte depo takılır. */
beforeEach(() => {
  const map = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  map.clear();
});

describe('readNotebookThreshold/writeNotebookThreshold', () => {
  it('varsayılan 0.90; yazılıp okunur ve 0.80-0.98 aralığına sıkıştırılır', () => {
    expect(readNotebookThreshold()).toBe(0.9);
    writeNotebookThreshold(0.99);
    expect(readNotebookThreshold()).toBe(0.98);
    writeNotebookThreshold(0.5);
    expect(readNotebookThreshold()).toBe(0.8);
  });
});

import type { NotebookDeps } from './notebook-pipeline';
import { applyMerges, runNotebookPipeline } from './notebook-pipeline';

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  url: `https://x.com/a/status/${id}`,
  title: `Kayıt ${id}`,
  note: null,
  platform: 'x',
  thumbnail: null,
  favorite: false,
  collection_id: null,
  user_id: null,
  created_at: new Date(Date.parse('2026-01-01T00:00:00Z') + Number(id) * 1000).toISOString(),
  updated_at: '2026-01-01T00:00:00Z',
  local_path: null,
  download_status: 'none',
  download_error: null,
  converted_path: null,
  ...over,
}) as Item;

const baseDeps = (): NotebookDeps => ({
  listBackfill: vi.fn().mockResolvedValue([]),
  listMissingCategory: vi.fn().mockResolvedValue([]),
  scrape: vi.fn().mockResolvedValue({ successCount: 0, errorCount: 0, failed: [] }),
  isAi: vi.fn().mockResolvedValue(true),
  categorize: vi.fn().mockResolvedValue({
    processed: 0,
    applied: 0,
    lowConfidence: 0,
    failed: 0,
    deterministic: 0,
    skipped: 0,
    replaced: 0,
  }),
  vectors: vi.fn().mockResolvedValue({ items: [], vectors: new Map() }),
  findGroups: vi.fn().mockResolvedValue([]),
  merge: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn().mockResolvedValue(undefined),
});

describe('runNotebookPipeline', () => {
  it('üç aşamayı sıra ile koşar ve onProgress stage 1..3 çağırır', async () => {
    const deps = baseDeps();
    const stages: number[] = [];
    await runNotebookPipeline(deps, (stage) => stages.push(stage));
    expect(stages).toContain(1);
    expect(stages).toContain(2);
    expect(stages).toContain(3);
    expect(deps.isAi).toHaveBeenCalledOnce();
  });

  it('AI kapalıysa Adım 2 deterministik tur koşar, Adım 3 (embedding) atlanır', async () => {
    const deps = baseDeps();
    deps.isAi = vi.fn().mockResolvedValue(false);
    deps.listMissingCategory = vi.fn().mockResolvedValue([item('1')]);
    const report = await runNotebookPipeline(deps, () => undefined);
    // Adım 2 koşar: kural tabanlı tur LLM gerektirmez.
    expect(deps.categorize).toHaveBeenCalledOnce();
    expect(report.categorize).toBeDefined();
    expect(report.categorize && 'aiOff' in report.categorize).toBe(false);
    // Adım 3 yalnız AI açıkken (embedding gerekir).
    expect(report.dedupe?.aiOff).toBe(true);
    expect(deps.vectors).not.toHaveBeenCalled();
    expect(deps.findGroups).not.toHaveBeenCalled();
  });

  it('scrape hata izolasyonu: failed raporlanır, boru devam eder', async () => {
    const deps = baseDeps();
    deps.listBackfill = vi.fn().mockResolvedValue([item('1'), item('2')]);
    deps.scrape = vi.fn().mockResolvedValue({ successCount: 1, errorCount: 1, failed: [item('2')] });
    const report = await runNotebookPipeline(deps, () => undefined);
    expect(report.scraped).toBe(1);
    expect(report.scrapeFailed).toBe(1);
    expect(report.scrapeFailures.map((x) => x.id)).toEqual(['2']);
    expect(deps.isAi).toHaveBeenCalledOnce();
  });

  it('embedding\'i eksik öğe dışlanır ve missingEmbedding sayılır', async () => {
    const deps = baseDeps();
    deps.vectors = vi.fn().mockResolvedValue({
      items: [item('1'), item('2')],
      vectors: new Map([['1', new Float32Array([1, 0])]]),
    });
    deps.findGroups = vi.fn().mockResolvedValue([]);
    const report = await runNotebookPipeline(deps, () => undefined);
    expect(report.dedupe?.missingEmbedding).toBe(1);
    // findGroups'e yalnız vektörü olan öğelerin vektörleri geçti
    const call = (deps.findGroups as ReturnType<typeof vi.fn>).mock.calls[0] as
      [number[][], number];
    expect(call[0].length).toBe(1);
  });

  it('gruplar planItemMerge ile hazırlanır; merge yalnız applyMerges ile koşar', async () => {
    const deps = baseDeps();
    const i1 = item('1', { title: 'Eski', note: null, created_at: '2026-01-01T00:00:00Z' });
    const i3 = item('3', { title: 'Sonrak', note: 'not', created_at: '2026-01-03T00:00:00Z' });
    deps.vectors = vi.fn().mockResolvedValue({
      items: [i1, i3],
      vectors: new Map<string, Float32Array>([
        ['1', new Float32Array([1, 0])],
        ['3', new Float32Array([1, 0])],
      ]),
    });
    deps.findGroups = vi.fn().mockResolvedValue([[0, 1]]);
    const report = await runNotebookPipeline(deps, () => undefined);
    const group = report.dedupe?.groups?.[0];
    expect(group?.targetId).toBe('1');
    expect(group?.victimIds).toEqual(['3']);
    expect(group?.patch.note).toBe('not');
    expect(deps.merge).not.toHaveBeenCalled();

    const applied = await applyMerges([group!], deps);
    expect(applied.merged).toBe(1);
    expect(deps.merge).toHaveBeenCalledOnce();
    expect(deps.refresh).toHaveBeenCalledWith('1');
  });

  it('applyMerges hata izolasyonu: biri düşer, diğerleri birleşir', async () => {
    const deps = baseDeps();
    deps.merge = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('db kilitli'));
    const targets = [
      { targetId: 'a', victimIds: ['b'], patch: { note: '', favorite: false, title: null, thumbnail: null, created_at: '2026-01-01T00:00:00Z', victimIds: ['b'] }, targetTitle: 'A', victimTitles: ['B'], members: [
        { id: 'a', url: 'https://x.com/a', title: 'A', note: null, favorite: false, thumbnail: null, author: null, created_at: '2026-01-01T00:00:00Z' },
        { id: 'b', url: 'https://x.com/b', title: 'B', note: null, favorite: false, thumbnail: null, author: null, created_at: '2026-01-02T00:00:00Z' },
      ] },
      { targetId: 'c', victimIds: ['d'], patch: { note: '', favorite: false, title: null, thumbnail: null, created_at: '2026-01-01T00:00:00Z', victimIds: ['d'] }, targetTitle: 'C', victimTitles: ['D'], members: [
        { id: 'c', url: 'https://x.com/c', title: 'C', note: null, favorite: false, thumbnail: null, author: null, created_at: '2026-01-01T00:00:00Z' },
        { id: 'd', url: 'https://x.com/d', title: 'D', note: null, favorite: false, thumbnail: null, author: null, created_at: '2026-01-02T00:00:00Z' },
      ] },
    ];
    const app = await applyMerges(targets, deps);
    expect(app.merged).toBe(1);
    expect(app.failedGroups.map((g) => g.targetId)).toEqual(['c']);
  });
});
