import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface ProbeResult {
  url: string;
  filename: string;
  file_size: number;
  accepts_ranges: boolean;
  content_type?: string | null;
}

export interface ChunkProgress {
  id: number;
  percent: number;
}

export interface TurboProgressPayload {
  job_id: string;
  status: 'queued' | 'active' | 'paused' | 'completed' | 'error';
  downloaded_size: number;
  file_size: number;
  percent: number;
  speed_bps: number;
  eta_secs: number;
  chunks: ChunkProgress[];
  error?: string | null;
  /** Hata kalıcı mı? `false` ise yeniden denemek anlamsızdır. */
  retryable?: boolean;
}

/** Tarayıcıdan gelen istek başlıkları; korunan sunucularda indirme bunlarsız 403 döner. */
export interface RequestHeaders {
  referer?: string | null;
  cookie?: string | null;
  user_agent?: string | null;
}

export interface DownloadSettings {
  /** Toplam hız sınırı, bayt/sn. 0 = sınırsız. */
  speed_limit_bps: number;
  /** Aynı anda indirilecek en fazla iş; fazlası kuyrukta bekler. */
  max_concurrent: number;
  /** Yeni indirmelerde varsayılan kanal (parça) sayısı. */
  default_connections: number;
  /** Hedefi kategoriye göre alt klasöre ayır (`Video`, `Ses`, `Program`…). */
  category_folders: boolean;
  /** İndirme tamamlanınca ne yapılsın: `none` · `open` · `reveal`. */
  after_complete: 'none' | 'open' | 'reveal';
  /** Hata sonrası kendiliğinden yeniden deneme sayısı (0 = kapalı). */
  retry_count: number;
  /** Tarayıcıdan devralınan indirmede pencere öne gelsin mi. */
  raise_on_capture: boolean;
  /** Format seçildikten sonra format ekranı kendiliğinden kapansın mı. */
  close_format_after_pick: boolean;
}

export const DEFAULT_DOWNLOAD_SETTINGS: DownloadSettings = {
  speed_limit_bps: 0,
  max_concurrent: 3,
  default_connections: 8,
  category_folders: true,
  after_complete: 'none',
  retry_count: 2,
  raise_on_capture: true,
  close_format_after_pick: false,
};

export async function probeUrl(url: string, headers?: RequestHeaders): Promise<ProbeResult> {
  return invoke<ProbeResult>('turbo_probe_url', { url, headers: headers ?? null });
}

export async function startTurboDownload(params: {
  jobId: string;
  url: string;
  filename: string;
  destinationPath: string;
  fileSize: number;
  threads: number;
  headers?: RequestHeaders;
}): Promise<void> {
  await invoke('turbo_start_download', {
    payload: {
      job_id: params.jobId,
      url: params.url,
      filename: params.filename,
      destination_path: params.destinationPath,
      file_size: params.fileSize,
      threads: params.threads,
      headers: params.headers ?? null,
    },
  });
}

export async function getDownloadSettings(): Promise<DownloadSettings> {
  return invoke<DownloadSettings>('get_download_settings');
}

export async function setDownloadSettings(
  settings: DownloadSettings,
): Promise<DownloadSettings> {
  return invoke<DownloadSettings>('set_download_settings', { settings });
}

export async function pauseTurboDownload(jobId: string): Promise<void> {
  await invoke('turbo_pause_download', { jobId });
}

export async function cancelTurboDownload(jobId: string): Promise<void> {
  await invoke('turbo_cancel_download', { jobId });
}

export function formatSpeed(bps: number): string {
  if (bps <= 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let val = bps;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function formatEta(seconds: number): string {
  if (seconds <= 0 || !Number.isFinite(seconds)) return '--';
  if (seconds < 60) return `${Math.round(seconds)} sn`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins} dk ${secs} sn`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours} sa ${remainMins} dk`;
}

export function useTurboProgressListener(
  onProgress: (event: TurboProgressPayload) => void,
) {
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    void listen<TurboProgressPayload>('turbo-download-progress', (e) => {
      onProgress(e.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [onProgress]);
}
