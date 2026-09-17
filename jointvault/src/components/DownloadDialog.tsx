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
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { createItem } from '@/lib/db/client';
import { startDownload, type DownloadKind } from '@/lib/downloads';
import { detectPlatform } from '@/lib/platform';
import type { FormatTarget } from '@/components/FormatDialog';

interface DownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  onPickVideo: (target: FormatTarget) => void;
}

/* İki çıktı biçimi; format seçimi videoda sonraki adıma aittir. */
const KIND_OPTIONS: readonly SelectOption[] = [
  { value: 'video', label: 'Video', hint: 'Format seçimi sonraki adımda' },
  { value: 'audio', label: 'Ses (m4a)' },
];

export function DownloadDialog({ open, onOpenChange, onDone, onPickVideo }: DownloadDialogProps) {
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<DownloadKind>('video');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUrl('');
    setKind('video');
    setError(null);
    setSaving(false);
  }, [open ]);

  const handleSave = async (): Promise<void> => {
    const cleanUrl = url.trim();
    if (!cleanUrl) {
      setError('URL gerekli.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const item = await createItem({ url: cleanUrl, platform: detectPlatform(cleanUrl), title: null });
      onOpenChange(false);
      onDone();
      if (kind === 'video') {
        // Gerçek formatlar linke göre değişir — seçim FormatDialog'da.
        onPickVideo({ id: item.id, url: cleanUrl });
      } else {
        // startDownload never throws — failures land in download_error state.
        await startDownload(item.id, cleanUrl, kind);
        onDone();
      }
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Kaydetme başarısız.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>URL&apos;den indir</DialogTitle>
          <DialogDescription>Link Vault&apos;a kaydedilir ve indirme kuyruğuna alınır.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" />
          <Select
            label="Format"
            value={kind}
            onValueChange={(v) => setKind(v as DownloadKind)}
            options={KIND_OPTIONS}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Vazgeç
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Başlatılıyor…' : 'Kaydet & İndir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
