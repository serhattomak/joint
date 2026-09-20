import { useEffect, useState } from 'react';
import {
  Archive,
  BarChart3,
  Clapperboard,
  Download,
  FolderKanban,
  LayoutGrid,
  RefreshCw,
  Settings,
  Sparkles,
  Star,
  Wrench,
} from 'lucide-react';
import { getAiStatus, useAiWarmupStatus } from '@/lib/ai';

export type SidebarView = 'all' | 'favorites' | 'sync' | 'downloads' | 'collections' | 'converter' | 'toolbox' | 'stats' | 'ai' | 'settings';

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
}

/*
 * Çekmece rayı — kataloğun omurgası. Bölümler gerçek gruplardır (KASA · ARAÇLAR · SİSTEM);
 * aktif öğe bir çekmece sekmesidir: yüzeyi içerikle birleşir, sağ kenara taşan çentik
 * rayın hairline'ını keser. Renkli sol şerit yok — sekme fiziksel olarak taşar.
 */
function useNavEntries(props: SidebarProps): NavEntry[] {
  const { view, homeActive } = props;
  const viewBtn = (
    target: Exclude<SidebarView, 'all'>,
    icon: React.ReactNode,
    label: string,
  ): NavEntry => ({
    key: target,
    label,
    icon,
    active: view === target,
    run: () => props.onView(target),
  });

  return [
    { key: 'all', label: 'Tümü', icon: <LayoutGrid />, active: homeActive, run: props.onHome },
    viewBtn('favorites', <Star />, 'Favoriler'),
    viewBtn('sync', <RefreshCw />, 'Eşitleme'),
    viewBtn('downloads', <Download />, 'İndirme Yöneticisi'),
    viewBtn('collections', <FolderKanban />, 'Koleksiyonlar'),
    viewBtn('ai', <Sparkles />, 'Kasa Asistanı'),
    viewBtn('converter', <Clapperboard />, 'Dönüştürücü'),
    viewBtn('toolbox', <Wrench />, 'Araç Kutusu'),
    viewBtn('stats', <BarChart3 />, 'İstatistikler'),
    viewBtn('settings', <Settings />, 'Ayarlar'),
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
  /* 'settings' her zaman entries içinde olmalı (useNavEntries sabit tanımlardan
     kurar); yine de yoksa sessizce kırılmak yerine düğme çizilmez. */
  const settingsEntry = entries.find((e) => e.key === 'settings');
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
    <aside className="sticky top-0 hidden h-screen w-[244px] shrink-0 flex-col overflow-y-auto border-r border-rail-border bg-rail text-rail-foreground md:flex">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-rail-border px-4">
        <Archive className="size-[18px] text-primary" strokeWidth={2.25} aria-hidden />
        <span className="text-title leading-none font-semibold tracking-[-0.02em]">JointVault</span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2 pb-4">
        <GroupLabel>Kasa</GroupLabel>
        {entries.slice(0, 5).map((e) => (
          <NavButton key={e.key} entry={e} aiStatus={aiStatusInfo} />
        ))}
        <GroupLabel>Araçlar</GroupLabel>
        {entries.slice(5, 9).map((e) => (
          <NavButton key={e.key} entry={e} aiStatus={aiStatusInfo} />
        ))}
        <GroupLabel>Sistem</GroupLabel>
        {settingsEntry && <NavButton entry={settingsEntry} />}
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
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-rail px-2 py-1.5 text-rail-foreground md:hidden"
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
