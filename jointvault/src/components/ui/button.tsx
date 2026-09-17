import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';

/*
 * Buton — damga bloğu dünyasının kontrolü.
 * Odak halkası tek yerden gelir (index.css `:focus-visible`), bu yüzden her varyant
 * kendi ring'ini yazmaz. Basış 1px aşağı iner: kâğıt masaya değer.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 ease-paper select-none active:translate-y-px disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85',
        outline: 'border-input hover:bg-muted aria-expanded:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70 aria-expanded:bg-secondary',
        ghost: 'hover:bg-muted aria-expanded:bg-muted',
        destructive: 'border-destructive/35 bg-destructive/10 text-destructive hover:bg-destructive/20',
        /* Damga: ana eylem için çerçeveli mürekkep bloğu. */
        stamp: 'border-primary text-primary hover:bg-primary hover:text-primary-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: 'h-6 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*=\'size-\'])]:size-3',
        sm: 'h-7 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*=\'size-\'])]:size-3.5',
        lg: 'h-9 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5',
        icon: 'size-8',
        'icon-xs': 'size-6 [&_svg:not([class*=\'size-\'])]:size-3',
        'icon-sm': 'size-7',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
