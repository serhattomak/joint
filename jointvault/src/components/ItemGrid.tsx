import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { PackageOpen, Pencil, Star, Trash2 } from 'lucide-react';
import { AddItemDialog } from '@/components/AddItemDialog';
import { BulkActions } from '@/components/BulkActions';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  getAllCategoriesByItem,
  getAllTagsByItem,
  listCollections,
  listItems,
  removeItem,
  searchItems,
  toggleFavorite,
} from '@/lib/db/client';
import type { Category, Collection, Item, Tag } from '@/lib/db/types';
import { openExternal } from '@/lib/external';
import { PLATFORM_META, type Platform } from '@/lib/platform';

interface ItemGridProps {
  query: string;
  platform: string; // 'all' or a platform slug
  collectionId: string; // 'all' or a collection id
  categoryId: string; // 'all' or a category id
  tagId: string; // 'all' or a tag id
  favoritesOnly: boolean;
  refreshKey: number;
  view: 'grid' | 'rows';
}

// 06: Tauri opener plugin — falls back to window.open in dev-browser mode.
// block + w-full: içindeki truncate/line-clamp zincirinin çalışması için
// ebeveyn genişliğine sabitlenir (yoksa buton içeriğe göre şişer).
function OpenLink({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => void openExternal(url)}
      className="block w-full min-w-0 cursor-pointer text-left"
    >
      {children}
    </button>
  );
}

interface ItemViewProps {
  item: Item;
  tags: Tag[];
  categories: Category[];
  collectionLabel: string | null;
  selected: boolean;
  index: number;
  onToggle: (id: string) => void;
  onFavorite: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (item: Item) => void;
}

function ActionButtons({ item, onFavorite, onDelete, onEdit }: Pick<ItemViewProps, 'item' | 'onFavorite' | 'onDelete' | 'onEdit'>) {  return (
    <>
      <Button
        variant={item.favorite ? 'default' : 'ghost'}
        size="icon-sm"
        onClick={() => onFavorite(item.id)}
        aria-label="Favori"
        aria-pressed={item.favorite}
      >
        <Star className={item.favorite ? 'fill-current' : ''} />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => onEdit(item)} aria-label="Düzenle">
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => onDelete(item.id)} aria-label="Sil">
        <Trash2 />
      </Button>
    </>
  );
}

// Ölü CDN linkleri (süresi dolmuş IG thumb'ları) kırık ikon bırakmasın;
// loading=lazy + content-visibility ile mount fırtınası da biter.
const Thumb = memo(function Thumb({
  src,
  className,
  fallback,
}: {
  src: string | null;
  className: string;
  fallback: React.ReactNode;
}) {
  const [dead, setDead] = useState(false);
  if (!src || dead) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setDead(true)}
    />
  );
});

// memo: seçim değişiminde sadece dokunulan satır render edilir.
const ItemRowView = memo(function ItemRowView({
  item,
  tags,
  categories,
  collectionLabel,
  selected,
  onToggle,
  onFavorite,
  onDelete,
  onEdit,
}: ItemViewProps) {
  return (
    <div className="cv-row group flex items-center gap-3 px-3 py-2 transition hover:bg-muted/60">
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(item.id)}
        className="size-4 shrink-0 accent-primary"
        aria-label="Öğeyi seç"
      />
      <Thumb
        src={item.thumbnail}
        className="size-11 shrink-0 rounded-lg object-cover"
        fallback={
          <span
            className={`size-2.5 shrink-0 rounded-full ${PLATFORM_META[(item.platform as Platform)]?.dot ?? PLATFORM_META.other.dot}`}
          />
        }
      />
      <div className="min-w-0 max-w-xl flex-1 overflow-hidden">
        <OpenLink url={item.url}>
          <Tooltip>
            <TooltipTrigger
              render={
                <p className="truncate font-display text-[15px] leading-snug hover:underline">
                  {item.title || item.url}
                </p>
              }
            />
            <TooltipContent>{item.title || item.url}</TooltipContent>
          </Tooltip>
        </OpenLink>
                <p className="truncate text-xs text-muted-foreground">
                  {PLATFORM_META[(item.platform as Platform)]?.label ?? item.platform}
                  {collectionLabel && ` · ${collectionLabel}`}
                  {categories.map((c) => ` ${c.name}`).join('')}
                  {tags.map((t) => ` #${t.name}`).join('')}
                  {` · ${new Date(item.created_at).toLocaleDateString('tr-TR')}`}
                </p>
        <div className="mt-0.5 flex items-center gap-0.5">
          <ActionButtons item={item} onFavorite={onFavorite} onDelete={onDelete} onEdit={onEdit} />
        </div>
      </div>
    </div>
  );
});

const ItemCardView = memo(function ItemCardView({
  item,
  tags,
  categories,
  collectionLabel,
  selected,
  index,
  onToggle,
  onFavorite,
  onDelete,
  onEdit,
}: ItemViewProps) {
  return (
    <article
      className="group animate-rise cv-card relative flex flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-lift"
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(item.id)}
        aria-label="Öğeyi seç"
        className={`absolute top-2 left-2 z-10 size-4 accent-primary transition ${
          selected ? '' : 'opacity-0 group-hover:opacity-100'
        }`}
      />
      <Thumb
        src={item.thumbnail}
        className="h-36 w-full object-cover"
        fallback={
          <div className="flex h-36 w-full items-center justify-center bg-muted text-sm text-muted-foreground">
            Önizleme yok
          </div>
        }
      />
      <div className="flex flex-col gap-2 p-3">
        <OpenLink url={item.url}>
          <h3 className="line-clamp-2 font-display text-[15px] leading-snug hover:underline">
            {item.title || item.url}
          </h3>
        </OpenLink>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`size-2 rounded-full ${PLATFORM_META[(item.platform as Platform)]?.dot ?? PLATFORM_META.other.dot}`}
            />
            {PLATFORM_META[(item.platform as Platform)]?.label ?? item.platform}
          </span>
                  {collectionLabel && <span>{collectionLabel}</span>}
                  {categories.map((c) => (
                    <span key={c.id}>{c.name}</span>
                  ))}
                  {tags.map((t) => (
                    <span key={t.id}>#{t.name}</span>
                  ))}
        </div>
        <div className="mt-1 flex items-center gap-1 border-t border-border pt-2">
          <ActionButtons item={item} onFavorite={onFavorite} onDelete={onDelete} onEdit={onEdit} />
        </div>
      </div>
    </article>
  );
});

export function ItemGrid({ query, platform, collectionId, categoryId, tagId, favoritesOnly, refreshKey, view }: ItemGridProps) {
  // Ham satırlar: sadece arama metni + refresh değişince çekilir (IPC).
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [tagsByItem, setTagsByItem] = useState<Record<string, Tag[]>>({});
  const [catsByItem, setCatsByItem] = useState<Record<string, Category[]>>({});
  const [collections, setCollections] = useState<Collection[]>([]);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  // Arama her tuşta IPC yapmasın.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Satırlar: arama/refresh değişince tek tur.
  useEffect(() => {
    let live = true;
    void (async () => {
      const q = debouncedQuery.trim();
      // ponytail: SQL LIKE search in client, no FTS5 table for MVP.
      const rows = q ? await searchItems(q) : await listItems();
      if (live) setAllItems(rows);
    })();
    return () => {
      live = false;
    };
  }, [debouncedQuery, refreshKey]);

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
  }, [refreshKey]);

  // Filtreler saf hesap: IPC yok, memo sayesinde sadece giren/çıkan satır oynar.
  const filtered = useMemo(
    () =>
      allItems.filter(
        (it) =>
          (platform === 'all' || it.platform === platform) &&
          (collectionId === 'all' || it.collection_id === collectionId) &&
          (categoryId === 'all' || (catsByItem[it.id] ?? []).some((c) => c.id === categoryId)) &&
          (tagId === 'all' || (tagsByItem[it.id] ?? []).some((t) => t.id === tagId)) &&
          (!favoritesOnly || it.favorite),
      ),
    [allItems, platform, collectionId, categoryId, tagId, favoritesOnly, tagsByItem, catsByItem],
  );

  // Yazma sonrası (sil/kaydet): satır + eşleşme birlikte tazelenir.
  const refreshAll = useCallback(async (): Promise<void> => {
    const q = debouncedQuery.trim();
    const [rows, cols, tagMap, catMap] = await Promise.all([
      q ? searchItems(q) : listItems(),
      listCollections(),
      getAllTagsByItem(),
      getAllCategoriesByItem(),
    ]);
    setAllItems(rows);
    setCollections(cols as Collection[]);
    setTagsByItem(tagMap);
    setCatsByItem(catMap);
    setSelected(new Set());
  }, [debouncedQuery]);

  // Filtre değişince seçim sıfırlanır (liste dışına taşmasın).
  useEffect(() => {
    setSelected(new Set());
  }, [platform, collectionId, categoryId, tagId, favoritesOnly, debouncedQuery]);

  const toggleSelect = useCallback((id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((): void => {
    const allIds = filtered.map((it) => it.id);
    setSelected((prev) => (prev.size === allIds.length && allIds.length > 0 ? new Set() : new Set(allIds)));
  }, [filtered]);

  const handleFavorite = useCallback(async (id: string): Promise<void> => {
    const updated = await toggleFavorite(id);
    setAllItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
  }, []);

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!window.confirm('Bu öğeyi silmek istiyor musun?')) return;
      await removeItem(id);
      await refreshAll();
    },
    [refreshAll],
  );

  const handleEdit = useCallback((item: Item): void => {
    setEditing(item);
    setEditOpen(true);
  }, []);

  if (filtered.length === 0) {
    const isFiltering =
      query.trim() !== '' ||
      platform !== 'all' ||
      collectionId !== 'all' ||
      categoryId !== 'all' ||
      tagId !== 'all' ||
      favoritesOnly;
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

  return (
    <>
      {view === 'rows' ? (
        <div className="animate-rise divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-card">
          {filtered.map((item) => (
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
            />
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((item, i) => (
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
          />
        ))}
      </div>
      )}
      <AddItemDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => void refreshAll()}
        initial={editing}
      />
      <BulkActions
        ids={[...selected]}
        total={filtered.length}
        allSelected={filtered.length > 0 && selected.size === filtered.length}
        onSelectAll={selectAll}
        onClear={() => setSelected(new Set())}
        onDone={() => void refreshAll()}
      />
    </>
  );
}
