import { useEffect, useRef, useState } from 'react';
import { FilePlus2, Film, RotateCcw, Sparkles } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Button } from '@/components/ui/button';
import { TrimEditor } from '@/components/TrimEditor';
import { listItems, updateItem } from '@/lib/db/client';
import type { Item } from '@/lib/db/types';
import { startGif, useGifProgress, type GifFormat } from '@/lib/gif';
import { basenameOf, gifOutputPath } from '@/lib/convert-path';

interface GifSource {
  label: string;
  inputPath: string;
  itemId?: string;
}

interface GifOutput {
  label: string;
  path: string;
}

interface GifToolProps {
  refreshKey: number;
  onDone: () => void;
}

const WIDTHS = [320, 480, 640];
const FPSES = [10, 12, 15];
const MAX_SECS: Record<GifFormat, number> = { gif: 15, webm: 30 };

export function GifTool({ refreshKey, onDone }: GifToolProps) {
  const [sources, setSources] = useState<GifSource[]>([]);
  const [selected, setSelected] = useState<GifSource | null>(null);
  const [format, setFormat] = useState<GifFormat>('gif');
  const [width, setWidth] = useState(480);
  const [fps, setFps] = useState(12);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [percent, setPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<GifOutput[]>([]);
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
        setSelected((prev) => (prev && next.some((s) => s.inputPath === prev.inputPath) ? prev : null));
      })
      .catch(() => setSources([]));
  }, [refreshKey]);

  useGifProgress((e) => {
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

  const segLen = to - from;
  const limit = MAX_SECS[format];
  const overLimit = segLen > limit;

  const run = async (): Promise<void> => {
    if (busy || !selected) return;
    if (!(to > from)) {
      setError('Önce zaman çizelgesinden bir aralık seç (bitiş başlangıçtan büyük olmalı).');
      return;
    }
    if (overLimit) {
      const label = format === 'gif' ? 'GIF' : 'WebM';
      setError(`${label} en fazla ${limit} saniyelik bölümden üretilebilir (seçili: ${segLen.toFixed(1)} sn). Aralığı kısalt.`);
      return;
    }
    const output = gifOutputPath(selected.inputPath, format);
    setBusy(true);
    setError(null);
    setPercent(0);
    const res = await startGif(selected.inputPath, output, { format, from, to, width, fps });
    jobIdRef.current = res.jobId;
    if (!res.ok) {
      setError(res.error ?? 'GIF/WebM üretimi başarısız.');
      setBusy(false);
      return;
    }
    setPercent(100);
    if (selected.itemId) {
      try {
        await updateItem(selected.itemId, { converted_path: output });
      } catch (e) {
        setError(typeof e === 'string' ? e : 'Vault kaydı güncellenemedi.');
        setBusy(false);
        return;
      }
    }
    setOutputs((prev) => [{ label: basenameOf(output), path: output }, ...prev]);
    setBusy(false);
    onDone();
  };

  const output = selected ? gifOutputPath(selected.inputPath, format) : '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Film className="size-5 text-primary" strokeWidth={2} />
        <h2 className="text-title">GIF / WebM</h2>
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
              Döngü yapmak için soldan bir kaynak seç.
            </p>
          ) : (
            <>
              <TrimEditor
                inputPath={selected.inputPath}
                from={from}
                to={to}
                onFromChange={setFrom}
                onToChange={setTo}
                disabled={busy}
              />
              <h3 className="text-micro font-medium text-muted-foreground">Biçim</h3>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Çıktı biçimi">
                {(['gif', 'webm'] as GifFormat[]).map((f) => {
                  const active = format === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => !busy && setFormat(f)}
                      disabled={busy}
                      className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition disabled:opacity-60 ${
                        active ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/30'
                      }`}
                    >
                      <span className="font-display text-[15px]">{f === 'gif' ? 'GIF' : 'WebM'}</span>
                      <span className="text-xs text-muted-foreground">
                        {f === 'gif' ? 'Paletli, her yerde oynar — en fazla 15 sn.' : 'Küçük VP9 video — en fazla 30 sn.'}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  Genişlik
                  <select
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value))}
                    disabled={busy}
                    aria-label="Çıktı genişliği"
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                  >
                    {WIDTHS.map((w) => (
                      <option key={w} value={w}>
                        {w}px
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  Kare hızı
                  <select
                    value={fps}
                    onChange={(e) => setFps(Number(e.target.value))}
                    disabled={busy}
                    aria-label="Saniyedeki kare sayısı"
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                  >
                    {FPSES.map((f) => (
                      <option key={f} value={f}>
                        {f} fps
                      </option>
                    ))}
                  </select>
                </label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  Seçim: {segLen.toFixed(1)} sn / en fazla {limit} sn
                </span>
              </div>
              {overLimit && (
                <p className="text-sm text-destructive">
                  Seçili bölüm {limit} saniyeden uzun — {format === 'gif' ? 'GIF' : 'WebM'} için aralığı kısalt.
                </p>
              )}
              <p className="truncate font-mono text-xs text-muted-foreground" title={output}>
                → {output}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => void run()} disabled={busy || overLimit}>
                  <Sparkles /> {busy ? `%${percent} üretiliyor…` : 'Üret'}
                </Button>
                {error && (
                  <Button variant="outline" size="sm" onClick={() => void run()} disabled={busy}>
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
              {outputs.length > 0 && (
                <div className="flex flex-col gap-1 border-t border-border pt-3">
                  <h4 className="text-micro font-medium text-muted-foreground">
                    Bu oturumda üretilenler
                  </h4>
                  <ul className="flex flex-col gap-1">
                    {outputs.map((o) => (
                      <li key={o.path} className="min-w-0">
                        <p className="truncate text-sm">{o.label}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{o.path}</p>
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
