import { useEffect, useRef, useState } from 'react';
import { Captions, FilePlus2, RotateCcw, Sparkles } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { listItems, updateItem } from '@/lib/db/client';
import type { Item } from '@/lib/db/types';
import {
  embedSubtitle,
  extractSubtitle,
  getWhisperModel,
  getWhisperStatus,
  startTranscribe,
  useWhisperProgress,
  type TranscriptData,
  type WhisperLang,
  type WhisperStatus,
} from '@/lib/whisper';
import { basenameOf, embedOutputPath, splitPath, stemOf, transcriptSrtPath } from '@/lib/convert-path';

interface SubtitleSource {
  label: string;
  inputPath: string;
  itemId?: string;
}

interface SubtitleOutput {
  label: string;
  path: string;
  kind: 'gömülü' | 'çıkarılan';
}

interface SubtitleToolProps {
  refreshKey: number;
  onDone: () => void;
}

type BusyKind = '' | 'transcribe' | 'embed' | 'extract';

const LANGS: { id: WhisperLang; label: string }[] = [
  { id: 'auto', label: 'Otomatik' },
  { id: 'tr', label: 'Türkçe' },
  { id: 'en', label: 'İngilizce' },
];

// Çıkarılan altyazı: <stem>-cikartilmis.srt (transkript yolundan ayrı, çakışmasın).
function extractSrtPath(videoPath: string): string {
  const { dir, sep, base } = splitPath(videoPath);
  const { stem } = stemOf(base);
  const name = `${stem}-cikartilmis.srt`;
  return dir ? `${dir}${sep}${name}` : name;
}

export function SubtitleTool({ refreshKey, onDone }: SubtitleToolProps) {
  const [sources, setSources] = useState<SubtitleSource[]>([]);
  const [selected, setSelected] = useState<SubtitleSource | null>(null);
  const [lang, setLang] = useState<WhisperLang>('auto');
  const [model, setModel] = useState(() => getWhisperModel());
  const [status, setStatus] = useState<WhisperStatus | null>(null);
  const [percent, setPercent] = useState(0);
  const [busy, setBusy] = useState<BusyKind>('');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptData | null>(null);
  const [customSrt, setCustomSrt] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<SubtitleOutput[]>([]);
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
    setModel(getWhisperModel());
    void getWhisperStatus().then(setStatus);
  }, [refreshKey]);

  useWhisperProgress((e) => {
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

  const pickSrt = async (): Promise<void> => {
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: 'Altyazı', extensions: ['srt'] }],
      });
      if (typeof picked === 'string') setCustomSrt(picked);
    } catch {
      /* vazgeçme sessiz */
    }
  };

  const guardReady = (): boolean => {
    if (status && !status.whisper_available) {
      setError('whisper motoru kurulu değil. Ayarlar → Konuşma bölümünden motoru indir.');
      return false;
    }
    return true;
  };

  const runTranscribe = async (): Promise<void> => {
    if (busy || !selected) return;
    if (!guardReady()) return;
    if (status && !status.models[model]) {
      setError(`Whisper ${model} modeli indirilmedi. Ayarlar → Konuşma bölümünden indir.`);
      return;
    }
    setBusy('transcribe');
    setError(null);
    setPercent(0);
    const transcribeJob = crypto.randomUUID();
    jobIdRef.current = transcribeJob;
    const res = await startTranscribe(selected.inputPath, model, lang, transcribeJob);
    if (!res.ok || !res.data) {
      setError(res.error ?? 'Transkript üretilemedi.');
      setBusy('');
      return;
    }
    setPercent(100);
    // A7: transkript SADECE önizleme — arşive otomatik yazılmaz.
    setTranscript(res.data);
    setBusy('');
  };

  const runEmbed = async (srtPath: string | null): Promise<void> => {
    if (busy || !selected || !srtPath) return;
    if (!guardReady()) return;
    const output = embedOutputPath(selected.inputPath);
    setBusy('embed');
    setError(null);
    setPercent(0);
    const embedJob = crypto.randomUUID();
    jobIdRef.current = embedJob;
    const res = await embedSubtitle(selected.inputPath, srtPath, output, embedJob);
    if (!res.ok) {
      setError(res.error ?? 'Altyazı gömülemedi.');
      setBusy('');
      return;
    }
    setPercent(100);
    // A14: gömülü çıktı vault'a bağlanır.
    if (selected.itemId) {
      try {
        await updateItem(selected.itemId, { converted_path: output });
      } catch (e) {
        setError(typeof e === 'string' ? e : 'Vault kaydı güncellenemedi.');
        setBusy('');
        return;
      }
    }
    setOutputs((prev) => [{ label: basenameOf(output), path: output, kind: 'gömülü' }, ...prev]);
    setBusy('');
    onDone();
  };

  const runExtract = async (): Promise<void> => {
    if (busy || !selected) return;
    if (!guardReady()) return;
    const output = extractSrtPath(selected.inputPath);
    setBusy('extract');
    setError(null);
    setPercent(0);
    const extractJob = crypto.randomUUID();
    jobIdRef.current = extractJob;
    const res = await extractSubtitle(selected.inputPath, output, extractJob, 0);
    if (!res.ok) {
      setError(res.error ?? 'Altyazı çıkarılamadı.');
      setBusy('');
      return;
    }
    setPercent(100);
    setOutputs((prev) => [{ label: basenameOf(output), path: output, kind: 'çıkarılan' }, ...prev]);
    setBusy('');
    onDone();
  };

  const srtForEmbed = transcript?.srt_path ?? customSrt;
  const expectedSrt = selected ? transcriptSrtPath(selected.inputPath) : '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Captions className="size-5 text-primary" strokeWidth={2} />
        <h2 className="text-title">Altyazı</h2>
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
                    disabled={!!busy}
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

        <div className="flex min-h-0 flex-col gap-4">
          <section className="flex min-h-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card">
            <h3 className="text-micro font-medium text-muted-foreground">
              Otomatik transkript
            </h3>
            {!selected ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Transkript için soldan bir kaynak seç.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    Model: <span className="font-medium text-foreground">{model}</span>
                    <span className="text-xs"> (Ayarlar → Konuşma&apos;dan değiştir)</span>
                  </span>
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    Dil
                    <Select
                      label="Transkript dili"
                      className="w-36"
                      size="sm"
                      disabled={!!busy}
                      value={lang}
                      onValueChange={(v) => setLang(v as WhisperLang)}
                      options={LANGS.map((l) => ({ value: l.id, label: l.label }))}
                    />
                  </span>
                </div>
                <p className="truncate font-mono text-xs text-muted-foreground" title={expectedSrt}>
                  → {expectedSrt}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => void runTranscribe()} disabled={!!busy}>
                    <Sparkles /> {busy === 'transcribe' ? `%${percent} yazıya dökülüyor…` : 'Transkript üret'}
                  </Button>
                  {transcript && (
                    <Button
                      variant="outline"
                      onClick={() => void runEmbed(transcript.srt_path)}
                      disabled={!!busy}
                    >
                      <Captions /> {busy === 'embed' ? `%${percent} gömülüyor…` : 'Altyazıyı videoya göm'}
                    </Button>
                  )}
                  {error && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runTranscribe()}
                      disabled={!!busy}
                    >
                      <RotateCcw /> Tekrar dene
                    </Button>
                  )}
                </div>
                {busy === 'transcribe' && (
                  <div className="h-1.5 overflow-hidden rounded bg-muted">
                    <div className="h-full rounded bg-primary transition-[width]" style={{ width: `${percent}%` }} />
                  </div>
                )}
                {transcript && (
                  <div className="flex flex-col gap-1.5">
                    <p className="truncate font-mono text-xs text-muted-foreground" title={transcript.srt_path}>
                      .srt kaydedildi: {transcript.srt_path}
                    </p>
                    <pre className="max-h-48 overflow-y-auto rounded-lg border border-border bg-background p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
                      {transcript.preview}
                    </pre>
                    <p className="text-xs text-muted-foreground">
                      Önizleme yalnızca ilk 40 satır — arşive otomatik yazılmaz.
                    </p>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="flex min-h-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card">
            <h3 className="text-micro font-medium text-muted-foreground">Göm / Çıkar</h3>
            {!selected ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Gömme/çıkarma için soldan bir video seç.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={customSrt ?? ''}>
                    Altyazı: {customSrt ?? transcript?.srt_path ?? 'seçilmedi'}
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => void pickSrt()} disabled={!!busy}>
                    <FilePlus2 /> .srt seç
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void runEmbed(srtForEmbed ?? null)}
                    disabled={!!busy || !srtForEmbed}
                  >
                    <Captions /> {busy === 'embed' ? `%${percent} gömülüyor…` : 'Videoya göm'}
                  </Button>
                  <Button variant="outline" onClick={() => void runExtract()} disabled={!!busy}>
                    <Sparkles /> {busy === 'extract' ? `%${percent} çıkarılıyor…` : 'Altyazıyı çıkar (ilk akış)'}
                  </Button>
                  {error && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runExtract()}
                      disabled={!!busy}
                    >
                      <RotateCcw /> Tekrar dene
                    </Button>
                  )}
                </div>
                {(busy === 'embed' || busy === 'extract') && (
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
                        <li key={o.path} className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{o.label}</p>
                            <p className="truncate font-mono text-xs text-muted-foreground">{o.path}</p>
                          </div>
                          <Badge variant="outline">{o.kind}</Badge>
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
    </div>
  );
}
