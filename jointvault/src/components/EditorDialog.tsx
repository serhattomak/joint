import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { updateItem } from '@/lib/db/client';
import { startConvert, useConvertProgress } from '@/lib/convert';
import { TrimEditor } from '@/components/TrimEditor';

export interface EditorSource {
  label: string;
  inputPath: string;
  itemId?: string;
}

interface EditorDialogProps {
  source: EditorSource | null;
  onClose: () => void;
  onDone: () => void;
}

// ponytail: no node:path in browser bundle — plain string split handles / and \.
function trimOutputPath(inputPath: string): string {
  const i = Math.max(inputPath.lastIndexOf('/'), inputPath.lastIndexOf('\\'));
  const dir = i < 0 ? '' : inputPath.slice(0, i);
  const sep = i < 0 ? '/' : inputPath[i];
  const base = i < 0 ? inputPath : inputPath.slice(i + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot <= 0 ? base : base.slice(0, dot);
  const ext = dot <= 0 ? 'mp4' : base.slice(dot + 1);
  const name = `${stem}-trim.${ext}`;
  return dir ? `${dir}${sep}${name}` : name;
}

export function EditorDialog({ source, onClose, onDone }: EditorDialogProps) {
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(0);
  const [percent, setPercent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const convertJobRef = useRef<string | null>(null);

  useConvertProgress((e) => {
    if (e.jobId === convertJobRef.current) setPercent(Math.round(e.percent));
  });

  if (!source) return <Dialog open={false} onOpenChange={() => {}}><DialogContent /></Dialog>;

  const output = trimOutputPath(source.inputPath);

  const run = async (): Promise<void> => {
    if (busy) return;
    if (!(from < to) || to <= 0) {
      setError('Kırpma aralığı geçersiz: 0 ≤ başlangıç < bitiş olmalı.');
      return;
    }
    setBusy(true);
    setError(null);
    setPercent(0);
    // Editor always frame-accurate (slow re-encode); fast path stays in ConvertDialog.
    const res = await startConvert(source.inputPath, output, 'trim', String(from), String(to), true);
    convertJobRef.current = res.jobId;
    if (!res.ok) {
      setError(res.error ?? 'Kırpma başarısız.');
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
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Kırp</DialogTitle>
          <DialogDescription className="truncate" title={source.inputPath}>
            {source.label}
          </DialogDescription>
        </DialogHeader>
        <TrimEditor
          key={source.inputPath}
          inputPath={source.inputPath}
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
          disabled={busy}
        />
        <div className="flex flex-col gap-3">
          <p className="truncate text-xs text-muted-foreground" title={output}>
            Çıktı: {output}
          </p>
          {busy && (
            <div className="flex items-center gap-1.5" aria-label={`Kırpılıyor %{pct}`}>
              <div className="h-1 flex-1 overflow-hidden rounded bg-muted">
                <div className="h-full rounded bg-primary transition-[width]" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-2xs tabular-nums text-muted-foreground">%{pct}</span>
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
              {busy ? 'Kırpılıyor…' : 'Kırp'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
