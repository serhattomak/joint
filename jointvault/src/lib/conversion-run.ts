/*
 * Dönüşüm komut köprüsü: invoke + ilerleme olayı + iptal.
 *
 * Rust `convert_file` reddi `IPTAL` ile başlarsa bu bir hata değildir; arayüz
 * satırı "iptal" durumuna çevirir. Diğer redler kullanıcıya hazır Türkçe metindir.
 */
import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface ConversionProgressEvent {
  jobId: string;
  percent: number;
  phase: string;
  message?: string;
}

export interface ConversionRunResult {
  jobId: string;
  ok: boolean;
  cancelled: boolean;
  outputs: string[];
  warnings: string[];
  error?: string;
}

export interface ConversionFileInfo {
  path: string;
  name: string;
  ext: string;
  kind: string;
  size: number;
}

const CANCELLED_MARKER = 'IPTAL';

function isCancelled(error: unknown): boolean {
  if (typeof error === 'string') return error.trim() === CANCELLED_MARKER;
  if (error instanceof Error) return error.message.trim() === CANCELLED_MARKER;
  return false;
}

function errorText(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export async function runConversion(input: {
  jobId?: string;
  inputPath: string;
  outputPath: string;
  target: string;
  options: Record<string, unknown>;
}): Promise<ConversionRunResult> {
  const jobId = input.jobId ?? crypto.randomUUID();
  try {
    const result = await invoke<{
      jobId: string;
      outputs: string[];
      warnings: string[];
    }>('convert_file', {
      payload: {
        job_id: jobId,
        input_path: input.inputPath,
        output_path: input.outputPath,
        target: input.target,
        options: input.options,
      },
    });
    return {
      jobId,
      ok: true,
      cancelled: false,
      outputs: result.outputs ?? [],
      warnings: result.warnings ?? [],
    };
  } catch (error) {
    return {
      jobId,
      ok: false,
      cancelled: isCancelled(error),
      outputs: [],
      warnings: [],
      error: isCancelled(error) ? undefined : errorText(error, 'Dönüştürme başarısız.'),
    };
  }
}

export async function runPdfTool(input: {
  jobId?: string;
  tool: 'merge' | 'split' | 'rotate' | 'compress' | 'images_to_pdf';
  inputs: string[];
  outputPath: string;
  options: Record<string, unknown>;
}): Promise<ConversionRunResult> {
  const jobId = input.jobId ?? crypto.randomUUID();
  try {
    const result = await invoke<{
      jobId: string;
      outputs: string[];
      warnings: string[];
    }>('conversion_pdf_tool', {
      payload: {
        job_id: jobId,
        tool: input.tool,
        inputs: input.inputs,
        output_path: input.outputPath,
        options: input.options,
      },
    });
    return {
      jobId,
      ok: true,
      cancelled: false,
      outputs: result.outputs ?? [],
      warnings: result.warnings ?? [],
    };
  } catch (error) {
    return {
      jobId,
      ok: false,
      cancelled: isCancelled(error),
      outputs: [],
      warnings: [],
      error: isCancelled(error) ? undefined : errorText(error, 'PDF işlemi başarısız.'),
    };
  }
}

export async function cancelConversion(jobId: string): Promise<boolean> {
  try {
    return await invoke<boolean>('convert_cancel', { jobId });
  } catch {
    return false;
  }
}

export async function inspectConversionPaths(paths: string[]): Promise<ConversionFileInfo[]> {
  if (paths.length === 0) return [];
  try {
    return await invoke<ConversionFileInfo[]>('conversion_inspect', { paths });
  } catch {
    return [];
  }
}

export async function scanConversionDir(path: string): Promise<ConversionFileInfo[]> {
  try {
    return await invoke<ConversionFileInfo[]>('conversion_scan_dir', { path });
  } catch {
    return [];
  }
}

/** Tek `convert-progress` aboneliği; unmount'ta bırakılır. */
export function useConversionProgress(
  onEvent: (event: ConversionProgressEvent) => void,
): void {
  const ref = useRef(onEvent);
  useEffect(() => {
    ref.current = onEvent;
  });
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    void listen<ConversionProgressEvent>('convert-progress', (event) => {
      ref.current(event.payload);
    }).then((off) => {
      if (live) unlisten = off;
      else off();
    });
    return () => {
      live = false;
      unlisten?.();
    };
  }, []);
}
