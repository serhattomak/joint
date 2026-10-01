import { useState } from 'react';
import {
  Archive,
  CornerDownLeft,
  LayoutGrid,
  Link2,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WindowControls } from '@/components/ui/window-controls';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useNotice } from '@/components/ui/notice';
import { createItem, removeItem, updateItem } from '@/lib/db/client';
import { PLATFORM_META, detectPlatform, fetchPreview } from '@/lib/platform';
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

interface ToolbarProps {
  /** Boş dize: çubuk kayıt modunda, arşiv filtrelenmez. */
  onQuery: (query: string) => void;
  onSaved: () => void;
  onDetailed: (url: string) => void;
  semantic?: boolean;
  onSemanticToggle?: () => void;
  onOpenSync?: () => void;
  /** AI etkin mi? Yalnızca kesin `false` iken dürüst "kapalı" durumu gösterilir. */
  aiEnabled?: boolean;
  /** AI kapalıyken Ayarlar → Yapay Zekâ'ya götürür (ölü düğme yok). */
  onOpenAiSettings?: () => void;
  /** Kasa görünümündeyken geçilir; görünüm segmenti yalnızca o zaman çizilir. */
  view?: 'grid' | 'rows';
  onViewChange?: (v: 'grid' | 'rows') => void;
}

export function Toolbar({
  onQuery,
  onSaved,
  onDetailed,
  semantic,
  onSemanticToggle,
  onOpenSync,
  aiEnabled,
  onOpenAiSettings,
  view,
  onViewChange,
}: ToolbarProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const notice = useNotice();

  const trimmed = value.trim();
  const capture = looksLikeUrl(trimmed);
  const platform = capture ? detectPlatform(trimmed) : null;

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
        text: 'Fişe geçti.',
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
      {/* Sol: marka — rayın üstünde, ray gizlenince kalkar */}
      <div data-tauri-drag-region className="hidden w-[228px] shrink-0 items-center gap-2.5 lg:flex">
        <Archive
          data-tauri-drag-region
          className="size-[18px] text-primary"
          strokeWidth={2.25}
          aria-hidden
        />
        <span
          data-tauri-drag-region
          className="text-[0.9375rem] leading-none font-semibold tracking-[-0.01em]"
        >
          JointVault
        </span>
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
                  ? 'Arşivde semantik ara: doğal dil, kavramlar, transkriptler…'
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
            {onSemanticToggle &&
              (aiEnabled === false ? (
                // AI kapalıyken semantik arama ÇALIŞAMAZ: yanıltıcı bir aç/kapa
                // düğmesi yerine doğrudan Ayarlar → Yapay Zekâ'ya götüren gerçek
                // bir düğme gösterilir. Yönlendirme yoksa düğme hiç çizilmez.
                onOpenAiSettings ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onOpenAiSettings}
                    className="h-7 gap-1 px-2 text-2xs text-muted-foreground"
                    title="AI kapalı — semantik aramayı Ayarlar > Yapay Zekâ'dan etkinleştir"
                  >
                    <Sparkles className="size-3 text-muted-foreground" />
                    <span className="hidden md:inline">AI kapalı — Ayarlar'dan aç</span>
                  </Button>
                ) : null
              ) : (
                <Button
                  type="button"
                  variant={semantic ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={onSemanticToggle}
                  className="h-7 gap-1 px-2 text-2xs"
                  title={semantic ? 'Semantik Arama Devrede (BGE-M3 + FTS5)' : 'Semantik Arama Moduna Geç'}
                >
                  <Sparkles className={`size-3 ${semantic ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className={semantic ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                    Semantik
                  </span>
                </Button>
              ))}
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
