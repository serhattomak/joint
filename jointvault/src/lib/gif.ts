import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type GifFormat = 'gif' | 'webm';

// Rust renames job_id → jobId in the payload (serde rename); percent is 0–100.
export interface GifProgressEvent {
  jobId: string;
  percent: number;
}

export interface GifOptions {
  format: GifFormat;
  from: number;
  to: number;
  width: number;
  fps: number;
}

export interface GifResult {
  jobId: string;
  ok: boolean;
  error?: string;
}

// Frontend owns jobId (crypto.randomUUID), Rust echoes it in progress events.
// Mirrors startSilence/startMerge: never throws, maps the reject into the return.
export async function startGif(
  inputPath: string,
  outputPath: string,
  opts: GifOptions,
): Promise<GifResult> {
  const jobId = crypto.randomUUID();
  try {
    await invoke('make_gif', {
      payload: {
        input_path: inputPath,
        output_path: outputPath,
        job_id: jobId,
        format: opts.format,
        from: String(opts.from),
        to: String(opts.to),
        width: opts.width,
        fps: opts.fps,
      },
    });
    return { jobId, ok: true };
  } catch (e) {
    const message = typeof e === 'string' ? e : e instanceof Error ? e.message : 'GIF/WebM üretimi başarısız.';
    return { jobId, ok: false, error: message };
  }
}

// Single 'gif-progress' subscription; unlistens on unmount.
export function useGifProgress(onEvent: (e: GifProgressEvent) => void): void {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    void listen<GifProgressEvent>('gif-progress', (event) => {
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
