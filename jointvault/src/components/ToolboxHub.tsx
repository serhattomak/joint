import { Captions, ChevronRight, Combine, Copy, Film, Scissors, Wrench } from 'lucide-react';
import { PageSurface } from '@/components/ui/page-surface';

export type ToolboxToolId = 'merge' | 'silence' | 'gif' | 'subtitle' | 'duplicates';

interface ToolboxHubProps {
  onPick: (toolId: ToolboxToolId) => void;
}

const TOOLS: { id: ToolboxToolId; icon: React.ReactNode; title: string; desc: string }[] = [
  {
    id: 'duplicates',
    icon: <Copy />,
    title: 'Yinelenenler & Temizlik',
    desc: 'Kopya URL, dosya tekrarları ve yetim dosyaları temizle.',
  },
  {
    id: 'merge',
    icon: <Combine />,
    title: 'Birleştir',
    desc: 'Birden çok videoyu tek dosyada topla.',
  },
  {
    id: 'silence',
    icon: <Scissors />,
    title: 'Sessizlik Kırpma',
    desc: 'Sessiz bölümleri otomatik temizle.',
  },
  {
    id: 'gif',
    icon: <Film />,
    title: 'GIF / WebM',
    desc: 'Kısa kliplerden paylaşımlık döngüler yap.',
  },
  {
    id: 'subtitle',
    icon: <Captions />,
    title: 'Altyazı',
    desc: 'Altyazı göm, çıkar veya otomatik üret.',
  },
];

/*
 * Araç Kutusu — Ayarlar'ın gruplandırılmış liste dili: tek opak kart, hairline
 * satırlar, solda tinted ikon çipi, sağda açılış oku. Araç seçilince doğrudan
 * açılır; arada ikinci bir "aç" adımı yok.
 */
export function ToolboxHub({ onPick }: ToolboxHubProps) {
  return (
    <PageSurface
      icon={<Wrench strokeWidth={2} />}
      title="Araç Kutusu"
      description="Kasadaki medyayı yerelde işleyen araçlar."
      width="3xl"
    >
      <div className="settings-card flex flex-col divide-y divide-border/70 overflow-hidden">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t.id)}
            className="group flex items-center gap-3 px-4 py-3 text-left transition-colors duration-150 ease-out hover:bg-muted/40"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-[18px]">
              {t.icon}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">{t.title}</span>
              <span className="text-micro text-muted-foreground">{t.desc}</span>
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover:translate-x-0.5"
              aria-hidden
            />
          </button>
        ))}
      </div>
    </PageSurface>
  );
}
