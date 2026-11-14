import { useMemo, useState } from 'react';
import {
  FileText,
  FileType2,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Music,
  Presentation,
  Search,
  Sheet,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { ConversionSource } from '@/components/conversion/types';

const FAMILY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  document: FileText,
  spreadsheet: Sheet,
  presentation: Presentation,
  pdf: FileType2,
  image: ImageIcon,
  audio: Music,
  video: Film,
};

function formatBytes(size: number | null): string {
  if (size === null || size <= 0) return 'boyut bilinmiyor';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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

  return (
    <section className="settings-card flex min-h-0 flex-col">
      <header className="flex flex-col gap-2 border-b border-border/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">
            Kaynaklar
            <span data-num className="ml-1.5 text-2xs text-muted-foreground">
              {sources.length}
            </span>
          </h3>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dosya ekle"
              title="Dosya ekle"
              onClick={onAddFiles}
            >
              <FileText />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Klasör ekle"
              title="Klasör ekle"
              onClick={onAddFolder}
            >
              <FolderOpen />
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Kaynaklarda ara"
            className="h-7 pl-7 text-xs"
            aria-label="Kaynaklarda ara"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onSelectAll(filtered.map((source) => source.id))}
            disabled={filtered.length === 0 || busy}
            className="text-micro text-muted-foreground transition-colors hover:text-foreground disabled:opacity-45"
          >
            {allSelected ? 'Seçimi temizle' : 'Görünenleri seç'}
          </button>
          <span data-num className="text-2xs text-muted-foreground">
            {selected.size} seçili
          </span>
        </div>
      </header>

      {sources.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <FileText className="size-7 text-muted-foreground" />
          <p className="text-title">Dönüştürülecek dosya yok</p>
          <p className="max-w-[34ch] text-sm text-muted-foreground">
            Dosya ekle ya da bir klasör seç; arşivindeki yerel dosyalar da burada listelenir.
          </p>
          <Button size="sm" variant="outline" onClick={onAddFiles} className="mt-1">
            <FileText /> Dosya ekle
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Aramayla eşleşen kaynak yok.
        </p>
      ) : (
        <ul className="flex max-h-[32rem] flex-col divide-y divide-border/70 overflow-y-auto">
          {filtered.map((source) => {
            const Icon = FAMILY_ICON[source.family] ?? FileText;
            const active = selected.has(source.id);
            return (
              <li key={source.id} className="group flex items-center gap-1 pr-2">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => onToggle(source.id)}
                    disabled={busy}
                    className="size-3.5 shrink-0 accent-primary"
                    aria-label={`${source.name} seç`}
                  />
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{source.name}</span>
                    <span className="truncate font-mono text-2xs text-muted-foreground">
                      {source.ext.toUpperCase() || '—'} · {formatBytes(source.size)}
                      {source.origin === 'vault' ? ' · arşiv' : ' · harici'}
                    </span>
                  </span>
                </label>
                {source.origin === 'vault' && <Badge variant="outline">arşiv</Badge>}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${source.name} kaynağını kaldır`}
                  onClick={() => onRemove(source.id)}
                  disabled={busy}
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-0"
                >
                  <X />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
