import { useEffect, useState } from 'react';
import { Download, ExternalLink, Music, Scissors, Sparkles, Trash2, X } from 'lucide-react';
import {
  categorizeAndTagItem,
  indexItemChunks,
  suggestTags,
  summarizeText,
  type CategorizeAndTagResult,
} from '@/lib/ai';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, SettingRow } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Stamp, PlatformRule } from '@/components/ui/stamp';
import { Switch } from '@/components/ui/switch';
import { TagPicker } from '@/components/TagPicker';
import {
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
  toggleFavorite,
  updateItem,
} from '@/lib/db/client';
import type { Collection, Item } from '@/lib/db/types';
import { QUALITY_OPTIONS, getDefaultQuality, type DownloadQuality } from '@/lib/downloads';
import { openExternal } from '@/lib/external';
import { PLATFORM_META, type Platform } from '@/lib/platform';

/*
 * Fişin arkası — kaydın tamamı burada açılır. Modal değil: ızgara terk edilmez,
 * fiş açıkken de arşiv görünür kalır. Düzenleme de bu yüzeyde yaşar.
 */
interface ItemRecordProps {
  item: Item;
  onClose: () => void;
  onChanged: () => void;
  onPickVideo: (item: Item) => void;
  onConvert: (item: Item) => void;
  onAudio: (item: Item, quality: DownloadQuality) => void;
}

function DataRow({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'truncate font-mono text-xs' : 'truncate text-sm'} title={String(value)}>
        {value}
      </span>
    </div>
  );
}

export function ItemRecord({ item, onClose, onChanged, onPickVideo, onConvert, onAudio }: ItemRecordProps) {
  const [title, setTitle] = useState(item.title ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const [collectionId, setCollectionId] = useState(item.collection_id ?? '');
  const [favorite, setFavorite] = useState(item.favorite);
  const [tags, setTags] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [quality, setQuality] = useState<DownloadQuality>(() => getDefaultQuality());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [aiSuggestion, setAiSuggestion] = useState<CategorizeAndTagResult | null>(null);

  useEffect(() => {
    setTitle(item.title ?? '');
    setNote(item.note ?? '');
    setCollectionId(item.collection_id ?? '');
    setFavorite(item.favorite);
    setError(null);
    setTagSuggestions([]);
    setAiSuggestion(null);
    void listCollections().then(setCollections);
    void getTagsForItem(item.id).then((ts) => setTags(ts.map((t) => t.name)));
    void getCategoriesForItem(item.id).then((cs) => setCategories(cs.map((c) => c.name)));
  }, [item]);

  const handleAiSummarize = async () => {
    setAiBusy(true);
    try {
      const textToSummarize = `Başlık: ${title}\nNot: ${note}\nURL: ${item.url}`;
      const summary = await summarizeText(textToSummarize);
      if (summary) {
        setNote((prev) => (prev ? `${prev}\n\n[AI Özeti]: ${summary}` : summary));
      }
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Özet üretilemedi.');
    } finally {
      setAiBusy(false);
    }
  };

  const handleAiSuggestTags = async () => {
    setAiBusy(true);
    try {
      const allTags = (await listTags()).map((t) => t.name);
      const text = `Başlık: ${title}\nNot: ${note}\nPlatform: ${item.platform}`;
      const suggested = await suggestTags(text, allTags);
      setTagSuggestions(suggested.filter((s) => !tags.includes(s)));
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Etiket önerilemedi.');
    } finally {
      setAiBusy(false);
    }
  };

  const handleAiCategorizeAndTag = async () => {
    setAiBusy(true);
    setError(null);
    try {
      const res = await categorizeAndTagItem(item);
      setAiSuggestion(res);
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'AI analizi başarısız oldu.');
    } finally {
      setAiBusy(false);
    }
  };

  const handleApplyAllSuggestions = () => {
    if (!aiSuggestion) return;
    if (aiSuggestion.categories.length > 0) {
      setCategories((prev) => Array.from(new Set([...prev, ...aiSuggestion.categories])));
    }
    if (aiSuggestion.tags.length > 0) {
      setTags((prev) => Array.from(new Set([...prev, ...aiSuggestion.tags])));
    }
    if (aiSuggestion.summary && !note.includes(aiSuggestion.summary)) {
      setNote((prev) => (prev ? `${prev}\n\n[AI Özeti]: ${aiSuggestion.summary}` : aiSuggestion.summary));
    }
    setAiSuggestion(null);
  };

  const dirty =
    title.trim() !== (item.title ?? '') ||
    note.trim() !== (item.note ?? '') ||
    (collectionId || null) !== item.collection_id ||
    favorite !== item.favorite;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const saved = await updateItem(item.id, {
        title: title.trim() || null,
        note: note.trim() || null,
        collection_id: collectionId || null,
      });
      if (favorite !== saved.favorite) await toggleFavorite(item.id);
      const tagIds = await Promise.all(tags.map((name) => getOrCreateTag(name)));
      await setTagsForItem(item.id, tagIds.map((t) => t.id));
      const catIds = await Promise.all(categories.map((name) => getOrCreateCategory(name)));
      await setCategoriesForItem(item.id, catIds.map((c) => c.id));
      void indexItemChunks(saved, tags).catch(() => null);
      onChanged();
    } catch (e) {
      console.error('[record:save]', e);
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Kaydetme başarısız.');
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (): Promise<void> => {
    await removeItem(item.id);
    onChanged();
    onClose();
  };

  const platform = PLATFORM_META[item.platform as Platform] ?? PLATFORM_META.other;

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <h2 className="text-title">Fiş</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fişi kapat">
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <PlatformRule platform={item.platform} />
        <div className="record-band text-muted-foreground">
          <span>{platform.label}</span>
          <span className="ml-auto">{new Date(item.created_at).toLocaleDateString('tr-TR')}</span>
        </div>

        {item.thumbnail ? (
          <img src={item.thumbnail} alt="" className="h-40 w-full border-b border-border object-cover" />
        ) : (
          <div className="flex h-40 w-full items-center justify-center border-b border-border bg-muted font-mono text-2xs tracking-[0.06em] text-muted-foreground uppercase">
            önizleme yok
          </div>
        )}

        <div className="flex flex-col gap-4 p-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h3 className="text-title pr-1 leading-snug break-words">{item.title || item.url}</h3>
            <div className="flex min-w-0 items-center gap-2">
              <p data-num className="min-w-0 flex-1 truncate text-micro text-muted-foreground" title={item.url}>
                {item.url}
              </p>
              <Button variant="outline" size="sm" onClick={() => void openExternal(item.url)}>
                <ExternalLink /> Aç
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Stamp
              state={favorite ? 'favorite' : 'none'}
              title={favorite ? 'Favoride' : 'Favoride değil'}
            >
              {favorite ? 'favori' : 'favori değil'}
            </Stamp>
            <Stamp
              state={
                item.download_status === 'done'
                  ? 'local'
                  : item.download_status === 'error'
                    ? 'error'
                    : item.download_status === 'active'
                      ? 'active'
                      : item.download_status === 'queued'
                        ? 'queued'
                        : 'none'
              }
            />
          </div>

          <FieldGroup title="Kayıt">
            <Field label="Başlık" htmlFor="rec-title" className="py-2">
              <Input id="rec-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Başlık" />
            </Field>
            <div className="flex items-center justify-between pt-2 pb-0.5">
              <span className="text-micro font-medium text-foreground">Not</span>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => void handleAiSummarize()}
                disabled={aiBusy}
                className="h-6 gap-1 px-1.5 text-3xs text-primary"
              >
                <Sparkles className="size-3" /> {aiBusy ? 'Özetleniyor…' : 'AI ile Özetle'}
              </Button>
            </div>
            <Textarea
              id="rec-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Bu fişle ilgili not"
            />
            <SettingRow label="Koleksiyon" htmlFor="rec-collection">
              <Select
                label="Koleksiyon"
                className="w-44"
                value={collectionId || 'none'}
                onValueChange={(v) => setCollectionId(v === 'none' ? '' : v)}
                options={[
                  { value: 'none', label: 'Koleksiyon yok' },
                  ...collections.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </SettingRow>
            <SettingRow label="Favori" htmlFor="rec-fav">
              <Switch checked={favorite} onCheckedChange={setFavorite} aria-labelledby="rec-fav" />
            </SettingRow>

            {/* AI Akıllı Analiz & Öneri Kartı */}
            <div className="pt-2">
              <div className="flex items-center justify-between pb-1.5">
                <span className="text-micro font-medium text-foreground">Yapay Zekâ Analizi</span>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => void handleAiCategorizeAndTag()}
                  disabled={aiBusy}
                  className="h-6 gap-1 px-2 text-3xs font-medium text-primary border-primary/30 hover:bg-primary/10"
                >
                  <Sparkles className="size-3" /> {aiBusy ? 'Analiz Ediliyor…' : 'AI ile Kategorize Et'}
                </Button>
              </div>

              {aiSuggestion && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <Sparkles className="size-3.5" />
                      <span>Önerilen Taksonomi</span>
                      <span className="text-3xs text-muted-foreground font-normal">
                        (%{Math.round((aiSuggestion.confidence || 0.9) * 100)} güven)
                      </span>
                    </div>
                    <Button
                      variant="default"
                      size="sm"
                      className="h-6 gap-1 px-2 text-3xs font-medium"
                      onClick={handleApplyAllSuggestions}
                    >
                      Tümünü Uygula
                    </Button>
                  </div>

                  {aiSuggestion.summary && (
                    <div className="text-xs text-muted-foreground bg-background/60 rounded p-2 border border-border/50">
                      <span className="font-medium text-foreground">Özet: </span>
                      {aiSuggestion.summary}
                    </div>
                  )}

                  {aiSuggestion.categories.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-3xs font-medium text-muted-foreground">Kategori:</span>
                      {aiSuggestion.categories.map((cat) => {
                        const isAdded = categories.includes(cat);
                        return (
                          <button
                            key={cat}
                            type="button"
                            disabled={isAdded}
                            onClick={() => {
                              if (!isAdded) setCategories((prev) => [...prev, cat]);
                            }}
                            className={`rounded-full border px-2 py-0.5 text-3xs font-medium transition ${
                              isAdded
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 opacity-80 cursor-default'
                                : 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
                            }`}
                          >
                            {isAdded ? '✓' : '+'} {cat}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {aiSuggestion.tags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-3xs font-medium text-muted-foreground">Etiketler:</span>
                      {aiSuggestion.tags.map((tg) => {
                        const isAdded = tags.includes(tg);
                        return (
                          <button
                            key={tg}
                            type="button"
                            disabled={isAdded}
                            onClick={() => {
                              if (!isAdded) setTags((prev) => [...prev, tg]);
                            }}
                            className={`rounded-full border px-2 py-0.5 text-3xs font-medium transition ${
                              isAdded
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 opacity-80 cursor-default'
                                : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20'
                            }`}
                          >
                            {isAdded ? '✓' : '+'} #{tg}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between pt-2 pb-0.5">
              <span className="text-micro font-medium text-foreground">Etiketler</span>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => void handleAiSuggestTags()}
                disabled={aiBusy}
                className="h-6 gap-1 px-1.5 text-3xs text-primary"
              >
                <Sparkles className="size-3" /> {aiBusy ? 'Öneriliyor…' : 'Etiket Öner'}
              </Button>
            </div>
            {tagSuggestions.length > 0 && (
              <div className="mb-1.5 flex flex-wrap items-center gap-1">
                <span className="text-3xs text-muted-foreground">Öneriler:</span>
                {tagSuggestions.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => {
                      setTags((prev) => [...prev, st]);
                      setTagSuggestions((prev) => prev.filter((x) => x !== st));
                    }}
                    className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-3xs font-medium text-primary transition hover:bg-primary/20"
                    title="Tıklayarak ekle"
                  >
                    + {st}
                  </button>
                ))}
              </div>
            )}
            <TagPicker selected={tags} onChange={setTags} loadNames={listTags} placeholder="Etiket seç veya yaz" />
            <Field label="Kategoriler" className="py-2">
              <TagPicker
                selected={categories}
                onChange={setCategories}
                loadNames={listCategories}
                placeholder="Kategori seç veya yaz (Teknoloji, Spor…)"
              />
            </Field>
          </FieldGroup>

          <FieldGroup title="İşlemler">
            <SettingRow label="Kalite" hint="Video ve ses indirmesinde kullanılır.">
              <Select
                label="Kalite"
                className="w-40"
                value={quality}
                onValueChange={(v) => setQuality(v as DownloadQuality)}
                options={QUALITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </SettingRow>
            <div className="flex flex-wrap gap-1.5 py-2">
              <Button variant="outline" size="sm" onClick={() => onPickVideo(item)}>
                <Download /> Video…
              </Button>
              <Button variant="outline" size="sm" onClick={() => onAudio(item, quality)}>
                <Music /> Ses
              </Button>
              {item.local_path && (
                <Button variant="outline" size="sm" onClick={() => onConvert(item)}>
                  <Scissors /> Dönüştür / kırp
                </Button>
              )}
            </div>
          </FieldGroup>

          <FieldGroup title="Dosya">
            <DataRow label="Kaynak" value={item.local_path ?? '—'} />
            <DataRow label="Dönüştürülmüş" value={item.converted_path ?? '—'} />
            <DataRow label="Güncellendi" value={new Date(item.updated_at).toLocaleString('tr-TR')} />
            <DataRow label="Kimlik" value={item.id} />
          </FieldGroup>

          {error && <p className="text-micro text-state-error">{error}</p>}
        </div>
      </div>

      <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-border px-4">
        <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
          <Trash2 /> Sil
        </Button>
        <span className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
          <Button variant="stamp" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </span>
      </footer>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Bu fiş silinsin mi?"
        description="Kayıt arşivden çıkar. İndirilen dosya diskte kalır."
        confirmLabel="Sil"
        onConfirm={() => void destroy()}
      />
    </div>
  );
}
