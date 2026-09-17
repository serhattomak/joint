import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  createCategory,
  createCollection,
  createTag,
  listCategories,
  listCollections,
  listTags,
  removeCategory,
  removeCollection,
  removeTag,
  updateCategory,
  updateCollection,
  updateTag,
} from '@/lib/db/client';
import type { Category, Collection, Tag } from '@/lib/db/types';

interface OrganizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

type OrganizeKind = 'collection' | 'tag' | 'category';

/* Onay metni tür başına sabittir: üç ayrı yaprak yerine tek yaprak, üç metin. */
const DELETE_COPY: Record<OrganizeKind, { title: string; description: string }> = {
  collection: {
    title: 'Koleksiyon silinsin mi?',
    description: 'Öğeler silinmez, koleksiyonsuz kalır.',
  },
  tag: {
    title: 'Etiket silinsin mi?',
    description: 'Etiket tüm fişlerden kaldırılır; fişler silinmez.',
  },
  category: {
    title: 'Kategori silinsin mi?',
    description: 'Öğeler silinmez, kategorisiz kalır.',
  },
};

export function OrganizeDialog({ open, onOpenChange, onChanged }: OrganizeDialogProps) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCollection, setNewCollection] = useState('');
  const [newTag, setNewTag] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [editingCollection, setEditingCollection] = useState<string | null>(null);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  /* Onay bekleyen silme: hangi tür, hangi kimlik. */
  const [pendingDelete, setPendingDelete] = useState<{ kind: OrganizeKind; id: string } | null>(null);

  const reload = async (): Promise<void> => {
    const [cols, ts, cs] = await Promise.all([listCollections(), listTags(), listCategories()]);
    setCollections(cols);
    setTags(ts);
    setCategories(cs);
  };

  useEffect(() => {
    if (open) {
      setNewCollection('');
      setNewTag('');
      setNewCategory('');
      setEditingCollection(null);
      setEditingTag(null);
      setEditingCategory(null);
      void reload();
    }
  }, [open]);

  const changed = async (): Promise<void> => {
    await reload();
    onChanged();
  };

  const handleCreateCollection = async (): Promise<void> => {
    const name = newCollection.trim();
    if (!name) return;
    await createCollection(name);
    setNewCollection('');
    await changed();
  };

  const handleRenameCollection = async (id: string): Promise<void> => {
    const name = editName.trim();
    if (!name) return;
    await updateCollection(id, name);
    setEditingCollection(null);
    await changed();
  };

  const requestDelete = (kind: OrganizeKind, id: string): void => setPendingDelete({ kind, id });

  const runDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    const { kind, id } = pendingDelete;
    if (kind === 'collection') await removeCollection(id);
    else if (kind === 'tag') await removeTag(id);
    else await removeCategory(id);
    await changed();
  };

  const handleCreateTag = async (): Promise<void> => {
    const name = newTag.trim();
    if (!name) return;
    await createTag(name);
    setNewTag('');
    await changed();
  };

  const handleRenameTag = async (id: string): Promise<void> => {
    const name = editName.trim();
    if (!name) return;
    await updateTag(id, name);
    setEditingTag(null);
    await changed();
  };

  const handleCreateCategory = async (): Promise<void> => {
    const name = newCategory.trim();
    if (!name) return;
    await createCategory(name);
    setNewCategory('');
    await changed();
  };

  const handleRenameCategory = async (id: string): Promise<void> => {
    const name = editName.trim();
    if (!name) return;
    await updateCategory(id, name);
    setEditingCategory(null);
    await changed();
  };

  const startRename = (kind: OrganizeKind, id: string, name: string): void => {
    setEditName(name);
    setEditingCollection(kind === 'collection' ? id : null);
    setEditingTag(kind === 'tag' ? id : null);
    setEditingCategory(kind === 'category' ? id : null);
  };

  /* Yaprak kapalıyken gövde render edilmez; varsayılan yalnızca tip içindir. */
  const deleteCopy = DELETE_COPY[pendingDelete?.kind ?? 'collection'];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Düzenle</DialogTitle>
            <DialogDescription>Koleksiyon, kategori ve etiketleri yönet.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h4 className="text-sm font-medium">Koleksiyonlar</h4>
            <div className="flex gap-2">
              <Input
                value={newCollection}
                onChange={(e) => setNewCollection(e.target.value)}
                placeholder="Yeni koleksiyon"
              />
              <Button variant="outline" size="icon" onClick={() => void handleCreateCollection()} aria-label="Koleksiyon ekle">
                <Plus />
              </Button>
            </div>
            <ul className="flex flex-col gap-1">
              {collections.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  {editingCollection === c.id ? (
                    <>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      <Button size="sm" onClick={() => void handleRenameCollection(c.id)}>
                        Kaydet
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 truncate text-sm">{c.name}</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => startRename('collection', c.id, c.name)}
                        aria-label="Yeniden adlandır"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => requestDelete('collection', c.id)}
                        aria-label="Sil"
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <h4 className="text-sm font-medium">Kategoriler</h4>
            <div className="flex gap-2">
              <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Yeni kategori" />
              <Button variant="outline" size="icon" onClick={() => void handleCreateCategory()} aria-label="Kategori ekle">
                <Plus />
              </Button>
            </div>
            <ul className="flex flex-col gap-1">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  {editingCategory === c.id ? (
                    <>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      <Button size="sm" onClick={() => void handleRenameCategory(c.id)}>
                        Kaydet
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 truncate text-sm">{c.name}</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => startRename('category', c.id, c.name)}
                        aria-label="Yeniden adlandır"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => requestDelete('category', c.id)}
                        aria-label="Sil"
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="flex flex-col gap-2">
            <h4 className="text-sm font-medium">Etiketler</h4>
            <div className="flex gap-2">
              <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Yeni etiket" />
              <Button variant="outline" size="icon" onClick={() => void handleCreateTag()} aria-label="Etiket ekle">
                <Plus />
              </Button>
            </div>
            <ul className="flex flex-col gap-1">
              {tags.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  {editingTag === t.id ? (
                    <>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      <Button size="sm" onClick={() => void handleRenameTag(t.id)}>
                        Kaydet
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 truncate text-sm">#{t.name}</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => startRename('tag', t.id, t.name)}
                        aria-label="Yeniden adlandır"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => requestDelete('tag', t.id)}
                        aria-label="Sil"
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        title={deleteCopy.title}
        description={deleteCopy.description}
        confirmLabel="Sil"
        onConfirm={() => void runDelete()}
      />
    </Dialog>
  );
}
