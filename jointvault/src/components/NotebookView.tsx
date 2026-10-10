import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, FileWarning, RefreshCw, Tag as TagIcon } from 'lucide-react';
import {
  getAllTagsByItem,
  listCategoriesWithCounts,
  listNotebookItems,
  getCategorySummary,
  saveCategorySummary,
  type CategoryWithCount,
  type NotebookItemRow,
} from '@/lib/db/client';
import type { Item, Tag } from '@/lib/db/types';
import { getAiStatus, isAiEnabled, summarizeCategory } from '@/lib/ai';
import { parseArticleImages } from '@/lib/scraper';
import { buildNumericSummary, extractLinks } from '@/lib/notebook';
import { openExternal } from '@/lib/external';
import { Button } from '@/components/ui/button';

/**
 * Defter: kategori başına okunabilir sayfa. Sol kategori listesi, sağ
 * kayıt blokları (tam metin + görsel + bağlantılar + etiketler) ve üstte
 * kalıcı LLM özeti. Veri DB'den canlı türetilir; kalıcı olan yalnız özet.
 */

const PAGE_SIZE = 48;

interface NotebookViewProps {
  refreshKey?: number;
  onOpenItem: (item: Item) => void;
  /** "Kategorilendir" yönlendirmesi: Ayarlar → AI sekmesi. */
  onOpenSettings?: () => void;
}

type SortDir = 'new' | 'old';

const trDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString('tr-TR');
  } catch {
    return iso;
  }
};

export function NotebookView({ refreshKey = 0, onOpenItem, onOpenSettings }: NotebookViewProps) {
  const [categories, setCategories] = useState<CategoryWithCount[] | null>(null);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<SortDir>('new');
  const [page, setPage] = useState(0);
  const [loadState, setLoadState] = useState<'loading' | 'empty' | 'error' | 'ok'>('loading');
  const [rows, setRows] = useState<NotebookItemRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [tagsByItem, setTagsByItem] = useState<Record<string, Tag[]>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadLists = useCallback(async (): Promise<void> => {
    setLoadState('loading');
    setError(null);
    try {
      const [cats, uncat] = await Promise.all([
        listCategoriesWithCounts(),
        listNotebookItems(null, 1, 0).then((r) => r.total),
      ]);
      setCategories(cats);
      setUncategorizedCount(uncat);
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Listeler yüklenemedi.');
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void reloadLists();
  }, [reloadLists, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const reloadPage = useCallback(async (): Promise<void> => {
    setLoadState('loading');
    setError(null);
    try {
      const [res, tags, summaryRow] = await Promise.all([
        listNotebookItems(selected, PAGE_SIZE, page * PAGE_SIZE, sort),
        getAllTagsByItem(),
        selected ? getCategorySummary(selected) : Promise.resolve(null),
      ]);
      setRows(res.rows);
      setTotal(res.total);
      setTagsByItem(tags);
      setSummary(summaryRow?.summary ?? null);
      setLoadState(res.rows.length === 0 ? 'empty' : 'ok');
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Sayfa yüklenemedi.');
      setLoadState('error');
    }
  }, [selected, page, sort]);

  useEffect(() => {
    void reloadPage();
  }, [reloadPage, refreshKey]);

  useEffect(() => {
    void getAiStatus()
      .then((s) => setAiReady(isAiEnabled(s)))
      .catch(() => setAiReady(false));
  }, []);

  // Seçim değişince sayfa 0'a döner.
  useEffect(() => {
    setPage(0);
  }, [selected, sort]);

  const buildSummary = async (): Promise<void> => {
    if (!selected || summaryBusy || !rows) return;
    setSummaryBusy(true);
    try {
      const texts = rows.flatMap((r) => (r.content_text && r.content_text.trim() ? [r.content_text] : []));
      if (texts.length === 0) {
        setSummary(null);
        return;
      }
      const name = categories?.find((c) => c.id === selected)?.name ?? 'Defter';
      const out = await summarizeCategory(name, texts);
      await saveCategorySummary(selected, out, 'qwen-notebook');
      const saved = await getCategorySummary(selected);
      setSummary(saved?.summary ?? out);
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Özet yazılamadı.');
    } finally {
      setSummaryBusy(false);
    }
  };

  const selectedName =
    selected === null ? 'Sınıflandırılmamış' : categories?.find((c) => c.id === selected)?.name ?? 'Defter';

  // AI kapalıyken sayfa özeti: LLM yerine deterministik sayısal özet (aynı yüzey).
  const numericSummary = useMemo(
    () => (aiReady === false && rows ? buildNumericSummary(rows) : null),
    [aiReady, rows],
  );

  const imagesMemo = useMemo(() => {
    // her satır için ilk 3 görsel + kalan sayısı
    if (!rows) return new Map<string, { first: string[]; more: number }>();
    const m = new Map<string, { first: string[]; more: number }>();
    for (const row of rows) {
      const urls = parseArticleImages(row).map((media) => media.url).filter(Boolean);
      m.set(row.id, { first: urls.slice(0, 3), more: Math.max(0, urls.length - 3) });
    }
    return m;
  }, [rows]);

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/* Sol: kategori listesi */}
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-border/60 py-8 pl-6 pr-3">
        {error && loadState === 'error' ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : categories === null ? (
          <div className="skeleton-paper h-5 w-36" />
        ) : (
          <nav className="flex flex-col gap-0.5" aria-label="Defter sayfaları">
            <button
              type="button"
              aria-current={selected === null ? 'true' : undefined}
              onClick={() => setSelected(null)}
              className={`flex items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm ${
                selected === null
                  ? 'bg-card font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="truncate">Sınıflandırılmamış</span>
              <span className="text-3xs tabular-nums text-muted-foreground">{uncategorizedCount}</span>
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-current={selected === c.id ? 'true' : undefined}
                onClick={() => setSelected(c.id)}
                className={`flex items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm ${
                  selected === c.id
                    ? 'bg-card font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className="truncate">{c.name}</span>
                <span className="text-3xs tabular-nums text-muted-foreground">{c.count}</span>
              </button>
            ))}
            {categories.length === 0 && uncategorizedCount === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Kategori yok — Ayarlar → AI'dan "Defteri Hazırla" ile arşivi düzenleyin.
              </p>
            )}
          </nav>
        )}
      </aside>

      {/* Sağ: sayfa */}
      <section className="min-w-0 flex-1 overflow-y-auto px-6 py-8 lg:px-10">
        <header className="mb-5 flex items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">{selectedName}</h1>
            <p className="text-xs text-muted-foreground">
              {total} kayıt · sayfa {page + 1}/{totalPages}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant={sort === 'new' ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => setSort('new')}
            >
              Yeni
            </Button>
            <Button
              variant={sort === 'old' ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => setSort('old')}
            >
              Eski
            </Button>
          </div>
        </header>

        {/* Özet bloğu: AI açıkken kalıcı LLM özeti; AI kapalıyken aynı yüzeyde
            deterministik sayısal özet (dürüst etiket — ikinci sözlük yok). */}
        {aiReady === false ? (
          numericSummary ? (
            <div className="mb-5 flex flex-col gap-2 rounded-sm border border-border/60 bg-card/60 p-3">
              <div className="flex items-start gap-2">
                <BookOpen className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Sayısal özet
                  </span>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                    {numericSummary}
                  </p>
                </div>
              </div>
            </div>
          ) : null
        ) : selected === null ? null : (
          <div className="mb-5 flex flex-col gap-2 rounded-sm border border-border/60 bg-card/60 p-3">
            {summary ? (
              <>
                <div className="flex items-start gap-2">
                  <BookOpen className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{summary}</p>
                </div>
                <Button variant="ghost" size="sm" className="self-start" onClick={() => void buildSummary()} disabled={summaryBusy}>
                  <RefreshCw className="size-3" /> Özeti yenile
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => void buildSummary()}
                disabled={summaryBusy || loadState !== 'ok'}
              >
                <BookOpen className="size-3" />
                {summaryBusy ? 'Özet yazılıyor…' : 'Bu sayfa için özet oluştur'}
              </Button>
            )}
          </div>
        )}

        {/* Durumlar */}
        {loadState === 'loading' && rows === null ? (
          <div className="flex flex-col gap-3" aria-busy="true">
            <div className="skeleton-paper h-24 w-full" />
            <div className="skeleton-paper h-24 w-full" />
            <div className="skeleton-paper h-24 w-full" />
          </div>
        ) : loadState === 'error' ? (
          <div className="flex flex-col items-start gap-2 text-sm">
            <p className="flex items-center gap-2 text-red-400">
              <FileWarning className="size-4" /> {error ?? 'Sayfa yüklenemedi.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void reloadPage()}>
              Yeniden dene
            </Button>
          </div>
        ) : loadState === 'empty' || !rows || rows.length === 0 ? (
          <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
            <span>Bu sayfada kayıt yok.</span>
            {selected === null && onOpenSettings && (
              <Button variant="outline" size="sm" onClick={onOpenSettings}>
                Kategorilendir — Ayarlar → AI
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {rows.map((row) => <NotebookRow key={row.id} row={row} tags={tagsByItem[row.id] ?? []} images={imagesMemo.get(row.id) ?? { first: [], more: 0 }} onOpenItem={onOpenItem} />)}
            {totalPages > 1 && (
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  Önceki
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Sonraki
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function NotebookRow({
  row,
  tags,
  images,
  onOpenItem,
}: {
  row: NotebookItemRow;
  tags: Tag[];
  images: { first: string[]; more: number };
  onOpenItem: (item: Item) => void;
}) {
  const links = extractLinks(row);
  return (
    <article
      className="rounded-sm border border-border/60 bg-card/40 p-4"
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 220px' }}
    >
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <button
          type="button"
          className="min-w-0 truncate text-left font-display text-base font-medium hover:underline"
          onClick={() => onOpenItem(row)}
        >
          {row.title || row.url}
        </button>
        <span className="shrink-0 text-3xs tabular-nums text-muted-foreground">
          {[row.author, trDate(row.created_at)].filter(Boolean).join(' · ')}
        </span>
      </header>

      {row.content_text ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">{row.content_text}</p>
      ) : (
        <p className="text-sm italic text-muted-foreground">İçerik metni henüz çekilmedi — Ayarlar → AI → Defteri Hazırla.</p>
      )}

      {images.first.length > 0 && (
        <div className="mt-3 flex gap-2">
          {images.first.map((url) => (
            <button
              key={url}
              type="button"
              onClick={() => onOpenItem(row)}
              className="h-16 w-24 shrink-0 overflow-hidden rounded-sm border border-border/60 bg-muted/40"
              aria-label="Kaydı aç"
            >
              <img
                src={url}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            </button>
          ))}
          {images.more > 0 && (
            <button
              type="button"
              onClick={() => onOpenItem(row)}
              className="h-16 w-14 shrink-0 rounded-sm border border-border/60 bg-muted/40 text-3xs text-muted-foreground"
            >
              +{images.more}
            </button>
          )}
        </div>
      )}

      {links.length > 0 && (
        <div className="mt-3 border-t border-border/50 pt-2">
          <h4 className="mb-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
            Bağlantılar
          </h4>
          <ul className="flex flex-col gap-0.5">
            {links.slice(0, 6).map((url) => (
              <li key={url} className="flex min-w-0 items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{url}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-3xs"
                  onClick={() => void openExternal(url)}
                >
                  Aç
                </Button>
              </li>
            ))}
            {links.length > 6 && <li className="text-3xs text-muted-foreground">+{links.length - 6} bağlantı</li>}
          </ul>
        </div>
      )}

      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t.id}
              className="flex items-center gap-1 rounded-sm border border-border/70 bg-muted/30 px-1.5 py-0.5 text-3xs text-muted-foreground"
            >
              <TagIcon className="size-2.5" /> {t.name}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
