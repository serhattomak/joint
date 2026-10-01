/*
 * Apple düzen önerisi — üretim kodu DEĞİL, tartışma mockup'ı.
 * İçerik SENTETİK'tir; değerler ürün iddiası taşımaz.
 *
 * Gerçek boyutlarda basar: varsayılan pencere 1280×800 (PRODUCT.md) ve dar
 * pencere 640×800 (birinci sınıf kullanım). Gerçek token'lar + gerçek
 * primitifler (Button/Badge/Stamp) kullanılır.
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
  Menu,
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
import { Button } from '@/components/ui/button';
import { Stamp } from '@/components/ui/stamp';
import '../src/index.css';

const S = 1.75; // ikon çizgisi gövde yazısıyla (regular) eşleşir — tek sözlük.

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
      className={`flex h-[30px] w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-[0.8125rem] transition-colors duration-150 ease-out ${
        active ? 'bg-primary/15 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      }`}
    >
      <span className={`[&_svg]:size-4 ${active ? 'text-primary' : ''}`}>{icon}</span>
      <span className="truncate">{label}</span>
      {badge && <span className="ml-auto font-mono text-2xs text-muted-foreground">{badge}</span>}
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pt-3.5 pb-1 text-2xs tracking-[0.08em] text-rail-foreground/45 uppercase">{children}</p>
  );
}

/* ---------------------------------------------------------------- ray */

function Sidebar() {
  return (
    <aside className="material-rail flex w-[244px] shrink-0 flex-col overflow-y-auto border-r border-rail-border px-2.5 py-2 text-rail-foreground">
      <nav className="flex flex-col gap-0.5">
        <GroupLabel>Kasa</GroupLabel>
        <NavRow icon={<LayoutGrid strokeWidth={S} />} label="Tümü" active badge="1.204" />
        <NavRow icon={<Star strokeWidth={S} />} label="Favoriler" badge="86" />
        <NavRow icon={<Bookmark strokeWidth={S} />} label="Koleksiyonlar" />
        <NavRow icon={<Tag strokeWidth={S} />} label="Etiketler" />
        <GroupLabel>Araçlar</GroupLabel>
        <NavRow icon={<Download strokeWidth={S} />} label="İndirme Yöneticisi" badge="3" />
        <NavRow icon={<RefreshCw strokeWidth={S} />} label="Eşitleme" />
        <NavRow icon={<Film strokeWidth={S} />} label="Dönüştürücü" />
        <NavRow icon={<Wrench strokeWidth={S} />} label="Araç Kutusu" />
        <GroupLabel>Sistem</GroupLabel>
        <NavRow icon={<Sparkles strokeWidth={S} />} label="Yapay Zekâ" />
        <NavRow icon={<Settings strokeWidth={S} />} label="Ayarlar" />
      </nav>

      {/* Apple status footer: kasanın sessiz durumu */}
      <div className="mt-auto flex items-center gap-2 rounded-md border border-rail-border px-2.5 py-1.5 text-2xs text-muted-foreground">
        <span className="size-2 shrink-0 rounded-full bg-state-acquired" />
        <span className="truncate">Yapay Zekâ uyku modunda</span>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------- içerik */

// Sentetik başlıklar; kapak YOK (dekoratif gradyan yerine ürünün gerçek boş kapağı).
const CARDS = [
  { label: 'INSTAGRAM', title: 'Kaydedilen gönderi başlığı iki satıra taşacak kadar uzun' },
  { label: 'YOUTUBE', title: 'Referans video: arayüz hareketi üzerine bir konuşma' },
  { label: 'X', title: 'Uzun bir thread başlığı buraya gelir ve taşar' },
  { label: 'TIKTOK', title: 'Kısa video — montaj tekniği kaydı' },
  { label: 'PINTEREST', title: 'Renk paleti referansı — sentetik örnek kayıt' },
  { label: 'DİĞER', title: 'Genel web sayfası kaydı, iki satıra taşan başlık' },
];

function Card({ label, title }: { label: string; title: string }) {
  return (
    <article className="group cursor-pointer overflow-hidden rounded-xl border border-border bg-card shadow-card transition duration-200 ease-out hover:-translate-y-0.5 hover:border-input hover:shadow-hover">
      <div className="record-band text-muted-foreground">
        <span>{label}</span>
        <span className="ml-auto">12.09.2026</span>
      </div>
      <div className="flex h-36 items-center justify-center border-b border-border bg-muted/30">
        <span className="text-micro text-muted-foreground">KAPAK YOK</span>
      </div>
      <p className="line-clamp-2 px-3 py-2.5 text-sm">{title}</p>
    </article>
  );
}

function Content({ narrow = false }: { narrow?: boolean }) {
  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className={narrow ? 'px-4 py-4' : 'px-7 py-6'}>
        {/* Büyük başlık — kaydırınca araç çubuğuna çekilir (macOS large title) */}
        <h1 className={narrow ? 'text-title' : 'text-display'}>Tümü</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sentetik: 1.204 fiş · 12 koleksiyon · 3 indiriliyor</p>

        <div className="mt-5 mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5 text-xs">
            <span className="rounded-md bg-background px-2.5 py-1 font-medium shadow-xs">Tümü</span>
            <span className="cursor-pointer px-2.5 py-1 text-muted-foreground">Favoriler</span>
            <span className="cursor-pointer px-2.5 py-1 text-muted-foreground">İndirildi</span>
          </div>
          {!narrow && (
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              <ArrowUpDown className="size-3.5" strokeWidth={S} /> En yeni
            </button>
          )}
        </div>

        <div className={narrow ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-2 gap-4'}>
          {CARDS.map((c) => (
            <Card key={c.label} {...c} />
          ))}
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------ denetçi */

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="shrink-0 text-micro text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-sm">{children}</span>
    </div>
  );
}

function Inspector() {
  return (
    <aside className="material-sheet flex w-[360px] shrink-0 flex-col border-l border-border">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-src-instagram" />
          <span className="text-sm font-semibold">Instagram</span>
        </div>
        <button type="button" className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted/60">
          <X className="size-4" strokeWidth={S} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <h2 className="text-title">Kaydedilen gönderi başlığı iki satıra taşacak kadar uzun</h2>
        <p className="mt-1 font-mono text-2xs break-all text-muted-foreground">instagram.com/p/CxxxxVault</p>

        <div className="mt-2 flex items-center gap-2">
          <Stamp state="local">yerel</Stamp>
          <span className="text-micro text-muted-foreground">18,4 MB · 12.09.2026</span>
        </div>

        {/* Düz hairline satır listesi — iç içe kart YOK (craft-floor) */}
        <div className="mt-4 flex flex-col divide-y divide-border/70 border-t border-border/70">
          <InfoRow label="Koleksiyon">Tasarım</InfoRow>
          <InfoRow label="Etiketler">ui · referans</InfoRow>
          <InfoRow label="Kategori">İlham</InfoRow>
        </div>
      </div>

      <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-border px-4">
        <Button className="flex-1">
          <Play /> Oynat
        </Button>
        <Button variant="outline" size="icon" aria-label="Dönüştür">
          <Scissors />
        </Button>
        <Button variant="destructive" size="icon" aria-label="Sil">
          <Trash2 />
        </Button>
      </footer>
    </aside>
  );
}

/* ------------------------------------------------------- araç çubuğu */

function Toolbar({ narrow = false }: { narrow?: boolean }) {
  return (
    <header className="material-toolbar flex h-13 shrink-0 items-center gap-3 border-b border-border px-3">
      {/* Sol: trafik ışıkları + gezinme (ray üstünde) */}
      <div className={`flex shrink-0 items-center gap-1.5 ${narrow ? '' : 'w-[228px]'}`}>
        <div className="flex items-center gap-2 pr-1">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>
        {narrow ? (
          <button type="button" className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted/60">
            <Menu className="size-4" strokeWidth={S} />
          </button>
        ) : (
          <>
            <button type="button" className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted/60">
              <PanelLeft className="size-4" strokeWidth={S} />
            </button>
            <button type="button" className="cursor-pointer rounded-md p-1 text-muted-foreground/50">
              <ArrowLeft className="size-4" strokeWidth={S} />
            </button>
            <button type="button" className="cursor-pointer rounded-md p-1 text-muted-foreground/50">
              <ArrowRight className="size-4" strokeWidth={S} />
            </button>
          </>
        )}
      </div>

      {/* Orta: imza etkileşim — yakala/ara alanı, Safari gibi ortada */}
      <div className="flex min-w-0 flex-1 justify-center">
        <div className={`relative ${narrow ? 'w-full' : 'w-[420px] max-w-full'}`}>
          <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary" strokeWidth={S} />
          <div className="flex h-8 items-center rounded-lg border border-input bg-card/70 pr-2 pl-9 text-sm text-muted-foreground">
            <span className="truncate">Link yapıştır veya arşivde ara…</span>
            {!narrow && <kbd className="ml-auto rounded-xs border border-border px-1 py-px font-mono text-2xs">⌘K</kbd>}
          </div>
        </div>
      </div>

      {/* Sağ: görünüm denetimleri */}
      <div className="flex shrink-0 items-center gap-1">
        <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5">
          <span className="cursor-pointer rounded-md bg-background px-1.5 py-1 shadow-xs">
            <LayoutGrid className="size-4" strokeWidth={S} />
          </span>
          <span className="cursor-pointer px-1.5 py-1 text-muted-foreground">
            <Rows3 className="size-4" strokeWidth={S} />
          </span>
        </div>
        <button type="button" className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:bg-muted/60">
          <Sun className="size-4" strokeWidth={S} />
        </button>
      </div>
    </header>
  );
}

/* Dar pencerede ray yatay şeride iner — gezinme kaybolmaz (PRODUCT.md) */
function NavStrip() {
  const items = ['Tümü', 'Favoriler', 'Koleksiyonlar', 'İndirme', 'Eşitleme', 'Araçlar'];
  return (
    <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-rail px-2 py-1.5 text-rail-foreground">
      {items.map((l, i) => (
        <button
          key={l}
          type="button"
          className={`shrink-0 cursor-pointer rounded-md px-2.5 py-1 text-xs ${
            i === 0 ? 'bg-primary/15 font-medium text-foreground' : 'text-muted-foreground'
          }`}
        >
          {l}
        </button>
      ))}
    </nav>
  );
}

/* --------------------------------------------------------------- kare */

function Frame({ w, h, label, children }: { w: number; h: number; label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <h2 className="text-sm font-semibold text-neutral-100">{label}</h2>
        <span className="font-mono text-2xs text-neutral-400">
          {w} × {h} px · sentetik içerik
        </span>
      </div>
      <div
        style={{ width: w, height: h }}
        className="flex flex-col overflow-hidden rounded-xl border border-black/50 bg-background shadow-lift"
      >
        {children}
      </div>
    </section>
  );
}

function Mock() {
  return (
    <div className="min-h-screen bg-neutral-900 p-8 font-sans text-foreground">
      <div className="flex flex-col gap-10">
        <Frame w={1280} h={800} label="Geniş — varsayılan pencere">
          <Toolbar />
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <Content />
            <Inspector />
          </div>
        </Frame>

        <Frame w={640} h={800} label="Dar — birinci sınıf kullanım">
          <Toolbar narrow />
          <NavStrip />
          <Content narrow />
        </Frame>
      </div>

      <div className="mt-8 max-w-[900px]">
        <h2 className="text-sm font-semibold tracking-wide text-neutral-100 uppercase">
          Apple düzen önerisi — ne değişirdi
        </h2>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[0.8125rem] leading-relaxed text-neutral-300">
          <li>Birleşik araç çubuğu (52px): marka başlığı kalkar; trafik ışıkları solda, yakala/arama alanı ortada, görünüm denetimleri sağda.</li>
          <li>İçerikte büyük başlık: aşağı kaydıkça araç çubuğuna çekilir (macOS large title).</li>
          <li>Segmentli filtre; sıralama sağda sessiz düğme.</li>
          <li>Ray 244px (token), bölüm başlıkları + kapsül seçim + sessiz durum altlığı.</li>
          <li>Kayıt paneli modal değil, sağda sabit yarı saydam denetçi (perde yok) — Finder Önizleme / Fotoğraflar Bilgi.</li>
          <li>Dar pencerede ray yatay şeride iner; denetçi alttan yaprak olur (bu karede gösterilmedi).</li>
        </ol>
        <p className="mt-3 text-[0.8125rem] text-neutral-400">
          Tek bilinçli kırılma: pencere kontrolleri solda (gerçek Mac yeri). Windows alışkanlığı korunacaksa
          ışıklar sağda kalır; diğer maddeler etkilenmez.
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<Mock />);
