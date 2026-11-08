import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Stamp } from '@/components/ui/stamp';
import type { ComponentStatus } from '@/lib/components';
import {
  WHISPER_MODELS,
  downloadModel,
  downloadWhisperEngine,
  getWhisperModel,
  getWhisperStatus,
  setWhisperModel,
  useWhisperEngineProgress,
  useWhisperModelProgress,
  type WhisperModel,
  type WhisperStatus,
} from '@/lib/whisper';

export function SpeechSettingsTab() {
  const [whisperModel, setWhisperModelState] = useState<WhisperModel>(() => getWhisperModel());
  const [whisperStatus, setWhisperStatus] = useState<WhisperStatus | null>(null);
  const [dlModel, setDlModel] = useState<WhisperModel | null>(null);
  const [dlPercent, setDlPercent] = useState(0);
  const [dlError, setDlError] = useState<string | null>(null);
  const [engDl, setEngDl] = useState(false);
  const [engPercent, setEngPercent] = useState(0);
  const [engError, setEngError] = useState<string | null>(null);
  const [componentSizes, setComponentSizes] = useState<Record<string, number | undefined>>({});

  useEffect(() => {
    void getWhisperStatus().then(setWhisperStatus);
    void invoke<ComponentStatus[]>('components_status')
      .then((rows) => {
        const sizes: Record<string, number> = {};
        for (const row of rows) sizes[row.id] = row.approx_mb;
        setComponentSizes(sizes);
      })
      .catch(() => setComponentSizes({}));
  }, []);

  const dlJobRef = useRef<string | null>(null);
  useWhisperModelProgress((e) => {
    if (e.jobId === dlJobRef.current) setDlPercent(Math.round(e.percent));
  });

  const engJobRef = useRef<string | null>(null);
  useWhisperEngineProgress((e) => {
    if (e.jobId === engJobRef.current) setEngPercent(Math.round(e.percent));
  });

  const refreshWhisper = async (): Promise<void> => {
    setWhisperStatus(await getWhisperStatus());
  };

  const startEngineDownload = async (): Promise<void> => {
    if (engDl || dlModel) return;
    setEngError(null);
    setEngDl(true);
    setEngPercent(0);
    const jobId = crypto.randomUUID();
    engJobRef.current = jobId;
    const res = await downloadWhisperEngine(jobId);
    if (!res.ok) {
      setEngError(res.error ?? 'Motor indirilemedi.');
      setEngDl(false);
      return;
    }
    setEngPercent(100);
    setEngDl(false);
    await refreshWhisper();
  };

  const startModelDownload = async (model: WhisperModel): Promise<void> => {
    if (dlModel || engDl) return;
    setDlError(null);
    setDlModel(model);
    setDlPercent(0);
    const jobId = crypto.randomUUID();
    dlJobRef.current = jobId;
    const res = await downloadModel(model, jobId);
    if (!res.ok) {
      setDlError(res.error ?? 'Model indirilemedi.');
      setDlModel(null);
      return;
    }
    setDlPercent(100);
    setDlModel(null);
    await refreshWhisper();
  };

  const selectWhisperModel = (m: WhisperModel): void => {
    setWhisperModel(m);
    setWhisperModelState(m);
  };

  const sizeSuffix = (id: string, fallbackMb?: number): string => {
    const mb = componentSizes[id] ?? fallbackMb;
    return mb === undefined ? '' : ` (~${mb} MB)`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between settings-card p-3.5">
        <div>
          <p className="text-sm font-medium">Whisper motoru</p>
          <p className="text-xs text-muted-foreground">
            Yerel whisper.cpp CLI yürütücüsü{sizeSuffix('whisper', 4)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {whisperStatus?.whisper_available ? (
            <Stamp state="local">kurulu</Stamp>
          ) : (
            <Stamp state="none">eksik</Stamp>
          )}
          {!whisperStatus?.whisper_available && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void startEngineDownload()}
              disabled={engDl || dlModel !== null}
            >
              {engDl ? `%${engPercent}` : 'Motoru indir'}
            </Button>
          )}
        </div>
      </div>
      {engDl && (
        <div className="h-1.5 overflow-hidden rounded bg-muted">
          <div
            className="h-full rounded bg-primary transition-[width]"
            style={{ width: `${engPercent}%` }}
          />
        </div>
      )}
      {engError && <p className="text-sm text-destructive">{engError}</p>}

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Konuşma Modelleri
        </span>
        {WHISPER_MODELS.map((m) => {
          const downloaded = whisperStatus?.models[m.id] ?? false;
          const isSelected = whisperModel === m.id;
          const isDownloading = dlModel === m.id;
          return (
            <div
              key={m.id}
              className={`flex flex-col gap-2 rounded-xl border bg-card p-3.5 transition ${
                isSelected ? 'border-primary/50' : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium capitalize">{m.id}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      (~{componentSizes[`whisper-model-${m.id}`] ?? m.sizeMb} MB)
                    </span>
                    {isSelected && <Stamp state="active">aktif</Stamp>}
                  </div>
                  <p className="text-xs text-muted-foreground">{m.hint}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {downloaded ? (
                    <Stamp state="local">indirildi</Stamp>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void startModelDownload(m.id)}
                      disabled={isDownloading || engDl}
                    >
                      {isDownloading ? `%${dlPercent}` : 'İndir'}
                    </Button>
                  )}
                  {downloaded && !isSelected && (
                    <Button variant="ghost" size="sm" onClick={() => selectWhisperModel(m.id)}>
                      Seç
                    </Button>
                  )}
                </div>
              </div>
              {isDownloading && (
                <div className="h-1.5 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full rounded bg-primary transition-[width]"
                    style={{ width: `${dlPercent}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {dlError && <p className="text-sm text-destructive">{dlError}</p>}
      <p
        className="truncate font-mono text-xs text-muted-foreground"
        title={whisperStatus?.models_dir ?? ''}
      >
        {whisperStatus ? `Modeller: ${whisperStatus.models_dir}` : 'Model durumu yükleniyor…'}
      </p>
      <div>
        <Button variant="outline" size="sm" onClick={() => void refreshWhisper()}>
          Durumu yenile
        </Button>
      </div>
    </div>
  );
}
