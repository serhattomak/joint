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
import { Input } from '@/components/ui/input';
import {
  createItem,
  getOrCreateTag,
  getTagsForItem,
  listCollections,
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
}

const parseTagInput = (raw: string): string[] => [...new Set(raw.split(',').map((t) => t.trim()).filter(Boolean))];

export function AddItemDialog({ open, onOpenChange, onSaved, initial = null }: AddItemDialogProps) {
  const editing = initial !== null;
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState('');
  const [tags, setTags] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setUrl(initial?.url ?? '');
    setTitle(initial?.title ?? '');
    setNote(initial?.note ?? '');
    setThumbnail(initial?.thumbnail ?? null);
    setCollectionId(initial?.collection_id ?? '');
    setFavorite(initial?.favorite ?? false);
    setTags('');
    void listCollections().then(setCollections);
    if (initial) void getTagsForItem(initial.id).then((ts) => setTags(ts.map((t) => t.name).join(', ')));
  }, [open, initial]);

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
      const tagNames = parseTagInput(tags);
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
      const ids = await Promise.all(tagNames.map((name) => getOrCreateTag(name)));
      await setTagsForItem(saved.id, ids.map((t) => t.id));
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
              <Badge variant="secondary">{platform}</Badge>
              {thumbnail && <img src={thumbnail} alt="" className="h-10 w-10 rounded object-cover" />}
            </div>
          )}
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Başlık" />
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Not (opsiyonel)" />
          <div className="flex gap-2">
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
            <Button
              variant={favorite ? 'default' : 'outline'}
              size="icon"
              onClick={() => setFavorite((f) => !f)}
              aria-label="Favori"
              aria-pressed={favorite}
            >
              <Star className={favorite ? 'fill-current' : ''} />
            </Button>
          </div>
          <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Etiketler (virgülle ayır)" />
          {error && <p className="text-sm text-destructive">{error}</p>}
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
