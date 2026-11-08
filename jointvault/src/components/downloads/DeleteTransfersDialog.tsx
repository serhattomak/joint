import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import type { DownloadJob } from '@/lib/db/client';
import type { Item } from '@/lib/db/types';
import { baseName } from './model';

interface DeleteTransfersDialogProps {
  target: { jobs: DownloadJob[]; items: Item[] } | null;
  busy: boolean;
  disk: boolean;
  record: boolean;
  onDiskChange: (value: boolean) => void;
  onRecordChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteTransfersDialog({
  target,
  busy,
  disk,
  record,
  onDiskChange,
  onRecordChange,
  onClose,
  onConfirm,
}: DeleteTransfersDialogProps) {
  const count = (target?.jobs.length ?? 0) + (target?.items.length ?? 0);
  const names = [
    ...(target?.jobs.map((job) => job.filename) ?? []),
    ...(target?.items.map((item) => item.title || baseName(item.local_path ?? item.url)) ?? []),
  ];

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-md gap-4 p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-destructive">
            <Trash2 className="size-5" />
            {count === 1
              ? target?.items.length
                ? 'Medyayı Sil'
                : 'İndirmeyi Sil'
              : `${count} Kaydı Sil`}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {count === 1
              ? `"${names[0]}" için silme seçeneklerini belirleyin.`
              : `${count} kayıt için silme seçeneklerini belirleyin.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-xs">
            <span className="mb-1 block text-3xs font-semibold tracking-wider text-muted-foreground uppercase">
              Dosya
            </span>
            {names.slice(0, 4).map((name, i) => (
              <p key={`${name}-${i}`} className="truncate text-2xs text-foreground" title={name}>
                {name}
              </p>
            ))}
            {names.length > 4 && (
              <p data-num className="mt-1 text-2xs text-muted-foreground">
                +{names.length - 4} dosya daha
              </p>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-card p-3 select-none transition hover:bg-muted/30">
            <Switch checked={disk} onCheckedChange={onDiskChange} className="pointer-events-none mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-foreground">Dosyaları diskten de sil</span>
              <span className="text-2xs leading-relaxed text-muted-foreground">
                İndirilen dosya kalıcı olarak silinir; yer açılır.
              </span>
            </span>
          </label>

          {(target?.items.length ?? 0) > 0 && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-card p-3 select-none transition hover:bg-muted/30">
              <Switch
                checked={record}
                onCheckedChange={onRecordChange}
                className="pointer-events-none mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-foreground">
                  Arşiv kaydını da kaldır
                </span>
                <span className="text-2xs leading-relaxed text-muted-foreground">
                  {record
                    ? 'Kayıt ve bağlantısı arşivden tamamen silinir.'
                    : 'Kapalı: kayıt arşivde kalır, yalnızca indirilmiş medya temizlenir.'}
                </span>
              </span>
            </label>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            disabled={busy}
            className="gap-1.5"
          >
            <Trash2 className="size-3.5" />
            {busy ? 'Siliniyor…' : count === 1 ? 'Sil' : `${count} Kaydı Sil`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
