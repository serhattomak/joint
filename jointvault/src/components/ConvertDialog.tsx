import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { updateItem } from '@/lib/db/client';
import { startConvert, useConvertProgress, type ConvertOp } from '@/lib/convert';
import { OP_LABEL, outputPathFor } from '@/lib/convert-path';

export interface ConvertSource {
  label: string;
  inputPath: string;
  itemId?: string;
}

interface ConvertDialogProps {
  source: ConvertSource | null;
  onClose: () => void;
  onDone: () => void;
}

export function ConvertDialog({ source, onClose, onDone }: ConvertDialogProps) {
  const [op, setOp] = useState<ConvertOp>('mp4');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [percent, setPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!source) return;
    setOp('mp4');
    setFrom('');
    setTo('');
    setPercent(0);
    setBusy(false);
    setError(null);
    jobIdRef.current = null;
  }, [source]);

  useConvertProgress((e) => {
    if (e.jobId === jobIdRef.current) setPercent(Math.round(e.percent));
  });

  if (!source) return <Dialog open={false} onOpenChange={() => {}}><DialogContent /></Dialog>;

  const output = outputPathFor(source.inputPath, op);

  const run = async (): Promise<void> => {
    if (busy) return;
    // Kırp: from/to saniye cinsinden sayı, from < to zorunlu.
    let f: string | undefined;
    let t: string | undefined;
    if (op === 'trim') {
      const nf = Number(from.trim().replace(',', '.'));
      const nt = Number(to.trim().replace(',', '.'));
      if (!Number.isFinite(nf) || !Number.isFinite(nt) || nf < 0 || nt <= 0 || nf >= nt) {
        setError('Kırpma aralığı geçersiz: sayı girin, başlangıç < bitiş olmalı.');
        return;
      }
      f = String(nf);
      t = String(nt);
    }
    setBusy(true);
    setError(null);
    setPercent(0);
    const res = await startConvert(source.inputPath, output, op, f, t);
    jobIdRef.current = res.jobId;
    if (!res.ok) {
      setError(res.error ?? 'Dönüştürme başarısız.');
      setBusy(false);
      return;
    }
    setPercent(100);
    try {
      if (source.itemId) await updateItem(source.itemId, { converted_path: output });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vault kaydı güncellenemedi.');
      setBusy(false);
      return;
    }
    setBusy(false);
    onDone();
    onClose();
  };

  const pct = Math.max(0, Math.min(100, percent));

  return (
    <Dialog open={source !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dönüştür</DialogTitle>
          <DialogDescription className="truncate" title={source.inputPath}>
            {source.label}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <select
            value={op}
            onChange={(e) => setOp(e.target.value as ConvertOp)}
            disabled={busy}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none disabled:opacity-60"
            aria-label="İşlem"
          >
            {(Object.keys(OP_LABEL) as ConvertOp[]).map((k) => (
              <option key={k} value={k}>
                {OP_LABEL[k]}
              </option>
            ))}
          </select>
          {op === 'trim' && (
            <div className="flex items-center gap-2">
              <Input
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="Başlangıç (sn)"
                inputMode="decimal"
                disabled={busy}
                aria-label="Başlangıç saniyesi"
              />
              <Input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="Bitiş (sn)"
                inputMode="decimal"
                disabled={busy}
                aria-label="Bitiş saniyesi"
              />
            </div>
          )}
          <p className="truncate text-xs text-muted-foreground" title={output}>
            Çıktı: {output}
          </p>
          {busy && (
            <div className="flex items-center gap-1.5" aria-label={`Dönüştürülüyor %{pct}`}>
              <div className="h-1 flex-1 overflow-hidden rounded bg-muted">
                <div className="h-full rounded bg-primary transition-[width]" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[11px] tabular-nums text-muted-foreground">%{pct}</span>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          {error && !busy ? (
            <Button onClick={() => void run()}>Tekrar dene</Button>
          ) : (
            <Button onClick={() => void run()} disabled={busy}>
              {busy ? 'Dönüştürülüyor…' : 'Dönüştür'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
