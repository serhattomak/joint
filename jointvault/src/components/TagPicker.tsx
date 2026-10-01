import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface TagPickerProps {
  selected: string[];
  onChange: (next: string[]) => void;
  loadNames: () => Promise<{ name: string }[]>;
  placeholder?: string;
}

/*
 * Mevcutlardan seç + yenilerini yazarak oluştur. Etiket ve kategori için ortak
 * (loadNames ile veri kaynağı değişir).
 *
 * Varsayılan olarak YALNIZCA bu kayda ait olanlar görünür — veritabanındaki tüm
 * etiketler ekrana dökülmez. Geri kalanlar tek bir `+N daha` düğmesinin ardında
 * durur; tıklanınca açılır, "Daha az" ile toplanır.
 */
export function TagPicker({ selected, onChange, loadNames, placeholder }: TagPickerProps) {
  const [existing, setExisting] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void loadNames().then((ns) => setExisting(ns.map((n) => n.name)));
  }, [loadNames]);

  const all = [...new Set([...existing, ...selected])];
  const others = all.filter((n) => !selected.includes(n));
  const visible = expanded ? all : selected;

  const toggle = (name: string): void =>
    onChange(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);

  const commitDraft = (): void => {
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...selected, ...parts])]);
    setExisting((prev) => [...new Set([...prev, ...parts])]);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2">
      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {visible.map((name) => {
            const active = selected.includes(name);
            /*
             * Etiket bir sınıflandırmadır, durum değil — bu yüzden damga değil Badge.
             * Hap biçimi yasak: Badge zaten 2px radius, mono 11px, 20px.
             * Seçili hâl dolgu değil ultramarin ton; sıra hâlinde dolu aksan dünyayı
             * panoya çevirirdi (Tek Damga Kuralı).
             */
            return (
              <Badge
                key={name}
                variant={active ? 'default' : 'outline'}
                className={active ? undefined : 'transition-colors hover:border-input hover:text-foreground'}
                render={
                  <button type="button" onClick={() => toggle(name)} aria-pressed={active} />
                }
              >
                #{name}
              </Badge>
            );
          })}

          {!expanded && others.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              title="Diğerlerini göster"
              className="rounded-xs border border-dashed border-border px-2 py-0.5 font-mono text-2xs text-muted-foreground transition-colors hover:border-input hover:text-foreground"
            >
              +{others.length} daha
            </button>
          )}

          {expanded && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded-xs px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Daha az
            </button>
          )}
        </div>
      )}
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
      />
    </div>
  );
}
