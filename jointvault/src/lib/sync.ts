import { invoke } from '@tauri-apps/api/core';
import {
  applyCategorization,
  categorizeAndTagItem,
  getAiStatus,
  indexItemChunks,
  isAiEnabled,
} from './ai';
import {
  createItem,
  getItem,
  getOrCreateTag,
  getTagsForItem,
  listItems,
  setTagsForItem,
} from './db/client';
import { getDefaultQuality, startDownload, type DownloadQuality } from './downloads';
import { getWhisperModel, getWhisperStatus, startTranscribe } from './whisper';

export interface SyncConfig {
  default_browser: string;
  x_enabled: boolean;
  x_browser: string | null;
  instagram_enabled: boolean;
  instagram_browser: string | null;
  instagram_url: string | null;
  youtube_enabled: boolean;
  youtube_browser: string | null;
  youtube_source: string; // "WL", "LL", or custom playlist URL
  batch_limit: number;
  auto_sync_interval_hours: number;
  auto_ai_pipeline: boolean;
  last_sync_x: string | null;
  last_sync_instagram: string | null;
  last_sync_youtube: string | null;
}

export interface SyncScannedItem {
  id: string;
  url: string;
  title: string | null;
  thumbnail: string | null;
  duration: number | null;
  uploader: string | null;
  platform: string;
  timestamp: number | null;
  inDb?: boolean;
  downloadStatus?: string;
  localPath?: string | null;
}

export const BROWSERS = [
  { id: 'chrome', name: 'Google Chrome' },
  { id: 'brave', name: 'Brave' },
  { id: 'edge', name: 'Microsoft Edge' },
  { id: 'firefox', name: 'Mozilla Firefox' },
  { id: 'opera', name: 'Opera' },
  { id: 'vivaldi', name: 'Vivaldi' },
];

export async function getSyncConfig(): Promise<SyncConfig> {
  return invoke<SyncConfig>('sync_get_config');
}

export async function saveSyncConfig(config: SyncConfig): Promise<SyncConfig> {
  return invoke<SyncConfig>('sync_save_config', { config });
}

export async function checkBrowserAvailable(browser: string): Promise<boolean> {
  return invoke<boolean>('sync_check_browser', { browser });
}

export async function hasCookiesFile(): Promise<boolean> {
  return invoke<boolean>('sync_has_cookies_file');
}

export async function uploadCookies(content: string): Promise<boolean> {
  return invoke<boolean>('sync_upload_cookies', { content });
}

export async function clearCookiesFile(): Promise<boolean> {
  return invoke<boolean>('sync_clear_cookies_file');
}

export async function scanPlatformSaved(
  platform: 'x' | 'instagram' | 'youtube',
  options?: {
    browser?: string;
    limit?: number;
    customUrl?: string;
  },
): Promise<SyncScannedItem[]> {
  const items = await invoke<SyncScannedItem[]>('sync_scan_platform', {
    payload: {
      platform,
      browser: options?.browser ?? null,
      limit: options?.limit ?? 50,
      custom_url: options?.customUrl ?? null,
    },
  });

  // Snapshot database to mark already synced/downloaded items
  const existing = await listItems().catch(() => []);
  const urlMap = new Map(existing.map((e) => [e.url.toLowerCase(), e]));
  const idMap = new Map(
    existing.map((e) => {
      // extract id from e.g. x.com/status/123 or watch?v=123
      const m = e.url.match(/(?:status\/|v=|reel\/|p\/)([\w-]+)/);
      return [m ? m[1] : e.id, e];
    }),
  );

  return items.map((item) => {
    const match =
      urlMap.get(item.url.toLowerCase()) ||
      idMap.get(item.id);

    return {
      ...item,
      inDb: Boolean(match),
      downloadStatus: match?.download_status ?? 'none',
      localPath: match?.local_path ?? null,
    };
  });
}

/**
 * Executes the full automated AI pipeline on a downloaded media item:
 * 1. Whisper speech-to-text transcription (generates SRT)
 * 2. BGE-M3 text & chunk embedding indexing (FTS5 + vector chunks)
 * 3. Qwen LLM categorization & tagging (auto-applied)
 * 4. Automatic `#esitlendi` tag application
 */
export async function processDownloadedItemWithAi(
  itemId: string,
  localPath: string,
  onProgress?: (step: string) => void,
): Promise<{ srtCreated: boolean; aiCategorized: boolean }> {
  let srtCreated = false;
  let aiCategorized = false;

  const item = await getItem(itemId);
  if (!item) return { srtCreated, aiCategorized };

  let currentTags = await getTagsForItem(itemId).catch(() => []);
  let srtPreview = '';

  // 1. Whisper transkripsiyonu
  onProgress?.('Ses transkripti inceleniyor…');
  try {
    const whisperStat = await getWhisperStatus();
    if (whisperStat?.whisper_available) {
      const model = getWhisperModel();
      if (whisperStat.models[model]) {
        onProgress?.(`Whisper (${model}) ile altyazı çıkarılıyor…`);
        const jobId = `sync-w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const transcribeRes = await startTranscribe(localPath, model, 'auto', jobId);
        if (transcribeRes.ok && transcribeRes.data) {
          srtCreated = true;
          srtPreview = transcribeRes.data.preview;
          onProgress?.('Transkript başarıyla çıkarıldı.');
        }
      }
    }
  } catch (e) {
    console.warn('[Sync AI] Whisper hatası:', e);
  }

  // 2. Chunks & BGE-M3 Vektör İndeksleme
  try {
    onProgress?.('Vektör indekslemesi yapılıyor…');
    await indexItemChunks(item, currentTags.map((t) => t.name), srtPreview || undefined);
  } catch (e) {
    console.warn('[Sync AI] İndeksleme hatası:', e);
  }

  // 3. Yerel LLM ile Kategorizasyon ve Etiketleme
  try {
    const aiStat = await getAiStatus().catch(() => null);
    if (aiStat && isAiEnabled(aiStat) && aiStat.engine_available && aiStat.llm_ready) {
      onProgress?.('Yapay zekâ ile içerik ve etiketler çözümleniyor…');
      const catResult = await categorizeAndTagItem(item);
      if (catResult.categories.length > 0 || catResult.tags.length > 0) {
        await applyCategorization(itemId, catResult.categories, catResult.tags);
        aiCategorized = true;
      }
    }
  } catch (e) {
    console.warn('[Sync AI] LLM etiketleme hatası:', e);
  }

  // 4. #esitlendi ve platform etiketini iliştir
  try {
    const syncTag = await getOrCreateTag('esitlendi');
    const platformTag = await getOrCreateTag(item.platform.toLowerCase());
    currentTags = await getTagsForItem(itemId).catch(() => []);
    const tagIds = new Set(currentTags.map((t) => t.id));
    tagIds.add(syncTag.id);
    tagIds.add(platformTag.id);
    await setTagsForItem(itemId, Array.from(tagIds));
  } catch (e) {
    console.warn('[Sync AI] Etiket ekleme hatası:', e);
  }

  onProgress?.('Tamamlandı');
  return { srtCreated, aiCategorized };
}

/**
 * Downloads a single scanned item into JointVault/{Platform}/ and runs AI pipeline
 */
export async function downloadAndProcessScannedItem(
  item: SyncScannedItem,
  browserForCookies?: string,
  quality?: DownloadQuality,
  runAi = true,
  onProgress?: (step: string) => void,
): Promise<{ success: boolean; localPath?: string; error?: string }> {
  try {
    onProgress?.('Kayıt oluşturuluyor…');
    // Ensure item exists in DB
    const existing = await listItems().catch(() => []);
    let dbItem = existing.find((e) => e.url === item.url || (item.id && e.url.includes(item.id)));

    if (!dbItem) {
      dbItem = await createItem({
        url: item.url,
        title: item.title,
        thumbnail: item.thumbnail,
        platform: item.platform,
      });
    }

    onProgress?.('İndiriliyor…');
    const dlQuality = quality ?? getDefaultQuality();
    const platformSubfolder =
      item.platform.toLowerCase() === 'x'
        ? 'X'
        : item.platform.toLowerCase() === 'instagram'
        ? 'Instagram'
        : item.platform.toLowerCase() === 'youtube'
        ? 'YouTube'
        : 'Downloads';

    const localPath = await startDownload(dbItem.id, item.url, 'video', dlQuality, undefined, {
      subfolder: platformSubfolder,
      cookiesFromBrowser: browserForCookies,
    });

    if (!localPath) {
      return { success: false, error: 'İndirme tamamlanamadı.' };
    }

    if (runAi) {
      await processDownloadedItemWithAi(dbItem.id, localPath, onProgress);
    }

    return { success: true, localPath };
  } catch (e) {
    const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : 'Bilinmeyen hata';
    return { success: false, error: msg };
  }
}

export function requestNotificationPermission(): void {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }
}

export function sendSyncNotification(title: string, body: string): void {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: '/favicon.svg' });
      } catch {
        // ignore
      }
    }
  }
}
