import type { ComponentType, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from 'cn';

/*
 * Seçim karosu — dönüştürücünün tek "seç bir tane" sözlüğü.
 * Hedef biçimler ve PDF araçları aynı karoyu giyer: solda (varsa) ikon,
 * üstte ad, altta mono uzantı ve gerçek ipucu. Seçili karo tek aksanı taşır;
 * onay işareti yerini korur, böylece seçim satırı zıplamaz.
 */
interface ChoiceTileProps {
  active: boolean;
  label: string;
  /** Mono künye: `.pdf` gibi uzantı. */
  ext?: string;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  disabled?: boolean;
  onClick: () => void;
  ariaLabel?: string;
  className?: string;
  children?: ReactNode;
}

export function ChoiceTile({
  active,
  label,
  ext,
  hint,
  icon: Icon,
  disabled,
  onClick,
  ariaLabel,
  className,
}: ChoiceTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={ariaLabel ?? label}
      title={hint ? `${label} — ${hint}` : label}
      className={cn(
        'group/tile flex min-h-11 items-center gap-2.5 rounded-md border px-2.5 py-2 text-left',
        'transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98]',
        active
          ? 'border-primary/50 bg-primary/[0.07] text-foreground'
          : 'border-border bg-card text-foreground hover:border-input hover:bg-muted/40',
        'disabled:pointer-events-none disabled:opacity-45 motion-reduce:active:scale-100',
        className,
      )}
    >
      {Icon && (
        <span
          aria-hidden
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 ease-out [&_svg]:size-3.5',
            active
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border/70 bg-background text-muted-foreground',
          )}
        >
          <Icon />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate text-sm', active && 'font-medium')}>{label}</span>
        {(ext || hint) && (
          <span className="flex min-w-0 items-baseline gap-1 text-2xs text-muted-foreground">
            {ext && (
              <span data-num className="shrink-0 font-mono">
                .{ext}
              </span>
            )}
            {ext && hint && (
              <span aria-hidden className="shrink-0">
                ·
              </span>
            )}
            {hint && <span className="truncate">{hint}</span>}
          </span>
        )}
      </span>
      <Check
        aria-hidden
        strokeWidth={2.5}
        className={cn(
          'size-3.5 shrink-0 text-primary transition-opacity duration-150 ease-out',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
    </button>
  );
}
