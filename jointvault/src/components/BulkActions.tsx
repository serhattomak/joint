import { useEffect, useState } from 'react';
import { BookOpen, FolderInput, Shapes, Sparkles, Tags, Trash2, X } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
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
import { Progress } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { TagPicker } from '@/components/TagPicker';
import { batchCategorizeItems } from '@/lib/ai';
import { batchScrapeItems } from '@/lib/scraper';
import {
  createCollection,
  getCategoriesForItem,
  getOrCreateCategory,
  getOrCreateTag,
  getTagsForItem,
  listCategories,
  listCollections,
  listItems,
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiProgress, setAiProgress] = useState<{ current: number; total: number; title: string } | null>(null);
  const [aiAutoApply, setAiAutoApply] = useState(true);
  const [aiFinished, setAiFinished] = useState<{ processed: number; applied: number } | null>(null);
  const [scrapeOpen, setScrapeOpen] = useState(false);
  const [scrapeProgress, setScrapeProgress] = useState<{ current: number; total: number; title: string } | null>(null);
  const [scrapeFinished, setScrapeFinished] = useState<{ success: number; errors: number } | null>(null);
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [catNames, setCatNames] = useState<string[]>([]);
  const [collectionId, setCollectionId] = useState('');
  const [newCollection, setNewCollection] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [busy, setBusy] = useState(false);

  const handleBatchScrape = async (): Promise<void> => {
    setBusy(true);
    setScrapeProgress(null);
    setScrapeFinished(null);
    try {
      const allItems = await listItems();
      const targetItems = allItems.filter((it) => ids.includes(it.id));
      const res = await batchScrapeItems(targetItems, (current, total, item) => {
        setScrapeProgress({ current, total, title: item?.title || item?.url || 'Öğe' });
      });
      setScrapeFinished({ success: res.successCount, errors: res.errorCount });
      onDone();
    } catch (err) {
      console.error('[BulkActions] Toplu kazıma hatası:', err);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (tagOpen || moveOpen) void listCollections().then(setCollections);
  }, [tagOpen, moveOpen]);

  if (ids.length === 0) return null;

  const runDelete = async (): Promise<void> => {
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

  const handleAiBatch = async (): Promise<void> => {
    setBusy(true);
    setAiProgress(null);
    setAiFinished(null);
    try {
      const allItems = await listItems();
      const targetItems = allItems.filter((it) => ids.includes(it.id));
      const res = await batchCategorizeItems(targetItems, {
        forceAutoApply: aiAutoApply,
        onProgress: (current, total, title) => {
          setAiProgress({ current, total, title });
        },
      });
      setAiFinished(res);
      onDone();
    } catch (err) {
      console.error('[BulkActions] AI Toplu İşlem hatası:', err);
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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setAiOpen(true);
            setAiFinished(null);
            setAiProgress(null);
          }}
          disabled={busy}
          className="gap-1 text-primary hover:text-primary"
        >
          <Sparkles className="size-4" /> AI ile Düzenle
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setScrapeOpen(true);
            setScrapeFinished(null);
            setScrapeProgress(null);
          }}
          disabled={busy}
          className="gap-1 text-emerald-500 hover:text-emerald-400"
        >
          <BookOpen className="size-4" /> İçerikleri Çek (Scrape)
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setTagOpen(true)} disabled={busy}>
          <Tags /> Etiket
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setCatOpen(true)} disabled={busy}>
          <Shapes /> Kategori
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setMoveOpen(true)} disabled={busy}>
          <FolderInput /> Taşı
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)} disabled={busy}>
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
          <Select
            label="Koleksiyon"
            value={collectionId || 'none'}
            onValueChange={(v) => setCollectionId(v === 'none' ? '' : v)}
            options={[
              { value: 'none', label: 'Koleksiyon yok' },
              ...collections.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
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

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`${ids.length} öğe silinsin mi?`}
        description="Kayıtlar arşivden çıkar. İndirilen dosyalar diskte kalır."
        confirmLabel={`${ids.length} öğeyi sil`}
        onConfirm={() => void runDelete()}
      />

      <Dialog open={aiOpen} onOpenChange={(open) => !busy && setAiOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-primary" />
              AI ile Toplu Kategorizasyon & Etiketleme
            </DialogTitle>
            <DialogDescription>
              {ids.length} seçili kayıt yerel Qwen 2.5 modeliyle taranarak başlık, not ve transkriptlerine göre otomatik sınıflandırılacaktır.
            </DialogDescription>
          </DialogHeader>

          {!aiProgress && !aiFinished && (
            <div className="flex flex-col gap-3 py-2 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={aiAutoApply}
                  onChange={(e) => setAiAutoApply(e.target.checked)}
                  className="size-4 accent-primary"
                />
                <span>Önerilen kategori ve etiketleri doğrudan kaydet ve uygula</span>
              </label>
              <p className="text-xs text-muted-foreground">
                Öncelik mevcut kategorileriniz ve etiketlerinizdedir. Gerektiğinde yeni ve sade etiketler türetilir.
              </p>
            </div>
          )}

          {aiProgress && (
            <div className="flex flex-col gap-2 py-3">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="truncate pr-2 font-medium text-foreground">{aiProgress.title}</span>
                <span>{aiProgress.current} / {aiProgress.total}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.round((aiProgress.current / aiProgress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {aiFinished && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
              ✓ {aiFinished.processed} öğe analiz edildi, {aiFinished.applied} öğeye kategoriler ve etiketler başarıyla uygulandı!
            </div>
          )}

          <DialogFooter>
            {aiFinished ? (
              <Button onClick={() => setAiOpen(false)}>Tamamla</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setAiOpen(false)} disabled={busy}>
                  Vazgeç
                </Button>
                <Button onClick={() => void handleAiBatch()} disabled={busy}>
                  {busy ? 'İşleniyor…' : 'Analizi Başlat'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toplu İçerik Kazıma (Scraping) Dialogu */}
      <Dialog open={scrapeOpen} onOpenChange={setScrapeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Web İçeriklerini Toplu Kazı</DialogTitle>
            <DialogDescription>
              Seçili {ids.length} kaydın web sayfalarına gidilerek makale metinleri, başlıklar, görseller ve videolar kazınacak ve tam metin aramaya indekslenecek.
            </DialogDescription>
          </DialogHeader>

          {scrapeProgress && (
            <div className="flex flex-col gap-2 py-3">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-foreground truncate max-w-[280px]">
                  {scrapeProgress.title}
                </span>
                <span className="text-muted-foreground font-mono">
                  {scrapeProgress.current + 1} / {scrapeProgress.total}
                </span>
              </div>
              <Progress value={((scrapeProgress.current + 1) / scrapeProgress.total) * 100} />
            </div>
          )}

          {scrapeFinished && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
              ✓ {scrapeFinished.success} sayfa başarıyla kazındı ve FTS5 aramasına indekslendi!
              {scrapeFinished.errors > 0 && ` (${scrapeFinished.errors} hata oluştu)`}
            </div>
          )}

          <DialogFooter>
            {scrapeFinished ? (
              <Button onClick={() => setScrapeOpen(false)}>Tamamla</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setScrapeOpen(false)} disabled={busy}>
                  Vazgeç
                </Button>
                <Button onClick={() => void handleBatchScrape()} disabled={busy}>
                  {busy ? 'Kazınıyor…' : 'Kazımayı Başlat'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
