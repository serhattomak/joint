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
  status: 'active' | 'paused' | 'completed' | 'error';
  downloaded_size: number;
  file_size: number;
  percent: number;
  speed_bps: number;
  eta_secs: number;
  chunks: ChunkProgress[];
  error?: string | null;
}

export async function probeUrl(url: string): Promise<ProbeResult> {
  return invoke<ProbeResult>('turbo_probe_url', { url });
}

export async function startTurboDownload(params: {
  jobId: string;
  url: string;
  filename: string;
  destinationPath: string;
  fileSize: number;
  threads: number;
}): Promise<void> {
  await invoke('turbo_start_download', {
    payload: {
      job_id: params.jobId,
      url: params.url,
      filename: params.filename,
      destination_path: params.destinationPath,
      file_size: params.fileSize,
      threads: params.threads,
    },
  });
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
