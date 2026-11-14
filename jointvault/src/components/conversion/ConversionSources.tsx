import { useMemo, useState } from 'react';
import {
  FilePlus2,
  FileText,
  FileType2,
  Film,
  FolderPlus,
  Image as ImageIcon,
  Music,
  Presentation,
  Search,
  Sheet,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ConversionSource } from '@/components/conversion/types';
import { cn } from 'cn';

const FAMILY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  document: FileText,
  spreadsheet: Sheet,
  presentation: Presentation,
  pdf: FileType2,
  image: ImageIcon,
  audio: Music,
  video: Film,
};

const ORIGIN_LABEL: Record<ConversionSource['origin'], string> = {
  vault: 'arşiv',
  external: 'harici',
  folder: 'klasör',
};

const SIZE_NUMBER = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

function formatBytes(size: number | null): string {
  if (size === null) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${SIZE_NUMBER.format(size / 1024)} KB`;
  if (size < 1024 * 1024 * 1024) return `${SIZE_NUMBER.format(size / (1024 * 1024))} MB`;
  return `${SIZE_NUMBER.format(size / (1024 * 1024 * 1024))} GB`;
}

interface ConversionSourcesProps {
  sources: ConversionSource[];
  selected: Set<string>;
  busy: boolean;
  onToggle: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onRemove: (id: string) => void;
  onAddFiles: () => void;
  onAddFolder: () => void;
}

export function ConversionSources({
  sources,
  selected,
  busy,
  onToggle,
  onSelectAll,
  onRemove,
  onAddFiles,
  onAddFolder,
}: ConversionSourcesProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr');
    if (!needle) return sources;
    return sources.filter((source) =>
      `${source.name} ${source.ext} ${source.path}`.toLocaleLowerCase('tr').includes(needle),
    );
  }, [sources, query]);

  const allSelected = filtered.length > 0 && filtered.every((source) => selected.has(source.id));
  const selectedSize = useMemo(() => {
    const picked = sources.filter((source) => selected.has(source.id));
    const known = picked.filter((source) => source.size !== null);
    const total = known.reduce((sum, source) => sum + (source.size ?? 0), 0);
    return { total: known.length > 0 ? total : null, approx: known.length < picked.length };
  }, [sources, selected]);

  return (
    <section className="settings-card flex min-h-0 flex-col">
      <header className="flex flex-col gap-2 border-b border-border/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">
            Kaynaklar
            <span data-num className="ml-1.5 font-mono text-2xs text-muted-foreground">
              {sources.length}
            </span>
          </h3>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dosya ekle"
              title="Dosya ekle"
              onClick={onAddFiles}
              disabled={busy}
            >
              <FilePlus2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Klasör ekle"
              title="Klasör ekle"
              onClick={onAddFolder}
              disabled={busy}
            >
              <FolderPlus />
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Kaynaklarda ara"
            className={cn('h-7 pl-7 text-xs', query && 'pr-7')}
            aria-label="Kaynaklarda ara"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Aramayı temizle"
              className="absolute top-1/2 right-0.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-xs text-muted-foreground transition-colors duration-150 ease-out hover:bg-muted hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onSelectAll(filtered.map((source) => source.id))}
            disabled={filtered.length === 0 || busy}
            className="py-1 text-micro text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground disabled:opacity-45"
          >
            {allSelected ? 'Görünenleri temizle' : 'Görünenleri seç'}
          </button>
          <span className="text-2xs text-muted-foreground">
            <span data-num>
              {selected.size}/{sources.length}
            </span>{' '}
            seçili
          </span>
        </div>
      </header>

      {sources.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <FilePlus2 className="size-7 text-muted-foreground" />
          <p className="text-title text-balance">Dönüştürülecek dosya yok</p>
          <p className="max-w-[34ch] text-sm text-muted-foreground">
            Dosya ekle ya da bir klasör seç; arşivindeki yerel dosyalar da burada listelenir.
          </p>
          <Button size="sm" variant="outline" onClick={onAddFiles} className="mt-1">
            <FilePlus2 /> Dosya ekle
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">Aramayla eşleşen kaynak yok.</p>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="py-1 text-micro text-primary transition-opacity duration-150 ease-out hover:opacity-80"
          >
            Aramayı temizle
          </button>
        </div>
      ) : (
        <ul
          className="flex max-h-[30rem] flex-col divide-y divide-border/70 overflow-y-auto"
          aria-label="Kaynaklar"
        >
          {filtered.map((source) => {
            const Icon = FAMILY_ICON[source.family] ?? FileText;
            const active = selected.has(source.id);
            return (
              <li
                key={source.id}
                className={cn(
                  'group flex items-center gap-1 pr-1.5 transition-colors duration-150 ease-out',
                  active && 'bg-primary/[0.045]',
                )}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => onToggle(source.id)}
                    disabled={busy}
                    className="size-3.5 shrink-0 accent-primary"
                    aria-label={`${source.name} seç`}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 ease-out [&_svg]:size-3.5',
                      active
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border/70 bg-background text-muted-foreground',
                    )}
                  >
                    <Icon />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm" title={source.path}>
                      {source.name}
                    </span>
                    <span className="flex min-w-0 items-baseline gap-1 truncate text-2xs text-muted-foreground">
                      <span data-num className="shrink-0 font-mono uppercase">
                        {source.ext || '—'}
                      </span>
                      <span aria-hidden>·</span>
                      <span
                        data-num
                        className="shrink-0"
                        title={source.size === null ? 'Boyut bilinmiyor' : undefined}
                      >
                        {formatBytes(source.size)}
                      </span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{ORIGIN_LABEL[source.origin]}</span>
                    </span>
                  </span>
                </label>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${source.name} kaynağını kaldır`}
                  title="Kaldır"
                  onClick={() => onRemove(source.id)}
                  disabled={busy}
                  className="opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-0"
                >
                  <X />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {sources.length > 0 && (
        <footer className="mt-auto flex items-center justify-between gap-2 border-t border-border/70 px-3 py-2">
          <span className="text-2xs text-muted-foreground">Seçili</span>
          {selectedSize.total === null || selected.size === 0 ? (
            <span className="text-2xs text-muted-foreground">
              {selected.size === 0 ? '—' : 'boyut bilinmiyor'}
            </span>
          ) : (
            <span data-num className="font-mono text-2xs text-muted-foreground">
              {selectedSize.approx ? '≈ ' : ''}
              {formatBytes(selectedSize.total)}
            </span>
          )}
        </footer>
      )}
    </section>
  );
}
