import { useState } from 'react';
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
import { createItem } from '@/lib/db/client';
import { detectPlatform, fetchPreview } from '@/lib/platform';

const MAX_URLS = 50;

interface BulkStatus {
  url: string;
  platform: string;
  state: 'pending' | 'ok' | 'fail';
  reason?: string;
}

interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

const parseUrls = (raw: string): string[] => [...new Set(raw.split('\n').map((l) => l.trim()).filter(Boolean))];

export function BulkImportDialog({ open, onOpenChange, onDone }: BulkImportDialogProps) {
  const [text, setText] = useState('');
  const [statuses, setStatuses] = useState<BulkStatus[]>([]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urls = parseUrls(text);
  const okCount = statuses.filter((s) => s.state === 'ok').length;
  const failCount = statuses.filter((s) => s.state === 'fail').length;

  const handleImport = async (): Promise<void> => {
    if (urls.length === 0) {
      setError('En az bir URL gerekli.');
      return;
    }
    if (urls.length > MAX_URLS) {
      setError(`En fazla ${MAX_URLS} URL — ${urls.length} buldu.`);
      return;
    }
    setError(null);
    setRunning(true);
    setFinished(false);
    // ponytail: sequential loop, no worker pool — 50 items max, simplicity wins.
    setStatuses(urls.map((url) => ({ url, platform: detectPlatform(url), state: 'pending' })));
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const platform = detectPlatform(url);
      try {
        const preview = await fetchPreview(url);
        await createItem({
          url,
          platform,
          title: preview?.title ?? null,
          thumbnail: preview?.thumbnail ?? null,
        });
        setStatuses((prev) => prev.map((s, j) => (j === i ? { ...s, state: 'ok' } : s)));
      } catch (e) {
        // Tauri IPC string reject dönebilir (Error değil) — gerçek mesajı yutma.
        console.error('[bulk]', e);
        const reason = typeof e === 'string' ? e : e instanceof Error ? e.message : 'Kaydetme başarısız.';
        setStatuses((prev) => prev.map((s, j) => (j === i ? { ...s, state: 'fail', reason } : s)));
      }
    }
    setRunning(false);
    setFinished(true);
    onDone();
  };

  const handleOpenChange = (next: boolean): void => {
    if (!next && !running) {
      setText('');
      setStatuses([]);
      setFinished(false);
      setError(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Toplu içe aktar</DialogTitle>
          <DialogDescription>Her satıra bir link — en fazla {MAX_URLS}.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'https://…\nhttps://…'}
            rows={6}
            disabled={running}
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <p className="text-xs text-muted-foreground">
            {urls.length}/{MAX_URLS} link
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {statuses.length > 0 && (
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {statuses.map((s) => (
                <li key={s.url} className="flex items-center gap-2 text-xs">
                  <Badge variant={s.state === 'ok' ? 'default' : s.state === 'fail' ? 'destructive' : 'secondary'}>
                    {s.state === 'pending' ? (running ? '…' : '•') : s.state}
                  </Badge>
                  <Badge variant="outline">{s.platform}</Badge>
                  <span className="truncate">{s.url}</span>
                  {s.reason && <span className="shrink-0 text-destructive">{s.reason}</span>}
                </li>
              ))}
            </ul>
          )}
          {finished && (
            <p className="text-sm">
              {okCount} kaydedildi{failCount > 0 && `, ${failCount} başarısız`}.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={running}>
            {finished ? 'Kapat' : 'Vazgeç'}
          </Button>
          {!finished && (
            <Button onClick={() => void handleImport()} disabled={running || urls.length === 0}>
              {running ? 'Aktarılıyor…' : 'İçe aktar'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
