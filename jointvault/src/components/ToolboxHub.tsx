import { useState } from 'react';
import { Captions, Combine, Film, Scissors, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type ToolboxToolId = 'merge' | 'silence' | 'gif' | 'subtitle';

interface ToolboxHubProps {
  onPick: (toolId: ToolboxToolId) => void;
}

const TOOLS: { id: ToolboxToolId; icon: React.ReactNode; title: string; desc: string; ready: boolean }[] = [
  {
    id: 'merge',
    icon: <Combine className="size-5 text-primary" strokeWidth={2} />,
    title: 'Birleştir',
    desc: 'Birden çok videoyu tek dosyada topla.',
    ready: true,
  },
  {
    id: 'silence',
    icon: <Scissors className="size-5 text-primary" strokeWidth={2} />,
    title: 'Sessizlik Kırpma',
    desc: 'Sessiz bölümleri otomatik temizle.',
    ready: true,
  },
  {
    id: 'gif',
    icon: <Film className="size-5 text-primary" strokeWidth={2} />,
    title: 'GIF / WebM',
    desc: 'Kısa kliplerden paylaşımlık döngüler yap.',
    ready: true,
  },
  {
    id: 'subtitle',
    icon: <Captions className="size-5 text-primary" strokeWidth={2} />,
    title: 'Altyazı',
    desc: 'Altyazı göm, çıkar veya otomatik üret.',
    ready: true,
  },
];

// Araç Kutusu hub: kartlı grid. Hazır araçlar doğrudan açılır;
// hazır olmayanlar placeholder not + "Dönüştürücü'ye git" gösterir.
export function ToolboxHub({ onPick }: ToolboxHubProps) {
  const [selected, setSelected] = useState<ToolboxToolId | null>(null);
  const active = TOOLS.find((t) => t.id === selected) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Wrench className="size-5 text-primary" strokeWidth={2} />
        <h2 className="font-display text-xl tracking-tight">Araç Kutusu</h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {TOOLS.map((t) => {
          const isActive = selected === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelected(t.id)}
              aria-pressed={isActive}
              className={`flex flex-col gap-2 rounded-xl border bg-card p-4 text-left shadow-card transition ${
                isActive
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border hover:border-primary/30'
              }`}
            >
              <span className="flex items-center justify-between">
                {t.icon}
                {!t.ready && (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
                    yakında
                  </span>
                )}
              </span>
              <span className="font-display text-[15px]">{t.title}</span>
              <span className="text-sm text-muted-foreground">{t.desc}</span>
            </button>
          );
        })}
      </div>
      {active && (
        <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-card">
          {active.ready ? (
            <>
              <p className="text-sm">
                <span className="font-medium">{active.title}</span>{' '}
                <span className="text-muted-foreground">hazır — açıp kullanmaya başlayabilirsin.</span>
              </p>
              <div>
                <Button size="sm" onClick={() => onPick(active.id)}>
                  {active.title} aracını aç
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm">
                <span className="font-medium">{active.title}</span>{' '}
                <span className="text-muted-foreground">
                  henüz hazır değil — şimdilik Dönüştürücü ile devam edebilirsin.
                </span>
              </p>
              <div>
                <Button size="sm" onClick={() => onPick(active.id)}>
                  Dönüştürücü&apos;ye git
                </Button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
