import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getHealth, type HealthReport } from '@/lib/health';
import { WHISPER_MODELS, getWhisperStatus } from '@/lib/whisper';

// İki tüketici (wizard + tanılama) aynı satırı kullanır — tek tanım burada.
export function HealthRow({
  ok,
  label,
  hint,
}: {
  ok: boolean | null;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border p-2.5">
      {ok == null ? (
        <span
          className="mt-0.5 size-4 shrink-0 animate-pulse rounded-full bg-muted"
          aria-label="kontrol ediliyor"
        />
      ) : ok ? (
        <Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={2.5} aria-label="tamam" />
      ) : (
        <X
          className="mt-0.5 size-4 shrink-0 text-destructive"
          strokeWidth={2.5}
          aria-label="eksik"
        />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

// Ayarlar → Tanılama sekmesinde (standalone değil) render edilir.
export function DiagnosticsPanel() {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [modelsDir, setModelsDir] = useState<string | null>(null);
  const [dir, setDir] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true);
    setFailed(false);
    const [h, w] = await Promise.all([getHealth(), getWhisperStatus()]);
    setHealth(h);
    setModelsDir(w?.models_dir ?? null);
    if (!h) setFailed(true);
    try {
      setDir(await invoke<string>('get_download_dir'));
    } catch {
      setDir(h?.download_dir ?? null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loading = busy && !health && !failed;

  return (
    <div className="flex flex-col gap-2">
      <HealthRow
        ok={loading ? null : (health?.ffmpeg.available ?? false)}
        label={health?.ffmpeg.version ? `FFmpeg — ${health.ffmpeg.version}` : 'FFmpeg'}
        hint={
          loading
            ? 'Kontrol ediliyor…'
            : (health?.ffmpeg.version ?? 'Bulunamadı — uygulamayı yeniden kurman gerekebilir.')
        }
      />
      <HealthRow
        ok={loading ? null : (health?.ffprobe.available ?? false)}
        label={health?.ffprobe.version ? `FFprobe — ${health.ffprobe.version}` : 'FFprobe'}
        hint={
          loading
            ? 'Kontrol ediliyor…'
            : (health?.ffprobe.version ?? 'Bulunamadı — uygulamayı yeniden kurman gerekebilir.')
        }
      />
      <HealthRow
        ok={loading ? null : (health?.whisper.available ?? false)}
        label="Whisper (konuşma)"
        hint={
          loading
            ? 'Kontrol ediliyor…'
            : health?.whisper.available
              ? 'Kurulu — transkript üretebilirsin.'
              : 'Bulunamadı — uygulamayı yeniden kurman gerekebilir.'
        }
      />
      {WHISPER_MODELS.map((m) => {
        const done = health?.models[m.id] ?? false;
        return (
          <div
            key={m.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5"
          >
            <p className="text-sm font-medium">
              {m.id} <span className="font-normal text-muted-foreground">≈{m.sizeMb} MB</span>
            </p>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase ${
                done ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'
              }`}
            >
              {loading ? '…' : done ? 'indirildi' : 'eksik'}
            </span>
          </div>
        );
      })}
      <p className="truncate font-mono text-xs text-muted-foreground" title={dir ?? ''}>
        {dir ? `İndirme klasörü: ${dir}` : 'İndirme klasörü bilinmiyor.'}
      </p>
      <p className="truncate font-mono text-xs text-muted-foreground" title={modelsDir ?? ''}>
        {modelsDir ? `Modeller: ${modelsDir}` : 'Model klasörü bilinmiyor.'}
      </p>
      {failed && !health && (
        <p className="text-sm text-destructive">Durum alınamadı — uygulamayı yeniden başlatmayı dene.</p>
      )}
      <div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy}>
          {busy ? 'Kontrol ediliyor…' : 'Tekrar kontrol et'}
        </Button>
      </div>
    </div>
  );
}
