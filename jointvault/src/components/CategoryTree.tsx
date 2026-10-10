import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from 'cn';
import { expandedForSearch } from '@/lib/taxonomy-view';
import type { CategoryTreeNode } from '@/lib/taxonomy-view';

/*
 * Kategori ağacı — N seviyeye açık açılır/kapanır liste.
 *
 * Eşleşen düğümün kendisi değil, ona giden ATALAR geçici olarak açılır:
 * `expandedForSearch` saf katmanda hesaplar, bileşen yalnızca kararı uygular.
 * Kullanıcının elle açtıklarıyla birleşir ki arama sırasında eşleşme asla
 * kapanmış bir üstün altında gizli kalmasın.
 */

/** Ortak seçenek satırı — filtre paneli ve ağaç aynı dili konuşur. */
export function OptionRow({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-sm transition-colors duration-100 ease-paper',
        active ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Arama süzgeci: eşleşen düğümü ve eşleşmeye giden atalarını korur.
 * Eşleşen düğümün eşleşmeyen torunları düşer (iki seviyeli eski davranışla aynı).
 */
function filterTree(nodes: CategoryTreeNode[], needle: string): CategoryTreeNode[] {
  const out: CategoryTreeNode[] = [];
  for (const node of nodes) {
    const children = filterTree(node.children, needle);
    if (children.length > 0 || node.name.toLocaleLowerCase('tr').includes(needle)) {
      out.push({ ...node, children });
    }
  }
  return out;
}

interface CategoryTreeProps {
  nodes: CategoryTreeNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  search: string;
  /** Filtresiz satırın etiketi ("Tüm kategoriler"). */
  emptyLabel: string;
}

export function CategoryTree({ nodes, selectedId, onSelect, search, emptyLabel }: CategoryTreeProps) {
  const [manual, setManual] = useState<Set<string>>(new Set());
  const needle = search.trim().toLocaleLowerCase('tr');
  const filtered = needle ? filterTree(nodes, needle) : nodes;
  // Arama kaybolunca manuel durum geri gelir; autoOpen yalnızca geçici.
  const autoOpen = expandedForSearch(nodes, search);

  const isOpen = (id: string) => manual.has(id) || autoOpen.has(id);
  const toggle = (id: string) =>
    setManual((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderNodes = (list: CategoryTreeNode[], depth: number): React.ReactNode =>
    list.map((node) => {
      const hasChildren = node.children.length > 0;
      const open = hasChildren && isOpen(node.id);
      return (
        <li key={node.id}>
          <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggle(node.id)}
                aria-expanded={open}
                aria-label={open ? 'Kapat' : 'Aç'}
                className="grid size-5 shrink-0 place-items-center rounded-xs text-muted-foreground transition-colors duration-100 ease-paper hover:text-foreground"
              >
                {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              </button>
            ) : (
              <span className="size-5 shrink-0" aria-hidden />
            )}
            <OptionRow
              active={selectedId === node.id}
              onClick={() => onSelect(node.id)}
              className="flex-1"
            >
              <span className="truncate">{node.name}</span>
              {hasChildren && (
                <span className="ml-auto shrink-0 text-2xs text-muted-foreground">
                  {node.children.length}
                </span>
              )}
            </OptionRow>
          </div>
          {open && <ul>{renderNodes(node.children, depth + 1)}</ul>}
        </li>
      );
    });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {filtered.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">Bulunamadı.</p>
      ) : (
        <ul className="divide-y divide-border/70">
          <li>
            <OptionRow active={selectedId === 'all'} onClick={() => onSelect('all')}>
              <span className="truncate text-muted-foreground">{emptyLabel}</span>
            </OptionRow>
          </li>
          {renderNodes(filtered, 0)}
        </ul>
      )}
    </div>
  );
}
