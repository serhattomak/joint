import type { Item } from './db/types';
import { planItemMerge, type MergePatch } from './notebook';
import {
  getAllChunksWithEmbeddings,
  listArticleAuthors,
  listItems,
  listItemsMissingCategory,
  listItemsWithoutArticle,
  mergeItems,
} from './db/client';
import {
  batchCategorizeItems,
  getAiStatus,
  isAiEnabled,
  refreshItemIndex,
} from './ai';
import { batchScrapeItems } from './scraper';
import { base64ToVector } from './chunker';
import { findSimilarGroups, meanVector } from './similarity';

/**
 * "Defteri Hazırla" orkestrasyonu. Kaba bağımlılık yok: tüm dış etkiler
 * NotebookDeps ile enjekte edilir (yield: vitest fake deps).
 * Sıra: Adım1 backfill → Adım2 kategorilendirme (AI) → Adım3 tekrar taraması
 * (AI, embedding). Merge yalnız kullanıcı onayı benimsenir (applyMerges).
 */

const THRESHOLD_KEY = 'jv-notebook-dedup-threshold';
const THRESHOLD_MIN = 0.8;
const THRESHOLD_MAX = 0.98;
export const DEFAULT_DEDUPE_THRESHOLD = 0.9;

/* localStorage node ortamında (vitest) yoktur; guard + try/bak. */
const readStoreItem = (key: string): string | null => {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const writeStoreItem = (key: string, value: string): void => {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // kalici olmayan ortamlarda sessiz: deger varsayilanda kalir
  }
};

export function readNotebookThreshold(): number {
  const raw = readStoreItem(THRESHOLD_KEY);
  const value = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_DEDUPE_THRESHOLD;
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, value));
}

export function writeNotebookThreshold(value: number): void {
  writeStoreItem(THRESHOLD_KEY, String(Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, value))));
}

export interface BatchCategorizeReport {
  processed: number;
  applied: number;
  lowConfidence: number;
  failed: number;
  deterministic: number;
  skipped: number;
  replaced: number;
}

export interface ScrapeResult {
  successCount: number;
  errorCount: number;
  failed: Item[];
}

export interface DupeMember {
  id: string;
  url: string;
  title: string | null;
  note: string | null;
  favorite: boolean;
  thumbnail: string | null;
  author: string | null;
  created_at: string;
}

export interface DupeGroup {
  targetId: string;
  victimIds: string[];
  patch: MergePatch;
  /** Onay tablosu için okunur başlıklar + üye künyesi (hedef değiştirilebilir). */
  targetTitle: string;
  victimTitles: string[];
  members: DupeMember[];
}

export interface NotebookDeps {
  /** İçeriği eksik kayıtlar (Adım 1 evreni). */
  listBackfill: () => Promise<Item[]>;
  /** Sınıflandırılmamış kayıtlar (Adım 2 evreni). */
  listMissingCategory: () => Promise<Item[]>;
  /** Adım 1: batchScrapeItems sarmalı; bekleme fabrikada (500 ms). */
  scrape: (
    items: Item[],
    onProgress?: (done: number, total: number, current: Item) => void,
    isCancelled?: () => boolean,
  ) => Promise<ScrapeResult>;
  isAi: () => Promise<boolean>;
  categorize: (
    items: Item[],
    onProgress?: (current: number, total: number, itemTitle: string) => void,
  ) => Promise<BatchCategorizeReport>;
  /** Tüm arşiv vektörleri: embedding'i olan/olmayan öğeleri ayırt ettirir. */
  vectors: () => Promise<{
    items: Item[];
    vectors: Map<string, Float32Array>;
    /** Kayıt künyesi için yazarlar (makale yazarı; yoksa boş). */
    authors: Map<string, string>;
  }>;
  findGroups: (vectors: number[][], threshold: number) => Promise<number[][]>;
  merge: (
    targetId: string,
    victimIds: string[],
    patch: MergePatch,
  ) => Promise<void>;
  refresh: (targetId: string) => Promise<void>;
  /** Kullanıcı iptal bayrağı: aşama sınırında sorgulanır. */
  isCancelled?: () => boolean;
}

export interface NotebookReport {
  scraped: number;
  scrapeFailed: number;
  scrapeFailures: Item[];
  categorize?: BatchCategorizeReport | { aiOff: true };
  dedupe?: { missingEmbedding: number; groups: DupeGroup[]; aiOff?: true };
  /** Kullanıcı aşama sınırında durdurdu; kalan aşamalar koşulmadı. */
  cancelled?: boolean;
}

export type ProgressCb = (
  stage: 1 | 2 | 3,
  done: number,
  total: number,
  label: string,
) => void;

export async function runNotebookPipeline(
  deps: NotebookDeps,
  onProgress: ProgressCb,
): Promise<NotebookReport> {
  const report: NotebookReport = { scraped: 0, scrapeFailed: 0, scrapeFailures: [] };

  // Adım 1 — içerik tamamla
  const backfill = await deps.listBackfill();
  if (backfill.length > 0) {
    const res = await deps.scrape(
      backfill,
      (done, total) => onProgress(1, done, total, 'İçerik tamamlama'),
      () => Boolean(deps.isCancelled?.()),
    );
    const processed = res.successCount + res.errorCount;
    report.scraped = res.successCount;
    report.scrapeFailed = res.errorCount;
    report.scrapeFailures = res.failed;
    if (processed < backfill.length) {
      report.cancelled = true;
    }
  }
  onProgress(1, 1, 1, 'İçerik tamamlama');
  if (deps.isCancelled?.()) {
    report.cancelled = true;
    onProgress(1, 1, 1, 'İptal edildi');
    return report;
  }

  // Adım 2 — kategorilendirme + etiketleme.
  // Kural tabanlı (deterministik) tur AI'sız da koşar; LLM yalnızca boşluğu kapatır.
  const aiOn = await deps.isAi();
  const missing = await deps.listMissingCategory();
  if (missing.length > 0) {
    report.categorize = await deps.categorize(missing, (current, total) =>
      onProgress(2, current, total, 'Kategorilendirme'),
    );
  } else {
    report.categorize = {
      processed: 0,
      applied: 0,
      lowConfidence: 0,
      failed: 0,
      deterministic: 0,
      skipped: 0,
      replaced: 0,
    };
  }
  onProgress(2, 1, 1, 'Kategorilendirme');
  if (deps.isCancelled?.()) {
    report.cancelled = true;
    onProgress(2, 1, 1, 'İptal edildi');
    return report;
  }

  // Adım 3 — tekrar tespiti (embedding). Yalnızca AI açıkken (vektör gerekir).
  if (!aiOn) {
    report.dedupe = { missingEmbedding: 0, groups: [], aiOff: true };
    onProgress(3, 1, 1, 'AI kapalı — tekrar taraması atlandı');
    return report;
  }

  const { items, vectors, authors } = await deps.vectors();
  const embedded = items.filter((it) => vectors.has(it.id));
  const missingEmbedding = items.length - embedded.length;
  const vectorList = embedded.map((it) => Array.from(vectors.get(it.id) ?? []));
  const groupIdx = await deps.findGroups(vectorList, readNotebookThreshold());
  report.dedupe = {
    missingEmbedding,
    groups: groupIdx.map((members) => {
      const members2 = members.map((i) => embedded[i]);
      const target = [...members2].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      const rest = members2.filter((it) => it.id !== target.id);
      const patch = planItemMerge(target, rest);
      const toMember = (it: Item): DupeMember => ({
        id: it.id,
        url: it.url,
        title: it.title,
        note: it.note,
        favorite: it.favorite,
        thumbnail: it.thumbnail,
        author: authors?.get(it.id) ?? null,
        created_at: it.created_at,
      });
      return {
        targetId: target.id,
        victimIds: [...patch.victimIds],
        patch: { ...patch, victimIds: [...patch.victimIds] },
        targetTitle: target.title ?? target.url,
        victimTitles: rest.map((it) => it.title ?? it.url),
        members: members2.map(toMember),
      };
    }),
  };
  onProgress(3, 1, 1, 'Tekrar taraması');
  return report;
}

export async function applyMerges(
  groups: DupeGroup[],
  deps: Pick<NotebookDeps, 'merge' | 'refresh'>,
): Promise<{ merged: number; failedGroups: { targetId: string; error: string }[] }> {
  let merged = 0;
  const failedGroups: { targetId: string; error: string }[] = [];
  for (const group of groups) {
    try {
      await deps.merge(group.targetId, group.victimIds, group.patch);
      await deps.refresh(group.targetId);
      merged++;
    } catch (e) {
      failedGroups.push({
        targetId: group.targetId,
        error: typeof e === 'string' ? e : e instanceof Error ? e.message : 'birleştirme hatası',
      });
    }
  }
  return { merged, failedGroups };
}

/* --- gerçek deps fabrikası (SettingsView bağlanır) --- */

export function makeNotebookDeps(): NotebookDeps {
  return {
    listBackfill: () => listItemsWithoutArticle(),
    listMissingCategory: () => listItemsMissingCategory(),
    scrape: (items, onProgress, isCancelled) => batchScrapeItems(items, onProgress, 500, isCancelled),
    isAi: async () => {
      try {
        return isAiEnabled(await getAiStatus());
      } catch {
        return false;
      }
    },
    categorize: (items, onProgress) => batchCategorizeItems(items, { onProgress }),
    vectors: async () => {
      const [items, chunks, authors] = await Promise.all([
        listItems(),
        getAllChunksWithEmbeddings(),
        listArticleAuthors(),
      ]);
      const byItem = new Map<string, Float32Array[]>();
      for (const chunk of chunks) {
        if (!chunk.embedding) continue;
        try {
          const list = byItem.get(chunk.item_id) ?? [];
          list.push(base64ToVector(chunk.embedding));
          byItem.set(chunk.item_id, list);
        } catch {
          // bozuk embedding satırı atlanır (vector-cache deseni)
        }
      }
      const vectors = new Map<string, Float32Array>();
      for (const [id, list] of byItem) {
        const mean = meanVector(list);
        if (mean.length > 0) vectors.set(id, mean);
      }
      const authorMap = new Map<string, string>(Object.entries(authors));
      return { items, vectors, authors: authorMap };
    },
    findGroups: findSimilarGroups,
    merge: (targetId, victimIds, patch) =>
      mergeItems(targetId, victimIds, {
        note: patch.note,
        favorite: patch.favorite,
        title: patch.title,
        thumbnail: patch.thumbnail,
        created_at: patch.created_at,
      }),
    refresh: refreshItemIndex,
  };
}
