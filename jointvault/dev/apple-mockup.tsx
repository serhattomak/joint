/*
 * Apple düzen önerisi — üretim kodu DEĞİL, tartışma mockup'ı.
 *
 * Uygulamayı bir macOS uygulaması gibi düşününce layoutta ne değişirdi sorusunu
 * çalışan bir kareyle gösterir. Gerçek bileşenleri değil, tasarım token'larını
 * (index.css) kullanır; içerik SENTETİK'tir.
 */
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Bookmark,
  Download,
  Film,
  LayoutGrid,
  Link2,
  PanelLeft,
  Play,
  RefreshCw,
  Rows3,
  Scissors,
  Settings,
  Sparkles,
  Star,
  Sun,
  Tag,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import '../src/index.css';

const ACTIVE = 'bg-primary/15 font-medium text-foreground';
const IDLE = 'text-muted-foreground hover:bg-muted/60 hover:text-foreground';

function NavRow({
  icon,
  label,
  active,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  badge?: string;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] transition-colors duration-150 ease-out ${active ? ACTIVE : IDLE}`}
    >
      <span className={`[&_svg]:size-4 ${active ? 'text-primary' : ''}`}>{icon}</span>
      <span className="truncate">{label}</span>
      {badge && <span className="ml-auto font-mono text-2xs text-muted-foreground">{badge}</span>}
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pt-4 pb-1 text-2xs tracking-[0.08em] text-rail-foreground/45 uppercase">
      {children}
    </p>
  );
}

function Sidebar() {
  return (
    <aside className="material-rail flex w-[236px] shrink-0 flex-col overflow-y-auto border-r border-rail-border px-2.5 py-2 text-rail-foreground">
      <nav className="flex flex-col gap-0.5">
        <GroupLabel>Kasa</GroupLabel>
        <NavRow icon={<LayoutGrid />} label="Tümü" active badge="1.204" />
        <NavRow icon={<Star />} label="Favoriler" badge="86" />
        <NavRow icon={<Bookmark />} label="Koleksiyonlar" />
        <NavRow icon={<Tag />} label="Etiketler" />
        <GroupLabel>Araçlar</GroupLabel>
        <NavRow icon={<Download />} label="İndirme Yöneticisi" badge="3" />
        <NavRow icon={<RefreshCw />} label="Eşitleme" />
        <NavRow icon={<Film />} label="Dönüştürücü" />
        <NavRow icon={<Wrench />} label="Araç Kutusu" />
        <GroupLabel>Sistem</GroupLabel>
        <NavRow icon={<Sparkles />} label="Yapay Zekâ" />
        <NavRow icon={<Settings />} label="Ayarlar" />
      </nav>

      <div className="mt-auto flex items-center gap-2 rounded-lg border border-rail-border bg-card/40 px-2.5 py-1.5 text-2xs text-muted-foreground">
        <span className="size-2 shrink-0 rounded-full bg-state-acquired" />
        <span className="truncate">Yapay Zekâ uyku modunda</span>
      </div>
    </aside>
  );
}

const CARDS = [
  { label: 'INSTAGRAM', tone: 'from-fuchsia-700/35 to-rose-900/30', title: 'Kaydedilen gönderi başlığı iki satıra taşacak kadar uzun' },
  { label: 'YOUTUBE', tone: 'from-red-800/35 to-orange-900/30', title: 'Referans video: arayüz hareketi üzerine bir konuşma' },
  { label: 'X', tone: 'from-slate-600/35 to-slate-900/30', title: 'Uzun bir thread başlığı buraya gelir ve taşar' },
  { label: 'TIKTOK', tone: 'from-teal-700/35 to-cyan-900/30', title: 'Kısa video — montaj tekniği kaydı' },
];

function Card({ label, tone, title }: { label: string; tone: string; title: string }) {
  return (
    <div className="group cursor-pointer overflow-hidden rounded-xl border border-border bg-card shadow-card transition duration-200 ease-out hover:-translate-y-0.5 hover:border-input hover:shadow-hover">
      <div className={`flex h-32 items-center justify-center bg-gradient-to-br ${tone}`}>
        <Film className="size-7 text-white/25" />
      </div>
      <div className="record-band text-muted-foreground">
        <span>{label}</span>
        <span className="ml-auto">12.09.2026</span>
      </div>
      <p className="line-clamp-2 px-3 py-2.5 text-sm">{title}</p>
    </div>
  );
}

function Content() {
  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="px-7 py-6">
        {/* Büyük başlık — kaydırınca araç çubuğuna çekilir */}
        <h1 className="text-display">Tümü</h1>
        <p className="mt-1 text-sm text-muted-foreground">1.204 fiş · 12 koleksiyon · 3 indiriliyor</p>

        {/* Segmentli filtre + sıralama */}
        <div className="mt-5 mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5 text-xs">
            <span className="rounded-md bg-background px-2.5 py-1 font-medium shadow-xs">Tümü</span>
            <span className="px-2.5 py-1 text-muted-foreground">Favoriler</span>
            <span className="px-2.5 py-1 text-muted-foreground">İndirildi</span>
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <ArrowUpDown className="size-3.5" /> En yeni
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {CARDS.map((c) => (
            <Card key={c.label} {...c} />
          ))}
        </div>
      </div>
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-micro text-muted-foreground">{label}</span>
      <span className="truncate text-sm">{value}</span>
    </div>
  );
}

function Inspector() {
  return (
    <aside className="material-sheet flex w-[340px] shrink-0 flex-col border-l border-border">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-src-instagram" />
          <span className="text-sm font-semibold">Instagram</span>
        </div>
        <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted/60">
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex h-36 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-700/30 to-rose-900/30">
          <Film className="size-8 text-white/20" />
        </div>
        <h2 className="text-title">Kaydedilen gönderi başlığı iki satıra taşacak kadar uzun</h2>
        <p className="mt-1 font-mono text-2xs text-muted-foreground">instagram.com/p/CxxxxVault</p>

        <div className="settings-card mt-4 flex flex-col divide-y divide-border/70">
          <InfoRow label="Koleksiyon" value="Tasarım" />
          <InfoRow label="Etiketler" value="ui · referans" />
          <InfoRow label="Durum" value="İndirildi" />
          <InfoRow label="Boyut" value="18,4 MB" />
        </div>
      </div>

      <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-border px-4">
        <button
          type="button"
          className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary text-xs font-medium text-primary-foreground"
        >
          <Play className="size-3.5" /> Oynat
        </button>
        <button
          type="button"
          className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-input px-2.5 text-xs text-muted-foreground"
        >
          <Scissors className="size-3.5" />
        </button>
        <button
          type="button"
          className="inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-destructive/35 px-2.5 text-xs text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </footer>
    </aside>
  );
}

function Toolbar() {
  return (
    <header className="material-toolbar flex h-13 shrink-0 items-center gap-3 border-b border-border px-3">
      {/* Sol: trafik ışıkları + gezinme (ray üstünde) */}
      <div className="flex w-[228px] shrink-0 items-center gap-1.5">
        <div className="flex items-center gap-2 pr-1">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>
        <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted/60">
          <PanelLeft className="size-4" />
        </button>
        <button type="button" className="rounded-md p-1 text-muted-foreground/50">
          <ArrowLeft className="size-4" />
        </button>
        <button type="button" className="rounded-md p-1 text-muted-foreground/50">
          <ArrowRight className="size-4" />
        </button>
      </div>

      {/* Orta: imza etkileşim — yakala/ara alanı, Safari gibi ortada */}
      <div className="flex flex-1 justify-center">
        <div className="relative w-[420px] max-w-full">
          <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary" />
          <div className="flex h-8 items-center rounded-lg border border-input bg-card/70 pr-2 pl-9 text-sm text-muted-foreground">
            Link yapıştır veya arşivde ara…
            <kbd className="ml-auto rounded-xs border border-border px-1 py-px font-mono text-2xs">⌘K</kbd>
          </div>
        </div>
      </div>

      {/* Sağ: görünüm denetimleri */}
      <div className="flex shrink-0 items-center gap-1">
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5">
          <span className="rounded-md bg-background px-1.5 py-1 shadow-xs">
            <LayoutGrid className="size-4" />
          </span>
          <span className="px-1.5 py-1 text-muted-foreground">
            <Rows3 className="size-4" />
          </span>
        </div>
        <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/60">
          <Sun className="size-4" />
        </button>
      </div>
    </header>
  );
}

const LEGEND = [
  'Birleşik pencere araç çubuğu: marka başlığı kalkar, tek 52px şerit; trafik ışıkları solda, yakala/arama alanı Safari gibi ortada, görünüm denetimleri sağda.',
  'Büyük başlık: içerik “Tümü” 28px başlıkla açılır, aşağı kaydıkça araç çubuğuna çekilir (macOS large-title deseni).',
  'Segmentli filtre: renkli çipler yerine tek parça segment denetimi; sıralama sağda sessiz bir düğme.',
  'Ray: bölüm başlıkları + kapsül seçim korunur; alta küçük bir durum satırı (Apple status footer).',
  'Denetçi (inspector): kayıt paneli modal yerine sağda sabit, yarı saydam bir denetçi — içerik yanında akar, perde yok (Finder Preview / Fotos Info).',
  'Malzeme hiyerarşisi: araç çubuğu + ray + denetçi yarı saydam, içerik zemini opak, kartlar opak ve hover’da yükselir.',
];

function Legend() {
  return (
    <div className="mx-auto mt-7 max-w-[1280px] text-neutral-300">
      <h2 className="text-sm font-semibold tracking-wide text-neutral-100 uppercase">
        Apple düzen önerisi — ne değişirdi
      </h2>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[0.8125rem] leading-relaxed">
        {LEGEND.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ol>
      <p className="mt-3 text-[0.8125rem] text-neutral-400">
        Tek bilinçli kırılma: pencere kontrolleri sola taşındı (gerçek Mac yeri). Windows alışkanlığı
        korunacaksa ışıklar sağda kalır; tüm diğer maddeler etkilenmez.
      </p>
    </div>
  );
}

function Mock() {
  return (
    <div className="min-h-screen bg-neutral-900 p-8 font-sans text-foreground">
      <div className="mx-auto max-w-[1280px] overflow-hidden rounded-xl border border-black/50 bg-background shadow-lift">
        <div className="flex h-[720px] flex-col">
          <Toolbar />
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <Content />
            <Inspector />
          </div>
        </div>
      </div>
      <Legend />
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<Mock />);
