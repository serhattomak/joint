import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type ConvertOp = 'mp4' | 'mp3' | 'm4a' | 'trim';

// Rust renames job_id → jobId in the payload (serde rename); percent is 0–100.
export interface ConvertProgressEvent {
  jobId: string;
  percent: number;
}

export interface ConvertResult {
  jobId: string;
  ok: boolean;
  error?: string;
}

// Frontend owns jobId (crypto.randomUUID), Rust echoes it in progress events.
// Mirrors startDownload: never throws, maps the reject into the return.
export async function startConvert(
  inputPath: string,
  outputPath: string,
  op: ConvertOp,
  from?: string,
  to?: string,
  accurate?: boolean,
): Promise<ConvertResult> {
  const jobId = crypto.randomUUID();
  try {
    await invoke('convert_media', {
      payload: { input_path: inputPath, output_path: outputPath, job_id: jobId, op: { kind: op, from: from ?? null, to: to ?? null, accurate: accurate ?? null } },
    });
    return { jobId, ok: true };
  } catch (e) {
    const message = typeof e === 'string' ? e : e instanceof Error ? e.message : 'Dönüştürme başarısız.';
    return { jobId, ok: false, error: message };
  }
}

// Single 'convert-progress' subscription; unlistens on unmount.
export function useConvertProgress(onEvent: (e: ConvertProgressEvent) => void): void {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    void listen<ConvertProgressEvent>('convert-progress', (event) => {
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
