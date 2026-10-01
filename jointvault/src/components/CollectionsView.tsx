import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  FolderKanban,
  Pencil,
  Plus,
  Search,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageSurface } from '@/components/ui/page-surface';
import {
  createCategory,
  createCollection,
  createTag,
  listCategoriesWithCounts,
  listCollectionsWithCounts,
  listTagsWithCounts,
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
    description: 'Koleksiyon içindeki gönderiler silinmez, yalnızca koleksiyonsuz kalır.',
  },
  category: {
    title: 'Kategori silinsin mi?',
    description: 'Kategori silindiğinde kayıtlar silinmez, yalnızca bu kategori ilişkisi kaldırılır.',
  },
  tag: {
    title: 'Etiket silinsin mi?',
    description: 'Etiket tüm fişlerden temizlenir; gönderileriniz silinmez.',
  },
};

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

  // Filtrelenmiş listeler
  const query = searchFilter.trim().toLowerCase();

  const filteredCollections = collections.filter((c) =>
    query ? c.name.toLowerCase().includes(query) : true,
  );
  const filteredCategories = categories.filter((c) =>
    query ? c.name.toLowerCase().includes(query) : true,
  );
  const filteredTags = tags.filter((t) =>
    query ? t.name.toLowerCase().includes(query) : true,
  );

  return (
    <PageSurface
      icon={<FolderKanban />}
      title="Koleksiyonlar & Düzenleme"
      description="Kasandaki tüm kayıtları koleksiyonlara ayır, kategori ve etiket ağacını düzenle."
      width="5xl"
      actions={
        onClose ? (
          <Button variant="outline" size="sm" onClick={onClose}>
            <ArrowLeft /> Kasaya Dön
          </Button>
        ) : undefined
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
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/40 p-4 shadow-xs sm:flex-row sm:items-center">
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
                    className="group flex flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-xs transition-all hover:border-primary/40 hover:shadow-md"
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
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/40 p-4 shadow-xs sm:flex-row sm:items-center">
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

          {/* Kategori Kartları Grid */}
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Kategoriler yükleniyor…</p>
          ) : filteredCategories.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center">
              <Bookmark className="mx-auto mb-3 size-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">Henüz bir kategori bulunamadı</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Geniş konu başlıklarını düzenlemek için yeni bir kategori ekleyin.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredCategories.map((cat) => {
                const isEditing = editingItem?.kind === 'category' && editingItem.id === cat.id;

                return (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3.5 shadow-xs transition hover:border-primary/40"
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
        </div>
      )}

      {/* SEKME 3: ETİKETLER */}
      {activeTab === 'tags' && (
        <div className="flex flex-col gap-6">
          {/* Yeni Etiket Ekleme Çubuğu */}
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/40 p-4 shadow-xs sm:flex-row sm:items-center">
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
                      title="Kasada bu etiketi filtrele"
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
    </PageSurface>
  );
}
