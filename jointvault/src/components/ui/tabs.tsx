import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from 'cn';

/*
 * Sekmeler — çekmece ayraçları. Aktif sekme çentikli: üstünde mürekkep kuralı,
 * altında yüzey dolgusu. Alt çizgi tüm listeyi keser.
 */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props} />;
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('flex items-end gap-0.5 overflow-x-auto border-b border-border', className)}
      {...props}
    />
  );
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        'relative -mb-px inline-flex h-8 shrink-0 items-center gap-1.5 rounded-t-sm border border-transparent border-b-0 px-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors duration-150 ease-paper hover:text-foreground',
        'data-active:border-border data-active:bg-card data-active:font-medium data-active:text-foreground',
        '[&_svg]:size-3.5',
        className,
      )}
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn('min-w-0 outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsPanel, TabsTab };
