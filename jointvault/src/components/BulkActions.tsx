import { useEffect, useState } from 'react';
import { Tags, FolderInput, Shapes, Trash2, X } from 'lucide-react';
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
import { TagPicker } from '@/components/TagPicker';
import {
  createCollection,
  getCategoriesForItem,
  getOrCreateCategory,
  getOrCreateTag,
  getTagsForItem,
  listCategories,
  listCollections,
  listTags,
  removeItem,
  setCategoriesForItem,
  setTagsForItem,
  updateItem,
} from '@/lib/db/client';
import type { Collection } from '@/lib/db/types';

interface BulkActionsProps {  ids: string[];
  total: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
}

export function BulkActions({ ids, total, allSelected, onSelectAll, onClear, onDone }: BulkActionsProps) {
  const [tagOpen, setTagOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [catNames, setCatNames] = useState<string[]>([]);
  const [collectionId, setCollectionId] = useState('');
  const [newCollection, setNewCollection] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tagOpen || moveOpen) void listCollections().then(setCollections);
  }, [tagOpen, moveOpen]);

  if (ids.length === 0) return null;

  const handleDelete = async (): Promise<void> => {
    if (!window.confirm(`${ids.length} öğeyi silmek istiyor musun?`)) return;
    setBusy(true);
    try {
      for (const id of ids) await removeItem(id);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const handleAddTags = async (): Promise<void> => {
    if (!tagNames.length) return;
    setBusy(true);
    try {
      const tags = await Promise.all(tagNames.map((n) => getOrCreateTag(n)));
      for (const id of ids) {
        const existing = await getTagsForItem(id);
        const merged = [...new Set([...existing.map((t) => t.id), ...tags.map((t) => t.id)])];
        await setTagsForItem(id, merged);
      }
      setTagNames([]);
      setTagOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const handleMove = async (): Promise<void> => {
    setBusy(true);
    try {
      for (const id of ids) await updateItem(id, { collection_id: collectionId || null });
      setMoveOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const handleAddCategories = async (): Promise<void> => {
    if (!catNames.length) return;
    setBusy(true);
    try {
      const cats = await Promise.all(catNames.map((n) => getOrCreateCategory(n)));
      for (const id of ids) {
        const existing = await getCategoriesForItem(id);
        const merged = [...new Set([...existing.map((c) => c.id), ...cats.map((c) => c.id)])];
        await setCategoriesForItem(id, merged);
      }
      setCatNames([]);
      setCatOpen(false);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const handleCreateCollection = async (): Promise<void> => {
    const name = newCollection.trim();
    if (!name) return;
    setBusy(true);
    try {
      const created = await createCollection(name);
      setCollections((prev) => [...prev, created]);
      setCollectionId(created.id);
      setNewCollection('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="animate-rise fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card px-2 py-1.5 shadow-lift">
        <label className="flex cursor-pointer items-center gap-1.5 px-2 text-sm">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onSelectAll}
            className="size-4 accent-primary"
            aria-label="Tümünü seç"
          />
          <span className="font-medium whitespace-nowrap">
            {ids.length}/{total} seçili
          </span>
        </label>
        <span className="h-5 w-px bg-border" />
        <Button variant="ghost" size="sm" onClick={() => setTagOpen(true)} disabled={busy}>
          <Tags /> Etiket
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setCatOpen(true)} disabled={busy}>
          <Shapes /> Kategori
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setMoveOpen(true)} disabled={busy}>
          <FolderInput /> Taşı
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void handleDelete()} disabled={busy}>
          <Trash2 /> Sil
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Seçimi temizle">
          <X />
        </Button>
      </div>

      <Dialog open={tagOpen} onOpenChange={setTagOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Etiket ekle</DialogTitle>
            <DialogDescription>
              {ids.length} öğeye eklenecek — mevcutlardan seç veya yenisini yaz.
            </DialogDescription>
          </DialogHeader>
          <TagPicker selected={tagNames} onChange={setTagNames} loadNames={listTags} placeholder="Etiket seç veya yaz" />
          <DialogFooter>
            <Button onClick={() => void handleAddTags()} disabled={busy || !tagNames.length}>
              {busy ? 'Ekleniyor…' : 'Ekle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Kategori ekle</DialogTitle>
            <DialogDescription>
              {ids.length} öğeye eklenecek — mevcutlardan seç veya yenisini yaz.
            </DialogDescription>
          </DialogHeader>
          <TagPicker selected={catNames} onChange={setCatNames} loadNames={listCategories} placeholder="Kategori seç veya yaz" />
          <DialogFooter>
            <Button onClick={() => void handleAddCategories()} disabled={busy || !catNames.length}>
              {busy ? 'Ekleniyor…' : 'Ekle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Koleksiyona taşı</DialogTitle>
            <DialogDescription>{ids.length} öğe taşınacak.</DialogDescription>
          </DialogHeader>
          <select
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none"
          >
            <option value="">Koleksiyon yok</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Input
              value={newCollection}
              onChange={(e) => setNewCollection(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCreateCollection();
                }
              }}
              placeholder="Yeni koleksiyon adı…"
            />
            <Button variant="outline" onClick={() => void handleCreateCollection()} disabled={busy || !newCollection.trim()}>
              Oluştur
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => void handleMove()} disabled={busy}>
              {busy ? 'Taşınıyor…' : 'Taşı'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
