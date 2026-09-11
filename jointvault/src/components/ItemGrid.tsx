import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, LayoutGrid, PackageOpen, Rows3 } from 'lucide-react';
import { AddItemDialog } from '@/components/AddItemDialog';
import { BulkActions } from '@/components/BulkActions';
import { Button } from '@/components/ui/button';
import { ItemCardView, ItemRowView } from '@/components/ItemViews';
import {
  getAllCategoriesByItem,
  getAllTagsByItem,
  listCollections,
  listItemsPage,
  removeItem,
  setDownloadState,
  toggleFavorite,
} from '@/lib/db/client';
import type { Category, Collection, Item, Tag } from '@/lib/db/types';
import { startDownload, useDownloadProgress, type DownloadKind, type DownloadQuality } from '@/lib/downloads';

interface ItemGridProps {
  query: string;
  platform: string; // 'all' or a platform slug
  collectionId: string; // 'all' or a collection id
  categoryId: string; // 'all' or a category id
  tagId: string; // 'all' or a tag id
  favoritesOnly: boolean;
  downloadedOnly: boolean;
  refreshKey: number;
  view: 'grid' | 'rows';
  pageSize: number;
  onPageSizeChange: (n: number) => void;
  onViewChange: (next: 'grid' | 'rows') => void;
}

// İlk boyamada sadece ilk dilim kurulur, gerisi boş karelerde büyür.
// content-visibility granted, ama 1000+ düğümün tek commit'te kurulması dev build'de pahalı.
export const PAGE_SIZES = [24, 48, 96] as const;

export function readPageSize(): number {
  const v = Number.parseInt(window.localStorage.getItem('jv-page-size') ?? '', 10);
  return (PAGE_SIZES as readonly number[]).includes(v) ? v : 48;
}

export function ItemGrid({ query, platform, collectionId, categoryId, tagId, favoritesOnly, downloadedOnly, refreshKey, view, pageSize, onPageSizeChange, onViewChange, onPickVideo, onConvert }: ItemGridProps & { onPickVideo: (item: Item) => void; onConvert: (item: Item) => void }) {
  // Sayfa verisi: filtre+arama SQL'de (LIMIT/OFFSET), ekrana tek sayfa gelir.
  const [rows, setRows] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [bump, setBump] = useState(0);
  const [goto, setGoto] = useState<string | null>(null);
  const [tagsByItem, setTagsByItem] = useState<Record<string, Tag[]>>({});
  const [catsByItem, setCatsByItem] = useState<Record<string, Category[]>>({});
  const [collections, setCollections] = useState<Collection[]>([]);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  // Inline progress percents by item id; cleared when the download settles.
  const [progress, setProgress] = useState<Record<string, number>>({});
  // Guards the one-time queued→active DB flip per download (progress events stream in).
  const markedActive = useRef<Set<string>>(new Set());

  // Arama her tuşta IPC yapmasın.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Sayfa çekimi: arama+filtre+sayfa+boyut+refresh değişince tek tur.
  const fetchPage = useCallback(
    async (p: number, size: number): Promise<void> => {
      const res = await listItemsPage(size, p * size, {
        query: debouncedQuery,
        platform,
        collectionId,
        categoryId,
        tagId,
        favoritesOnly,
        downloadedOnly,
      });
      if (res.total <= p * size && p > 0) {
        setPage(p - 1); // son sayfa boşaldıysa geri adım
        return;
      }
      setRows(res.rows);
      setTotal(res.total);
    },
    [debouncedQuery, platform, collectionId, categoryId, tagId, favoritesOnly, downloadedOnly],
  );

  useEffect(() => {
    void fetchPage(page, pageSize);
  }, [fetchPage, page, pageSize, refreshKey, bump]);

  // Eşleşmeler: refresh değişince tek tur (3 IPC), filtre tıklamasında YOK.
  useEffect(() => {
    let live = true;
    void (async () => {
      const [cols, tagMap, catMap] = await Promise.all([
        listCollections(),
        getAllTagsByItem(),
        getAllCategoriesByItem(),
      ]);
      if (!live) return;
      setCollections(cols as Collection[]);
      setTagsByItem(tagMap);
      setCatsByItem(catMap);
    })();
    return () => {
      live = false;
    };
  }, [refreshKey, bump]);

  // Yazma sonrası (sil/kaydet): efektler bump ile tazelenir.
  const refreshAll = useCallback((): void => {
    setSelected(new Set());
    setBump((b) => b + 1);
  }, []);

  // Filtre değişince ilk sayfaya dön, seçim sıfırlanır.
  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [platform, collectionId, categoryId, tagId, favoritesOnly, downloadedOnly, debouncedQuery]);

  const toggleSelect = useCallback((id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((): void => {
    const allIds = rows.map((it) => it.id);
    setSelected((prev) => (prev.size === allIds.length && allIds.length > 0 ? new Set() : new Set(allIds)));
  }, [rows]);

  const handleFavorite = useCallback(async (id: string): Promise<void> => {
    const updated = await toggleFavorite(id);
    setRows((prev) => prev.map((it) => (it.id === id ? updated : it)));
  }, []);

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!window.confirm('Bu öğeyi silmek istiyor musun?')) return;
      // ponytail: downloaded file stays on disk (orphan cleanup later).
      await removeItem(id);
      await refreshAll();
    },
    [refreshAll],
  );

  const runDownload = useCallback(
    async (item: Item, kind: DownloadKind, quality: DownloadQuality): Promise<void> => {
      setProgress((p) => ({ ...p, [item.id]: 0 }));
      await startDownload(item.id, item.url, kind, quality);
      markedActive.current.delete(item.id);
      setProgress((p) => {
        const next = { ...p };
        delete next[item.id];
        return next;
      });
      await refreshAll();
    },
    [refreshAll],
  );

  const handleAudioDownload = useCallback(
    (item: Item, quality: DownloadQuality): void => {
      void runDownload(item, 'audio', quality);
    },
    [runDownload],
  );

  // First progress event flips queued→active in DB (once per download);
  // percents stay local — no SQLite write per tick.
  useDownloadProgress(
    useCallback((e: { itemId: string; percent: number }) => {
      setProgress((p) => ({ ...p, [e.itemId]: e.percent }));
      if (!markedActive.current.has(e.itemId)) {
        markedActive.current.add(e.itemId);
        void setDownloadState(e.itemId, { status: 'active' }).then((updated) => {
          setRows((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
        });
      }
    }, []),
  );

  const handleEdit = useCallback((item: Item): void => {
    setEditing(item);
    setEditOpen(true);
  }, []);

  if (rows.length === 0) {
    const isFiltering =
      query.trim() !== '' ||
      platform !== 'all' ||
      collectionId !== 'all' ||
      categoryId !== 'all' ||
      tagId !== 'all' ||
      favoritesOnly ||
      downloadedOnly;
    return (
      <div className="animate-rise flex flex-col items-center gap-2 py-16 text-center">
        <PackageOpen className="size-8 text-muted-foreground" strokeWidth={1.5} />
        <p className="font-display text-lg">{isFiltering ? 'Sonuç yok' : 'Arşiv boş'}</p>
        <p className="max-w-60 text-sm text-muted-foreground">
          {isFiltering ? 'Filtreleri gevşetmeyi dene.' : 'İlk linkini kaydet, önizlemesiyle burada dursun.'}
        </p>
      </div>
    );
  }

  const collectionLabel = (id: string | null): string | null =>
    collections.find((c) => c.id === id)?.name ?? null;

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  const commitGoto = (): void => {
    if (goto === null) return;
    const n = Number.parseInt(goto, 10);
    setGoto(null);
    if (!Number.isFinite(n)) return;
    setPage(Math.min(pages - 1, Math.max(0, n - 1)));
  };

  const pager = total > Math.min(...PAGE_SIZES) && (
    <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
      <span className="flex items-center gap-2">
        <span className="tabular-nums">
          {from}–{to} / {total}
        </span>
        <select
          value={pageSize}
          onChange={(e) => {
            onPageSizeChange(Number.parseInt(e.target.value, 10));
            setPage(0);
          }}
          aria-label="Sayfa başına"
          className="h-7 rounded-md border border-border bg-transparent px-1 text-xs outline-none focus:border-input"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}/sayfa
            </option>
          ))}
        </select>
      </span>
      <div className="flex items-center gap-1">
        <div className="flex items-center rounded-lg border border-border p-0.5" role="group" aria-label="Görünüm">
          <button
            type="button"
            onClick={() => onViewChange('grid')}
            aria-pressed={view === 'grid'}
            aria-label="Kart görünümü"
            className={`rounded-md p-1.5 transition ${view === 'grid' ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onViewChange('rows')}
            aria-pressed={view === 'rows'}
            aria-label="Satır görünümü"
            className={`rounded-md p-1.5 transition ${view === 'rows' ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Rows3 className="size-4" />
          </button>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setPage(0)}
          disabled={page === 0}
          aria-label="İlk sayfa"
        >
          <ChevronsLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          aria-label="Önceki sayfa"
        >
          <ChevronLeft />
        </Button>
        <input
          value={goto ?? String(page + 1)}
          onChange={(e) => setGoto(e.target.value)}
          onBlur={commitGoto}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          inputMode="numeric"
          aria-label="Sayfaya git"
          className="h-7 w-12 rounded-md border border-border bg-transparent px-1 text-center text-xs tabular-nums outline-none focus:border-input"
        />
        <span className="tabular-nums">/{pages}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
          disabled={page >= pages - 1}
          aria-label="Sonraki sayfa"
        >
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setPage(pages - 1)}
          disabled={page >= pages - 1}
          aria-label="Son sayfa"
        >
          <ChevronsRight />
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {pager}
      {view === 'rows' ? (
        <div className="animate-rise divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-card">
          {rows.map((item) => (
            <ItemRowView
              key={item.id}
              item={item}
              tags={tagsByItem[item.id] ?? []}
              categories={catsByItem[item.id] ?? []}
              collectionLabel={collectionLabel(item.collection_id)}
              selected={selected.has(item.id)}
              index={0}
              onToggle={toggleSelect}
              onFavorite={handleFavorite}
              onDelete={handleDelete}
              onEdit={handleEdit}
              progress={progress[item.id]}
              onAudio={handleAudioDownload}
              onPickVideo={onPickVideo}
              onConvert={onConvert}
            />
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((item, i) => (
          <ItemCardView
            key={item.id}
            item={item}
            tags={tagsByItem[item.id] ?? []}
            categories={catsByItem[item.id] ?? []}
            collectionLabel={collectionLabel(item.collection_id)}
            selected={selected.has(item.id)}
            index={i}
            onToggle={toggleSelect}
            onFavorite={handleFavorite}
            onDelete={handleDelete}
            onEdit={handleEdit}
            progress={progress[item.id]}
            onAudio={handleAudioDownload}
            onPickVideo={onPickVideo}
            onConvert={onConvert}
          />
        ))}
      </div>
      )}
      <AddItemDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => refreshAll()}
        initial={editing}
      />
      <BulkActions
        ids={[...selected]}
        total={rows.length}
        allSelected={rows.length > 0 && selected.size === rows.length}
        onSelectAll={selectAll}
        onClear={() => setSelected(new Set())}
        onDone={() => refreshAll()}
      />
    </>
  );
}
