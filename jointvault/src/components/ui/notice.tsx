import * as React from 'react';
import { Check, Info, X } from 'lucide-react';
import { cn } from 'cn';

/*
 * Bildirim — uygulamanın tek geri bildirim kanalı.
 * Modal açmadan onaylar ("kaydedildi"), pano yakalamayı duyurur, hataları gösterir.
 * Çok satırlı durum için `role="status"` bölgesi; odak çalınmaz.
 */
export interface Notice {
  id: string;
  text: string;
  tone?: 'info' | 'ok' | 'error';
  /** Tek satır eylem: geri al, aç, tekrar dene. */
  action?: { label: string; run: () => void };
  ttl?: number;
}

interface NoticeContextValue {
  push: (notice: Omit<Notice, 'id'>) => void;
}

const NoticeContext = React.createContext<NoticeContextValue | null>(null);

export function useNotice(): NoticeContextValue {
  const ctx = React.useContext(NoticeContext);
  if (!ctx) throw new Error('useNotice: NoticeProvider bulunamadı.');
  return ctx;
}

const TONE_CLASS: Record<NonNullable<Notice['tone']>, string> = {
  info: 'border-border text-foreground',
  ok: 'border-state-acquired/50 text-foreground',
  error: 'border-state-error/50 text-foreground',
};

const TONE_MARK: Record<
  NonNullable<Notice['tone']>,
  React.ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  info: Info,
  ok: Check,
  error: X,
};

export function NoticeProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Notice[]>([]);
  const timers = React.useRef(new Map<string, number>());

  const dismiss = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    const t = timers.current.get(id);
    if (t) {
      window.clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const push = React.useCallback(
    (notice: Omit<Notice, 'id'>) => {
      const id = crypto.randomUUID();
      setItems((prev) => [...prev.slice(-2), { ...notice, id }]);
      const ttl = notice.ttl ?? (notice.tone === 'error' ? 8000 : 3600);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), ttl),
      );
    },
    [dismiss],
  );

  React.useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  const value = React.useMemo(() => ({ push }), [push]);

  return (
    <NoticeContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col items-stretch gap-1.5"
      >
        {items.map((n) => {
          const Mark = TONE_MARK[n.tone ?? 'info'];
          return (
            <div
              key={n.id}
              className={cn(
                'animate-rise pointer-events-auto flex items-center gap-2 rounded-sm border bg-popover px-3 py-2 text-sm shadow-lift',
                TONE_CLASS[n.tone ?? 'info'],
              )}
            >
              <Mark className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2.5} aria-hidden />
              <span className="min-w-0 flex-1">{n.text}</span>
              {n.action && (
                <button
                  type="button"
                  onClick={() => {
                    n.action?.run();
                    dismiss(n.id);
                  }}
                  className="shrink-0 text-micro font-medium text-primary underline-offset-3 hover:underline"
                >
                  {n.action.label}
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(n.id)}
                aria-label="Bildirimi kapat"
                className="shrink-0 rounded-xs p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3.5" strokeWidth={2.5} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </NoticeContext.Provider>
  );
}
