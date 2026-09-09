import { useEffect, useState } from 'react';
import { Archive, Download, LayoutGrid, Plus, Rows3, Search, Settings, SlidersHorizontal, Star, Upload, X } from 'lucide-react';
import { AddItemDialog } from '@/components/AddItemDialog';
import { BulkImportDialog } from '@/components/BulkImportDialog';
import { DownloadDialog } from '@/components/DownloadDialog';
import { DownloadSettings } from '@/components/DownloadSettings';
import { FilterMenu } from '@/components/FilterMenu';
import { FormatDialog, type FormatTarget } from '@/components/FormatDialog';
import { ItemGrid } from '@/components/ItemGrid';
import { OrganizeDialog } from '@/components/OrganizeDialog';
import { PairingSettings } from '@/components/PairingSettings';
import { XSyncReviewDialog } from '@/components/XSyncReviewDialog';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TooltipProvider } from '@/components/ui/tooltip';
import { listCategories, listCollections, listTags } from '@/lib/db/client';
import type { Category, Collection, Tag } from '@/lib/db/types';
import { PLATFORM_META } from '@/lib/platform';

function App() {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState('all');
  const [collectionId, setCollectionId] = useState('all');
  const [categoryId, setCategoryId] = useState('all');
  const [tagId, setTagId] = useState('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [view, setView] = useState<'grid' | 'rows'>(() =>
    window.localStorage.getItem('jv-view') === 'rows' ? 'rows' : 'grid',
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [urlDlOpen, setUrlDlOpen] = useState(false);
  const [formatTarget, setFormatTarget] = useState<FormatTarget | null>(null);

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

  const showAll = (): void => {
    setPlatform('all');
    setCollectionId('all');
    setCategoryId('all');
    setTagId('all');
    setFavoritesOnly(false);
    setDownloadedOnly(false);
  };

  const navBtn = (active: boolean): string =>
    `flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${
      active ? 'bg-secondary font-medium text-secondary-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
    }`;

  const leaveViews = (): void => {
    setFavoritesOnly(false);
    setDownloadedOnly(false);
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
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-card px-3 py-4 md:flex">
        <div className="flex items-center gap-2 px-1.5">
          <Archive className="size-5 text-primary" strokeWidth={2} />
          <span className="font-display text-xl tracking-tight">JointVault</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          <button type="button" onClick={showAll} className={navBtn(platform === 'all' && collectionId === 'all' && categoryId === 'all' && tagId === 'all' && !favoritesOnly && !downloadedOnly)}>
            <LayoutGrid className="size-4" /> Tümü
          </button>
          <button
            type="button"
            onClick={() => {
              setFavoritesOnly(true);
              setPlatform('all');
              setCollectionId('all');
              setCategoryId('all');
              setTagId('all');
              setDownloadedOnly(false);
            }}
            className={navBtn(favoritesOnly)}
          >
            <Star className="size-4" /> Favoriler
          </button>
          <button
            type="button"
            onClick={() => {
              setDownloadedOnly(true);
              setPlatform('all');
              setCollectionId('all');
              setCategoryId('all');
              setTagId('all');
              setFavoritesOnly(false);
            }}
            className={navBtn(downloadedOnly)}
          >
            <Download className="size-4" /> İndirilenler
          </button>
        </nav>
        <div className="border-t border-border pt-2">
          <button type="button" onClick={() => setOrganizeOpen(true)} className={navBtn(false)}>
            <SlidersHorizontal className="size-4" /> Koleksiyonlar
          </button>
          <button type="button" onClick={() => setPairingOpen(true)} className={navBtn(false)}>
            <Settings className="size-4" /> Eklenti eşleşme
          </button>
          <button type="button" onClick={() => setDownloadOpen(true)} className={navBtn(false)}>
            <Settings className="size-4" /> İndirme klasörü
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <div className="relative min-w-40 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ara: başlık, not, URL…"
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
          <div className="flex items-center rounded-lg border border-border p-0.5" role="group" aria-label="Görünüm">
            <button
              type="button"
              onClick={() => switchView('grid')}
              aria-pressed={view === 'grid'}
              aria-label="Kart görünümü"
              className={`rounded-md p-1.5 transition ${view === 'grid' ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => switchView('rows')}
              aria-pressed={view === 'rows'}
              aria-label="Satır görünümü"
              className={`rounded-md p-1.5 transition ${view === 'rows' ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Rows3 className="size-4" />
            </button>
          </div>
          <ThemeToggle />
        </header>
        <main className="px-4 py-4">
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
            onPickVideo={(item) => setFormatTarget({ id: item.id, url: item.url, title: item.title })}
          />
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
      <BulkImportDialog open={bulkOpen} onOpenChange={setBulkOpen} onDone={refresh} />
      <OrganizeDialog open={organizeOpen} onOpenChange={setOrganizeOpen} onChanged={refresh} />
      <PairingSettings open={pairingOpen} onOpenChange={setPairingOpen} />
      <DownloadSettings open={downloadOpen} onOpenChange={setDownloadOpen} />
      <XSyncReviewDialog onDone={refresh} />
    </div>
    </TooltipProvider>
  );
}

export default App;
