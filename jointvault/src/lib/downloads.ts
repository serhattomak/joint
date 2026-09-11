import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { setDownloadState } from '@/lib/db/client';

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
): Promise<void> {
  await setDownloadState(itemId, { status: 'queued', error: null });
  try {
    const out = await invoke<string>('download_media', { payload: { item_id: itemId, url, kind, quality, format_id: formatId ?? null } });
    await setDownloadState(itemId, { status: 'done', local_path: out && out !== 'done' ? out : null, error: null });
  } catch (e) {
    const message = typeof e === 'string' ? e : e instanceof Error ? e.message : 'İndirme başarısız.';
    await setDownloadState(itemId, { status: 'error', error: message });
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
