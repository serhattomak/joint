/*
 * Fiş modalı önerisi — üretim kodu DEĞİL, tartışma mockup'ı.
 * İçerik SENTETİK'tir. Gerçek modal ölçüsünde basar: 1024×704 (w-max-w-5xl · h-88vh).
 */
import { createRoot } from 'react-dom/client';
import {
  AlignLeft,
  BookOpen,
  Download,
  ExternalLink,
  Play,
  Scissors,
  Star,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Stamp } from '@/components/ui/stamp';
import '../src/index.css';

const S = 1.75;

function IconBtn({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground"
    >
      {children}
    </button>
  );
}

function Tabs({ active }: { active: 'detail' | 'reader' }) {
  const items: { id: 'detail' | 'reader'; label: string; icon: React.ReactNode }[] = [
    { id: 'detail', label: 'Detay', icon: <AlignLeft className="size-3.5" strokeWidth={S} /> },
    { id: 'reader', label: 'Oku', icon: <BookOpen className="size-3.5" strokeWidth={S} /> },
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5 text-xs">
      {items.map((t) => (
        <span
          key={t.id}
          className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 ${
            active === t.id ? 'bg-background font-medium shadow-xs' : 'text-muted-foreground'
          }`}
        >
          {t.icon}
          {t.label}
        </span>
      ))}
    </div>
  );
}

function ModalHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="size-2 shrink-0 rounded-full bg-src-instagram" />
        <span className="shrink-0 text-sm font-semibold">Instagram</span>
        <span className="text-muted-foreground/40">/</span>
        <span className="truncate text-sm text-muted-foreground">
          Kaydedilen gönderi başlığı iki satıra taşacak kadar uzun
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Tabs active="detail" />
        <IconBtn label="Dış bağlantı">
          <ExternalLink className="size-4" strokeWidth={S} />
        </IconBtn>
        <IconBtn label="Kapat">
          <X className="size-4" strokeWidth={S} />
        </IconBtn>
      </div>
    </header>
  );
}

function MetaRows() {
  const rows: [string, React.ReactNode][] = [
    ['Koleksiyon', 'Tasarım'],
    ['Etiketler', 'ui · referans'],
    ['Kategori', 'İlham'],
    ['Konum', 'instagram.com/p/CxxxxVault'],
  ];
  return (
    <div className="flex flex-col divide-y divide-border/70 border-t border-border/70">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3 py-2">
          <span className="shrink-0 text-micro text-muted-foreground">{k}</span>
          <span className="min-w-0 truncate text-sm">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Note() {
  return (
    <div className="mt-4 flex flex-col gap-1.5">
      <span className="text-micro font-medium text-muted-foreground">Not</span>
      <div className="min-h-[64px] rounded-md border border-input px-3 py-2 text-sm text-muted-foreground">
        Sentetik not alanı…
      </div>
    </div>
  );
}

function AiActions() {
  return (
    <div className="mt-4 flex flex-wrap gap-1.5">
      <Button variant="outline" size="sm">
        <Wand2 /> Etiket öner
      </Button>
      <Button variant="outline" size="sm">
        <AlignLeft /> Özetle
      </Button>
    </div>
  );
}

function ModalFooter() {
  return (
    <footer className="flex h-14 shrink-0 items-center justify-between gap-3 border-t border-border px-4">
      <div className="flex items-center gap-2">
        <Button>
          <Play /> Oynat
        </Button>
        <Button variant="outline">
          <Download /> İndir
        </Button>
        <Button variant="outline">
          <Scissors /> Dönüştür
        </Button>
        <Button variant="ghost" size="icon" aria-label="Favori">
          <Star />
        </Button>
      </div>
      <Button variant="destructive">
        <Trash2 /> Sil
      </Button>
    </footer>
  );
}

function MediaBlock({ className = '' }: { className?: string }) {
  return (
    <div className={`grid place-items-center rounded-xl border border-border bg-muted/30 ${className}`}>
      <span className="text-micro text-muted-foreground">KAPAK YOK · sentetik</span>
    </div>
  );
}

/* A — Bölünmüş: medya solda büyük, künye sağda. */
function VariantSplit() {
  return (
    <div className="flex h-full flex-col">
      <ModalHeader />
      <div className="flex min-h-0 flex-1">
        <div className="grid min-w-0 flex-1 place-items-center p-6">
          <MediaBlock className="aspect-video w-full max-w-[560px]" />
        </div>
        <aside className="w-[360px] shrink-0 overflow-y-auto border-l border-border p-5">
          <h2 className="text-title">Kaydedilen gönderi başlığı iki satıra taşacak kadar uzun</h2>
          <div className="mt-2 flex items-center gap-2">
            <Stamp state="local">yerel</Stamp>
            <span className="text-micro text-muted-foreground">18,4 MB · 12.09.2026</span>
          </div>
          <div className="mt-4">
            <MetaRows />
          </div>
          <Note />
          <AiActions />
        </aside>
      </div>
      <ModalFooter />
    </div>
  );
}

/* B — Medya üstte tam genişlik, künye altta iki kolon. */
function VariantStacked() {
  return (
    <div className="flex h-full flex-col">
      <ModalHeader />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-6 pt-6">
          <MediaBlock className="aspect-video w-full max-w-[720px] mx-auto" />
        </div>
        <div className="grid gap-6 p-6 md:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            <h2 className="text-title">Kaydedilen gönderi başlığı iki satıra taşacak kadar uzun</h2>
            <div className="mt-2 flex items-center gap-2">
              <Stamp state="local">yerel</Stamp>
              <span className="text-micro text-muted-foreground">18,4 MB · 12.09.2026</span>
            </div>
            <Note />
          </div>
          <div className="min-w-0">
            <MetaRows />
            <AiActions />
          </div>
        </div>
      </div>
      <ModalFooter />
    </div>
  );
}

function Frame({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <h2 className="text-sm font-semibold text-neutral-100">{label}</h2>
        <span className="text-2xs text-neutral-400">{note}</span>
      </div>
      <div
        style={{ width: 1024, height: 704 }}
        className="material-sheet overflow-hidden rounded-2xl border border-border text-foreground shadow-lift"
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
        <Frame
          label="A — Bölünmüş (önerilen)"
          note="1024×704 · sentetik içerik"
        >
          <VariantSplit />
        </Frame>
        <Frame label="B — Medya üstte, künye altta" note="1024×704 · sentetik içerik">
          <VariantStacked />
        </Frame>
      </div>

      <div className="mt-8 max-w-[900px]">
        <h2 className="text-sm font-semibold tracking-wide text-neutral-100 uppercase">Fiş modalı — iki aday</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[0.8125rem] leading-relaxed text-neutral-300">
          <li>
            <strong>A (bölünmüş):</strong> medya solda büyük (16:9, ~560px), künye sağda 360px. Fotoğraflar/albüm
            Bilgi deseni. Medya odakta; künye kaydırmalı.
          </li>
          <li>
            <strong>B (medya üstte):</strong> medya tam genişlik, künye altta iki kolon. Metin/okuma ve not için daha
            ferah; medya için dikey alan harcar.
          </li>
          <li>Kabuk sabit kalır: platform çipi + başlık solda, Detay/Oku segmenti + dış bağlantı + kapat sağda.</li>
          <li>İkisi de mevcut modal boyunda (1024×704) — dar bir panele sıkışma yok.</li>
        </ul>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<Mock />);
