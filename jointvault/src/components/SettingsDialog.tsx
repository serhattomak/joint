import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { exportVault, importVault } from '@/lib/db/client';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { Stamp } from '@/components/ui/stamp';
import { ThemeToggle } from '@/components/ThemeToggle';
import { DiagnosticsPanel } from '@/components/DiagnosticsPanel';
import { CLIPBOARD_WATCH_KEY, isWatchEnabled } from '@/components/ClipboardWatcher';
import { QUALITY_OPTIONS, getDefaultQuality, setDefaultQuality, type DownloadQuality } from '@/lib/downloads';
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

type SettingsTab = 'view' | 'downloads' | 'speech' | 'diagnostics' | 'extension' | 'backup';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageSize: number;
  pageSizes: readonly number[];
  onPageSizeChange: (n: number) => void;
  onReplayTour: () => void;
}

/* Kapatma davranışı — dünyada iki durum var, üçüncü yok. */
const CLOSE_MODES: readonly SelectOption[] = [
  { value: 'tray', label: 'Tepside çalışmaya devam et' },
  { value: 'quit', label: 'Tamamen kapat' },
];

export function SettingsDialog(props: SettingsDialogProps) {
  const { open, onOpenChange, pageSize, pageSizes, onPageSizeChange, onReplayTour } = props;
  const [tab, setTab] = useState<SettingsTab>('view');
  const [closeMode, setCloseMode] = useState('tray');
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [watch, setWatch] = useState(() => isWatchEnabled());
  // İndirme klasörü
  const [dir, setDir] = useState('');
  const [dirBusy, setDirBusy] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [quality, setQuality] = useState<DownloadQuality>(() => getDefaultQuality());
  // Eşleşme anahtarı
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [confirmRegenOpen, setConfirmRegenOpen] = useState(false);
  // Konuşma (whisper): model seçimi + lazy indirme
  const [whisperModel, setWhisperModelState] = useState<WhisperModel>(() => getWhisperModel());
  const [whisperStatus, setWhisperStatus] = useState<WhisperStatus | null>(null);
  const [dlModel, setDlModel] = useState<WhisperModel | null>(null);
  const [dlPercent, setDlPercent] = useState(0);
  const [dlError, setDlError] = useState<string | null>(null);
  // Konuşma motoru (whisper.cpp CLI, ~4MB, bir kez)
  const [engDl, setEngDl] = useState(false);
  const [engPercent, setEngPercent] = useState(0);
  const [engError, setEngError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDirError(null);
    setTokenError(null);
    setDlError(null);
    setEngError(null);
    setQuality(getDefaultQuality());    setWatch(isWatchEnabled());
    setWhisperModelState(getWhisperModel());
    void getWhisperStatus().then(setWhisperStatus);
    void invoke<string>('get_close_behavior')
      .then((m) => setCloseMode(m === 'quit' ? 'quit' : 'tray'))
      .catch(() => setCloseMode('tray'));
    void invoke<string>('get_download_dir')
      .then(setDir)
      .catch((e: unknown) => setDirError(String(e)));
    void invoke<string>('get_pairing_token')
      .then(setToken)
      .catch((e: unknown) => setTokenError(String(e)));
  }, [open ]);

  const pickDir = async (): Promise<void> => {
    setDirError(null);
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (typeof selected === 'string' && selected.length > 0) setDir(selected);
    } catch (e: unknown) {
      setDirError(String(e));
    }
  };

  const saveDir = async (): Promise<void> => {
    setDirBusy(true);
    setDirError(null);
    try {
      const next = await invoke<string>('set_download_dir', { path: dir });
      setDir(next);
    } catch (e: unknown) {
      setDirError(String(e));
    } finally {
      setDirBusy(false);
    }
  };

  const copyToken = async (): Promise<void> => {
    try {
      await writeText(token);
    } catch (e: unknown) {
      setTokenError(String(e));
    }
  };

  const runRegenToken = async (): Promise<void> => {
    try {
      const next = await invoke<string>('regenerate_pairing_token');
      setToken(next);
    } catch (e: unknown) {
      setTokenError(String(e));
    }
  };

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

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: 'view', label: 'Görünüm' },
    { id: 'downloads', label: 'İndirme' },
    { id: 'speech', label: 'Konuşma' },
    { id: 'diagnostics', label: 'Tanılama' },
    { id: 'extension', label: 'Eklenti' },
    { id: 'backup', label: 'Yedekleme' },
  ];

  const doExport = async (): Promise<void> => {
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const data = await exportVault();
      const path = await saveDialog({
        defaultPath: `jointvault-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path) return;
      await invoke('write_text_file', { path, content: JSON.stringify(data) });
      const count = Object.values(data.tables).reduce((n, rows) => n + rows.length, 0);
      setBackupMsg(`${count} satır yedeklendi.`);
    } catch (e) {
      setBackupMsg(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Dışa aktarma başarısız.');
    } finally {
      setBackupBusy(false);
    }
  };

  const doImport = async (file: File): Promise<void> => {
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const data = JSON.parse(await file.text());
      const { added } = await importVault(data);
      setBackupMsg(`${added} yeni satır içe aktarıldı (tekrarlar atlandı).`);
    } catch (e) {
      setBackupMsg(typeof e === 'string' ? e : e instanceof Error ? e.message : 'İçe aktarma başarısız.');
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ayarlar</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-1 border-b border-border pb-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-selected={tab === t.id}
              role="tab"
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                tab === t.id
                  ? 'bg-secondary font-medium text-secondary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'view' && (
          <div className="flex flex-col">
            <SettingRow label="Tema">
              <ThemeToggle />
            </SettingRow>
            <SettingRow label="Karşılama turu">
              <Button variant="outline" size="sm" onClick={onReplayTour}>
                Tekrar göster
              </Button>
            </SettingRow>
            <SettingRow label="Pano izleme">
              <input
                type="checkbox"
                checked={watch}
                onChange={(e) => {
                  const on = e.target.checked;
                  setWatch(on);
                  localStorage.setItem(CLIPBOARD_WATCH_KEY, on ? 'on' : 'off');
                }}
                className="size-4 accent-primary"
                aria-label="Pano izleme"
              />
            </SettingRow>
            <SettingRow label="Kapatma tuşu">
              <Select
                label="Kapatma davranışı"
                className="w-52"
                value={closeMode}
                onValueChange={(mode) => {
                  setCloseMode(mode);
                  void invoke<string>('set_close_behavior', { mode }).catch((err: unknown) =>
                    setDirError(String(err)),
                  );
                }}
                options={CLOSE_MODES}
              />
            </SettingRow>
            <SettingRow label="Sayfa başına">
              <Select
                label="Sayfa başına"
                className="w-20"
                value={String(pageSize)}
                onValueChange={(v) => onPageSizeChange(Number.parseInt(v, 10))}
                options={pageSizes.map((n) => ({ value: String(n), label: String(n) }))}
              />
            </SettingRow>
          </div>
        )}

        {tab === 'downloads' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm">İndirme klasörü</span>
              <div className="flex gap-2">
                <Input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="İndirme klasörü…" />
                <Button variant="outline" size="sm" onClick={() => void pickDir()}>
                  Seç
                </Button>
                <Button size="sm" onClick={() => void saveDir()} disabled={dirBusy || dir.trim().length === 0}>
                  {dirBusy ? '…' : 'Kaydet'}
                </Button>
              </div>
              {dirError && <p className="text-sm text-destructive">{dirError}</p>}
            </div>
            <SettingRow label="Varsayılan ses kalitesi">
              <Select
                label="Varsayılan ses kalitesi"
                className="w-40"
                value={quality}
                onValueChange={(q) => {
                  const next = q as DownloadQuality;
                  setQuality(next);
                  setDefaultQuality(next);
                }}
                options={QUALITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </SettingRow>
          </div>
        )}

        {tab === 'speech' && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Konuşma motoru (~4MB, bir kez) ve model ilk açılışta indirilmez — buradan indirilir, %100
              yerel çalışır.
            </p>
            <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Konuşma motoru</span>
                <div className="flex shrink-0 items-center gap-2">
                  {whisperStatus ? (
                    whisperStatus.whisper_available ? (
                      <Stamp state="local">kurulu</Stamp>
                    ) : (
                      <Stamp state="none">eksik</Stamp>
                    )
                  ) : (
                    <Stamp state="none">…</Stamp>
                  )}
                  {whisperStatus && !whisperStatus.whisper_available && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void startEngineDownload()}
                      disabled={engDl || dlModel !== null}
                    >
                      {engDl ? (engPercent < 0 ? '…' : `%${Math.round(engPercent)}`) : 'Motoru indir (~4MB)'}
                    </Button>
                  )}
                </div>
              </div>
              {engDl && (
                <div className="h-1.5 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full rounded bg-primary transition-[width]"
                    style={{ width: `${engPercent < 0 ? 100 : Math.round(engPercent)}%` }}
                  />
                </div>
              )}
            </div>
            {engError && <p className="text-sm text-destructive">{engError}</p>}
            <SettingRow label="Konuşma modeli">
              <Select
                label="Konuşma modeli"
                className="w-36"
                value={whisperModel}
                onValueChange={(m) => {
                  const next = m as WhisperModel;
                  setWhisperModelState(next);
                  setWhisperModel(next);
                }}
                options={WHISPER_MODELS.map((m) => ({
                  value: m.id,
                  label: m.id,
                  hint: `≈${m.sizeMb} MB`,
                }))}
              />
            </SettingRow>
            {WHISPER_MODELS.map((m) => {
              const done = whisperStatus?.models[m.id] ?? false;
              const downloading = dlModel === m.id;
              return (
                <div key={m.id} className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {m.id} <span className="font-normal text-muted-foreground">≈{m.sizeMb} MB</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{m.hint}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {done ? <Stamp state="local">indirildi</Stamp> : <Stamp state="none">eksik</Stamp>}
                      {!done && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void startModelDownload(m.id)}
                          disabled={dlModel !== null || engDl}
                        >
                          {downloading ? (dlPercent < 0 ? '…' : `%${Math.round(dlPercent)}`) : 'İndir'}
                        </Button>
                      )}
                    </div>
                  </div>
                  {downloading && (
                    <div className="h-1.5 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full rounded bg-primary transition-[width]"
                        style={{ width: `${dlPercent < 0 ? 100 : Math.round(dlPercent)}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {dlError && <p className="text-sm text-destructive">{dlError}</p>}
            <p className="truncate font-mono text-xs text-muted-foreground" title={whisperStatus?.models_dir ?? ''}>
              {whisperStatus ? `Modeller: ${whisperStatus.models_dir}` : 'Model durumu yükleniyor…'}
            </p>
            <div>
              <Button variant="outline" size="sm" onClick={() => void refreshWhisper()}>
                Durumu yenile
              </Button>
            </div>
          </div>
        )}

        {tab === 'diagnostics' && <DiagnosticsPanel />}

        {tab === 'extension' && (
          <div className="flex flex-col gap-2">
            <span className="text-sm">Eşleşme anahtarı</span>
            <p className="text-xs text-muted-foreground">
              Tarayıcı eklentisine bir kez girilir; yenilersen eklentiye yeniden girmen gerekir.
            </p>
            <div className="flex gap-2">
              <Input value={showToken ? token : '•'.repeat(24)} readOnly className="font-mono" />
              <Button variant="outline" size="sm" onClick={() => setShowToken((s) => !s)}>
                {showToken ? 'Gizle' : 'Göster'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void copyToken()}>
                Kopyala
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmRegenOpen(true)}>
                Yenile
              </Button>
            </div>
            {tokenError && <p className="text-sm text-destructive">{tokenError}</p>}
          </div>
        )}

        {tab === 'backup' && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              Tüm kayıtlar JSON olarak dışa aktarılır; içe aktarma mevcutla birleşir, tekrarlar atlanır. Medya
              dosyaları dahil değildir.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void doExport()} disabled={backupBusy}>
                {backupBusy ? '…' : 'Dışa aktar'}
              </Button>
              <label
                className={`inline-flex h-8 cursor-pointer items-center rounded-lg border border-input bg-transparent px-2.5 text-sm transition hover:bg-muted ${backupBusy ? 'pointer-events-none opacity-50' : ''}`}
              >
                İçe aktar
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  disabled={backupBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void doImport(f);
                  }}
                />
              </label>
            </div>
            {backupMsg && <p className="text-sm text-muted-foreground">{backupMsg}</p>}
          </div>
        )}
      </DialogContent>

      <ConfirmDialog
        open={confirmRegenOpen}
        onOpenChange={setConfirmRegenOpen}
        title="Eşleşme anahtarı yenilensin mi?"
        description="Eski anahtar geçersiz olur; eklentiye yenisini yeniden girmen gerekir."
        confirmLabel="Yenile"
        tone="default"
        onConfirm={() => void runRegenToken()}
      />
    </Dialog>
  );
}
