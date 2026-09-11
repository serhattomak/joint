import { Suspense, lazy, useEffect, useState } from 'react';
import { BarChart3, Clapperboard, Copy, Download, LayoutGrid, Plus, Rows3, Search, Settings, Sparkles, Star, Sun, Upload, X } from 'lucide-react';
import { AddItemDialog } from '@/components/AddItemDialog';
import { BulkImportDialog } from '@/components/BulkImportDialog';
import { ClipboardWatcher } from '@/components/ClipboardWatcher';
import { CommandPalette, type PaletteCommand } from '@/components/CommandPalette';
import { ConverterStudio } from '@/components/ConverterStudio';
import { DownloadDialog } from '@/components/DownloadDialog';
import { DuplicatesView } from '@/components/DuplicatesView';
import { WelcomeDialog, isOnboarded } from '@/components/WelcomeDialog';
import { EditorDialog, type EditorSource } from '@/components/EditorDialog';
import { FilterMenu } from '@/components/FilterMenu';
import { FormatDialog, type FormatTarget } from '@/components/FormatDialog';
import { ItemGrid, PAGE_SIZES, readPageSize } from '@/components/ItemGrid';
import { OrganizeDialog } from '@/components/OrganizeDialog';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Sidebar } from '@/components/Sidebar';
import { XSyncReviewDialog } from '@/components/XSyncReviewDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TooltipProvider } from '@/components/ui/tooltip';
import { listCategories, listCollections, listTags } from '@/lib/db/client';
import type { Category, Collection, Tag } from '@/lib/db/types';
import { PLATFORM_META } from '@/lib/platform';
import { cycleTheme } from '@/lib/theme';

const StatsView = lazy(() =>
  import('@/components/StatsView').then((m) => ({ default: m.StatsView })),
);

// ponytail: no node:path in bundle — basename via string split.
function basename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
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
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [statsOnly, setStatsOnly] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [view, setView] = useState<'grid' | 'rows'>(() =>
    window.localStorage.getItem('jv-view') === 'rows' ? 'rows' : 'grid',
  );
  const [pageSize, setPageSize] = useState<number>(() => readPageSize());
  const [refreshKey, setRefreshKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [urlDlOpen, setUrlDlOpen] = useState(false);
  const [formatTarget, setFormatTarget] = useState<FormatTarget | null>(null);
  const [editorSource, setEditorSource] = useState<EditorSource | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(() => !isOnboarded());

  const refresh = (): void => setRefreshKey((k) => k + 1);

  const switchView = (next: 'grid' | 'rows'): void => {
    setView(next);
    window.localStorage.setItem('jv-view', next);
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

  const showAll = (): void => {
    setPlatform('all');
    setCollectionId('all');
    setCategoryId('all');
    setTagId('all');
    setFavoritesOnly(false);
    setDownloadedOnly(false);
    setConverterOnly(false);
    setDuplicatesOnly(false);
    setStatsOnly(false);
  };

  const openConverter = (): void => {
    showAll();
    setConverterOnly(true);
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
    setDuplicatesOnly(false);
    setStatsOnly(false);
  };

  const paletteCommands: PaletteCommand[] = [
    { id: 'add', label: 'Yeni öğe ekle', icon: <Plus className="size-4" />, run: () => setAddOpen(true) },
    { id: 'bulk', label: 'Toplu aktar', icon: <Upload className="size-4" />, run: () => setBulkOpen(true) },
    { id: 'url', label: "URL'den indir", icon: <Download className="size-4" />, run: () => setUrlDlOpen(true) },
    { id: 'converter', label: 'Dönüştürücü', icon: <Clapperboard className="size-4" />, run: openConverter },
    { id: 'dupes', label: 'Yinelenenler', icon: <Copy className="size-4" />, run: openDuplicates },
    { id: 'stats', label: 'İstatistikler', icon: <BarChart3 className="size-4" />, run: openStats },
    { id: 'all', label: 'Tümü', icon: <LayoutGrid className="size-4" />, run: showAll },
    { id: 'fav', label: 'Favoriler', icon: <Star className="size-4" />, run: goFavorites },
    { id: 'dl', label: 'İndirilenler', icon: <Download className="size-4" />, run: goDownloads },
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

  const activeCount = [platform, collectionId, categoryId, tagId].filter((v) => v !== 'all').length;

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (platform !== 'all')
    chips.push({
      key: 'platform',
      label: (PLATFORM_META as Record<string, { label: string }>)[platform]?.label ?? platform,
      clear: () => setPlatform('all'),
    });
  if (collectionId !== 'all')
    chips.push({
      key: 'collection',
      label: collections.find((c) => c.id === collectionId)?.name ?? 'Koleksiyon',
      clear: () => setCollectionId('all'),
    });
  if (categoryId !== 'all')
    chips.push({
      key: 'category',
      label: categories.find((c) => c.id === categoryId)?.name ?? 'Kategori',
      clear: () => setCategoryId('all'),
    });
  if (tagId !== 'all')
    chips.push({
      key: 'tag',
      label: `#${tags.find((t) => t.id === tagId)?.name ?? ''}`,
      clear: () => setTagId('all'),
    });

  return (
    <TooltipProvider delay={300}>
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar
        view={
          converterOnly
            ? 'converter'
            : duplicatesOnly
              ? 'duplicates'
              : statsOnly
                ? 'stats'
                : favoritesOnly
                  ? 'favorites'
                  : downloadedOnly
                    ? 'downloads'
                    : 'all'
        }
        homeActive={
          platform === 'all' &&
          collectionId === 'all' &&
          categoryId === 'all' &&
          tagId === 'all' &&
          !favoritesOnly &&
          !downloadedOnly &&
          !converterOnly &&
          !duplicatesOnly &&
          !statsOnly
        }
        onHome={showAll}
        onView={(v) => {
          if (v === 'favorites') goFavorites();
          else if (v === 'downloads') goDownloads();
          else if (v === 'converter') openConverter();
          else if (v === 'duplicates') openDuplicates();
          else openStats();
        }}
        onOrganize={() => setOrganizeOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="relative min-w-40 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ara: başlık, not, URL…  (Ctrl+K palet)"
              className="pl-8"
            />
          </div>
          <FilterMenu
            platform={platform}
            collectionId={collectionId}
            categoryId={categoryId}
            tagId={tagId}
            collections={collections}
            categories={categories}
            tags={tags}
            onPlatform={pickPlatform}
            onCollection={pickCollection}
            onCategory={pickCategory}
            onTag={pickTag}
            onClear={showAll}
            activeCount={activeCount}
          />
          <Button onClick={() => setAddOpen(true)}>
            <Plus /> Yeni öğe
          </Button>
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <Upload /> Toplu aktar
          </Button>
          <Button variant="outline" onClick={() => setUrlDlOpen(true)}>
            <Download /> URL&apos;den indir
          </Button>
        </header>
        <main className="px-4 py-4">
          {statsOnly ? (
            <Suspense fallback={<p className="py-10 text-center text-sm text-muted-foreground">Yükleniyor…</p>}>
              <StatsView refreshKey={refreshKey} />
            </Suspense>
          ) : duplicatesOnly ? (
            <DuplicatesView onDone={refresh} />
          ) : converterOnly ? (
            <ConverterStudio refreshKey={refreshKey} onDone={refresh} />
          ) : (
            <>
              {chips.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pr-1 pl-2.5 text-xs"
                >
                  {chip.label}
                  <button
                    type="button"
                    onClick={chip.clear}
                    aria-label={`${chip.label} filtresini kaldır`}
                    className="rounded-full p-0.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={showAll}
                className="text-xs text-muted-foreground transition hover:text-foreground"
              >
                Temizle
              </button>
            </div>
          )}
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
            onViewChange={switchView}
            pageSize={pageSize}
            onPageSizeChange={(n) => {
              window.localStorage.setItem('jv-page-size', String(n));
              setPageSize(n);
            }}
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
            </>
          )}
        </main>
      </div>

      <AddItemDialog open={addOpen} onOpenChange={setAddOpen} onSaved={refresh} />
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
      <ClipboardWatcher onDone={refresh} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={paletteCommands} />
    </div>
    </TooltipProvider>
  );
}

export default App;
