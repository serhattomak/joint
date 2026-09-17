import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from 'cn';

/*
 * Seçim — uygulamadaki her yerel <select> bununla değiştirilir.
 * Tek kontrol sözlüğü: aynı yükseklik, aynı radius, aynı açılır panel dili.
 */
export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  className?: string;
  /** Tetikleyicinin erişilebilir adı; görünür etiket yoksa zorunlu. */
  label: string;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'default';
}

function Select({ value, onValueChange, options, className, label, placeholder, disabled, size = 'default' }: SelectProps) {
  return (
    <SelectPrimitive.Root
      items={options as SelectOption[]}
      value={value}
      onValueChange={(next) => onValueChange(next as string)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        data-slot="select-trigger"
        aria-label={label}
        className={cn(
          'inline-flex w-full items-center justify-between gap-2 rounded-sm border border-input bg-transparent text-left transition-colors duration-150 ease-paper',
          'data-placeholder:text-muted-foreground data-disabled:cursor-not-allowed data-disabled:opacity-45',
          size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-sm',
          className,
        )}
      >
        {/*
         * `placeholder` gerçek özniteliktir. Çocuk olarak verilirse base-ui onu
         * koşulsuz basar ve seçili etiketi gölgeler — data-placeholder rengi
         * tetikleyici sınıfında zaten tanımlı.
         */}
        <SelectPrimitive.Value
          data-slot="select-value"
          className="min-w-0 truncate"
          placeholder={placeholder}
        />
        <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
          <ChevronDown className="size-3.5" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={6} alignItemWithTrigger={false} className="isolate z-50">
          <SelectPrimitive.Popup
            data-slot="select-content"
            className={cn(
              'z-50 flex max-h-[min(70vh,26rem)] min-w-(--anchor-width) flex-col overflow-y-auto rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lift',
              'data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
            )}
          >
            <SelectPrimitive.List>
              {options.map((o) => (
                <SelectPrimitive.Item
                  key={o.value}
                  value={o.value}
                  data-slot="select-item"
                  className={cn(
                    'flex cursor-default items-center justify-between gap-3 rounded-xs px-2 py-1.5 text-sm outline-none select-none transition-colors duration-100 ease-paper',
                    'data-highlighted:bg-muted data-selected:font-medium data-disabled:opacity-45',
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <SelectPrimitive.ItemText className="truncate">{o.label}</SelectPrimitive.ItemText>
                    {o.hint && <span className="text-micro text-muted-foreground">{o.hint}</span>}
                  </span>
                  <SelectPrimitive.ItemIndicator>
                    <Check className="size-3.5 shrink-0 text-primary" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export { Select };
