import { Captions, ChevronRight, Combine, Copy, Film, Scissors, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageSurface } from '@/components/ui/page-surface';

export type ToolboxToolId = 'merge' | 'silence' | 'gif' | 'subtitle' | 'duplicates';

interface ToolboxHubProps {
  onPick: (toolId: ToolboxToolId) => void;
}

const TOOLS: { id: ToolboxToolId; icon: React.ReactNode; title: string; desc: string }[] = [
  {
    id: 'duplicates',
    icon: <Copy className="size-4" />,
    title: 'Yinelenenler & Temizlik',
    desc: 'Kopya URL, dosya tekrarları ve yetim dosyaları temizle.',
  },
  {
    id: 'merge',
    icon: <Combine className="size-4" />,
    title: 'Birleştir',
    desc: 'Birden çok videoyu tek dosyada topla.',
  },
  {
    id: 'silence',
    icon: <Scissors className="size-4" />,
    title: 'Sessizlik Kırpma',
    desc: 'Sessiz bölümleri otomatik temizle.',
  },
  {
    id: 'gif',
    icon: <Film className="size-4" />,
    title: 'GIF / WebM',
    desc: 'Kısa kliplerden paylaşımlık döngüler yap.',
  },
  {
    id: 'subtitle',
    icon: <Captions className="size-4" />,
    title: 'Altyazı',
    desc: 'Altyazı göm, çıkar veya otomatik üret.',
  },
];

/*
 * Araç Kutusu — kart ızgarası değil, çekmece dizini: cetvelle ayrılmış satırlar,
 * solda araç mührü, sağda açılış oku. Araç seçilince doğrudan açılır; arada
 * ikinci bir "aç" adımı yok.
 */
export function ToolboxHub({ onPick }: ToolboxHubProps) {
  return (
    <PageSurface icon={<Wrench strokeWidth={2} />} title="Araç Kutusu" width="3xl">
      <div className="flex flex-col divide-y divide-border border border-border bg-card">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t.id)}
            className="group flex items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 ease-paper hover:bg-muted/50"
          >
            <span className="flex size-7 shrink-0 items-center justify-center border border-border text-primary">
              {t.icon}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">{t.title}</span>
              <span className="text-micro text-muted-foreground">{t.desc}</span>
            </span>
            <Badge variant="outline" className="shrink-0">
              hazır
            </Badge>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-paper group-hover:translate-x-0.5"
              aria-hidden
            />
          </button>
        ))}
      </div>
    </PageSurface>
  );
}
