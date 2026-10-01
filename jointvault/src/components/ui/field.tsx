import * as React from 'react';
import { cn } from 'cn';

/*
 * Form alanları — tek etiket/hint/hata sözlüğü.
 * Ayarlar, ekleme, toplu aktarma, organize ve dönüştürücü formları bunu kullanır;
 * yerel `Row` kopyaları kaldırıldı.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-micro font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-micro text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-micro text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/* Ayarlar satırı: solda etiket, sağda kontrol. Hairline ile ayrılır. */
export function SettingRow({
  label,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div
      data-slot="setting-row"
      className={cn('flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2', className)}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span id={htmlFor} className="text-sm">
          {label}
        </span>
        {hint && <span className="text-micro text-muted-foreground">{hint}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/* Bölüm: mono mikro başlık + alt cetvel. Ayarlar ve araç panellerinde ortak. */
export function FieldGroup({
  title,
  children,
  className,
  action,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col', className)}>
      <header className="flex h-6 items-center justify-between border-b border-border pb-1">
        <h3 className="text-micro font-medium text-muted-foreground">{title}</h3>
        {action}
      </header>
      <div className="flex flex-col divide-y divide-border/70">{children}</div>
    </section>
  );
}
