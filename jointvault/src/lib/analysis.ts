/*
 * İçerik analizi orkestrasyonu: Rust `analyze_media` komutunu çağırır, dönen
 * JSON'u domain alanlarına eşler, taksonomiyi normalize eder, `item_analysis`'e
 * yazar ve arama indeksini tazeler.
 *
 * Rust ağır işi (transkript + LLM) yapar ve DB'ye DOKUNMAZ; kalıcılık/uygulama
 * burada, TS tarafındadır. AI kapalı ya da dosya yoksa fail-closed: yalnızca
 * `{ ok:false, error }` döner, fırlatmaz.
 */
import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { applyCategorization, getAiStatus, isAiEnabled, readTagThreshold, refreshItemIndex } from './ai';
import { getItem, listCategories, listTags } from './db/client';
import {
  getItemAnalysis,
  listItemIdsNeedingAnalysis,
  setItemAnalysisStatus,
  upsertItemAnalysis,
} from './db/item_analysis';
import type { ItemAnalysis, RecipeText } from './db/types';
import { resolveCategories, resolveTags } from './taxonomy';

/** Rust `analyze_media` dönen JSON'un şekli (serde PascalCase değil, snake_case). */
export interface AnalyzeResponse {
  analysis: {
    contains_recipe: boolean;
    confidence: number;
    language: string | null;
    title: string | null;
    summary: string;
    topics: string[];
    keywords: string[];
    recipe: RecipeText | null;
  };
  transcript_source: string;
  transcript_path: string;
  model_versions: Record<string, string>;
  /** Aşama zamanlaması (ms) — tanı için; Rust `analyze_media` üretir. */
  timings_ms?: {
    chat_ready: number;
    transcript: number;
    extract: number;
    total: number;
  };
}

export interface AnalyzeResult {
  ok: boolean;
  error?: string;
  partial?: boolean;
  /** Bu çağrıya ait iş kimliği (çağıran ürettiyse aynen geri döner). */
  jobId?: string;
}

export interface AnalyzeProgressEvent {
  jobId: string;
  stage: 'transcript' | 'extract';
  percent: number;
}

/**
 * Analiz atlanmalı mı? SAF.
 *
 * `done`/`partial` başarılı sonuçlardır; `force` olmadan yeniden çalıştırılmaz.
 * `error`/`running`/kayıt yok → yeniden denenir (yeni çağrı işi devralır).
 */
export function shouldSkipAnalysis(existing: { status: string } | null, force: boolean): boolean {
  if (force || !existing) return false;
  return existing.status === 'done' || existing.status === 'partial';
}

/**
 * Tarif kartı gösterilsin mi? SAF (gösterim kararı; sonuç her zaman saklanır).
 *
 * `contains_recipe` VE tespit edilen tarif VE `confidence ≥ 0.6` gerekir;
 * `confidence` null → eşik altı sayılır.
 */
export function shouldShowRecipe(
  analysis: Pick<ItemAnalysis, 'contains_recipe' | 'confidence' | 'recipe'> | null,
): boolean {
  if (!analysis || !analysis.recipe) return false;
  return analysis.contains_recipe === true && (analysis.confidence ?? 0) >= 0.6;
}

/**
 * LLM çıktısını taksonomiye bağlar: topic → kategoriler (eşik + `maxNew`),
 * keyword → etiketler (`max`). SAF (DB/ağ yok). `analyzeItem` bunu kullanır.
 */
export function resolveAnalysisTaxonomy(
  topics: string[],
  keywords: string[],
  existingCats: string[],
  existingTags: string[],
  confidence: number,
  minConfidence: number,
): { categories: string[]; tags: string[] } {
  const categories = resolveCategories(topics, existingCats, {
    confidence,
    minConfidence,
    maxNew: 1,
    // Kayıt tek çocuk kategoriye bağlanır (iki seviyeli taksonomi).
    maxTotal: 1,
  }).names;
  // Etiket son tercihtir: güven eşiğini geçse bile yeni etiket gerekçesiz
  // kabul edilmez. Anahtar kelimelerden türetilen adlar çoğunlukla mevcut
  // listede zaten vardır.
  const tags = resolveTags(keywords, existingTags, {
    max: 12,
    minConfidence,
    confidence,
  });
  return { categories, tags };
}

/** Rust yanıtını domain alanlarına eşler. SAF (Rust alan adları zaten hizalı). */
export function mapAnalysisResponse(resp: AnalyzeResponse): {
  contains_recipe: boolean;
  confidence: number;
  language: string | null;
  summary: string;
  recipe: RecipeText | null;
  topics: string[];
  keywords: string[];
  transcript_source: string;
  transcript_path: string;
  model_versions: Record<string, string>;
} {
  const a = resp.analysis;
  return {
    contains_recipe: a.contains_recipe,
    confidence: a.confidence,
    language: a.language,
    summary: a.summary,
    recipe: a.recipe,
    topics: a.topics,
    keywords: a.keywords,
    transcript_source: resp.transcript_source,
    transcript_path: resp.transcript_path,
    model_versions: resp.model_versions,
  };
}

/**
 * Tek öğeyi analiz et. Idempotent: `done`/`partial` sonuç `force` olmadan
 * atlanır. Hata durumunda `status:'error'` yazılır ve `{ ok:false }` döner.
 */
export async function analyzeItem(
  itemId: string,
  opts?: { force?: boolean; jobId?: string },
): Promise<AnalyzeResult> {
  const force = opts?.force ?? false;

  const aiStatus = await getAiStatus();
  if (!isAiEnabled(aiStatus)) {
    return { ok: false, error: 'Yapay zeka kapalı. Ayarlar → Yapay Zeka.' };
  }

  const existing = await getItemAnalysis(itemId);
  if (shouldSkipAnalysis(existing, force)) return { ok: true };

  const item = await getItem(itemId);
  if (!item?.local_path) {
    return { ok: false, error: 'İndirilmiş dosya yok.' };
  }

  // upsertItemAnalysis tam kayıt bekler; varsayılanları bir kez kur, alanları ez.
  const base: Parameters<typeof upsertItemAnalysis>[0] = {
    item_id: itemId,
    status: 'pending',
    contains_recipe: null,
    confidence: null,
    language: null,
    summary: null,
    recipe: null,
    topics: [],
    keywords: [],
    visual_notes: null,
    transcript_source: null,
    transcript_path: null,
    model_versions: null,
    error_message: null,
    analyzed_at: null,
  };

  const jobId = opts?.jobId ?? crypto.randomUUID();
  try {
    await setItemAnalysisStatus(itemId, 'running');

    const raw = await invoke<string>('analyze_media', {
      payload: {
        item_id: itemId,
        input_path: item.local_path,
        url: item.url,
        title: item.title,
        platform: item.platform,
        language: 'auto',
        job_id: jobId,
      },
    });
    const resp = JSON.parse(raw) as AnalyzeResponse;
    if (resp.timings_ms) {
      // Aşama süreleri (tanı): devtools konsolunda görünür.
      console.debug('[analyze] timings_ms', resp.timings_ms);
    }
    const m = mapAnalysisResponse(resp);

    const [allCats, allTags] = await Promise.all([listCategories(), listTags()]);
    const { categories, tags } = resolveAnalysisTaxonomy(
      m.topics,
      m.keywords,
      allCats.map((c) => c.name),
      allTags.map((t) => t.name),
      m.confidence,
      readTagThreshold(),
    );

    await upsertItemAnalysis({
      ...base,
      status: 'done',
      contains_recipe: m.contains_recipe,
      confidence: m.confidence,
      language: m.language,
      summary: m.summary,
      recipe: m.recipe,
      // Ham LLM değerleri (denetim/çip); uygulanan taksonomi `categories`/`tags`.
      topics: m.topics,
      keywords: m.keywords,
      transcript_source: m.transcript_source,
      transcript_path: m.transcript_path,
      model_versions: m.model_versions,
      analyzed_at: new Date().toISOString(),
    });

    // Yan etkiler `done` satırı yazıldıktan SONRA çalışır: buradaki bir hata
    // (taksonomi/indeks yazımı) pahalı analizi ASLA ezmez. Başarısızlık
    // yutulur; analiz yine `ok:true` döner.
    if (aiStatus.auto_apply_tags && (categories.length > 0 || tags.length > 0)) {
      await applyCategorization(itemId, categories, tags).catch(() => {});
    }
    await refreshItemIndex(itemId).catch(() => {});
    return { ok: true, partial: false, jobId };
  } catch (err) {
    const message =
      typeof err === 'string' ? err : err instanceof Error ? err.message : 'Analiz başarısız.';
    // Hata durumunu yaz; bu yazının kendisi patlarsa çağıranı yine de kırmayız.
    // Kısmi yazım: önceki iyi sonuç (özet/tarif/topik/keyword) KORUNUR.
    await setItemAnalysisStatus(itemId, 'error', message).catch(() => {});
    return { ok: false, error: message, jobId };
  }
}

/** Toplu analiz sonucu sınıfları. */
export type BatchOutcome = 'processed' | 'failed' | 'skipped';

/** Sonuç dizisini sayar. SAF. */
export function summarizeBatch(outcomes: BatchOutcome[]): {
  processed: number;
  failed: number;
  skipped: number;
} {
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  for (const o of outcomes) {
    if (o === 'processed') processed++;
    else if (o === 'failed') failed++;
    else skipped++;
  }
  return { processed, failed, skipped };
}

/**
 * Analiz bekleyen TÜM indirilmiş kayıtları SERİ olarak analiz eder.
 *
 * `listItemIdsNeedingAnalysis()` kuyruğu tek turda alınır; kuyruk ilerledikçe
 * yeniden keşfedilmez. Her öğenin başında `signal?.aborted` kontrol edilir:
 * iptal, devam eden `analyzeItem` bitince (asenkron sınır) durur. Zaten
 * `done`/`partial` olan öğeler yeniden denenmez, `skipped` sayılır.
 */
export async function analyzeMissing(
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ processed: number; failed: number; skipped: number }> {
  const ids = await listItemIdsNeedingAnalysis();
  const outcomes: BatchOutcome[] = [];

  for (const id of ids) {
    if (signal?.aborted) break;

    const existing = await getItemAnalysis(id);
    if (shouldSkipAnalysis(existing, false)) {
      outcomes.push('skipped');
      onProgress?.(outcomes.length, ids.length);
      continue;
    }

    const res = await analyzeItem(id);
    outcomes.push(res.ok ? 'processed' : 'failed');
    onProgress?.(outcomes.length, ids.length);
  }

  return summarizeBatch(outcomes);
}

/** Tek `analyze-progress` aboneliği; unmount'ta dinleyiciyi bırakır. */
export function useAnalyzeProgress(onEvent: (e: AnalyzeProgressEvent) => void): void {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    void listen<AnalyzeProgressEvent>('analyze-progress', (event) => {
      ref.current(event.payload);
    }).then((u) => {
      if (live) unlisten = u;
      else u();
    });
    return () => {
      live = false;
      unlisten?.();
    };
  }, []);
}
