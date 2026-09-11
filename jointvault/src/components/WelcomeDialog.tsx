import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export const ONBOARD_KEY = 'jv-onboarded';

export function isOnboarded(): boolean {
  return localStorage.getItem(ONBOARD_KEY) === '1';
}

export function markOnboarded(): void {
  localStorage.setItem(ONBOARD_KEY, '1');
}

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Arşivin',
    body: 'Link yapıştırarak kaydet; koleksiyon, kategori ve etiketle düzenle. Arama başlık, not ve URL’de çalışır.',
  },
  {
    title: 'İndir',
    body: 'Kayıtlı videoları karttaki indir düğmesiyle mp4/m4a olarak al. Kalite linkin gerçek seçeneklerinden seçilir; İndirilenler görünümünde toplanır.',
  },
  {
    title: 'Eklenti',
    body: 'X yer işaretleri, Instagram kaydedilenleri ve YouTube listeleri tarayıcı eklentisiyle tek tıkla gelir. Eşleşme anahtarı Ayarlar → Eklenti sekmesinde.',
  },
  {
    title: 'Kısayollar',
    body: 'Ctrl+K komut paletini açar. Boşluk oynatır, I/O aralığı işaretler. Tema ve görünüm Ayarlar → Görünüm sekmesinde.',
  },
];

interface WelcomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WelcomeDialog({ open, onOpenChange }: WelcomeDialogProps) {
  const [step, setStep] = useState(0);
  const last = step >= STEPS.length - 1;

  const close = (done: boolean): void => {
    if (done) markOnboarded();
    setStep(0);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close(false);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>JointVault’a hoş geldin</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <p className="font-display text-lg">{STEPS[step].title}</p>
          <p className="text-sm text-muted-foreground">{STEPS[step].body}</p>
          <div className="flex gap-1.5" aria-label={`Adım ${step + 1} / ${STEPS.length}`}>
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(true)}>
            Atla
          </Button>
          {!last && (
            <Button variant="outline" onClick={() => setStep((s) => s + 1)}>
              İleri
            </Button>
          )}
          {last && <Button onClick={() => close(true)}>Başla</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
