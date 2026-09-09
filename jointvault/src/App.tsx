import { useEffect, useState } from 'react';
import { Archive, LayoutGrid, Plus, Rows3, Search, Settings, SlidersHorizontal, Star, Upload } from 'lucide-react';
import { AddItemDialog } from '@/components/AddItemDialog';
import { BulkImportDialog } from '@/components/BulkImportDialog';
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
import { PLATFORM_META, PLATFORM_ORDER } from '@/lib/platform';

function App() {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState('all');
  const [collectionId, setCollectionId] = useState('all');
  const [categoryId, setCategoryId] = useState('all');
  const [tagId, setTagId] = useState('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
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
  };

  const navBtn = (active: boolean): string =>
    `flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${
      active ? 'bg-secondary font-medium text-secondary-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
    }`;

  return (
    <TooltipProvider delay={300}>
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-card px-3 py-4 md:flex">
        <div className="flex items-center gap-2 px-1.5">
          <Archive className="size-5 text-primary" strokeWidth={2} />
          <span className="font-display text-xl tracking-tight">JointVault</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          <button type="button" onClick={showAll} className={navBtn(platform === 'all' && collectionId === 'all' && categoryId === 'all' && tagId === 'all' && !favoritesOnly)}>
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
            }}
            className={navBtn(favoritesOnly)}
          >
            <Star className="size-4" /> Favoriler
          </button>
        </nav>
        <div className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            Platform
          </p>
          {PLATFORM_ORDER.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPlatform(p);
                setFavoritesOnly(false);
              }}
              className={navBtn(platform === p)}
            >
              <span className={`size-2 rounded-full ${PLATFORM_META[p].dot}`} />
              {PLATFORM_META[p].label}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5">
          <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            Kategori
          </p>
          <div className="flex max-h-32 flex-col gap-0.5 overflow-y-auto">
            {categories.length === 0 && (
              <p className="px-2.5 text-xs text-muted-foreground">Henüz yok.</p>
            )}
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCategoryId(c.id);
                  setFavoritesOnly(false);
                }}
                className={`${navBtn(categoryId === c.id)} truncate`}
              >
                <span className="truncate">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5">
          <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            Etiket
          </p>
          <div className="flex max-h-32 flex-col gap-0.5 overflow-y-auto">
            {tags.length === 0 && (
              <p className="px-2.5 text-xs text-muted-foreground">Henüz yok.</p>
            )}
            {tags.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTagId(t.id);
                  setFavoritesOnly(false);
                }}
                className={`${navBtn(tagId === t.id)} truncate`}
              >
                <span className="truncate">#{t.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center justify-between px-2.5 pb-1">
            <p className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              Koleksiyon
            </p>
            <button
              type="button"
              onClick={() => setOrganizeOpen(true)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <SlidersHorizontal className="size-3" /> Düzenle
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {collections.length === 0 && (
              <p className="px-2.5 text-xs text-muted-foreground">Henüz yok.</p>
            )}
            {collections.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCollectionId(c.id);
                  setFavoritesOnly(false);
                }}
                className={`${navBtn(collectionId === c.id)} truncate`}
              >
                <span className="truncate">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-border pt-2">
          <button type="button" onClick={() => setPairingOpen(true)} className={navBtn(false)}>
            <Settings className="size-4" /> Eklenti eşleşme
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
          <Button onClick={() => setAddOpen(true)}>
            <Plus /> Yeni öğe
          </Button>
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <Upload /> Toplu aktar
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
          <ItemGrid
            query={query}
            platform={platform}
            collectionId={collectionId}
            categoryId={categoryId}
            tagId={tagId}
            favoritesOnly={favoritesOnly}
            refreshKey={refreshKey}
            view={view}
          />
        </main>
      </div>

      <AddItemDialog open={addOpen} onOpenChange={setAddOpen} onSaved={refresh} />
      <BulkImportDialog open={bulkOpen} onOpenChange={setBulkOpen} onDone={refresh} />
      <OrganizeDialog open={organizeOpen} onOpenChange={setOrganizeOpen} onChanged={refresh} />
      <PairingSettings open={pairingOpen} onOpenChange={setPairingOpen} />
      <XSyncReviewDialog onDone={refresh} />
    </div>
    </TooltipProvider>
  );
}

export default App;
