import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createItem, listItems } from '@/lib/db/client';
import { detectPlatform, fetchPreview } from '@/lib/platform';
import { canonicalizeUrl, isKnownUrl } from '@/lib/urls';

interface XSyncMeta {
  url: string;
  title?: string | null;
  thumbnail?: string | null;
  site?: string | null;
}

interface XSyncPayload {
  items: XSyncMeta[];
}

interface XSyncRow {
  url: string;
  title: string | null;
  thumbnail: string | null;
  platform: string;
  skipped: boolean;
  skipReason?: 'db' | 'batch';
  state: 'pending' | 'ok' | 'fail';
  reason?: string;
}

interface XSyncReviewDialogProps {
  onDone?: () => void;
}

export function XSyncReviewDialog({ onDone }: XSyncReviewDialogProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<XSyncRow[]>([]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<XSyncPayload>('x-sync-collect', async (event) => {
      const raw = event.payload?.items ?? [];
      const metas = raw.filter((m) => m && typeof m.url === 'string' && m.url.trim());
      if (metas.length === 0) return;
      // Snapshot existing URLs once — code-level dedupe, no schema migration.
      let existing: string[] = [];
      try {
        existing = (await listItems()).map((i) => i.url);
      } catch {
        existing = [];
      }
      const seen = new Set<string>();
      const next: XSyncRow[] = metas.map((m) => {
        const url = m.url.trim();
        const key = canonicalizeUrl(url);
        const inDb = isKnownUrl(existing, url);
        const inBatch = seen.has(key);
        seen.add(key);
        return {
          url,
          title: m.title?.trim() ? m.title.trim() : null,
          thumbnail: m.thumbnail?.trim() ? m.thumbnail.trim() : null,
          platform: detectPlatform(url),
          skipped: inDb || inBatch,
          skipReason: inDb ? 'db' : inBatch ? 'batch' : undefined,
          state: 'pending' as const,
        };
      });
      setRows(next);
      setFinished(false);
      setOpen(true);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const savable = rows.filter((r) => !r.skipped);
  const skippedCount = rows.filter((r) => r.skipped).length;
  const okCount = rows.filter((r) => r.state === 'ok').length;
  const failCount = rows.filter((r) => r.state === 'fail').length;

  const handleConfirm = async (): Promise<void> => {
    setRunning(true);
    setFinished(false);
    // ponytail: sequential loop, same as bulk — small batches, simplicity wins.
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].skipped) continue;
      const row = rows[i];
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
        await createItem({ url: row.url, platform, title, thumbnail });
        setRows((prev) => prev.map((r, j) => (j === i ? { ...r, state: 'ok' } : r)));
      } catch (e) {
        console.error('[x-sync]', e);
        const reason = typeof e === 'string' ? e : e instanceof Error ? e.message : 'Kaydetme başarısız.';
        setRows((prev) => prev.map((r, j) => (j === i ? { ...r, state: 'fail', reason } : r)));
      }
    }
    setRunning(false);
    setFinished(true);
    onDone?.();
  };

  const handleOpenChange = (next: boolean): void => {
    if (!next && !running) {
      setOpen(false);
      setRows([]);
      setFinished(false);
    } else if (next) {
      setOpen(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>X senkronizasyon — önizle ve onayla</DialogTitle>
          <DialogDescription>
            {savable.length} yeni, {skippedCount} tekrar atlanacak.
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
              {r.skipped ? (
                <Badge variant="secondary">{r.skipReason === 'db' ? 'KAYITLI' : 'ÇİFT'}</Badge>
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
        {finished && (
          <p className="text-sm">
            {okCount} kaydedildi{skippedCount > 0 && `, ${skippedCount} atlandı`}
            {failCount > 0 && `, ${failCount} başarısız`}.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={running}>
            {finished ? 'Kapat' : 'Vazgeç'}
          </Button>
          {!finished && (
            <Button onClick={() => void handleConfirm()} disabled={running || savable.length === 0}>
              {running ? 'Kaydediliyor…' : 'Onayla ve kaydet'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
