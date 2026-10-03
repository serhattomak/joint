import { useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { searchItems } from '@/lib/db/client';
import type { Item } from '@/lib/db/types';
import { openExternal } from '@/lib/external';
import { PLATFORM_META, type Platform } from '@/lib/platform';

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: PaletteCommand[];
}

type Entry =
  | { kind: 'command'; id: string; label: string; hint?: string; icon: React.ReactNode; run: () => void }
  | { kind: 'item'; id: string; title: string; url: string; platform: string };

// Ctrl+K paleti: işlemler + SQL LIKE öğe araması (ilk 8).
export function CommandPalette({ open, onOpenChange, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setDebounced('');
    setItems([]);
    setActive(0);
  }, [open ]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const q = debounced.trim();
    if (!q) {
      setItems([]);
      return;
    }
    let live = true;
    void searchItems(q)
      .then((rows) => live && setItems(rows.slice(0, 8)))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [debounced]);

  const entries: Entry[] = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    const cmds: Entry[] = commands
      .filter((c) => !q || c.label.toLowerCase().includes(q))
      .map((c) => ({ kind: 'command' as const, ...c }));
    const found: Entry[] = items.map((it) => ({
      kind: 'item' as const,
      id: `item:${it.id}`,
      title: it.title || it.url,
      url: it.url,
      platform: it.platform,
    }));
    return [...cmds, ...found];
  }, [commands, debounced, items]);

  useEffect(() => {
    setActive(0);
  }, [debounced]);

  const runEntry = (e: Entry): void => {
    onOpenChange(false);
    if (e.kind === 'command') e.run();
    else void openExternal(e.url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18%] translate-y-0 sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader className="sr-only">
          <DialogTitle>Komut paleti</DialogTitle>
          <DialogDescription>İşlem ve kayıt ara</DialogDescription>
        </DialogHeader>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(entries.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              const target = entries[active];
              if (target) runEntry(target);
            }
          }}
          placeholder="Komut veya kayıt ara…  (↑↓ + Enter)"
          autoFocus
        />
        {entries.length > 0 && (
          <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {entries.map((e, i) => (
              <li key={e.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => runEntry(e)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                    i === active ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {e.kind === 'command' ? (
                    e.icon
                  ) : (
                    <span
                      className={`size-2 shrink-0 rounded-full ${PLATFORM_META[(e.platform as Platform)]?.dot ?? PLATFORM_META.other.dot}`}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {e.kind === 'command' ? e.label : e.title}
                  </span>
                  {e.kind === 'command' ? (
                    e.hint && <span className="shrink-0 text-xs opacity-70">{e.hint}</span>
                  ) : (
                    <FileText className="size-3.5 shrink-0 opacity-70" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
