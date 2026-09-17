import { useEffect, useRef, useState } from 'react';
import { FilePlus2, Play, RotateCcw, Scissors, Sparkles } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { listItems, updateItem } from '@/lib/db/client';
import type { Item } from '@/lib/db/types';
import { startSilence, useSilenceProgress, type SilencePreset } from '@/lib/silence';
import { basenameOf, silenceOutputPath } from '@/lib/convert-path';

interface SilenceSource {
  label: string;
  inputPath: string;
  itemId?: string;
}

interface SilenceOutput {
  label: string;
  path: string;
  preview: boolean;
}

interface SilenceToolProps {
  refreshKey: number;
  onDone: () => void;
}

const PRESETS: { id: SilencePreset; title: string; hint: string }[] = [
  { id: 'strict', title: 'Sıkı', hint: 'Kısa duraklamaları bile kırpar — tempolu sonuç.' },
  { id: 'normal', title: 'Normal', hint: 'Dengeli temizlik — çoğu kayıt için ideal.' },
  { id: 'loose', title: 'Gevşek', hint: 'Sadece bariz sessizlikleri kırpar — doğal akış.' },
];

export function SilenceTool({ refreshKey, onDone }: SilenceToolProps) {
  const [sources, setSources] = useState<SilenceSource[]>([]);
  const [selected, setSelected] = useState<SilenceSource | null>(null);
  const [preset, setPreset] = useState<SilencePreset>('normal');
  const [percent, setPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ranPreview, setRanPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<SilenceOutput[]>([]);
  const jobIdRef = useRef<string | null>(null);

  useEffect(() => {
    void listItems()
      .then((items: Item[]) => {
        const next = items
          .filter((it) => it.local_path)
          .map((it) => ({
            label: it.title || basenameOf(it.local_path as string),
            inputPath: it.local_path as string,
            itemId: it.id,
          }));
        setSources(next);
        setSelected((prev) => prev && next.some((s) => s.inputPath === prev.inputPath) ? prev : null);
      })
      .catch(() => setSources([]));
  }, [refreshKey]);

  useSilenceProgress((e) => {
    if (e.jobId === jobIdRef.current) setPercent(Math.round(e.percent));
  });

  const pickExternal = async (): Promise<void> => {
    try {
      const picked = await openDialog({ multiple: false });
      const path = typeof picked === 'string' ? picked : null;
      if (path) setSelected({ label: basenameOf(path), inputPath: path });
    } catch {
      /* vazgeçme sessiz */
    }
  };

  const run = async (preview: boolean): Promise<void> => {
    if (busy || !selected) return;
    const output = silenceOutputPath(selected.inputPath, preset, preview);
    setBusy(true);
    setError(null);
    setPercent(0);
    const res = await startSilence(selected.inputPath, output, preset, preview);
    jobIdRef.current = res.jobId;
    if (!res.ok) {
      setError(res.error ?? 'Sessizlik kırpma başarısız.');
      setBusy(false);
      return;
    }
    setPercent(100);
    if (!preview && selected.itemId) {
      try {
        await updateItem(selected.itemId, { converted_path: output });
      } catch (e) {
        setError(typeof e === 'string' ? e : 'Vault kaydı güncellenemedi.');
        setBusy(false);
        return;
      }
    }
    if (preview) setRanPreview(true);
    setOutputs((prev) => [{ label: basenameOf(output), path: output, preview }, ...prev]);
    setBusy(false);
    onDone();
  };

  const output = selected ? silenceOutputPath(selected.inputPath, preset, false) : '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Scissors className="size-5 text-primary" strokeWidth={2} />
        <h2 className="text-title">Sessizlik Kırpma</h2>
      </div>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <section className="flex min-h-0 flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
          <div className="flex items-center justify-between">
            <h3 className="text-micro font-medium text-muted-foreground">Kaynak</h3>
            <Button variant="ghost" size="sm" onClick={() => void pickExternal()}>
              <FilePlus2 /> Dosya seç
            </Button>
          </div>
          <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
            {sources.length === 0 && (
              <li className="px-1 py-6 text-center text-xs text-muted-foreground">
                Henüz kaynak yok. İndirilenler otomatik listelenir, harici dosya seçebilirsin.
              </li>
            )}
            {sources.map((s) => {
              const active = selected?.inputPath === s.inputPath;
              return (
                <li key={`${s.itemId ?? 'ext'}:${s.inputPath}`}>
                  <button
                    type="button"
                    onClick={() => !busy && setSelected(s)}
                    disabled={busy}
                    aria-pressed={active}
                    className={`w-full truncate rounded-lg px-2.5 py-2 text-left text-sm transition disabled:opacity-60 ${
                      active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex min-h-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card">
          {!selected ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Sessizlikleri temizlemek için soldan bir kaynak seç.
            </p>
          ) : (
            <>
              <h3 className="text-micro font-medium text-muted-foreground">
                Hazırlık seviyesi
              </h3>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Sessizlik kırpma hazırlığı">
                {PRESETS.map((p) => {
                  const active = preset === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => !busy && setPreset(p.id)}
                      disabled={busy}
                      className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition disabled:opacity-60 ${
                        active ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/30'
                      }`}
                    >
                      <span className="font-display text-[15px]">{p.title}</span>
                      <span className="text-xs text-muted-foreground">{p.hint}</span>
                    </button>
                  );
                })}
              </div>
              <p className="truncate font-mono text-xs text-muted-foreground" title={output}>
                → {output}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => void run(true)} disabled={busy}>
                  <Play /> {busy ? `%${percent} çalışıyor…` : '30sn önizle'}
                </Button>
                <Button onClick={() => void run(false)} disabled={busy}>
                  <Sparkles /> {busy ? `%${percent} temizleniyor…` : 'Temizle'}
                </Button>
                {error && (
                  <Button variant="outline" size="sm" onClick={() => void run(false)} disabled={busy}>
                    <RotateCcw /> Tekrar dene
                  </Button>
                )}
              </div>
              {busy && (
                <div className="h-1.5 overflow-hidden rounded bg-muted">
                  <div className="h-full rounded bg-primary transition-[width]" style={{ width: `${percent}%` }} />
                </div>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              {ranPreview && !busy && !error && (
                <p className="text-xs text-muted-foreground">
                  Önizleme hazır — ilk 30 saniyenin temizlenmiş hâli yukarıdaki listede. Beğendiysen Temizle ile tamamını üret.
                </p>
              )}
              {outputs.length > 0 && (
                <div className="flex flex-col gap-1 border-t border-border pt-3">
                  <h4 className="text-micro font-medium text-muted-foreground">
                    Bu oturumda üretilenler
                  </h4>
                  <ul className="flex flex-col gap-1">
                    {outputs.map((o) => (
                      <li key={o.path} className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{o.label}</p>
                          <p className="truncate font-mono text-xs text-muted-foreground">{o.path}</p>
                        </div>
                        {o.preview && (
                          <Badge variant="outline">önizleme</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
