import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CornerDownLeft,
  LayoutGrid,
  Link2,
  Loader2,
  PanelLeft,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  Sigma,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { BrandMark } from '@/components/BrandMark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WindowControls } from '@/components/ui/window-controls';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useNotice } from '@/components/ui/notice';
import { answerStructuralQuery, type StructuralAnswer, type VaultQuery } from '@/lib/ai-context';
import { createItem, removeItem, updateItem } from '@/lib/db/client';
import { describeError } from '@/lib/errors';
import { PLATFORM_META, detectPlatform, fetchPreview, type Platform } from '@/lib/platform';
import { scrapeAndStoreArticle } from '@/lib/scraper';

/*
 * Araç çubuğu — birleşik pencere şeridi (Apple unified toolbar).
 *
 * Tek 52px bant: solda marka (rayın üstünde), ortada yakala/ara alanı —
 * uygulamanın imza etkileşimi —, sağda görünüm denetimi + tema + pencere
 * kontrolleri. Pencere kontrolleri Windows alışkanlığı gereği sağdadır.
 *
 * Alan çift kişiliktir: yazarsan arşivi arar, link yapıştırırsan kaydeder.
 * Mod tahmin edilmez, görünür; "bu arama mı kayıt mı" sorusu doğmaz.
 * Boş alan sürüklenebilir (`data-tauri-drag-region`); içerik altından akar.
 */

/** Arama mı, kayıt mı? Şema, bilinen platform ana bilgisayarı veya çıplak alan adı kayıt sayılır. */
export function looksLikeUrl(raw: string): boolean {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(v)) return true;
  if (detectPlatform(v) !== 'other') return true;
  return /^[\w-]+(\.[\w-]{2,})+(\/[\w\-./?%#&=+]*)?$/.test(v);
}

/**
 * Yapısal cevabın filtresini tek satırda anlatır. Sözlük mevcut terimlerdir
 * (platform adı, kategori, `#etiket`, favori, yerel, son N gün) — ikinci bir
 * arama/sorgu dili açılmaz.
 */
function describeStructuralAnswer(q: VaultQuery): string {
  const parts: string[] = [];
  if (q.platform) parts.push(PLATFORM_META[q.platform as Platform]?.label ?? q.platform);
  if (q.category) parts.push(q.category);
  if (q.tag) parts.push(`#${q.tag}`);
  if (q.favorite === true) parts.push('favori');
  if (q.favorite === false) parts.push('favori olmayan');
  if (q.downloaded === true) parts.push('yerel');
  if (q.downloaded === false) parts.push('indirilmemiş');
  if (q.sinceDays) parts.push(`son ${q.sinceDays} gün`);
  return parts.join(' · ');
}

interface ToolbarProps {
  /** Boş dize: çubuk kayıt modunda, arşiv filtrelenmez. */
  onQuery: (query: string) => void;
  onSaved: () => void;
  onDetailed: (url: string) => void;
  semantic?: boolean;
  onSemanticToggle?: () => void;
  onOpenSync?: () => void;
  /** AI etkin mi? Yalnızca kesin `false` iken anlamsal kontrol gizlenir. */
  aiEnabled?: boolean;
  /**
   * Kullanılmıyor: AI kapalıyken anlamsal kontrol çizilmez (Ölü-Kontrol-Yok),
   * Ayarlar yönlendirmesi ItemGrid'in boş durumunda yaşar. Çağıranların
   * sözleşmesi bozulmasın diye tipte durur.
   */
  onOpenAiSettings?: () => void;
  /** Arşiv görünümündeyken geçilir; görünüm segmenti yalnızca o zaman çizilir. */
  view?: 'grid' | 'rows';
  onViewChange?: (v: 'grid' | 'rows') => void;
  /* Gezinme: ray denetimi + geri/ileri (gerçek görünüm geçmişi). */
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

export function Toolbar({
  onQuery,
  onSaved,
  onDetailed,
  semantic,
  onSemanticToggle,
  onOpenSync,
  aiEnabled,
  view,
  onViewChange,
  sidebarOpen,
  onToggleSidebar,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: ToolbarProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const notice = useNotice();

  /* AI kapalıyken yapısal sorular DETERMİNİSTİK yanıtlanır (Ölü-Kontrol-Yok):
     arama alanının altında, aynı yüzeyde kesin sonuç açılır. AI açıkken bu
     panel hiç doğmaz — mevcut FTS/anlamsal davranış aynen sürer. */
  const [answer, setAnswer] = useState<StructuralAnswer | null>(null);
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);

  useEffect(() => {
    if (aiEnabled !== false) {
      setAnswer(null);
      setAnswerLoading(false);
      setAnswerError(null);
      return;
    }
    const q = value.trim();
    if (!q || looksLikeUrl(q)) {
      setAnswer(null);
      setAnswerLoading(false);
      setAnswerError(null);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      setAnswerLoading(true);
      void answerStructuralQuery(q)
        .then((res) => {
          if (!live) return;
          setAnswer(res); // null: yapısal sinyal yok → panel çizilmez, arama sürer.
          setAnswerLoading(false);
        })
        .catch((e: unknown) => {
          if (!live) return;
          setAnswerError(describeError(e, 'Arşiv taranamadı.'));
          setAnswer(null);
          setAnswerLoading(false);
        });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [value, aiEnabled]);

  const trimmed = value.trim();
  const capture = looksLikeUrl(trimmed);
  const platform = capture ? detectPlatform(trimmed) : null;
  const answerSummary = answer ? describeStructuralAnswer(answer.query) : '';

  const handleChange = (next: string): void => {
    setValue(next);
    onQuery(looksLikeUrl(next) ? '' : next);
  };

  const reset = (): void => {
    setValue('');
    onQuery('');
  };

  const save = async (): Promise<void> => {
    if (!capture || busy) return;
    setBusy(true);
    try {
      const item = await createItem({ url: trimmed, platform: platform ?? 'other' });
      reset();
      onSaved();
      notice.push({
        text: 'Kayda geçti.',
        tone: 'ok',
        action: {
          label: 'Geri al',
          run: () => {
            void removeItem(item.id).then(onSaved);
          },
        },
      });
      // Önizleme bilerek sonra çekilir: kayıt anında olur, zenginleştirme bekler.
      void fetchPreview(trimmed)
        .then((p) => {
          if (!p || (!p.title && !p.thumbnail)) return;
          return updateItem(item.id, { title: p.title, thumbnail: p.thumbnail }).then(onSaved);
        })
        .catch(() => undefined);

      // Sayfa içeriğini kazı ve FTS5 tam metin indeksine ekle
      void scrapeAndStoreArticle(item.id, trimmed)
        .then(onSaved)
        .catch(() => undefined);
    } catch (e) {
      notice.push({
        text: typeof e === 'string' ? e : 'Kaydedilemedi.',
        tone: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <header
      data-tauri-drag-region
      className="material-toolbar sticky top-0 z-40 flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-3"
    >
      {/* Sol: ray denetimi + gezinme + marka (rayın üstünde) */}
      <div
        data-tauri-drag-region
        className={`flex shrink-0 items-center gap-0.5 ${sidebarOpen ? 'lg:w-[228px]' : ''}`}
      >
        <ToolButton label={sidebarOpen ? 'Rayı gizle' : 'Rayı göster'} onClick={onToggleSidebar}>
          <PanelLeft className="size-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton label="Geri" disabled={!canGoBack} onClick={onBack}>
          <ArrowLeft className="size-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton label="İleri" disabled={!canGoForward} onClick={onForward}>
          <ArrowRight className="size-4" strokeWidth={1.75} />
        </ToolButton>
        {sidebarOpen && (
          <span data-tauri-drag-region className="ml-1.5 hidden min-w-0 items-center gap-2 lg:flex">
            <BrandMark className="size-[18px] shrink-0" />
            <span className="truncate text-[0.9375rem] leading-none font-semibold tracking-[-0.01em]">
              JointVault
            </span>
          </span>
        )}
      </div>

      {/* Orta: yakala/ara alanı + mod eylemleri */}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        <div className="relative w-full max-w-[440px]">
          {capture ? (
            <Link2
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-primary"
              aria-hidden
            />
          ) : semantic ? (
            <Sparkles
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-primary"
              aria-hidden
            />
          ) : (
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          )}
          <Input
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && capture) {
                e.preventDefault();
                void save();
              }
              if (e.key === 'Escape') reset();
            }}
            aria-label={capture ? 'Link kaydet' : 'Arşivde ara'}
            placeholder={
              capture
                ? 'Enter ile kaydet — önizleme sonra çekilir'
                : semantic
                  ? 'Arşivde anlamsal ara: doğal dil, kavramlar, transkriptler…'
                  : 'Arşivde ara: başlık · not · URL'
            }
            className={`h-9 rounded-lg bg-card/60 pl-8 text-[0.9375rem] ${!capture ? 'pr-16' : ''} ${semantic && !capture ? 'border-primary/50' : ''}`}
          />
          {!capture && (
            <span className="pointer-events-none absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center gap-1 font-mono text-2xs text-muted-foreground">
              <kbd className="rounded-xs border border-border px-1 py-px">Ctrl</kbd>
              <kbd className="rounded-xs border border-border px-1 py-px">K</kbd>
            </span>
          )}

          {/* Yapısal cevap: arama alanının altında, aynı yüzeyde. AI kapalıyken
              deterministik sonuç; mevcut primitiflerle (badge + satır) çizilir. */}
          {!capture && (answer || answerLoading || answerError) && (
            <div
              role="status"
              aria-live="polite"
              className="material-sheet animate-rise absolute top-[calc(100%+0.375rem)] left-0 z-50 flex w-full flex-col gap-1.5 rounded-xl border border-border p-2 shadow-lift"
            >
              {answerError ? (
                <span className="flex items-center gap-2 px-1 py-0.5 text-xs text-destructive">
                  <TriangleAlert className="size-3.5 shrink-0" aria-hidden /> {answerError}
                </span>
              ) : answer ? (
                <>
                  <div className="flex items-center gap-2 px-1">
                    <Badge variant="outline" className="gap-1.5" title="AI'sız — arşivden deterministik sonuç">
                      <Sigma aria-hidden /> Kesin
                    </Badge>
                    {answerSummary && (
                      <span className="min-w-0 truncate text-2xs text-muted-foreground">
                        {answerSummary}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-xs font-medium" data-num>
                      {answer.count} kayıt
                    </span>
                  </div>
                  {answer.items.length > 0 && (
                    <div className="flex flex-col border-t border-border/60 pt-1.5">
                      {answer.items.slice(0, 5).map((it) => (
                        <div key={it.id} className="flex items-center justify-between gap-2 px-1 py-0.5">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <Badge variant="outline" className="px-1 py-0">
                              {PLATFORM_META[it.platform as Platform]?.label ?? it.platform}
                            </Badge>
                            <span className="truncate text-xs">{it.title || it.url}</span>
                          </div>
                          <span className="shrink-0 text-2xs text-muted-foreground" data-num>
                            {it.createdAt.slice(0, 10)}
                          </span>
                        </div>
                      ))}
                      {answer.count > answer.items.length && (
                        <span className="px-1 pt-0.5 text-2xs text-muted-foreground">
                          +{answer.count - answer.items.length} kayıt daha
                        </span>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <span className="flex items-center gap-2 px-1 py-0.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> Arşiv taranıyor…
                </span>
              )}
            </div>
          )}
        </div>

        {capture ? (
          <span className="animate-rise flex shrink-0 items-center gap-1.5">
            {platform && (
              <Badge variant="outline" className="hidden gap-1.5 sm:inline-flex">
                <span aria-hidden className={`size-1.5 rounded-full ${PLATFORM_META[platform].dot}`} />
                {PLATFORM_META[platform].label}
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={() => onDetailed(trimmed)} disabled={busy}>
              <Plus /> <span className="hidden sm:inline">Ayrıntılı</span>
            </Button>
            <Button variant="stamp" onClick={() => void save()} disabled={busy}>
              <CornerDownLeft /> Kaydet
            </Button>
          </span>
        ) : (
          <div className="flex shrink-0 items-center gap-1.5">
            {/* AI kapalıyken anlamsal arama ÇALIŞAMAZ: ölü kontrol çizilmez,
                düğme gizlenir (DESIGN · Ölü-Kontrol-Yok). */}
            {onSemanticToggle && aiEnabled !== false && (
              <Button
                type="button"
                variant={semantic ? 'secondary' : 'ghost'}
                size="sm"
                onClick={onSemanticToggle}
                className="h-7 gap-1 px-2 text-2xs"
                title={semantic ? 'Anlamsal Arama Devrede (BGE-M3 + FTS5)' : 'Anlamsal Arama Moduna Geç'}
              >
                <Sparkles className={`size-3 ${semantic ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className={semantic ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                  Anlamsal
                </span>
              </Button>
            )}
            {onOpenSync && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onOpenSync}
                className="h-7 gap-1 px-2 text-2xs hover:text-primary"
                title="Eşitleme Merkezi (X, Instagram, YouTube)"
              >
                <RefreshCw className="size-3 text-primary" />
                <span className="hidden md:inline">Eşitle</span>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Sağ: görünüm + tema + pencere kontrolleri (Windows yeri: sağda) */}
      <div className="flex shrink-0 items-center gap-1">
        {!capture && view && onViewChange && (
          <div
            className="mr-1 hidden items-center rounded-sm border border-border p-0.5 sm:flex"
            role="group"
            aria-label="Görünüm"
          >
            <button
              type="button"
              onClick={() => onViewChange('grid')}
              aria-pressed={view === 'grid'}
              aria-label="Kart görünümü"
              className={`rounded-xs p-1 transition-colors duration-150 ${
                view === 'grid'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <LayoutGrid className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onViewChange('rows')}
              aria-pressed={view === 'rows'}
              aria-label="Satır görünümü"
              className={`rounded-xs p-1 transition-colors duration-150 ${
                view === 'rows'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Rows3 className="size-3.5" />
            </button>
          </div>
        )}
        <ThemeToggle />
        <WindowControls />
      </div>
    </header>
  );
}
