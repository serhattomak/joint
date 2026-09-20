/* Hallmark · pre-emit critique: P5 H4 E5 S4 R5 V4 */
import { useEffect, useRef, useState } from 'react';
import { Clapperboard, FilePlus2, RotateCcw } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrimEditor } from '@/components/TrimEditor';
import { listItems, updateItem } from '@/lib/db/client';
import type { Item } from '@/lib/db/types';
import { useComponentInstaller } from '@/components/ComponentInstaller';
import { startConvert, useConvertProgress, type ConvertOp } from '@/lib/convert';
import { OP_LABEL, basenameOf, outputPathFor } from '@/lib/convert-path';
import { missingComponentText, parseMissingComponent } from '@/lib/components';
import { describeError } from '@/lib/errors';
import { toVaultSources } from '@/lib/vault-sources';

interface StudioSource {
  label: string;
  inputPath: string;
  itemId?: string;
}

interface StudioOutput {
  label: string;
  path: string;
}

interface ConverterStudioProps {
  refreshKey: number;
  onDone: () => void;
}

export function ConverterStudio({ refreshKey, onDone }: ConverterStudioProps) {
  const [vaultSources, setVaultSources] = useState<StudioSource[]>([]);
  const [external, setExternal] = useState<StudioSource[]>([]);
  const [selected, setSelected] = useState<StudioSource | null>(null);
  const [op, setOp] = useState<ConvertOp>('mp4');
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [percent, setPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<StudioOutput[]>([]);
  const jobIdRef = useRef<string | null>(null);
  const installer = useComponentInstaller();

  useEffect(() => {
    void listItems()
      .then((items: Item[]) => setVaultSources(toVaultSources(items)))
      .catch(() => setVaultSources([]));
  }, [refreshKey]);

  useConvertProgress((e) => {
    if (e.jobId === jobIdRef.current) setPercent(Math.round(e.percent));
  });

  const pickExternal = async (): Promise<void> => {
    try {
      const picked = await openDialog({ multiple: false });
      if (typeof picked !== 'string' || !picked) return;
      const src: StudioSource = { label: basenameOf(picked), inputPath: picked };
      setExternal((prev) => (prev.some((s) => s.inputPath === picked) ? prev : [...prev, src]));
      setSelected(src);
    } catch {
      /* vazgeçme sessiz */
    }
  };

  const run = async (): Promise<void> => {
    if (!selected || busy) return;
    if (op === 'trim' && (!(from < to) || to <= 0)) {
      setError('Kırpma aralığı geçersiz: timeline üzerinden seç.');
      return;
    }
    const output = outputPathFor(selected.inputPath, op);
    setBusy(true);
    setError(null);
    setPercent(0);
    const res = await startConvert(
      selected.inputPath,
      output,
      op,
      op === 'trim' ? String(from) : undefined,
      op === 'trim' ? String(to) : undefined,
    );
    jobIdRef.current = res.jobId;
    if (!res.ok) {
      const missing = parseMissingComponent(res.error);
      if (missing) {
        // Eksik bileşen sessiz ölüm olmasın: kurulum akışını aç, kurulunca aynı işi otomatik dene.
        setBusy(false);
        const outcome = await installer.request(missing.id, () => void run());
        // İndirilemeyen bileşende (ör. whisper) diyalog açılmaz; dürüst metne düşülür.
        if (outcome === 'unavailable') setError(missingComponentText(missing));
        return;
      }
      setError(describeError(res.error, 'Dönüştürme başarısız.'));
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

  const sources = [...vaultSources, ...external];
  const output = selected ? outputPathFor(selected.inputPath, op) : '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Clapperboard className="size-5 text-primary" strokeWidth={2} />
        <h2 className="text-title">Dönüştürücü</h2>
      </div>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <section className="flex min-h-0 flex-col gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
          <div className="flex items-center justify-between">
            <h3 className="text-micro font-medium text-muted-foreground">Kaynaklar</h3>
            <Button variant="ghost" size="sm" onClick={() => void pickExternal()}>
              <FilePlus2 /> Dosya ekle
            </Button>
          </div>
          <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
            {sources.length === 0 && (
              <li className="px-1 py-6 text-center text-xs text-muted-foreground">
                Henüz kaynak yok. İndirilenler otomatik listelenir, harici dosya ekleyebilirsin.
              </li>
            )}
            {sources.map((s) => {
              const active = selected?.inputPath === s.inputPath;
              return (
                <li key={`${s.itemId ?? 'ext'}:${s.inputPath}`}>
                  <button
                    type="button"
                    onClick={() => !busy && setSelected(s)}
                    aria-pressed={active}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                      active
                        ? 'bg-secondary font-medium text-secondary-foreground'
                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    {!s.itemId && (
                      <Badge variant="outline">harici</Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex min-h-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card">
          {!selected ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Dönüştürmek için soldan bir kaynak seç.
            </p>
          ) : (
            <>
              <div className="min-w-0">
                <p className="truncate font-display text-[15px]">{selected.label}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{selected.inputPath}</p>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="İşlem">
                {(Object.keys(OP_LABEL) as ConvertOp[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setOp(k)}
                    aria-pressed={op === k}
                    disabled={busy}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                      op === k
                        ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {OP_LABEL[k]}
                  </button>
                ))}
              </div>
              {op === 'trim' && (
                <TrimEditor
                  key={selected.inputPath}
                  inputPath={selected.inputPath}
                  from={from}
                  to={to}
                  onFromChange={setFrom}
                  onToChange={setTo}
                  disabled={busy}
                />
              )}
              <p className="truncate font-mono text-xs text-muted-foreground" title={output}>
                → {output}
              </p>
              <div className="flex items-center gap-2">
                <Button onClick={() => void run()} disabled={busy || !selected}>
                  {busy ? `%${percent} dönüştürülüyor…` : 'Dönüştür'}
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
