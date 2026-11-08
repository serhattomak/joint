import { useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  Database,
  Download,
  Eye,
  Mic,
  PackageCheck,
  Plug,
  Settings,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ComponentsSection } from '@/components/ComponentsSection';
import { DiagnosticsPanel } from '@/components/DiagnosticsPanel';
import { AiSettingsTab } from './settings/AiSettingsTab';
import { BackupSettingsTab } from './settings/BackupSettingsTab';
import { DownloadsSettingsTab } from './settings/DownloadsSettingsTab';
import { ExtensionSettingsTab } from './settings/ExtensionSettingsTab';
import { SpeechSettingsTab } from './settings/SpeechSettingsTab';
import { ViewSettingsTab } from './settings/ViewSettingsTab';

export type SettingsTab =
  | 'view'
  | 'downloads'
  | 'speech'
  | 'ai'
  | 'diagnostics'
  | 'extension'
  | 'backup'
  | 'components';

export interface SettingsViewProps {
  pageSize: number;
  pageSizes: readonly number[];
  onPageSizeChange: (n: number) => void;
  onReplayTour: () => void;
  onClose?: () => void;
  initialTab?: SettingsTab;
}

export function SettingsView(props: SettingsViewProps) {
  const { pageSize, pageSizes, onPageSizeChange, onReplayTour, onClose, initialTab = 'ai' } = props;
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  const tabs: { id: SettingsTab; label: string; icon: ReactNode; desc: string }[] = [
    {
      id: 'ai',
      label: 'Yapay Zekâ',
      icon: <Sparkles className="size-4" />,
      desc: 'Qwen 2.5 3B/7B/14B, BGE-M3, VRAM yönetimi, taksonomi ve indeksleme',
    },
    {
      id: 'speech',
      label: 'Konuşma (Whisper)',
      icon: <Mic className="size-4" />,
      desc: 'Whisper.cpp yerel konuşma tanıma motoru ve modelleri',
    },
    {
      id: 'view',
      label: 'Görünüm',
      icon: <Eye className="size-4" />,
      desc: 'Arayüz teması, sayfalama, pano izleme ve açılış tercihleri',
    },
    {
      id: 'downloads',
      label: 'İndirme',
      icon: <Download className="size-4" />,
      desc: 'Medya indirme klasörü, varsayılan kalite ve sistem çekmecesi',
    },
    {
      id: 'components',
      label: 'Bileşenler',
      icon: <PackageCheck className="size-4" />,
      desc: 'ffmpeg, ffprobe, yt-dlp ve whisper motorunun kurulum durumu',
    },
    {
      id: 'diagnostics',
      label: 'Tanılama',
      icon: <Activity className="size-4" />,
      desc: 'Sistem donanımı, CUDA, ffmpeg ve yt-dlp sağlık kontrolleri',
    },
    {
      id: 'extension',
      label: 'Eklenti',
      icon: <Plug className="size-4" />,
      desc: 'Tarayıcı uzantısı ile güvenli bağlantı eşleşme anahtarı',
    },
    {
      id: 'backup',
      label: 'Yedekleme',
      icon: <Database className="size-4" />,
      desc: 'Arşiv veritabanını JSON olarak dışa aktar veya geri yükle',
    },
  ];

  const currentTab = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Üst Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Settings className="size-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">Ayarlar</h1>
            <p className="text-2xs text-muted-foreground">
              Sistem tercihleri, modeller, donanım hızlandırma ve arşiv yönetimi
            </p>
          </div>
        </div>

        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Arşive Dön
          </Button>
        )}
      </header>

      {/* Ana Gövde: 2 Sütunlu Sayfa Düzeni */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sol Sekme Menüsü (Desktop) */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/50 p-2.5 md:flex overflow-y-auto">
          <nav className="flex flex-col gap-0.5">
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] transition-colors duration-150 ease-out ${
                    active
                      ? 'bg-primary/15 font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                  }`}
                >
                  <span className={active ? 'text-primary' : undefined}>{t.icon}</span>
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Sağ İçerik Alanı: Rahatça Aşağı Kayan Doğal Sayfa */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-8">
          {/* Mobil Yatay Sekme Menüsü */}
          <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1 md:hidden no-scrollbar">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors duration-150 ease-out ${
                  tab === t.id
                    ? 'bg-primary/15 font-medium text-foreground'
                    : 'bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                <span className={tab === t.id ? 'text-primary' : undefined}>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <div className="mx-auto max-w-3xl flex flex-col gap-6 pb-12">
            <div className="border-b border-border/60 pb-3">
              <h2 className="text-base font-semibold">{currentTab.label}</h2>
              <p className="text-xs text-muted-foreground">{currentTab.desc}</p>
            </div>

            {tab === 'ai' && <AiSettingsTab />}
            {tab === 'speech' && <SpeechSettingsTab />}
            {tab === 'view' && (
              <ViewSettingsTab
                pageSize={pageSize}
                pageSizes={pageSizes}
                onPageSizeChange={onPageSizeChange}
                onReplayTour={onReplayTour}
              />
            )}
            {tab === 'downloads' && <DownloadsSettingsTab />}
            {tab === 'diagnostics' && <DiagnosticsPanel />}
            {tab === 'extension' && <ExtensionSettingsTab />}
            {tab === 'components' && <ComponentsSection />}
            {tab === 'backup' && <BackupSettingsTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
