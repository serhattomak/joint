import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Link2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RotateCw,
  Scissors,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { missingComponentText, parseMissingComponent } from '@/lib/components';
import type { DownloadJob } from '@/lib/db/client';
import type { Item } from '@/lib/db/types';
import { formatBytes } from '@/lib/downloads';
import { formatEta, formatSpeed, type ChunkProgress } from '@/lib/turbo_download';
import { categoryIcon, shortSource, stamp, type Transfer } from './model';

export interface TransferRowActions {
  toggleSelected: (key: string) => void;
  toggleExpanded: (key: string) => void;
  pause: (job: DownloadJob) => void;
  resume: (job: DownloadJob) => void;
  retryVault: (item: Item) => void;
  copyText: (text: string, label: string) => void;
  open: (path: string) => void;
  reveal: (path: string) => void;
  requestDelete: (jobs: DownloadJob[], items: Item[]) => void;
  installComponent: (id: string, retry: () => void) => void;
  openItem?: (item: Item) => void;
  convert?: (item: Item) => void;
  playMedia?: (item: Item) => void;
}

interface TransferRowProps {
  row: Transfer;
  selected: boolean;
  expanded: boolean;
  downloadDir: string | null;
  chunks: ChunkProgress[];
  actions: TransferRowActions;
}

export function TransferRow({ row, selected, expanded, downloadDir, chunks, actions }: TransferRowProps) {
  const isSelected = selected;
  const isOpen = expanded;
  const error = row.error;
  const missing = row.kind === 'turbo' ? parseMissingComponent(error) : null;
  const errorText = missing ? missingComponentText(missing) : error;
  const isDone = row.status === 'done';

  const primary = (() => {
    if (row.kind === 'turbo') {
      if (row.status === 'active') {
        return (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Duraklat"
            title="Duraklat"
            onClick={() => actions.pause(row.job)}
          >
            <Pause className="size-3.5 text-amber-500" />
          </Button>
        );
      }
      if (row.status === 'paused' || row.status === 'queued') {
        return (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Başlat"
            title="Başlat"
            onClick={() => actions.resume(row.job)}
          >
            <Play className="size-3.5 text-emerald-500" />
          </Button>
        );
      }
      if (row.status === 'error') {
        return (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Yeniden dene"
            title="Yeniden dene"
            onClick={() => actions.resume(row.job)}
          >
            <RotateCw className="size-3.5 text-primary" />
          </Button>
        );
      }
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs"
          aria-label="Dosyayı aç"
          onClick={() => actions.open(row.job.destination_path)}
        >
          <ExternalLink className="size-3.5" /> Aç
        </Button>
      );
    }

    if (row.status === 'error') {
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs"
          onClick={() => actions.retryVault(row.item)}
        >
          <RotateCw className="size-3.5" /> Dene
        </Button>
      );
    }
    if (row.status === 'done') {
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs"
          onClick={() => {
            if (actions.playMedia) actions.playMedia?.(row.item);
            else if (row.item.local_path) actions.open(row.item.local_path);
          }}
        >
          {actions.playMedia ? (
            <Play className="size-3 text-emerald-500 fill-emerald-500" />
          ) : (
            <ExternalLink className="size-3.5" />
          )}
          {actions.playMedia ? 'Oynat' : 'Aç'}
        </Button>
      );
    }
    return null;
  })();

  return (
    <div className="border-b border-border/70">
      <div
        className={`transfer-row cursor-pointer px-1.5 py-2.5 transition-colors ${
          isSelected ? 'bg-primary/5' : 'hover:bg-muted/30'
        } ${isDone ? 'is-done' : ''}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, input, a, label')) return;
          actions.toggleExpanded(row.key);
        }}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => actions.toggleSelected(row.key)}
          aria-label={`${row.title} seç`}
          className="tr-check size-3.5 shrink-0 cursor-pointer rounded-2xs border-border"
        />

        <span
          className={`tr-glyph flex size-7 shrink-0 items-center justify-center rounded-md border ${
            row.status === 'error'
              ? 'border-state-error/25 bg-state-error/10 text-state-error'
              : row.status === 'done'
                ? 'border-state-acquired/25 bg-state-acquired/10 text-state-acquired'
                : row.status === 'active'
                  ? 'border-primary/20 bg-primary/10 text-primary'
                  : row.status === 'paused'
                    ? 'border-amber-500/25 bg-amber-500/10 text-amber-500'
                    : 'border-border/40 bg-muted/60 text-muted-foreground'
          }`}
        >
          {row.status === 'error' ? (
            <TriangleAlert className="size-3.5" />
          ) : row.status === 'done' ? (
            <Check className="size-3.5" strokeWidth={2.5} />
          ) : (
            categoryIcon(row.category)
          )}
        </span>

        <span className="tr-name flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium leading-tight" title={row.title}>
            {row.title}
          </span>
          <span
            className="truncate font-mono text-2xs text-muted-foreground"
            title={`${row.source}${row.platform ? ` · ${row.platform}` : ''}`}
          >
            {row.status === 'error' && errorText ? (
              <span className="text-destructive">{errorText}</span>
            ) : (
              <>
                {shortSource(row.source)}
                <span className="px-1 opacity-60">·</span>
                {row.engine}
                <span className="px-1 opacity-60">·</span>
                {row.detail}
              </>
            )}
          </span>
        </span>

        <span className="tr-actions shrink-0">
          {primary}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={row.path ? 'Klasörde göster' : 'İndirme klasörünü aç'}
            title={row.path ? 'Klasörde göster' : 'İndirme klasörünü aç'}
            onClick={() => {
              if (row.path) actions.reveal(row.path);
              else if (downloadDir) actions.open(downloadDir);
            }}
          >
            <FolderOpen className="size-3.5 text-muted-foreground" />
          </Button>

          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Daha fazla eylem"
                  title="Daha fazla eylem"
                />
              }
            >
              <MoreHorizontal className="size-3.5 text-muted-foreground" />
            </MenuTrigger>
            <MenuContent align="end" className="min-w-48">
              <MenuItem onClick={() => actions.copyText(row.source, 'Bağlantı')}>
                <Link2 className="size-3.5" /> Bağlantıyı kopyala
              </MenuItem>
              {row.path && (
                <MenuItem onClick={() => actions.copyText(row.path!, 'Dosya yolu')}>
                  <Copy className="size-3.5" /> Dosya yolunu kopyala
                </MenuItem>
              )}
              {row.kind === 'vault' && row.status === 'done' && (
                <>
                  <MenuSeparator />
                  {actions.convert && row.item.local_path && (
                    <MenuItem onClick={() => actions.convert?.(row.item)}>
                      <Scissors className="size-3.5" /> Dönüştür / Kırp
                    </MenuItem>
                  )}
                  {actions.openItem && (
                    <MenuItem onClick={() => actions.openItem?.(row.item)}>
                      <Pencil className="size-3.5" /> Kaydı Aç
                    </MenuItem>
                  )}
                </>
              )}
              <MenuSeparator />
              <MenuItem
                onClick={() =>
                  actions.requestDelete(
                    row.kind === 'turbo' ? [row.job] : [],
                    row.kind === 'vault' ? [row.item] : [],
                  )
                }
              >
                <Trash2 className="size-3.5" /> Sil
              </MenuItem>
            </MenuContent>
          </Menu>

          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={isOpen ? 'Ayrıntıyı kapat' : 'Ayrıntıyı aç'}
            title={isOpen ? 'Ayrıntıyı kapat' : 'Ayrıntıyı aç'}
            onClick={() => actions.toggleExpanded(row.key)}
          >
            <ChevronDown
              className={`size-3.5 text-muted-foreground transition-transform duration-200 ${
                isOpen ? 'rotate-180' : ''
              }`}
            />
          </Button>
        </span>

        {!isDone && (
          <span className="tr-progress">
            <span className="flex items-baseline justify-between gap-2 font-mono text-2xs text-muted-foreground">
              <span data-num className="font-medium text-foreground">
                %{Math.round(row.progress)}
              </span>
              <span data-num className="truncate">
                {row.size > 0
                  ? `${formatBytes(row.downloaded)} / ${formatBytes(row.size)}`
                  : ''}
              </span>
            </span>
            <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <span
                className={`block h-full rounded-full transition-[width] duration-300 ${
                  row.status === 'error'
                    ? 'bg-destructive'
                    : row.status === 'paused'
                      ? 'bg-amber-500'
                      : 'bg-primary'
                }`}
                style={{ width: `${row.progress}%` }}
              />
            </span>
          </span>
        )}

        {!isDone ? (
          <span className="tr-metrics font-mono text-2xs text-muted-foreground">
            <span data-num className="truncate font-medium text-foreground">
              {row.kind === 'turbo'
                ? row.status === 'active'
                  ? `${formatSpeed(row.speed)}${row.eta > 0 ? ` · ${formatEta(row.eta)}` : ''}`
                  : row.status === 'queued'
                    ? 'Sırada'
                    : row.status === 'paused'
                      ? 'Duraklatıldı'
                      : 'Yeniden denenebilir'
                : [row.speedText, row.etaText ? `kalan ${row.etaText}` : null]
                    .filter(Boolean)
                    .join(' · ') || 'yt-dlp'}
            </span>
            <span className="truncate">
              {row.kind === 'turbo'
                ? row.detail
                : row.platform || row.engine}
            </span>
          </span>
        ) : (
          <span className="tr-metrics font-mono text-2xs text-muted-foreground">
            <span data-num>{stamp(row.createdAt)}</span>
            {row.size > 0 && <span data-num>{formatBytes(row.size)}</span>}
          </span>
        )}
      </div>

      {isOpen && (
        <div className="border-t border-border/60 bg-muted/25 px-1.5 py-2.5 lg:pl-[54px]">
          <div className="flex flex-col gap-2">
            {row.path && (
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-11 shrink-0 text-2xs text-muted-foreground">Hedef</span>
                <code
                  className="min-w-0 flex-1 truncate font-mono text-2xs"
                  title={row.path}
                >
                  {row.path}
                </code>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Dosya yolunu kopyala"
                  title="Dosya yolunu kopyala"
                  onClick={() => actions.copyText(row.path!, 'Dosya yolu')}
                >
                  <Copy className="size-3" />
                </Button>
              </div>
            )}
            {row.convertedPath && row.convertedPath !== row.path && (
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-11 shrink-0 text-2xs text-muted-foreground">Dönüşen</span>
                <code
                  className="min-w-0 flex-1 truncate font-mono text-2xs"
                  title={row.convertedPath}
                >
                  {row.convertedPath}
                </code>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Dönüşen dosya yolunu kopyala"
                  title="Dönüşen dosya yolunu kopyala"
                  onClick={() => actions.copyText(row.convertedPath!, 'Dosya yolu')}
                >
                  <Copy className="size-3" />
                </Button>
              </div>
            )}
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-11 shrink-0 text-2xs text-muted-foreground">Kaynak</span>
              <code className="min-w-0 flex-1 truncate font-mono text-2xs" title={row.source}>
                {row.source}
              </code>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Bağlantıyı kopyala"
                title="Bağlantıyı kopyala"
                onClick={() => actions.copyText(row.source, 'Bağlantı')}
              >
                <Link2 className="size-3" />
              </Button>
            </div>

            {row.kind === 'turbo' && row.status === 'active' && chunks.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-2xs text-muted-foreground">Parçalar</span>
                <div className="flex h-5 items-stretch gap-1">
                  {chunks.map((chunk) => (
                    <span key={chunk.id} className="relative flex-1 overflow-hidden rounded-xs bg-muted">
                      <span
                        className="absolute inset-y-0 left-0 bg-primary"
                        style={{ width: `${chunk.percent}%` }}
                      />
                    </span>
                  ))}
                </div>
              </div>
            )}

            {errorText && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-destructive/10 px-2 py-1.5">
                <p className="min-w-0 flex-1 font-mono text-2xs text-destructive">
                  Hata: {errorText}
                </p>
                {missing && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-2xs"
                    onClick={() =>
                      actions.installComponent(missing.id, () => {
                        if (row.kind === 'turbo') actions.resume(row.job);
                      })
                    }
                  >
                    <Download className="size-3" /> Bileşeni kur
                  </Button>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {row.kind === 'vault' && row.status === 'done' && actions.convert && row.item.local_path && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-2xs"
                  onClick={() => actions.convert?.(row.item)}
                >
                  <Scissors className="size-3" /> Dönüştür / Kırp
                </Button>
              )}
              {row.kind === 'vault' && actions.openItem && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-2xs"
                  onClick={() => actions.openItem?.(row.item)}
                >
                  <Pencil className="size-3" /> Kaydı aç
                </Button>
              )}
              {row.kind === 'turbo' && row.status === 'active' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-2xs"
                  onClick={() => actions.pause(row.job)}
                >
                  <Pause className="size-3" /> Duraklat
                </Button>
              )}
              <span className="ml-auto font-mono text-2xs text-muted-foreground">
                {row.kind === 'turbo' ? `#${row.id.slice(0, 8)}` : row.platform}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
