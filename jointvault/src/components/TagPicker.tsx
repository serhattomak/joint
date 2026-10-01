import { useEffect, useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface TagPickerProps {
  selected: string[];
  onChange: (next: string[]) => void;
  loadNames: () => Promise<{ name: string }[]>;
  placeholder?: string;
}

/*
 * Etiket/kategori alanı — İKİ kipli.
 *
 * Görüntüleme (varsayılan): yalnızca bu kayda ait olanlar; veritabanındaki tüm
 * liste ekrana dökülmez. Ekleme/çıkarma "Düzenle" ile açılan ayrı bir alanda
 * yapılır. Böylece fiş okunur kalır, taksonomi duvarı görünmez.
 *
 * Düzenleme: mevcutların tamamı (seçilebilir) + yeni yazma alanı.
 * `loadNames` ile veri kaynağı değişir (etiket veya kategori).
 */
export function TagPicker({ selected, onChange, loadNames, placeholder }: TagPickerProps) {
  const [existing, setExisting] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    void loadNames().then((ns) => setExisting(ns.map((n) => n.name)));
  }, [loadNames]);

  const all = [...new Set([...existing, ...selected])];

  const toggle = (name: string): void =>
    onChange(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);

  const commitDraft = (): void => {
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...selected, ...parts])]);
    setExisting((prev) => [...new Set([...prev, ...parts])]);
    setDraft('');
  };

  if (!editing) {
    return (
      <div className="flex min-h-8 flex-wrap items-center gap-1.5">
        {selected.length === 0 ? (
          <span className="text-xs text-muted-foreground">Yok</span>
        ) : (
          selected.map((name) => (
            /* Etiket bir sınıflandırmadır, durum değil — damga değil Badge. */
            <Badge key={name} variant="default">
              #{name}
            </Badge>
          ))
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-xs px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <Pencil className="size-3" />
          Düzenle
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {all.length > 0 && (
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
          {all.map((name) => {
            const active = selected.includes(name);
            return (
              <Badge
                key={name}
                variant={active ? 'default' : 'outline'}
                className={active ? undefined : 'transition-colors hover:border-input hover:text-foreground'}
                render={<button type="button" onClick={() => toggle(name)} aria-pressed={active} />}
              >
                #{name}
              </Badge>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
            }
          }}
          onBlur={commitDraft}
          placeholder={placeholder ?? 'Yeni yaz, Enter\'a bas'}
          className="flex-1"
        />
        <Button variant="outline" size="sm" type="button" onClick={() => setEditing(false)}>
          <Check /> Bitti
        </Button>
      </div>
    </div>
  );
}
