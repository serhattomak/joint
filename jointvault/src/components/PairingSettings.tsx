import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PairingSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

export function PairingSettings({ open, onOpenChange, onChanged }: PairingSettingsProps) {
  const [token, setToken] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCopied(false);
    setVisible(false);
    void invoke<string>('get_pairing_token')
      .then(setToken)
      .catch((e: unknown) => setError(String(e)));
  }, [open ]);

  const copy = async (): Promise<void> => {
    if (token === null) return;
    await writeText(token);
    setCopied(true);
  };

  const regenerate = async (): Promise<void> => {
    if (!window.confirm('Eşleşme anahtarı yenilensin mi? Tarayıcı eklentisindeki kayıtlı anahtar geçersiz olur.'))
      return;
    setBusy(true);
    setError(null);
    try {
      const next = await invoke<string>('regenerate_pairing_token');
      setToken(next);
      setCopied(false);
      onChanged?.();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = token === null ? '…' : visible ? token : '•'.repeat(24);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eklenti eşleşme</DialogTitle>
          <DialogDescription>
            Bu anahtarı tarayıcı eklentisine girin; eklenti yer imlerini bu cihaza gönderebilir.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-lg bg-muted px-3 py-2 font-mono text-sm break-all">{shown}</p>
        {error !== null && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setVisible((v) => !v)} disabled={token === null}>
            {visible ? 'Gizle' : 'Göster'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void copy()} disabled={token === null}>
            {copied ? 'Kopyalandı ✓' : 'Kopyala'}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => void regenerate()} disabled={busy}>
            {busy ? 'Yenileniyor…' : 'Yenile'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
