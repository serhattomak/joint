/* Hallmark · pre-emit critique: P5 H4 E5 S4 R5 V4 */
import { useState } from 'react';
import { ListFilter } from 'lucide-react';
import { PLATFORM_META, PLATFORM_ORDER } from '@/lib/platform';
import type { Category, Collection, Tag } from '@/lib/db/types';

interface FilterMenuProps {
  platform: string;
  collectionId: string;
  categoryId: string;
  tagId: string;
  collections: Collection[];
  categories: Category[];
  tags: Tag[];
  onPlatform: (p: string) => void;
  onCollection: (id: string) => void;
  onCategory: (id: string) => void;
  onTag: (id: string) => void;
  onClear: () => void;
  activeCount: number;
}

export function FilterMenu(props: FilterMenuProps) {
  const { collections, categories, tags, activeCount } = props;
  const [open, setOpen] = useState(false);

  const row = (active: boolean): string =>
    `flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
      active
        ? 'bg-secondary font-medium text-secondary-foreground'
        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
    }`;

  const section = (title: string, body: React.ReactNode): React.ReactNode => (
    <div className="flex flex-col gap-0.5">
      <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        {title}
      </p>
      {body}
    </div>
  );

  const listSection = (
    title: string,
    allLabel: string,
    allActive: boolean,
    onAll: () => void,
    items: { id: string; label: string; active: boolean; onPick: () => void }[],
  ): React.ReactNode =>
    section(
      title,
      <>
        <button type="button" onClick={onAll} className={row(allActive)}>
          {allLabel}
        </button>
        {items.length === 0 ? (
          <p className="px-2.5 text-xs text-muted-foreground">Henüz yok.</p>
        ) : (
          items.map((it) => (
            <button key={it.id} type="button" onClick={it.onPick} className={`${row(it.active)} truncate`}>
              <span className="truncate">{it.label}</span>
            </button>
          ))
        )}
      </>,
    );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Filtreler"
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition ${
          activeCount > 0
            ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
            : 'border-border text-muted-foreground hover:text-foreground'
        }`}
      >
        <ListFilter className="size-4" />
        Filtreler
        {activeCount > 0 && (
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-1.5 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-lift">
            {section(
              'Platform',
              <>
                <button type="button" onClick={() => props.onPlatform('all')} className={row(props.platform === 'all')}>
                  Tümü
                </button>
                {PLATFORM_ORDER.map((p) => (
                  <button key={p} type="button" onClick={() => props.onPlatform(p)} className={row(props.platform === p)}>
                    <span className={`size-2 rounded-full ${PLATFORM_META[p].dot}`} />
                    {PLATFORM_META[p].label}
                  </button>
                ))}
              </>,
            )}
            {listSection('Koleksiyon', 'Tümü', props.collectionId === 'all', () => props.onCollection('all'), collections.map((c) => ({
              id: c.id,
              label: c.name,
              active: props.collectionId === c.id,
              onPick: () => props.onCollection(c.id),
            })))}
            {listSection('Kategori', 'Tümü', props.categoryId === 'all', () => props.onCategory('all'), categories.map((c) => ({
              id: c.id,
              label: c.name,
              active: props.categoryId === c.id,
              onPick: () => props.onCategory(c.id),
            })))}
            {listSection('Etiket', 'Tümü', props.tagId === 'all', () => props.onTag('all'), tags.map((t) => ({
              id: t.id,
              label: `#${t.name}`,
              active: props.tagId === t.id,
              onPick: () => props.onTag(t.id),
            })))}
            <button
              type="button"
              onClick={() => {
                props.onClear();
                setOpen(false);
              }}
              className="mt-1.5 w-full rounded-lg px-2.5 py-1.5 text-center text-xs text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground"
            >
              Filtreleri temizle
            </button>
          </div>
        </>
      )}
    </div>
  );
}
