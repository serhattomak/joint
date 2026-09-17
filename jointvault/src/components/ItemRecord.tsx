import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  Music,
  Play,
  RotateCcw,
  Scissors,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  categorizeAndTagItem,
  indexItemChunks,
  suggestTags,
  summarizeText,
  type CategorizeAndTagResult,
} from '@/lib/ai';
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
import { Switch } from '@/components/ui/switch';
import { Input, Textarea } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { Stamp, PlatformRule } from '@/components/ui/stamp';
import { TagPicker } from '@/components/TagPicker';
import { ReaderView } from '@/components/ReaderView';
import { MediaPlayer } from '@/components/MediaPlayer';
import {
  getCategoriesForItem,
  getItem,
  getOrCreateCategory,
  getOrCreateTag,
  getTagsForItem,
  getArticleForItem,
  listCategories,
  listCollections,
  listTags,
  removeItem,
  setCategoriesForItem,
  setTagsForItem,
  toggleFavorite,
  updateItem,
} from '@/lib/db/client';
import type { Collection, Item, ItemArticle } from '@/lib/db/types';
import { QUALITY_OPTIONS, getDefaultQuality, useDownloadProgress, type DownloadQuality } from '@/lib/downloads';
import { openExternal } from '@/lib/external';
import { PLATFORM_META, type Platform } from '@/lib/platform';
import { scrapeAndStoreArticle } from '@/lib/scraper';

interface ItemRecordProps {
  item: Item;
  initialTab?: 'detail' | 'reader';
  onClose: () => void;
  onChanged: () => void;
  onPickVideo: (item: Item) => void;
  onConvert: (item: Item) => void;
  onAudio: (item: Item, quality: DownloadQuality) => void;
  onPlayMedia?: (item: Item, initialTime?: number) => void;
}

function DataRow({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={mono ? 'truncate font-mono text-3xs text-foreground/80 max-w-[220px]' : 'truncate text-xs text-foreground/90 max-w-[220px]'} title={String(value)}>
        {value}
      </span>
    </div>
  );
}

export function ItemRecord({
  item,
  initialTab = 'detail',
  onClose,
  onChanged,
  onPickVideo,
  onConvert,
  onAudio,
  onPlayMedia,
}: ItemRecordProps) {
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
  const [activeTab, setActiveTab] = useState<'detail' | 'reader'>(initialTab);
  const [article, setArticle] = useState<ItemArticle | null>(null);
  const [scrapeBusy, setScrapeBusy] = useState(false);

  // Canlı indirme durumu ve yerel dosya takibi
  const [downloadStatus, setDownloadStatus] = useState<Item['download_status']>(item.download_status);
  const [localPath, setLocalPath] = useState<string | null>(item.local_path ?? null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadSpeed, setDownloadSpeed] = useState<string | null>(null);
  const [downloadEta, setDownloadEta] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(item.download_error ?? null);
  const [deleteDiskFile, setDeleteDiskFile] = useState<boolean>(true);
  const embeddedTimeRef = useRef<number>(0);
  const [embeddedPaused, setEmbeddedPaused] = useState<boolean>(false);

  useEffect(() => {
    setTitle(item.title ?? '');
    setNote(item.note ?? '');
    setCollectionId(item.collection_id ?? '');
    setFavorite(item.favorite);
    setDownloadStatus(item.download_status);
    setLocalPath(item.local_path ?? null);
    setDownloadProgress(0);
    setDownloadSpeed(null);
    setDownloadEta(null);
    setDownloadError(item.download_error ?? null);
    setEmbeddedPaused(false);
    embeddedTimeRef.current = 0;
    setError(null);
    setTagSuggestions([]);
    setAiSuggestion(null);
    if (initialTab) setActiveTab(initialTab);
    void listCollections().then(setCollections);
    void getTagsForItem(item.id).then((ts) => setTags(ts.map((t) => t.name)));
    void getCategoriesForItem(item.id).then((cs) => setCategories(cs.map((c) => c.name)));
    void getArticleForItem(item.id).then(setArticle);
  }, [item, initialTab]);

  // Arka planda indirme olaylarını dinle — fişi kapatmadan video anında hazır olsun
  useDownloadProgress(
    useCallback(
      (e) => {
        if (e.itemId !== item.id) return;
        const pct = Math.round(e.percent);
        setDownloadProgress(pct);
        if (e.speed) setDownloadSpeed(e.speed);
        if (e.eta) setDownloadEta(e.eta);
        setDownloadStatus(pct >= 100 ? 'done' : 'active');

        if (pct >= 100) {
          // İndirme diske yazıldıktan hemen sonra veritabanındaki local_path'i çek
          const pollFreshItem = async () => {
            for (let i = 0; i < 10; i++) {
              await new Promise((r) => setTimeout(r, 400));
              const fresh = await getItem(item.id);
              if (fresh && fresh.download_status === 'done' && fresh.local_path) {
                setLocalPath(fresh.local_path);
                setDownloadStatus('done');
                setDownloadProgress(100);
                onChanged();
                break;
              }
            }
          };
          void pollFreshItem();
        }
      },
      [item.id, onChanged],
    ),
  );

  const handleScrape = async () => {
    setScrapeBusy(true);
    setError(null);
    try {
      const art = await scrapeAndStoreArticle(item.id, item.url);
      setArticle(art);
      if (art.title && (!title || title === item.url)) {
        setTitle(art.title);
      }
      onChanged();
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Sayfa içeriği çekilemedi.');
    } finally {
      setScrapeBusy(false);
    }
  };

  const handleAiSummarize = async () => {
    setAiBusy(true);
    try {
      const textToSummarize = article?.content_text
        ? `Başlık: ${title}\nİçerik: ${article.content_text.slice(0, 4000)}`
        : `Başlık: ${title}\nNot: ${note}\nURL: ${item.url}`;
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
    try {
      if (deleteDiskFile) {
        if (localPath) {
          await invoke('delete_file', { path: localPath }).catch((err) => {
            console.warn('[delete_file] Yerel dosya silinemedi (zaten silinmiş olabilir):', err);
          });
        }
        if (item.converted_path) {
          await invoke('delete_file', { path: item.converted_path }).catch((err) => {
            console.warn('[delete_file] Dönüştürülen dosya silinemedi:', err);
          });
        }
      }
      await removeItem(item.id);
      onChanged();
      onClose();
    } catch (e) {
      console.error('[record:destroy]', e);
    }
  };

  const platform = PLATFORM_META[item.platform as Platform] ?? PLATFORM_META.other;

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[94vw] max-w-5xl h-[88vh] max-h-[88vh] sm:max-w-5xl p-0 flex flex-col overflow-hidden bg-card text-card-foreground border border-border shadow-2xl rounded-xl z-50 focus:outline-none"
      >
        <DialogTitle className="sr-only">Kayıt Detayı - {item.title || item.url}</DialogTitle>
        <DialogDescription className="sr-only">Öğe fiş detayı ve okuyucu modu</DialogDescription>

        <PlatformRule platform={item.platform} />

        {/* Üst Başlık & Sekme Çubuğu */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/90 px-5 backdrop-blur-xs">
          {/* Sol: Platform ve Dış Bağlantı */}
          <div className="flex min-w-0 max-w-[40%] items-center gap-2.5">
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/80 bg-muted/60 px-2.5 py-0.5 text-xs font-semibold">
              <span className={`size-2 rounded-full ${platform.dot}`} />
              <span>{platform.label}</span>
            </span>
            <button
              type="button"
              onClick={() => void openExternal(item.url)}
              className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground transition-colors hover:text-primary"
              title={`Tarayıcıda Aç: ${item.url}`}
            >
              <ExternalLink className="size-3.5 shrink-0" />
              <span className="truncate">{item.url}</span>
            </button>
          </div>

          {/* Orta: Okuyucu & Fiş Sekme Seçicisi */}
          <div className="flex items-center rounded-lg border border-border/60 bg-muted/60 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('reader')}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-1 text-xs font-medium transition-all ${
                activeTab === 'reader'
                  ? 'bg-background font-semibold text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <BookOpen className="size-3.5" />
              <span>Okuyucu Modu</span>
              {article ? (
                <span className="size-1.5 rounded-full bg-emerald-500" title="İçerik çekildi" />
              ) : (
                <span className="text-3xs text-muted-foreground/60">(çekilmedi)</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('detail')}
              className={`flex items-center gap-1.5 rounded-md px-3.5 py-1 text-xs font-medium transition-all ${
                activeTab === 'detail'
                  ? 'bg-background font-semibold text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileText className="size-3.5" />
              <span>Fiş ve Medya</span>
            </button>
          </div>

          {/* Sağ: Favori & Kapat */}
          <div className="flex items-center gap-1.5">
            <Button
              variant={favorite ? 'stamp' : 'ghost'}
              size="icon-sm"
              onClick={() => setFavorite(!favorite)}
              aria-label={favorite ? 'Favoriden çıkar' : 'Favoriye ekle'}
              title={favorite ? 'Favoriden çıkar' : 'Favoriye ekle'}
            >
              <Star className={`size-4 ${favorite ? 'fill-current' : ''}`} />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Kapat" title="Kapat">
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {/* Gövde Alanı */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {activeTab === 'reader' ? (
            <div className="mx-auto w-full max-w-3xl px-6 py-6">
              <ReaderView
                item={item}
                article={article}
                loading={scrapeBusy}
                onScrape={handleScrape}
              />
            </div>
          ) : (
            <div className="p-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                {/* Sol Sütun (7 col): Başlık, Notlar, AI Özetleme ve Taksonomi */}
                <div className="flex flex-col gap-4 lg:col-span-7">
                  {/* Başlık */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="rec-title" className="text-xs font-medium text-muted-foreground">
                      Başlık
                    </label>
                    <Input
                      id="rec-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Kayıt başlığı…"
                      className="h-10 text-base font-semibold"
                    />
                  </div>

                  {/* Notlar & Alıntılar */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="rec-note" className="text-xs font-medium text-muted-foreground">
                        Notlar & Alıntılar
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => void handleAiSummarize()}
                        disabled={aiBusy}
                        className="h-6 gap-1 px-2 text-3xs text-primary hover:bg-primary/10"
                      >
                        <Sparkles className="size-3" />
                        {aiBusy ? 'Özetleniyor…' : 'AI ile Özetle'}
                      </Button>
                    </div>
                    <Textarea
                      id="rec-note"
                      rows={4}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Bu fişle ilgili kişisel notlarınız veya alıntılar…"
                      className="text-sm"
                    />
                  </div>

                  {/* Yapay Zekâ Analizi & Akıllı Öneriler */}
                  <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                        <Sparkles className="size-3.5" />
                        <span>Yapay Zekâ Taksonomi Analizi</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={() => void handleAiCategorizeAndTag()}
                        disabled={aiBusy}
                        className="h-7 gap-1.5 border-primary/30 px-2.5 text-xs font-medium text-primary hover:bg-primary/10"
                      >
                        <Sparkles className="size-3" />
                        {aiBusy ? 'Analiz Ediliyor…' : 'AI ile Analiz Et'}
                      </Button>
                    </div>

                    {aiSuggestion && (
                      <div className="flex flex-col gap-2.5 border-t border-primary/20 pt-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-3xs text-muted-foreground">
                            Güven Skoru: %{Math.round((aiSuggestion.confidence || 0.9) * 100)}
                          </span>
                          <Button
                            variant="default"
                            size="sm"
                            className="h-6 gap-1 px-2.5 text-3xs font-medium"
                            onClick={handleApplyAllSuggestions}
                          >
                            Tümünü Uygula
                          </Button>
                        </div>

                        {aiSuggestion.summary && (
                          <div className="rounded border border-border/50 bg-background/70 p-2 text-xs leading-relaxed text-muted-foreground">
                            <span className="font-semibold text-foreground">Özet: </span>
                            {aiSuggestion.summary}
                          </div>
                        )}

                        {aiSuggestion.categories.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-3xs font-medium text-muted-foreground">Önerilen Kategori:</span>
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
                                      ? 'cursor-default border-emerald-500/40 bg-emerald-500/10 text-emerald-400 opacity-80'
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
                            <span className="text-3xs font-medium text-muted-foreground">Önerilen Etiketler:</span>
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
                                      ? 'cursor-default border-emerald-500/40 bg-emerald-500/10 text-emerald-400 opacity-80'
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

                  {/* Koleksiyon & Kategori İkilisi */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Koleksiyon</label>
                      <Select
                        label="Koleksiyon"
                        className="w-full"
                        value={collectionId || 'none'}
                        onValueChange={(v) => setCollectionId(v === 'none' ? '' : v)}
                        options={[
                          { value: 'none', label: 'Koleksiyon yok' },
                          ...collections.map((c) => ({ value: c.id, label: c.name })),
                        ]}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">Kategoriler</label>
                      <TagPicker
                        selected={categories}
                        onChange={setCategories}
                        loadNames={listCategories}
                        placeholder="Kategori seç veya yaz…"
                      />
                    </div>
                  </div>

                  {/* Etiketler */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-muted-foreground">Etiketler</label>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => void handleAiSuggestTags()}
                        disabled={aiBusy}
                        className="h-6 gap-1 px-1.5 text-3xs text-primary"
                      >
                        <Sparkles className="size-3" />
                        {aiBusy ? 'Öneriliyor…' : 'Etiket Öner'}
                      </Button>
                    </div>
                    {tagSuggestions.length > 0 && (
                      <div className="mb-1 flex flex-wrap items-center gap-1">
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
                          >
                            + {st}
                          </button>
                        ))}
                      </div>
                    )}
                    <TagPicker
                      selected={tags}
                      onChange={setTags}
                      loadNames={listTags}
                      placeholder="Etiket seç veya yaz…"
                    />
                  </div>
                </div>

                {/* Sağ Sütun (5 col): Medya Önizleme, İndirme ve Dosya İşlemleri, Künye */}
                <div className="flex flex-col gap-4 lg:col-span-5">
                  {/* Medya Önizleme & İndirme Kartı */}
                  <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
                    <div className="relative aspect-video w-full overflow-hidden border-b border-border bg-muted/40">
                      {downloadStatus === 'done' && localPath ? (
                        <MediaPlayer
                          src={localPath}
                          poster={item.thumbnail}
                          title={title || item.title || item.url}
                          embedded
                          paused={embeddedPaused}
                          onTimeProgress={(t) => {
                            embeddedTimeRef.current = t;
                          }}
                          onExpand={(t) => {
                            setEmbeddedPaused(true);
                            onPlayMedia?.({ ...item, local_path: localPath, download_status: 'done' }, t);
                          }}
                          className="size-full"
                        />
                      ) : downloadStatus === 'active' || downloadStatus === 'queued' ? (
                        <div className="relative size-full overflow-hidden">
                          {item.thumbnail ? (
                            <img src={item.thumbnail} alt="" className="size-full object-cover opacity-40 blur-xs" />
                          ) : (
                            <div className="size-full bg-neutral-900" />
                          )}
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/60 p-4 text-center text-white backdrop-blur-xs">
                            <Loader2 className="size-8 animate-spin text-primary" />
                            <div className="flex flex-col gap-0.5">
                              <span className="text-sm font-semibold">
                                {downloadStatus === 'queued' ? 'İndirme Kuyrukta…' : `%${downloadProgress} İndiriliyor…`}
                              </span>
                              {(downloadSpeed || downloadEta) && (
                                <span className="font-mono text-2xs text-white/80">
                                  {downloadSpeed}{downloadSpeed && downloadEta ? ' · ' : ''}{downloadEta ? `kalan ${downloadEta}` : ''}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : item.thumbnail ? (
                        <img
                          src={item.thumbnail}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full flex-col items-center justify-center gap-1 p-4 text-center text-muted-foreground">
                          <span className="font-mono text-2xs uppercase tracking-wider">Kapak Görseli Yok</span>
                        </div>
                      )}
                    </div>

                    {/* İndirme & Medya İşlemleri Paneli */}
                    <div className="flex flex-col gap-3 p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">Medya Durumu</span>
                        <Stamp
                          state={
                            downloadStatus === 'done'
                              ? 'local'
                              : downloadStatus === 'error'
                                ? 'error'
                                : downloadStatus === 'active'
                                  ? 'active'
                                  : downloadStatus === 'queued'
                                    ? 'queued'
                                    : 'none'
                          }
                        />
                      </div>

                      {downloadStatus === 'done' && localPath ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => {
                                if (onPlayMedia) {
                                  setEmbeddedPaused(true);
                                  onPlayMedia(
                                    { ...item, local_path: localPath, download_status: 'done' },
                                    embeddedTimeRef.current,
                                  );
                                } else {
                                  void openPath(localPath);
                                }
                              }}
                              className="flex-1 gap-1.5 text-xs font-medium"
                            >
                              <Play className="size-3.5" />
                              Sinema Modunda Oynat
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void revealItemInDir(localPath)}
                              className="gap-1.5 text-xs"
                              title="Dosyayı klasörde göster"
                            >
                              <FolderOpen className="size-3.5" />
                              Klasörde Göster
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onConvert({ ...item, local_path: localPath })}
                              className="gap-1.5 text-xs"
                              title="Dönüştür veya kırp"
                            >
                              <Scissors className="size-3.5" />
                              Dönüştür
                            </Button>
                          </div>
                        </div>
                      ) : downloadStatus === 'active' || downloadStatus === 'queued' ? (
                        <div className="flex flex-col gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-foreground">
                              {downloadStatus === 'queued' ? 'İndirme Hazırlanıyor…' : `%${downloadProgress} İndiriliyor`}
                            </span>
                            <span className="font-mono text-3xs text-muted-foreground">
                              {downloadSpeed || ''} {downloadSpeed && downloadEta ? '· ' : ''} {downloadEta ? `kalan ${downloadEta}` : ''}
                            </span>
                          </div>
                          <Progress value={downloadProgress} className="h-2" />
                          <p className="text-3xs leading-relaxed text-muted-foreground">
                            İndirme bittiğinde video otomatik olarak burada hazır olacak ve hemen oynatılabilecektir. Fişi kapatmanıza gerek yoktur.
                          </p>
                        </div>
                      ) : downloadStatus === 'error' ? (
                        <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                          <div className="flex items-center justify-between text-xs text-destructive">
                            <span className="font-medium">İndirme Başarısız Oldu</span>
                          </div>
                          {downloadError && <p className="line-clamp-2 text-3xs text-destructive/80">{downloadError}</p>}
                          <div className="flex gap-2 pt-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setDownloadStatus('queued');
                                setDownloadProgress(0);
                                setDownloadError(null);
                                onPickVideo(item);
                              }}
                              className="flex-1 gap-1.5 text-xs"
                            >
                              <RotateCcw className="size-3.5" /> Tekrar Dene
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Hedef Kalite:</span>
                            <Select
                              label="Kalite"
                              className="h-8 w-36 text-xs"
                              value={quality}
                              onValueChange={(v) => setQuality(v as DownloadQuality)}
                              options={QUALITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => onPickVideo(item)}
                              className="flex-1 gap-1.5 text-xs font-medium"
                            >
                              <Download className="size-3.5" />
                              Video İndir…
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setDownloadStatus('queued');
                                setDownloadProgress(0);
                                setDownloadError(null);
                                onAudio(item, quality);
                              }}
                              className="gap-1.5 text-xs font-medium"
                            >
                              <Music className="size-3.5" />
                              Yalnızca Ses
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Teknik Künye */}
                  <div className="flex flex-col gap-1 rounded-lg border border-border bg-card/60 p-4 text-xs">
                    <span className="border-b border-border/50 pb-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Kayıt Künyesi
                    </span>
                    <DataRow label="Platform" value={platform.label} mono={false} />
                    <DataRow label="Yerel Dosya" value={localPath ?? '—'} />
                    {item.converted_path && <DataRow label="Dönüştürülen" value={item.converted_path} />}
                    <DataRow label="Kayıt Tarihi" value={new Date(item.created_at).toLocaleString('tr-TR')} mono={false} />
                    <DataRow label="Son Değişiklik" value={new Date(item.updated_at).toLocaleString('tr-TR')} mono={false} />
                    <DataRow label="Kayıt No (ID)" value={item.id} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && <div className="mx-6 mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{error}</div>}
        </div>

        {/* Alt Çubuk */}
        <footer className="flex h-14 shrink-0 items-center justify-between border-t border-border bg-card/80 px-6 backdrop-blur-xs">
          <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="size-3.5" />
            <span>Sil</span>
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onClose}>
              Kapat
            </Button>
            <Button variant="stamp" disabled={!dirty || busy} onClick={() => void save()}>
              {busy ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </div>
        </footer>

        {localPath ? (
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent className="max-w-md gap-4 p-6">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base font-semibold text-destructive">
                  <Trash2 className="size-5" />
                  Bu Kaydı Sil
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  "{item.title || item.url}" arşiv kaydını ve indirme durumunu yönetin.
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-3 py-1">
                <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-xs">
                  <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                    İndirilen Dosya
                  </span>
                  <p className="font-mono text-2xs break-all text-foreground select-all">
                    {localPath}
                  </p>
                  {item.converted_path && (
                    <>
                      <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground block mt-2 mb-1">
                        Dönüştürülen Dosya
                      </span>
                      <p className="font-mono text-2xs break-all text-foreground select-all">
                        {item.converted_path}
                      </p>
                    </>
                  )}
                </div>

                <div
                  onClick={() => setDeleteDiskFile((v) => !v)}
                  className="flex items-start gap-3 rounded-lg border border-border/70 bg-card p-3 cursor-pointer hover:bg-muted/30 transition select-none"
                >
                  <Switch
                    checked={deleteDiskFile}
                    onCheckedChange={(checked) => setDeleteDiskFile(checked)}
                    className="mt-0.5 pointer-events-none"
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-semibold text-foreground">
                      İndirilen medya dosyasını da bilgisayardan sil
                    </span>
                    <span className="text-2xs text-muted-foreground leading-relaxed">
                      {deleteDiskFile
                        ? 'Video/ses dosyası kalıcı olarak diskten silinecektir.'
                        : 'Dosya bilgisayarınızda saklanır, yalnızca kasa kaydı silinir.'}
                    </span>
                  </div>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>
                  Vazgeç
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void destroy()}
                  className="gap-1.5"
                >
                  <Trash2 className="size-3.5" />
                  Kaydı Sil
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : (
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Bu kayıt silinsin mi?"
            description="Kayıt arşivden tamamen çıkarılacaktır."
            confirmLabel="Sil"
            tone="destructive"
            onConfirm={() => void destroy()}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
