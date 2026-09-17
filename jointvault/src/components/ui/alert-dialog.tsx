import * as React from 'react';
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';

/*
 * Onay — yıkıcı iş için korunmuş odak. `window.confirm` yerine geçer:
 * sistem kromu yerine kataloğun kendi yaprağı.
 */
const AlertDialog = AlertDialogPrimitive.Root;

type ConfirmTone = 'destructive' | 'default';

/*
 * Kırmızı yalnızca hata ve yıkıcı eyleme aittir (DESIGN.md · Damga Kırmızısı).
 * Yıkıcı olmayan bir onayda birincil eylem ultramarin damgadır.
 */
const CONFIRM_VARIANT: Record<ConfirmTone, 'destructive' | 'default'> = {
  destructive: 'destructive',
  default: 'default',
};

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Onayla',
  cancelLabel = 'Vazgeç',
  tone = 'destructive',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Yıkıcı olmayan onaylar `default` geçer; kırmızı reservdir. */
  tone?: ConfirmTone;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Backdrop
          className={cn(
            'fixed inset-0 isolate z-50 bg-overlay duration-150',
            'data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
          )}
        />
        <AlertDialogPrimitive.Popup
          className={cn(
            'fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-md border border-border bg-popover p-4 text-sm shadow-lift',
            'data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
          )}
        >
          <AlertDialogPrimitive.Title className="text-title pr-6 leading-tight">
            {title}
          </AlertDialogPrimitive.Title>
          {description && (
            <AlertDialogPrimitive.Description className="text-sm text-muted-foreground">
              {description}
            </AlertDialogPrimitive.Description>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Close render={<Button variant="outline" />}>
              {cancelLabel}
            </AlertDialogPrimitive.Close>
            <AlertDialogPrimitive.Close
              render={<Button variant={CONFIRM_VARIANT[tone]} onClick={onConfirm} />}
            >
              {confirmLabel}
            </AlertDialogPrimitive.Close>
          </div>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialog>
  );
}

export { ConfirmDialog };
