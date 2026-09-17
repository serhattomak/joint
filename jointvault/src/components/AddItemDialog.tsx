import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
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
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { TagPicker } from '@/components/TagPicker';
import {
  createItem,
  getCategoriesForItem,
  getOrCreateCategory,
  getOrCreateTag,
  getTagsForItem,
  listCategories,
  listCollections,
  listTags,
  setCategoriesForItem,
  setTagsForItem,
  toggleFavorite,
  updateItem,
} from '@/lib/db/client';
import type { Collection, Item } from '@/lib/db/types';
import { detectPlatform, fetchPreview } from '@/lib/platform';

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  initial?: Item | null;
  /** Yakala çubuğundan gelen ön dolgu: "Ayrıntılı" yolu. */
  initialUrl?: string;
}

export function AddItemDialog({
  open,
  onOpenChange,
  onSaved,
  initial = null,
  initialUrl = '',
}: AddItemDialogProps) {
  const editing = initial !== null;
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [favorite, setFavorite] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setUrl(initial?.url ?? initialUrl);
    setTitle(initial?.title ?? '');
    setNote(initial?.note ?? '');
    setThumbnail(initial?.thumbnail ?? null);
    setCollectionId(initial?.collection_id ?? '');
    setFavorite(initial?.favorite ?? false);
    setTags([]);
    setCategories([]);
    void listCollections().then(setCollections);
    if (initial) {
      void getTagsForItem(initial.id).then((ts) => setTags(ts.map((t) => t.name)));
      void getCategoriesForItem(initial.id).then((cs) => setCategories(cs.map((c) => c.name)));
    }
  }, [open, initial, initialUrl]);

  const platform = detectPlatform(url);

  const handleFetchPreview = async (): Promise<void> => {
    if (!url.trim()) return;
    setFetching(true);
    try {
      const preview = await fetchPreview(url.trim());
      if (!preview) {
        setError('Preview alınamadı — başlığı manuel gir.');
        return;
      }
      if (!title.trim() && preview.title) setTitle(preview.title);
      if (preview.thumbnail) setThumbnail(preview.thumbnail);
      setError(null);
    } finally {
      setFetching(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    const cleanUrl = url.trim();
    if (!cleanUrl) {
      setError('URL gerekli.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const tagNames = tags;
      const payload = {
        url: cleanUrl,
        title: title.trim() || null,
        note: note.trim() || null,
        platform,
        thumbnail,
        collection_id: collectionId || null,
      };
      const saved = editing && initial ? await updateItem(initial.id, payload) : await createItem(payload);
      if (favorite !== saved.favorite) await toggleFavorite(saved.id);
      const tagIds = await Promise.all(tagNames.map((name) => getOrCreateTag(name)));
      await setTagsForItem(saved.id, tagIds.map((t) => t.id));
      const catIds = await Promise.all(categories.map((name) => getOrCreateCategory(name)));
      await setCategoriesForItem(saved.id, catIds.map((c) => c.id));
      onSaved();
      onOpenChange(false);
    } catch (e) {
      // Tauri IPC string reject dönebilir (Error değil) — gerçek mesajı yutma.
      console.error('[save]', e);
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Kaydetme başarısız.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Öğeyi düzenle' : 'Yeni öğe ekle'}</DialogTitle>
          <DialogDescription>Link yapıştır, önizlemeyi çek, koleksiyon ve etiketle kaydet.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" />
            <Button variant="outline" onClick={() => void handleFetchPreview()} disabled={fetching || !url.trim()}>
              {fetching ? 'Çekiliyor…' : 'Önizle'}
            </Button>
          </div>
          {url.trim() && (
            <div className="flex items-center gap-2">
              <Badge variant="outline">{platform}</Badge>
              {thumbnail && <img src={thumbnail} alt="" className="h-10 w-10 rounded-xs border border-border object-cover" />}
            </div>
          )}
          <Field label="Başlık" htmlFor="add-title">
            <Input id="add-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Başlık" />
          </Field>
          <Field label="Not" htmlFor="add-note">
            <Textarea
              id="add-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opsiyonel"
            />
          </Field>
          <div className="flex items-end gap-2">
            <Field label="Koleksiyon" className="flex-1">
              <Select
                label="Koleksiyon"
                value={collectionId || 'none'}
                onValueChange={(v) => setCollectionId(v === 'none' ? '' : v)}
                options={[
                  { value: 'none', label: 'Koleksiyon yok' },
                  ...collections.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </Field>
            <Button
              variant={favorite ? 'stamp' : 'outline'}
              size="icon"
              onClick={() => setFavorite((f) => !f)}
              aria-label={favorite ? 'Favoriden çıkar' : 'Favoriye ekle'}
              aria-pressed={favorite}
            >
              <Star className={favorite ? 'fill-current' : ''} />
            </Button>
          </div>
          <Field label="Etiketler">
            <TagPicker selected={tags} onChange={setTags} loadNames={listTags} placeholder="Etiket seç veya yaz" />
          </Field>
          <Field label="Kategoriler">
            <TagPicker
              selected={categories}
              onChange={setCategories}
              loadNames={listCategories}
              placeholder="Kategori seç veya yaz (Teknoloji, Spor…)"
            />
          </Field>
          {error && <p className="text-micro text-state-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Vazgeç
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Kaydediliyor…' : editing ? 'Güncelle' : 'Kaydet'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
