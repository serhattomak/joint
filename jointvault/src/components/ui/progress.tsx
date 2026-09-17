import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import { cn } from 'cn';

/*
 * İlerleme — ölçüm, süs değil: mono tabular okuma her zaman görünür.
 * Tamamlanınca mürekkep ultramarinden arşiv yeşiline döner.
 */
function Progress({
  value,
  className,
  indicatorClassName,
  readout = true,
  label,
  ...props
}: ProgressPrimitive.Root.Props & {
  readout?: boolean;
  indicatorClassName?: string;
  /** Görünmez erişilebilir etiket. */
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value ?? 0)));
  return (
    <ProgressPrimitive.Root
      value={value}
      className={cn('group flex min-w-0 items-center gap-2', className)}
      {...props}
    >
      <ProgressPrimitive.Track className="h-1 min-w-12 flex-1 overflow-hidden rounded-xs bg-muted">
        <ProgressPrimitive.Indicator
          className={cn(
            'h-full rounded-xs bg-state-active transition-[width] duration-200 ease-paper',
            pct >= 100 && 'bg-state-acquired',
            indicatorClassName,
          )}
        />
      </ProgressPrimitive.Track>
      {readout && (
        <span data-num className="shrink-0 text-2xs text-muted-foreground">
          %{pct}
        </span>
      )}
      {label ? <span className="sr-only">{label}</span> : null}
    </ProgressPrimitive.Root>
  );
}

export { Progress };
