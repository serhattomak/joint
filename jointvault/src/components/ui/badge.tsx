import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

/*
 * Etiket — basılı kâğıt şerit. Durum bildirmez (o iş `Stamp`'in);
 * sınıflandırma ve sayım taşır.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-xs border px-1.5 font-mono text-2xs tracking-[0.04em] whitespace-nowrap transition-colors duration-150 ease-paper has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: 'border-primary/40 bg-primary/10 text-primary',
        secondary: 'border-border bg-muted text-muted-foreground',
        destructive: 'border-state-error/45 bg-state-error/10 text-state-error',
        outline: 'border-border text-muted-foreground',
        ghost: 'border-transparent text-muted-foreground',
        link: 'border-transparent text-primary underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Badge({
  className,
  variant = 'default',
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: 'badge',
      variant,
    },
  });
}

export { Badge, badgeVariants };
