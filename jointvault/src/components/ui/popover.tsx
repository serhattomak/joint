import * as React from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from 'cn';

/*
 * Açılır panel — katalog çekmecesinin önüne çekilen kâğıt. Kırpılmaz: portal'a taşınır,
 * böylece `overflow: hidden` atası olan yerlerde de tam görünür.
 */
function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return <PopoverPrimitive.Title data-slot="popover-title" className={cn('sr-only', className)} {...props} />;
}

function PopoverContent({
  className,
  side = 'bottom',
  sideOffset = 6,
  align = 'start',
  alignOffset = 0,
  children,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'z-50 flex max-h-[min(70vh,32rem)] min-w-56 origin-(--transform-origin) flex-col overflow-y-auto rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lift',
            'transition-[opacity,scale] duration-150 ease-out data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

/* Açılır panel içindeki gruplama başlığı: mürekkep mikro yazı + alt cetvel. */
function PopoverGroupLabel({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="popover-group-label"
      className={cn(
        'mt-1.5 mb-0.5 flex h-5 items-center border-b border-border px-1.5 pb-1 font-mono text-2xs tracking-[0.06em] text-muted-foreground uppercase',
        className,
      )}
      {...props}
    />
  );
}

export { Popover, PopoverClose, PopoverContent, PopoverGroupLabel, PopoverTitle, PopoverTrigger };
