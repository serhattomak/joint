/*
 * Sıfırlama onayı — YAZILI onay ister.
 *
 * "Emin misin?" düğmesi bu işlem için çok zayıf: kasanın tamamı siliniyor.
 * Kullanıcı `SIFIRLA` yazana kadar onay düğmesi kapalı kalır.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

const RESET_PHRASE = 'SIFIRLA';

export interface ResetDatabaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy?: boolean;
}

/*
 * Onay metni bileşen içinde tutulur ve diyalog her açılışta YENİDEN KURULUR
 * (çağıran `key` verir) — böylece önceki yazı kalmaz ve bunun için bir effect
 * gerekmez.
 */
export function ResetDatabaseDialog({ open, onOpenChange, onConfirm, busy = false }: ResetDatabaseDialogProps) {
  const [text, setText] = useState('');

  const confirmed = text.trim().toUpperCase() === RESET_PHRASE;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Veritabanını sıfırla</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Kasadaki tüm kayıtlar silinir. Devam etmek için{' '}
            <span className="font-mono">{RESET_PHRASE}</span> yaz.
          </p>
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={RESET_PHRASE}
            aria-label="Sıfırlama onayı"
            disabled={busy}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive"
              disabled={!confirmed || busy}
              onClick={onConfirm}
            >
              Sıfırla
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
