import { memo, useState } from 'react';
import {
  BookOpen,
  Download,
  ExternalLink,
  ImageOff,
  Music,
  Pencil,
  Play,
  RotateCcw,
  Scissors,
  Star,
  Trash2,
} from 'lucide-react';
import { openPath } from '@tauri-apps/plugin-opener';
import { Button } from '@/components/ui/button';
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '@/components/ui/menu';
import { Progress } from '@/components/ui/progress';
import { Stamp, PlatformRule } from '@/components/ui/stamp';
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
  hasArticle?: boolean;
  onToggle: (id: string) => void;
  onFavorite: (id: string) => void;
  onDelete: (id: string) => void;
  /** Fişi/merkeziyetçi görünümü aç: kaydın tamamı geniş modal pencerede açılır. */
  onOpen: (item: Item, tab?: 'detail' | 'reader') => void;
  progress: number | undefined;
  meta?: { speed?: string | null; eta?: string | null };
  onAudio: (item: Item, quality: DownloadQuality) => void;
  onPickVideo: (item: Item) => void;
  onConvert: (item: Item) => void;
  onPlayMedia?: (item: Item) => void;
}

const platformLabel = (p: string): string =>
  PLATFORM_META[p as Platform]?.label ?? p;

const platformDot = (p: string): string =>
  PLATFORM_META[p as Platform]?.dot ?? PLATFORM_META.other.dot;

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString('tr-TR');

function ActionButtons({
  item,
  hasArticle,
  onFavorite,
  onDelete,
  onOpen,
}: Pick<ItemViewProps, 'item' | 'hasArticle' | 'onFavorite' | 'onDelete' | 'onOpen'>) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                void openExternal(item.url);
              }}
              aria-label="Tarayıcıda Aç"
            />
          }
        >
          <ExternalLink className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent>Tarayıcıda Aç</TooltipContent>
      </Tooltip>

      {hasArticle && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-primary hover:bg-primary/10 hover:text-primary"
                onClick={() => onOpen(item, 'reader')}
                aria-label="Okuyucu Modunda Oku"
              />
            }
          >
            <BookOpen className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>Okuyucu Modunda Oku</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant={item.favorite ? 'stamp' : 'ghost'}
              size="icon-sm"
              onClick={() => onFavorite(item.id)}
              aria-label={item.favorite ? 'Favoriden çıkar' : 'Favoriye ekle'}
              aria-pressed={item.favorite}
            />
          }
        >
          <Star className={item.favorite ? 'fill-current' : ''} />
        </TooltipTrigger>
        <TooltipContent>{item.favorite ? 'Favoriden çıkar' : 'Favoriye ekle'}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpen(item, 'detail')}
              aria-label="Detayları ve Fişi İncele"
            />
          }
        >
          <Pencil className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent>Detayları ve Fişi İncele</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" onClick={() => onDelete(item.id)} aria-label="Sil" />
          }
        >
          <Trash2 className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent>Sil</TooltipContent>
      </Tooltip>
    </>
  );
}

/*
 * İndirme bölgesi — durum damgası ya da ölçüm. Kalite seçimi gerçek bir menü:
 * portala taşınır, klavyeyle gezilir.
 */
function DownloadControl({
  item,
  progress,
  meta,
  onAudio,
  onPickVideo,
  onConvert,
  onPlayMedia,
}: Pick<ItemViewProps, 'item' | 'progress' | 'meta' | 'onAudio' | 'onPickVideo' | 'onConvert' | 'onPlayMedia'>) {
  const [quality, setQuality] = useState<DownloadQuality>(() => getDefaultQuality());
  const status = item.download_status;

  if (status === 'done') {
    return (
      <span className="flex items-center gap-1">
        <Stamp state="local" />
        {item.converted_path && <Stamp state="converted" />}
        {item.local_path && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      if (onPlayMedia) {
                        onPlayMedia(item);
                      } else if (item.local_path) {
                        void openPath(item.local_path);
                      }
                    }}
                    aria-label="Oynat (Sinema Modu)"
                  />
                }
              >
                <Play className="size-3.5 text-primary" />
              </TooltipTrigger>
              <TooltipContent>Oynat (Sinema Modu)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon-sm" onClick={() => onConvert(item)} aria-label="Dönüştür / kırp" />
                }
              >
                <Scissors className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>Dönüştür / kırp</TooltipContent>
            </Tooltip>
          </>
        )}
      </span>
    );
  }

  if (status === 'queued' || status === 'active') {
    return (
      <div className="flex min-w-32 flex-1 flex-col gap-1" aria-label={`İndiriliyor %${Math.round(progress ?? 0)}`}>
        {status === 'queued' ? <Stamp state="queued" /> : null}
        <Progress value={progress ?? 0} />
        {(meta?.speed || meta?.eta) && (
          <span data-num className="text-2xs text-muted-foreground">
            {meta.speed}
            {meta.speed && meta.eta ? ' · ' : ''}
            {meta.eta ? `kalan ${meta.eta}` : ''}
          </span>
        )}
      </div>
    );
  }

  const failing = status === 'error';

  return (
    <div className="flex min-w-0 items-center gap-1">
      {failing && (
        <span className="max-w-40 truncate text-2xs text-state-error" title={item.download_error ?? 'Hata'}>
          {item.download_error ?? 'Hata'}
        </span>
      )}
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant={failing ? 'destructive' : 'ghost'}
              size="icon-sm"
              aria-label={failing ? 'Tekrar indir' : 'İndir'}
              title="İndir"
            />
          }
        >
          {failing ? <RotateCcw className="size-3.5" /> : <Download className="size-3.5" />}
        </MenuTrigger>
        <MenuContent align="end" className="min-w-44">
          <MenuGroupLabel>Kalite Tercihi</MenuGroupLabel>
          {QUALITY_OPTIONS.map((o) => (
            <MenuCheckboxItem
              key={o.value}
              checked={quality === o.value}
              onClick={() => setQuality(o.value)}
            >
              {o.label}
            </MenuCheckboxItem>
          ))}
          <MenuSeparator />
          <MenuItem onClick={() => onPickVideo(item)}>
            <Download className="size-3.5" /> Video İndir…
          </MenuItem>
          <MenuItem
            onClick={() => {
              setDefaultQuality(quality);
              onAudio(item, quality);
            }}
          >
            <Music className="size-3.5" /> Yalnızca Ses
          </MenuItem>
        </MenuContent>
      </Menu>
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

/* Kayıt künyesi: platform · koleksiyon · kategoriler · etiketler · tarih. Mono veri.
   Kart görünümünde platform ve tarih zaten künye bandındadır; burada tekrarlanmaz. */
function Accession({
  item,
  tags,
  categories,
  collectionLabel,
  hasArticle,
  variant,
}: Pick<ItemViewProps, 'item' | 'tags' | 'categories' | 'collectionLabel' | 'hasArticle'> & { variant: 'card' | 'row' }) {
  const hasTaxonomy = Boolean(collectionLabel) || categories.length > 0 || tags.length > 0 || hasArticle;
  if (variant === 'card' && !hasTaxonomy) return null;
  return (
    <p data-num className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
      {variant === 'row' && <span>{platformLabel(item.platform)}</span>}
      {hasArticle && (
        <span
          className="inline-flex items-center gap-1 rounded-xs bg-primary/10 px-1.5 py-0.5 font-mono text-2xs font-medium text-primary"
          title="Okunabilir makale/metin içeriği hazır"
        >
          <BookOpen className="size-2.5" />
          Okunabilir
        </span>
      )}
      {collectionLabel && <span>· {collectionLabel}</span>}
      {categories.map((c) => (
        <span key={c.id}>· {c.name}</span>
      ))}
      {tags.map((t) => (
        <span key={t.id} className="text-primary">
          #{t.name}
        </span>
      ))}
      <span className="ml-auto">{formatDate(item.created_at)}</span>
    </p>
  );
}

// memo: seçim değişiminde sadece dokunulan satır render edilir.
export const ItemRowView = memo(function ItemRowView({
  item,
  tags,
  categories,
  collectionLabel,
  selected,
  hasArticle,
  onToggle,
  onFavorite,
  onDelete,
  onOpen,
  progress,
  meta,
  onAudio,
  onPickVideo,
  onConvert,
  onPlayMedia,
}: ItemViewProps) {
  return (
    <div
      className={`cv-row group flex items-center gap-3 px-3 py-2 transition-colors duration-150 ease-paper ${
        selected ? 'bg-primary/5' : 'hover:bg-muted/50'
      }`}
      data-selected={selected || undefined}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(item.id)}
        className="size-3.5 shrink-0"
        aria-label="Öğeyi seç"
      />
      <span aria-hidden className={`h-6 w-0.5 shrink-0 ${platformDot(item.platform)}`} />
      <button
        type="button"
        onClick={() => onOpen(item, hasArticle ? 'reader' : 'detail')}
        className="cursor-pointer focus-visible:outline-none"
        title="Öğeyi Aç"
      >
        <Thumb
          src={item.thumbnail}
          className="size-9 shrink-0 rounded-xs border border-border object-cover transition-opacity hover:opacity-85"
          fallback={
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xs border border-dashed border-border font-mono text-2xs text-muted-foreground">
              —
            </span>
          }
        />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <button
          type="button"
          onClick={() => onOpen(item, hasArticle ? 'reader' : 'detail')}
          className="block w-full min-w-0 cursor-pointer text-left focus-visible:outline-none"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <p className="truncate text-sm leading-snug font-medium transition-colors hover:text-primary hover:underline">
                  {item.title || item.url}
                </p>
              }
            />
            <TooltipContent>{item.title || item.url}</TooltipContent>
          </Tooltip>
        </button>
        <Accession item={item} tags={tags} categories={categories} collectionLabel={collectionLabel} hasArticle={hasArticle} variant="row" />
      </div>
      <DownloadControl
        item={item}
        progress={progress}
        meta={meta}
        onAudio={onAudio}
        onPickVideo={onPickVideo}
        onConvert={onConvert}
        onPlayMedia={onPlayMedia}
      />
      <div className="flex shrink-0 items-center gap-0.5 transition-opacity duration-150 lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
        <ActionButtons item={item} hasArticle={hasArticle} onFavorite={onFavorite} onDelete={onDelete} onOpen={onOpen} />
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
  hasArticle,
  onToggle,
  onFavorite,
  onDelete,
  onOpen,
  progress,
  meta,
  onAudio,
  onPickVideo,
  onConvert,
  onPlayMedia,
}: ItemViewProps) {
  return (
    <article
      className={`group animate-rise cv-card relative flex flex-col overflow-hidden border bg-card text-card-foreground transition-all duration-200 ease-paper hover:-translate-y-0.5 ${
        selected ? 'border-primary' : 'border-border hover:border-input'
      }`}
      style={{ animationDelay: `${Math.min(index * 30, 240)}ms` }}
      data-selected={selected || undefined}
    >
      <PlatformRule platform={item.platform} />
      <div className="record-band text-muted-foreground">
        <span>{platformLabel(item.platform)}</span>
        <span className="ml-auto">{formatDate(item.created_at)}</span>
      </div>

      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(item.id)}
        aria-label="Öğeyi seç"
        className={`absolute top-8 left-2 z-10 size-3.5 transition-opacity duration-150 lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100 ${
          selected ? 'lg:opacity-100' : ''
        }`}
      />

      <button
        type="button"
        onClick={() => onOpen(item, hasArticle ? 'reader' : 'detail')}
        className="group/thumb relative w-full cursor-pointer overflow-hidden text-left focus:outline-none"
        title="Detayları İncele"
      >
        <Thumb
          src={item.thumbnail}
          className="h-36 w-full border-b border-border object-cover transition-transform duration-300 group-hover/thumb:scale-[1.02]"
          fallback={
            <div className="flex h-36 w-full flex-col items-center justify-center gap-1.5 border-b border-border bg-muted/40 px-4">
              <ImageOff className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <p className="font-mono text-2xs tracking-[0.06em] text-muted-foreground uppercase">kapak yok</p>
              <p className="max-w-[30ch] text-center text-2xs text-muted-foreground/85">
                Önizleme bulunamadı; tıklayarak detayları inceleyin.
              </p>
            </div>
          }
        />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <button
          type="button"
          onClick={() => onOpen(item, hasArticle ? 'reader' : 'detail')}
          className="block w-full min-w-0 cursor-pointer text-left focus-visible:outline-none"
        >
          <h3 className="line-clamp-2 text-[15px] leading-snug font-medium transition-colors hover:text-primary hover:underline">
            {item.title || item.url}
          </h3>
        </button>
        <Accession item={item} tags={tags} categories={categories} collectionLabel={collectionLabel} hasArticle={hasArticle} variant="card" />
        <div className="mt-auto flex items-center gap-1 border-t border-border pt-2">
          <DownloadControl
            item={item}
            progress={progress}
            meta={meta}
            onAudio={onAudio}
            onPickVideo={onPickVideo}
            onConvert={onConvert}
            onPlayMedia={onPlayMedia}
          />
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <ActionButtons item={item} hasArticle={hasArticle} onFavorite={onFavorite} onDelete={onDelete} onOpen={onOpen} />
          </div>
        </div>
      </div>
    </article>
  );
});
