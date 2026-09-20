/**
 * JointVault Yerel AI İstemci Kütüphanesi.
 *
 * Qwen 2.5 14B-Instruct ve BGE-M3 modelleriyle iletişim,
 * Tauri IPC çağrıları, streaming sohbet, indeksleme ve RAG asistan hattı.
 */

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  buildMetaChunks,
  groupSrtIntoChunks,
  parseSrt,
  vectorToBase64,
  type ItemChunk,
} from './chunker';
import { useComponentDownloadProgress } from './components';
import {
  getAllTagsByItem,
  getCategoriesForItem,
  getChunksMissingEmbeddings,
  getDb,
  getOrCreateCategory,
  getOrCreateTag,
  getTagsForItem,
  listCategories,
  listItems,
  listTags,
  saveItemChunks,
  searchHybridChunks,
  setCategoriesForItem,
  setTagsForItem,
  updateChunkEmbedding,
} from './db/client';
import type { HybridSearchResult, Item } from './db/types';

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
}

export interface AiConfig {
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

/**
 * Tek bir öğeyi ve varsa transkriptini chunk'lara böler ve SQLite'a kaydeder.
 */
export async function indexItemChunks(
  item: Item,
  tags: string[] = [],
  srtContent?: string | null,
): Promise<void> {
  const chunks: ItemChunk[] = [];

  // 1. Meta ve not chunk'ları
  const meta = buildMetaChunks(item.id, {
    title: item.title,
    platform: item.platform,
    note: item.note,
    tags,
  });
  chunks.push(...meta);

  // 2. Varsa Whisper transkript chunk'ları
  if (srtContent && srtContent.trim()) {
    const cues = parseSrt(srtContent);
    const transcriptChunks = groupSrtIntoChunks(item.id, cues);
    chunks.push(...transcriptChunks);
  }

  // SQLite tablosuna yaz
  await saveItemChunks(item.id, chunks);

  // Vektörleme motoru hazırsa hemen embedding üret
  try {
    const status = await getAiStatus();
    if (status.embed_ready && status.engine_available) {
      const texts = chunks.map((c) => c.chunkText);
      const embeddings = await generateEmbeddings(texts);
      for (let i = 0; i < chunks.length; i++) {
        if (embeddings[i]) {
          const b64 = vectorToBase64(embeddings[i]);
          await updateChunkEmbedding(chunks[i].id, b64);
        }
      }
    }
  } catch {
    // Vektörleme motoru henüz hazır değilse metinler kaydedilmiş olarak kalır, sonra taranır
  }
}

/**
 * Eksik embedding'i olan chunk'ları toplu olarak BGE-M3 ile vektörleştirir.
 */
export async function indexMissingEmbeddings(
  onProgress?: (done: number, total: number) => void,
): Promise<{ processed: number }> {
  let processed = 0;
  const BATCH_SIZE = 16;

  while (true) {
    const missing = await getChunksMissingEmbeddings(BATCH_SIZE);
    if (missing.length === 0) break;

    const texts = missing.map((m) => m.chunk_text);
    const embeddings = await generateEmbeddings(texts);

    for (let i = 0; i < missing.length; i++) {
      if (embeddings[i]) {
        const b64 = vectorToBase64(embeddings[i]);
        await updateChunkEmbedding(missing[i].id, b64);
        processed++;
        if (onProgress) onProgress(processed, processed + missing.length);
      }
    }
  }

  return { processed };
}

/**
 * Kasadaki tüm kayıtları baştan indeksler.
 */
export async function reindexVault(
  onProgress?: (current: number, total: number) => void,
): Promise<void> {
  const db = await getDb();
  // Mevcut chunk'ları temizle
  await db.execute('DELETE FROM item_chunks');
  try {
    await db.execute('DELETE FROM item_chunks_fts');
  } catch {
    // ignore
  }

  const items = await listItems();
  const allTags = await getAllTagsByItem();
  const total = items.length;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const tags = (allTags[it.id] ?? []).map((t) => t.name);

    // Varsa transkript dosyasını oku
    let srtContent: string | null = null;
    if (it.local_path) {
      try {
        const srtPath = it.local_path.replace(/\.[^/.\\]+$/, '-transkript.srt');
        // invoke tauri text reader or custom read if available
        const content = await invoke<string>('preview_media_read_text', { path: srtPath }).catch(
          () => null,
        );
        if (content) srtContent = content;
      } catch {
        // ignore
      }
    }

    await indexItemChunks(it, tags, srtContent);
    if (onProgress) onProgress(i + 1, total);
  }
}

// --- RAG Hattı: 'Kasa Asistanı' ---

export interface RagResult {
  answer: string;
  references: HybridSearchResult[];
}

/**
 * Kasada soru aratıp transkript/not bağlamıyla Qwen 2.5'ten kaynaklı yanıt üretir.
 */
export async function askVault(
  query: string,
  onToken?: (token: string) => void,
): Promise<RagResult> {
  const status = await getAiStatus();
  if (!status.engine_available) {
    throw new Error('AI motoru (llama-server) kurulu değil. Lütfen Ayarlar > Yapay Zekâ sekmesinden kur.');
  }
  if (!status.llm_ready) {
    throw new Error('Qwen 2.5 14B modeli hazır değil. Lütfen Ayarlar > Yapay Zekâ sekmesinden indir veya seç.');
  }

  // 1. Sorunun embedding'ini al (eğer BGE-M3 hazırsa)
  let queryEmbedding: number[] | null = null;
  if (status.embed_ready) {
    try {
      const embeds = await generateEmbeddings([query]);
      if (embeds.length > 0) queryEmbedding = embeds[0];
    } catch {
      // ignore
    }
  }

  // 2. Hibrit arama yap (en alakalı 5 chunk)
  const references = await searchHybridChunks(query, queryEmbedding, 5);

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
    contextText = 'Kasada bu soruyla doğrudan eşleşen bir transkript veya not bulunamadı.';
  }

  const systemPrompt = `Sen JointVault kişisel medya kasasının zeki Türkçe asistanısın.\n\
Kullanıcının sorularına, aşağıda kasadan çekilen transkript ve not parçalarını (KAYNAKLAR) kullanarak yanıt ver.\n\
KURALLAR:\n\
1. Sadece verilen kaynaklara sadık kal. Kaynaklarda olmayan şeyleri uydurma.\n\
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

  const jobId = crypto.randomUUID();
  const answer = await streamAiChat(
    jobId,
    [{ role: 'user', content: query }],
    systemPrompt,
    onToken,
  );

  return { answer, references };
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
  if (!cats) {
    const dbCats = await listCategories();
    cats = dbCats.map((c) => c.name);
  }

  let tags = existingTags;
  if (!tags) {
    const dbTags = await listTags();
    tags = dbTags.map((t) => t.name);
  }

  // Transkripti kontrol et
  const transcriptText = await getItemTranscriptText(item);
  const combinedText = [
    item.note ? `Not: ${item.note}` : '',
    transcriptText ? `Transkript: ${transcriptText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return invoke<CategorizeAndTagResult>('ai_categorize_and_tag', {
    payload: {
      title: item.title || '',
      text: combinedText,
      platform: item.platform || '',
      url: item.url || '',
      existing_categories: cats,
      existing_tags: tags,
    },
  });
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
): Promise<void> {
  if (categoryNames.length > 0) {
    const currentCats = await getCategoriesForItem(itemId);
    const existingNames = new Set(currentCats.map((c) => c.name.toLowerCase()));
    const toAdd = categoryNames.filter((c) => c && !existingNames.has(c.toLowerCase()));
    if (toAdd.length > 0) {
      const newCatRows = await Promise.all(toAdd.map((name) => getOrCreateCategory(name)));
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
}

/**
 * Seçilen öğeleri sırayla Qwen 2.5 ile kategorize edip etiketler.
 * forceAutoApply = true ise veya ayarlarda auto_apply_tags açıksa veritabanına doğrudan uygular.
 */
export async function batchCategorizeItems(
  items: Item[],
  options?: {
    forceAutoApply?: boolean;
    onProgress?: (current: number, total: number, itemTitle: string) => void;
  },
): Promise<{ processed: number; applied: number }> {
  const allCats = (await listCategories()).map((c) => c.name);
  const allTags = (await listTags()).map((t) => t.name);

  const cfg = await getAiStatus();
  const shouldApply = options?.forceAutoApply ?? cfg.auto_apply_tags ?? false;

  let processed = 0;
  let applied = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (options?.onProgress) {
      options.onProgress(i + 1, items.length, it.title || it.url || 'Öğe');
    }

    try {
      const result = await categorizeAndTagItem(it, allCats, allTags);
      processed++;

      if (shouldApply && (result.categories.length > 0 || result.tags.length > 0)) {
        await applyCategorization(it.id, result.categories, result.tags);
        applied++;
        for (const c of result.categories) {
          if (!allCats.includes(c)) allCats.push(c);
        }
        for (const t of result.tags) {
          if (!allTags.includes(t)) allTags.push(t);
        }
      }
    } catch (err) {
      console.error(`Öğe kategorize edilirken hata (ID: ${it.id}):`, err);
    }
  }

  return { processed, applied };
}

