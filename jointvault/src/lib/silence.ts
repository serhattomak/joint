import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type SilencePreset = 'strict' | 'normal' | 'loose';

// Rust renames job_id → jobId in the payload (serde rename); percent is 0–100.
export interface SilenceProgressEvent {
  jobId: string;
  percent: number;
}

export interface SilenceResult {
  jobId: string;
  ok: boolean;
  error?: string;
}

// Frontend owns jobId (crypto.randomUUID), Rust echoes it in progress events.
// Mirrors startMerge/startConvert: never throws, maps the reject into the return.
export async function startSilence(
  inputPath: string,
  outputPath: string,
  preset: SilencePreset,
  preview: boolean,
): Promise<SilenceResult> {
  const jobId = crypto.randomUUID();
  try {
    await invoke('trim_silence', {
      payload: { input_path: inputPath, output_path: outputPath, job_id: jobId, preset, preview },
    });
    return { jobId, ok: true };
  } catch (e) {
    const message = typeof e === 'string' ? e : e instanceof Error ? e.message : 'Sessizlik kırpma başarısız.';
    return { jobId, ok: false, error: message };
  }
}

// Single 'silence-progress' subscription; unlistens on unmount.
export function useSilenceProgress(onEvent: (e: SilenceProgressEvent) => void): void {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    void listen<SilenceProgressEvent>('silence-progress', (event) => {
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
