import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BarChart3, Captions, Clapperboard, Combine, Copy, Download, Film, LayoutGrid, Plus, Rows3, Scissors, Settings, SlidersHorizontal, Sparkles, Star, Sun, Upload, Wrench } from 'lucide-react';
import { AddItemDialog } from '@/components/AddItemDialog';
import { BulkImportDialog } from '@/components/BulkImportDialog';
import { CaptureBar } from '@/components/CaptureBar';
import { ClipboardWatcher } from '@/components/ClipboardWatcher';
import { CommandPalette, type PaletteCommand } from '@/components/CommandPalette';
import { ConverterStudio } from '@/components/ConverterStudio';
import { DownloadDialog } from '@/components/DownloadDialog';
import { DuplicatesView } from '@/components/DuplicatesView';
import { WelcomeDialog, isOnboarded } from '@/components/WelcomeDialog';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { EditorDialog, type EditorSource } from '@/components/EditorDialog';
import { FormatDialog, type FormatTarget } from '@/components/FormatDialog';
import { ItemGrid, PAGE_SIZES, readPageSize } from '@/components/ItemGrid';
import { ItemRecord } from '@/components/ItemRecord';
import { MergeTool } from '@/components/MergeTool';
import { GifTool } from '@/components/GifTool';
import { OrganizeDialog } from '@/components/OrganizeDialog';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Sidebar, SidebarStrip } from '@/components/Sidebar';
import { SilenceTool } from '@/components/SilenceTool';
import { SubtitleTool } from '@/components/SubtitleTool';
import { ToolboxHub } from '@/components/ToolboxHub';
import { XSyncReviewDialog } from '@/components/XSyncReviewDialog';
import { Button } from '@/components/ui/button';
import { NoticeProvider } from '@/components/ui/notice';
import { TooltipProvider } from '@/components/ui/tooltip';
import { listCategories, listCollections, listTags, type ItemSort } from '@/lib/db/client';
import type { Category, Collection, Item, Tag } from '@/lib/db/types';
import { startDownload, type DownloadQuality } from '@/lib/downloads';
import { cycleTheme } from '@/lib/theme';

const StatsView = lazy(() =>
  import('@/components/StatsView').then((m) => ({ default: m.StatsView })),
);

// ponytail: no node:path in bundle — basename via string split.
function basename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function readSort(): ItemSort {
  const v = window.localStorage.getItem('jv-sort');
  return v === 'old' || v === 'title' || v === 'title-desc' ? v : 'new';
}

function App() {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState('all');
  const [collectionId, setCollectionId] = useState('all');
  const [categoryId, setCategoryId] = useState('all');
  const [tagId, setTagId] = useState('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [converterOnly, setConverterOnly] = useState(false);
  const [toolboxOnly, setToolboxOnly] = useState(false);
  const [toolboxTool, setToolboxTool] = useState<'merge' | 'silence' | 'gif' | 'subtitle' | null>(null);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [statsOnly, setStatsOnly] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [view, setView] = useState<'grid' | 'rows'>(() =>
    window.localStorage.getItem('jv-view') === 'rows' ? 'rows' : 'grid',
  );
  const [sort, setSort] = useState<ItemSort>(readSort);
  const [pageSize, setPageSize] = useState<number>(() => readPageSize());
  const [refreshKey, setRefreshKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [urlDlOpen, setUrlDlOpen] = useState(false);
  const [formatTarget, setFormatTarget] = useState<FormatTarget | null>(null);
  const [editorSource, setEditorSource] = useState<EditorSource | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [record, setRecord] = useState<Item | null>(null);
  // İlk kurulumda tur yerine sihirbaz; mevcut kullanıcıda tur replay yolu aynen durur.
  const [wizardOpen, setWizardOpen] = useState(() => !isOnboarded());

  const refresh = useCallback((): void => setRefreshKey((k) => k + 1), []);

  // Kayıt panelinden başlatılan indirme: satır içi ilerleme ızgarada belirir,
  // bu yüzden burada yalnızca kuyruğa verilir ve liste tazelenir.
  const startAudio = useCallback(
    (item: Item, quality: DownloadQuality): void => {
      void startDownload(item.id, item.url, 'audio', quality).then(refresh);
    },
    [refresh],
  );

  const switchView = (next: 'grid' | 'rows'): void => {
    setView(next);
    window.localStorage.setItem('jv-view', next);
  };

  const switchSort = (next: ItemSort): void => {
    setSort(next);
    window.localStorage.setItem('jv-sort', next);
  };

  useEffect(() => {
    void listCollections().then(setCollections);
    void listCategories().then(setCategories);
    void listTags().then(setTags);
  }, [refreshKey, organizeOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isVault = !converterOnly && !toolboxOnly && !duplicatesOnly && !statsOnly;

  const showAll = (): void => {
    setPlatform('all');
    setCollectionId('all');
    setCategoryId('all');
    setTagId('all');
    setFavoritesOnly(false);
    setDownloadedOnly(false);
    setConverterOnly(false);
    setToolboxOnly(false);
    setToolboxTool(null);
    setDuplicatesOnly(false);
    setStatsOnly(false);
  };

  const openConverter = (): void => {
    showAll();
    setConverterOnly(true);
  };

  const openToolbox = (): void => {
    showAll();
    setToolboxOnly(true);
  };

  const openMerge = (): void => {
    showAll();
    setToolboxOnly(true);
    setToolboxTool('merge');
  };

  const openSilence = (): void => {
    showAll();
    setToolboxOnly(true);
    setToolboxTool('silence');
  };

  const openGif = (): void => {
    showAll();
    setToolboxOnly(true);
    setToolboxTool('gif');
  };

  const openSubtitle = (): void => {
    showAll();
    setToolboxOnly(true);
    setToolboxTool('subtitle');
  };

  const openDuplicates = (): void => {
    showAll();
    setDuplicatesOnly(true);
  };

  const openStats = (): void => {
    showAll();
    setStatsOnly(true);
  };

  const goFavorites = (): void => {
    setFavoritesOnly(true);
    setPlatform('all');
    setCollectionId('all');
    setCategoryId('all');
    setTagId('all');
    setDownloadedOnly(false);
    setConverterOnly(false);
    setToolboxOnly(false);
    setToolboxTool(null);
    setDuplicatesOnly(false);
    setStatsOnly(false);
  };

  const goDownloads = (): void => {
    setDownloadedOnly(true);
    setPlatform('all');
    setCollectionId('all');
    setCategoryId('all');
    setTagId('all');
    setFavoritesOnly(false);
    setConverterOnly(false);
    setToolboxOnly(false);
    setToolboxTool(null);
    setDuplicatesOnly(false);
    setStatsOnly(false);
  };

  // Yakala çubuğu her ekranda durur. Bir araç yüzeyindeyken yazmaya başlamak
  // kasayı açar; aksi hâlde yazılan şeyin karşılığı görünmez olurdu.
  const handleQuery = (next: string): void => {
    setQuery(next);
    if (next.trim() !== '' && !isVault) showAll();
  };

  const paletteCommands: PaletteCommand[] = [
    { id: 'add', label: 'Yeni öğe ekle', icon: <Plus className="size-4" />, run: () => { setAddUrl(''); setAddOpen(true); } },
    { id: 'bulk', label: 'Toplu aktar', icon: <Upload className="size-4" />, run: () => setBulkOpen(true) },
    { id: 'url', label: "URL'den indir", icon: <Download className="size-4" />, run: () => setUrlDlOpen(true) },
    { id: 'converter', label: 'Dönüştürücü', icon: <Clapperboard className="size-4" />, run: openConverter },
    { id: 'toolbox', label: 'Araç Kutusu', icon: <Wrench className="size-4" />, run: openToolbox },
    { id: 'tool-merge', label: 'Araç: Birleştir', icon: <Combine className="size-4" />, run: openMerge },
    { id: 'tool-silence', label: 'Araç: Sessizlik Kırpma', icon: <Scissors className="size-4" />, run: openSilence },
    { id: 'tool-gif', label: 'Araç: GIF/WebM', icon: <Film className="size-4" />, run: openGif },
    { id: 'tool-subtitle', label: 'Araç: Altyazı', icon: <Captions className="size-4" />, run: openSubtitle },
    { id: 'dupes', label: 'Yinelenenler', icon: <Copy className="size-4" />, run: openDuplicates },
    { id: 'stats', label: 'İstatistikler', icon: <BarChart3 className="size-4" />, run: openStats },
    { id: 'all', label: 'Tümü', icon: <LayoutGrid className="size-4" />, run: showAll },
    { id: 'fav', label: 'Favoriler', icon: <Star className="size-4" />, run: goFavorites },
    { id: 'dl', label: 'İndirilenler', icon: <Download className="size-4" />, run: goDownloads },
    { id: 'organize', label: 'Koleksiyonlar', icon: <SlidersHorizontal className="size-4" />, run: () => setOrganizeOpen(true) },
    { id: 'settings', label: 'Ayarlar', icon: <Settings className="size-4" />, run: () => setSettingsOpen(true) },
    { id: 'tour', label: 'Karşılama turu', icon: <Sparkles className="size-4" />, run: () => setTourOpen(true) },
    { id: 'theme', label: 'Tema değiştir', icon: <Sun className="size-4" />, run: () => cycleTheme() },
    { id: 'grid', label: 'Kart görünümü', icon: <LayoutGrid className="size-4" />, run: () => switchView('grid') },
    { id: 'rows', label: 'Satır görünümü', icon: <Rows3 className="size-4" />, run: () => switchView('rows') },
  ];

  const leaveViews = (): void => {
    setFavoritesOnly(false);
    setDownloadedOnly(false);
    setConverterOnly(false);
    setToolboxOnly(false);
    setToolboxTool(null);
    setDuplicatesOnly(false);
    setStatsOnly(false);
  };
  const pickPlatform = (p: string): void => {
    setPlatform(p);
    leaveViews();
  };
  const pickCollection = (id: string): void => {
    setCollectionId(id);
    leaveViews();
  };
  const pickCategory = (id: string): void => {
    setCategoryId(id);
    leaveViews();
  };
  const pickTag = (id: string): void => {
    setTagId(id);
    leaveViews();
  };

  const sidebarProps = {
    view: (converterOnly
      ? 'converter'
      : toolboxOnly
        ? 'toolbox'
        : duplicatesOnly
          ? 'duplicates'
          : statsOnly
            ? 'stats'
            : favoritesOnly
              ? 'favorites'
              : downloadedOnly
                ? 'downloads'
                : 'all') as 'all' | 'favorites' | 'downloads' | 'converter' | 'toolbox' | 'duplicates' | 'stats',
    homeActive:
      platform === 'all' &&
      collectionId === 'all' &&
      categoryId === 'all' &&
      tagId === 'all' &&
      !favoritesOnly &&
      !downloadedOnly &&
      !converterOnly &&
      !toolboxOnly &&
      !duplicatesOnly &&
      !statsOnly,
    onHome: showAll,
    onView: (v: Exclude<'all' | 'favorites' | 'downloads' | 'converter' | 'toolbox' | 'duplicates' | 'stats', 'all'>) => {
      if (v === 'favorites') goFavorites();
      else if (v === 'downloads') goDownloads();
      else if (v === 'converter') openConverter();
      else if (v === 'toolbox') openToolbox();
      else if (v === 'duplicates') openDuplicates();
      else openStats();
    },
    onOrganize: () => setOrganizeOpen(true),
    onSettings: () => setSettingsOpen(true),
  };

  return (
    <NoticeProvider>
      <TooltipProvider delay={300}>
        <div className="flex min-h-screen bg-background text-foreground">
          <Sidebar {...sidebarProps} />

          <div className="flex min-w-0 flex-1 flex-col">
            <SidebarStrip {...sidebarProps} />
            <CaptureBar
              onQuery={handleQuery}
              onSaved={refresh}
              onDetailed={(url) => {
                setAddUrl(url);
                setAddOpen(true);
              }}
            />

            <main className="flex min-h-0 flex-1">
              {isVault ? (
                <>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <ItemGrid
                      query={query}
                      platform={platform}
                      collectionId={collectionId}
                      categoryId={categoryId}
                      tagId={tagId}
                      favoritesOnly={favoritesOnly}
                      downloadedOnly={downloadedOnly}
                      refreshKey={refreshKey}
                      view={view}
                      sort={sort}
                      pageSize={pageSize}
                      collections={collections}
                      categories={categories}
                      tags={tags}
                      onPageSizeChange={(n) => {
                        window.localStorage.setItem('jv-page-size', String(n));
                        setPageSize(n);
                      }}
                      onViewChange={switchView}
                      onSortChange={switchSort}
                      onPlatform={pickPlatform}
                      onCollection={pickCollection}
                      onCategory={pickCategory}
                      onTag={pickTag}
                      onOpen={setRecord}
                      onClearFilters={showAll}
                      onPickVideo={(item) => setFormatTarget({ id: item.id, url: item.url, title: item.title })}
                      onConvert={(item) => {
                        if (item.local_path)
                          setEditorSource({
                            label: item.title || basename(item.local_path),
                            inputPath: item.local_path,
                            itemId: item.id,
                          });
                      }}
                    />
                  </div>
                  {record && (
                    <aside className="fixed inset-0 z-40 flex flex-col border-border bg-background lg:sticky lg:top-14 lg:z-auto lg:h-[calc(100vh-3.5rem)] lg:w-[360px] lg:shrink-0 lg:border-l">
                      <ItemRecord
                        item={record}
                        onClose={() => setRecord(null)}
                        onChanged={refresh}
                        onPickVideo={(item) => setFormatTarget({ id: item.id, url: item.url, title: item.title })}
                        onConvert={(item) => {
                          if (item.local_path)
                            setEditorSource({
                              label: item.title || basename(item.local_path),
                              inputPath: item.local_path,
                              itemId: item.id,
                            });
                        }}
                        onAudio={startAudio}
                      />
                    </aside>
                  )}
                </>
              ) : (
                <div className="min-w-0 flex-1 px-4 py-5">
                  {statsOnly ? (
                    <Suspense fallback={<p className="py-10 text-center text-sm text-muted-foreground">Yükleniyor…</p>}>
                      <StatsView refreshKey={refreshKey} />
                    </Suspense>
                  ) : duplicatesOnly ? (
                    <DuplicatesView onDone={refresh} />
                  ) : converterOnly ? (
                    <ConverterStudio refreshKey={refreshKey} onDone={refresh} />
                  ) : toolboxTool === 'merge' ? (
                    <div className="flex flex-col gap-3">
                      <div>
                        <Button variant="ghost" size="sm" onClick={() => setToolboxTool(null)}>
                          <ArrowLeft /> Araç Kutusu&apos;na dön
                        </Button>
                      </div>
                      <MergeTool refreshKey={refreshKey} onDone={refresh} />
                    </div>
                  ) : toolboxTool === 'silence' ? (
                    <div className="flex flex-col gap-3">
                      <div>
                        <Button variant="ghost" size="sm" onClick={() => setToolboxTool(null)}>
                          <ArrowLeft /> Araç Kutusu&apos;na dön
                        </Button>
                      </div>
                      <SilenceTool refreshKey={refreshKey} onDone={refresh} />
                    </div>
                  ) : toolboxTool === 'gif' ? (
                    <div className="flex flex-col gap-3">
                      <div>
                        <Button variant="ghost" size="sm" onClick={() => setToolboxTool(null)}>
                          <ArrowLeft /> Araç Kutusu&apos;na dön
                        </Button>
                      </div>
                      <GifTool refreshKey={refreshKey} onDone={refresh} />
                    </div>
                  ) : toolboxTool === 'subtitle' ? (
                    <div className="flex flex-col gap-3">
                      <div>
                        <Button variant="ghost" size="sm" onClick={() => setToolboxTool(null)}>
                          <ArrowLeft /> Araç Kutusu&apos;na dön
                        </Button>
                      </div>
                      <SubtitleTool refreshKey={refreshKey} onDone={refresh} />
                    </div>
                  ) : (
                    <ToolboxHub
                      onPick={(toolId) => {
                        if (toolId === 'merge') setToolboxTool('merge');
                        else if (toolId === 'silence') setToolboxTool('silence');
                        else if (toolId === 'gif') setToolboxTool('gif');
                        else if (toolId === 'subtitle') setToolboxTool('subtitle');
                        else openConverter();
                      }}
                    />
                  )}
                </div>
              )}
            </main>
          </div>

          <AddItemDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            onSaved={refresh}
            initialUrl={addUrl}
          />
          <DownloadDialog
            open={urlDlOpen}
            onOpenChange={setUrlDlOpen}
            onDone={refresh}
            onPickVideo={(t) => {
              setUrlDlOpen(false);
              setFormatTarget(t);
            }}
          />
          <FormatDialog target={formatTarget} onClose={() => setFormatTarget(null)} onDone={refresh} />
          <EditorDialog source={editorSource} onClose={() => setEditorSource(null)} onDone={refresh} />
          <BulkImportDialog open={bulkOpen} onOpenChange={setBulkOpen} onDone={refresh} />
          <OrganizeDialog open={organizeOpen} onOpenChange={setOrganizeOpen} onChanged={refresh} />
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            pageSize={pageSize}
            pageSizes={PAGE_SIZES}
            onPageSizeChange={(n) => {
              window.localStorage.setItem('jv-page-size', String(n));
              setPageSize(n);
            }}
            onReplayTour={() => setTourOpen(true)}
          />
          <XSyncReviewDialog onDone={refresh} />
          <WelcomeDialog open={tourOpen} onOpenChange={setTourOpen} />
          <OnboardingWizard
            open={wizardOpen}
            onOpenChange={setWizardOpen}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <ClipboardWatcher onDone={refresh} />
          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={paletteCommands} />
        </div>
      </TooltipProvider>
    </NoticeProvider>
  );
}

export default App;
