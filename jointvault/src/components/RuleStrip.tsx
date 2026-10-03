import { useState } from 'react';
import { ChevronDown, ListFilter, X } from 'lucide-react';
import { cn } from 'cn';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import { PLATFORM_META, PLATFORM_ORDER } from '@/lib/platform';
import type { Category, Collection, Tag } from '@/lib/db/types';
import type { ItemSort } from '@/lib/db/client';

/*
 * Kural şeridi — arşivin yürürlükteki kuralları görünen bir banttır.
 * Seçim tek bir "Filtrele" panelinden yapılır (her filtre aranabilir); ama
 * seçili filtreler burada çip olarak KALIR ve tek tıkla kaldırılır — yürürlükteki
 * kural gizli bir popover'a gömülmez (DESIGN · Kural Şeridi).
 */

const SORT_OPTIONS: readonly { value: ItemSort; label: string }[] = [
  { value: 'new', label: 'Yeni → eski' },
  { value: 'old', label: 'Eski → yeni' },
  { value: 'title', label: 'Başlık A → Z' },
  { value: 'title-desc', label: 'Başlık Z → A' },
];

interface RuleStripProps {
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
  sort: ItemSort;
  onSort: (s: ItemSort) => void;
  total: number;
}

interface Option {
  value: string;
  label: string;
  dot?: string;
}

interface FilterDef {
  key: string;
  label: string;
  options: Option[];
  value: string;
  onPick: (value: string) => void;
  dirty: boolean;
}

function OptionRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-sm transition-colors duration-100 ease-paper',
        active ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/* İki panelli filtre: solda filtre adları, sağda arama alanı + seçenekler. */
function FilterPanel({ filters }: { filters: FilterDef[] }) {
  const [activeKey, setActiveKey] = useState(filters[0]?.key ?? '');
  const [q, setQ] = useState('');

  const active = filters.find((f) => f.key === activeKey) ?? filters[0];
  if (!active) return null;

  const needle = q.trim().toLocaleLowerCase('tr');
  const options = needle
    ? active.options.filter((o) => o.label.toLocaleLowerCase('tr').includes(needle))
    : active.options;

  return (
    <div className="flex h-72">
      <div className="flex w-28 shrink-0 flex-col gap-0.5 border-r border-border p-1.5">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              setActiveKey(f.key);
              setQ('');
            }}
            aria-pressed={f.key === active.key}
            className={cn(
              'flex items-center justify-between gap-2 rounded-xs px-2 py-1.5 text-left text-sm transition-colors duration-100 ease-paper',
              f.key === active.key
                ? 'bg-muted font-medium'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <span className="truncate">{f.label}</span>
            {f.dirty && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="p-1.5">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`${active.label} ara…`}
            className="h-7 text-xs"
            autoFocus
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-1.5 pt-0">
          {options.length === 0 ? (
            <li className="px-2 py-3 text-xs text-muted-foreground">Bulunamadı.</li>
          ) : (
            options.map((o) => (
              <li key={o.value}>
                <OptionRow
                  active={o.value === active.value}
                  onClick={() => {
                    active.onPick(o.value);
                    setQ('');
                  }}
                >
                  {o.dot && <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${o.dot}`} />}
                  <span className="truncate">{o.label}</span>
                </OptionRow>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

export function RuleStrip(props: RuleStripProps) {
  const { collections, categories, tags } = props;
  const activeCollection = collections.find((c) => c.id === props.collectionId);
  const activeCategory = categories.find((c) => c.id === props.categoryId);
  const activeTag = tags.find((t) => t.id === props.tagId);
  const activePlatform =
    props.platform !== 'all'
      ? PLATFORM_META[props.platform as keyof typeof PLATFORM_META]
      : undefined;

  const filters: FilterDef[] = [
    {
      key: 'platform',
      label: 'Platform',
      dirty: props.platform !== 'all',
      value: props.platform,
      onPick: props.onPlatform,
      options: [
        { value: 'all', label: 'Tümü' },
        ...PLATFORM_ORDER.map((p) => ({ value: p, label: PLATFORM_META[p].label, dot: PLATFORM_META[p].dot })),
      ],
    },
    {
      key: 'collection',
      label: 'Koleksiyon',
      dirty: props.collectionId !== 'all',
      value: props.collectionId,
      onPick: props.onCollection,
      options: [
        { value: 'all', label: 'Tümü' },
        ...collections.map((c) => ({ value: c.id, label: c.name })),
      ],
    },
    {
      key: 'category',
      label: 'Kategori',
      dirty: props.categoryId !== 'all',
      value: props.categoryId,
      onPick: props.onCategory,
      options: [
        { value: 'all', label: 'Tümü' },
        ...categories.map((c) => ({ value: c.id, label: c.name })),
      ],
    },
    {
      key: 'tag',
      label: 'Etiket',
      dirty: props.tagId !== 'all',
      value: props.tagId,
      onPick: props.onTag,
      options: [
        { value: 'all', label: 'Tümü' },
        ...tags.map((t) => ({ value: t.id, label: `#${t.name}` })),
      ],
    },
  ];

  const activeCount = filters.filter((f) => f.dirty).length;

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (props.platform !== 'all')
    chips.push({ key: 'platform', label: activePlatform?.label ?? 'Platform', clear: () => props.onPlatform('all') });
  if (props.collectionId !== 'all')
    chips.push({ key: 'collection', label: activeCollection?.name ?? 'Koleksiyon', clear: () => props.onCollection('all') });
  if (props.categoryId !== 'all')
    chips.push({ key: 'category', label: activeCategory?.name ?? 'Kategori', clear: () => props.onCategory('all') });
  if (props.tagId !== 'all')
    chips.push({ key: 'tag', label: `#${activeTag?.name ?? 'etiket'}`, clear: () => props.onTag('all') });

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background px-4">
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm border px-2.5 text-xs whitespace-nowrap transition-colors duration-150 ease-paper',
                activeCount > 0
                  ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            />
          }
        >
          <ListFilter aria-hidden className="size-3.5" />
          <span>Filtrele</span>
          {activeCount > 0 && (
            <span className="rounded-full bg-primary/20 px-1.5 font-mono text-2xs">{activeCount}</span>
          )}
          <ChevronDown aria-hidden className="size-3 opacity-70" />
        </PopoverTrigger>
        <PopoverContent className="w-[22rem] p-0">
          <PopoverTitle>Filtreler</PopoverTitle>
          <FilterPanel filters={filters} />
        </PopoverContent>
      </Popover>

      {/* Yürürlükteki filtreler: seçim panelde, durum burada görünür kalır. */}
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.clear}
          title="Filtreyi kaldır"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-primary/40 bg-primary/10 px-2 text-xs font-medium text-foreground whitespace-nowrap transition-colors duration-150 ease-paper hover:bg-primary/15"
        >
          <span className="max-w-40 truncate">{c.label}</span>
          <X aria-hidden className="size-3 opacity-70" />
        </button>
      ))}

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <Select
          label="Sıralama"
          size="sm"
          className="w-[9.5rem]"
          value={props.sort}
          onValueChange={(v) => props.onSort(v as ItemSort)}
          options={SORT_OPTIONS}
        />
        <span data-num className="text-2xs text-muted-foreground">
          {props.total.toLocaleString('tr-TR')} kayıt
        </span>
      </div>
    </div>
  );
}
