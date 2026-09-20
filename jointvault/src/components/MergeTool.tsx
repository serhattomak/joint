import { useEffect, useRef, useState } from 'react';
import { Combine, FilePlus2, GripVertical, Plus, RotateCcw, X } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { listItems, updateItem } from '@/lib/db/client';
import type { Item } from '@/lib/db/types';
import { startMerge, useMergeProgress } from '@/lib/merge';
import { basenameOf, mergeOutputPath } from '@/lib/convert-path';
import { useComponentInstaller } from '@/components/ComponentInstaller';
import { missingComponentText, parseMissingComponent } from '@/lib/components';
import { describeError } from '@/lib/errors';
import { toVaultSources } from '@/lib/vault-sources';

interface MergeSource {
  label: string;
  inputPath: string;
  itemId?: string;
}

interface MergeOutput {
  label: string;
  path: string;
}

interface MergeToolProps {
  refreshKey: number;
  onDone: () => void;
}

export function MergeTool({ refreshKey, onDone }: MergeToolProps) {
  const [vaultSources, setVaultSources] = useState<MergeSource[]>([]);
  const [queue, setQueue] = useState<MergeSource[]>([]);
  const [percent, setPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<MergeOutput[]>([]);
  const jobIdRef = useRef<string | null>(null);
  const dragFromRef = useRef<number | null>(null);
  const installer = useComponentInstaller();

  useEffect(() => {
    void listItems()
      .then((items: Item[]) => setVaultSources(toVaultSources(items)))
      .catch(() => setVaultSources([]));
  }, [refreshKey]);

  useMergeProgress((e) => {
    if (e.jobId === jobIdRef.current) setPercent(Math.round(e.percent));
  });

  const inQueue = (p: string): boolean => queue.some((q) => q.inputPath === p);

  const addToQueue = (src: MergeSource): void => {
    if (busy || inQueue(src.inputPath)) return;
    setQueue((prev) => [...prev, src]);
  };

  const removeFromQueue = (path: string): void => {
    if (busy) return;
    setQueue((prev) => prev.filter((q) => q.inputPath !== path));
  };

  const move = (from: number, to: number): void => {
    if (from === to) return;
    setQueue((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const pickExternal = async (): Promise<void> => {
    try {
      const picked = await openDialog({ multiple: true });
      const paths = Array.isArray(picked) ? picked.filter((p): p is string => typeof p === 'string') : [];
      for (const p of paths) {
        if (p && !inQueue(p)) setQueue((prev) => [...prev, { label: basenameOf(p), inputPath: p }]);
      }
    } catch {
      /* vazgeçme sessiz */
    }
  };

  const run = async (): Promise<void> => {
    if (busy) return;
    if (queue.length < 2) {
      setError('Birleştirmek için en az 2 dosya gerekli: soldan kaynak ekle.');
      return;
    }
    const output = mergeOutputPath(queue[0].inputPath);
    setBusy(true);
    setError(null);
    setPercent(0);
    const res = await startMerge(
      queue.map((q) => q.inputPath),
      output,
    );
    jobIdRef.current = res.jobId;
    if (!res.ok) {
      const missing = parseMissingComponent(res.error);
      if (missing) {
        // Eksik bileşen: kurulum akışını aç; kurulunca birleştirmeyi otomatik yeniden dene.
        setBusy(false);
        const outcome = await installer.request(missing.id, () => void run());
        // İndirilemeyen bileşende diyalog açılmaz; dürüst metne düşülür.
        if (outcome === 'unavailable') setError(missingComponentText(missing));
        return;
      }
      setError(describeError(res.error, 'Birleştirme başarısız.'));
      setBusy(false);
      return;
    }
    setPercent(100);
    const vaultOwner = queue.find((q) => q.itemId);
    if (vaultOwner?.itemId) {
      try {
        await updateItem(vaultOwner.itemId, { converted_path: output });
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

  const output = queue.length > 0 ? mergeOutputPath(queue[0].inputPath) : '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Combine className="size-5 text-primary" strokeWidth={2} />
        <h2 className="text-title">Birleştir</h2>
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
            {vaultSources.length === 0 && (
              <li className="px-1 py-6 text-center text-xs text-muted-foreground">
                Henüz kaynak yok. İndirilenler otomatik listelenir, harici dosya ekleyebilirsin.
              </li>
            )}
            {vaultSources.map((s) => {
              const added = inQueue(s.inputPath);
              return (
                <li
                  key={`${s.itemId ?? 'ext'}:${s.inputPath}`}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <button
                    type="button"
                    onClick={() => addToQueue(s)}
                    disabled={busy || added}
                    aria-label={`${s.label} dosyasını sıraya ekle`}
                    className="shrink-0 rounded-md border border-border p-1 transition hover:text-foreground disabled:opacity-40"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="flex min-h-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card">
          {queue.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Birleştirmek için soldan en az 2 kaynak ekle. Sırayı sürükleyerek değiştirebilirsin.
            </p>
          ) : (
            <>
              <h3 className="text-micro font-medium text-muted-foreground">
                Birleşme sırası ({queue.length})
              </h3>
              <ol className="flex flex-col gap-1">
                {queue.map((q, i) => (
                  <li
                    key={q.inputPath}
                    draggable={!busy}
                    onDragStart={() => {
                      dragFromRef.current = i;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = dragFromRef.current;
                      dragFromRef.current = null;
                      if (from !== null) move(from, i);
                    }}
                    onDragEnd={() => {
                      dragFromRef.current = null;
                    }}
                    className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-sm"
                  >
                    <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" />
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-2xs font-medium text-secondary-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{q.label}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {q.inputPath}
                      </span>
                    </span>
                    {!q.itemId && (
                      <Badge variant="outline">harici</Badge>
                    )}
                    <button
                      type="button"
                      onClick={() => removeFromQueue(q.inputPath)}
                      disabled={busy}
                      aria-label={`${q.label} dosyasını sıradan çıkar`}
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ol>
              <p className="truncate font-mono text-xs text-muted-foreground" title={output}>
                → {output}
              </p>
              <div className="flex items-center gap-2">
                <Button onClick={() => void run()} disabled={busy || queue.length < 2}>
                  {busy ? `%${percent} birleştiriliyor…` : 'Birleştir'}
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
