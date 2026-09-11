import { memo, useState } from 'react';
import { Download, Pencil, RotateCcw, Scissors, Star, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  QUALITY_OPTIONS,
  getDefaultQuality,
  setDefaultQuality,
  type DownloadQuality,
} from '@/lib/downloads';
import { openExternal } from '@/lib/external';
import { PLATFORM_META, type Platform } from '@/lib/platform';
import type { Category, Item, Tag } from '@/lib/db/types';

export interface ItemViewProps {
  item: Item;
  tags: Tag[];
  categories: Category[];
  collectionLabel: string | null;
  selected: boolean;
  index: number;
  onToggle: (id: string) => void;
  onFavorite: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (item: Item) => void;
  progress: number | undefined;
  onAudio: (item: Item, quality: DownloadQuality) => void;
  onPickVideo: (item: Item) => void;
  onConvert: (item: Item) => void;
}

// 06: Tauri opener plugin — falls back to window.open in dev-browser mode.
// block + w-full: içindeki truncate/line-clamp zincirinin çalışması için
// ebeveyn genişliğine sabitlenir (yoksa buton içeriğe göre şişer).
function OpenLink({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => void openExternal(url)}
      className="block w-full min-w-0 cursor-pointer text-left"
    >
      {children}
    </button>
  );
}

function ActionButtons({ item, onFavorite, onDelete, onEdit }: Pick<ItemViewProps, 'item' | 'onFavorite' | 'onDelete' | 'onEdit'>) {  return (
    <>
      <Button
        variant={item.favorite ? 'default' : 'ghost'}
        size="icon-sm"
        onClick={() => onFavorite(item.id)}
        aria-label="Favori"
        aria-pressed={item.favorite}
      >
        <Star className={item.favorite ? 'fill-current' : ''} />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => onEdit(item)} aria-label="Düzenle">
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={() => onDelete(item.id)} aria-label="Sil">
        <Trash2 />
      </Button>
    </>
  );
}

// Per-item download state: done → badge, queued/active → inline progress bar,
// error → message + retry menu, none → Download button with Video/Ses mini-menu.
// ponytail: badge only on done — opening local files needs an opener bridge (later).
function DownloadZone({
  item,
  progress,
  onAudio,
  onPickVideo,
  onConvert,
}: Pick<ItemViewProps, 'item' | 'progress' | 'onAudio' | 'onPickVideo' | 'onConvert'>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [quality, setQuality] = useState<DownloadQuality>(() => getDefaultQuality());
  const status = item.download_status;

  if (status === 'done')
    return (
      <span className="flex items-center gap-0.5">
        <Badge variant="secondary">Yerel</Badge>
        {item.local_path && (
          <Button variant="ghost" size="icon-sm" onClick={() => onConvert(item)} aria-label="Dönüştür">
            <Scissors />
          </Button>
        )}
      </span>
    );

  if (status === 'queued' || status === 'active') {
    const pct = Math.round(progress ?? 0);
    return (
      <div className="flex min-w-24 flex-1 items-center gap-1.5" aria-label={`İndiriliyor %{pct}`}>
        <div className="h-1 flex-1 overflow-hidden rounded bg-muted">
          <div className="h-full rounded bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground">%{pct}</span>
      </div>
    );
  }

  return (
    <div className="relative">
      {status === 'error' ? (
        <div className="flex min-w-0 items-center gap-1">
          <span className="max-w-40 truncate text-[11px] text-destructive" title={item.download_error ?? 'Hata'}>
            {item.download_error ?? 'Hata'}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => setMenuOpen((o) => !o)} aria-label="Tekrar indir">
            <RotateCcw />
          </Button>
        </div>
      ) : (
        <Button variant="ghost" size="icon-sm" onClick={() => setMenuOpen((o) => !o)} aria-label="İndir">
          <Download />
        </Button>
      )}
      {menuOpen && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute bottom-full left-0 z-20 mb-1 flex min-w-28 flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as DownloadQuality)}
              className="border-b border-border bg-transparent px-2.5 py-1.5 text-xs outline-none"
              aria-label="Kalite"
            >
              {QUALITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="flex">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onPickVideo(item);
                }}
                className="flex-1 px-2.5 py-1.5 text-xs hover:bg-muted"
              >
                Video…
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setDefaultQuality(quality);
                  onAudio(item, quality);
                }}
                className="flex-1 px-2.5 py-1.5 text-xs hover:bg-muted"
              >
                Ses
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Ölü CDN linkleri (süresi dolmuş IG thumb'ları) kırık ikon bırakmasın;
// loading=lazy + content-visibility ile mount fırtınası da biter.
const Thumb = memo(function Thumb({
  src,
  className,
  fallback,
}: {
  src: string | null;
  className: string;
  fallback: React.ReactNode;
}) {
  const [dead, setDead] = useState(false);
  if (!src || dead) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setDead(true)}
    />
  );
});

// memo: seçim değişiminde sadece dokunulan satır render edilir.
export const ItemRowView = memo(function ItemRowView({
  item,
  tags,
  categories,
  collectionLabel,
  selected,
  onToggle,
  onFavorite,
  onDelete,
  onEdit,
  progress,
  onAudio,
  onPickVideo,
  onConvert,
}: ItemViewProps) {
  return (
    <div className="cv-row group flex items-center gap-3 px-3 py-2 transition hover:bg-muted/60">
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(item.id)}
        className="size-4 shrink-0 accent-primary"
        aria-label="Öğeyi seç"
      />
      <Thumb
        src={item.thumbnail}
        className="size-11 shrink-0 rounded-lg object-cover"
        fallback={
          <span
            className={`size-2.5 shrink-0 rounded-full ${PLATFORM_META[(item.platform as Platform)]?.dot ?? PLATFORM_META.other.dot}`}
          />
        }
      />
      <div className="min-w-0 max-w-xl flex-1 overflow-hidden">
        <OpenLink url={item.url}>
          <Tooltip>
            <TooltipTrigger
              render={
                <p className="truncate font-display text-[15px] leading-snug hover:underline">
                  {item.title || item.url}
                </p>
              }
            />
            <TooltipContent>{item.title || item.url}</TooltipContent>
          </Tooltip>
        </OpenLink>
                <p className="truncate text-xs text-muted-foreground">
                  {PLATFORM_META[(item.platform as Platform)]?.label ?? item.platform}
                  {collectionLabel && ` · ${collectionLabel}`}
                  {categories.map((c) => ` ${c.name}`).join('')}
                  {tags.map((t) => ` #${t.name}`).join('')}
                  {` · ${new Date(item.created_at).toLocaleDateString('tr-TR')}`}
                </p>
        <div className="mt-0.5 flex items-center gap-0.5">
          <ActionButtons item={item} onFavorite={onFavorite} onDelete={onDelete} onEdit={onEdit} />
          <DownloadZone item={item} progress={progress} onAudio={onAudio} onPickVideo={onPickVideo} onConvert={onConvert} />
        </div>
      </div>
    </div>
  );
});

export const ItemCardView = memo(function ItemCardView({
  item,
  tags,
  categories,
  collectionLabel,
  selected,
  index,
  onToggle,
  onFavorite,
  onDelete,
  onEdit,
  progress,
  onAudio,
  onPickVideo,
  onConvert,
}: ItemViewProps) {
  return (
    <article
      className="group animate-rise cv-card relative flex flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-lift"
      style={{ animationDelay: `${Math.min(index * 40, 320)}ms` }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(item.id)}
        aria-label="Öğeyi seç"
        className={`absolute top-2 left-2 z-10 size-4 accent-primary transition ${
          selected ? '' : 'opacity-0 group-hover:opacity-100'
        }`}
      />
      <Thumb
        src={item.thumbnail}
        className="h-36 w-full object-cover"
        fallback={
          <div className="flex h-36 w-full items-center justify-center bg-muted text-sm text-muted-foreground">
            Önizleme yok
          </div>
        }
      />
      <div className="flex flex-col gap-2 p-3">
        <OpenLink url={item.url}>
          <h3 className="line-clamp-2 font-display text-[15px] leading-snug hover:underline">
            {item.title || item.url}
          </h3>
        </OpenLink>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`size-2 rounded-full ${PLATFORM_META[(item.platform as Platform)]?.dot ?? PLATFORM_META.other.dot}`}
            />
            {PLATFORM_META[(item.platform as Platform)]?.label ?? item.platform}
          </span>
                  {collectionLabel && <span>{collectionLabel}</span>}
                  {categories.map((c) => (
                    <span key={c.id}>{c.name}</span>
                  ))}
                  {tags.map((t) => (
                    <span key={t.id}>#{t.name}</span>
                  ))}
        </div>
        <div className="mt-1 flex items-center gap-1 border-t border-border pt-2">
          <ActionButtons item={item} onFavorite={onFavorite} onDelete={onDelete} onEdit={onEdit} />
          <DownloadZone item={item} progress={progress} onAudio={onAudio} onPickVideo={onPickVideo} onConvert={onConvert} />
        </div>
      </div>
    </article>
  );
});
