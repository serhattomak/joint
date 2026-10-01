import { useState } from 'react';
import { CornerDownLeft, Link2, Plus, RefreshCw, Search, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WindowControls } from '@/components/ui/window-controls';
import { useNotice } from '@/components/ui/notice';
import { createItem, removeItem, updateItem } from '@/lib/db/client';
import { PLATFORM_META, detectPlatform, fetchPreview } from '@/lib/platform';
import { scrapeAndStoreArticle } from '@/lib/scraper';

/*
 * Yakala çubuğu — uygulamanın imza etkileşimi.
 * Tek satır, çift kişilik: yazarsan arşivi arar, link yapıştırırsan kaydeder.
 * Mod tahmin edilmez, görünür: sol ikon ve sağdaki ipucu çipi birlikte değişir,
 * böylece "bu bir arama mı, kayıt mı" sorusu hiç doğmaz.
 */

/** Arama mı, kayıt mı? Şema, bilinen platform ana bilgisayarı veya çıplak alan adı kayıt sayılır. */
export function looksLikeUrl(raw: string): boolean {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(v)) return true;
  if (detectPlatform(v) !== 'other') return true;
  return /^[\w-]+(\.[\w-]{2,})+(\/[\w\-./?%#&=+]*)?$/.test(v);
}

interface CaptureBarProps {
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
}

export function CaptureBar({ onQuery, onSaved, onDetailed, semantic, onSemanticToggle, onOpenSync, aiEnabled, onOpenAiSettings }: CaptureBarProps) {
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
    <div
      data-tauri-drag-region
      className="material-toolbar scroll-edge-b sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 px-4"
    >
      <div className="relative min-w-0 flex-1">
        {capture ? (
          <Link2 className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-primary" aria-hidden />
        ) : semantic ? (
          <Sparkles className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-primary" aria-hidden />
        ) : (
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
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
          className={`h-[38px] pl-8 text-[0.9375rem] ${semantic && !capture ? 'border-primary/50' : ''}`}
        />
      </div>

      {capture ? (
        <span className="animate-rise flex shrink-0 items-center gap-1.5">
          {platform && (
            <Badge variant="outline" className="gap-1.5">
              <span aria-hidden className={`size-1.5 rounded-full ${PLATFORM_META[platform].dot}`} />
              {PLATFORM_META[platform].label}
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={() => onDetailed(trimmed)} disabled={busy}>
            <Plus /> Ayrıntılı
          </Button>
          <Button variant="stamp" onClick={() => void save()} disabled={busy}>
            <CornerDownLeft /> Kaydet
          </Button>
        </span>
      ) : (
        <div className="flex items-center gap-2">
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
                  <span>AI kapalı — Ayarlar'dan aç</span>
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
                <span className={semantic ? 'font-medium text-foreground' : 'text-muted-foreground'}>Semantik</span>
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
              <span>Eşitle</span>
            </Button>
          )}
          <span className="hidden shrink-0 items-center gap-1.5 font-mono text-2xs text-muted-foreground sm:flex">
            <kbd className="rounded-xs border border-border px-1 py-px">Ctrl</kbd>
            <kbd className="rounded-xs border border-border px-1 py-px">K</kbd>
            <span>palet</span>
          </span>
        </div>
      )}

      <WindowControls />
    </div>
  );
}
