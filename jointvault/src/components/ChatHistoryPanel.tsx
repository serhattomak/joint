import { useState } from 'react';
import { Pencil, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react';
import { cn } from 'cn';
import type { ChatSearchHit, ChatSession } from '@/lib/db/chat';
import { Button } from '@/components/ui/button';

interface ChatHistoryPanelProps {
  sessions: ChatSession[];
  activeId: string | null;
  searchResults: ChatSearchHit[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  onSearch: (q: string) => void;
  onOpenResult: (hit: ChatSearchHit) => void;
}

const day = 86_400_000;

/** Göreli tarih: bugün saat, bu hafta gün adı, sonrası gün/ay (mono). */
function relativeDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (Number.isNaN(diff)) return '';
  if (diff < day) return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(d);
  if (diff < 7 * day) return new Intl.DateTimeFormat('tr-TR', { weekday: 'short' }).format(d);
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' }).format(d);
}

function SessionRow({
  session,
  active,
  onSelect,
  onRename,
  onTogglePin,
  onDelete,
}: {
  session: ChatSession;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);

  const commit = (): void => {
    const t = draft.trim();
    if (t) onRename(t);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 px-2 py-1.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="h-7 min-w-0 flex-1 rounded-sm border border-ring bg-transparent px-2 text-sm focus:outline-none"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-sm px-2 py-1.5 transition-colors duration-100',
        active ? 'bg-card font-medium' : 'hover:bg-card/60',
      )}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm text-foreground">{session.title}</span>
        <span className="block text-2xs text-muted-foreground" data-num>
          {relativeDate(session.updated_at)}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          title={session.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'}
          onClick={onTogglePin}
          className="rounded-xs p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {session.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </button>
        <button
          type="button"
          title="Yeniden adlandır"
          onClick={() => {
            setDraft(session.title);
            setEditing(true);
          }}
          className="rounded-xs p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          title="Sil"
          onClick={onDelete}
          className="rounded-xs p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function ChatHistoryPanel({
  sessions,
  activeId,
  searchResults,
  onSelect,
  onCreate,
  onRename,
  onTogglePin,
  onDelete,
  onSearch,
  onOpenResult,
}: ChatHistoryPanelProps) {
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;

  const pinned = sessions.filter((s) => s.pinned);
  const rest = sessions.filter((s) => !s.pinned);

  const groups: { label: string; items: ChatSession[] }[] = [
    ...(pinned.length > 0 ? [{ label: 'Sabitlenenler', items: pinned }] : []),
    ...(rest.length > 0 ? [{ label: pinned.length > 0 ? 'Diğer' : 'Sohbetler', items: rest }] : []),
  ];

  return (
    <div className="flex h-full w-60 shrink-0 flex-col border-r border-border">
      <div className="flex shrink-0 items-center gap-1.5 p-2">
        <div className="settings-card flex h-8 min-w-0 flex-1 items-center gap-1.5 px-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              onSearch(e.target.value);
            }}
            placeholder="Sohbetlerde ara…"
            className="min-w-0 flex-1 bg-transparent text-xs placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <Button variant="ghost" size="sm" className="size-8 shrink-0 p-0" title="Yeni sohbet" onClick={onCreate}>
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {searching ? (
          searchResults.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">Sonuç yok</p>
          ) : (
            searchResults.map((hit) => (
              <button
                key={hit.messageId}
                type="button"
                onClick={() => onOpenResult(hit)}
                className="flex w-full flex-col gap-0.5 rounded-sm px-2 py-2 text-left transition-colors hover:bg-card/60"
              >
                <span className="truncate text-xs font-medium text-foreground">{hit.sessionTitle}</span>
                <span className="line-clamp-2 text-2xs text-muted-foreground">{hit.snippet}</span>
              </button>
            ))
          )
        ) : sessions.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Henüz sohbet yok. Yeni bir sohbet başlat.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.label} className="mb-2">
              <p className="px-2 py-1 text-2xs text-muted-foreground">{g.label}</p>
              <div className="divide-y divide-border/70">
                {g.items.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    active={s.id === activeId}
                    onSelect={() => onSelect(s.id)}
                    onRename={(title) => onRename(s.id, title)}
                    onTogglePin={() => onTogglePin(s.id)}
                    onDelete={() => onDelete(s.id)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
