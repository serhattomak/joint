import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface DownloadSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DownloadSettings({ open, onOpenChange }: DownloadSettingsProps) {
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void invoke<string>('get_download_dir')
      .then(setDir)
      .catch((e: unknown) => setError(String(e)));
  }, [open]);

  const pick = async (): Promise<void> => {
    setError(null);
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === 'string' && selected.length > 0) setDir(selected);
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await invoke<string>('set_download_dir', { path: dir });
      setDir(next);
      onOpenChange(false);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>İndirme klasörü</DialogTitle>
          <DialogDescription>
            İndirilen videolar ve sesler bu klasöre kaydedilir. Varsayılan: İndirilenler/JointVault.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder="İndirme klasörü…"
        />
        {error !== null && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void pick()}>
            Klasör seç
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy || dir.trim().length === 0}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
