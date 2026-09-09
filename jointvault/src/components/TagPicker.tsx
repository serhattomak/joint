import { useEffect, useState } from 'react';
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
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggle(name)}
                aria-pressed={active}
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:border-input hover:text-foreground'
                }`}
              >
                #{name}
              </button>
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
