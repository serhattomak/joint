import { Archive, BarChart3, Clapperboard, Copy, Download, LayoutGrid, Settings, SlidersHorizontal, Star, Wrench } from 'lucide-react';

export type SidebarView = 'all' | 'favorites' | 'downloads' | 'converter' | 'toolbox' | 'duplicates' | 'stats';

interface SidebarProps {
  view: SidebarView;
  homeActive: boolean;
  onHome: () => void;
  onView: (view: Exclude<SidebarView, 'all'>) => void;
  onOrganize: () => void;
  onSettings: () => void;
}

export function Sidebar(props: SidebarProps) {
  const { view, homeActive } = props;

  const navBtn = (active: boolean): string =>
    `flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${
      active ? 'bg-secondary font-medium text-secondary-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
    }`;

  const viewBtn = (
    target: Exclude<SidebarView, 'all'>,
    icon: React.ReactNode,
    label: string,
  ): React.ReactNode => (
    <button type="button" onClick={() => props.onView(target)} className={navBtn(view === target)}>
      {icon}
      {label}
    </button>
  );

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-card px-3 py-4 md:flex">
      <div className="flex items-center gap-2 px-1.5">
        <Archive className="size-5 text-primary" strokeWidth={2} />
        <span className="font-display text-xl tracking-tight">JointVault</span>
      </div>
      <nav className="flex flex-col gap-0.5">
        <button type="button" onClick={props.onHome} className={navBtn(homeActive)}>
          <LayoutGrid className="size-4" /> Tümü
        </button>
        {viewBtn('favorites', <Star className="size-4" />, 'Favoriler')}
        {viewBtn('downloads', <Download className="size-4" />, 'İndirilenler')}
        {viewBtn('converter', <Clapperboard className="size-4" />, 'Dönüştürücü')}
        {viewBtn('toolbox', <Wrench className="size-4" />, 'Araç Kutusu')}
        {viewBtn('duplicates', <Copy className="size-4" />, 'Yinelenenler')}
        {viewBtn('stats', <BarChart3 className="size-4" />, 'İstatistikler')}
      </nav>
      <div className="border-t border-border pt-2">
        <button type="button" onClick={props.onOrganize} className={navBtn(false)}>
          <SlidersHorizontal className="size-4" /> Koleksiyonlar
        </button>
        <button type="button" onClick={props.onSettings} className={navBtn(false)}>
          <Settings className="size-4" /> Ayarlar
        </button>
      </div>
    </aside>
  );
}
