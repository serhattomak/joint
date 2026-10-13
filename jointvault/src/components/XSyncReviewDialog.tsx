import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNotice } from '@/components/ui/notice';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createItem, listItems } from '@/lib/db/client';
import type { FormatTarget } from '@/components/FormatDialog';
import {
  getDefaultQuality,
  startDownload,
  type DownloadKind,
  type DownloadQuality,
} from '@/lib/downloads';
import { detectPlatform, fetchPreview } from '@/lib/platform';
import { scrapeAndStoreArticle } from '@/lib/scraper';
import { canonicalizeUrl, isKnownUrl } from '@/lib/urls';

interface XSyncMeta {
  url: string;
  title?: string | null;
  thumbnail?: string | null;
  site?: string | null;
}

interface XSyncPayload {
  items: XSyncMeta[];
  mode?: string | null;
  kind?: string | null;
  quality?: string | null;
  /** Diyaloğu açmadan hemen indir (eklentinin "sormadan indir" menüsü). */
  silent?: boolean | null;
}

interface XSyncRow {
  url: string;
  title: string | null;
  thumbnail: string | null;
  platform: string;
  skipped: boolean;
  skipReason?: 'db' | 'batch' | 'done';
  wantDownload: boolean;
  kind: DownloadKind;
  quality: DownloadQuality;
  state: 'pending' | 'ok' | 'fail';
  reason?: string;
}

interface XSyncReviewDialogProps {
  onDone?: () => void;
  /**
   * İndirilecek kayıt **tek** olduğunda çağrılır: linkin gerçek formatlarını
   * sunan `FormatDialog` açılır. Verilmezse (ya da birden çok kayıt varsa)
   * preset kaliteyle indirilir. İki diyalog üst üste binmesin diye yalnız tek
   * kayıtta devreye girer.
   */
  onPickFormat?: (target: FormatTarget) => void;
}

export function XSyncReviewDialog({ onDone, onPickFormat }: XSyncReviewDialogProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<XSyncRow[]>([]);
  const [running, setRunning] = useState(false);
  /** Diyaloğu açmadan koşma isteği (eklentinin "sormadan indir" menüsü). */
  const [silentRequest, setSilentRequest] = useState(false);
  const notice = useNotice();

  /**
   * Ortak yürütme: hem diyalogdan onaylanınca hem "sormadan" istendiğinde
   * aynı iş koşar. Ayrı kopyalar zamanla ayrışırdı.
   *
   * `pickFormat` açıkken **tek** indirilecek kayıt varsa indirme başlatılmaz;
   * çağıran gerçek format listesini (FormatDialog) açar. Bu, IDM'in "Download
   * File Info" adımının karşılığıdır: kullanıcı kaliteyi/formatı seçer.
   */
  const runRows = useCallback(
    async (
      targets: XSyncRow[],
      pickFormat: boolean,
    ): Promise<{ ok: number; failed: number; skipped: number }> => {
      setRunning(true);
      const downloadRows = targets.filter((r) => r.wantDownload && !r.skipped);
      const singleDownload = pickFormat && downloadRows.length === 1;
      let ok = 0;
      let failed = 0;
      let skipped = 0;
      // ponytail: sequential loop, same as bulk — small batches, simplicity wins.
      for (let i = 0; i < targets.length; i++) {
        if (targets[i].skipped) {
          skipped += 1;
          continue;
        }
        const row = targets[i];
        const platform = detectPlatform(row.url);
        try {
          let title = row.title;
          let thumbnail = row.thumbnail;
          if (!title || !thumbnail) {
            let preview: { title: string | null; thumbnail: string | null } | null = null;
            try {
              preview = await fetchPreview(row.url);
            } catch {
              preview = null;
            }
            title ??= preview?.title ?? null;
            thumbnail ??= preview?.thumbnail ?? null;
          }
          const item = await createItem({ url: row.url, platform, title, thumbnail });
          // Arka planda tweet/post içeriğini kazı ve FTS5'e indeksle
          void scrapeAndStoreArticle(item.id, row.url).catch(() => {});

          if (row.wantDownload && singleDownload && onPickFormat) {
            onPickFormat({ id: item.id, url: row.url, title });
          } else if (row.wantDownload) {
            // startDownload never throws — failures land in download_error state.
            await startDownload(item.id, row.url, row.kind, row.quality);
          }
          ok += 1;
          setRows((prev) => prev.map((r, j) => (j === i ? { ...r, state: 'ok' } : r)));
        } catch (e) {
          console.error('[x-sync]', e);
          failed += 1;
          const reason =
            typeof e === 'string' ? e : e instanceof Error ? e.message : 'Kaydetme başarısız.';
          setRows((prev) => prev.map((r, j) => (j === i ? { ...r, state: 'fail', reason } : r)));
        }
      }
      setRunning(false);
      onDone?.();
      return { ok, failed, skipped };
    },
    [onDone, onPickFormat],
  );

  /** "Sormadan indir": diyalog açılmaz, iş hemen koşar ve sonuç bildirimle duyurulur. */
  useEffect(() => {
    if (!silentRequest) return;
    setSilentRequest(false);
    void runRows(rows, false).then(({ ok }) => {
      notice.push(
        ok > 0
          ? {
              text: `${ok} içerik arşive eklendi ve inmeye başladı.`,
              tone: 'ok',
            }
          : { text: 'İçerik zaten arşivdeydi; yeni bir şey eklenmedi.', tone: 'info' },
      );
    });
  }, [silentRequest, rows, runRows, notice]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unlistenDl: (() => void) | null = null;

    const buildRows = async (payload: XSyncPayload): Promise<void> => {
      const raw = payload.items ?? [];
      const metas = raw.filter((m) => m && typeof m.url === 'string' && m.url.trim());
      if (metas.length === 0) return;
      const wantDownload = payload.mode === 'download';
      const kind: DownloadKind = payload.kind === 'audio' ? 'audio' : 'video';
      // Kalite verilmediyse uygulamanın varsayılan kalite ayarı geçerlidir
      // (Ayarlar → İndirme). Eklentinin "sormadan indir" menüsü kalite göndermez.
      const wanted = payload.quality;
      const quality: DownloadQuality = (
        ['360', '480', '720', '1080', '1440', '2160'] as const
      ).includes(wanted as DownloadQuality)
        ? (wanted as DownloadQuality)
        : getDefaultQuality();
      // Snapshot existing items once — dedupe + skip-already-downloaded.
      let existing: { url: string; status: string }[] = [];
      try {
        existing = (await listItems()).map((i) => ({ url: i.url, status: i.download_status }));
      } catch {
        existing = [];
      }
      const seen = new Set<string>();
      const next: XSyncRow[] = metas.map((m) => {
        const url = m.url.trim();
        const key = canonicalizeUrl(url);
        const known = existing.find((e) => isKnownUrl([e.url], url));
        const inDb = Boolean(known);
        const alreadyDone = wantDownload && known?.status === 'done';
        const inBatch = seen.has(key);
        seen.add(key);
        return {
          url,
          title: m.title?.trim() ? m.title.trim() : null,
          thumbnail: m.thumbnail?.trim() ? m.thumbnail.trim() : null,
          platform: detectPlatform(url),
          skipped: inDb || inBatch || alreadyDone,
          skipReason: alreadyDone ? 'done' : inDb ? 'db' : inBatch ? 'batch' : undefined,
          wantDownload,
          kind,
          quality,
          state: 'pending' as const,
        };
      });
      setRows(next);
      // "Sormadan indir": diyalog hiç açılmaz, aşağıdaki etki işi hemen koşar.
      if (wantDownload && payload.silent) {
        setSilentRequest(true);
        return;
      }
      setOpen(true);
    };

    void listen<XSyncPayload>('x-sync-collect', (event) => buildRows(event.payload)).then((fn) => {
      unlisten = fn;
    });
    void listen<XSyncPayload>('x-sync-download', (event) => buildRows(event.payload)).then((fn) => {
      unlistenDl = fn;
    });
    return () => {
      unlisten?.();
      unlistenDl?.();
    };
  }, []);

  const savable = rows.filter((r) => !r.skipped);
  const skippedCount = rows.filter((r) => r.skipped).length;
  /** Onaydan sonra format seçimi mi gelecek? Düğme bunu söyler. */
  const willAskFormat =
    Boolean(onPickFormat) && rows.filter((r) => r.wantDownload && !r.skipped).length === 1;

  const handleConfirm = async (): Promise<void> => {
    const { ok, failed, skipped } = await runRows(rows, true);
    // Özet diyalogda kalmaz: onay bitti, pop-up kapanır ve sonuç bildirimle
    // duyurulur (IDM de onaydan sonra penceresini açık tutmaz).
    notice.push(
      failed > 0
        ? { text: `${ok} kaydedildi, ${failed} başarısız.`, tone: 'error' }
        : {
            text: `${ok} kaydedildi${skipped > 0 ? `, ${skipped} atlandı` : ''}.`,
            tone: 'ok',
          },
    );
    setRunning(false);
    setOpen(false);
    setRows([]);
  };

  const handleOpenChange = (next: boolean): void => {
    if (!next && !running) {
      setOpen(false);
      setRows([]);
    } else if (next) {
      setOpen(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Önizle ve onayla</DialogTitle>
          <DialogDescription>
            {savable.length} yeni, {skippedCount} atlanacak.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.url} className="flex items-center gap-2 text-xs">
              {r.thumbnail && (
                <img src={r.thumbnail} alt="" className="size-8 shrink-0 rounded object-cover" />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{r.title ?? r.url}</span>
                <span className="truncate text-muted-foreground">{r.url}</span>
              </div>
              <Badge variant="outline">{r.platform}</Badge>
              {r.wantDownload && <Badge variant="default">İNDİRME</Badge>}
              {r.skipped ? (
                <Badge variant="secondary">
                  {r.skipReason === 'done' ? 'İNDİ' : r.skipReason === 'db' ? 'KAYITLI' : 'ÇİFT'}
                </Badge>
              ) : (
                <Badge
                  variant={r.state === 'ok' ? 'default' : r.state === 'fail' ? 'destructive' : 'secondary'}
                >
                  {r.state === 'pending' ? (running ? '…' : '•') : r.state}
                </Badge>
              )}
              {r.reason && <span className="shrink-0 text-destructive">{r.reason}</span>}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={running}>
            Vazgeç
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={running || savable.length === 0}>
            {running ? 'İşleniyor…' : willAskFormat ? 'Devam et (format seç)' : 'Onayla ve kaydet'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
