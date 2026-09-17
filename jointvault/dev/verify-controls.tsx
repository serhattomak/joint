/*
 * Doğrulama tezgâhı #2 — üretim kodu DEĞİL.
 *
 * İki riski ölçer, ikisi de "öyle olmalı" diye varsayılamayacak cinsten:
 *   1. Select tetikleyicisi seçili ETİKETİ mi basıyor? (placeholder çocuk olarak
 *      verildiğinde seçimi gölgeliyordu — düzeltilen davranış.)
 *   2. Dialog içindeki ConfirmDialog doğru işi mi çalıştırıyor?
 *      (onConfirm, `pending` state'ini kapanış üzerinden okur.)
 *
 * Buradaki her içerik SENTETİK; ürün iddiası taşımaz.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, type SelectOption } from '@/components/ui/select';

declare global {
  interface Window {
    __log: string[];
  }
}

window.__log = [];

const noop = (): void => undefined;

const SENTINEL: readonly SelectOption[] = [
  { value: 'none', label: 'Koleksiyon yok' },
  { value: 'c1', label: 'Koleksiyon A' },
];
const WIDTHS: readonly SelectOption[] = [
  { value: '320', label: '320px' },
  { value: '640', label: '640px' },
];
const CLOSE: readonly SelectOption[] = [
  { value: 'tray', label: 'Tepside çalışmaya devam et' },
  { value: 'quit', label: 'Tamamen kapat' },
];
const HINTED: readonly SelectOption[] = [
  { value: 'video', label: 'Video', hint: 'Format seçimi sonraki adımda' },
  { value: 'audio', label: 'Ses (m4a)' },
];

function SelectCases() {
  return (
    <div className="flex w-80 flex-col gap-3 p-6">
      <Select label="sentinel" value="none" onValueChange={noop} options={SENTINEL} />
      <Select label="numeric" value="640" onValueChange={noop} options={WIDTHS} />
      <Select label="stringy" value="tray" onValueChange={noop} options={CLOSE} />
      <Select label="hinted" value="video" onValueChange={noop} options={HINTED} />
      {/* Regresyon: placeholder seçili etiketi gölgelememeli. */}
      <Select
        label="withplaceholder"
        value="c1"
        placeholder="Seç…"
        onValueChange={noop}
        options={SENTINEL}
      />
    </div>
  );
}

/* OrganizeDialog'un yapısını taklit eder: AlertDialog, Dialog Root'un İÇİNDE durur. */
function NestedConfirm() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<'collection' | 'tag' | 'category' | null>(null);
  return (
    <div className="p-6">
      <Button aria-label="open-organize" onClick={() => setOpen(true)}>
        Organize
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Düzenle (taklit)</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            {(['collection', 'tag', 'category'] as const).map((k) => (
              <Button
                key={k}
                variant="ghost"
                size="sm"
                aria-label={`del-${k}`}
                onClick={() => setPending(k)}
              >
                {k}
              </Button>
            ))}
          </div>
          <ConfirmDialog
            open={pending !== null}
            onOpenChange={(o) => {
              if (!o) setPending(null);
            }}
            title={`${pending ?? ''} silinsin mi?`}
            description="Taklit onay."
            confirmLabel="Sil"
            onConfirm={() => {
              window.__log.push(`confirm:${pending}`);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* Yıkıcı olmayan onay: kırmızı kullanılmamalı (tone="default"). */
function DefaultTone() {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-6">
      <Button aria-label="open-tone" onClick={() => setOpen(true)}>
        Anahtar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Eşleşme anahtarı yenilensin mi?"
        description="Taklit."
        confirmLabel="Yenile"
        tone="default"
        onConfirm={() => {
          window.__log.push('confirm:tone-default');
        }}
      />
    </div>
  );
}

function App() {
  return (
    <>
      <SelectCases />
      <DefaultTone />
      <NestedConfirm />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
