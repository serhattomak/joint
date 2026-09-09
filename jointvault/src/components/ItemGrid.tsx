import { useCallback, useEffect, useState } from 'react';
import { PackageOpen, Pencil, Star, Trash2 } from 'lucide-react';
import { AddItemDialog } from '@/components/AddItemDialog';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  getTagsForItem,
  listCollections,
  listItems,
  removeItem,
  searchItems,
  toggleFavorite,
} from '@/lib/db/client';
import type { Collection, Item, Tag } from '@/lib/db/types';
import { openExternal } from '@/lib/external';
import { PLATFORM_META, type Platform } from '@/lib/platform';

interface ItemGridProps {
  query: string;
  platform: string; // 'all' or a platform slug
  collectionId: string; // 'all' or a collection id
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

export function ItemGrid({ query, platform, collectionId, favoritesOnly, refreshKey, view }: ItemGridProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [tagsByItem, setTagsByItem] = useState<Record<string, Tag[]>>({});
  const [collections, setCollections] = useState<Collection[]>([]);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    const q = query.trim();
    // ponytail: SQL LIKE search in client, no FTS5 table for MVP.
    const rows = q ? await searchItems(q) : await listItems();
    const filtered = rows.filter(
      (it) =>
        (platform === 'all' || it.platform === platform) &&
        (collectionId === 'all' || it.collection_id === collectionId) &&
        (!favoritesOnly || it.favorite),
    );
    setItems(filtered);
    const [cols, ...tagLists] = await Promise.all([
      listCollections(),
      ...filtered.map((it) => getTagsForItem(it.id)),
    ]);
    setCollections(cols as Collection[]);
    const map: Record<string, Tag[]> = {};
    filtered.forEach((it, i) => {
      map[it.id] = (tagLists as Tag[][])[i] ?? [];
    });
    setTagsByItem(map);
  }, [query, platform, collectionId, favoritesOnly]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const collectionName = (id: string | null): string | null =>
    collections.find((c) => c.id === id)?.name ?? null;

  const handleFavorite = async (id: string): Promise<void> => {
    const updated = await toggleFavorite(id);
    setItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm('Bu öğeyi silmek istiyor musun?')) return;
    await removeItem(id);
    await reload();
  };

  const handleEdit = (item: Item): void => {
    setEditing(item);
    setEditOpen(true);
  };

  if (items.length === 0) {
    return (
      <div className="animate-rise flex flex-col items-center gap-2 py-16 text-center">
        <PackageOpen className="size-8 text-muted-foreground" strokeWidth={1.5} />
        <p className="font-display text-lg">Arşiv boş</p>
        <p className="max-w-60 text-sm text-muted-foreground">
          İlk linkini kaydet, önizlemesiyle burada dursun.
        </p>
      </div>
    );
  }

  return (
    <>
      {view === 'rows' ? (
        <div className="animate-rise divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-card">
          {items.map((item) => (
            <div key={item.id} className="group flex items-center gap-3 px-3 py-2 transition hover:bg-muted/60">
              {item.thumbnail ? (
                <img src={item.thumbnail} alt="" className="size-11 shrink-0 rounded-lg object-cover" />
              ) : (
                <span
                  className={`size-2.5 shrink-0 rounded-full ${PLATFORM_META[(item.platform as Platform)]?.dot ?? PLATFORM_META.other.dot}`}
                />
              )}
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
                  {collectionName(item.collection_id) && ` · ${collectionName(item.collection_id)}`}
                  {(tagsByItem[item.id] ?? []).map((t) => ` #${t.name}`).join('')}
                  {` · ${new Date(item.created_at).toLocaleDateString('tr-TR')}`}
                </p>
                <div className="mt-0.5 flex items-center gap-0.5">
                  <Button
                    variant={item.favorite ? 'default' : 'ghost'}
                    size="icon-sm"
                    onClick={() => void handleFavorite(item.id)}
                    aria-label="Favori"
                    aria-pressed={item.favorite}
                  >
                    <Star className={item.favorite ? 'fill-current' : ''} />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => handleEdit(item)} aria-label="Düzenle">
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void handleDelete(item.id)}
                    aria-label="Sil"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item, i) => (
          <article
            key={item.id}
            style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
            className="group animate-rise flex flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-lift"
          >
            {item.thumbnail ? (
              <img src={item.thumbnail} alt="" className="h-36 w-full object-cover" />
            ) : (
              <div className="flex h-36 w-full items-center justify-center bg-muted text-sm text-muted-foreground">
                Önizleme yok
              </div>
            )}
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
                {collectionName(item.collection_id) && <span>{collectionName(item.collection_id)}</span>}
                {(tagsByItem[item.id] ?? []).map((t) => (
                  <span key={t.id}>#{t.name}</span>
                ))}
              </div>
              <div className="mt-1 flex items-center gap-1 border-t border-border pt-2">
                <Button
                  variant={item.favorite ? 'default' : 'ghost'}
                  size="icon-sm"
                  onClick={() => void handleFavorite(item.id)}
                  aria-label="Favori"
                  aria-pressed={item.favorite}
                >
                  <Star className={item.favorite ? 'fill-current' : ''} />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => handleEdit(item)} aria-label="Düzenle">
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void handleDelete(item.id)}
                  aria-label="Sil"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
      )}
      <AddItemDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => void reload()}
        initial={editing}
      />
    </>
  );
}
