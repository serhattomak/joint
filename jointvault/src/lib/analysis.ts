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
import { getItemAnalysis, upsertItemAnalysis } from './db/item_analysis';
import type { RecipeText } from './db/types';
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
}

export interface AnalyzeResult {
  ok: boolean;
  error?: string;
  partial?: boolean;
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
  opts?: { force?: boolean },
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

  const jobId = crypto.randomUUID();
  try {
    await upsertItemAnalysis({ ...base, status: 'running' });

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
    const m = mapAnalysisResponse(resp);

    const [allCats, allTags] = await Promise.all([listCategories(), listTags()]);
    const cats = resolveCategories(
      m.topics,
      allCats.map((c) => c.name),
      { confidence: m.confidence, minConfidence: readTagThreshold(), maxNew: 1 },
    );
    const tags = resolveTags(
      m.keywords,
      allTags.map((t) => t.name),
      { max: 12 },
    );

    await upsertItemAnalysis({
      ...base,
      status: 'done',
      contains_recipe: m.contains_recipe,
      confidence: m.confidence,
      language: m.language,
      summary: m.summary,
      recipe: m.recipe,
      // Ham LLM değerleri (denetim/çip); uygulanan taksonomi `cats.names`/`tags`.
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
    if (aiStatus.auto_apply_tags && (cats.names.length > 0 || tags.length > 0)) {
      await applyCategorization(itemId, cats.names, tags).catch(() => {});
    }
    await refreshItemIndex(itemId).catch(() => {});
    return { ok: true, partial: false };
  } catch (err) {
    const message =
      typeof err === 'string' ? err : err instanceof Error ? err.message : 'Analiz başarısız.';
    // Hata durumunu yaz; bu yazının kendisi patlarsa çağıranı yine de kırmayız.
    await upsertItemAnalysis({ ...base, status: 'error', error_message: message }).catch(() => {});
    return { ok: false, error: message };
  }
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
