import { useEffect, useState } from 'react';
import {
  BarChart3,
  Clapperboard,
  Download,
  FolderKanban,
  LayoutGrid,
  RefreshCw,
  Settings,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { getAiStatus, useAiWarmupStatus } from '@/lib/ai';

export type SidebarView = 'all' | 'sync' | 'downloads' | 'collections' | 'converter' | 'toolbox' | 'stats' | 'ai' | 'settings';

interface SidebarProps {
  view: SidebarView;
  homeActive: boolean;
  onHome: () => void;
  onView: (view: Exclude<SidebarView, 'all'>) => void;
  onSettings: () => void;
}

interface NavEntry {
  key: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  run: () => void;
  group: NavGroup;
}

type NavGroup = 'arşiv' | 'araclar' | 'sistem';

/*
 * Çekmece rayı — kataloğun omurgası. Bölümler gerçek gruplardır (ARŞİV · ARAÇLAR · SİSTEM);
 * aktif öğe bir çekmece sekmesidir: yüzeyi içerikle birleşir, sağ kenara taşan çentik
 * rayın hairline'ını keser. Renkli sol şerit yok — sekme fiziksel olarak taşar.
 *
 * Gruplama işin doğasına göre: ARŞİV = kendi arşivin (tümü/favori/koleksiyon),
 * ARAÇLAR = kazı besleyen ve işleyen araçlar, SİSTEM = durum ve ayar.
 */
function useNavEntries(props: SidebarProps): NavEntry[] {
  const { view, homeActive } = props;
  const viewBtn = (
    target: Exclude<SidebarView, 'all'>,
    icon: React.ReactNode,
    label: string,
    group: NavGroup,
  ): NavEntry => ({
    key: target,
    label,
    icon,
    active: view === target,
    run: () => props.onView(target),
    group,
  });

  return [
    { key: 'all', label: 'Tümü', icon: <LayoutGrid />, active: homeActive, run: props.onHome, group: 'arşiv' },
    viewBtn('collections', <FolderKanban />, 'Koleksiyonlar', 'arşiv'),
    viewBtn('downloads', <Download />, 'İndirme Yöneticisi', 'araclar'),
    viewBtn('sync', <RefreshCw />, 'Eşitleme', 'araclar'),
    viewBtn('converter', <Clapperboard />, 'Dönüştürücü', 'araclar'),
    viewBtn('toolbox', <Wrench />, 'Araçlar', 'araclar'),
    viewBtn('stats', <BarChart3 />, 'İstatistikler', 'sistem'),
    viewBtn('ai', <Sparkles />, 'Asistan', 'sistem'),
    viewBtn('settings', <Settings />, 'Ayarlar', 'sistem'),
  ];
}

function NavButton({
  entry,
  aiStatus,
}: {
  entry: NavEntry;
  aiStatus?: { ready: boolean; loading: boolean; offloadMode?: 'gpu' | 'cpu' | null };
}) {
  return (
    <button
      type="button"
      onClick={entry.run}
      aria-current={entry.active ? 'page' : undefined}
      className={`relative flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm transition-colors duration-150 ease-paper [&_svg]:size-4 [&_svg]:shrink-0 ${
        entry.active
          ? 'bg-card font-medium text-foreground'
          : 'text-rail-foreground/65 hover:bg-card/50 hover:text-rail-foreground'
      }`}
    >
      {entry.icon}
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {entry.key === 'ai' && aiStatus && (
        <span
          className={`size-2 shrink-0 rounded-full transition-all ${
            aiStatus.ready
              ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]'
              : aiStatus.loading
              ? 'animate-pulse bg-amber-400'
              : 'bg-muted-foreground/30'
          }`}
          title={
            /* "VRAM Aktif" yalnızca offload GERÇEKTEN GPU'dayken söylenir; CPU'da
               ya da karar bilinmiyorken bu iddia yalan olurdu. */
            aiStatus.ready
              ? aiStatus.offloadMode === 'gpu'
                ? 'Yapay Zekâ Hazır (VRAM Aktif)'
                : aiStatus.offloadMode === 'cpu'
                  ? 'Yapay Zekâ Hazır (CPU)'
                  : 'Yapay Zekâ Hazır (Anında Yanıt)'
              : aiStatus.loading
              ? 'Yapay Zekâ Yükleniyor…'
              : 'Yapay Zekâ Uyku Modunda (On-Demand)'
          }
        />
      )}
      {entry.active && (
        <span aria-hidden className="absolute top-1/2 -right-px h-4 w-1 -translate-y-1/2 bg-card" />
      )}
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pt-3 pb-1 text-2xs text-rail-foreground/45">
      {children}
    </p>
  );
}

export function Sidebar(props: SidebarProps) {
  const entries = useNavEntries(props);
  const warmup = useAiWarmupStatus();
  const [chatRunning, setChatRunning] = useState(false);
  // Offload kararı: "VRAM Aktif" etiketi buna bağlı (CPU'da söylenmez).
  const [offloadMode, setOffloadMode] = useState<'gpu' | 'cpu' | null>(null);

  useEffect(() => {
    let timer: number;
    const check = async () => {
      try {
        const s = await getAiStatus();
        setChatRunning(s.chat_server_running);
        setOffloadMode(s.offload?.mode ?? null);
      } catch {
        // ignore
      }
    };
    void check();
    timer = window.setInterval(check, 10000);
    return () => clearInterval(timer);
  }, [warmup.status]);

  const aiStatusInfo = {
    ready: chatRunning || warmup.status === 'ready',
    loading: warmup.status === 'loading',
    offloadMode,
  };

  return (
    <aside className="material-rail sticky top-[52px] hidden h-[calc(100vh-52px)] w-[244px] shrink-0 flex-col overflow-y-auto border-r border-rail-border pt-2 text-rail-foreground md:flex">
      <nav className="flex flex-1 flex-col gap-0.5 px-2 pb-4">
        <GroupLabel>Arşiv</GroupLabel>
        {entries
          .filter((e) => e.group === 'arşiv')
          .map((e) => (
            <NavButton key={e.key} entry={e} aiStatus={aiStatusInfo} />
          ))}
        <GroupLabel>Araçlar</GroupLabel>
        {entries
          .filter((e) => e.group === 'araclar')
          .map((e) => (
            <NavButton key={e.key} entry={e} aiStatus={aiStatusInfo} />
          ))}
        <GroupLabel>Sistem</GroupLabel>
        {entries
          .filter((e) => e.group === 'sistem')
          .map((e) => (
            <NavButton key={e.key} entry={e} aiStatus={aiStatusInfo} />
          ))}
      </nav>
    </aside>
  );
}

/* Dar pencere: ray gizlenince gezinme kaybolmaz — aynı çekmeceler yatay şeride iner. */
export function SidebarStrip(props: SidebarProps) {
  const entries = useNavEntries(props);
  return (
    <nav
      aria-label="Gezinme"
      data-tauri-drag-region
      className="material-rail flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5 text-rail-foreground md:hidden"
    >
      {entries.map((e) => (
        <button
          key={e.key}
          type="button"
          onClick={e.run}
          aria-current={e.active ? 'page' : undefined}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-1 text-xs whitespace-nowrap transition-colors duration-150 ease-paper [&_svg]:size-3.5 ${
            e.active
              ? 'bg-card font-medium text-foreground'
              : 'text-rail-foreground/65 hover:bg-card/50 hover:text-rail-foreground'
          }`}
        >
          {e.icon}
          {e.label}
        </button>
      ))}
    </nav>
  );
}
