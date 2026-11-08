import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface BatchLinksDialogProps {
  open: boolean;
  urls: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onUrlsChange: (value: string) => void;
  onSubmit: () => void;
}

export function BatchLinksDialog({
  open,
  urls,
  busy,
  onOpenChange,
  onUrlsChange,
  onSubmit,
}: BatchLinksDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4 p-6">
        <DialogHeader>
          <DialogTitle>Toplu Bağlantı Ekle</DialogTitle>
          <DialogDescription className="text-xs">
            Her satıra bir indirme bağlantısı yapıştır. Dosyalar kuyruğa eklenir.
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={urls}
          onChange={(e) => onUrlsChange(e.target.value)}
          rows={6}
          placeholder="https://example.com/dosya1.zip&#10;https://example.com/dosya2.mp4&#10;https://example.com/dosya3.iso"
          className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button size="sm" onClick={onSubmit} disabled={busy || !urls.trim()}>
            {busy ? 'Ekleniyor…' : 'Kuyruğa Ekle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
