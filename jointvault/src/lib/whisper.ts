import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type WhisperModel = 'tiny' | 'base' | 'small';
export type WhisperLang = 'auto' | 'tr' | 'en';

// Ayarlar → Konuşma sekmesinden seçilir; ilk açılışta indirilmez (A10, lazy).
export const WHISPER_MODEL_KEY = 'jv-whisper-model';

export const WHISPER_MODELS: { id: WhisperModel; sizeMb: number; hint: string }[] = [
  { id: 'tiny', sizeMb: 75, hint: 'En hızlı, kaba sonuç.' },
  { id: 'base', sizeMb: 142, hint: 'Dengeli — önerilen.' },
  { id: 'small', sizeMb: 466, hint: 'En doğru, yavaş + büyük indirme.' },
];

export function getWhisperModel(): WhisperModel {
  const v = window.localStorage.getItem(WHISPER_MODEL_KEY);
  return v === 'tiny' || v === 'small' ? v : 'base';
}

export function setWhisperModel(m: WhisperModel): void {
  window.localStorage.setItem(WHISPER_MODEL_KEY, m);
}

export interface WhisperStatus {
  whisper_available: boolean;
  models: Record<WhisperModel, boolean>;
  models_dir: string;
}

// Never-throw: backend'e ulaşılamazsa null döner, çağıran "bilinmiyor" gösterir.
export async function getWhisperStatus(): Promise<WhisperStatus | null> {
  try {
    const raw = await invoke<string>('whisper_status');
    return JSON.parse(raw) as WhisperStatus;
  } catch {
    return null;
  }
}

// Rust renames job_id → jobId in the payload (serde rename).
// whisper-progress: percent 0–100; whisper-model-progress: percent 0–100, -1 = uzunluk bilinmiyor.
export interface WhisperProgressEvent {
  jobId: string;
  percent: number;
}

export interface JobResult {
  ok: boolean;
  error?: string;
}

function toError(e: unknown, fallback: string): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : fallback;
}

// Çağıran jobId'yi ÖNCEDEN üretip ref'e yazar (canlı progress için),
// sonra buraya verir — invoke bitmeden gelen eventler eşleşir.
// Never-throw: reject'i return'e mapler.
export async function downloadModel(model: WhisperModel, jobId: string): Promise<JobResult> {
  try {
    await invoke('download_model', { payload: { model, job_id: jobId } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e, 'Model indirilemedi.') };
  }
}

// whisper.cpp CLI binary'si (~4MB, bir kez). Never-throw.
export async function downloadWhisperEngine(jobId: string): Promise<JobResult> {
  try {
    await invoke('download_whisper_engine', { payload: { job_id: jobId } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e, 'Motor indirilemedi.') };
  }
}

export interface TranscriptData {
  srt_path: string;
  preview: string;
  language: string;
}

export interface TranscribeResult extends JobResult {
  data?: TranscriptData;
}

export async function startTranscribe(
  inputPath: string,
  model: WhisperModel,
  language: WhisperLang,
  jobId: string,
): Promise<TranscribeResult> {
  try {
    const raw = await invoke<string>('transcribe', {
      payload: { input_path: inputPath, job_id: jobId, model, language },
    });
    return { ok: true, data: JSON.parse(raw) as TranscriptData };
  } catch (e) {
    return { ok: false, error: toError(e, 'Transkript üretilemedi.') };
  }
}

export async function embedSubtitle(
  videoPath: string,
  srtPath: string,
  outputPath: string,
  jobId: string,
): Promise<JobResult> {
  try {
    await invoke('embed_subtitle', {
      payload: { video_path: videoPath, srt_path: srtPath, output_path: outputPath, job_id: jobId },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e, 'Altyazı gömülemedi.') };
  }
}

export async function extractSubtitle(
  videoPath: string,
  outputSrt: string,
  jobId: string,
  streamIndex = 0,
): Promise<JobResult> {
  try {
    await invoke('extract_subtitle', {
      payload: {
        video_path: videoPath,
        output_srt: outputSrt,
        job_id: jobId,
        stream_index: streamIndex,
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toError(e, 'Altyazı çıkarılamadı.') };
  }
}

function useWhisperEvent(
  name: 'whisper-progress' | 'whisper-model-progress' | 'whisper-engine-progress',
  onEvent: (e: WhisperProgressEvent) => void,
): void {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    void listen<WhisperProgressEvent>(name, (event) => {
      ref.current(event.payload);
    }).then((u) => {
      if (live) unlisten = u;
      else u();
    });
    return () => {
      live = false;
      unlisten?.();
    };
  }, [name]);
}

// Single 'whisper-progress' subscription (transcribe/embed/extract); unlistens on unmount.
export function useWhisperProgress(onEvent: (e: WhisperProgressEvent) => void): void {
  useWhisperEvent('whisper-progress', onEvent);
}

// Single 'whisper-model-progress' subscription (model download); unlistens on unmount.
export function useWhisperModelProgress(onEvent: (e: WhisperProgressEvent) => void): void {
  useWhisperEvent('whisper-model-progress', onEvent);
}

// Single 'whisper-engine-progress' subscription (engine download); unlistens on unmount.
export function useWhisperEngineProgress(onEvent: (e: WhisperProgressEvent) => void): void {
  useWhisperEvent('whisper-engine-progress', onEvent);
}
