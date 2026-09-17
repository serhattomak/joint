import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatBytes, listFormats, startDownload, type RemoteFormat } from '@/lib/downloads';

export interface FormatTarget {
  id: string;
  url: string;
  title?: string | null;
}

interface FormatDialogProps {
  target: FormatTarget | null;
  onClose: () => void;
  onDone: () => void;
}

function fmtLabel(f: RemoteFormat): string {
  const h = f.height ? `${f.height}p` : 'Sesli';
  const size = formatBytes(f.filesize);
  return `${h} · ${f.ext} · ${size}`;
}

// Linkin GERÇEK seçenekleri: yt-dlp -J çıktısı satır satır sunulur.
export function FormatDialog({ target, onClose, onDone }: FormatDialogProps) {
  const [formats, setFormats] = useState<RemoteFormat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setFormats(null);
    setError(null);
    setBusyId(null);
    void listFormats(target.url)
      .then(setFormats)
      .catch((e: unknown) =>
        setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Formatlar okunamadı.'),
      );
  }, [target]);

  const pick = async (f: RemoteFormat): Promise<void> => {
    if (!target || busyId) return;
    setBusyId(f.id);
    const kind = f.vcodec !== 'none' ? ('video' as const) : ('audio' as const);
    await startDownload(target.id, target.url, kind, '720', f.id);
    onDone();
    onClose();
  };

  const presetFallback = async (): Promise<void> => {
    if (!target || busyId) return;
    setBusyId('preset');
    await startDownload(target.id, target.url, 'video', '720');
    onDone();
    onClose();
  };

  const videos = (formats ?? []).filter((f) => f.vcodec !== 'none').sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const audios = (formats ?? []).filter((f) => f.vcodec === 'none');

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Format seç</DialogTitle>
          <DialogDescription>
            {target?.title ? target.title : 'Bu linkin sunduğu gerçek seçenekler.'}
          </DialogDescription>
        </DialogHeader>
        {formats === null && !error && <p className="text-sm text-muted-foreground">Formatlar okunuyor…</p>}
        {error && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void presetFallback()} disabled={busyId !== null}>
              {busyId ? 'Başlatılıyor…' : 'Preset ile devam (720p)'}
            </Button>
          </div>
        )}
        {videos.length > 0 && (
          <div className="flex flex-col gap-1">
            <h4 className="text-micro font-medium text-muted-foreground">Video</h4>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {videos.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => void pick(f)}
                    disabled={busyId !== null}
                    className="flex w-full items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-sm transition hover:bg-muted disabled:opacity-60"
                  >
                    <span>{fmtLabel(f)}</span>
                    <span className="text-xs text-muted-foreground">{busyId === f.id ? '…' : 'İndir'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {audios.length > 0 && (
          <div className="flex flex-col gap-1">
            <h4 className="text-micro font-medium text-muted-foreground">Ses</h4>
            <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto">
              {audios.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => void pick(f)}
                    disabled={busyId !== null}
                    className="flex w-full items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-sm transition hover:bg-muted disabled:opacity-60"
                  >
                    <span>
                      {f.ext} · {formatBytes(f.filesize)}
                    </span>
                    <span className="text-xs text-muted-foreground">{busyId === f.id ? '…' : 'İndir'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
