import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface TagPickerProps {
  selected: string[];
  onChange: (next: string[]) => void;
  loadNames: () => Promise<{ name: string }[]>;
  placeholder?: string;
}

// Mevcutlerden seç + yenilerini yazarak oluştur. Etiket ve kategori
// için ortak kullanılır (loadNames ile veri kaynağı değişir).
export function TagPicker({ selected, onChange, loadNames, placeholder }: TagPickerProps) {
  const [existing, setExisting] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

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

  return (
    <div className="flex flex-col gap-2">
      {all.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {all.map((name) => {
            const active = selected.includes(name);
            /*
             * Etiket bir sınıflandırmadır, durum değil — bu yüzden damga değil Badge.
             * Hap biçimi yasak (DESIGN.md 251): Badge zaten 2px radius, mono 11px, 20px.
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
