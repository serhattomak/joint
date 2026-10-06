import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTranscriptData, isWhisperStatus } from './backend-contracts';
// İndirme olayının adı/gövdesi ve kancası tek yerde (`components.ts`) tanımlı;
// burada YENİDEN TANIMLANMAZ, yalnızca içe aktarılır (kopya ayrışmasın).
import { type ComponentDownloadProgressEvent, useComponentDownloadProgress } from './components';

export type WhisperModel = 'tiny' | 'base' | 'small' | 'large-v3-q5_0' | 'large-v3';
export type WhisperLang = 'auto' | 'tr' | 'en';

// Ayarlar → Konuşma sekmesinden seçilir; ilk açılışta indirilmez (A10, lazy).
export const WHISPER_MODEL_KEY = 'jv-whisper-model';

/*
 * Boyutlar kayıttaki (`components.rs`) `approx_mb` pinleriyle BİREBİR aynıdır:
 * `whisper-model-tiny/base/small/large-v3-q5_0/large-v3` = 74/141/465/1031/2951.
 * 7c-3 öncesi burada 75/142/466 yazıyordu ve Ayarlar → Bileşenler aynı modeller
 * için farklı sayı gösterirdi (iki gerçek). Bileşen ekranı boyutu gerçek kaynaktan
 * (`components_status`) okur; burası durum okunamadığında başvurulan tek ve doğru
 * yedektir.
 */
export const WHISPER_MODELS: { id: WhisperModel; sizeMb: number; hint: string }[] = [
  { id: 'tiny', sizeMb: 74, hint: 'En hızlı, kaba sonuç.' },
  { id: 'base', sizeMb: 141, hint: 'Dengeli — önerilen.' },
  { id: 'small', sizeMb: 465, hint: 'En doğru, yavaş + büyük indirme.' },
  { id: 'large-v3-q5_0', sizeMb: 1031, hint: 'Türkçe için çok doğru; sıkıştırılmış, daha hızlı.' },
  { id: 'large-v3', sizeMb: 2951, hint: 'En yüksek doğruluk; en yavaş ve en büyük indirme.' },
];

export function getWhisperModel(): WhisperModel {
  const v = window.localStorage.getItem(WHISPER_MODEL_KEY);
  return WHISPER_MODELS.find((m) => m.id === v)?.id ?? 'base';
}

export function setWhisperModel(m: WhisperModel): void {
  window.localStorage.setItem(WHISPER_MODEL_KEY, m);
}

export interface WhisperStatus {
  whisper_available: boolean;
  models: Record<WhisperModel, boolean>;
  models_dir: string;
}

// Never-throw: backend'e ulaşılamazsa VEYA yanıt şekli beklenenden farklıysa
// null döner; çağıran "bilinmiyor" gösterir.
export async function getWhisperStatus(): Promise<WhisperStatus | null> {
  try {
    const raw = await invoke<string>('whisper_status');
    const parsed: unknown = JSON.parse(raw);
    if (!isWhisperStatus(parsed)) {
      console.warn('[whisper_status] beklenmeyen yanıt şekli');
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

// Rust renames job_id → jobId in the payload (serde rename).
// whisper-progress: transcode/embed/extract ilerlemesi (indirme DEĞİL), percent 0–100.
export interface WhisperProgressEvent {
  jobId: string;
  percent: number;
}

// Paylaşılan indirme motorunun olayı ve gövdesi `components.ts`'te yaşar:
// `COMPONENT_DOWNLOAD_PROGRESS_EVENT` + `ComponentDownloadProgressEvent`.
// İndirmeler (whisper motoru + modelleri, AI engine + modelleri) oradan yayılır;
// tüketici kendi `jobId`'siyle süzer. percent -1 = toplam uzunluk bilinmiyor.

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
    const parsed: unknown = JSON.parse(raw);
    if (!isTranscriptData(parsed)) {
      return { ok: false, error: 'Transkript yanıtı beklenmeyen şekilde geldi.' };
    }
    return { ok: true, data: parsed };
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

function useTauriEvent<T>(name: string, onEvent: (e: T) => void): void {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    void listen<T>(name, (event) => {
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
  useTauriEvent<WhisperProgressEvent>('whisper-progress', onEvent);
}

// Whisper model indirmesi: paylaşılan motorun canonical olayına abone (eski ad korundu, çağıran değişmesin).
export function useWhisperModelProgress(
  onEvent: (e: ComponentDownloadProgressEvent) => void,
): void {
  useComponentDownloadProgress(onEvent);
}

// Whisper motoru indirmesi: paylaşılan motorun olayına abone (eski ad korundu).
export function useWhisperEngineProgress(
  onEvent: (e: ComponentDownloadProgressEvent) => void,
): void {
  useComponentDownloadProgress(onEvent);
}
