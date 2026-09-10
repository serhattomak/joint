import { useEffect, useRef, useState } from 'react';
import { Link2, X } from 'lucide-react';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { Button } from '@/components/ui/button';
import { createItem, listItems } from '@/lib/db/client';
import { detectPlatform } from '@/lib/platform';
import { isKnownUrl } from '@/lib/urls';

export const CLIPBOARD_WATCH_KEY = 'jv-clipboard-watch';

export function isWatchEnabled(): boolean {
  return localStorage.getItem(CLIPBOARD_WATCH_KEY) !== 'off';
}

function canonicalKey(u: string): string {
  return u.trim().toLowerCase();
}

// App açıkken (gizli pencerede bile JS çalışır) panoyu yoklar:
// platform linki görülürse kaydetme önerisi çıkarır.
export function ClipboardWatcher({ onDone }: { onDone: () => void }) {
  const [candidate, setCandidate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lastRef = useRef('');
  const dismissedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const id = setInterval(() => {
      void (async () => {
        if (!isWatchEnabled() || candidate) return;
        let text = '';
        try {
          text = (await readText()).trim();
        } catch {
          return;
        }
        if (!text || text === lastRef.current) return;
        lastRef.current = text;
        if (!/^https?:\/\//i.test(text) || detectPlatform(text) === 'other') return;
        if (dismissedRef.current.has(canonicalKey(text))) return;
        try {
          const existing = (await listItems()).map((i) => i.url);
          if (isKnownUrl(existing, text)) return;
        } catch {
          return;
        }
        setCandidate(text);
      })();
    }, 2500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate]);

  if (!candidate) return null;

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await createItem({ url: candidate, platform: detectPlatform(candidate), title: null });
      dismissedRef.current.add(canonicalKey(candidate));
      setCandidate(null);
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const dismiss = (): void => {
    dismissedRef.current.add(canonicalKey(candidate));
    setCandidate(null);
  };

  return (
    <div className="animate-rise fixed top-3 left-1/2 z-40 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-lift">
      <Link2 className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 truncate text-sm">
        Panoda link var — kaydedilsin mi?
      </p>
      <span className="hidden max-w-48 truncate font-mono text-xs text-muted-foreground sm:inline">{candidate}</span>
      <Button size="sm" onClick={() => void save()} disabled={saving}>
        {saving ? '…' : 'Kaydet'}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={dismiss} aria-label="Yoksay">
        <X />
      </Button>
    </div>
  );
}
