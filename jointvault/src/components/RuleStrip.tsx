import { ChevronDown, ListFilter } from 'lucide-react';
import { cn } from 'cn';
import { Popover, PopoverContent, PopoverGroupLabel, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import { PLATFORM_META, PLATFORM_ORDER } from '@/lib/platform';
import type { Category, Collection, Tag } from '@/lib/db/types';
import type { ItemSort } from '@/lib/db/client';

/*
 * Kural şeridi — arşivin yürürlükteki kuralları gizli bir popover'da değil,
 * kalıcı ve okunur bir bantta durur: hangi filtre yürürlükte, nasıl sıralı,
 * kaç fiş var. Şerit bilgi taşır; süs değildir.
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

function FilterTrigger({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children?: React.ReactNode;
}) {
  return (
    <PopoverTrigger
      render={
        <button
          type="button"
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-xs whitespace-nowrap transition-colors duration-150 ease-paper',
            active
              ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        />
      }
    >
      {label}
      <ChevronDown aria-hidden className="size-3 opacity-70" />
      {children}
    </PopoverTrigger>
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
  const activeCount = [props.platform, props.collectionId, props.categoryId, props.tagId].filter(
    (v) => v !== 'all',
  ).length;

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-background px-4">
      <ListFilter aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />

      <Popover>
        <FilterTrigger label={activePlatform?.label ?? 'Platform'} active={!!activePlatform} />
        <PopoverContent>
          <PopoverTitle>Platform filtresi</PopoverTitle>
          <PopoverGroupLabel>Platform</PopoverGroupLabel>
          <OptionRow active={props.platform === 'all'} onClick={() => props.onPlatform('all')}>
            Tümü
          </OptionRow>
          {PLATFORM_ORDER.map((p) => (
            <OptionRow key={p} active={props.platform === p} onClick={() => props.onPlatform(p)}>
              <span aria-hidden className={`size-1.5 rounded-full ${PLATFORM_META[p].dot}`} />
              {PLATFORM_META[p].label}
            </OptionRow>
          ))}
        </PopoverContent>
      </Popover>

      <Popover>
        <FilterTrigger label={activeCollection?.name ?? 'Koleksiyon'} active={!!activeCollection} />
        <PopoverContent>
          <PopoverTitle>Koleksiyon filtresi</PopoverTitle>
          <PopoverGroupLabel>Koleksiyon</PopoverGroupLabel>
          <OptionRow active={props.collectionId === 'all'} onClick={() => props.onCollection('all')}>
            Tümü
          </OptionRow>
          {collections.length === 0 ? (
            <p className="px-2 py-2 text-micro text-muted-foreground">
              Henüz yok — kenar çubuğundaki Koleksiyonlar'dan ekle.
            </p>
          ) : (
            collections.map((c) => (
              <OptionRow key={c.id} active={props.collectionId === c.id} onClick={() => props.onCollection(c.id)}>
                <span className="truncate">{c.name}</span>
              </OptionRow>
            ))
          )}
        </PopoverContent>
      </Popover>

      <Popover>
        <FilterTrigger label={activeCategory?.name ?? 'Kategori'} active={!!activeCategory} />
        <PopoverContent>
          <PopoverTitle>Kategori filtresi</PopoverTitle>
          <PopoverGroupLabel>Kategori</PopoverGroupLabel>
          <OptionRow active={props.categoryId === 'all'} onClick={() => props.onCategory('all')}>
            Tümü
          </OptionRow>
          {categories.length === 0 ? (
            <p className="px-2 py-2 text-micro text-muted-foreground">Henüz yok — öğe kaydederken oluşur.</p>
          ) : (
            categories.map((c) => (
              <OptionRow key={c.id} active={props.categoryId === c.id} onClick={() => props.onCategory(c.id)}>
                <span className="truncate">{c.name}</span>
              </OptionRow>
            ))
          )}
        </PopoverContent>
      </Popover>

      <Popover>
        <FilterTrigger label={activeTag ? `#${activeTag.name}` : 'Etiket'} active={!!activeTag} />
        <PopoverContent>
          <PopoverTitle>Etiket filtresi</PopoverTitle>
          <PopoverGroupLabel>Etiket</PopoverGroupLabel>
          <OptionRow active={props.tagId === 'all'} onClick={() => props.onTag('all')}>
            Tümü
          </OptionRow>
          {tags.length === 0 ? (
            <p className="px-2 py-2 text-micro text-muted-foreground">Henüz yok — öğe kaydederken oluşur.</p>
          ) : (
            tags.map((t) => (
              <OptionRow key={t.id} active={props.tagId === t.id} onClick={() => props.onTag(t.id)}>
                <span className="truncate">#{t.name}</span>
              </OptionRow>
            ))
          )}
        </PopoverContent>
      </Popover>

      {activeCount > 0 && (
        <button
          type="button"
          onClick={props.onClear}
          className="shrink-0 text-xs text-muted-foreground underline-offset-3 transition-colors hover:text-foreground hover:underline"
        >
          Temizle ({activeCount})
        </button>
      )}

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
          {props.total.toLocaleString('tr-TR')} fiş
        </span>
      </div>
    </div>
  );
}
