import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { cn } from 'cn';

/*
 * Menü — satır eylemlerinin ve kalite seçiminin tek sözlüğü.
 * Elle kurulmuş `absolute` paneller ve görünmez `fixed inset-0` perdeleri kaldırıldı;
 * menü portal'a taşınır, klavye ile gezinir, Escape ile kapanır.
 */
function Menu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="menu" {...props} />;
}

function MenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="menu-trigger" {...props} />;
}

function MenuGroupLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="menu-group-label"
      className={cn(
        'mt-1.5 mb-0.5 flex h-5 items-center border-b border-border px-1.5 pb-1 font-mono text-2xs tracking-[0.06em] text-muted-foreground uppercase',
        className,
      )}
      {...props}
    />
  );
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return <MenuPrimitive.Separator data-slot="menu-separator" className={cn('my-1 h-px bg-border', className)} {...props} />;
}

const menuItemClass =
  'flex cursor-default items-center gap-2 rounded-xs px-2 py-1.5 text-sm outline-none select-none transition-colors duration-100 ease-paper data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground';

function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return <MenuPrimitive.Item data-slot="menu-item" className={cn(menuItemClass, className)} {...props} />;
}

function MenuCheckboxItem({ className, ...props }: MenuPrimitive.CheckboxItem.Props) {
  return (
    <MenuPrimitive.CheckboxItem data-slot="menu-checkbox-item" className={cn(menuItemClass, className)} {...props} />
  );
}

function MenuRadioItem({ className, ...props }: MenuPrimitive.RadioItem.Props) {
  return <MenuPrimitive.RadioItem data-slot="menu-radio-item" className={cn(menuItemClass, className)} {...props} />;
}

function MenuContent({
  className,
  side = 'bottom',
  sideOffset = 6,
  align = 'start',
  alignOffset = 0,
  children,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <MenuPrimitive.Popup
          data-slot="menu-content"
          className={cn(
            'z-50 flex max-h-[min(70vh,32rem)] min-w-44 origin-(--transform-origin) flex-col overflow-y-auto rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lift',
            'transition-[opacity,scale] duration-150 ease-out data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroupLabel,
  MenuItem,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
};
