import { useCallback, useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listDownloadJobs, listDownloadedItems } from '@/lib/db/client';
import {
  DOWNLOADS_CHANGED_EVENT,
  useDownloadProgress,
  type DownloadProgressEvent,
} from '@/lib/downloads';
import {
  formatSpeed,
  useTurboProgressListener,
  type TurboProgressPayload,
} from '@/lib/turbo_download';

/**
 * Araç çubuğunun altındaki indirme şeridi — IDM'in panelinin karşılığı:
 * hangi ekranda olursan ol süren indirmeler görünür ve tek tıkla yönetime
 * gidilir. Yalnız iş varken çizilir.
 *
 * İki kaynak tek yerde toplanır:
 * - **Çok kanallı motor**: olayın kendisi terminal durumu (`completed`/`error`)
 *   taşır, yani defter olaylarla güncel kalır.
 * - **Medya indirmeleri (yt-dlp)**: `download-progress` yüzdeyi verir ama
 *   **bitişi vermez**; bitiş `DOWNLOADS_CHANGED_EVENT` ile bildirilir ve defter
 *   yeniden okunur. Hız metni de yalnız bu motorda sayıdır — yt-dlp hızı metin
 *   olduğu için toplanmaz, uydurulmaz.
 */
export function DownloadStrip({ onOpen }: { onOpen?: () => void }) {
  /** Çok kanallı işler: terminal durumda silinen kalıcı defter. */
  const [turbo, setTurbo] = useState<Record<string, { percent: number; speed: number }>>({});
  /** Medya indirmelerinin yüzde akışı (sayımı DB verir). */
  const [itemPercent, setItemPercent] = useState<Record<string, number>>({});
  const [itemCounts, setItemCounts] = useState({ active: 0, queued: 0 });
  /** Kullanıcının kapattığı indirme kümesi: yeni bir indirme başlayınca geri gelir. */
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);

  const refreshCounts = useCallback(async (): Promise<void> => {
    try {
      const [jobs, items] = await Promise.all([listDownloadJobs(), listDownloadedItems()]);
      setTurbo((prev) => {
        const next: Record<string, { percent: number; speed: number }> = {};
        for (const job of jobs) {
          if (job.status !== 'active' && job.status !== 'queued') continue;
          const percent =
            job.file_size > 0
              ? (job.downloaded_size / job.file_size) * 100
              : (prev[job.id]?.percent ?? 0);
          next[job.id] = { percent, speed: job.speed_bps || 0 };
        }
        return next;
      });
      setItemCounts({
        active: items.filter((i) => i.download_status === 'active').length,
        queued: items.filter((i) => i.download_status === 'queued').length,
      });
    } catch {
      // Arşiv okunamıyorsa şerit sessiz kalır; hata zaten başka yerde bildirilir.
    }
  }, []);

  useEffect(() => {
    void refreshCounts();
    const onChanged = (): void => void refreshCounts();
    window.addEventListener(DOWNLOADS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(DOWNLOADS_CHANGED_EVENT, onChanged);
  }, [refreshCounts]);

  useTurboProgressListener(
    useCallback((payload: TurboProgressPayload) => {
      setTurbo((prev) => {
        const next = { ...prev };
        if (payload.status === 'active' || payload.status === 'queued') {
          next[payload.job_id] = { percent: payload.percent, speed: payload.speed_bps };
        } else {
          delete next[payload.job_id];
        }
        return next;
      });
    }, []),
  );

  useDownloadProgress(
    useCallback((e: DownloadProgressEvent) => {
      setItemPercent((p) => ({ ...p, [e.itemId]: e.percent }));
    }, []),
  );

  const turboIds = Object.keys(turbo).filter((id) => (turbo[id]?.percent ?? 0) < 100);
  const itemPercents = Object.values(itemPercent).filter((p) => p < 100);
  const downloading = turboIds.length + itemCounts.active;
  const queued = itemCounts.queued;
  const total = downloading + queued;

  /*
   * "Kapat" bu indirme kümesi için geçerlidir: küme değişince (yeni indirme
   * başlayınca) şerit kendiliğinden geri gelir. Etkide `setState` yok —
   * gizleme kararı render'da türetilir.
   */
  const stripKey = `${[...turboIds, ...Object.keys(itemPercent)].sort().join('|')}#${itemCounts.active}/${itemCounts.queued}`;
  if (total === 0 || hiddenKey === stripKey) return null;

  const speed = turboIds.reduce((sum, id) => sum + (turbo[id]?.speed ?? 0), 0);
  const percents = [...turboIds.map((id) => turbo[id]?.percent ?? 0), ...itemPercents];
  const average = percents.length
    ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length)
    : 0;

  return (
    <div className="sticky top-[52px] z-30 flex h-11 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur">
      <Download className="size-4 shrink-0 text-primary" aria-hidden />
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1 text-left transition-colors enabled:hover:bg-muted/60"
      >
        <span className="shrink-0 text-sm font-medium">
          {total} indirme
          {downloading > 0 && queued > 0 ? ` (${downloading} iniyor, ${queued} kuyrukta)` : ''}
        </span>
        {downloading > 0 && (
          <>
            <span className="relative h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-muted">
              <span
                className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-300"
                style={{ width: `${average}%` }}
              />
            </span>
            <span data-num className="text-2xs text-muted-foreground">
              %{average}
              {speed > 0 ? ` · ${formatSpeed(speed)}` : ''}
            </span>
          </>
        )}
        {onOpen && <span className="text-2xs text-muted-foreground">Yönet</span>}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="İndirme şeridini kapat"
        title="Kapat (indirmeler sürer)"
        onClick={() => setHiddenKey(stripKey)}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
