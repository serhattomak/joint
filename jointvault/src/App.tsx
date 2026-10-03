import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BarChart3, Captions, Clapperboard, Combine, Copy, Download, Film, LayoutGrid, Plus, RefreshCw, Rows3, Scissors, Settings, SlidersHorizontal, Sparkles, Star, Sun, Upload, Wrench, Zap } from 'lucide-react';
import { AddItemDialog } from '@/components/AddItemDialog';
import { BulkImportDialog } from '@/components/BulkImportDialog';
import { Toolbar } from '@/components/Toolbar';
import { ClipboardWatcher } from '@/components/ClipboardWatcher';
import { CommandPalette, type PaletteCommand } from '@/components/CommandPalette';
import { ComponentInstallerProvider } from '@/components/ComponentInstaller';
import { ConverterStudio } from '@/components/ConverterStudio';
import { DownloadDialog } from '@/components/DownloadDialog';
import { DownloadsView } from '@/components/DownloadsView';
import { DuplicatesView } from '@/components/DuplicatesView';
import { WelcomeDialog, isOnboarded } from '@/components/WelcomeDialog';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { EditorDialog, type EditorSource } from '@/components/EditorDialog';
import { FormatDialog, type FormatTarget } from '@/components/FormatDialog';
import { ItemGrid, PAGE_SIZES, readPageSize } from '@/components/ItemGrid';
import { ItemRecord } from '@/components/ItemRecord';
import { MediaPlayerModal } from '@/components/MediaPlayerModal';
import { MergeTool } from '@/components/MergeTool';
import { GifTool } from '@/components/GifTool';
import { CollectionsView } from '@/components/CollectionsView';
import { QuickDownloadDialog } from '@/components/QuickDownloadDialog';
import { AiAssistantView } from '@/components/AiAssistantView';
import { SyncView } from '@/components/SyncView';
import { SettingsView, type SettingsTab } from '@/components/SettingsView';
import { Sidebar, SidebarStrip, type SidebarView } from '@/components/Sidebar';
import { SilenceTool } from '@/components/SilenceTool';
import { SubtitleTool } from '@/components/SubtitleTool';
import { ToolboxHub } from '@/components/ToolboxHub';
import { XSyncReviewDialog } from '@/components/XSyncReviewDialog';
import { CrashScreen } from '@/components/CrashScreen';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { NoticeProvider } from '@/components/ui/notice';
import { ResizeHandles } from '@/components/ui/window-controls';
import { TooltipProvider } from '@/components/ui/tooltip';
import { listCategories, listCollections, listItems, listTags, resetDb, runDailyBackup, type ItemSort } from '@/lib/db/client';
import { getAiStatus, isAiEnabled } from '@/lib/ai';
import { initItemIndexRefresh } from '@/lib/ai-index';
import { classifyDbError, type DbInitError } from '@/lib/db/db-errors';
import { pushDest, stepDest, type NavHistory } from '@/lib/nav-history';
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
  const [semantic, setSemantic] = useState(false);
  const [platform, setPlatform] = useState('all');
  const [collectionId, setCollectionId] = useState('all');
  const [categoryId, setCategoryId] = useState('all');
  const [tagId, setTagId] = useState('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [quickDlOpen, setQuickDlOpen] = useState(false);
  const [quickDlUrl, setQuickDlUrl] = useState('');
  const [converterOnly, setConverterOnly] = useState(false);
  const [toolboxOnly, setToolboxOnly] = useState(false);
  const [toolboxTool, setToolboxTool] = useState<'merge' | 'silence' | 'gif' | 'subtitle' | 'duplicates' | null>(null);
  const [statsOnly, setStatsOnly] = useState(false);
  const [aiOnly, setAiOnly] = useState(false);
  // AI açık/kapalı TEK karar noktasından okunur; `null` = henüz bilinmiyor.
  // Bilinmeyen durumda yüzeyler yanıltıcı "kapalı" göstermez (fail-closed
  // kararı yalnızca `isAiEnabled` verir, UI onu aynen yansıtır).
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [syncOnly, setSyncOnly] = useState(false);
  const [settingsOnly, setSettingsOnly] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('ai');
  const [collectionsOnly, setCollectionsOnly] = useState(false);
  // Ray açık/kapalı — kullanıcı tercihi kalıcı (dar pencerede zaten gizli).
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.localStorage.getItem('jv-sidebar') !== 'closed',
  );
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
  const [urlDlOpen, setUrlDlOpen] = useState(false);
  const [formatTarget, setFormatTarget] = useState<FormatTarget | null>(null);
  const [editorSource, setEditorSource] = useState<EditorSource | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [record, setRecord] = useState<Item | null>(null);
  const [recordInitialTab, setRecordInitialTab] = useState<'detail' | 'reader'>('detail');
  const [playingItem, setPlayingItem] = useState<Item | null>(null);
  const [playingInitialTime, setPlayingInitialTime] = useState<number>(0);
  // İlk kurulumda tur yerine sihirbaz; mevcut kullanıcıda tur replay yolu aynen durur.
  const [wizardOpen, setWizardOpen] = useState(() => !isOnboarded());

  const refresh = useCallback((): void => setRefreshKey((k) => k + 1), []);

  /* Kasa açılamazsa boş kabuk göstermek yerine ne olduğunu söyleriz. */
  const [bootError, setBootError] = useState<DbInitError | null>(null);

  const retryBoot = useCallback((): void => {
    /* Başarısız başlatma önbellekte tutulmaz; ama yine de unuttur ki
       ilk denemede takılı kalan bir yol varsa temiz başlasın. */
    resetDb();
    setBootError(null);
    refresh();
  }, [refresh]);

  const handlePlayMedia = useCallback((item: Item, initialTime?: number) => {
    setPlayingInitialTime(initialTime ?? 0);
    setPlayingItem(item);
  }, []);

  const openRecord = useCallback((item: Item, tab: 'detail' | 'reader' = 'detail') => {
    setRecord(item);
    setRecordInitialTab(tab);
  }, []);

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
    let live = true;
    /* Hatayı yutmak yok: kasa açılamadıysa kullanıcı bunu görmeli. */
    void Promise.all([listCollections(), listCategories(), listTags()])
      .then(([nextCollections, nextCategories, nextTags]) => {
        if (!live) return;
        setCollections(nextCollections);
        setCategories(nextCategories);
        setTags(nextTags);
        setBootError(null);
        /* Açılış yedeği (günde bir). Başarısız olsa bile uygulama çalışmaya
           devam eder — yedek alamamak, kasayı açamamaktan iyidir. */
        void runDailyBackup().catch((error: unknown) => {
          console.warn('[backup:günlük]', error);
        });
      })
      .catch((error: unknown) => {
        if (live) setBootError(classifyDbError(error));
      });
    return () => {
      live = false;
    };
  }, [refreshKey, collectionsOnly]);

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

  // İçerik/taksonomi değişince ilgili öğenin indeksini arka planda tazele.
  useEffect(() => initItemIndexRefresh(), []);

  // AI etkinliğini tazele: açılışta ve Ayarlar'dan çıkışta (kullanıcı orada
  // açıp kapatmış olabilir). Ayarlar AÇIKKEN arka planda sorgu yapmayız —
  // Ayarlar kendi durumunu okur; çıkışta burada tazelenir. Yalnızca durum
  // OKUNUR, hiçbir süreç başlatılmaz.
  useEffect(() => {
    if (settingsOnly) return;
    let live = true;
    void getAiStatus()
      .then((s) => {
        if (live) setAiEnabled(isAiEnabled(s));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [settingsOnly]);

  const isVault = !converterOnly && !toolboxOnly && !statsOnly && !aiOnly && !settingsOnly && !collectionsOnly && !downloadedOnly && !syncOnly;

  const showAll = (): void => {
    setPlatform('all');
    setCollectionId('all');
    setCategoryId('all');
    setTagId('all');
    setFavoritesOnly(false);
    setLocalOnly(false);
    setDownloadedOnly(false);
    setConverterOnly(false);
    setToolboxOnly(false);
    setToolboxTool(null);
    setStatsOnly(false);
    setAiOnly(false);
    setSyncOnly(false);
    setSettingsOnly(false);
    setCollectionsOnly(false);
  };

  const openAi = (): void => {
    showAll();
    setAiOnly(true);
  };

  const openSync = (): void => {
    showAll();
    setSyncOnly(true);
  };

  const openSettings = (initialTab: SettingsTab = 'ai'): void => {
    showAll();
    setSettingsOnly(true);
    setSettingsTab(initialTab);
  };

  const openCollections = (): void => {
    showAll();
    setCollectionsOnly(true);
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
    setToolboxOnly(true);
    setToolboxTool('duplicates');
  };

  const openStats = (): void => {
    showAll();
    setStatsOnly(true);
  };

  const goFavorites = (): void => {
    leaveViews();
    setFavoritesOnly(true);
    setLocalOnly(false);
    setPlatform('all');
    setCollectionId('all');
    setCategoryId('all');
    setTagId('all');
  };

  const goLocal = (): void => {
    leaveViews();
    setFavoritesOnly(false);
    setLocalOnly(true);
    setPlatform('all');
    setCollectionId('all');
    setCategoryId('all');
    setTagId('all');
  };

  /** Kapsam sekmesi (Tümü · Favoriler · Yerel). */
  const openScope = (scope: 'all' | 'favorites' | 'local'): void => {
    if (scope === 'favorites') goFavorites();
    else if (scope === 'local') goLocal();
    else showAll();
  };

  const goDownloads = (): void => {
    showAll();
    setDownloadedOnly(true);
  };

  // Yakala çubuğu her ekranda durur. Bir araç yüzeyindeyken yazmaya başlamak
  // kasayı açar; aksi hâlde yazılan şeyin karşılığı görünmez olurdu.
  const handleQuery = (next: string): void => {
    setQuery(next);
    if (next.trim() !== '' && !isVault) showAll();
  };

  const paletteCommands: PaletteCommand[] = [
    { id: 'turbo-dl', label: 'Hızlı İndir (Turbo IDM)', icon: <Zap className="size-4" />, run: () => { setQuickDlUrl(''); setQuickDlOpen(true); } },
    { id: 'add', label: 'Yeni öğe ekle', icon: <Plus className="size-4" />, run: () => { setAddUrl(''); setAddOpen(true); } },
    { id: 'bulk', label: 'Toplu aktar', icon: <Upload className="size-4" />, run: () => setBulkOpen(true) },
    { id: 'url', label: "URL'den indir", icon: <Download className="size-4" />, run: () => setUrlDlOpen(true) },
    { id: 'ai', label: 'Kasa Asistanı (AI)', icon: <Sparkles className="size-4" />, run: openAi },
    { id: 'converter', label: 'Dönüştürücü', icon: <Clapperboard className="size-4" />, run: openConverter },
    { id: 'toolbox', label: 'Araç Kutusu', icon: <Wrench className="size-4" />, run: openToolbox },
    { id: 'tool-merge', label: 'Araç: Birleştir', icon: <Combine className="size-4" />, run: openMerge },
    { id: 'tool-silence', label: 'Araç: Sessizlik Kırpma', icon: <Scissors className="size-4" />, run: openSilence },
    { id: 'tool-gif', label: 'Araç: GIF/WebM', icon: <Film className="size-4" />, run: openGif },
    { id: 'tool-subtitle', label: 'Araç: Altyazı', icon: <Captions className="size-4" />, run: openSubtitle },
    { id: 'dupes', label: 'Yinelenenler', icon: <Copy className="size-4" />, run: openDuplicates },
    { id: 'stats', label: 'İstatistikler', icon: <BarChart3 className="size-4" />, run: openStats },
    { id: 'all', label: 'Tümü', icon: <LayoutGrid className="size-4" />, run: showAll },
    { id: 'fav', label: 'Favoriler', icon: <Star className="size-4" />, run: () => openScope('favorites') },
    { id: 'local', label: 'Yerel (indirilmiş)', icon: <Download className="size-4" />, run: () => openScope('local') },
    { id: 'sync', label: 'Eşitleme Merkezi', icon: <RefreshCw className="size-4" />, run: openSync },
    { id: 'dl', label: 'İndirme Yöneticisi', icon: <Download className="size-4" />, run: goDownloads },
    { id: 'organize', label: 'Koleksiyonlar', icon: <SlidersHorizontal className="size-4" />, run: openCollections },
    { id: 'settings', label: 'Ayarlar', icon: <Settings className="size-4" />, run: () => openSettings() },
    { id: 'tour', label: 'Karşılama turu', icon: <Sparkles className="size-4" />, run: () => setTourOpen(true) },
    { id: 'theme', label: 'Tema değiştir', icon: <Sun className="size-4" />, run: () => cycleTheme() },
    { id: 'grid', label: 'Kart görünümü', icon: <LayoutGrid className="size-4" />, run: () => switchView('grid') },
    { id: 'rows', label: 'Satır görünümü', icon: <Rows3 className="size-4" />, run: () => switchView('rows') },
  ];

  const leaveViews = (): void => {
    /* Favoriler/Yerel artık birer görünüm değil, ızgaranın kapsam sekmesidir:
       filtre uygulamak seçili sekmeyi bozmaz. Yalnızca araç yüzeyleri kapanır. */
    setDownloadedOnly(false);
    setConverterOnly(false);
    setToolboxOnly(false);
    setToolboxTool(null);
    setStatsOnly(false);
    setAiOnly(false);
    setSyncOnly(false);
    setSettingsOnly(false);
    setCollectionsOnly(false);
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

  // Görünüm = gezinmenin kimliği; geçmiş bu kimlik üzerinden yürür.
  const currentView: SidebarView = settingsOnly
    ? 'settings'
    : collectionsOnly
      ? 'collections'
      : aiOnly
        ? 'ai'
        : syncOnly
          ? 'sync'
          : converterOnly
            ? 'converter'
            : toolboxOnly
              ? 'toolbox'
              : statsOnly
                ? 'stats'
                : downloadedOnly
                  ? 'downloads'
                  : 'all';

  const [hist, setHist] = useState<NavHistory<SidebarView>>(() => ({ stack: ['all'], index: 0 }));

  /* Her görünüm değişimi geçmişe yazılır (yeni gezinme ileri yığınını kırpar).
     Geri/ileri yığındaki değeri zaten geri getirdiği için effect erken döner —
     ayrı bir bastırma bayrağı gerekmez. */
  useEffect(() => {
    setHist((h) => pushDest(h, currentView));
  }, [currentView]);

  const applyDest = (d: SidebarView): void => {
    if (d === 'downloads') goDownloads();
    else if (d === 'sync') openSync();
    else if (d === 'collections') openCollections();
    else if (d === 'converter') openConverter();
    else if (d === 'toolbox') openToolbox();
    else if (d === 'stats') openStats();
    else if (d === 'ai') openAi();
    else if (d === 'settings') openSettings();
    else showAll();
  };

  const canGoBack = hist.index > 0;
  const canGoForward = hist.index < hist.stack.length - 1;
  const goStep = (delta: 1 | -1): void => {
    const next = stepDest(hist, delta);
    if (next === hist) return;
    setHist(next);
    applyDest(next.stack[next.index]);
  };
  const goBack = (): void => goStep(-1);
  const goForward = (): void => goStep(1);

  const toggleSidebar = (): void => {
    setSidebarOpen((open) => {
      window.localStorage.setItem('jv-sidebar', open ? 'closed' : 'open');
      return !open;
    });
  };

  const sidebarProps = {
    view: currentView,
    /* Kapsam sekmeleri (Favoriler/Yerel) kasada kaldığı için "Tümü" öğesi kasa
       açık olduğu sürece aktiftir; ayrım başlık altındaki sekmelerdedir. */
    homeActive: isVault,
    onHome: showAll,
    onView: (v: Exclude<SidebarView, 'all'>) => {
      if (v === 'ai') openAi();
      else if (v === 'sync') openSync();
      else if (v === 'settings') openSettings();
      else if (v === 'collections') openCollections();
      else if (v === 'downloads') goDownloads();
      else if (v === 'converter') openConverter();
      else if (v === 'toolbox') openToolbox();
      else openStats();
    },
    onSettings: () => openSettings(),
  };

  return (
    <NoticeProvider>
      {/* Kurulum akışı NoticeProvider'ın İÇİNDE olmak zorunda: ComponentInstallerProvider
          useNotice() çağırır ve bildirim bağlamı olmadan throw eder. ErrorBoundary'nin
          DIŞINDA ama CrashScreen dalını da sarmalayacak konumda bağlanır: kasa
          açılamadığında da kurulum ve bildirim aynı yolda çalışsın. Tam olarak BİR kez. */}
      <ComponentInstallerProvider>
      <ErrorBoundary>
      {/* Kasa açılamadıysa kabuğu çizmek yerine nedeni söylenir. */}
      {bootError ? (
        <CrashScreen
          title="Kasa açılamadı"
          message={bootError.message}
          detail={bootError.detail}
          onRetry={retryBoot}
        />
      ) : (
      <TooltipProvider delay={300}>
        <div className="flex min-h-screen flex-col bg-background text-foreground">
          {/* Pencere kenarından boyutlandırma: `decorations: false` sonrası yerel
              kenar kalktığı için tutamaçlar burada bir kez bağlanır. */}
          <ResizeHandles />

          {/* Birleşik pencere araç çubuğu — tam genişlik, rayın da üstünde. */}
          <Toolbar
            onQuery={handleQuery}
            onSaved={refresh}
            onDetailed={(url) => {
              setAddUrl(url);
              setAddOpen(true);
            }}
            semantic={semantic}
            onSemanticToggle={() => setSemantic((s) => !s)}
            onOpenSync={openSync}
            aiEnabled={aiEnabled ?? undefined}
            onOpenAiSettings={() => openSettings('ai')}
            view={isVault ? view : undefined}
            onViewChange={isVault ? switchView : undefined}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onBack={goBack}
            onForward={goForward}
          />

          <div className="flex flex-1">
            {sidebarOpen && <Sidebar {...sidebarProps} />}

            <div className="flex min-w-0 flex-1 flex-col">
              <SidebarStrip {...sidebarProps} />

              <main className="flex min-h-0 flex-1">
              {isVault ? (
                <div className="flex min-w-0 flex-1 flex-col">
                  <ItemGrid
                    query={query}
                    semantic={semantic}
                    platform={platform}
                    collectionId={collectionId}
                    categoryId={categoryId}
                    tagId={tagId}
                    favoritesOnly={favoritesOnly}
                    localOnly={localOnly}
                    onScope={openScope}
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
                    onSortChange={switchSort}
                    onPlatform={pickPlatform}
                    onCollection={pickCollection}
                    onCategory={pickCategory}
                    onTag={pickTag}
                    onOpen={openRecord}
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
                    onPlayMedia={handlePlayMedia}
                    aiEnabled={aiEnabled ?? undefined}
                    onOpenAiSettings={() => openSettings('ai')}
                  />
                </div>
              ) : downloadedOnly ? (
                <div className="min-w-0 flex-1">
                  <DownloadsView
                    onClose={showAll}
                    onOpenItem={(item) => openRecord(item, 'detail')}
                    onConvert={(item) => {
                      if (item.local_path)
                        setEditorSource({
                          label: item.title || basename(item.local_path),
                          inputPath: item.local_path,
                          itemId: item.id,
                        });
                    }}
                    onPlayMedia={handlePlayMedia}
                  />
                </div>
              ) : syncOnly ? (
                <SyncView onSyncDone={refresh} />
              ) : aiOnly ? (
                <div className="min-w-0 flex-1">
                  <AiAssistantView
                    onOpenSettings={() => openSettings('ai')}
                    onOpenItem={(itemId) => {
                      void listItems().then((all) => {
                        const found = all.find((i) => i.id === itemId);
                        if (found) {
                          showAll();
                          openRecord(found, 'detail');
                        }
                      });
                    }}
                  />
                </div>
              ) : settingsOnly ? (
                <div className="min-w-0 flex-1">
                  <SettingsView
                    pageSize={pageSize}
                    pageSizes={PAGE_SIZES}
                    onPageSizeChange={(n) => {
                      window.localStorage.setItem('jv-page-size', String(n));
                      setPageSize(n);
                    }}
                    onReplayTour={() => setTourOpen(true)}
                    onClose={showAll}
                    initialTab={settingsTab}
                  />
                </div>
              ) : collectionsOnly ? (
                <div className="min-w-0 flex-1">
                  <CollectionsView
                    onClose={showAll}
                    onSelectCollection={(colId) => {
                      showAll();
                      setCollectionId(colId);
                    }}
                    onSelectCategory={(catId) => {
                      showAll();
                      setCategoryId(catId);
                    }}
                    onSelectTag={(tId) => {
                      showAll();
                      setTagId(tId);
                    }}
                  />
                </div>
              ) : statsOnly ? (
                <Suspense fallback={<p className="py-10 text-center text-sm text-muted-foreground">Yükleniyor…</p>}>
                  <StatsView refreshKey={refreshKey} />
                </Suspense>
              ) : converterOnly ? (
                <ConverterStudio refreshKey={refreshKey} onDone={refresh} />
              ) : toolboxTool === 'duplicates' ? (
                <DuplicatesView onDone={refresh} onClose={() => setToolboxTool(null)} />
              ) : toolboxTool === 'merge' ? (
                <MergeTool refreshKey={refreshKey} onDone={refresh} onClose={() => setToolboxTool(null)} />
              ) : toolboxTool === 'silence' ? (
                <SilenceTool refreshKey={refreshKey} onDone={refresh} onClose={() => setToolboxTool(null)} />
              ) : toolboxTool === 'gif' ? (
                <GifTool refreshKey={refreshKey} onDone={refresh} onClose={() => setToolboxTool(null)} />
              ) : toolboxTool ? (
                <SubtitleTool refreshKey={refreshKey} onDone={refresh} onClose={() => setToolboxTool(null)} />
              ) : (
                <ToolboxHub
                  onPick={(toolId) => {
                    if (toolId === 'merge') setToolboxTool('merge');
                    else if (toolId === 'silence') setToolboxTool('silence');
                    else if (toolId === 'gif') setToolboxTool('gif');
                    else if (toolId === 'subtitle') setToolboxTool('subtitle');
                    else if (toolId === 'duplicates') setToolboxTool('duplicates');
                    else openConverter();
                  }}
                />
              )}
              </main>
            </div>
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
          {record && (
            <ItemRecord
              item={record}
              initialTab={recordInitialTab}
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
              onPlayMedia={handlePlayMedia}
            />
          )}
          <MediaPlayerModal
            item={playingItem}
            initialTime={playingInitialTime}
            onClose={() => {
              setPlayingItem(null);
              setPlayingInitialTime(0);
            }}
            onConvert={(item) => {
              if (item.local_path)
                setEditorSource({
                  label: item.title || basename(item.local_path),
                  inputPath: item.local_path,
                  itemId: item.id,
                });
            }}
            onOpenItem={(item) => openRecord(item, 'detail')}
          />
          <BulkImportDialog open={bulkOpen} onOpenChange={setBulkOpen} onDone={refresh} />
          <XSyncReviewDialog onDone={refresh} />
          <WelcomeDialog open={tourOpen} onOpenChange={setTourOpen} />
          <OnboardingWizard
            open={wizardOpen}
            onOpenChange={setWizardOpen}
            onOpenSettings={() => openSettings('ai')}
          />
          <QuickDownloadDialog
            open={quickDlOpen}
            onOpenChange={setQuickDlOpen}
            initialUrl={quickDlUrl}
            onStarted={() => {
              goDownloads();
              refresh();
            }}
          />
          <ClipboardWatcher
            onDone={refresh}
            onDownload={(url) => {
              setQuickDlUrl(url);
              setQuickDlOpen(true);
            }}
          />
          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={paletteCommands} />
        </div>
      </TooltipProvider>
      )}
      </ErrorBoundary>
      </ComponentInstallerProvider>
    </NoticeProvider>
  );
}

export default App;
