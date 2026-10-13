import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatBytes, listFormats, startDownload, type RemoteFormat } from '@/lib/downloads';
import { getDownloadSettings } from '@/lib/turbo_download';

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
  /** Başlatılan son indirme: ekranda kalırken ne olduğunu söyler. */
  const [started, setStarted] = useState<string | null>(null);
  /** Ayarlar: kapalıyken ekran açık kalır ve elle kapatılır (varsayılan kapalı). */
  const [autoClose, setAutoClose] = useState(false);

  useEffect(() => {
    if (!target) return;
    setFormats(null);
    setError(null);
    setStarted(null);
    void listFormats(target.url)
      .then(setFormats)
      .catch((e: unknown) =>
        setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Formatlar okunamadı.'),
      );
    void getDownloadSettings()
      .then((s) => setAutoClose(s.close_format_after_pick))
      .catch(() => setAutoClose(false));
  }, [target]);

  /**
   * İndirmeyi **beklemeden** başlatır: `startDownload` yt-dlp bitene kadar
   * çözülür, beklemek ekranı indirme boyunca kilitler ve çıkış yolu bırakmaz.
   * Bitince `onDone` ile arşiv tazelenir; ilerleme zaten şeritte ve listede.
   */
  const start = (kind: 'video' | 'audio', formatId: string | undefined, label: string): void => {
    if (!target) return;
    setStarted(label);
    void startDownload(target.id, target.url, kind, '720', formatId).then(() => onDone());
    if (autoClose) onClose();
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => start('video', undefined, 'Preset (720p)')}
            >
              Preset ile devam (720p)
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
                    onClick={() => start('video', f.id, fmtLabel(f))}
                    className="flex w-full items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-sm transition hover:bg-muted"
                  >
                    <span>{fmtLabel(f)}</span>
                    <span className="text-xs text-muted-foreground">İndir</span>
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
                    onClick={() => start('audio', f.id, `Ses · ${f.ext}`)}
                    className="flex w-full items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-sm transition hover:bg-muted"
                  >
                    <span>
                      {f.ext} · {formatBytes(f.filesize)}
                    </span>
                    <span className="text-xs text-muted-foreground">İndir</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="min-w-0 flex-1 truncate text-micro text-muted-foreground" title={started ?? ''}>
            {started ? `İndirme başladı: ${started} · arka planda sürüyor` : ''}
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            Kapat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
