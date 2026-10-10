import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  FolderKanban,
  Move,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PageSurface } from '@/components/ui/page-surface';
import {
  createCategory,
  createCollection,
  createTag,
  getDb,
  getItemIdsForCategory,
  getItemIdsForTag,
  listCategoriesWithCounts,
  listCollectionsWithCounts,
  listTagsWithCounts,
  mergeCategories,
  mergeTags,
  moveCategory,
  purgeTaxonomy,
  removeCategory,
  removeCollection,
  removeTag,
  updateCategory,
  updateCollection,
  updateTag,
  type CategoryWithCount,
  type CollectionWithCount,
  type TagWithCount,
} from '@/lib/db/client';
import { createBackup } from '@/lib/db/backup';
import { CategoryTree } from '@/components/CategoryTree';
import { Popover, PopoverContent, PopoverGroupLabel, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { categoryTreeOf, filterTree, type CategoryTreeNode } from '@/lib/taxonomy-view';
import { duplicateGroups } from '@/lib/taxonomy-maintenance';
import { applyRestructPlan, restructurePlan, suggestTaxonomyMerges } from '@/lib/ai';
import { validateRestructPlan, type RestructPlan } from '@/lib/taxonomy-maintenance';
import {
  purgeConfirmText,
  purgeDecision,
  purgePreview as taxonomyPurgePreview,
} from '@/lib/taxonomy-purge';

export type CollectionsTabKey = 'collections' | 'categories' | 'tags';

export interface CollectionsViewProps {
  onClose?: () => void;
  onSelectCollection?: (collectionId: string) => void;
  onSelectCategory?: (categoryId: string) => void;
  onSelectTag?: (tagId: string) => void;
  initialTab?: CollectionsTabKey;
}

type DeleteKind = 'collection' | 'category' | 'tag';

const DELETE_CONFIRM_TEXT: Record<DeleteKind, { title: string; description: string }> = {
  collection: {
    title: 'Koleksiyon silinsin mi?',
    description: 'Koleksiyon içindeki kayıtlar silinmez, yalnızca koleksiyonsuz kalır.',
  },
  category: {
    title: 'Kategori silinsin mi?',
    description: 'Kategori silindiğinde kayıtlar silinmez, yalnızca bu kategori ilişkisi kaldırılır.',
  },
  tag: {
    title: 'Etiket silinsin mi?',
    description: 'Etiket tüm kayıtlardan temizlenir; kayıtlarınız silinmez.',
  },
};

/*
 * Ağacı derinlikle birlikte ön-sıralı düz listeye açar. Kartlar ağaç
 * girintisini (`depth`) buradan alır; ayrı bir çizim sözlüğü açılmaz.
 */
function flattenTree(
  nodes: CategoryTreeNode[],
  depth = 0,
  out: { node: CategoryTreeNode; depth: number }[] = [],
): { node: CategoryTreeNode; depth: number }[] {
  for (const node of nodes) {
    out.push({ node, depth });
    flattenTree(node.children, depth + 1, out);
  }
  return out;
}

export function CollectionsView({
  onClose,
  onSelectCollection,
  onSelectCategory,
  onSelectTag,
  initialTab = 'collections',
}: CollectionsViewProps) {
  const [activeTab, setActiveTab] = useState<CollectionsTabKey>(initialTab);
  const [loading, setLoading] = useState(true);

  const [collections, setCollections] = useState<CollectionWithCount[]>([]);
  const [categories, setCategories] = useState<CategoryWithCount[]>([]);
  const [tags, setTags] = useState<TagWithCount[]>([]);

  // Yeni ekleme girdileri
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newTagName, setNewTagName] = useState('');

  // Arama filtreleri
  const [searchFilter, setSearchFilter] = useState('');

  // Düzenleme durumu
  const [editingItem, setEditingItem] = useState<{ kind: DeleteKind; id: string; name: string } | null>(null);

  // Silme onayı
  const [pendingDelete, setPendingDelete] = useState<{ kind: DeleteKind; id: string } | null>(null);

  // Taksonomi bakımı
  const [maintOpen, setMaintOpen] = useState(false);
  const [maintKind, setMaintKind] = useState<'tags' | 'categories'>('tags');
  const [suggestions, setSuggestions] = useState<string[][]>([]);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [confirmMerge, setConfirmMerge] = useState<{
    kind: 'tags' | 'categories';
    canonical: string;
    duplicates: string[];
  } | null>(null);
  const [confirmUnused, setConfirmUnused] = useState<{
    kind: 'tags' | 'categories';
    ids: string[];
  } | null>(null);

  const maintList = (kind: 'tags' | 'categories'): { name: string; count: number }[] =>
    (kind === 'tags' ? tags : categories).map((x) => ({ name: x.name, count: x.count }));

  const maintIdByName = (kind: 'tags' | 'categories', name: string): string | null =>
    (kind === 'tags' ? tags : categories).find((x) => x.name === name)?.id ?? null;

  const runMerge = async (): Promise<void> => {
    if (!confirmMerge) return;
    const { kind, canonical, duplicates } = confirmMerge;
    setConfirmMerge(null);
    try {
      await createBackup(await getDb());
      const canonicalId = maintIdByName(kind, canonical);
      const dupIds = duplicates
        .map((n) => maintIdByName(kind, n))
        .filter((x): x is string => Boolean(x));
      if (!canonicalId || dupIds.length === 0) return;

      // Etkilenen öğeleri birleştirmeden ÖNCE topla (silinince kaybolur).
      const affected = new Set<string>();
      for (const id of [canonicalId, ...dupIds]) {
        const itemIds =
          kind === 'tags' ? await getItemIdsForTag(id) : await getItemIdsForCategory(id);
        for (const i of itemIds) affected.add(i);
      }

      if (kind === 'tags') await mergeTags(canonicalId, dupIds);
      else await mergeCategories(canonicalId, dupIds);

      window.dispatchEvent(new CustomEvent('vault-items-updated'));
      for (const id of affected) {
        window.dispatchEvent(new CustomEvent('vault-item-index-dirty', { detail: { id } }));
      }
      await loadData();
    } catch (e) {
      console.error('[Taksonomi] birleştirme hatası:', e);
    }
  };

  const runDeleteUnused = async (): Promise<void> => {
    if (!confirmUnused) return;
    const { kind, ids } = confirmUnused;
    setConfirmUnused(null);
    try {
      await createBackup(await getDb());
      for (const id of ids) {
        if (kind === 'tags') await removeTag(id);
        else await removeCategory(id);
      }
      window.dispatchEvent(new CustomEvent('vault-items-updated'));
      await loadData();
    } catch (e) {
      console.error('[Taksonomi] kullanılmayan silme hatası:', e);
    }
  };

  const runSuggest = async (): Promise<void> => {
    setSuggestBusy(true);
    setSuggestions([]);
    try {
      // Etiketler düz (hiyerarşisiz): parent_id yok, yol tek elemanlı kalır.
      const items =
        maintKind === 'tags' ? tags.map((t) => ({ ...t, parent_id: null })) : categories;
      const list = maintKind === 'tags' ? tags : categories;
      const counts = new Map(list.map((x) => [x.id, x.count]));
      const groups = await suggestTaxonomyMerges(maintKind, items, counts);
      setSuggestions(groups);
    } finally {
      setSuggestBusy(false);
    }
  };

  /*
   * Yeniden yapılandırma: düz taksonomiyi en fazla 5 seviyeli hiyerarşiye indirger.
   * İki adımlı — önce ÖNERİ (hiçbir şey yazılmaz), sonra kullanıcı onayıyla
   * uygulama. Geri alınamaz olduğu için ikinci adım yedek alır ve onay ister.
   */
  const [restructPlan, setRestructPlan] = useState<RestructPlan | null>(null);
  const [restructBusy, setRestructBusy] = useState(false);
  const [confirmRestruct, setConfirmRestruct] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Taşıma: hedef üst seçiciyi açık tutan kategori ve seçici araması.
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);
  const [moveSearch, setMoveSearch] = useState('');

  // Toplu taksonomi temizliği (sıfırdan başlatmak için)
  const [confirmPurge, setConfirmPurge] = useState<{
    kind: 'categories' | 'tags';
  } | null>(null);
  const [purgeBusy, setPurgeBusy] = useState(false);

  const purgePreview = (kind: 'categories' | 'tags') =>
    taxonomyPurgePreview(
      kind === 'categories' ? categories : tags,
      kind === 'categories'
        ? categories.reduce((sum, c) => sum + c.count, 0)
        : tags.reduce((sum, t) => sum + t.count, 0),
    );

  const runPurge = async (): Promise<void> => {
    if (!confirmPurge) return;
    const { kind } = confirmPurge;
    setConfirmPurge(null);
    setPurgeBusy(true);
    try {
      const preview = purgePreview(kind);
      if (!preview.canPurge) {
        setNotice('Silinecek kategori ya da etiket yok.');
        return;
      }
      // Geri alınamaz işlem: yedek almadan silme YAPILMAZ.
      await createBackup(await getDb());
      const decision = purgeDecision(preview, true);
      if (!decision.ok) {
        setNotice(decision.reason ?? 'Silme yapılamadı.');
        return;
      }

      const { removed, affectedItemIds } = await purgeTaxonomy(kind);
      window.dispatchEvent(new CustomEvent('vault-items-updated'));
      // Taksonomi adları meta chunk'a gömülüydü; silme onları bayatlatır.
      for (const id of affectedItemIds) {
        window.dispatchEvent(new CustomEvent('vault-item-index-dirty', { detail: { id } }));
      }
      setNotice(`${removed} ${kind === 'categories' ? 'kategori' : 'etiket'} silindi.`);
      await loadData();
    } catch (e) {
      setNotice(`Silme başarısız: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPurgeBusy(false);
    }
  };

  const runRestructSuggest = async (): Promise<void> => {
    setRestructBusy(true);
    setRestructPlan(null);
    try {
      const names = categories.map((c) => c.name);
      const { moves, merges } = await restructurePlan(names);
      const check = validateRestructPlan(names, { moves, merges });
      if (!check.ok) {
        setNotice(
          `Plan uygulanamaz: ${check.missing.length} bilinmeyen, ${check.duplicated.length} yinelenen ad.`,
        );
        return;
      }
      if (moves.length === 0 && merges.length === 0) {
        setNotice('Taksonomi zaten uygun görünüyor.');
        return;
      }
      setRestructPlan({ moves, merges });
    } finally {
      setRestructBusy(false);
    }
  };

  const runRestructApply = async (): Promise<void> => {
    if (!restructPlan) return;
    setConfirmRestruct(false);
    setRestructBusy(true);
    try {
      await createBackup(await getDb());
      const { skipped } = await applyRestructPlan(restructPlan);
      setRestructPlan(null);
      setNotice(
        skipped.length > 0
          ? `Taksonomi hiyerarşiye dönüştürüldü; ${skipped.length} taşıma en fazla seviye aşıldığı için atlandı.`
          : 'Taksonomi hiyerarşiye dönüştürüldü.',
      );
      window.dispatchEvent(new CustomEvent('vault-items-updated'));
      await loadData();
    } catch (e) {
      setNotice(`Yeniden yapılandırma başarısız: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRestructBusy(false);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [cols, cats, tgs] = await Promise.all([
        listCollectionsWithCounts(),
        listCategoriesWithCounts(),
        listTagsWithCounts(),
      ]);
      setCollections(cols);
      setCategories(cats);
      setTags(tgs);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // Koleksiyon İşlemleri
  const handleAddCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    await createCollection(name);
    setNewCollectionName('');
    await loadData();
  };

  // Kategori İşlemleri
  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    await createCategory(name);
    setNewCategoryName('');
    await loadData();
  };

  // Etiket İşlemleri
  const handleAddTag = async () => {
    let name = newTagName.trim();
    if (!name) return;
    if (!name.startsWith('#')) name = `#${name}`;
    await createTag(name);
    setNewTagName('');
    await loadData();
  };

  // Düzenleme Kaydet
  const handleSaveRename = async () => {
    if (!editingItem) return;
    const name = editingItem.name.trim();
    if (!name) return;

    if (editingItem.kind === 'collection') {
      await updateCollection(editingItem.id, name);
    } else if (editingItem.kind === 'category') {
      await updateCategory(editingItem.id, name);
    } else if (editingItem.kind === 'tag') {
      await updateTag(editingItem.id, name);
    }

    setEditingItem(null);
    await loadData();
  };

  // Silme Gerçekleştir
  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const { kind, id } = pendingDelete;

    if (kind === 'collection') {
      await removeCollection(id);
    } else if (kind === 'category') {
      await removeCategory(id);
    } else if (kind === 'tag') {
      await removeTag(id);
    }

    setPendingDelete(null);
    await loadData();
  };

  /*
   * Taşıma, hiyerarşiyi değiştiren tek yazma yolu `moveCategory` üzerinden
   * gider. Kapı reddederse hata fırlatır: gerekçe `notice`e yazılır, veri
   * değişmediği için liste olduğu gibi kalır (yeniden yüklemeye gerek yok).
   */
  const handleMoveCategory = async (id: string, parentId: string | null): Promise<void> => {
    setMoveTargetId(null);
    setMoveSearch('');
    setNotice(null);
    try {
      await moveCategory(id, parentId);
      window.dispatchEvent(new CustomEvent('vault-items-updated'));
      await loadData();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };

  // Filtrelenmiş listeler
  const query = searchFilter.trim().toLowerCase();

  const filteredCollections = collections.filter((c) =>
    query ? c.name.toLowerCase().includes(query) : true,
  );
  const filteredTags = tags.filter((t) =>
    query ? t.name.toLowerCase().includes(query) : true,
  );

  // Kategoriler ağaç olarak çizilir; arama ataları korur (CategoryTree ile aynı).
  const categoryTree = categoryTreeOf(categories);
  const visibleCategoryTree = query
    ? filterTree(categoryTree, searchFilter.trim().toLocaleLowerCase('tr'))
    : categoryTree;
  const flatCategories = flattenTree(visibleCategoryTree);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  return (
    <PageSurface
      icon={<FolderKanban />}
      title="Koleksiyonlar & Düzenleme"
      description="Arşivindeki tüm kayıtları koleksiyonlara ayır, kategori ve etiket ağacını düzenle."
      width="5xl"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setMaintOpen(true)}>
            <Sparkles /> Taksonomi Bakımı
          </Button>
          {onClose && (
            <Button variant="outline" size="sm" onClick={onClose}>
              <ArrowLeft /> Arşive Dön
            </Button>
          )}
        </div>
      }
    >
      {/* SEKME DÜĞMELERİ VE ARAMA ÇUBUĞU */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => {
              setActiveTab('collections');
              setSearchFilter('');
            }}
            className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
              activeTab === 'collections'
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <FolderKanban className="size-4" />
            Koleksiyonlar
            <Badge variant="outline" className="ml-1 px-1.5 py-0 text-xs">
              {collections.length}
            </Badge>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('categories');
              setSearchFilter('');
            }}
            className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
              activeTab === 'categories'
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Bookmark className="size-4" />
            Kategoriler
            <Badge variant="outline" className="ml-1 px-1.5 py-0 text-xs">
              {categories.length}
            </Badge>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('tags');
              setSearchFilter('');
            }}
            className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
              activeTab === 'tags'
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <TagIcon className="size-4" />
            Etiketler
            <Badge variant="outline" className="ml-1 px-1.5 py-0 text-xs">
              {tags.length}
            </Badge>
          </button>
        </div>

        {/* Canlı arama */}
        <div className="relative w-full sm:w-64">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder={
              activeTab === 'collections'
                ? 'Koleksiyon ara…'
                : activeTab === 'categories'
                ? 'Kategori ara…'
                : 'Etiket ara…'
            }
            className="pl-9 text-sm"
          />
        </div>
      </div>

      {/* SEKME 1: KOLEKSİYONLAR */}
      {activeTab === 'collections' && (
        <div className="flex flex-col gap-6">
          {/* Yeni Koleksiyon Ekleme Çubuğu */}
          <div className="settings-card flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-2">
              <FolderKanban className="size-4 text-primary" />
              <Input
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAddCollection();
                }}
                placeholder="Yeni koleksiyon adı (örn. İlham Verici, Eğitimler, Projeler)…"
                className="flex-1 border-border/80 bg-background"
              />
            </div>
            <Button
              onClick={() => void handleAddCollection()}
              disabled={!newCollectionName.trim()}
              size="sm"
              className="gap-1.5 shrink-0"
            >
              <Plus className="size-4" /> Koleksiyon Ekle
            </Button>
          </div>

          {/* Koleksiyon Kartları Grid */}
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Koleksiyonlar yükleniyor…</p>
          ) : filteredCollections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <FolderKanban className="mx-auto mb-3 size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">Henüz bir koleksiyon bulunamadı</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Yukarıdaki çubuğu kullanarak videolarınızı gruplayabileceğiniz yeni bir koleksiyon oluşturun.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredCollections.map((col) => {
                const isEditing = editingItem?.kind === 'collection' && editingItem.id === col.id;

                return (
                  <div
                    key={col.id}
                    className="settings-card group flex flex-col justify-between p-4 transition-all hover:border-primary/40 hover:shadow-md"
                  >
                    <div>
                      {/* Üst Kart Çubuğu */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <FolderKanban className="size-4" />
                          </span>

                          {isEditing ? (
                            <div className="flex flex-1 items-center gap-1.5">
                              <Input
                                value={editingItem.name}
                                onChange={(e) =>
                                  setEditingItem({ ...editingItem, name: e.target.value })
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void handleSaveRename();
                                  if (e.key === 'Escape') setEditingItem(null);
                                }}
                                autoFocus
                                className="h-7 text-sm"
                              />
                              <Button size="icon" variant="ghost" className="size-7" onClick={() => void handleSaveRename()}>
                                <Check className="size-3.5 text-primary" />
                              </Button>
                              <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditingItem(null)}>
                                <X className="size-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <div className="min-w-0 flex-1">
                              <h3 className="truncate text-base font-semibold leading-snug">{col.name}</h3>
                              <p className="text-xs text-muted-foreground">{col.count} kayıt</p>
                            </div>
                          )}
                        </div>

                        {!isEditing && (
                          <div className="flex shrink-0 items-center gap-1 opacity-80 transition group-hover:opacity-100">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7 text-muted-foreground hover:text-foreground"
                              onClick={() => setEditingItem({ kind: 'collection', id: col.id, name: col.name })}
                              title="Yeniden Adlandır"
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7 text-muted-foreground hover:text-destructive"
                              onClick={() => setPendingDelete({ kind: 'collection', id: col.id })}
                              title="Koleksiyonu Sil"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Mini Görsel Önizlemeler */}
                      <div className="mt-3.5 flex h-14 items-center gap-1.5 overflow-hidden rounded-lg bg-muted/30 p-1.5">
                        {col.previewThumbnails && col.previewThumbnails.length > 0 ? (
                          col.previewThumbnails.map((thumb, idx) => (
                            <img
                              key={idx}
                              src={thumb}
                              alt=""
                              className="h-full aspect-video rounded object-cover border border-border/40"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ))
                        ) : (
                          <p className="w-full text-center text-2xs text-muted-foreground/60 italic">
                            Bu koleksiyonda henüz görsel kayıt yok
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Aksiyon Butonu */}
                    <div className="mt-4 pt-3 border-t border-border/50">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-full justify-between font-medium group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                        onClick={() => {
                          if (onSelectCollection) {
                            onSelectCollection(col.id);
                          }
                        }}
                      >
                        <span>Kayıtları Gör ({col.count})</span>
                        <ArrowRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SEKME 2: KATEGORİLER */}
      {activeTab === 'categories' && (
        <div className="flex flex-col gap-6">
          {/* Yeni Kategori Ekleme Çubuğu */}
          <div className="settings-card flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-2">
              <Bookmark className="size-4 text-primary" />
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAddCategory();
                }}
                placeholder="Yeni kategori adı (örn. Teknoloji, Müzik, Bilim, Finans)…"
                className="flex-1 border-border/80 bg-background"
              />
            </div>
            <Button
              onClick={() => void handleAddCategory()}
              disabled={!newCategoryName.trim()}
              size="sm"
              className="gap-1.5 shrink-0"
            >
              <Plus className="size-4" /> Kategori Ekle
            </Button>
          </div>

          {/* Taşıma hataları burada görünür olur; gerekçe yutulmaz. */}
          {notice && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {notice}
            </p>
          )}

          {/* Kategoriler — girintili ağaç; aynı CategoryTree görsel dili. */}
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Kategoriler yükleniyor…</p>
          ) : flatCategories.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <Bookmark className="mx-auto mb-3 size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">Henüz bir kategori bulunamadı</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Geniş konu başlıklarını düzenlemek için yeni bir kategori ekleyin.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {flatCategories.map(({ node, depth }) => {
                const cat = categoryById.get(node.id);
                if (!cat) return null;
                const isEditing = editingItem?.kind === 'category' && editingItem.id === cat.id;

                return (
                  <div
                    key={cat.id}
                    className="settings-card flex items-center justify-between gap-3 p-3.5 transition hover:border-primary/40"
                    style={{ marginLeft: depth * 16 }}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <Bookmark className="size-3.5" />
                      </span>

                      {isEditing ? (
                        <div className="flex flex-1 items-center gap-1">
                          <Input
                            value={editingItem.name}
                            onChange={(e) =>
                              setEditingItem({ ...editingItem, name: e.target.value })
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleSaveRename();
                              if (e.key === 'Escape') setEditingItem(null);
                            }}
                            autoFocus
                            className="h-7 text-sm"
                          />
                          <Button size="icon" variant="ghost" className="size-7" onClick={() => void handleSaveRename()}>
                            <Check className="size-3.5 text-primary" />
                          </Button>
                          <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditingItem(null)}>
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{cat.name}</p>
                          <p className="text-2xs text-muted-foreground">{cat.count} kayıt</p>
                        </div>
                      )}
                    </div>

                    {!isEditing && (
                      <div className="flex shrink-0 items-center gap-1">
                        {onSelectCategory && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => onSelectCategory(cat.id)}
                          >
                            Gör
                          </Button>
                        )}
                        <Popover
                          open={moveTargetId === cat.id}
                          onOpenChange={(open) => {
                            setMoveTargetId(open ? cat.id : null);
                            if (!open) setMoveSearch('');
                          }}
                        >
                          <PopoverTrigger
                            render={
                              <Button
                                size="icon"
                                variant="ghost"
                                className="size-7 text-muted-foreground hover:text-foreground"
                                title="Taşı"
                              />
                            }
                          >
                            <Move className="size-3" />
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-0">
                            <PopoverTitle>Kategoriyi taşı</PopoverTitle>
                            <div className="p-1.5">
                              <Input
                                value={moveSearch}
                                onChange={(e) => setMoveSearch(e.target.value)}
                                placeholder="Yeni üst ara…"
                                className="h-7 text-xs"
                                autoFocus
                              />
                            </div>
                            <PopoverGroupLabel>Yeni üst</PopoverGroupLabel>
                            {/* Kapı geçersiz hedefi reddeder; gerekçe yukarıda görünür. */}
                            <div className="flex max-h-64 min-h-0 flex-col">
                              <CategoryTree
                                nodes={categoryTree}
                                selectedId={cat.parent_id ?? 'all'}
                                onSelect={(id) => void handleMoveCategory(cat.id, id === 'all' ? null : id)}
                                search={moveSearch}
                                emptyLabel="Kök (üst yok)"
                              />
                            </div>
                          </PopoverContent>
                        </Popover>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-muted-foreground hover:text-foreground"
                          onClick={() => setEditingItem({ kind: 'category', id: cat.id, name: cat.name })}
                        >
                          <Pencil className="size-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          onClick={() => setPendingDelete({ kind: 'category', id: cat.id })}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Toplu temizlik: taksonomiyi sıfırdan kurmak isteyenler için. */}
          <div className="flex justify-end border-t border-border pt-4">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              disabled={categories.length === 0 || purgeBusy}
              onClick={() => setConfirmPurge({ kind: 'categories' })}
            >
              <Trash2 className="size-3.5" />
              Tüm Kategorileri Sil
            </Button>
          </div>
        </div>
      )}

      {/* SEKME 3: ETİKETLER */}
      {activeTab === 'tags' && (
        <div className="flex flex-col gap-6">
          {/* Yeni Etiket Ekleme Çubuğu */}
          <div className="settings-card flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-2">
              <TagIcon className="size-4 text-primary" />
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAddTag();
                }}
                placeholder="Yeni etiket (örn. #react, #tutorial, #ai)…"
                className="flex-1 border-border/80 bg-background"
              />
            </div>
            <Button
              onClick={() => void handleAddTag()}
              disabled={!newTagName.trim()}
              size="sm"
              className="gap-1.5 shrink-0"
            >
              <Plus className="size-4" /> Etiket Ekle
            </Button>
          </div>

          {/* Etiketler Bulutu / Grid */}
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Etiketler yükleniyor…</p>
          ) : filteredTags.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <TagIcon className="mx-auto mb-3 size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">Henüz bir etiket bulunamadı</p>
              <p className="mt-1 text-xs text-muted-foreground">
                İçeriklerinizi ince ayrıntılarına göre sınıflandırmak için etiketler ekleyin.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2.5">
              {filteredTags.map((t) => {
                const isEditing = editingItem?.kind === 'tag' && editingItem.id === t.id;

                if (isEditing) {
                  return (
                    <div
                      key={t.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-primary/50 bg-card px-2 py-1 shadow-xs"
                    >
                      <Input
                        value={editingItem.name}
                        onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleSaveRename();
                          if (e.key === 'Escape') setEditingItem(null);
                        }}
                        autoFocus
                        className="h-6 w-32 text-xs"
                      />
                      <Button size="icon" variant="ghost" className="size-6" onClick={() => void handleSaveRename()}>
                        <Check className="size-3 text-primary" />
                      </Button>
                      <Button size="icon" variant="ghost" className="size-6" onClick={() => setEditingItem(null)}>
                        <X className="size-3" />
                      </Button>
                    </div>
                  );
                }

                return (
                  <div
                    key={t.id}
                    className="group inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm transition hover:border-primary/50 hover:bg-muted/40"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (onSelectTag) onSelectTag(t.id);
                      }}
                      className="font-medium text-foreground hover:text-primary transition-colors"
                      title="Arşivde bu etiketi filtrele"
                    >
                      {t.name}
                    </button>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-2xs font-mono text-muted-foreground">
                      {t.count}
                    </span>

                    <div className="hidden items-center gap-0.5 group-hover:inline-flex">
                      <button
                        type="button"
                        onClick={() => setEditingItem({ kind: 'tag', id: t.id, name: t.name })}
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                        title="Düzenle"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete({ kind: 'tag', id: t.id })}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                        title="Sil"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Toplu temizlik: taksonomiyi sıfırdan kurmak isteyenler için. */}
          <div className="flex justify-end border-t border-border pt-4">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              disabled={tags.length === 0 || purgeBusy}
              onClick={() => setConfirmPurge({ kind: 'tags' })}
            >
              <Trash2 className="size-3.5" />
              Tüm Etiketleri Sil
            </Button>
          </div>
        </div>
      )}

      {/* SİLME ONAY DİYALOĞU */}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={pendingDelete ? DELETE_CONFIRM_TEXT[pendingDelete.kind].title : ''}
        description={pendingDelete ? DELETE_CONFIRM_TEXT[pendingDelete.kind].description : ''}
        confirmLabel="Sil"
        tone="destructive"
        onConfirm={() => void handleConfirmDelete()}
      />

      {/* TAKSONOMİ BAKIMI */}
      <Dialog open={maintOpen} onOpenChange={setMaintOpen}>
        <DialogContent className="max-w-3xl w-[min(92vw,56rem)]">
          <DialogHeader>
            <DialogTitle>Taksonomi Bakımı</DialogTitle>
            <DialogDescription>
              Yinelenenleri birleştir, kullanılmayanları sil ve yakın-anlam önerilerini uygula.
              Her işlemden önce otomatik yedek alınır.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
            {(['tags', 'categories'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setMaintKind(k);
                  setSuggestions([]);
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  maintKind === k
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {k === 'tags' ? 'Etiketler' : 'Kategoriler'}
              </button>
            ))}
          </div>

          {/* Denetim listesi */}
          <div className="max-h-56 divide-y divide-border/70 overflow-y-auto rounded-lg border border-border">
            {maintList(maintKind).map((e) => (
              <div key={e.name} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="truncate">{e.name}</span>
                <span className="flex items-center gap-2">
                  {e.count === 0 && (
                    <Badge variant="outline" className="text-3xs text-muted-foreground">
                      kullanılmayan
                    </Badge>
                  )}
                  <span className="font-mono text-2xs text-muted-foreground" data-num>
                    {e.count}
                  </span>
                </span>
              </div>
            ))}
          </div>

          {/* Yinelenenler */}
          <div className="flex flex-col gap-1">
            <span className="text-2xs text-muted-foreground">
              Aynı ada düşen kayıtlar aşağıda gruplanır. Birleştirmede yalnız
              <strong> yazımı normalleşen </strong>
              yinelenenler taşınır; yakın-anlamlı ama farklı adlar (ör. "tasarruf" ↔ "tut tasarruf")
              için aşağıdaki <strong>Asistan önerilerini</strong> kullan ve her birini ayrı onayla.
            </span>
            {duplicateGroups(maintList(maintKind)).map((g) => (
              <div
                key={g.canonical}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <div className="flex min-w-0 flex-[1_1_16rem] flex-wrap items-center gap-1.5">
                  <span className="text-2xs text-muted-foreground">Korunacak:</span>
                  <Badge variant="secondary" className="font-medium">
                    {g.canonical}
                  </Badge>
                  <span className="text-muted-foreground">←</span>
                  <span className="text-2xs text-muted-foreground">Silinecek:</span>
                  {g.duplicates.map((d) => (
                    <Badge key={d} variant="outline" className="text-3xs text-muted-foreground line-through">
                      {d}
                    </Badge>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto shrink-0"
                  onClick={() =>
                    setConfirmMerge({ kind: maintKind, canonical: g.canonical, duplicates: g.duplicates })
                  }
                >
                  Birleştir
                </Button>
              </div>
            ))}
          </div>

          {/* Yakın-anlam önerileri (AI) */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Yakın-anlam önerileri (Asistan)</span>
              <Button variant="outline" size="sm" onClick={() => void runSuggest()} disabled={suggestBusy}>
                {suggestBusy ? 'Öneriliyor…' : 'Öneri Al'}
              </Button>
            </div>
            {suggestions.map((grp, idx) => (
              <div
                key={idx}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <div className="flex min-w-0 flex-[1_1_16rem] flex-wrap items-center gap-1.5">
                  <span className="text-2xs text-muted-foreground">Korunacak:</span>
                  <Badge variant="secondary" className="font-medium">
                    {grp[0]}
                  </Badge>
                  <span className="text-muted-foreground">←</span>
                  <span className="text-2xs text-muted-foreground">Silinecek:</span>
                  {grp.slice(1).map((d) => (
                    <Badge key={d} variant="outline" className="text-3xs text-muted-foreground line-through">
                      {d}
                    </Badge>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto shrink-0"
                  onClick={() =>
                    setConfirmMerge({ kind: maintKind, canonical: grp[0], duplicates: grp.slice(1) })
                  }
                >
                  Birleştir
                </Button>
              </div>
            ))}
          </div>

          {/* Hiyerarşi: düz taksonomiyi en fazla 5 seviyeli düzene indirgemek (tek seferlik) */}
          {maintKind === 'categories' && (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Hiyerarşi (Asistan) — kategorileri üst/alt olarak düzenler
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void runRestructSuggest()}
                  disabled={restructBusy || categories.length < 2}
                >
                  {restructBusy ? 'Planlanıyor…' : 'Plan Oluştur'}
                </Button>
              </div>

              {notice && <p className="text-2xs text-muted-foreground">{notice}</p>}

              {restructPlan && (
                <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2">
                  <p className="text-2xs text-muted-foreground">
                    Önizleme — hiçbir şey değişmedi. Onaylamadan uygulanmaz.
                  </p>

                  {restructPlan.merges.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {restructPlan.merges.map((m, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-1.5 text-sm">
                          <Badge variant="secondary" className="font-medium">
                            {m.canonical}
                          </Badge>
                          <span className="text-2xs text-muted-foreground">←</span>
                          {m.duplicates.map((d) => (
                            <Badge key={d} variant="outline" className="text-3xs line-through">
                              {d}
                            </Badge>
                          ))}
                        </li>
                      ))}
                    </ul>
                  )}

                  {restructPlan.moves
                    .filter((m) => m.path.length > 0)
                    .map((m, i) => (
                      <p key={i} className="text-sm">
                        <span className="text-muted-foreground line-through">{m.from}</span>
                        <span className="mx-1.5 text-muted-foreground">→</span>
                        <Badge variant="secondary" className="font-medium">
                          {m.path.join(' › ')}
                        </Badge>
                      </p>
                    ))}

                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setConfirmRestruct(true)} disabled={restructBusy}>
                      Planı Uygula
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setRestructPlan(null)}>
                      Vazgeç
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="justify-between">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const unused = (maintKind === 'tags' ? tags : categories)
                  .filter((x) => x.count === 0)
                  .map((x) => x.id);
                if (unused.length > 0) setConfirmUnused({ kind: maintKind, ids: unused });
              }}
            >
              Kullanılmayanları Sil
            </Button>
            <Button variant="outline" onClick={() => setMaintOpen(false)}>
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmMerge !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmMerge(null);
        }}
        title={
          confirmMerge && maintKind === 'tags'
            ? 'Etiketler birleştirilsin mi?'
            : 'Kategoriler birleştirilsin mi?'
        }
        description={
          confirmMerge ? (
            <span className="flex flex-col gap-1">
              <span>
                <strong>{confirmMerge.duplicates.join(', ')}</strong> öğesindeki tüm kayıtlar{' '}
                <strong>{confirmMerge.canonical}</strong> adına taşınacak.
              </span>
              <span className="text-muted-foreground">
                Korunacak: {confirmMerge.canonical} · Silinecek: {confirmMerge.duplicates.join(', ')}.
                Önce otomatik yedek alınır.
              </span>
            </span>
          ) : (
            ''
          )
        }
        confirmLabel={`"${confirmMerge?.canonical ?? ''}" adında birleştir`}
        tone="destructive"
        onConfirm={() => void runMerge()}
      />

      <ConfirmDialog
        open={confirmUnused !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmUnused(null);
        }}
        title="Kullanılmayanlar silinsin mi?"
        description={
          confirmUnused
            ? `${confirmUnused.ids.length} kullanılmayan öğe silinecek. Önce yedek alınır.`
            : ''
        }
        confirmLabel="Sil"
        tone="destructive"
        onConfirm={() => void runDeleteUnused()}
      />

      <ConfirmDialog
        open={confirmRestruct}
        onOpenChange={(open) => {
          if (!open) setConfirmRestruct(false);
        }}
        title="Taksonomi yeniden yapılandırılsın mı?"
        description={
          restructPlan
            ? `${restructPlan.merges.length} birleştirme ve ` +
              `${restructPlan.moves.filter((m) => m.path.length > 0).length} hiyerarşi ataması uygulanacak. ` +
              'İşlem geri alınamaz; önce yedek alınır.'
            : ''
        }
        confirmLabel="Uygula"
        tone="destructive"
        onConfirm={() => void runRestructApply()}
      />

      <ConfirmDialog
        open={confirmPurge !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmPurge(null);
        }}
        title={
          confirmPurge
            ? confirmPurge.kind === 'categories'
              ? 'Tüm kategoriler silinsin mi?'
              : 'Tüm etiketler silinsin mi?'
            : ''
        }
        description={confirmPurge ? purgeConfirmText(confirmPurge.kind, purgePreview(confirmPurge.kind)) : ''}
        confirmLabel="Yine de Sil"
        tone="destructive"
        onConfirm={() => void runPurge()}
      />
    </PageSurface>
  );
}
