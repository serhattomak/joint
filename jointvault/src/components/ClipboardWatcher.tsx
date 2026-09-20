import { useEffect, useRef, useState } from 'react';
import { Link2, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNotice } from '@/components/ui/notice';
import { readClipboardText } from '@/lib/clipboard';
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

function isDirectDownloadUrl(url: string): boolean {
  const clean = url.split('?')[0].toLowerCase();
  return /\.(zip|rar|7z|tar|gz|bz2|xz|iso|dmg|exe|msi|apk|pdf|mp4|mkv|avi|mov|mp3|flac|wav)$/i.test(clean);
}

// App açıkken (gizli pencerede bile JS çalışır) panoyu yoklar:
// platform linki veya dosya indirme linki görülürse kaydetme/indirme önerisi çıkarır.
export function ClipboardWatcher({
  onDone,
  onDownload,
}: {
  onDone: () => void;
  onDownload?: (url: string) => void;
}) {
  const [candidate, setCandidate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lastRef = useRef('');
  const dismissedRef = useRef<Set<string>>(new Set());
  const readWarnedRef = useRef(false);
  const notice = useNotice();

  useEffect(() => {
    const id = setInterval(() => {
      void (async () => {
        if (!isWatchEnabled() || candidate) return;
        const read = await readClipboardText();
        if (!read.ok) {
          /* İzleyici 2,5 sn'de bir okur; aynı hatayı her turda göstermek gürültü
             olur. Bir kez söyle, sonra sus — sessiz kalmak da yanlıştı. */
          if (!readWarnedRef.current) {
            readWarnedRef.current = true;
            notice.push({ text: `Pano izlenemiyor: ${read.error}`, tone: 'error' });
          }
          return;
        }
        const text = read.text.trim();
        if (!text || text === lastRef.current) return;
        lastRef.current = text;
        if (!/^https?:\/\//i.test(text)) return;
        const isPlatform = detectPlatform(text) !== 'other';
        const isFile = isDirectDownloadUrl(text);
        if (!isPlatform && !isFile) return;

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
  }, [candidate, notice]);

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

  const isFile = isDirectDownloadUrl(candidate);

  return (
    <div className="animate-rise fixed top-3 left-1/2 z-40 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2 shadow-lift">
      <Link2 className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 truncate text-sm">
        {isFile ? 'Panoda indirilebilir dosya var:' : 'Panoda link var:'}
      </p>
      <span className="hidden max-w-44 truncate font-mono text-xs text-muted-foreground sm:inline">
        {candidate}
      </span>
      {onDownload && (
        <Button
          size="sm"
          variant="secondary"
          className="gap-1 font-medium"
          onClick={() => {
            const url = candidate;
            dismiss();
            onDownload(url);
          }}
        >
          <Zap className="size-3.5 text-primary" /> İndir
        </Button>
      )}
      <Button size="sm" onClick={() => void save()} disabled={saving}>
        {saving ? '…' : 'Kasaya Ekle'}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={dismiss} aria-label="Yoksay">
        <X />
      </Button>
    </div>
  );
}
