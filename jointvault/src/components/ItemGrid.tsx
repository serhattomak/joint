import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, PackageOpen, Sparkles, TriangleAlert } from 'lucide-react';
import { BulkActions } from '@/components/BulkActions';
import { RuleStrip } from '@/components/RuleStrip';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ItemCardView, ItemRowView } from '@/components/ItemViews';
import {
  getAllCategoriesByItem,
  getAllTagsByItem,
  getArticleItemIds,
  listItemsPage,
  removeItem,
  searchHybridChunks,
  setDownloadState,
  toggleFavorite,
  type ItemSort,
} from '@/lib/db/client';
import type { Category, Collection, Item, Tag } from '@/lib/db/types';
import { generateEmbeddings, getAiStatus } from '@/lib/ai';
import { describeError } from '@/lib/errors';
import { PLATFORM_META, type Platform } from '@/lib/platform';
import { startDownload, useDownloadProgress, type DownloadKind, type DownloadQuality } from '@/lib/downloads';

interface ItemGridProps {
  query: string;
  semantic?: boolean;
  platform: string; // 'all' or a platform slug
  collectionId: string; // 'all' or a collection id
  categoryId: string; // 'all' or a category id
  tagId: string; // 'all' or a tag id
  favoritesOnly: boolean;
  /** Kapsam: yalnızca diske inmiş kayıtlar. */
  localOnly: boolean;
  /** Kapsam sekmesi (Tümü · Favoriler · Yerel). */
  onScope: (scope: 'all' | 'favorites' | 'local') => void;
  refreshKey: number;
  view: 'grid' | 'rows';
  sort: ItemSort;
  pageSize: number;
  /** Kural şeridi bu üç listeyi doğrudan kullanır; App tek yerden yükler. */
  collections: Collection[];
  categories: Category[];
  tags: Tag[];
  onPageSizeChange: (n: number) => void;
  onSortChange: (next: ItemSort) => void;
  onPlatform: (p: string) => void;
  onCollection: (id: string) => void;
  onCategory: (id: string) => void;
  onTag: (id: string) => void;
  onOpen: (item: Item, tab?: 'detail' | 'reader') => void;
  onClearFilters: () => void;
  onPlayMedia?: (item: Item) => void;
  /** AI etkin mi? Yalnızca kesin `false` iken anlamsal arama dürüst "kapalı" durumuna düşer. */
  aiEnabled?: boolean;
  /** AI kapalıyken Ayarlar → Yapay Zekâ'ya götürür (ölü düğme yok). */
  onOpenAiSettings?: () => void;
}

// İlk boyamada sadece ilk dilim kurulur, gerisi boş karelerde büyür.
// content-visibility granted, ama 1000+ düğümün tek commit'te kurulması dev build'de pahalı.
export const PAGE_SIZES = [24, 48, 96] as const;

/* Kapsam sekmeleri: arşivin üç görünümü. Favoriler/Yerel birer gözetim değil,
   aynı ızgaranın kapsamıdır — bu yüzden sidebar'da değil başlığın altındadır. */
const SCOPES = [
  { id: 'all', label: 'Tümü' },
  { id: 'favorites', label: 'Favoriler' },
  { id: 'local', label: 'Yerel' },
] as const;

export function readPageSize(): number {
  const v = Number.parseInt(window.localStorage.getItem('jv-page-size') ?? '', 10);
  return (PAGE_SIZES as readonly number[]).includes(v) ? v : 48;
}

export function ItemGrid({
  query,
  semantic,
  platform,
  collectionId,
  categoryId,
  tagId,
  favoritesOnly,
  localOnly,
  onScope,
  refreshKey,
  view,
  sort,
  pageSize,
  collections,
  categories,
  tags,
  onPageSizeChange,
  onSortChange,
  onPlatform,
  onCollection,
  onCategory,
  onTag,
  onOpen,
  onClearFilters,
  onPickVideo,
  onConvert,
  onPlayMedia,
  aiEnabled = true,
  onOpenAiSettings,
}: ItemGridProps & { onPickVideo: (item: Item) => void; onConvert: (item: Item) => void }) {
  // Sayfa verisi: filtre+arama SQL'de (LIMIT/OFFSET), ekrana tek sayfa gelir.
  const [rows, setRows] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(0);
  const [bump, setBump] = useState(0);
  const [goto, setGoto] = useState<string | null>(null);
  const [tagsByItem, setTagsByItem] = useState<Record<string, Tag[]>>({});
  const [catsByItem, setCatsByItem] = useState<Record<string, Category[]>>({});
  const [hasArticleIds, setHasArticleIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  // Inline progress percents by item id; cleared when the download settles.
  const [progress, setProgress] = useState<Record<string, number>>({});
  // Hız/ETA metası (ölçüm için de kullanılır).
  const [dlMeta, setDlMeta] = useState<Record<string, { speed?: string | null; eta?: string | null }>>({});
  /* Yükleme hatası: eskiden yakalanmıyordu ve `loaded` hiç true olmuyordu —
     yani kullanıcı sonsuza kadar iskelet görüyordu. */
  const [loadError, setLoadError] = useState<string | null>(null);
  // Guards the one-time queued→active DB flip per download (progress events stream in).
  const markedActive = useRef<Set<string>>(new Set());

  // Arama her tuşta IPC yapmasın.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Sayfa çekimi: arama+filtre+sayfa+boyut+sıralama+refresh değişince tek tur.
  const fetchPage = useCallback(
    async (p: number, size: number): Promise<void> => {
      const q = debouncedQuery.trim();
      // AI kapalıyken anlamsal arama HİÇ denenmez (embedding/istek yok) ve
      // sessizce FTS'e düşülmez: dürüst durum ayrı bir dala çizilir (semanticOff).
      if (semantic && q && !aiEnabled) {
        setRows([]);
        setTotal(0);
        setLoadError(null);
        setLoaded(true);
        return;
      }
      if (semantic && q) {
        try {
          const status = await getAiStatus();
          let queryEmbedding: number[] | null = null;
          if (status.embed_ready && status.engine_available) {
            const embeds = await generateEmbeddings([q]).catch(() => []);
            if (embeds.length > 0) queryEmbedding = embeds[0];
          }
          const results = await searchHybridChunks(q, queryEmbedding, size);
          setRows(results.map((r) => r.item));
          setTotal(results.length);
          setLoaded(true);
          return;
        } catch (e) {
          console.warn('[ItemGrid:semanticSearchFallback]', e);
        }
      }

      try {
        const res = await listItemsPage(size, p * size, {
          query: debouncedQuery,
          platform,
          collectionId,
          categoryId,
          tagId,
          favoritesOnly,
          localOnly,
          sort,
        });
        if (res.total <= p * size && p > 0) {
          setPage(p - 1); // son sayfa boşaldıysa geri adım
          return;
        }
        setRows(res.rows);
        setTotal(res.total);
        setLoadError(null);
        setLoaded(true);
      } catch (error) {
        /* İskelet SONSUZA kadar dönmesin: hata görünür olmalı. */
        setLoadError(describeError(error, 'Kayıtlar yüklenemedi.'));
        setLoaded(true);
      }
    },
    [debouncedQuery, platform, collectionId, categoryId, tagId, favoritesOnly, localOnly, sort, semantic, aiEnabled],
  );

  useEffect(() => {
    void fetchPage(page, pageSize);
  }, [fetchPage, page, pageSize, refreshKey, bump]);

  // Eşleşmeler: refresh değişince tek tur (2 IPC), filtre tıklamasında YOK.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [tagMap, catMap, articleIds] = await Promise.all([
          getAllTagsByItem(),
          getAllCategoriesByItem(),
          getArticleItemIds(),
        ]);
        if (!live) return;
        setTagsByItem(tagMap);
        setCatsByItem(catMap);
        setHasArticleIds(articleIds);
      } catch (error) {
        /* Taksonomi çipleri çizilemez ama ızgara çalışmaya devam eder; sessiz kalmayalım. */
        console.warn('[ItemGrid:taxonomy]', error);
      }
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
  }, [platform, collectionId, categoryId, tagId, favoritesOnly, localOnly, debouncedQuery, sort]);

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

  const confirmDelete = useCallback(async (): Promise<void> => {
    if (!pendingDelete) return;
    // ponytail: downloaded file stays on disk (orphan cleanup later).
    await removeItem(pendingDelete.id);
    setPendingDelete(null);
    refreshAll();
  }, [pendingDelete, refreshAll]);

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
      setDlMeta((m) => {
        const next = { ...m };
        delete next[item.id];
        return next;
      });
      refreshAll();
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
    useCallback((e: { itemId: string; percent: number; speed?: string | null; eta?: string | null }) => {
      setProgress((p) => ({ ...p, [e.itemId]: e.percent }));
      setDlMeta((m) => ({ ...m, [e.itemId]: { speed: e.speed, eta: e.eta } }));
      if (!markedActive.current.has(e.itemId)) {
        markedActive.current.add(e.itemId);
        void setDownloadState(e.itemId, { status: 'active' }).then((updated) => {
          setRows((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
        });
      }
    }, []),
  );

  const collectionLabel = (id: string | null): string | null =>
    collections.find((c) => c.id === id)?.name ?? null;

  const isFiltering =
    query.trim() !== '' ||
    platform !== 'all' ||
    collectionId !== 'all' ||
    categoryId !== 'all' ||
    tagId !== 'all' ||
    favoritesOnly ||
    localOnly;

  // AI kapalı + anlamsal sorgu: sessiz FTS fallback yerine dürüst durum çizilir.
  const semanticOff = semantic === true && debouncedQuery.trim() !== '' && !aiEnabled;

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

  // Apple büyük başlık: "neredeyim" sorusunun tek cevabı — kapsam adı.
  const scopeTitle = favoritesOnly
    ? 'Favoriler'
    : localOnly
      ? 'Yerel'
      : platform !== 'all'
        ? (PLATFORM_META[platform as Platform]?.label ?? 'Tümü')
        : collectionId !== 'all'
          ? (collections.find((c) => c.id === collectionId)?.name ?? 'Koleksiyon')
          : categoryId !== 'all'
            ? (categories.find((c) => c.id === categoryId)?.name ?? 'Kategori')
            : tagId !== 'all'
              ? `#${tags.find((t) => t.id === tagId)?.name ?? 'Etiket'}`
              : 'Tümü';

  const scope: 'all' | 'favorites' | 'local' = favoritesOnly ? 'favorites' : localOnly ? 'local' : 'all';

  const strip = (
    <RuleStrip
      platform={platform}
      collectionId={collectionId}
      categoryId={categoryId}
      tagId={tagId}
      collections={collections}
      categories={categories}
      tags={tags}
      onPlatform={onPlatform}
      onCollection={onCollection}
      onCategory={onCategory}
      onTag={onTag}
      onClear={onClearFilters}
      sort={sort}
      onSort={onSortChange}
      total={total}
    />
  );

  return (
    <>
      {/* Büyük başlık — macOS large title deseni. */}
      <h1 className="shrink-0 px-5 pt-5 text-display">{scopeTitle}</h1>

      {/* Kapsam sekmeleri: Tümü · Favoriler · Yerel */}
      <div className="shrink-0 px-5 pt-3">
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card/60 p-0.5 text-xs">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onScope(s.id)}
              aria-pressed={scope === s.id}
              className={`rounded-md px-3 py-1 transition-colors duration-150 ease-out ${
                scope === s.id
                  ? 'bg-background font-medium shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {strip}
      <div className="min-h-0 flex-1 px-4 py-4">
        {semanticOff ? (
          // AI kapalıyken anlamsal arama dürüst durum + gerçek yönlendirme
          // gösterir; sonuçları FTS ile doldurup "anlamsal" gibi sunmak yok.
          <div className="animate-rise flex flex-col items-center gap-3 py-20 text-center">
            <Sparkles className="size-7 text-muted-foreground" strokeWidth={1.5} />
            <div className="flex flex-col gap-1">
              <p className="text-title">AI kapalı</p>
              <p className="max-w-[46ch] text-sm text-muted-foreground">
                Anlamsal arama için yerel AI'yı Ayarlar → Yapay Zekâ'dan etkinleştir.
              </p>
            </div>
            {onOpenAiSettings && (
              <Button variant="outline" size="sm" onClick={onOpenAiSettings}>
                Ayarlar'dan Aç
              </Button>
            )}
          </div>
        ) : loadError ? (
          <div className="animate-rise flex flex-col items-center gap-3 py-20 text-center">
            <TriangleAlert className="size-7 text-destructive" strokeWidth={1.5} />
            <div className="flex flex-col gap-1">
              <p className="text-title">Kayıtlar yüklenemedi</p>
              <p className="max-w-[46ch] text-sm text-muted-foreground">{loadError}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoadError(null);
                setLoaded(false);
                refreshAll();
              }}
            >
              Yeniden dene
            </Button>
          </div>
        ) : !loaded ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex flex-col overflow-hidden border border-border bg-card">
                <div className="h-0.5 w-full bg-border" />
                <div className="record-band skeleton-paper" />
                <div className="skeleton-paper h-36 w-full" />
                <div className="flex flex-col gap-2 p-3">
                  <div className="skeleton-paper h-4 w-3/4 rounded-xs" />
                  <div className="skeleton-paper h-3 w-1/2 rounded-xs" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="animate-rise flex flex-col items-center gap-3 py-20 text-center">
            <PackageOpen className="size-7 text-muted-foreground" strokeWidth={1.5} />
            <div className="flex flex-col gap-1">
              <p className="text-title">{isFiltering ? 'Bu kurallara uyan kayıt yok' : 'Arşiv boş'}</p>
              <p className="max-w-[46ch] text-sm text-muted-foreground">
                {isFiltering
                  ? 'Kural şeridinden bir filtreyi gevşet ya da temizle.'
                  : 'Yukarıdaki yakala çubuğuna bir link yapıştır ve Enter’a bas. Önizleme sonra çekilir.'}
              </p>
            </div>
            {isFiltering && (
              <Button variant="outline" size="sm" onClick={onClearFilters}>
                Filtreleri temizle
              </Button>
            )}
          </div>
        ) : view === 'rows' ? (
          <div className="settings-card animate-rise flex flex-col divide-y divide-border/70 overflow-hidden">
            {rows.map((item) => (
              <ItemRowView
                key={item.id}
                item={item}
                tags={tagsByItem[item.id] ?? []}
                categories={catsByItem[item.id] ?? []}
                collectionLabel={collectionLabel(item.collection_id)}
                selected={selected.has(item.id)}
                index={0}
                hasArticle={hasArticleIds.has(item.id)}
                onToggle={toggleSelect}
                onFavorite={handleFavorite}
                onDelete={(id) => setPendingDelete(rows.find((r) => r.id === id) ?? null)}
                onOpen={onOpen}
                progress={progress[item.id]}
                meta={dlMeta[item.id]}
                onAudio={handleAudioDownload}
                onPickVideo={onPickVideo}
                onConvert={onConvert}
                onPlayMedia={onPlayMedia}
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
                hasArticle={hasArticleIds.has(item.id)}
                onToggle={toggleSelect}
                onFavorite={handleFavorite}
                onDelete={(id) => setPendingDelete(rows.find((r) => r.id === id) ?? null)}
                onOpen={onOpen}
                progress={progress[item.id]}
                meta={dlMeta[item.id]}
                onAudio={handleAudioDownload}
                onPickVideo={onPickVideo}
                onConvert={onConvert}
                onPlayMedia={onPlayMedia}
              />
            ))}
          </div>
        )}

        {total > Math.min(...PAGE_SIZES) && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-3">
              <span data-num>
                {from}–{to} / {total}
              </span>
              <Select
                label="Sayfa başına"
                size="sm"
                className="w-[7.5rem]"
                value={String(pageSize)}
                onValueChange={(v) => {
                  onPageSizeChange(Number.parseInt(v, 10));
                  setPage(0);
                }}
                options={PAGE_SIZES.map((n) => ({ value: String(n), label: `${n}/sayfa` }))}
              />
            </span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => setPage(0)} disabled={page === 0} aria-label="İlk sayfa">
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
                className="h-7 w-12 rounded-sm border border-input bg-transparent px-1 text-center text-xs outline-none transition-colors focus:border-primary"
              />
              <span data-num>/{pages}</span>
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
        )}
      </div>

      <BulkActions
        ids={[...selected]}
        total={rows.length}
        allSelected={rows.length > 0 && selected.size === rows.length}
        onSelectAll={selectAll}
        onClear={() => setSelected(new Set())}
        onDone={() => refreshAll()}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title="Bu kayıt silinsin mi?"
        description={pendingDelete?.title ?? pendingDelete?.url ?? undefined}
        confirmLabel="Sil"
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
