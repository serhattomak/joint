import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useNotice } from '@/components/ui/notice';
import { createDownloadJob, detectCategoryFromFilename } from '@/lib/db/client';
import { destinationPath, uniqueDownloadPath } from '@/lib/downloads';
import {
  DEFAULT_DOWNLOAD_SETTINGS,
  getDownloadSettings,
  probeUrl,
  startTurboDownload,
  type RequestHeaders,
} from '@/lib/turbo_download';

/** Köprüden gelen devralınmış indirme (`collect.rs` → `turbo-capture-download`). */
interface CapturedDownload {
  url: string;
  filename?: string | null;
  referer?: string | null;
  cookie?: string | null;
  user_agent?: string | null;
}

/** Eklenti ad vermediyse URL'nin son parçası; o da yoksa zaman damgası. */
function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(last) || `indirme-${Date.now()}`;
  } catch {
    return `indirme-${Date.now()}`;
  }
}

/**
 * Güven sınırı: eklenti (ve dolayısıyla sayfa) ne gönderirse göndersin, hedef
 * yalnızca **dosya adı** olur. Yol ayırıcıları, `.`/`..` ve Windows'ta yasak
 * karakterler burada kesilir — aksi hâlde hedef yol indirme klasörünün dışına
 * çıkabilirdi.
 */
function safeFileName(raw: string, fallback: string): string {
  const base = String(raw ?? '')
    .split(/[/\\]/)
    .pop() ?? '';
  const clean = base.replace(/[:*?"<>|]/g, '_').trim();
  if (!clean || clean === '.' || clean === '..') return fallback;
  return clean;
}

/**
 * Tarayıcının devrettiği indirmeleri karşılar — IDM'in "hiçbir şey yapmadan
 * indir" davranışı: diyalog açılmaz, iş doğrudan kuyruğa girer.
 *
 * Çerez ve `Referer` motora geçirilir: oturum gerektiren sunucularda bunlar
 * olmadan indirme 403 döner.
 */
export function DownloadCaptureBridge({ onStarted }: { onStarted?: () => void }) {
  const notice = useNotice();
  const startedRef = useRef(onStarted);
  // "En güncel ref" deseni: render sırasında ref yazmak lint kuralını ihlal eder.
  useEffect(() => {
    startedRef.current = onStarted;
  });

  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;

    const handle = async (payload: CapturedDownload): Promise<void> => {
      try {
        const headers: RequestHeaders = {
          referer: payload.referer ?? null,
          cookie: payload.cookie ?? null,
          user_agent: payload.user_agent ?? null,
        };
        const probed = await probeUrl(payload.url, headers).catch(() => null);
        const proposed = safeFileName(
          (payload.filename || '').trim() || probed?.filename || '',
          nameFromUrl(payload.url),
        );
        const category = detectCategoryFromFilename(proposed);
        const dir = (await invoke<string>('get_download_dir')).replace(/[/\\]+$/, '');
        const settings = await getDownloadSettings().catch(() => null);
        const separate = settings?.category_folders ?? DEFAULT_DOWNLOAD_SETTINGS.category_folders;
        // Üzerine yazma yok: aynı ad varsa ` (2)` eklenir (veri kaybı önlenir).
        const destination = await uniqueDownloadPath(
          destinationPath(dir, proposed, category, separate),
        );

        const job = await createDownloadJob({
          url: payload.url,
          filename: destination.split(/[/\\]/).pop() ?? proposed,
          destination_path: destination,
          file_size: probed?.file_size ?? 0,
          threads: settings?.default_connections ?? DEFAULT_DOWNLOAD_SETTINGS.default_connections,
          category,
          status: 'active',
        });
        await startTurboDownload({
          jobId: job.id,
          url: job.url,
          filename: job.filename,
          destinationPath: job.destination_path,
          fileSize: job.file_size,
          threads: job.threads,
          headers,
        });
        notice.push({ text: `Tarayıcıdan devralındı: ${job.filename}`, tone: 'ok' });
        startedRef.current?.();
      } catch (e) {
        notice.push({
          text: `Devralınan indirme başlatılamadı: ${
            typeof e === 'string' ? e : 'bilinmeyen hata'
          }`,
          tone: 'error',
        });
      }
    };

    void listen<CapturedDownload>('turbo-capture-download', (event) => {
      void handle(event.payload);
    }).then((fn) => {
      if (live) unlisten = fn;
      else fn();
    });

    return () => {
      live = false;
      unlisten?.();
    };
  }, [notice]);

  return null;
}
