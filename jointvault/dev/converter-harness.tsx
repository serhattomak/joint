/*
 * Dönüştürücü doğrulama tezgâhı — üretim kodu DEĞİL.
 *
 * Gerçek `ConversionStudio` alt bileşenlerini sentetik veriyle basar; böylece
 * üç kolonun 1280/1024/768/390 davranışı, hedef karoları, çalıştırma çubuğu ve
 * iş defteri Tauri olmadan görülebilir. Her örnek içerik SENTETİK'tir.
 *
 *   /dev/converter-harness.html?tab=convert&state=running
 *   state: default | empty | running | done | mixed
 */
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Clapperboard, Loader2 } from 'lucide-react';
import '../src/index.css';
import { BrandMark } from '@/components/BrandMark';
import { ComponentInstallerProvider } from '@/components/ComponentInstaller';
import { NoticeProvider } from '@/components/ui/notice';
import { PageSurface } from '@/components/ui/page-surface';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConversionHistory } from '@/components/conversion/ConversionHistory';
import { ConversionJobs } from '@/components/conversion/ConversionJobs';
import { ConversionSources } from '@/components/conversion/ConversionSources';
import { ConversionTarget } from '@/components/conversion/ConversionTarget';
import { PdfTools } from '@/components/conversion/PdfTools';
import type { ConversionSource, RunJobView } from '@/components/conversion/types';
import { defaultOptions, type ConversionOptions } from '@/lib/conversion';
import { cn } from 'cn';

const params = new URLSearchParams(window.location.search);
const scenario = params.get('state') ?? 'default';
const initialTab = params.get('tab') === 'pdf' ? 'pdf' : 'convert';

const source = (
  id: string,
  name: string,
  family: ConversionSource['family'],
  ext: string,
  size: number,
  origin: ConversionSource['origin'] = 'vault',
): ConversionSource => ({
  id,
  path: `C:\\Arşiv\\Dönüşüm\\${name}`,
  name,
  ext,
  family,
  size,
  origin,
});

const VIDEO_SOURCES = [
  source('v1', 'roportaj-kesit.mp4', 'video', 'mp4', 734_003_200),
  source('v2', 'seyahat-gunlugu.mov', 'video', 'mov', 1_287_000_000),
  source('v3', 'konser-kaydi.mkv', 'video', 'mkv', 2_147_000_000),
];
const EXTRA_SOURCES = [
  source('e1', 'arsiv-notlari.pdf', 'pdf', 'pdf', 842_000),
  source('e2', 'kapak-gorseli.png', 'image', 'png', 2_400_000, 'external'),
  source('e3', 'sunum-taslak.pptx', 'presentation', 'pptx', 6_100_000),
];
const MIXED_SOURCES = [
  VIDEO_SOURCES[0],
  source('m1', 'kapak-gorseli.png', 'image', 'png', 2_400_000, 'external'),
  source('m2', 'arsiv-notlari.pdf', 'pdf', 'pdf', 842_000),
];

const allSources =
  scenario === 'empty'
    ? []
    : scenario === 'mixed'
      ? MIXED_SOURCES
      : [...VIDEO_SOURCES, ...EXTRA_SOURCES];

const initialSelected =
  scenario === 'empty'
    ? []
    : scenario === 'mixed'
      ? MIXED_SOURCES.map((item) => item.id)
      : VIDEO_SOURCES.map((item) => item.id);

const baseJob = {
  target: 'mp4',
  outputs: [] as string[],
  warnings: [] as string[],
  outputPath: '',
  options: {},
  family: 'video' as const,
};

const IDLE_JOBS: RunJobView[] = [
  {
    ...baseJob,
    id: 'j1',
    name: 'roportaj-kesit.mp4',
    path: VIDEO_SOURCES[0].path,
    status: 'done',
    percent: 100,
    phase: 'tamamlandı',
    outputs: ['C:\\Arşiv\\Dönüşüm\\roportaj-kesit-mp4.mp4'],
    outputPath: 'C:\\Arşiv\\Dönüşüm\\roportaj-kesit-mp4.mp4',
  },
  {
    ...baseJob,
    id: 'j2',
    name: 'seyahat-gunlugu.mov',
    path: VIDEO_SOURCES[1].path,
    status: 'error',
    percent: 0,
    phase: 'hata',
    error: 'ffmpeg çıktı üretmedi; kaynak akış okunamadı.',
    outputPath: 'C:\\Arşiv\\Dönüşüm\\seyahat-gunlugu-mp4.mp4',
  },
  {
    ...baseJob,
    id: 'j3',
    name: 'konser-kaydi.mkv',
    path: VIDEO_SOURCES[2].path,
    status: 'cancelled',
    percent: 0,
    phase: 'iptal',
    outputPath: 'C:\\Arşiv\\Dönüşüm\\konser-kaydi-mp4.mp4',
  },
];

const RUNNING_JOBS: RunJobView[] = [
  {
    ...baseJob,
    id: 'r1',
    name: 'roportaj-kesit.mp4',
    path: VIDEO_SOURCES[0].path,
    status: 'running',
    percent: 62,
    phase: 'dönüştürülüyor',
    outputPath: 'C:\\Arşiv\\Dönüşüm\\roportaj-kesit-mp4.mp4',
  },
  {
    ...baseJob,
    id: 'r2',
    name: 'seyahat-gunlugu.mov',
    path: VIDEO_SOURCES[1].path,
    status: 'queued',
    percent: 0,
    phase: 'kuyrukta',
    outputPath: 'C:\\Arşiv\\Dönüşüm\\seyahat-gunlugu-mp4.mp4',
  },
  {
    ...baseJob,
    id: 'r3',
    name: 'konser-kaydi.mkv',
    path: VIDEO_SOURCES[2].path,
    status: 'done',
    percent: 100,
    phase: 'tamamlandı',
    outputs: ['C:\\Arşiv\\Dönüşüm\\konser-kaydi-mp4.mp4'],
    outputPath: 'C:\\Arşiv\\Dönüşüm\\konser-kaydi-mp4.mp4',
  },
];

const DONE_JOBS = VIDEO_SOURCES.map<RunJobView>((item, index) => ({
  ...baseJob,
  id: `d${index}`,
  name: item.name,
  path: item.path,
  status: 'done',
  percent: 100,
  phase: 'tamamlandı',
  outputs: [`C:\\Arşiv\\Dönüşüm\\${item.name.replace(/\.[^.]+$/, '-mp4.mp4')}`],
  outputPath: `C:\\Arşiv\\Dönüşüm\\${item.name.replace(/\.[^.]+$/, '-mp4.mp4')}`,
}));

const jobs =
  scenario === 'empty'
    ? []
    : scenario === 'running'
      ? RUNNING_JOBS
      : scenario === 'done'
        ? DONE_JOBS
        : IDLE_JOBS;

function Harness() {
  const [tab, setTab] = useState<'convert' | 'pdf' | 'history'>(initialTab);
  const [sources, setSources] = useState(allSources);
  const [selected, setSelected] = useState(new Set(initialSelected));
  const [target, setTarget] = useState('mp4');
  const [options, setOptions] = useState<ConversionOptions>(defaultOptions);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [running, setRunning] = useState(scenario === 'running');

  const selectedSources = useMemo(
    () => sources.filter((item) => selected.has(item.id)),
    [sources, selected],
  );
  const families = useMemo(
    () => [...new Set(selectedSources.map((item) => item.family))].sort((a, b) => a.localeCompare(b, 'tr')),
    [selectedSources],
  );
  const outputPreview = selectedSources[0]
    ? `C:\\Arşiv\\Dönüşüm\\${selectedSources[0].name.replace(/\.[^.]+$/, `-${target}.${target}`)}`
    : '';

  const toggle = (id: string): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = (ids: string[]): void => {
    setSelected((previous) => {
      const all = ids.length > 0 && ids.every((id) => previous.has(id));
      if (all) {
        const next = new Set(previous);
        for (const id of ids) next.delete(id);
        return next;
      }
      return new Set([...previous, ...ids]);
    });
  };
  const remove = (id: string): void => {
    setSources((previous) => previous.filter((item) => item.id !== id));
    setSelected((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        aria-hidden
        className="material-rail hidden w-[244px] shrink-0 flex-col gap-0.5 border-r border-rail-border p-3 md:flex"
      >
        <div className="mb-2 flex items-center gap-2 px-1.5 py-1">
          <BrandMark className="size-5" />
          <span className="text-sm font-semibold">JointVault</span>
        </div>
        {[
          'Arşiv',
          'Defter',
          'Koleksiyonlar',
          'İndirilenler',
          'Eşitleme',
          'Araçlar',
          'Dönüştürücü',
          'İstatistikler',
        ].map((label) => (
          <span
            key={label}
            className={cn(
              'flex h-[30px] items-center rounded-sm px-2 text-[13px]',
              label === 'Dönüştürücü'
                ? 'bg-card font-medium'
                : 'text-muted-foreground',
            )}
          >
            {label}
          </span>
        ))}
      </aside>

      <main className="min-w-0 flex-1">
        <PageSurface
          icon={<Clapperboard />}
          title="Dönüştürücü"
          description="Belge, PDF, görsel, ses ve videoyu yerelde dönüştür; çıktı arşive döner."
          width="6xl"
        >
          <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)} className="gap-3">
            <TabsList>
              <TabsTab value="convert">
                {running && <Loader2 className="animate-spin" aria-hidden />}
                Dönüştür
                {running && <span className="sr-only">— dönüşüm sürüyor</span>}
              </TabsTab>
              <TabsTab value="pdf">PDF araçları</TabsTab>
              <TabsTab value="history">Geçmiş</TabsTab>
            </TabsList>

            <TabsPanel value="convert">
              <div className="studio-bench">
                <div className="studio-grid">
                  <ConversionSources
                    sources={sources}
                    selected={selected}
                    busy={running}
                    onToggle={toggle}
                    onSelectAll={selectAll}
                    onRemove={remove}
                    onAddFiles={() => undefined}
                    onAddFolder={() => undefined}
                  />
                  <ConversionTarget
                    families={families}
                    target={target}
                    selectedCount={selectedSources.length}
                    options={options}
                    outputPreview={outputPreview}
                    outputDir={outputDir}
                    running={running}
                    overallPercent={62}
                    onTargetChange={setTarget}
                    onOptionsChange={(patch) =>
                      setOptions((previous) => ({ ...previous, ...patch }))
                    }
                    onPickOutputDir={() => setOutputDir('C:\\Arşiv\\Dönüşüm')}
                    onClearOutputDir={() => setOutputDir(null)}
                    onRun={() => setRunning(true)}
                    onCancel={() => setRunning(false)}
                  />
                  <ConversionJobs jobs={jobs} running={running} />
                </div>
              </div>
            </TabsPanel>

            <TabsPanel value="pdf">
              <PdfTools onDone={() => undefined} />
            </TabsPanel>

            <TabsPanel value="history">
              <ConversionHistory refreshKey={0} />
            </TabsPanel>
          </Tabs>
        </PageSurface>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <NoticeProvider>
    <ComponentInstallerProvider>
      <TooltipProvider delay={100}>
        <Harness />
      </TooltipProvider>
    </ComponentInstallerProvider>
  </NoticeProvider>,
);
