/*
 * Bileşenler — indirme köprüsü ve durum sözleşmesi.
 *
 * 7b'den itibaren TÜM bileşen indirmeleri tek motordan (`component_download.rs`)
 * geçer ve tek olay yayar: `component-download-progress`. Olayın adı ve gövdesi
 * burada BİR kez tanımlanır; whisper/AI tüketicileri de buradan içe aktarır ki
 * kopyalar zamanla ayrışmasın (eskiden her modül kendi kopyasını taşıyordu).
 */
import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { describeError } from './errors';

export interface ComponentStatus {
  id: string;
  label: string;
  /** İndirme boyutu; aynı arşivi paylaşan satırlar aynı sayıyı taşır. */
  approx_mb: number;
  installed: boolean;
  /** Dosya var VE çalıştırılabiliyor mu (sürüm okunabildi mi). */
  runnable: boolean;
  path: string | null;
  source: 'downloaded' | 'bundled' | null;
  version: string | null;
  /** Pinlenmiş kaynağı olmayan bileşen indirilebilir SAYILMAZ (yt-dlp, whisper). */
  downloadable: boolean;
  /** Aynı arşivi paylaşan satırların paket kimliği (ör. `ffmpeg-tools`). */
  bundle: string | null;
  /** İçerik biçimi: `archive` (zip) ya da `plain`; indirilemeyende null. */
  framework: 'archive' | 'plain' | null;
}

/** İndirme fazları (Rust `phase` alanının sözleşmesi). */
export type ComponentDownloadPhase = 'downloading' | 'verifying' | 'extracting' | 'done';

/** Tek indirme olayının adı; tüm indirmeler bunu yayar, tüketici `jobId` ile süzer. */
export const COMPONENT_DOWNLOAD_PROGRESS_EVENT = 'component-download-progress';

export interface ComponentDownloadProgressEvent {
  jobId: string;
  /** PAKET kimliği (ör. `ffmpeg-tools`) — satır id'si olmak zorunda değil. */
  componentId: string;
  /** -1 → toplam uzunluk bilinmiyor; "0" diye gösterilmemeli. */
  percent: number;
  downloadedBytes: number;
  totalBytes: number | null;
  phase: ComponentDownloadPhase;
}

export interface ComponentDownloadResult {
  ok: boolean;
  error?: string;
}

/*
 * Ref-stable abonelik: her render'da callback tazelenir ama `listen` yeniden
 * kurulmaz. Unmount'ta bırakılır; `live` bayrağı, `listen` çözülmeden unmount
 * olunursa dinleyicinin sızmasını önler. Promise `void` ile bağlanır.
 *
 * Ref senkronu render'da DEĞİL, effect'te yapılır: render sırasında `ref.current`
 * yazmak oxlint'in `react/refs` kuralını tetikler (depoda bu desenin 6 kopyası
 * zaten uyarı üretiyor; burada yenisini eklemiyoruz).
 */
export function useComponentDownloadProgress(
  onEvent: (event: ComponentDownloadProgressEvent) => void,
): void {
  const ref = useRef(onEvent);
  useEffect(() => {
    ref.current = onEvent;
  });
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    void listen<ComponentDownloadProgressEvent>(COMPONENT_DOWNLOAD_PROGRESS_EVENT, (event) => {
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

/*
 * Bileşen indir. `componentId` kayıt id'sidir (`ffmpeg`), paket kimliği değil:
 * komut pinlenmiş kaynağı bu id ile çözer. Never-throw — reject
 * `{ ok: false, error }` olur ve hata metni backend'den hazır Türkçe gelir.
 */
export async function downloadComponent(
  componentId: string,
  jobId: string,
): Promise<ComponentDownloadResult> {
  try {
    await invoke<string>('component_download', {
      payload: { component_id: componentId, job_id: jobId },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeError(error, 'Bileşen indirilemedi.') };
  }
}

/*
 * Çalışan/kuyruktaki indirmeyi iptal et. Never-throw; `true` = iş bulundu.
 * İptal, indirme promise'ini redde düşürür; bu bir hata değildir (arayüz bilgi
 * bildirimi gösterir).
 */
export async function cancelComponentDownload(jobId: string): Promise<boolean> {
  try {
    return await invoke<boolean>('component_cancel', { jobId });
  } catch {
    return false;
  }
}
