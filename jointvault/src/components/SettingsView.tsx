import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DataBackupSection } from '@/components/DataBackupSection';
import { writeClipboardText } from '@/lib/clipboard';
import { useOpenTarget } from '@/lib/open-target';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
  Activity,
  ArrowLeft,
  Database,
  Download,
  Eye,
  Mic,
  Plug,
  Settings,
  Sparkles,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { Stamp } from '@/components/ui/stamp';
import { Switch } from '@/components/ui/switch';
import { ThemeToggle } from '@/components/ThemeToggle';
import { DiagnosticsPanel } from '@/components/DiagnosticsPanel';
import { CLIPBOARD_WATCH_KEY, isWatchEnabled } from '@/components/ClipboardWatcher';
import {
  exportVault,
  getCategoriesForItem,
  getTagsForItem,
  importVault,
  listItems,
} from '@/lib/db/client';
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
import {
  batchCategorizeItems,
  downloadAiEngine,
  downloadAiModel,
  getAiStatus,
  reindexVault,
  saveAiConfig,
  stopAiServer,
  useAiEngineProgress,
  useAiModelProgress,
  useAiWarmupStatus,
  warmupAi,
  type AiStatus,
} from '@/lib/ai';

export type SettingsTab = 'view' | 'downloads' | 'speech' | 'ai' | 'diagnostics' | 'extension' | 'backup';

export interface SettingsViewProps {
  pageSize: number;
  pageSizes: readonly number[];
  onPageSizeChange: (n: number) => void;
  onReplayTour: () => void;
  onClose?: () => void;
  initialTab?: SettingsTab;
}

const CLOSE_OPTIONS: SelectOption[] = [
  { value: 'tray', label: 'Çekmeceye küçült (arka planda çalış)' },
  { value: 'quit', label: 'Tamamen kapat' },
];

const IDLE_OPTIONS: SelectOption[] = [
  { value: '0', label: 'Daima Hazır (Asla Uyutma - 0s)' },
  { value: '300', label: '5 Dakika' },
  { value: '600', label: '10 Dakika (Varsayılan)' },
  { value: '1800', label: '30 Dakika' },
  { value: '3600', label: '1 Saat' },
];

export function SettingsView(props: SettingsViewProps) {
  const { pageSize, pageSizes, onPageSizeChange, onReplayTour, onClose, initialTab = 'ai' } = props;
  const { reveal } = useOpenTarget();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
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

  // Yerel AI (Qwen 2.5 14B + BGE-M3 + llama-server)
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiEngineJob, setAiEngineJob] = useState<string | null>(null);
  const [aiModelJob, setAiModelJob] = useState<string | null>(null);
  const [aiModelType, setAiModelType] = useState<'llm' | 'embed' | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [reindexProgress, setReindexProgress] = useState<{ current: number; total: number } | null>(null);
  const [reindexBusy, setReindexBusy] = useState(false);
  const aiEnginePct = useAiEngineProgress(aiEngineJob);
  const aiModelPct = useAiModelProgress(aiModelJob);

  useEffect(() => {
    setDirError(null);
    setTokenError(null);
    setDlError(null);
    setEngError(null);
    setAiError(null);
    setQuality(getDefaultQuality());
    setWatch(isWatchEnabled());
    setWhisperModelState(getWhisperModel());
    void getWhisperStatus().then(setWhisperStatus);
    void getAiStatus().then(setAiStatus).catch(() => null);
    void invoke<string>('get_close_behavior')
      .then((m) => setCloseMode(m === 'quit' ? 'quit' : 'tray'))
      .catch(() => setCloseMode('tray'));
    void invoke<string>('get_download_dir')
      .then(setDir)
      .catch((e: unknown) => setDirError(String(e)));
    void invoke<string>('get_pairing_token')
      .then(setToken)
      .catch((e: unknown) => setTokenError(String(e)));
  }, []);

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
    const result = await writeClipboardText(token);
    setTokenError(result.ok ? null : result.error);
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

  const refreshAi = async () => {
    try {
      const s = await getAiStatus();
      setAiStatus(s);
    } catch (e) {
      setAiError(String(e));
    }
  };

  const runDownloadAiEngine = async () => {
    setAiError(null);
    const jid = crypto.randomUUID();
    setAiEngineJob(jid);
    try {
      await downloadAiEngine(jid);
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiEngineJob(null);
    }
  };

  const runDownloadAiModel = async (type: 'llm' | 'embed') => {
    setAiError(null);
    const jid = crypto.randomUUID();
    setAiModelJob(jid);
    setAiModelType(type);
    try {
      await downloadAiModel(type, jid);
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiModelJob(null);
      setAiModelType(null);
    }
  };

  const pickAiModelFile = async (type: 'llm' | 'embed') => {
    setAiError(null);
    try {
      const selected = await openDialog({
        title: type === 'llm' ? 'Qwen 2.5 14B Model Dosyası (.gguf)' : 'BGE-M3 Vektör Modeli (.gguf)',
        multiple: false,
        filters: [{ name: 'GGUF Model', extensions: ['gguf'] }],
      });
      if (typeof selected === 'string' && selected.length > 0) {
        if (type === 'llm') {
          await saveAiConfig({ llm_path: selected });
        } else {
          await saveAiConfig({ embed_path: selected });
        }
        await refreshAi();
      }
    } catch (e) {
      setAiError(String(e));
    }
  };

  const pickAiEngineFile = async () => {
    setAiError(null);
    try {
      const selected = await openDialog({
        title: 'llama-server.exe Dosyası',
        multiple: false,
        filters: [{ name: 'Executable', extensions: ['exe'] }],
      });
      if (typeof selected === 'string' && selected.length > 0) {
        await saveAiConfig({ engine_path: selected });
        await refreshAi();
      }
    } catch (e) {
      setAiError(String(e));
    }
  };

  const [warmupBusy, setWarmupBusy] = useState(false);
  const warmupStatus = useAiWarmupStatus();

  const runWarmupAi = async () => {
    setAiError(null);
    setWarmupBusy(true);
    try {
      await warmupAi();
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    } finally {
      setWarmupBusy(false);
    }
  };

  const handleToggleAutoWarmup = async (enabled: boolean) => {
    try {
      await saveAiConfig({ auto_warmup: enabled });
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    }
  };

  const handleChangeIdleTimeout = async (secs: number) => {
    try {
      await saveAiConfig({ idle_timeout_secs: secs });
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    }
  };

  const handleToggleAutoApply = async (enabled: boolean) => {
    try {
      setAiStatus((prev) => (prev ? { ...prev, auto_apply_tags: enabled } : prev));
      await saveAiConfig({ auto_apply_tags: enabled });
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    }
  };

  const handleChangeTemperature = async (temp: number) => {
    try {
      setAiStatus((prev) => (prev ? { ...prev, temperature: temp } : prev));
      await saveAiConfig({ temperature: temp });
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    }
  };

  const [organizeBusy, setOrganizeBusy] = useState(false);
  const [organizeProgress, setOrganizeProgress] = useState<{ current: number; total: number; title: string } | null>(null);
  const [organizeResult, setOrganizeResult] = useState<string | null>(null);

  const runOrganizeUncategorized = async () => {
    setOrganizeBusy(true);
    setOrganizeResult(null);
    setOrganizeProgress(null);
    try {
      const allItems = await listItems();
      const targetItems = [];
      for (const it of allItems) {
        const [cats, tags] = await Promise.all([
          getCategoriesForItem(it.id),
          getTagsForItem(it.id),
        ]);
        if (cats.length === 0 || tags.length === 0) {
          targetItems.push(it);
        }
      }

      if (targetItems.length === 0) {
        setOrganizeResult('Kategorisiz veya etiketsiz içerik bulunamadı (tümü düzenli).');
        return;
      }

      const res = await batchCategorizeItems(targetItems, {
        forceAutoApply: true,
        onProgress: (current, total, title) => {
          setOrganizeProgress({ current, total, title });
        },
      });

      setOrganizeResult(`${res.processed} içerik tarandı, ${res.applied} içerik otomatik kategorize edildi.`);
    } catch (e) {
      setAiError(String(e));
    } finally {
      setOrganizeBusy(false);
      setOrganizeProgress(null);
    }
  };

  const runStopAi = async () => {
    try {
      await stopAiServer();
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    }
  };

  const runReindex = async () => {
    setReindexBusy(true);
    setReindexProgress({ current: 0, total: 100 });
    try {
      await reindexVault((current, total) => {
        setReindexProgress({ current, total });
      });
    } catch (e) {
      setAiError(String(e));
    } finally {
      setReindexBusy(false);
      setReindexProgress(null);
    }
  };

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: 'ai', label: 'Yapay Zekâ', icon: <Sparkles className="size-4" />, desc: 'Qwen 2.5 14B, BGE-M3, VRAM yönetimi, taksonomi ve indeksleme' },
    { id: 'speech', label: 'Konuşma (Whisper)', icon: <Mic className="size-4" />, desc: 'Whisper.cpp yerel konuşma tanıma motoru ve modelleri' },
    { id: 'view', label: 'Görünüm', icon: <Eye className="size-4" />, desc: 'Arayüz teması, sayfalama ve pano izleme tercihleri' },
    { id: 'downloads', label: 'İndirme', icon: <Download className="size-4" />, desc: 'Medya indirme klasörü, varsayılan kalite ve sistem çekmecesi' },
    { id: 'diagnostics', label: 'Tanılama', icon: <Activity className="size-4" />, desc: 'Sistem donanımı, CUDA, ffmpeg ve yt-dlp sağlık kontrolleri' },
    { id: 'extension', label: 'Eklenti', icon: <Plug className="size-4" />, desc: 'Tarayıcı uzantısı ile güvenli bağlantı eşleşme anahtarı' },
    { id: 'backup', label: 'Yedekleme', icon: <Database className="size-4" />, desc: 'Kasa veritabanını JSON olarak dışa aktar veya geri yükle' },
  ];

  const currentTab = tabs.find((t) => t.id === tab) ?? tabs[0];

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

  const handleWatchToggle = (next: boolean): void => {
    window.localStorage.setItem(CLIPBOARD_WATCH_KEY, String(next));
    setWatch(next);
    window.dispatchEvent(new Event('storage'));
  };

  const selectWhisperModel = (m: WhisperModel): void => {
    setWhisperModel(m);
    setWhisperModelState(m);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Üst Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Settings className="size-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">Ayarlar</h1>
            <p className="text-2xs text-muted-foreground">
              Sistem tercihleri, modeller, donanım hızlandırma ve kasa yönetimi
            </p>
          </div>
        </div>

        {onClose && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Kasaya Dön
          </Button>
        )}
      </header>

      {/* Ana Gövde: 2 Sütunlu Sayfa Düzeni */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sol Sekme Menüsü (Desktop) */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border p-3 md:flex overflow-y-auto bg-card/10">
          <nav className="flex flex-col gap-1">
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground shadow-xs font-semibold'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {t.icon}
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Sağ İçerik Alanı: Rahatça Aşağı Kayan Doğal Sayfa */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-8">
          {/* Mobil Yatay Sekme Menüsü */}
          <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1 md:hidden no-scrollbar">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium ${
                  tab === t.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <div className="mx-auto max-w-3xl flex flex-col gap-6 pb-12">
            <div className="border-b border-border/60 pb-3">
              <h2 className="text-base font-semibold">{currentTab.label}</h2>
              <p className="text-xs text-muted-foreground">{currentTab.desc}</p>
            </div>

            {/* TAB: YAPAY ZEKÂ */}
            {tab === 'ai' && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between rounded-xl border border-border bg-card/40 p-3 shadow-xs">
                  <div>
                    <p className="text-sm font-medium">Yerel Donanım Hızlandırma</p>
                    <p className="text-xs text-muted-foreground">RTX 5070 Ti (16 GB GDDR7 VRAM) tam uyumlu</p>
                  </div>
                  <Stamp state="local">CUDA 12</Stamp>
                </div>

                {/* 1. AI Motoru */}
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/30 p-3.5 shadow-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium">AI Motoru (llama-server)</span>
                      <p className="text-xs text-muted-foreground">Yerel inference sunucusu (~40 MB)</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {aiStatus?.engine_available ? (
                        <Stamp state="local">kurulu</Stamp>
                      ) : (
                        <Stamp state="none">eksik</Stamp>
                      )}
                      {!aiStatus?.engine_available && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void runDownloadAiEngine()}
                          disabled={aiEngineJob !== null}
                        >
                          {aiEngineJob ? (aiEnginePct !== null && aiEnginePct >= 0 ? `%${Math.round(aiEnginePct)}` : '…') : 'İndir'}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => void pickAiEngineFile()}>
                        Seç (.exe)
                      </Button>
                    </div>
                  </div>
                  {aiEngineJob && (
                    <div className="h-1.5 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full rounded bg-primary transition-[width]"
                        style={{ width: `${aiEnginePct !== null && aiEnginePct >= 0 ? Math.round(aiEnginePct) : 100}%` }}
                      />
                    </div>
                  )}
                  {aiStatus?.engine_path && (
                    <p className="truncate font-mono text-2xs text-muted-foreground" title={aiStatus.engine_path}>
                      {aiStatus.engine_path}
                    </p>
                  )}
                </div>

                {/* 2. LLM Modeli */}
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/30 p-3.5 shadow-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium">Qwen 2.5 14B-Instruct</span>
                      <p className="text-xs text-muted-foreground">Ana Akıl & Sohbet Modeli (GGUF Q4_K_M ≈9 GB)</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {aiStatus?.llm_ready ? (
                        <Stamp state="local">hazır</Stamp>
                      ) : (
                        <Stamp state="none">eksik</Stamp>
                      )}
                      {!aiStatus?.llm_ready && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void runDownloadAiModel('llm')}
                          disabled={aiModelJob !== null}
                        >
                          {aiModelJob && aiModelType === 'llm'
                            ? (aiModelPct !== null && aiModelPct >= 0 ? `%${Math.round(aiModelPct)}` : '…')
                            : 'HF İndir'}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => void pickAiModelFile('llm')}>
                        Diskten Seç (.gguf)
                      </Button>
                    </div>
                  </div>
                  {aiModelJob && aiModelType === 'llm' && (
                    <div className="h-1.5 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full rounded bg-primary transition-[width]"
                        style={{ width: `${aiModelPct !== null && aiModelPct >= 0 ? Math.round(aiModelPct) : 100}%` }}
                      />
                    </div>
                  )}
                  {aiStatus?.llm_path && (
                    <p className="truncate font-mono text-2xs text-muted-foreground" title={aiStatus.llm_path}>
                      {aiStatus.llm_path}
                    </p>
                  )}
                </div>

                {/* 3. Embedding Modeli */}
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/30 p-3.5 shadow-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium">BGE-M3 Vektör Modeli</span>
                      <p className="text-xs text-muted-foreground">Türkçe & Çok Dilli Semantik İndeksleme (≈1.5 GB)</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {aiStatus?.embed_ready ? (
                        <Stamp state="local">hazır</Stamp>
                      ) : (
                        <Stamp state="none">eksik</Stamp>
                      )}
                      {!aiStatus?.embed_ready && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void runDownloadAiModel('embed')}
                          disabled={aiModelJob !== null}
                        >
                          {aiModelJob && aiModelType === 'embed'
                            ? (aiModelPct !== null && aiModelPct >= 0 ? `%${Math.round(aiModelPct)}` : '…')
                            : 'HF İndir'}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => void pickAiModelFile('embed')}>
                        Diskten Seç (.gguf)
                      </Button>
                    </div>
                  </div>
                  {aiModelJob && aiModelType === 'embed' && (
                    <div className="h-1.5 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full rounded bg-primary transition-[width]"
                        style={{ width: `${aiModelPct !== null && aiModelPct >= 0 ? Math.round(aiModelPct) : 100}%` }}
                      />
                    </div>
                  )}
                  {aiStatus?.embed_path && (
                    <p className="truncate font-mono text-2xs text-muted-foreground" title={aiStatus.embed_path}>
                      {aiStatus.embed_path}
                    </p>
                  )}
                </div>

                {/* 4. VRAM & Sunucu Durumu */}
                <div className="flex flex-col gap-3.5 rounded-xl border border-border bg-card/30 p-4 shadow-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">VRAM & Çalışma Durumu</p>
                      <p className="text-xs text-muted-foreground">
                        {warmupStatus.status === 'loading'
                          ? '🟡 Modeller VRAM\'e yükleniyor (Isıtılıyor)…'
                          : aiStatus?.chat_server_running || aiStatus?.embed_server_running
                          ? '🟢 VRAM Aktif (~10.5 GB / 16 GB offloaded)'
                          : '⚪ Uyku Modunda (VRAM serbest)'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Chat: {aiStatus?.chat_server_running ? '🟢' : '⚪'} | Embed: {aiStatus?.embed_server_running ? '🟢' : '⚪'}
                      </span>
                      {aiStatus?.chat_server_running || aiStatus?.embed_server_running ? (
                        <Button variant="outline" size="sm" onClick={() => void runStopAi()}>
                          VRAM'i Boşalt
                        </Button>
                      ) : (
                        aiStatus?.llm_ready && aiStatus?.embed_ready && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void runWarmupAi()}
                            disabled={warmupBusy || warmupStatus.status === 'loading'}
                          >
                            {warmupBusy || warmupStatus.status === 'loading' ? 'Yükleniyor…' : 'VRAM\'e Yükle (Isıt)'}
                          </Button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Açılışta Otomatik Isıtma / Warmup Toggle */}
                  <div className="flex items-center justify-between border-t border-border/50 pt-3">
                    <div>
                      <p className="text-sm font-medium">Açılışta Otomatik Başlat (Warmup)</p>
                      <p className="text-xs text-muted-foreground">
                        Uygulama açıldığında modelleri arka planda VRAM'e sessizce yükler; ilk sorunuz anında yanıtlanır.
                      </p>
                    </div>
                    <Switch
                      checked={aiStatus?.auto_warmup ?? true}
                      onCheckedChange={(checked) => void handleToggleAutoWarmup(checked)}
                    />
                  </div>

                  {/* Boşta Kalma Süresi */}
                  <div className="flex items-center justify-between border-t border-border/50 pt-3">
                    <div>
                      <p className="text-sm font-medium">Boşta Kalma Süresi (VRAM Uyku Modu)</p>
                      <p className="text-xs text-muted-foreground">
                        Belirtilen süre işlem yapılmazsa VRAM otomatik boşaltılır.
                      </p>
                    </div>
                    <div className="w-56">
                      <Select
                        label="Boşta Kalma Süresi"
                        size="sm"
                        options={IDLE_OPTIONS}
                        value={String(aiStatus?.idle_timeout_secs ?? 600)}
                        onValueChange={(val) => void handleChangeIdleTimeout(Number(val))}
                      />
                    </div>
                  </div>
                </div>

                {/* 5. Akıllı Taksonomi & Otomasyon */}
                <div className="flex flex-col gap-3.5 rounded-xl border border-border bg-card/30 p-4 shadow-xs">
                  <div>
                    <p className="text-sm font-medium">Akıllı Taksonomi & Otomasyon</p>
                    <p className="text-xs text-muted-foreground">
                      Qwen 2.5'in içerikleri sınıflandırma ve etiketleme davranışlarını yapılandırın.
                    </p>
                  </div>

                  {/* Önerileri Otomatik Uygula Switch */}
                  <div className="flex items-center justify-between border-t border-border/50 pt-3">
                    <div>
                      <p className="text-sm font-medium">Önerileri Otomatik Uygula</p>
                      <p className="text-xs text-muted-foreground">
                        Yeni kayıt eklendiğinde veya altyazı çıkarıldığında AI önerilerini sormadan kasaya kaydeder.
                      </p>
                    </div>
                    <Switch
                      checked={aiStatus?.auto_apply_tags ?? false}
                      onCheckedChange={(checked) => void handleToggleAutoApply(checked)}
                    />
                  </div>

                  {/* AI Yanıt Sıcaklığı (Temperature) */}
                  <div className="flex items-center justify-between border-t border-border/50 pt-3">
                    <div>
                      <p className="text-sm font-medium">AI Yanıt Sıcaklığı (Temperature: {aiStatus?.temperature ?? 0.7})</p>
                      <p className="text-xs text-muted-foreground">
                        Düşük değerler daha kesin/tutarlı, yüksek değerler daha yaratıcı öneriler ve yanıtlar üretir.
                      </p>
                    </div>
                    <div className="w-48">
                      <Select
                        label="AI Sıcaklığı"
                        size="sm"
                        options={[
                          { value: '0.2', label: '0.2 (Kesin & Katı)' },
                          { value: '0.5', label: '0.5 (Odaklı)' },
                          { value: '0.7', label: '0.7 (Dengeli - Varsayılan)' },
                          { value: '0.9', label: '0.9 (Yaratıcı & Esnek)' },
                        ]}
                        value={String(aiStatus?.temperature ?? 0.7)}
                        onValueChange={(val) => void handleChangeTemperature(Number(val))}
                      />
                    </div>
                  </div>
                </div>

                {/* 6. Kasa Bakım & Düzenleme Araçları */}
                <div className="flex flex-col gap-3.5 rounded-xl border border-border bg-card/30 p-4 shadow-xs">
                  <div>
                    <p className="text-sm font-medium">Kasa Bakım & Düzenleme Araçları</p>
                    <p className="text-xs text-muted-foreground">
                      Kasadaki içeriklerin taksonomisini ve vektör veritabanını toplu olarak yönetin.
                    </p>
                  </div>

                  {/* Kategorisiz İçerikleri Düzenle */}
                  <div className="flex items-center justify-between border-t border-border/50 pt-3">
                    <div>
                      <p className="text-sm font-medium">Kategorisiz İçerikleri Düzenle</p>
                      <p className="text-xs text-muted-foreground">
                        {organizeProgress
                          ? `${organizeProgress.current} / ${organizeProgress.total}: ${organizeProgress.title} işleniyor…`
                          : 'Kategorisi veya etiketi olmayan kayıtları Qwen 2.5 ile sırayla tarar ve otomatik düzenler.'}
                      </p>
                      {organizeResult && (
                        <p className="mt-1 text-xs font-medium text-emerald-400">✓ {organizeResult}</p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runOrganizeUncategorized()}
                      disabled={organizeBusy || !aiStatus?.llm_ready}
                    >
                      {organizeBusy ? 'İşleniyor…' : 'Kategorisizleri Düzenle'}
                    </Button>
                  </div>

                  {/* Semantik Kasa İndeksi */}
                  <div className="flex items-center justify-between border-t border-border/50 pt-3">
                    <div>
                      <p className="text-sm font-medium">Semantik Kasa İndeksi</p>
                      <p className="text-xs text-muted-foreground">
                        {reindexProgress
                          ? `${reindexProgress.current} / ${reindexProgress.total} içerik indeksleniyor…`
                          : 'Tüm not ve transkriptleri BGE-M3 ile baştan vektörleştir.'}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runReindex()}
                      disabled={reindexBusy || !aiStatus?.embed_ready}
                    >
                      {reindexBusy ? 'İndeksleniyor…' : 'Tümünü Yeniden İndeksle'}
                    </Button>
                  </div>
                </div>

                {aiError && <p className="text-sm text-destructive">{aiError}</p>}

                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => void refreshAi()}>
                    Durumu Yenile
                  </Button>
                </div>
              </div>
            )}

            {/* TAB: KONUŞMA (WHISPER) */}
            {tab === 'speech' && (
              <div className="flex flex-col gap-4">
                {/* Motor kartı */}
                <div className="flex items-center justify-between rounded-xl border border-border bg-card/30 p-3.5 shadow-xs">
                  <div>
                    <p className="text-sm font-medium">Whisper motoru</p>
                    <p className="text-xs text-muted-foreground">Yerel whisper.cpp CLI yürütücüsü (~4 MB)</p>
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
                    <div className="h-full rounded bg-primary transition-[width]" style={{ width: `${engPercent}%` }} />
                  </div>
                )}
                {engError && <p className="text-sm text-destructive">{engError}</p>}

                {/* Model listesi */}
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
                        className={`flex flex-col gap-2 rounded-xl border p-3.5 transition ${
                          isSelected ? 'border-primary/50 bg-primary/5' : 'border-border bg-card/30'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium capitalize">{m.id}</span>
                              <span className="font-mono text-xs text-muted-foreground">(~{m.sizeMb} MB)</span>
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

            {/* TAB: GÖRÜNÜM */}
            {tab === 'view' && (
              <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/30 p-4 shadow-xs">
                <SettingRow label="Tema" htmlFor="theme-toggle">
                  <ThemeToggle />
                </SettingRow>
                <SettingRow label="Sayfa başına öğe" htmlFor="set-pagesize">
                  <Select
                    label="Sayfa boyutu"
                    className="w-28"
                    value={String(pageSize)}
                    onValueChange={(v) => onPageSizeChange(Number(v))}
                    options={pageSizes.map((n) => ({ value: String(n), label: `${n} öğe` }))}
                  />
                </SettingRow>
                <SettingRow
                  label="Panoyu otomatik izle"
                  hint="Pano değiştikçe algılar, yakala çubuğuna hazırlar."
                  htmlFor="set-watch"
                >
                  <Switch checked={watch} onCheckedChange={handleWatchToggle} aria-labelledby="set-watch" />
                </SettingRow>
                <SettingRow
                  label="Hızlı başlangıç turu"
                  hint="Klavye kısayolları ve temel kavramları gösteren karşılama turunu yeniden açar."
                >
                  <Button variant="outline" size="sm" onClick={onReplayTour}>
                    Turu Başlat
                  </Button>
                </SettingRow>
              </div>
            )}

            {/* TAB: İNDİRME */}
            {tab === 'downloads' && (
              <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/30 p-4 shadow-xs">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="set-dir" className="text-sm font-medium">
                    İndirme klasörü
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="set-dir"
                      value={dir}
                      onChange={(e) => setDir(e.target.value)}
                      placeholder="Örn: D:\İndirilenler\JointVault"
                    />
                    <Button variant="outline" size="sm" onClick={() => void pickDir()}>
                      Seç…
                    </Button>
                    <Button size="sm" onClick={() => void saveDir()} disabled={dirBusy}>
                      {dirBusy ? 'Kaydediliyor…' : 'Kaydet'}
                    </Button>
                    {/* Yolu açmak: klasör yoksa/silinmişse artık sessiz kalmaz, bildirim çıkar. */}
                    <Button variant="outline" size="sm" onClick={() => reveal(dir)} disabled={!dir}>
                      Aç
                    </Button>
                  </div>
                  {dirError && <p className="text-sm text-destructive">{dirError}</p>}
                </div>
                <SettingRow
                  label="Varsayılan kalite"
                  hint="Fişten veya toplu indirmede hedef seçilmediğinde kullanılır."
                  htmlFor="set-quality"
                >
                  <Select
                    label="Kalite"
                    className="w-40"
                    value={quality}
                    onValueChange={(v) => {
                      const q = v as DownloadQuality;
                      setDefaultQuality(q);
                      setQuality(q);
                    }}
                    options={QUALITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  />
                </SettingRow>
                <SettingRow
                  label="Pencere kapatma davranışı"
                  hint="Pencere [X] ile kapatıldığında uygulamanın ne yapacağını belirler."
                  htmlFor="set-close-mode"
                >
                  <Select
                    label="Kapatma davranışı"
                    className="w-64"
                    value={closeMode}
                    onValueChange={(v) => {
                      setCloseMode(v);
                      void invoke('set_close_behavior', { mode: v });
                    }}
                    options={CLOSE_OPTIONS}
                  />
                </SettingRow>
              </div>
            )}

            {/* TAB: TANILAMA */}
            {tab === 'diagnostics' && <DiagnosticsPanel />}

            {/* TAB: EKLENTİ */}
            {tab === 'extension' && (
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/30 p-4 shadow-xs">
                <span className="text-sm font-medium">Eşleşme anahtarı</span>
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

            {/* TAB: YEDEKLEME */}
            {tab === 'backup' && (
              <div className="flex flex-col gap-4">
                <DataBackupSection />
                <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/30 p-4 shadow-xs">
                <h3 className="text-sm font-medium">Taşınabilir dışa aktarma (JSON)</h3>
                <p className="text-xs text-muted-foreground">
                  Tüm kayıtlar JSON olarak dışa aktarılır; içe aktarma mevcutla birleşir, tekrarlar atlanır. Medya
                  dosyaları dahil değildir.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => void doExport()} disabled={backupBusy}>
                    Dışa Aktar (JSON)
                  </Button>
                  <label
                    className={`inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-transparent px-3 text-sm font-medium transition hover:bg-accent hover:text-accent-foreground ${backupBusy ? 'pointer-events-none opacity-50' : ''}`}
                  >
                    İçe Aktar (JSON)
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      disabled={backupBusy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void doImport(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                {backupMsg && (
                  <p className="font-mono text-xs text-foreground bg-muted/40 p-2.5 rounded-lg border border-border/50">
                    {backupMsg}
                  </p>
                )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRegenOpen}
        onOpenChange={setConfirmRegenOpen}
        title="Eşleşme anahtarı yenilensin mi?"
        description="Eski anahtarla eşleşmiş tarayıcı eklentileri bağlantıyı kaybeder. Eklenti ayarlarına yeni anahtarı girmen gerekir."
        confirmLabel="Yenile"
        onConfirm={() => void runRegenToken()}
      />
    </div>
  );
}
