import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { setDownloadState, type DownloadCategory } from '@/lib/db/client';

export type DownloadKind = 'video' | 'audio';

export type DownloadQuality = '360' | '480' | '720' | '1080' | '1440' | '2160';

export const QUALITY_OPTIONS: { value: DownloadQuality; label: string }[] = [
  { value: '360', label: '360p' },
  { value: '480', label: '480p' },
  { value: '720', label: '720p' },
  { value: '1080', label: '1080p' },
  { value: '1440', label: '1440p' },
  { value: '2160', label: '4K' },
];

const QUALITY_KEY = 'jv-quality';

export function getDefaultQuality(): DownloadQuality {
  const v = window.localStorage.getItem(QUALITY_KEY);
  return QUALITY_OPTIONS.some((o) => o.value === v) ? (v as DownloadQuality) : '720';
}

export function setDefaultQuality(q: DownloadQuality): void {
  window.localStorage.setItem(QUALITY_KEY, q);
}

// Rust renames item_id → itemId in the payload (serde rename); percent is 0–100.
export interface DownloadProgressEvent {
  itemId: string;
  percent: number;
  speed?: string | null;
  eta?: string | null;
}

/**
 * `items.download_error` alanına yazılan ham metin (şema TEXT kalır; DEĞİŞMEZ).
 *
 * Neden ham saklanır: backend bir bileşen eksikken `BILESEN_EKSIK:<id>` makine
 * işareti döndürür. İşaret yalnızca "hangi bileşen eksik" bilgisini taşır ve
 * yeniden deneme/gösterim için bu id GEREKLİDİR; bu yüzden kayıt anında soyulmaz.
 * Önek kullanıcıya ASLA gösterilmez: her gösterim sınırında `parseMissingComponent`
 * ile ayrıştırılıp `missingComponentText` ile okunabilir cümleye çevrilir
 * (bkz. src/lib/components.ts).
 */
export type StoredDownloadError = string;

/**
 * İndirme durumu değişti (başladı/bitti/hata). `download-progress` olayı
 * **bitişi bildirmez** (yt-dlp son satırı yazar, sonra süreç kapanır); şerit ve
 * indirme listesi bu bildirimle tazelenir.
 */
export const DOWNLOADS_CHANGED_EVENT = 'jv-downloads-changed';

export function notifyDownloadsChanged(): void {
  window.dispatchEvent(new Event(DOWNLOADS_CHANGED_EVENT));
}

// Frontend owns queued/active/done/error via setDownloadState. Resolves done,
// maps the reject string into error state; never throws.
// Rust komutu tek `payload` nesnesi alır (sürüm kaymalarına dayanıklı);
// iki anahtar stili de kabul edilir.
export async function startDownload(
  itemId: string,
  url: string,
  kind: DownloadKind,
  quality: DownloadQuality = '720',
  formatId?: string,
  options?: {
    subfolder?: string;
    cookiesFromBrowser?: string;
  },
): Promise<string | null> {
  await setDownloadState(itemId, { status: 'queued', error: null });
  notifyDownloadsChanged();
  try {
    const out = await invoke<string>('download_media', {
      payload: {
        item_id: itemId,
        url,
        kind,
        quality,
        format_id: formatId ?? null,
        subfolder: options?.subfolder ?? null,
        cookies_from_browser: options?.cookiesFromBrowser ?? null,
      },
    });
    const localPath = out && out !== 'done' ? out : null;
    await setDownloadState(itemId, { status: 'done', local_path: localPath, error: null });
    return localPath;
  } catch (e) {
    // Ham mesaj (varsa `BILESEN_EKSIK:<id>` işaretiyle) DB'ye AYNEN yazılır:
    // böylece id korunur ve gösterim sınırında soyulup kurulum akışına bağlanabilir
    // (bkz. StoredDownloadError).
    const message = typeof e === 'string' ? e : e instanceof Error ? e.message : 'İndirme başarısız.';
    await setDownloadState(itemId, { status: 'error', error: message });
    return null;
  } finally {
    notifyDownloadsChanged();
  }
}

export interface RemoteFormat {
  id: string;
  height: number | null;
  ext: string;
  vcodec: string;
  acodec: string;
  filesize: number | null;
  fps: number | null;
}

// yt-dlp -J çıktısı: linkin GERÇEK seçenekleri (preset varsayımı yok).
export async function listFormats(url: string): Promise<RemoteFormat[]> {
  return invoke<RemoteFormat[]>('list_formats', { payload: { url } });
}

export function formatBytes(n: number | null): string {
  if (n == null) return '?';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export type DownloadSort = 'newest' | 'oldest' | 'name' | 'size' | 'status';

/** Sıralanabilir indirme işi: `DownloadJob`'un yapısal alt kümesi (DB'ye bağlanmaz). */
export interface SortableDownload {
  filename: string;
  file_size: number;
  status: 'active' | 'queued' | 'paused' | 'completed' | 'error';
  created_at: string;
}

const DOWNLOAD_STATUS_ORDER: Record<SortableDownload['status'], number> = {
  active: 0,
  queued: 1,
  paused: 2,
  error: 3,
  completed: 4,
};

/** Görünüm sırası — girdi dizisini değiştirmez (DB sırası korunur). */
export function sortDownloadJobs<T extends SortableDownload>(jobs: T[], sort: DownloadSort): T[] {
  const list = [...jobs];
  switch (sort) {
    case 'oldest':
      return list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    case 'name':
      return list.sort((a, b) => a.filename.localeCompare(b.filename, 'tr'));
    case 'size':
      return list.sort((a, b) => b.file_size - a.file_size);
    case 'status':
      return list.sort(
        (a, b) =>
          DOWNLOAD_STATUS_ORDER[a.status] - DOWNLOAD_STATUS_ORDER[b.status] ||
          b.created_at.localeCompare(a.created_at),
      );
    default:
      return list;
  }
}

/**
 * Hedefte aynı adlı dosya varsa `ad (2).uzantı` döner — üzerine yazmaz.
 * Varlık kontrolü Rust tarafında yapılır (dosya sistemi orada) ve yol izinli
 * köklerle sınırlanır.
 */
export async function uniqueDownloadPath(path: string): Promise<string> {
  return invoke<string>('unique_path', { path });
}

/**
 * Kategori → klasör adı. IDM'in Video/Music/Programs/Documents/Compressed
 * düzeni; adlar arayüzün sözlüğüyle (indirme filtresi etiketleri) aynıdır.
 */
export const CATEGORY_FOLDER: Record<DownloadCategory, string> = {
  video: 'Video',
  audio: 'Ses',
  archive: 'Sıkıştırılmış',
  document: 'Belge',
  program: 'Program',
  other: 'Diğer',
};

/**
 * Hedef yol. `separateFolders` açıkken dosya kendi kategorisinin alt klasörüne
 * iner; kapalıyken doğrudan indirme köküne.
 *
 * Klasör henüz yoksa sorun değil: `unique_path` yolu en yakın var olan atadan
 * çözümler, motor da indirmeye başlarken klasörü açar.
 */
export function destinationPath(
  dir: string,
  filename: string,
  category: DownloadCategory,
  separateFolders: boolean,
): string {
  const root = dir.replace(/[/\\]+$/, '');
  return separateFolders
    ? `${root}/${CATEGORY_FOLDER[category]}/${filename}`
    : `${root}/${filename}`;
}

// Single 'download-progress' subscription; unlistens on unmount.
export function useDownloadProgress(onEvent: (e: DownloadProgressEvent) => void): void {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    void listen<DownloadProgressEvent>('download-progress', (event) => {
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
