import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Rust renames job_id → jobId in the payload (serde rename); percent is 0–100.
export interface MergeProgressEvent {
  jobId: string;
  percent: number;
}

export interface MergeResult {
  jobId: string;
  ok: boolean;
  error?: string;
}

// Frontend owns jobId (crypto.randomUUID), Rust echoes it in progress events.
// Mirrors startConvert: never throws, maps the reject into the return.
export async function startMerge(
  inputPaths: string[],
  outputPath: string,
): Promise<MergeResult> {
  const jobId = crypto.randomUUID();
  try {
    await invoke('merge_media', {
      payload: { input_paths: inputPaths, output_path: outputPath, job_id: jobId },
    });
    return { jobId, ok: true };
  } catch (e) {
    const message = typeof e === 'string' ? e : e instanceof Error ? e.message : 'Birleştirme başarısız.';
    return { jobId, ok: false, error: message };
  }
}

// Single 'merge-progress' subscription; unlistens on unmount.
export function useMergeProgress(onEvent: (e: MergeProgressEvent) => void): void {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    void listen<MergeProgressEvent>('merge-progress', (event) => {
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
