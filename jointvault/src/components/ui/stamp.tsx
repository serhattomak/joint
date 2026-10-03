import { ArrowDown, Check, Clock3, Copy, FileOutput, Minus, Star, X } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

/*
 * Damga — durum renkle değil mühürle bildirilir.
 * Kataloğun kendi sözlüğü: arşive girmiş kayıt damgalanır, eksik olan işaretlenir.
 * İşaretler tek ikon ailesinden (lucide) ve tek kalınlıktan gelir; glif/emoji yok,
 * çünkü durum okunur olmalı, süslenmiş değil.
 * Sözlük sekiz durumdur ve tamamı burada yaşar: bir durumu başka bir durumun rengiyle
 * taklit etmek yasaktır (favoriyi "yerel" yeşiliyle basmak gibi).
 */
const stampVariants = cva(
  'inline-flex h-5 shrink-0 items-center gap-1 rounded-xs border px-1.5 font-mono text-2xs font-medium tracking-[0.06em] whitespace-nowrap uppercase',
  {
    variants: {
      state: {
        none: 'border-border text-muted-foreground',
        queued: 'border-border text-state-queued',
        active: 'border-state-active/40 bg-state-active/10 text-state-active',
        local: 'border-state-acquired/45 bg-state-acquired/10 text-state-acquired',
        error: 'border-state-error/45 bg-state-error/10 text-state-error',
        duplicate: 'border-dashed border-border text-muted-foreground',
        /* Favori bir arşiv durumu değil, bir işarettir: ultramarin (tek damga). */
        favorite: 'border-primary/45 bg-primary/10 text-primary',
        /* Dönüştürüldü bir olgudur, kazanım değil; bu yüzden yeşil giymez. */
        converted: 'border-border text-muted-foreground',
      },
    },
    defaultVariants: { state: 'none' },
  },
);

export type StampState = NonNullable<VariantProps<typeof stampVariants>['state']>;

const STAMP_MARK: Record<StampState, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  none: Minus,
  queued: Clock3,
  active: ArrowDown,
  local: Check,
  error: X,
  duplicate: Copy,
  favorite: Star,
  converted: FileOutput,
};

const STAMP_LABEL: Record<StampState, string> = {
  none: 'kayıtsız',
  queued: 'kuyrukta',
  active: 'iniyor',
  local: 'yerel',
  error: 'hata',
  duplicate: 'yinelenen',
  favorite: 'favori',
  converted: 'dönüştürüldü',
};

interface StampProps extends VariantProps<typeof stampVariants> {
  state?: StampState;
  /** Damga metnini değiştir; verilmezse durumun kendi sözcüğü yazılır. */
  children?: React.ReactNode;
  className?: string;
  title?: string;
}

export function Stamp({ state = 'none', children, className, title }: StampProps) {
  const Mark = STAMP_MARK[state];
  return (
    <span className={cn(stampVariants({ state }), className)} title={title} data-state={state}>
      <Mark className="size-3 shrink-0" strokeWidth={2.5} aria-hidden />
      {children ?? STAMP_LABEL[state]}
    </span>
  );
}
