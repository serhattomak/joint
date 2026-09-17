import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';
import { cn } from 'cn';

/*
 * Giriş — kâğıda yazılan satır. Odak halkası base katmandan gelir.
 * `data-num` verilirse JetBrains Mono + tabular rakam devreye girer (yüzde, adet, sayfa).
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-sm border border-input bg-transparent px-2.5 py-1 text-sm transition-colors duration-150 ease-paper',
        'file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
        'placeholder:text-muted-foreground/85',
        'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-55',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

/* Çok satırlı giriş — not alanı. Giriş ile aynı sözlük. */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'w-full min-w-0 resize-y rounded-sm border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors duration-150 ease-paper',
        'placeholder:text-muted-foreground/85',
        'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-55',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Input, Textarea };
