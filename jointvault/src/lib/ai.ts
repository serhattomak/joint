/**
 * JointVault Yerel AI İstemci Kütüphanesi.
 *
 * Seçili sohbet modeli (3B/7B/14B) ve BGE-M3 modelleriyle iletişim,
 * Tauri IPC çağrıları, streaming sohbet, indeksleme ve RAG asistan hattı.
 */

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  buildItemChunks,
  packEmbeddingRows,
  parseSrt,
  type ItemChunk,
} from './chunker';
import { useComponentDownloadProgress } from './components';
import {
  getAllCategoriesByItem,
  getAllTagsByItem,
  getArticleForItem,
  getCategoriesForItem,
  getChunksMissingEmbeddings,
  getDb,
  getItem,
  getOrCreateCategory,
  getOrCreateTag,
  getTagsForItem,
  listCategories,
  listItems,
  listTags,
  mergeCategories,
  saveItemChunks,
  searchHybridChunks,
  setCategoriesForItem,
  setChunkEmbeddingsBatch,
  setTagsForItem,
} from './db/client';
import type { Category, HybridSearchResult, Item } from './db/types';
import { buildCategoryDigest } from './notebook';
import { invalidateVectorIndex } from './vector-cache';
import {
  matchTaxonomyInText,
  normalizeKey,
  normalizeLlmSuggestion,
  resolveCategories,
  resolveTags,
  shouldAutoApply,
  validNewCategory,
} from './taxonomy';
import {
  categoryPathOf,
  mergeContextLines,
  parseMergeSuggestions,
  parseRestructPlan,
  type RestructMove,
  type RestructPlan,
  validateMergeGroups,
} from './taxonomy-maintenance';
import { indentedTaxonomyTree } from './taxonomy-view';
import {
  buildHistoryWindow,
  mergeQueryPayload,
  parseAssistantMessage,
  type HistoryMessage,
} from './ai-chat';
import {
  buildVaultSummary,
  detectStructuralIntent,
  executeVaultQuery,
  formatQueryResult,
  loadTaxonomy,
  normalizeVaultQuery,
  type VaultQueryItem,
} from './ai-context';

/** GPU tespitinin kaynağı (`hardware.rs` → `GpuSource` serde adlarıyla birebir). */
export type AiGpuSource = 'nvidia-smi' | 'wmi' | 'unknown';

/**
 * Tespit edilen GPU.
 *
 * `null` alanlar "bilinmiyor" demektir; uydurma değer YOKTUR. WMI yalnızca ad
 * verir, VRAM yalnızca `nvidia-smi`'den gelir — bu yüzden ikisi bağımsız null
 * olabilir.
 */
export interface AiGpuInfo {
  name: string | null;
  vram_mb: number | null;
  source: AiGpuSource;
}

/** Offload modu: `gpu` = tüm katmanlar GPU'da, `cpu` = model CPU'da. */
export type AiOffloadMode = 'gpu' | 'cpu';

/**
 * Backend'in verdiği offload kararı ve gerekçesi.
 *
 * Karar Rust'ta SAF bir fonksiyondan gelir (`decide_offload`); arayüz yalnızca
 * GÖSTERİR, yeniden hesaplamaz. Böylece "neden GPU/CPU?" sorusunun tek kaynağı
 * kalır ve iki taraf ayrışamaz.
 */
export interface AiOffloadDecision {
  mode: AiOffloadMode;
  /** GPU'ya yüklenecek katman sayısı; `99` "hepsi" işaretidir. */
  n_gpu_layers: number;
  /** Kullanıcıya gösterilebilir Türkçe gerekçe. */
  reason: string;
  gpu_name: string | null;
  vram_mb: number | null;
  /** Kararda kullanılan model dosya boyutu (MiB); `null` = okunamadı. */
  model_mb: number | null;
}

export interface AiStatus {
  engine_available: boolean;
  engine_path: string | null;
  llm_ready: boolean;
  llm_path: string | null;
  embed_ready: boolean;
  embed_path: string | null;
  chat_server_running: boolean;
  embed_server_running: boolean;
  external_api_url: string | null;
  auto_warmup?: boolean;
  idle_timeout_secs?: number;
  temperature?: number;
  auto_apply_tags?: boolean;
  /*
   * Aşağıdaki alanlar YALNIZCA EK'tir: mevcut anahtarların adı/şekli
   * değişmedi, bu yüzden ~10 tüketici etkilenmez.
   *
   * OPSİYONEL tutulurlar: 01–04'ten önceki bir backend bunları hiç döndürmez
   * ve eksiklikleri kırılmaya değil "kapalı" hükmüne düşmelidir
   * (bkz. `isAiEnabled`).
   */
  /** AI açık mı? Etkinliğin TEK yetkili kararı backend'dedir. */
  ai_enabled?: boolean;
  /** Donanım tespiti; eski backend'de yoktur. */
  gpu?: AiGpuInfo;
  /** Offload kararı/gerekçesi; eski backend'de yoktur. */
  offload?: AiOffloadDecision;
  /**
   * Toplam sistem RAM'i (MiB); tespit başarısızsa `null`. Sihirbazın donanıma
   * göre model önerisi bunu kullanır. Eski backend bu alanı hiç döndürmez —
   * yokluk "bilinmiyor" sayılır, uydurma sayı yazılmaz.
   */
  ram_mb?: number | null;
  /**
   * Seçili sohbet modeli sha256 pinli KAYITLI bir model mi? `false` → kullanıcının
   * diskten seçtiği serbest `.gguf` ("doğrulanmadı"). Eski backend bu alanı
   * döndürmez; yokluk "doğrulanmadı" sayılmalıdır (fail-closed, `isAiEnabled`
   * deseniyle aynı: şüpheli durum kapalı/güvensiz kabul edilir).
   */
  llm_verified?: boolean;
  /** Seçili sohbet modelinin gösterilecek adı (kayıt etiketi ya da dosya adı). */
  llm_label?: string | null;
}

export interface AiConfig {
  /*
   * ANA anahtar: yerel AI açık mı? (`ai_save_config` bunu `enabled` olarak
   * kalıcı yazar.) Opsiyoneldir çünkü `saveAiConfig` yalnızca değişen alanları
   * taşır; kullanıcının AÇIK seçimi backend'de göç kuralı tarafından ezilmez.
   */
  enabled?: boolean;
  llm_path: string | null;
  embed_path: string | null;
  engine_path: string | null;
  external_api_url: string | null;
  idle_timeout_secs: number | null;
  auto_warmup?: boolean;
  temperature?: number;
  auto_apply_tags?: boolean;
}

export interface CategorizeAndTagResult {
  categories: string[];
  tags: string[];
  summary: string;
  confidence: number;
  /** Önerinin kaynağı: deterministik eşleşme / LLM / ikisi / hiçbiri. */
  source: 'deterministic' | 'llm' | 'both' | 'none';
  /** LLM'in önerdiği yeni hiyerarşi (güven eşiğini geçtiyse). */
  newCategory?: { parent: string; child: string } | null;
}

export const TAG_THRESHOLD_KEY = 'jv-ai-tag-threshold';

/** Ayarlardan güven eşiği (yoksa 0.6). */
export function readTagThreshold(): number {
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(TAG_THRESHOLD_KEY) : null;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.6;
}

export interface AiWarmupStatus {
  status: 'idle' | 'loading' | 'ready' | 'error';
  message: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function getAiStatus(): Promise<AiStatus> {
  return invoke<AiStatus>('ai_status');
}

/**
 * "AI açık mı?" sorusunun TEK karar noktası.
 *
 * NEDEN FAIL-CLOSED? `ai_enabled` iken backend ~9 GB'lık model süreçlerini
 * başlatabilir. Bu yüzden ŞÜPHELİ her durum kapalı sayılır: alan eksikse (eski
 * backend ya da durum henüz yüklenmediyse), ya da `null`/`0`/`"true"` gibi
 * boolean olmayan bir değer gelirse sonuç `false`'tur. Kabul yalnızca açık
 * `true`'dur.
 *
 * `Boolean(status.ai_enabled)` gibi truthiness kontrolü YETMEZ: `"false"`
 * dizesini bile açık sayar ve istenmeyen süreç başlatma yolu açılır. Ekranlar
 * kendi kontrolünü kurmamalı; hepsi burayı çağırır ki kural tek yerde kalsın.
 */
export function isAiEnabled(
  status: { ai_enabled?: unknown } | null | undefined,
): boolean {
  return status?.ai_enabled === true;
}

export async function warmupAi(): Promise<void> {
  await invoke('ai_warmup');
}

export function useAiWarmupStatus(): AiWarmupStatus {
  const [warmup, setWarmup] = useState<AiWarmupStatus>({ status: 'idle', message: '' });

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<AiWarmupStatus>('ai-warmup-status', (e) => {
      setWarmup(e.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((error: unknown) => {
        console.warn('[ai-warmup-status] dinleyici kurulamadı', error);
      });
    return () => {
      unlisten?.();
    };
  }, []);

  return warmup;
}

/**
 * AI yapılandırmasını kaydeder.
 *
 * `Partial<AiConfig>` olduğundan çağıran yalnızca değiştirdiği alanları
 * gönderir; `enabled` da bu yolla taşınır ve backend'de kalıcı yazılır. Giden
 * gövde AYNEN iletildiği için mevcut çağrıların davranışı değişmez.
 */
export async function saveAiConfig(config: Partial<AiConfig>): Promise<void> {
  await invoke('ai_save_config', { payload: config });
}

export async function stopAiServer(): Promise<void> {
  await invoke('ai_stop_server');
}

export async function downloadAiEngine(jobId: string): Promise<string> {
  return invoke<string>('ai_download_engine', { payload: { job_id: jobId } });
}

export async function downloadAiModel(modelType: 'llm' | 'embed', jobId: string): Promise<string> {
  return invoke<string>('ai_download_model', {
    payload: { model_type: modelType, job_id: jobId },
  });
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  return invoke<number[][]>('ai_embed', { payload: { texts } });
}

export async function suggestTags(itemText: string, existingTags: string[]): Promise<string[]> {
  return invoke<string[]>('ai_suggest_tags', {
    payload: { item_text: itemText, existing_tags: existingTags },
  });
}

export async function summarizeText(text: string): Promise<string> {
  return invoke<string>('ai_summarize', { payload: { text } });
}

/**
 * Defter sayfa özeti: kategori kayıtlarının tam metinlerinden malzeme kur
 * (buildCategoryDigest, 8000 karakter), llama-server'a tek istemle gönder.
 * İstem copy sabittir — spec tek kaynaktır.
 */
export async function summarizeCategory(categoryName: string, texts: string[]): Promise<string> {
  const digest = buildCategoryDigest(texts);
  return summarizeText(
    `Aşağıdaki kayıtların ortak malzemesini 300-600 kelime Türkçe özetle; kaynak linki yazma. Kategori: ${categoryName}\n\n${digest}`,
  );
}

/**
 * Qwen 2.5 ile streaming sohbet.
 * Gelen her token onToken geri çağrısına iletilir.
 */
export async function streamAiChat(
  jobId: string,
  messages: ChatMessage[],
  systemPrompt?: string,
  onToken?: (token: string) => void,
): Promise<string> {
  let unlistenToken: UnlistenFn | null = null;

  try {
    if (onToken) {
      unlistenToken = await listen<{ job_id: string; token: string }>('ai-chat-token', (event) => {
        if (event.payload.job_id === jobId) {
          onToken(event.payload.token);
        }
      });
    }

    const res = await invoke<string>('ai_chat_stream', {
      payload: {
        job_id: jobId,
        messages,
        system_prompt: systemPrompt,
      },
    });

    return res;
  } finally {
    if (unlistenToken) unlistenToken();
  }
}

// --- Hooks: İlerleme Dinleyicileri ---
//
// İndirmeler tek olay yayar: `component-download-progress` (paylaşılan motor).
// Kanonik abonelik `components.ts`'te yaşar; buradaki sarmalayıcı yalnızca
// çağıranın `jobId`'sine süzer ve yüzdeyi döndürür.

function useComponentDownloadPercent(jobId: string | null): number | null {
  const [progress, setProgress] = useState<{ jobId: string; percent: number } | null>(null);

  // Kanonik kanca callback'i her render'da tazeler; bu yüzden closure'daki
  // `jobId` günceldir, ayrı bir ref gerekmez.
  useComponentDownloadProgress((event) => {
    if (jobId && event.jobId === jobId) setProgress({ jobId, percent: event.percent });
  });

  // Yüzde YALNIZCA istenen işe aitse döner: yeni işe geçince eski yüzde
  // kendiliğinden düşer, effect içinde setState gerekmez.
  if (!jobId || !progress || progress.jobId !== jobId) return null;
  return progress.percent;
}

export function useAiEngineProgress(jobId: string | null): number | null {
  return useComponentDownloadPercent(jobId);
}

export function useAiModelProgress(jobId: string | null): number | null {
  return useComponentDownloadPercent(jobId);
}

// --- İndeksleme ve Vektörleme Hattı ---

/** Chunk'ları yazar ve (motor hazırsa) TOPLU embedding üretir; önbelleği düşürür. */
async function embedAndSaveChunks(itemId: string, chunks: ItemChunk[]): Promise<void> {
  await saveItemChunks(itemId, chunks);
  invalidateVectorIndex();
  if (chunks.length === 0) return;

  try {
    const status = await getAiStatus();
    // `ai_enabled` ŞART: AI kapalıyken vektörleme denenmez (sessiz başarısızlık).
    if (isAiEnabled(status) && status.embed_ready && status.engine_available) {
      // Büyük öğede tek dev istek yerine partiler (60 sn timeout riskini böler).
      const EMBED_BATCH = 32;
      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const slice = chunks.slice(i, i + EMBED_BATCH);
        const embeddings = await generateEmbeddings(slice.map((c) => c.chunkText));
        await setChunkEmbeddingsBatch(packEmbeddingRows(slice.map((c) => c.id), embeddings));
      }
    }
  } catch {
    // Motor hazır değilse metin indeksli kalır; embedding sonra tamamlanır.
  }
}

/** Öğenin SRT metnini diskten okur (yoksa null). */
async function readSrtForItem(item: Item): Promise<string | null> {
  if (!item.local_path) return null;
  try {
    const srtPath = item.local_path.replace(/\.[^/.\\]+$/, '-transkript.srt');
    const content = await invoke<string>('preview_media_read_text', { path: srtPath }).catch(
      () => null,
    );
    return content || null;
  } catch {
    return null;
  }
}

/**
 * Bir öğenin TÜM chunk türlerini (meta + not + transcript + makale) tazeler ve
 * vektörler. İçerik/taksonomi değiştiğinde çağrılır.
 */
export async function refreshItemIndex(itemId: string): Promise<void> {
  const item = await getItem(itemId);
  if (!item) return;

  const [tags, categories, article, srt] = await Promise.all([
    getTagsForItem(itemId),
    getCategoriesForItem(itemId),
    getArticleForItem(itemId),
    readSrtForItem(item),
  ]);

  const chunks = buildItemChunks(itemId, {
    title: item.title,
    platform: item.platform,
    note: item.note,
    tags: tags.map((t) => t.name),
    categories: categories.map((c) => c.name),
    srt,
    article: article?.content_text ?? null,
  });
  await embedAndSaveChunks(itemId, chunks);
}

/**
 * Tek bir öğeyi ve varsa transkriptini chunk'lara böler ve SQLite'a kaydeder.
 * (Geri uyum: birleşik üretim; srt dışarıdan verilebilir.)
 */
export async function indexItemChunks(
  item: Item,
  tags: string[] = [],
  srtContent?: string | null,
): Promise<void> {
  const [categories, article, diskSrt] = await Promise.all([
    getCategoriesForItem(item.id),
    getArticleForItem(item.id),
    srtContent ? Promise.resolve(null) : readSrtForItem(item),
  ]);

  const chunks = buildItemChunks(item.id, {
    title: item.title,
    platform: item.platform,
    note: item.note,
    tags,
    categories: categories.map((c) => c.name),
    srt: srtContent ?? diskSrt,
    article: article?.content_text ?? null,
  });
  await embedAndSaveChunks(item.id, chunks);
}

/**
 * Eksik embedding'i olan chunk'ları TOPLU olarak BGE-M3 ile vektörleştirir.
 */
export async function indexMissingEmbeddings(
  onProgress?: (done: number, total: number) => void,
): Promise<{ processed: number }> {
  let processed = 0;
  const BATCH_SIZE = 32;

  // Kullanıcı "yeniden indeksle"yi açıkça istedi: AI kapalıysa net bir hata ver.
  const gate = await getAiStatus();
  if (!isAiEnabled(gate)) {
    throw new Error('AI kapalı — Ayarlar → AI bölümünden açabilirsiniz.');
  }

  while (true) {
    const missing = await getChunksMissingEmbeddings(BATCH_SIZE);
    if (missing.length === 0) break;

    let embeddings: number[][];
    try {
      embeddings = await generateEmbeddings(missing.map((m) => m.chunk_text));
    } catch (err) {
      // ponytail: bir parti hatası tüm işi çökertmez; kalanlar bir sonraki
      // taramada tamamlanır. Sonsuz döngüyü önlemek için burada dururuz.
      console.warn('[ai] embedding partisi başarısız, kalanlar atlandı', err);
      break;
    }

    const rows = packEmbeddingRows(missing.map((m) => m.id), embeddings);
    await setChunkEmbeddingsBatch(rows);
    processed += rows.length;
    if (onProgress) onProgress(processed, processed + missing.length);
    if (rows.length === 0) break; // ilerleme yoksa sonsuz döngüye girme
  }

  return { processed };
}

/**
 * Arşivdeki tüm kayıtları baştan indeksler (iki faz: içerik kurulumu + vektörleme).
 */
export async function reindexVault(
  onProgress?: (current: number, total: number, phase: 'content' | 'vectors') => void,
): Promise<void> {
  // AI/model hazır değilse baştan dur: aksi hâlde chunk'lar embedding'siz kalır.
  const gate = await getAiStatus();
  if (!isAiEnabled(gate) || !gate.embed_ready || !gate.engine_available) {
    throw new Error('AI hazır değil — vektörleme motoru ve BGE-M3 modeli gerekli.');
  }

  const db = await getDb();

  const items = await listItems();
  const [allTags, allCategories] = await Promise.all([
    getAllTagsByItem(),
    getAllCategoriesByItem(),
  ]);
  const total = items.length;

  // Faz 1: içerik kurulumu (öğe bazlı ilerleme) — meta+not+transcript+makale birlikte.
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const tags = (allTags[it.id] ?? []).map((t) => t.name);
    const categories = (allCategories[it.id] ?? []).map((c) => c.name);
    const [article, srt] = await Promise.all([getArticleForItem(it.id), readSrtForItem(it)]);

    const chunks = buildItemChunks(it.id, {
      title: it.title,
      platform: it.platform,
      note: it.note,
      tags,
      categories,
      srt,
      article: article?.content_text ?? null,
    });
    await saveItemChunks(it.id, chunks);
    if (onProgress) onProgress(i + 1, total, 'content');
  }

  // Silinmiş öğelerin chunk'larını temizle. Global silme YOK: her öğe kendi
  // chunk'larını değiştirdi; tur yarıda kalırsa diğerlerinin indeksi korunur.
  await db.execute('DELETE FROM item_chunks WHERE item_id NOT IN (SELECT id FROM items)');
  try {
    await db.execute('DELETE FROM item_chunks_fts WHERE item_id NOT IN (SELECT id FROM items)');
  } catch {
    // ignore
  }
  invalidateVectorIndex();

  // Faz 2: vektörleme (chunk bazlı ilerleme) — toplu.
  await indexMissingEmbeddings((c, t) => onProgress?.(c, t, 'vectors'));
}

// --- RAG Hattı: 'Asistan' ---

const FENCE = '```';

/**
 * Modelin yapısal sorgu üretmesini sağlayan sözleşme. Örnek blok, mevcut
 * `action:tag` deseniyle aynı ailedendir; `ai-chat.ts` ayrıştırır.
 */
const VAULT_QUERY_CONTRACT = [
  'YAPISAL SORGU: Yanıtlamak için arşivden yapısal veri (filtre, liste, sayım; ör. "kaç favorim var", "Rust etiketli YouTube kayıtları", "son 30 gün") gerekiyorsa, SADECE şu bloğu yaz ve başka hiçbir şey yazma:',
  `${FENCE}action:query`,
  '{ "filters": { "platform": "youtube", "tag": "rust", "favorite": true, "sinceDays": 30, "query": "async", "sort": "new" }, "limit": 20, "countOnly": false }',
  FENCE,
  'Gerekmiyorsa normal, doğal yanıt ver. Uydurma; yalnızca verilen KAYNAKLAR ve sorgu sonuçlarına dayan.',
].join('\n');

/** "Yalnızca kaynaklar" kuralını sayı/liste sorularında ezen açık uyarı. */
const PRIORITY_RULES = [
  'ÖNCELİK (aşağıdaki tüm kuralların üstünde):',
  '1. ARŞİV ÖZETİ ve YAPISAL SONUÇ KESİN veridir; sayı/adet/liste/filtre sorularında tek doğru kaynak bunlardır.',
  '2. "Kesin sayı veremem", "filtreleme yapılmadı", "kaynaklarda yok" gibi kaçamak yanıt YASAK; sayı varsa doğrudan söyle.',
  '3. KAYNAKLAR içerik parçalarıdır; içindeki parça sayısı (ör. 5) KAYIT SAYISI DEĞİLDİR.',
].join('\n');

export interface RagResult {
  answer: string;
  references: HybridSearchResult[];
  queryItems?: VaultQueryItem[];
}

export interface AskVaultOptions {
  history?: ChatMessage[];
  onToken?: (token: string) => void;
  onStatus?: (status: 'streaming' | 'querying') => void;
}

/**
 * Arşivde soru aratıp transkript/not bağlamıyla Qwen 2.5'ten kaynaklı yanıt üretir.
 */
export async function askVault(
  query: string,
  opts: AskVaultOptions = {},
): Promise<RagResult> {
  const status = await getAiStatus();
  // Sıra önemli: önce "AI açık mı", sonra "bileşenler hazır mı". Kapalı bir
  // kurulumda "motor kurulu değil" demek yanıltıcı olurdu (motor kurulu olabilir).
  if (!isAiEnabled(status)) {
    throw new Error('AI kapalı — Ayarlar → AI bölümünden açabilirsiniz.');
  }
  if (!status.engine_available) {
    throw new Error('AI motoru (llama-server) kurulu değil. Lütfen Ayarlar > Yapay Zekâ sekmesinden kur.');
  }
  if (!status.llm_ready) {
    throw new Error('Seçili sohbet modeli hazır değil. Lütfen Ayarlar > Yapay Zekâ sekmesinden indir veya seç.');
  }

  // 1. Sorunun embedding'ini al (AI açık VE BGE-M3 hazırsa)
  let queryEmbedding: number[] | null = null;
  if (isAiEnabled(status) && status.embed_ready) {
    try {
      const embeds = await generateEmbeddings([query]);
      if (embeds.length > 0) queryEmbedding = embeds[0];
    } catch {
      // ignore
    }
  }

  // 2. Hibrit arama yap (en alakalı 5 chunk)
  const references = await searchHybridChunks(query, queryEmbedding, 5);

  // 2b. Hafif arşiv özeti (yapısal gerçek; sayım/filtre soruları için)
  let vaultSummary = '';
  try {
    vaultSummary = await buildVaultSummary();
  } catch {
    vaultSummary = '';
  }

  // 2c. Yapısal niyeti DETERMİNİSTİK çöz ve modelden ÖNCE çalıştır. Küçük
  //     modeller `action:query` üretmediğinde bile sayı/liste soruları doğru yanıtlanır.
  let structuredBlock = '';
  let queryItems: VaultQueryItem[] | undefined;
  try {
    const intent = detectStructuralIntent(query, await loadTaxonomy());
    if (intent) {
      const result = await executeVaultQuery(intent);
      queryItems = result.items;
      structuredBlock = formatQueryResult(intent, result);
    }
  } catch {
    structuredBlock = '';
  }

  // 3. Kontekst metnini oluştur
  let contextText = '';
  if (references.length > 0) {
    contextText = references
      .map((r, i) => {
        const itemTitle = r.item.title || r.item.url;
        const timeInfo =
          r.chunk.start_seconds !== null
            ? ` [${Math.floor(r.chunk.start_seconds)}s - ${Math.floor(r.chunk.end_seconds || 0)}s]`
            : '';
        return `[Kaynak ${i + 1} (ID: ${r.item.id}): ${itemTitle}${timeInfo}]\n${r.chunk.chunk_text}`;
      })
      .join('\n\n---\n\n');
  } else {
    contextText = 'Arşivde bu soruyla doğrudan eşleşen bir transkript veya not bulunamadı.';
  }

  const systemPrompt = `Sen JointVault kişisel medya arşivinin zeki Türkçe asistanısın.\n\
Kullanıcının sorularına, aşağıda arşivden çekilen transkript ve not parçalarını (KAYNAKLAR) kullanarak yanıt ver.\n\
KURALLAR:\n\
1. SADECE verilen KAYNAKLAR ile üstteki ARŞİV ÖZETİ/YAPISAL SONUÇ bloklarına dayan; bunların dışında hiçbir şey uydurma. Sayı, adet ve liste sorularında ARŞİV ÖZETİ ve YAPISAL SONUÇ KESİNDİR; "kesin sayı veremem" deme.\n\
2. Bilgi aldığın kaynakları parantez içinde belirt (örn: "[Kaynak 1]").\n\
3. Eğer transkriptte geçen bir zamandan bahsediyorsan saniyesini de yaz (örn: "01:25 saniyesinde...").\n\
4. Samimi, teknik ve doğrudan bir dille yanıt ver.\n\
5. KATEGORİLEME / ETİKETLEME EYLEMLERİ: Kullanıcı bir içeriğe etiket/kategori eklemeni isterse veya sen bir içerik için etiket öneriyorsan, yanıtının en sonuna şu formatta bir eylem bloğu ekle:\n\
\`\`\`action:tag\n\
{\n\
  "itemId": "kaynaktaki-item-id",\n\
  "itemTitle": "başlık",\n\
  "categories": ["Kategori"],\n\
  "tags": ["etiket1", "etiket2"]\n\
}\n\
\`\`\`\n\n\
KAYNAKLAR:\n${contextText}`;

  const structuredSection = structuredBlock ? `\n\nYAPISAL SONUÇ:\n${structuredBlock}` : '';
  const fullSystemPrompt = `${PRIORITY_RULES}\n\n${systemPrompt}\n\nARŞİV ÖZETİ:\n${vaultSummary}${structuredSection}\n\n${VAULT_QUERY_CONTRACT}`;

  // Geçmiş, karakter bütçesiyle kırpılır (Qwen context'ini taşırmaz).
  const history: HistoryMessage[] = buildHistoryWindow(
    (opts.history ?? [])
      .filter((h) => h.role !== 'system')
      .map((h) => ({
        role: h.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: h.content,
      })),
    6000,
  );

  opts.onStatus?.('streaming');
  let answer = await streamAiChat(
    crypto.randomUUID(),
    [...history, { role: 'user', content: query }],
    fullSystemPrompt,
    opts.onToken,
  );

  // 4. Model kendiliğinden yapısal sorgu ürettiyse onu da uygula (fallback).
  const parsed = parseAssistantMessage(answer);

  if (parsed.actionQuery) {
    opts.onStatus?.('querying');

    const vq = normalizeVaultQuery(mergeQueryPayload(parsed.actionQuery));
    const result = await executeVaultQuery(vq);
    queryItems = result.items;

    const resultText = vq.countOnly
      ? `Arşiv sorgusu sonucu: ${result.count} kayıt.`
      : `Arşiv sorgusu sonucu (${result.count} kayıt):\n${result.items
          .map(
            (i) =>
              `- ${i.title ?? i.url} [${i.platform}] ${i.createdAt.slice(0, 10)} (ID: ${i.id})`,
          )
          .join('\n')}`;

    const actionBlock = answer.match(/```action:query[\s\S]*?```/)?.[0] ?? '';

    opts.onStatus?.('streaming');
    answer = await streamAiChat(
      crypto.randomUUID(),
      [
        ...history,
        { role: 'user', content: query },
        { role: 'assistant', content: actionBlock },
        { role: 'user', content: `${resultText}\n\nBu sonuca dayanarak soruyu Türkçe yanıtla.` },
      ],
      fullSystemPrompt,
      opts.onToken,
    );
  }

  // `answer` HAM döner (temizlenmiş değil): UI yeniden ayrıştırıp `action:tag`
  // kartını gösterebilsin ve mesaj kalıcı olarak bloğu taşısın diye bilinçli.
  return { answer, references, queryItems };
}

// --- Akıllı Kategorizasyon ve Etiketleme Hattı ---

/**
 * Bir öğe için varsa transkript metnini okur.
 */
export async function getItemTranscriptText(item: Item): Promise<string | null> {
  if (!item.local_path) return null;
  try {
    const srtPath = item.local_path.replace(/\.[^/.\\]+$/, '-transkript.srt');
    const content = await invoke<string>('preview_media_read_text', { path: srtPath }).catch(() => null);
    if (content && content.trim()) {
      const cues = parseSrt(content);
      return cues.map((c) => c.text).join(' ');
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Ağaç bağlamından prompt için girintili kategori ağacı üretir.
 * DB satırları varsa gerçek hiyerarşi; yoksa (dışarıdan ad listesi geldiyse)
 * düz adlar kullanılır. Satır yoksa boş dize döner; Rust tarafı
 * "Henüz kategori yok" ile değiştirir.
 */
function categoryTreeText(cats: Category[], names: string[] = []): string {
  const paths =
    cats.length > 0
      ? cats
          .map((c) => categoryPathOf(cats, c.id))
          .filter((p): p is string[] => p !== null)
      : names.map((n) => [n]);
  return indentedTaxonomyTree(paths);
}

/**
 * Tek bir öğeyi Qwen 2.5 ile analiz eder, mevcut kategoriler ve etiketler öncelikli olacak
 * şekilde en uygun kategori ve etiketleri önerir.
 */
export async function categorizeAndTagItem(
  item: Item,
  existingCategories?: string[],
  existingTags?: string[],
): Promise<CategorizeAndTagResult> {
  // Mevcut taksonomiyi yükle (verilmediyse DB'den çek)
  let cats = existingCategories;
  let dbCats: Category[] = [];
  if (!cats) {
    dbCats = await listCategories();
    cats = dbCats.map((c) => c.name);
  }
  const catTree = categoryTreeText(dbCats, cats);

  let tags = existingTags;
  if (!tags) {
    const dbTags = await listTags();
    tags = dbTags.map((t) => t.name);
  }

  const transcriptText = await getItemTranscriptText(item);
  const text = [item.title, item.note, transcriptText].filter(Boolean).join('\n');

  // 1. Deterministik ön geçiş: mevcut taksonomi metinde geçiyor mu? (LLM'siz)
  const det = matchTaxonomyInText(text, cats, tags);

  // 2. Boşluk varsa LLM devreye girer.
  const needLlm = det.categories.length === 0 || det.tags.length < 2;
  let llm = normalizeLlmSuggestion(null);
  let llmValid = false;
  if (needLlm) {
    try {
      const raw = await invoke<unknown>('ai_categorize_and_tag', {
        payload: {
          title: item.title || '',
          text: [
            item.note ? `Not: ${item.note}` : '',
            transcriptText ? `Transkript: ${transcriptText}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
          platform: item.platform || '',
          url: item.url || '',
          existing_category_tree: catTree,
          existing_tags: tags,
        },
      });
      llm = normalizeLlmSuggestion(raw);
      // Geçersiz/boş yanıt tespiti (eksik alanlar normalize edilir; çökme yok).
      llmValid =
        llm.confidence > 0 ||
        llm.categories.length > 0 ||
        llm.tags.length > 0 ||
        !!llm.newCategory ||
        !!llm.summary;
    } catch {
      llmValid = false;
    }
  }

  const suggestedCats = [...det.categories, ...(llmValid ? llm.categories : [])];
  const suggestedTags = [...det.tags, ...(llmValid ? llm.tags : [])];

  const llmConfidence = llmValid ? llm.confidence : 0;
  const threshold = readTagThreshold();

  // LLM mevcut bir çocuk bulamadıysa ve `{ust, alt}` önerdiyse, aday havuzuna
  // alt adı ekle: `resolveCategories` güven eşiğiyle onu yeni kabul eder,
  // taksonomide "Risotto" adı gerçekten oluşur.
  const newChild = llmValid ? llm.newCategory?.child : undefined;
  const catsForResolve = newChild && !cats.some((c) => normalizeKey(c) === normalizeKey(newChild))
    ? [...cats, newChild]
    : cats;

  const resolvedCats = resolveCategories(suggestedCats, catsForResolve, {
    confidence: llmConfidence,
    minConfidence: threshold,
    maxNew: 1,
    maxTotal: 1, // kayıt TEK kategoriye bağlanır (en derin uyan)
    ...(dbCats.length > 0 ? { categories: dbCats } : {}),
  });
  const resolvedTags = resolveTags(suggestedTags, tags, {
    max: 5,
    minConfidence: threshold,
    confidence: llmConfidence,
    ...(llmValid ? { reasons: llm.newTagReason } : {}),
  });

  // Yeni hiyerarşik öneri güven eşiğini geçtiyse ve önerilen `ust` ağaçta
  // gerçekten VARSA kaydedilecek ad çifti döndürülür (uydurma dal yasak).
  const proposedNew = llmValid ? llm.newCategory : null;
  const newCategory =
    proposedNew && llmConfidence >= threshold && validNewCategory(proposedNew, cats)
      ? proposedNew
      : null;

  const detHasAny = det.categories.length > 0 || det.tags.length > 0;
  const confidence = detHasAny ? 1 : llmValid ? llm.confidence : 0;
  const source: CategorizeAndTagResult['source'] = detHasAny
    ? llmValid
      ? 'both'
      : 'deterministic'
    : llmValid
      ? 'llm'
      : 'none';

  return {
    categories: resolvedCats.names,
    tags: resolvedTags,
    summary: llmValid ? llm.summary : '',
    confidence,
    source,
    newCategory,
  };
}

/** Önerinin uygulanıp uygulanmayacağı: deterministik/both her zaman; llm eşikle. */
export function shouldApplySuggestion(result: CategorizeAndTagResult, enabled: boolean): boolean {
  return shouldAutoApply(result.source, result.confidence, enabled, readTagThreshold());
}

/**
 * Önerilen kategori ve etiketleri doğrudan veritabanına kaydeder.
 * Var olmayan kategorileri ve etiketleri otomatik oluşturur.
 * Mevcut etiket ve kategorileri koruyarak üstüne ekler (merge).
 */
export async function applyCategorization(
  itemId: string,
  categoryNames: string[],
  tagNames: string[],
  /** Varsa alt kategorinin üstü önce açılır (kök, alt adı olmadan işe yaramaz). */
  newCategory?: { parent: string; child: string } | null,
): Promise<void> {
  if (categoryNames.length > 0) {
    // Üst kategoriyi önce aç: alt, `parent_id` ile ona bağlanmalı.
    const parentRow = newCategory ? await getOrCreateCategory(newCategory.parent) : null;

    const currentCats = await getCategoriesForItem(itemId);
    const existingNames = new Set(currentCats.map((c) => c.name.toLowerCase()));
    const toAdd = categoryNames.filter((c) => c && !existingNames.has(c.toLowerCase()));
    if (toAdd.length > 0) {
      const newCatRows = await Promise.all(
        toAdd.map((name) =>
          parentRow && normalizeKey(name) === normalizeKey(newCategory!.child)
            ? getOrCreateCategory(name, null, parentRow.id)
            : getOrCreateCategory(name),
        ),
      );
      const mergedIds = [...currentCats.map((c) => c.id), ...newCatRows.map((c) => c.id)];
      await setCategoriesForItem(itemId, mergedIds);
    }
  }

  if (tagNames.length > 0) {
    const currentTags = await getTagsForItem(itemId);
    const existingTagNames = new Set(currentTags.map((t) => t.name.toLowerCase()));
    const toAdd = tagNames.filter((t) => t && !existingTagNames.has(t.toLowerCase()));
    if (toAdd.length > 0) {
      const newTagRows = await Promise.all(toAdd.map((name) => getOrCreateTag(name)));
      const mergedIds = [...currentTags.map((t) => t.id), ...newTagRows.map((t) => t.id)];
      await setTagsForItem(itemId, mergedIds);
    }
  }

  // UI'ın haberdar olması için CustomEvent fırlat
  window.dispatchEvent(new CustomEvent('vault-items-updated'));
  // Etiket/kategori meta chunk'a girdiği için ilgili öğenin indeksi tazelensin.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('vault-item-index-dirty', { detail: { id: itemId } }));
  }
}

/** Bir turda kaç kayıt tek LLM çağrısına sığar.
 *
 *  Ponytail: 8 seçildi çünkü her kayıt ~700 karakter metin + taksonomi
 *  listesi prompt'u şişiriyor. 8 kayıtta ~6k token; `-c 8192` içinde güvenli.
 *  Prompt taşmaya başlarsa tek sayıyı düşür (ölçülecek tek yer burası). */
const BATCH_SIZE = 8;

/** Toplu kategorizasyonda tek bir kaydın kaderi (SAF karar). */
export type ItemCategorizationPlan =
  | { kind: 'deterministic'; result: CategorizeAndTagResult }
  | { kind: 'llm' }
  | { kind: 'skip' };

/**
 * Kural tabanlı ön geçişin SAF kararı (`batchCategorizeItems` Adım 3).
 *
 * - AI AÇIK: yalnızca TAM deterministik eşleşme (kategori + ≥2 etiket) LLM'i
 *   atlar; kısmi eşleşme LLM turuna gider ve boşluğu kapatır.
 * - AI KAPALI: LLM turu YOKTUR. Herhangi bir eşleşme deterministik uygulanır;
 *   eşleşme yoksa kayıt atlanır — başarısız DEĞİL (yapacak bir şey yok).
 */
export function planItemCategorization(
  text: string,
  categories: string[],
  tags: string[],
  opts: { aiOn: boolean; minConfidence: number; categories?: Category[] },
): ItemCategorizationPlan {
  const det = matchTaxonomyInText(text, categories, tags);
  const fullDet = det.categories.length > 0 && det.tags.length >= 2;
  const hasDet = det.categories.length > 0 || det.tags.length > 0;

  if (fullDet || (!opts.aiOn && hasDet)) {
    const resolvedCats = resolveCategories(det.categories, categories, {
      confidence: 1,
      minConfidence: opts.minConfidence,
      maxTotal: 1,
      ...(opts.categories ? { categories: opts.categories } : {}),
    });
    const resolvedTags = resolveTags(det.tags, tags, { max: 5 });
    return {
      kind: 'deterministic',
      result: {
        categories: resolvedCats.names,
        tags: resolvedTags,
        summary: '',
        confidence: 1,
        source: 'deterministic',
      },
    };
  }

  return opts.aiOn ? { kind: 'llm' } : { kind: 'skip' };
}

/**
 * Seçilen öğeleri Qwen 2.5 ile kategorize edip etiketler.
 *
 * Deterministik ön geçiş LLM'siz kayıtları eler; kalanlar **8'li gruplar**
 * hâlinde TEK çağrıda gönderilir (`ai_categorize_batch`). `llama-server` tek
 * slot'lu olduğu için eşzamanlı istekler kazandırmaz — darboğaz çağrı
 * sayısıdır. 100 kayıt: 100 tur yerine ~13 tur.
 *
 * forceAutoApply = true ise veya ayarlarda auto_apply_tags açıksa veritabanına
 * doğrudan uygular.
 */
export async function batchCategorizeItems(
  items: Item[],
  options?: {
    forceAutoApply?: boolean;
    /** true ise uygulanabilir sonuçta öğenin mevcut atamaları temizlenip yenisi yazılır. */
    replaceExisting?: boolean;
    onProgress?: (current: number, total: number, itemTitle: string) => void;
  },
): Promise<{
  processed: number;
  applied: number;
  lowConfidence: number;
  failed: number;
  deterministic: number;
  skipped: number;
  replaced: number;
}> {
  const dbCats = await listCategories();
  const allCats = dbCats.map((c) => c.name);
  const catTree = categoryTreeText(dbCats);
  const allTags = (await listTags()).map((t) => t.name);

  const cfg = await getAiStatus();
  const aiOn = isAiEnabled(cfg);
  const shouldApply = options?.forceAutoApply ?? cfg.auto_apply_tags ?? false;
  const replaceExisting = options?.replaceExisting ?? false;
  const threshold = readTagThreshold();

  let processed = 0;
  let applied = 0;
  let lowConfidence = 0;
  let failed = 0;
  let deterministic = 0;
  let skipped = 0;
  let replaced = 0;

  /** Sonucu uygulanabilir mi diye değerlendirir ve sayacları günceller. */
  const settle = async (it: Item, result: CategorizeAndTagResult): Promise<void> => {
    processed++;
    if (result.source === 'deterministic') deterministic++;

    const hasSuggestions = result.categories.length > 0 || result.tags.length > 0;
    const canApply = hasSuggestions && shouldApplySuggestion(result, shouldApply);

    if (canApply) {
      if (replaceExisting) {
        await setCategoriesForItem(it.id, []);
        await setTagsForItem(it.id, []);
      }
      await applyCategorization(it.id, result.categories, result.tags, result.newCategory);
      applied++;
      if (replaceExisting) replaced++;
      for (const c of result.categories) if (!allCats.includes(c)) allCats.push(c);
      for (const t of result.tags) if (!allTags.includes(t)) allTags.push(t);
    } else if (result.source === 'none') {
      failed++;
    } else if (shouldApply) {
      lowConfidence++;
    } else {
      // Otomatik uygulama kapalı: bu bir "düşük güven" değil, "öneri modu".
      skipped++;
    }
  };

  // 2. Her kaydın metnini bir kez oku (transkript okuması IPC'sidir).
  const texts = await Promise.all(items.map((it) => getItemTranscriptText(it)));

  // 3. Deterministik eşleşme: kural tabanlı kayıt LLM'e hiç gitmez. AI kapalıyken
  //    kısmi eşleşme de deterministik uygulanır; eşleşmeyen kayıt atlanır.
  const pending: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const text = [it.title, it.note, texts[i]].filter(Boolean).join('\n');
    const plan = planItemCategorization(text, allCats, allTags, {
      aiOn,
      minConfidence: threshold,
      categories: dbCats,
    });

    if (plan.kind === 'deterministic') {
      await settle(it, plan.result);
    } else if (plan.kind === 'skip') {
      // AI kapalı + kural eşleşmesi yok: yapacak bir şey yok, başarısız sayma.
      processed++;
      skipped++;
    } else {
      pending.push(i);
    }
  }

  // 4. Kalanları 8'li gruplar hâlinde tek çağrıda toplu gönder.
  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const group = pending.slice(start, start + BATCH_SIZE);

    if (options?.onProgress) {
      const first = items[group[0]];
      options.onProgress(
        Math.min(start + group.length, items.length),
        items.length,
        `${group.length} kayıt birlikte analiz ediliyor — ${first.title || first.url || 'Öğe'}`,
      );
    }

    let raw: unknown;
    try {
      raw = await invoke<unknown>('ai_categorize_batch', {
        payload: {
          items: group.map((i) => ({
            title: items[i].title || '',
            text: [items[i].note ? `Not: ${items[i].note}` : '', texts[i] ? `Transkript: ${texts[i]}` : '']
              .filter(Boolean)
              .join('\n\n'),
            platform: items[i].platform || '',
            url: items[i].url || '',
          })),
          existing_category_tree: catTree,
          existing_tags: allTags,
        },
      });
    } catch (err) {
      // Toplu çağrı düştü: grubun tamamı başarısız, diğer gruplar sürer.
      failed += group.length;
      console.error(`Toplu kategorizasyon başarısız (${group.length} kayıt):`, err);
      continue;
    }

    const rows = Array.isArray(raw) ? (raw as unknown[]) : [];

    for (let k = 0; k < group.length; k++) {
      const i = group[k];
      const it = items[i];
      const entry = rows[k];

      if (entry === null || entry === undefined || typeof entry !== 'object') {
        failed++;
        continue;
      }

      const llm = normalizeLlmSuggestion(entry);
      const llmValid =
        llm.confidence > 0 ||
        llm.categories.length > 0 ||
        llm.tags.length > 0 ||
        !!llm.newCategory ||
        !!llm.summary;

      if (!llmValid) {
        failed++;
        continue;
      }

      // Deterministik eşleşmeler önceki adımda zaten elendi; bu turda yalnız
      // LLM önerisi vardır.
      const text = [it.title, it.note, texts[i]].filter(Boolean).join('\n');
      const det = matchTaxonomyInText(text, allCats, allTags);
      const suggestedCats = [...det.categories, ...llm.categories];
      const suggestedTags = [...det.tags, ...llm.tags];

      const newChild = llm.newCategory?.child;
      const catsForResolve =
        newChild && !allCats.some((c) => normalizeKey(c) === normalizeKey(newChild))
          ? [...allCats, newChild]
          : allCats;

      const resolvedCats = resolveCategories(suggestedCats, catsForResolve, {
        confidence: llm.confidence,
        minConfidence: threshold,
        maxNew: 1,
        maxTotal: 1,
        categories: dbCats,
      });
      const resolvedTags = resolveTags(suggestedTags, allTags, {
        max: 5,
        minConfidence: threshold,
        confidence: llm.confidence,
        reasons: llm.newTagReason,
      });

      // Uydurma dal yasak: önerilen `ust` ağaçta yoksa yeni kategori düşer.
      const proposedNew = llm.newCategory;
      const newCategory =
        llm.confidence >= threshold && validNewCategory(proposedNew, allCats)
          ? proposedNew
          : null;

      await settle(it, {
        categories: resolvedCats.names,
        tags: resolvedTags,
        summary: llm.summary,
        confidence: llm.confidence,
        source: det.categories.length > 0 ? 'both' : 'llm',
        newCategory,
      });
    }
  }

  return { processed, applied, lowConfidence, failed, deterministic, skipped, replaced };
}

/**
 * Mevcut düz kategorileri iki seviyeli taksonomiye indirgemek için LLM planı
 * üretir. **Yalnızca önerir** — hiçbir şey yazmaz. Kullanıcı planı görüp
 * onaylayınca `applyRestructPlan` çalışır.
 */
export async function restructurePlan(
  names: string[],
): Promise<{ moves: RestructMove[]; merges: RestructPlan['merges'] }> {
  if (names.length < 2) return { moves: [], merges: [] };

  const status = await getAiStatus();
  if (!isAiEnabled(status) || !status.llm_ready || !status.engine_available) {
    return { moves: [], merges: [] };
  }

  const system =
    'Sen bir taksonomi düzenleme asistanısın. Yalnızca geçerli bir JSON nesnesi döndür; başka metin yazma.';
  const prompt =
    'Aşağıdaki kategori adlarını İKİ SEVİYELİ bir taksonomiye indirge.\n' +
    'KURALLAR:\n' +
    '1. "moves": listedeki HER ad için tam bir girdi ver.\n' +
    '2. Aynı kavramı taşıyan ayrı adları BİRLEŞTİR: "pizza tarifi" ve "pizza yapımı"\n' +
    '   ayrı kalmasın, ikisi de alt "Pizza"ya gitsin.\n' +
    '3. Üst seviye GENEL (Yemek, Teknoloji, Sanat); alt seviye SOMUT (Pizza, Rust, Fotoğraf).\n' +
    '4. Kök kalması gerekenlerde toChild boş string bırak.\n' +
    '5. YENİ ad uydurma — yalnızca listede geçen adları kullan.\n' +
    '6. "merges": aynı kavramı taşıyan ad grupları (kanonik + katlananlar).\n\n' +
    `Kategori adları: ${names.join(', ')}\n\n` +
    'Yanıt biçimi (yalnız JSON):\n' +
    '{"moves":[{"from":"pizza tarifi","toParent":"Yemek","toChild":"Pizza"},' +
    '{"from":"Python","toParent":"","toChild":""}],"merges":' +
    '[{"canonical":"Pizza","duplicates":["pizza tarifi","pizza yapımı"]}]}';

  try {
    const text = await streamAiChat(
      crypto.randomUUID(),
      [{ role: 'user', content: prompt }],
      system,
    );
    return parseRestructPlan(text, names);
  } catch {
    return { moves: [], merges: [] };
  }
}

/**
 * Onaylanan planı uygular: kategorileri hiyerarşiye taşır ve yinelenenleri
 * birleştirir.
 *
 * Sıra önemli: **önce birleştir** (kayıtlar hedefe taşınır), sonra `parent_id`
 * ata. Aksi halde birleştirilen adın altındaki kayıtlar yaşayan bir üst
 * adına bağlanamaz.
 *
 * Geri alınabilir değildir; bu yüzden çağırmadan önce kullanıcı onayı zorunlu.
 */
export async function applyRestructPlan(plan: RestructPlan): Promise<void> {
  // 1. Yinelenenleri kanonik adın altında birleştir.
  for (const m of plan.merges) {
    const canonicalRow = await getOrCreateCategory(m.canonical);
    const dupIds: string[] = [];
    for (const name of m.duplicates) {
      const row = await getOrCreateCategory(name);
      if (row.id !== canonicalRow.id) dupIds.push(row.id);
    }
    if (dupIds.length > 0) await mergeCategories(canonicalRow.id, dupIds);
  }

  // 2. Hiyerarşiyi kur: `from` adı taşındıysa güncelle, kalanlar kök kalır.
  for (const move of plan.moves) {
    if (!move.toChild) continue;
    const parent = await getOrCreateCategory(move.toParent);
    const child = await getOrCreateCategory(move.toChild, null, parent.id);
    const source = await getOrCreateCategory(move.from);
    if (source.id === child.id) continue;
    // `from` da bir kaynak adıysa kanonik alt ad olur: kayıtlarını taşı.
    await mergeCategories(child.id, [source.id]);
  }
}

/**
 * Taksonomide yakın-anlamlı öğeleri gruplar (LLM önerisi). Yalnızca ÖNERİ üretir;
 * uygulama kullanıcı onayındadır. AI kapalıysa boş döner.
 *
 * Modele düz ad listesi değil **tam yol + kayıt sayısı** verilir; dönen gruplar
 * `validateMergeGroups`'tan geçer, böylece bir üstü kendi altıyla birleştiren
 * (ağacı kendini yiyecek) öneri asla kullanıcıya ulaşmaz.
 */
export async function suggestTaxonomyMerges(
  kind: 'tags' | 'categories',
  categories: Category[],
  counts: Map<string, number>,
): Promise<string[][]> {
  if (categories.length < 2) return [];

  const status = await getAiStatus();
  if (!isAiEnabled(status) || !status.llm_ready || !status.engine_available) return [];

  const label = kind === 'tags' ? 'etiket' : 'kategori';
  const system =
    'Sen bir taksonomi düzenleme asistanısın. Yalnızca geçerli bir JSON dizisi döndür; başka metin yazma.';
  const prompt =
    `Aşağıdaki ${label} listesinde AYNI KAVRAMI taşıyan (yakın anlamlı) öğeleri grupla.\n` +
    'Her satır tam yolu ve kayıt sayısını verir; bir üst ile altını AYNI gruba KOYMA.\n' +
    'Yalnızca yolun SON parçasındaki adları kullan. Tek elemanlı grupları yazma.\n' +
    `Liste:\n${mergeContextLines(categories, counts).join('\n')}\n` +
    'Yanıt biçimi (yalnız JSON): [["ad1","ad2"],["ad3","ad4"]]';

  try {
    const text = await streamAiChat(
      crypto.randomUUID(),
      [{ role: 'user', content: prompt }],
      system,
    );
    const names = categories.map((c) => c.name);
    const groups = parseMergeSuggestions(text, names);
    const paths = new Map(
      categories.map((c) => [c.name, categoryPathOf(categories, c.id) ?? [c.name]]),
    );
    return validateMergeGroups(groups, paths);
  } catch {
    return [];
  }
}

