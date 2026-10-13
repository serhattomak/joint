import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DataBackupSection } from '@/components/DataBackupSection';
import { ComponentsSection } from '@/components/ComponentsSection';
import { writeClipboardText } from '@/lib/clipboard';
import { useOpenTarget } from '@/lib/open-target';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  Activity,
  ArrowLeft,
  Database,
  Download,
  Eye,
  Mic,
  PackageCheck,
  Plug,
  Settings,
  Sparkles,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, type SelectOption } from '@/components/ui/select';
import { Stamp } from '@/components/ui/stamp';
import { Switch } from '@/components/ui/switch';
import { ThemeToggle } from '@/components/ThemeToggle';
import { DiagnosticsPanel } from '@/components/DiagnosticsPanel';
import { CLIPBOARD_WATCH_KEY, isWatchEnabled } from '@/components/ClipboardWatcher';
import {
  exportVault,
  getAllCategoriesByItem,
  getAllTagsByItem,
  getDb,
  importVault,
  listItems,
} from '@/lib/db/client';
import { createBackup } from '@/lib/db/backup';
import { QUALITY_OPTIONS, getDefaultQuality, setDefaultQuality, type DownloadQuality } from '@/lib/downloads';
import {
  DEFAULT_DOWNLOAD_SETTINGS,
  getDownloadSettings,
  setDownloadSettings,
  type DownloadSettings,
} from '@/lib/turbo_download';
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
  isAiEnabled,
  readTagThreshold,
  reindexVault,
  saveAiConfig,
  stopAiServer,
  TAG_THRESHOLD_KEY,
  useAiEngineProgress,
  useAiModelProgress,
  useAiWarmupStatus,
  warmupAi,
  type AiGpuInfo,
  type AiStatus,
} from '@/lib/ai';
import { analyzeMissing } from '@/lib/analysis';
import {
  applyMerges,
  makeNotebookDeps,
  readNotebookThreshold,
  runNotebookPipeline,
  writeNotebookThreshold,
  type DupeGroup,
  type NotebookReport,
} from '@/lib/notebook-pipeline';
import { planItemMerge } from '@/lib/notebook';
import type { Item } from '@/lib/db/types';
import { downloadComponent, type ComponentStatus } from '@/lib/components';

export type SettingsTab = 'view' | 'downloads' | 'speech' | 'ai' | 'diagnostics' | 'extension' | 'backup' | 'components';

/** `extension_info` komutunun döndürdüğü hâli (bkz. `src-tauri/src/pairing.rs`). */
interface ExtensionInfo {
  dir: string;
  installed: boolean;
  lastSeen: number | null;
}

const THRESHOLD_OPTIONS: SelectOption[] = ['0.3', '0.5', '0.6', '0.7', '0.8'].map((v) => ({
  value: v,
  label: v,
}));

const DEDUPE_THRESHOLD_OPTIONS: SelectOption[] = [0.8, 0.82, 0.84, 0.86, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98].map(
  (v) => ({ value: String(v), label: v.toFixed(2).replace('.', ',') }),
);

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

// --- Yerel AI: donanım/offload görünümü ve rıza metni -------------------------
//
// Buradaki hiçbir sayı ELLE yazılmaz: boyutlar `components_status.approx_mb`'den,
// donanım `ai_status.gpu`'dan, karar/gerekçe `ai_status.offload`'dan gelir. Eskiden
// sabit yazılan GPU adı/VRAM iddiaları bilinçli olarak kaldırıldı; yanlış donanım
// adı göstermek, hiç göstermemekten kötüdür.

const MB_PER_GB = 1024;

/** MiB → okunur birim. 1024'ün altı MB kalır; uydurma yuvarlama yok. */
function formatMb(mb: number): string {
  return mb >= MB_PER_GB ? `${(mb / MB_PER_GB).toFixed(1)} GB` : `${mb} MB`;
}

/*
 * Donanım satırı: YALNIZCA tespit edileni söyler.
 *   - nvidia-smi → ad + gerçek VRAM
 *   - WMI → yalnızca ad; VRAM okunamadı (WMI'nin AdapterRAM'i 4 GB üstünde taşar,
 *     bu yüzden backend oradan VRAM vermez)
 *   - hiçbiri → "bilinmiyor"
 * Hiçbir dalda uydurma sayı yoktur.
 */
function gpuHardwareLine(gpu: AiGpuInfo | undefined): string {
  if (!gpu || (gpu.name === null && gpu.vram_mb === null)) {
    return 'GPU bilinmiyor — nvidia-smi ve WMI sonuç vermedi.';
  }
  if (gpu.name !== null && gpu.vram_mb !== null) {
    return `${gpu.name} · ${formatMb(gpu.vram_mb)} VRAM (kaynak: ${gpu.source})`;
  }
  if (gpu.name !== null) {
    return `${gpu.name} · VRAM okunamadı (WMI yalnızca ad verir).`;
  }
  if (gpu.vram_mb !== null) {
    return `GPU adı okunamadı · ${formatMb(gpu.vram_mb)} VRAM (kaynak: ${gpu.source})`;
  }
  return 'GPU bilinmiyor — nvidia-smi ve WMI sonuç vermedi.';
}

/*
 * "Yerel AI neye ihtiyaç duyar" listesi: yalnızca KAYIT KİMLİKLERİ ve kullanıcıya
 * dönük rol metni. Boyut burada YOK — her satırın MB'ı `components_status`'tan
 * okunur ki Bileşenler ekranıyla iki farklı sayı gösterilmesin (tek gerçek).
 */
const AI_COMPONENT_ITEMS: readonly { id: string; role: string; optional?: boolean }[] = [
  { id: 'llama-engine', role: 'AI motoru (llama-server)' },
  { id: 'llama-cudart', role: 'CUDA çalışma zamanı (GPU hızlandırma)', optional: true },
  { id: 'llama-engine-cuda', role: 'llama-server CUDA motoru (NVIDIA)', optional: true },
  { id: 'ai-model-embed', role: 'BGE-M3 anlamsal gömme modeli' },
];

/*
 * Seçilebilir sohbet modelleri — kayıt kimlikleri (`components.rs::CHAT_MODEL_IDS`)
 * ve kayıt etiketleriyle (`Spec::label`) birebir. Boyut burada YOK; her satırın
 * MB'ı `components_status.approx_mb`'den okunur (tek gerçek). Sıra: hafiften ağıra.
 */
const CHAT_MODELS: readonly { id: string; label: string }[] = [
  { id: 'ai-model-llm-3b', label: 'Qwen 2.5 3B (sohbet)' },
  { id: 'ai-model-llm-7b', label: 'Qwen 2.5 7B (sohbet)' },
  { id: 'ai-model-llm', label: 'Qwen 2.5 14B (sohbet)' },
];

/** Hız sınırı seçenekleri (bayt/sn). 0 = sınırsız. */
const SPEED_LIMIT_OPTIONS = [
  { value: '0', label: 'Sınırsız' },
  { value: String(1024 * 1024), label: '1 MB/s' },
  { value: String(2 * 1024 * 1024), label: '2 MB/s' },
  { value: String(4 * 1024 * 1024), label: '4 MB/s' },
  { value: String(8 * 1024 * 1024), label: '8 MB/s' },
  { value: String(16 * 1024 * 1024), label: '16 MB/s' },
];

const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({
  value: String(n),
  label: `${n} indirme`,
}));

const CONNECTION_OPTIONS = [
  { value: '4', label: '4 kanal' },
  { value: '8', label: '8 kanal (önerilen)' },
  { value: '16', label: '16 kanal' },
  { value: '32', label: '32 kanal' },
];

const AFTER_COMPLETE_OPTIONS = [
  { value: 'none', label: 'Hiçbir şey' },
  { value: 'open', label: 'Dosyayı aç' },
  { value: 'reveal', label: 'Klasörde göster' },
];

const RETRY_OPTIONS = [0, 1, 2, 3, 5].map((n) => ({
  value: String(n),
  label: n === 0 ? 'Kapalı' : `${n} deneme`,
}));

export function SettingsView(props: SettingsViewProps) {
  const { pageSize, pageSizes, onPageSizeChange, onReplayTour, onClose, initialTab = 'ai' } = props;
  const { open, reveal } = useOpenTarget();
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
  // İndirme motoru ayarları (IDM'in "Connection" sekmesinin karşılığı).
  const [dlSettings, setDlSettings] = useState<DownloadSettings>(DEFAULT_DOWNLOAD_SETTINGS);
  const [dlSettingsError, setDlSettingsError] = useState<string | null>(null);
  // Eşleşme anahtarı
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [confirmRegenOpen, setConfirmRegenOpen] = useState(false);
  // Eklenti: kurulum klasörü + "bağlandı mı" durumu
  const [extension, setExtension] = useState<ExtensionInfo | null>(null);
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
  /*
   * Bileşen kayıt boyutları (id → approx_mb). Boyut ETİKETLERİ buradan türetilir:
   * aynı modelin iki ekranda iki farklı sayı göstermesi (ör. BGE ~1.5 GB vs
   * gerçek ~605 MB) "iki gerçek" üretirdi. Kayıttan okunamazsa harf/sayı
   * uydurulmaz; ilgili etiket yedek pin değerine düşer.
   */
  const [componentSizes, setComponentSizes] = useState<Record<string, number | undefined>>({});
  /* id → kurulu dosya yolu: model seçimi `llm_path`'e bu yolu yazar (tek kaynak). */
  const [componentPaths, setComponentPaths] = useState<Record<string, string>>({});

  // Yerel AI (Qwen 2.5 14B + BGE-M3 + llama-server)
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiEngineJob, setAiEngineJob] = useState<string | null>(null);
  const [aiModelJob, setAiModelJob] = useState<string | null>(null);
  const [aiModelType, setAiModelType] = useState<'llm' | 'embed' | null>(null);
  /* Sohbet modeli kurulumu (satır içi; tek indirme motoru `downloadComponent`). */
  const [chatJob, setChatJob] = useState<{ id: string; jobId: string } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  // Ana anahtar (`enabled`) yazımı ve açık rıza onayı: indirme DEĞİL, tercih.
  const [aiConfigBusy, setAiConfigBusy] = useState(false);
  const [aiConfirm, setAiConfirm] = useState<'enable' | 'disable' | null>(null);
  const [reindexProgress, setReindexProgress] = useState<{
    current: number;
    total: number;
    phase: 'content' | 'vectors';
  } | null>(null);
  const [reindexBusy, setReindexBusy] = useState(false);
  const aiEnginePct = useAiEngineProgress(aiEngineJob);
  const aiModelPct = useAiModelProgress(aiModelJob);
  const chatModelPct = useAiModelProgress(chatJob?.jobId ?? null);

  const refreshComponentStatus = useCallback(async (): Promise<void> => {
    try {
      const rows = await invoke<ComponentStatus[]>('components_status');
      const sizes: Record<string, number> = {};
      const paths: Record<string, string> = {};
      for (const row of rows) {
        sizes[row.id] = row.approx_mb;
        if (row.path) paths[row.id] = row.path;
      }
      setComponentSizes(sizes);
      setComponentPaths(paths);
    } catch {
      setComponentSizes({});
      setComponentPaths({});
    }
  }, []);

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
    // Boyut/yol etiketleri kayıttan gelir (tek gerçek); okunamazsa boş kalır.
    void refreshComponentStatus();
    void invoke<string>('get_close_behavior')
      .then((m) => setCloseMode(m === 'quit' ? 'quit' : 'tray'))
      .catch(() => setCloseMode('tray'));
    void invoke<string>('get_download_dir')
      .then(setDir)
      .catch((e: unknown) => setDirError(String(e)));
    void invoke<string>('get_pairing_token')
      .then(setToken)
      .catch((e: unknown) => setTokenError(String(e)));
    void getDownloadSettings()
      .then(setDlSettings)
      .catch((e: unknown) => setDlSettingsError(String(e)));
  }, [refreshComponentStatus]);

  // Eklenti sekmesi her açıldığında tazelenir: kullanıcı eklentiyi bağlar ve
  // "son temas"ın gerçekten güncellendiğini aynı ekranda görmesi gerekir.
  useEffect(() => {
    if (tab !== 'extension') return;
    void invoke<ExtensionInfo>('extension_info')
      .then(setExtension)
      .catch(() => setExtension(null));
  }, [tab]);

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

  /**
   * İndirme motoru ayarını yazar. İyimser güncelleme: anahtar anında oynar,
   * sonra backend'e yazılır ve motor sınırları aynı çağrıda tazelenir.
   */
  const updateDlSettings = async (patch: Partial<DownloadSettings>): Promise<void> => {
    const next = { ...dlSettings, ...patch };
    setDlSettings(next);
    setDlSettingsError(null);
    try {
      setDlSettings(await setDownloadSettings(next));
    } catch (e: unknown) {
      setDlSettingsError(String(e));
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
        title: type === 'llm' ? 'Sohbet Modeli (.gguf)' : 'BGE-M3 Vektör Modeli (.gguf)',
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

  /* Kayıtlı sohbet modelini seç: yolu `llm_path`'e yaz (backend çözümlemesi buradan). */
  const selectChatModel = async (id: string): Promise<void> => {
    const path = componentPaths[id];
    if (!path) return;
    setAiError(null);
    try {
      await saveAiConfig({ llm_path: path });
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    }
  };

  /* Kurulu olmayan sohbet modelini indir (tek motor: `downloadComponent`). */
  const installChatModel = async (id: string): Promise<void> => {
    if (chatJob) return;
    setAiError(null);
    const jobId = crypto.randomUUID();
    setChatJob({ id, jobId });
    try {
      const res = await downloadComponent(id, jobId);
      if (!res.ok) {
        setAiError(res.error ?? 'Model indirilemedi.');
        return;
      }
      await refreshComponentStatus();
      await refreshAi();
    } finally {
      setChatJob(null);
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
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ done: number; total: number } | null>(null);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const [tagThreshold, setTagThreshold] = useState(() => readTagThreshold());
  // Defteri Hazırla: adım göstergesi + rapor + tekrar grupları
  const [defterBusy, setDefterBusy] = useState(false);
  const [defterStep, setDefterStep] = useState<string | null>(null);
  const [defterReport, setDefterReport] = useState<NotebookReport | null>(null);
  const [defterGroups, setDefterGroups] = useState<DupeGroup[]>([]);
  const [defterDone, setDefterDone] = useState<Record<number, 'merged' | 'skipped'>>({});
  const [defterMsg, setDefterMsg] = useState<string | null>(null);
  const [defterError, setDefterError] = useState<string | null>(null);
  const [dedupeThreshold, setDedupeThreshold] = useState(() => readNotebookThreshold());
  // Grup bazında hedef değişimi (varsayılan: en eski kayıt)
  const [defterTargets, setDefterTargets] = useState<Record<number, string>>({});

  // Sıradaki öğe sınırında durur; görünüm kapanırsa iş kalmasın.
  useEffect(() => () => analysisAbortRef.current?.abort(), []);

  const handleThresholdChange = (v: string): void => {
    setTagThreshold(Number(v));
    try {
      localStorage.setItem(TAG_THRESHOLD_KEY, v);
    } catch {
      // localStorage erişilemezse sessizce geç
    }
  };

  /* Defteri Hazırla */
  const notebookCancelRef = useRef(false);
  const describeNotebookReport = (r: NotebookReport): string[] => {
    const out: string[] = [];
    out.push(
      r.scrapeFailed > 0
        ? `Adım 1: ${r.scraped} tamamlandı, ${r.scrapeFailed} başarısız`
        : `Adım 1: ${r.scraped} tamamlandı`,
    );
    const cat = r.categorize;
    out.push(!cat ? 'Adım 2: öğe yok' : 'aiOff' in cat ? 'Adım 2: AI kapalı, atlandı' : `Adım 2: ${cat.applied} uygulandı, ${cat.lowConfidence} düşük güven`);
    const dd = r.dedupe;
    if (!dd) out.push('Adım 3: taranacak öğe yok');
    else if (dd.aiOff) out.push('Adım 3: AI kapalı, atlandı');
    else out.push(`Adım 3: ${dd.groups.length} tekrar grubu`);
    return out;
  };
  const runNotebook = async (): Promise<void> => {
    setDefterBusy(true);
    setDefterError(null);
    setDefterMsg(null);
    setDefterGroups([]);
    setDefterDone({});
    setDefterTargets({});
    try {
      const report = await runNotebookPipeline(
        { ...makeNotebookDeps(), isCancelled: () => notebookCancelRef.current },
        (stage, done, total, label) => setDefterStep(`Adım ${stage}/3 · ${label}: ${done}/${total}`),
      );
      notebookCancelRef.current = false;
      setDefterReport(report);
      setDefterGroups(report.dedupe?.groups ?? []);
      setDefterMsg(describeNotebookReport(report).join(' · '));
    } catch (e) {
      setDefterError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Boru hattı başarısız.');
    } finally {
      setDefterBusy(false);
      setDefterStep(null);
    }
  };
  const mergeNotebookGroup = async (index: number): Promise<void> => {
    const resolved = resolveGroup(defterGroups[index], index);
    if (!resolved) return;
    setDefterBusy(true);
    try {
      const res = await applyMerges([resolved], makeNotebookDeps());
      setDefterDone((p) => ({ ...p, [index]: res.failedGroups.length === 0 ? 'merged' : 'skipped' }));
      if (res.failedGroups.length > 0) setDefterError(res.failedGroups[0].error);
    } finally {
      setDefterBusy(false);
    }
  };
  const mergeRemainingNotebook = async (): Promise<void> => {
    const pending = defterGroups
      .map((g, i) => resolveGroup(g, i))
      .filter((_, i) => !defterDone[i]);
    if (pending.length === 0) return;
    setDefterBusy(true);
    try {
      const res = await applyMerges(pending, makeNotebookDeps());
      setDefterError(res.failedGroups.length > 0 ? `${res.failedGroups.length} grup başarısız` : null);
      setDefterDone((p) => {
        const next = { ...p };
        for (let i = 0; i < defterGroups.length; i++) if (!next[i]) next[i] = 'merged';
        for (const fg of res.failedGroups) {
          const idx = defterGroups.findIndex((g) => g.targetId === fg.targetId);
          if (idx >= 0) next[idx] = 'skipped';
        }
        return next;
      });
      setDefterMsg(`Birleştirme: ${res.merged} kayıt birleşti, artıklar silindi.`);
    } finally {
      setDefterBusy(false);
    }
  };
  const retryFailedNotebook = async (): Promise<void> => {
    if (!defterReport || defterReport.scrapeFailures.length === 0) return;
    setDefterBusy(true);
    try {
      const res = await makeNotebookDeps().scrape(defterReport.scrapeFailures, (done, total) =>
        setDefterStep(`Yeniden kazıma: ${done}/${total}`),
      );
      setDefterReport({
        ...defterReport,
        scraped: defterReport.scraped + res.successCount,
        scrapeFailed: res.errorCount,
        scrapeFailures: res.failed,
      });
      setDefterMsg(res.failed.length === 0 ? 'Başarısızlar tamamlandı.' : `Hâlâ başarısız: ${res.failed.length}`);
    } catch (e) {
      setDefterError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Yeniden deneme başarısız.');
    } finally {
      setDefterBusy(false);
      setDefterStep(null);
    }
  };
  const handleDedupeThresholdChange = (v: string): void => {
    const value = Number(v);
    setDedupeThreshold(value);
    writeNotebookThreshold(value);
  };
  const trDateLabel = (iso: string): string => {
    try {
      return new Date(iso).toLocaleDateString('tr-TR');
    } catch {
      return iso;
    }
  };
  const memberAsItem = (m: DupeGroup['members'][number]): Item =>
    ({
      id: m.id,
      url: m.url,
      title: m.title,
      note: m.note,
      platform: 'x',
      thumbnail: m.thumbnail,
      favorite: m.favorite,
      collection_id: null,
      user_id: null,
      created_at: m.created_at,
      updated_at: m.created_at,
      local_path: null,
      download_status: 'none',
      download_error: null,
      converted_path: null,
    }) as Item;
  const resolveGroup = (g: DupeGroup, index: number): DupeGroup => {
    const override = defterTargets[index];
    if (!override || override === g.targetId) return g;
    const target = g.members.find((m) => m.id === override);
    if (!target) return g;
    const rest = g.members.filter((m) => m.id !== override).map(memberAsItem);
    const patch = planItemMerge(memberAsItem(target), rest);
    return {
      ...g,
      targetId: target.id,
      victimIds: [...patch.victimIds],
      patch,
      targetTitle: target.title ?? target.url,
      victimTitles: rest.map((it) => it.title ?? it.url),
    };
  };

  const [recatBusy, setRecatBusy] = useState(false);
  const [recatProgress, setRecatProgress] = useState<{ current: number; total: number; title: string } | null>(null);
  const [recatResult, setRecatResult] = useState<string | null>(null);
  const [confirmRecatOpen, setConfirmRecatOpen] = useState(false);

  const runRecategorizeAll = async () => {
    setConfirmRecatOpen(false);
    setRecatBusy(true);
    setRecatResult(null);
    setRecatProgress(null);
    try {
      // Yedek ZORUNLU: alınamazsa işlem başlamaz.
      await createBackup(await getDb());
      const allItems = await listItems();
      const res = await batchCategorizeItems(allItems, {
        forceAutoApply: true,
        replaceExisting: true,
        onProgress: (current, total, title) => setRecatProgress({ current, total, title }),
      });
      setRecatResult(
        `${res.applied} kayıt yeniden üretildi` +
          `${res.failed > 0 ? ` · ${res.failed} başarısız` : ''}. ` +
          'Eşik altı kalan kayıtlarda eski atamalar korundu.',
      );
    } catch (e) {
      setAiError(String(e));
    } finally {
      setRecatBusy(false);
      setRecatProgress(null);
    }
  };

  const runOrganizeUncategorized = async () => {
    setOrganizeBusy(true);
    setOrganizeResult(null);
    setOrganizeProgress(null);
    try {
      const allItems = await listItems();
      /* N+1 YOK: öğe başına 2 sorgu yerine toplam 2 sorgu. Ölçek farkı burada
         büyük — 2000 kayıtlık arşivde 4000 çağrı yerine 2. */
      const [tagsByItem, catsByItem] = await Promise.all([getAllTagsByItem(), getAllCategoriesByItem()]);
      const targetItems = allItems.filter(
        (item) => (catsByItem[item.id]?.length ?? 0) === 0 || (tagsByItem[item.id]?.length ?? 0) === 0,
      );

      if (targetItems.length === 0) {
        setOrganizeResult('Kategorisiz veya etiketsiz kayıt bulunamadı (tümü düzenli).');
        return;
      }

      const res = await batchCategorizeItems(targetItems, {
        forceAutoApply: true,
        onProgress: (current, total, title) => {
          setOrganizeProgress({ current, total, title });
        },
      });

      setOrganizeResult(
        `${res.applied} uygulandı · ${res.lowConfidence} düşük güvenle atlandı · ` +
          `${res.deterministic} LLM'siz eşleşti` +
          `${res.failed > 0 ? ` · ${res.failed} başarısız` : ''}` +
          `${res.skipped > 0 ? ` · ${res.skipped} öneri (uygulama kapalı)` : ''}.`,
      );
    } catch (e) {
      setAiError(String(e));
    } finally {
      setOrganizeBusy(false);
      setOrganizeProgress(null);
    }
  };

  const runAnalyzeMissing = async () => {
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setAnalysisBusy(true);
    setAnalysisResult(null);
    setAnalysisProgress(null);
    try {
      const res = await analyzeMissing(
        (done, total) => setAnalysisProgress({ done, total }),
        controller.signal,
      );
      const parts = [`${res.processed} analiz edildi`];
      if (res.skipped > 0) parts.push(`${res.skipped} atlandı`);
      if (res.failed > 0) parts.push(`${res.failed} başarısız`);
      setAnalysisResult(`${controller.signal.aborted ? 'İptal edildi · ' : ''}${parts.join(' · ')}`);
      // Arşiv görünümü indeks tazelenince yeniden yüklenir.
      window.dispatchEvent(new CustomEvent('vault-items-updated'));
    } catch (e) {
      setAiError(String(e));
    } finally {
      analysisAbortRef.current = null;
      setAnalysisBusy(false);
      setAnalysisProgress(null);
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

  /*
   * `enabled` ANA anahtardır: yalnızca özelliği açar/kapatır. İNDİRME BAŞLATMAZ ve
   * süreç çalıştırmaz (Rust `ai_save_config` yalnızca yapılandırmayı yazar).
   * `auto_warmup` bu karara GİRMEZ; o ayrı bir ön yükleme tercihidir.
   */
  const runSetAiEnabled = async (enabled: boolean): Promise<void> => {
    setAiError(null);
    setAiConfigBusy(true);
    try {
      // Yalnızca ana anahtar yazılır; `ai_save_config` indirme/süreç başlatmaz.
      await saveAiConfig({ enabled });
      await refreshAi();
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiConfigBusy(false);
    }
  };

  const runReindex = async () => {
    setReindexBusy(true);
    setReindexProgress({ current: 0, total: 100, phase: 'content' });
    try {
      await reindexVault((current, total, phase) => {
        setReindexProgress({ current, total, phase });
      });
    } catch (e) {
      setAiError(String(e));
    } finally {
      setReindexBusy(false);
      setReindexProgress(null);
    }
  };

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: 'ai', label: 'Yapay Zekâ', icon: <Sparkles className="size-4" />, desc: 'Qwen 2.5 3B/7B/14B, BGE-M3, VRAM yönetimi, taksonomi ve indeksleme' },
    { id: 'speech', label: 'Konuşma (Whisper)', icon: <Mic className="size-4" />, desc: 'Whisper.cpp yerel konuşma tanıma motoru ve modelleri' },
    { id: 'view', label: 'Görünüm', icon: <Eye className="size-4" />, desc: 'Arayüz teması, sayfalama ve pano izleme tercihleri' },
    { id: 'downloads', label: 'İndirme', icon: <Download className="size-4" />, desc: 'Medya indirme klasörü, varsayılan kalite ve sistem çekmecesi' },
    { id: 'components', label: 'Bileşenler', icon: <PackageCheck className="size-4" />, desc: 'ffmpeg, ffprobe, yt-dlp ve whisper motorunun kurulum durumu' },
    { id: 'diagnostics', label: 'Tanılama', icon: <Activity className="size-4" />, desc: 'Sistem donanımı, CUDA, ffmpeg ve yt-dlp sağlık kontrolleri' },
    { id: 'extension', label: 'Eklenti', icon: <Plug className="size-4" />, desc: 'Tarayıcı uzantısı ile güvenli bağlantı eşleşme anahtarı' },
    { id: 'backup', label: 'Yedekleme', icon: <Database className="size-4" />, desc: 'Arşiv veritabanını JSON olarak dışa aktar veya geri yükle' },
  ];

  const currentTab = tabs.find((t) => t.id === tab) ?? tabs[0];

  const doExport = async (): Promise<void> => {
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const data = await exportVault();
      /*
       * Yol RENDERER'DAN GEÇMEZ: dosya seçimini Rust yapar (`export_backup`).
       * Böylece "kullanıcı seçti" iddiası doğrulanabilir kalır — renderer istediği
       * yolu gönderemez. (Eskiden `write_text_file` + burada seçilen yol vardı.)
       */
      const written = await invoke<string | null>('export_backup', {
        content: JSON.stringify(data),
        suggestedName: `jointvault-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filterName: 'JSON',
        extensions: ['json'],
      });
      if (!written) return;
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

  /*
   * Kayıttan (`components_status.approx_mb`) okunan dürüst boyut etiketi.
   * Bilinmiyorsa BOŞ string: uydurma sayı yazmak yerine etiket gizlenir.
   * `fallbackMb` yalnızca kayıt henüz okunamadıysa kullanılır ve kayıttaki
   * pinle aynı tutulur (bkz. `whisper.ts WHISPER_MODELS`).
   */
  const sizeSuffix = (id: string, fallbackMb?: number): string => {
    const mb = componentSizes[id] ?? fallbackMb;
    return mb === undefined ? '' : ` (~${mb} MB)`;
  };

  /*
   * Bir dosya yolunun boyutu, kayıttan (id → approx_mb) bulunur. Serbest GGUF
   * kayıtlı bir dosyayla çakışmıyorsa `undefined` döner; uydurma sayı yazılmaz.
   */
  const componentMbForPath = (path: string): number | undefined => {
    for (const [id, p] of Object.entries(componentPaths)) {
      if (p === path) return componentSizes[id];
    }
    return undefined;
  };

  // Yerel AI görünümü: etkinlik kararı TEK yerden (`isAiEnabled`, fail-closed).
  const aiEnabled = isAiEnabled(aiStatus);
  const aiGpu = aiStatus?.gpu;
  const aiOffload = aiStatus?.offload;

  /*
   * Seçili sohbet modeli: `llm_path` kayıtlı bir modelin YOLUYLA eşleşiyorsa o id,
   * aksi hâlde null (serbest GGUF). Karşılaştırma YOL üzerinden yapılır çünkü
   * backend de `llm_path`'i yolla çözer.
   */
  const llmPath = aiStatus?.llm_path ?? null;
  const selectedChatModelId = llmPath
    ? CHAT_MODELS.find((m) => componentPaths[m.id] === llmPath)?.id ?? null
    : null;
  /* Serbest GGUF: kayıtlı bir modelle eşleşmeyen, doğrulanmamış bir yol. */
  const freeGgufSelected =
    llmPath !== null && selectedChatModelId === null && aiStatus?.llm_verified !== true;
  const freeGgufSize = freeGgufSelected ? componentMbForPath(llmPath) : undefined;

  /*
   * Rıza metninin toplamı KAYITTAN toplanır. Eksik boyut varsa toplam GÖSTERİLMEZ:
   * yarım toplamı "küçük bir indirme" gibi göstermek yanlış olurdu (uydurma sayı).
   */
  /*
   * Rıza listesi: motor + gömme ZORUNLU, CUDA opsiyonel. Sohbet modeli satırları
   * SEÇİLİ modele göre işaretlenir — 14B'yi dayatmaz (M-2); seçim yoksa en hafif
   * (3B) zorunlu sayılır. Boyut her satırda KAYITTAN gelir.
   */
  const activeChatModelId = freeGgufSelected ? null : (selectedChatModelId ?? 'ai-model-llm-3b');
  const chatModelRows = CHAT_MODELS.map((model) => ({
    id: model.id,
    role: model.label,
    optional: model.id !== activeChatModelId,
    mb: componentSizes[model.id],
  }));
  const aiComponentRows = [
    ...AI_COMPONENT_ITEMS.map((item) => ({ ...item, mb: componentSizes[item.id] })),
    ...chatModelRows,
  ];
  /* Toplam YALNIZCA zorunlu satırlardan: CUDA ve seçili olmayan sohbet modelleri opsiyoneldir. */
  const aiRequiredRows = aiComponentRows.filter((row) => !row.optional);
  const aiSizesComplete = aiRequiredRows.every((row) => row.mb !== undefined);
  const aiTotalLabel = aiSizesComplete
    ? `≈ ${formatMb(aiRequiredRows.reduce((sum, row) => sum + (row.mb ?? 0), 0))}`
    : 'boyut bilgisi yükleniyor…';

  const aiServerRunning = aiStatus?.chat_server_running === true || aiStatus?.embed_server_running === true;
  const offloadTarget = aiOffload?.mode === 'gpu' ? "VRAM'e (GPU)" : 'belleğe (CPU)';
  const aiStatusLine =
    warmupStatus.status === 'loading'
      ? `🟡 Modeller ${offloadTarget} yükleniyor (ısıtılıyor)…`
      : aiServerRunning
        ? aiOffload?.mode === 'gpu'
          ? `🟢 Çalışıyor — tüm katmanlar GPU'da (${aiOffload.n_gpu_layers} katman)`
          : "🟢 Çalışıyor — CPU'da (VRAM kullanılmıyor)"
        : '⚪ Uyku Modunda — sunucu kapalı';

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
              Sistem tercihleri, modeller, donanım hızlandırma ve arşiv yönetimi
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
            <ArrowLeft className="size-3.5" /> Arşive Dön
          </Button>
        )}
      </header>

      {/* Ana Gövde: 2 Sütunlu Sayfa Düzeni */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sol Sekme Menüsü (Desktop) */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/50 p-2.5 md:flex overflow-y-auto">
          <nav className="flex flex-col gap-0.5">
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[0.8125rem] transition-colors duration-150 ease-out ${
                    active
                      ? 'bg-primary/15 font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                  }`}
                >
                  <span className={active ? 'text-primary' : undefined}>{t.icon}</span>
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
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors duration-150 ease-out ${
                  tab === t.id
                    ? 'bg-primary/15 font-medium text-foreground'
                    : 'bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                <span className={tab === t.id ? 'text-primary' : undefined}>{t.icon}</span>
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
                {/* 0. Açık rıza: Yerel AI'yı etkinleştir / kapat */}
                <div className="flex flex-col gap-3 settings-card p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Yerel AI</p>
                      <p className="text-xs text-muted-foreground">
                        {aiEnabled
                          ? 'Etkin. Asistan ve anlamsal arama kullanılabilir.'
                          : 'Kapalı. Asistan ve anlamsal arama bu anahtar açılmadan çalışmaz.'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {aiEnabled ? <Stamp state="local">etkin</Stamp> : <Stamp state="none">kapalı</Stamp>}
                      <Button
                        variant={aiEnabled ? 'outline' : 'default'}
                        size="sm"
                        disabled={aiConfigBusy}
                        onClick={() => setAiConfirm(aiEnabled ? 'disable' : 'enable')}
                      >
                        {aiConfigBusy ? 'Kaydediliyor…' : aiEnabled ? "Yerel AI'yı kapat" : "Yerel AI'yı etkinleştir"}
                      </Button>
                    </div>
                  </div>

                  {/* Rıza metni: kullanıcı ONAYLAMADAN önce ne indirileceğini ve toplamı görür. */}
                  {!aiEnabled && (
                    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-background/40 p-3">
                      <p className="text-xs text-muted-foreground">
                        Etkinleştirmek <span className="font-medium text-foreground">hiçbir şey indirmez</span>; yalnızca
                        özelliği açar. Gerekli dosyalar inene kadar asistan yanıt veremez. İndirmeyi sen başlatırsın
                        (aşağıdaki düğmeler veya Ayarlar → Bileşenler); kurulu bileşenler yeniden indirilmez.
                      </p>
                      <ul className="flex flex-col gap-1">
                        {aiComponentRows.map((row) => (
                          <li key={row.id} className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">
                              {row.role}
                              {row.optional ? ' · opsiyonel' : ''}
                            </span>
                            <span className="font-mono text-2xs text-foreground">
                              {row.mb !== undefined ? formatMb(row.mb) : 'boyut okunamadı'}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-2 text-xs">
                        <span className="text-muted-foreground">Gerekli toplam indirme</span>
                        <span className="font-mono text-xs font-medium">{aiTotalLabel}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Donanım tespiti + offload kararı: sabit metin YOK, tespit ne ise o yazılır. */}
                <div className="flex items-start justify-between gap-3 settings-card p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Yerel Donanım Hızlandırma</p>
                    <p className="text-xs text-muted-foreground">{gpuHardwareLine(aiGpu)}</p>
                    <p className="text-xs text-muted-foreground">
                      Offload kararı: {aiOffload?.reason ?? 'okunamadı (tespit yok).'}
                    </p>
                  </div>
                  <Stamp state={aiOffload?.mode === 'gpu' ? 'local' : 'none'}>
                    {aiOffload
                      ? aiOffload.mode === 'gpu'
                        ? `GPU · ${aiOffload.n_gpu_layers} katman`
                        : 'CPU'
                      : 'bilinmiyor'}
                  </Stamp>
                </div>

                {/* 1. AI Motoru */}
                <div className="flex flex-col gap-2 settings-card p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium">AI Motoru (llama-server)</span>
                      <p className="text-xs text-muted-foreground">Yerel inference sunucusu{sizeSuffix('llama-engine')}</p>
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

                {/* 2. Sohbet Modeli — 3B/7B/14B sabit hat + serbest GGUF ("doğrulanmadı") */}
                <div className="flex flex-col gap-3 settings-card p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm font-medium">Sohbet Modeli</span>
                      <p className="text-xs text-muted-foreground">
                        Asistan ve özetleme için kullanılan model. Seçim kalıcıdır; boyutlar bileşen
                        kaydından okunur.
                      </p>
                    </div>
                    <div className="shrink-0">
                      {aiStatus?.llm_ready ? (
                        <Stamp state="local">hazır</Stamp>
                      ) : (
                        <Stamp state="none">eksik</Stamp>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col divide-y divide-border/70">
                    {CHAT_MODELS.map((m) => {
                      const installed = componentPaths[m.id] !== undefined;
                      const selected = selectedChatModelId === m.id;
                      const installing = chatJob?.id === m.id;
                      const mb = componentSizes[m.id];
                      return (
                        <SettingRow
                          key={m.id}
                          label={m.label}
                          hint={
                            mb !== undefined
                              ? `${installed ? 'kurulu' : 'indirilecek'} · ${formatMb(mb)}`
                              : installed
                                ? 'kurulu'
                                : 'boyut okunamadı'
                          }
                        >
                          {selected && <Stamp state="local">seçili</Stamp>}
                          {installed ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={selected}
                              onClick={() => void selectChatModel(m.id)}
                            >
                              Seç
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={chatJob !== null}
                              onClick={() => void installChatModel(m.id)}
                            >
                              {installing
                                ? chatModelPct !== null && chatModelPct >= 0
                                  ? `%${Math.round(chatModelPct)}`
                                  : '…'
                                : 'Kur'}
                            </Button>
                          )}
                        </SettingRow>
                      );
                    })}

                    <SettingRow
                      label="Serbest GGUF"
                      hint={
                        freeGgufSelected
                          ? `Seçili dosya: ${aiStatus?.llm_label ?? 'ad okunamadı'}`
                          : 'Kayıtlı olmayan bir .gguf dosyası seç. Doğrulanmadığı damgayla belirtilir.'
                      }
                    >
                      {freeGgufSelected && <Stamp state="none">doğrulanmadı</Stamp>}
                      {freeGgufSize !== undefined && (
                        <span className="font-mono text-2xs text-muted-foreground">{formatMb(freeGgufSize)}</span>
                      )}
                      <Button variant="outline" size="sm" onClick={() => void pickAiModelFile('llm')}>
                        Diskten Seç
                      </Button>
                    </SettingRow>
                  </div>

                  {aiStatus?.llm_path && (
                    <p className="truncate font-mono text-2xs text-muted-foreground" title={aiStatus.llm_path}>
                      {aiStatus.llm_path}
                    </p>
                  )}
                </div>

                {/* 3. Embedding Modeli */}
                <div className="flex flex-col gap-2 settings-card p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium">BGE-M3 Vektör Modeli</span>
                      <p className="text-xs text-muted-foreground">Türkçe & Çok Dilli Anlamsal İndeksleme{sizeSuffix('ai-model-embed')}</p>
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
                <div className="flex flex-col gap-3.5 settings-card p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Çalışma Durumu & Hızlandırma</p>
                      <p className="text-xs text-muted-foreground">{aiStatusLine}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Chat: {aiStatus?.chat_server_running ? '🟢' : '⚪'} | Embed: {aiStatus?.embed_server_running ? '🟢' : '⚪'}
                      </span>
                      {aiServerRunning ? (
                        <Button variant="outline" size="sm" onClick={() => void runStopAi()}>
                          {aiOffload?.mode === 'gpu' ? "VRAM'i Boşalt" : 'Sunucuyu Durdur'}
                        </Button>
                      ) : (
                        aiStatus?.llm_ready && aiStatus?.embed_ready && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void runWarmupAi()}
                            disabled={warmupBusy || warmupStatus.status === 'loading'}
                          >
                            {warmupBusy || warmupStatus.status === 'loading'
                              ? 'Yükleniyor…'
                              : aiOffload?.mode === 'gpu'
                                ? "VRAM'e Yükle (Isıt)"
                                : 'Belleğe Yükle (Isıt)'}
                          </Button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Açılışta Otomatik Isıtma / Warmup + Boşta Kalma: tek satır listesi */}
                  <div className="flex flex-col divide-y divide-border/70">
                    <SettingRow
                      label="Açılışta Otomatik Başlat (Warmup)"
                      hint={`Yerel AI açıkken uygulama başlarken modelleri arka planda ${offloadTarget} yükler; ilk sorunuz anında yanıtlanır. Bu AYRI bir ön yükleme tercihidir — kapatmak Yerel AI'yı kapatmaz.`}
                    >
                      <Switch
                        checked={aiStatus?.auto_warmup ?? true}
                        onCheckedChange={(checked) => void handleToggleAutoWarmup(checked)}
                      />
                    </SettingRow>

                    <SettingRow
                      label="Boşta Kalma Süresi (Uyku Modu)"
                      hint={`Belirtilen süre işlem yapılmazsa ${aiOffload?.mode === 'gpu' ? 'VRAM' : 'model belleği'} otomatik boşaltılır.`}
                    >
                      <div className="w-56">
                        <Select
                          label="Boşta Kalma Süresi"
                          size="sm"
                          options={IDLE_OPTIONS}
                          value={String(aiStatus?.idle_timeout_secs ?? 600)}
                          onValueChange={(val) => void handleChangeIdleTimeout(Number(val))}
                        />
                      </div>
                    </SettingRow>
                  </div>
                </div>

                {/* 5. Akıllı Taksonomi & Otomasyon */}
                <div className="flex flex-col gap-3.5 settings-card p-4">
                  <div>
                    <p className="text-sm font-medium">Akıllı Taksonomi & Otomasyon</p>
                    <p className="text-xs text-muted-foreground">
                      Qwen 2.5'in içerikleri sınıflandırma ve etiketleme davranışlarını yapılandırın.
                    </p>
                  </div>

                  {/* Satır listesi: tek sözlük */}
                  <div className="flex flex-col divide-y divide-border/70">
                    <SettingRow
                      label="Önerileri Otomatik Uygula"
                      hint="Yeni kayıt eklendiğinde veya altyazı çıkarıldığında AI önerilerini sormadan arşive kaydeder."
                    >
                      <Switch
                        checked={aiStatus?.auto_apply_tags ?? false}
                        onCheckedChange={(checked) => void handleToggleAutoApply(checked)}
                      />
                    </SettingRow>

                    <SettingRow
                      label={`AI Yanıt Sıcaklığı (Temperature: ${aiStatus?.temperature ?? 0.7})`}
                      hint="Düşük değerler daha kesin/tutarlı, yüksek değerler daha yaratıcı öneriler ve yanıtlar üretir."
                    >
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
                    </SettingRow>
                  </div>
                </div>

                {/* 6. Arşiv Bakım & Düzenleme Araçları */}
                <div className="flex flex-col gap-3.5 settings-card p-4">
                  <div>
                    <p className="text-sm font-medium">Arşiv Bakım & Düzenleme Araçları</p>
                    <p className="text-xs text-muted-foreground">
                      Arşivdeki kayıtların taksonomisini ve vektör veritabanını toplu olarak yönetin.
                    </p>
                  </div>

                  {/* Satır listesi: aynı sözlük */}
                  <div className="flex flex-col divide-y divide-border/70">
                    <SettingRow
                      label="Öneri Güven Eşiği"
                      hint="Bu eşiğin altındaki otomatik öneriler uygulanmaz; raporda 'atlandı' olarak görünür."
                    >
                      <Select
                        value={String(tagThreshold)}
                        onValueChange={handleThresholdChange}
                        options={THRESHOLD_OPTIONS}
                        label="Öneri güven eşiği"
                        size="sm"
                        className="w-24"
                      />
                    </SettingRow>

                    <SettingRow
                      label="Analiz Edilmemişleri Analiz Et"
                      hint={
                        <>
                          {analysisProgress
                            ? `${analysisProgress.done} / ${analysisProgress.total} analiz ediliyor…`
                            : 'İndirilmiş ama içeriği analiz edilmemiş kayıtları sırayla tarar; transkript, özet, konu ve varsa tarif çıkarır.'}
                          {analysisResult && (
                            <span className="mt-1 block font-medium text-emerald-400">✓ {analysisResult}</span>
                          )}
                        </>
                      }
                    >
                      {analysisBusy ? (
                        <>
                          <Progress
                            value={analysisProgress && analysisProgress.total > 0 ? (analysisProgress.done / analysisProgress.total) * 100 : 0}
                            className="w-28"
                            label="Toplu analiz ilerlemesi"
                          />
                          <Button variant="outline" size="sm" onClick={() => analysisAbortRef.current?.abort()}>
                            İptal
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void runAnalyzeMissing()}
                          disabled={!aiEnabled || !aiStatus?.llm_ready}
                        >
                          Analiz Et
                        </Button>
                      )}
                    </SettingRow>

                    <SettingRow
                      label="Kategorisiz Kayıtları Düzenle"
                      hint={
                        <>
                          {organizeProgress
                            ? `${organizeProgress.current} / ${organizeProgress.total}: ${organizeProgress.title} işleniyor…`
                            : 'Kategorisi veya etiketi olmayan kayıtları Qwen 2.5 ile sırayla tarar ve otomatik düzenler.'}
                          {organizeResult && (
                            <span className="mt-1 block font-medium text-emerald-400">✓ {organizeResult}</span>
                          )}
                        </>
                      }
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void runOrganizeUncategorized()}
                        disabled={organizeBusy || !aiEnabled || !aiStatus?.llm_ready}
                      >
                        {organizeBusy ? 'İşleniyor…' : 'Kategorisizleri Düzenle'}
                      </Button>
                    </SettingRow>

                    <SettingRow
                      label="Defteri Hazırla"
                      hint={
                        <>
                          {defterStep ? defterStep : 'Eksik içerikleri toplar, kategorilendirir, tekrarları bulur. Birleştirme yalnız sizin onayınızla olur.'}
                          {defterMsg && (
                            <span className="mt-1 block font-medium text-emerald-400">✓ {defterMsg}</span>
                          )}
                          {defterError && (
                            <span className="mt-1 block font-medium text-red-400">⚠️ {defterError}</span>
                          )}
                          {defterReport && (defterReport.dedupe?.missingEmbedding ?? 0) > 0 && (
                            <span className="mt-1 block text-muted-foreground">
                              {defterReport.dedupe?.missingEmbedding} kayıt indekslenmemiş — 'Tüm Kayıtları Yeniden İndeksle' işini çalıştırın.
                            </span>
                          )}
                          {defterReport && defterReport.scrapeFailures.length > 0 && (
                            <span className="mt-1 block text-muted-foreground">
                              Başarısızlar: {defterReport.scrapeFailures.map((f) => f.title || f.url).join(' · ')}
                            </span>
                          )}
                        </>
                      }
                    >
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void runNotebook()}
                          disabled={defterBusy}
                        >
                          {defterBusy ? 'Hazırlanıyor…' : 'Defteri Hazırla'}
                        </Button>
                        {defterBusy && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              notebookCancelRef.current = true;
                            }}
                          >
                            İptal
                          </Button>
                        )}
                        {defterReport && defterReport.scrapeFailures.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void retryFailedNotebook()}
                            disabled={defterBusy}
                          >
                            Yeniden dene ({defterReport.scrapeFailures.length})
                          </Button>
                        )}
                      </div>
                    </SettingRow>

                    <SettingRow
                      label="Defter Tekrar Eşiği"
                      hint="Bu benzerliğin üzerindeki kayıtlar tekrar grubu olur; eşik 0,80–0,98 arasında ayarlanır."
                    >
                      <Select
                        value={String(dedupeThreshold)}
                        onValueChange={handleDedupeThresholdChange}
                        options={DEDUPE_THRESHOLD_OPTIONS}
                        label="Defter tekrar eşiği"
                        size="sm"
                        className="w-24"
                      />
                    </SettingRow>

                    {defterGroups.length > 0 && (
                      <div className="flex flex-col gap-2 py-1">
                        <p className="text-xs text-muted-foreground">
                          Tekrar grupları ({defterGroups.length}): hedef kayıt + artıklar. Her grup için karar verin.
                        </p>
                        <ul className="flex flex-col gap-1">
                          {defterGroups.map((g, i) => (
                            <li key={`${g.targetId}-${i}`} className="flex flex-col gap-1 rounded-sm border border-border/50 bg-card/40 p-2">
                              {g.members.length > 2 && !defterDone[i] ? (
                                <div className="flex items-center gap-2">
                                  <span className="shrink-0 text-3xs text-muted-foreground">Hedef kayıt:</span>
                                  <Select
                                    value={defterTargets[i] ?? g.targetId}
                                    onValueChange={(v) => setDefterTargets((p) => ({ ...p, [i]: v }))}
                                    options={g.members.map((m) => ({ value: m.id, label: m.title ?? m.url }))}
                                    label="Birleştirme hedefi"
                                    size="sm"
                                    className="min-w-0 flex-1"
                                  />
                                </div>
                              ) : null}
                              <div className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate">
                                  <span className="font-medium">{g.targetTitle}</span>
                                  <span className="text-muted-foreground"> ← {g.victimTitles.join(', ')}</span>
                                </span>
                                {defterDone[i] ? (
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {defterDone[i] === 'merged' ? 'birleşti' : 'atlandı'}
                                  </span>
                                ) : (
                                  <span className="flex shrink-0 gap-1.5">
                                    <Button variant="outline" size="sm" onClick={() => void mergeNotebookGroup(i)} disabled={defterBusy}>
                                      Birleştir
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setDefterDone((p) => ({ ...p, [i]: 'skipped' }))}
                                      disabled={defterBusy}
                                    >
                                      Atla
                                    </Button>
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-col gap-0.5 text-3xs text-muted-foreground">
                                {g.members.map((m) => (
                                  <span key={m.id} className="truncate">
                                    {m.id === (defterTargets[i] ?? g.targetId) ? '→ ' : '· '}
                                    {m.title || m.url} {m.author ? `(${m.author})` : ''} · {trDateLabel(m.created_at)}
                                  </span>
                                ))}
                              </div>
                            </li>
                          ))}
                        </ul>
                        <Button
                          variant="outline"
                          size="sm"
                          className="self-start"
                          onClick={() => void mergeRemainingNotebook()}
                          disabled={defterBusy}
                        >
                          {defterBusy ? 'Birleştiriliyor…' : 'Kalan Tümünü Birleştir'}
                        </Button>
                      </div>
                    )}

                    <SettingRow
                      label="Tüm Kayıtları Yeniden Kategorize Et"
                      hint={
                        <>
                          {recatProgress
                            ? `${recatProgress.current} / ${recatProgress.total}: ${recatProgress.title} işleniyor…`
                            : 'Her kaydın kategori/etiketi baştan üretilir. Önce otomatik yedek alınır; eşik altı kayıtlarda eski atamalar korunur.'}
                          {recatResult && (
                            <span className="mt-1 block font-medium text-emerald-400">✓ {recatResult}</span>
                          )}
                        </>
                      }
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmRecatOpen(true)}
                        disabled={recatBusy || !aiEnabled || !aiStatus?.llm_ready}
                      >
                        {recatBusy ? 'Yeniden üretiliyor…' : 'Tümünü Yeniden Kategorize Et'}
                      </Button>
                    </SettingRow>

                    <ConfirmDialog
                      open={confirmRecatOpen}
                      onOpenChange={setConfirmRecatOpen}
                      title="Tüm kayıtlar yeniden kategorize edilsin mi?"
                      description="Her kaydın mevcut kategori ve etiketleri, yeni üretilenlerle DEĞİŞTİRİLİR. İşlemden önce otomatik yedek alınır; geri dönmek istersen Yedekleme bölümünü kullanabilirsin."
                      confirmLabel="Yeniden Kategorize Et"
                      onConfirm={() => void runRecategorizeAll()}
                    />

                    <SettingRow
                      label="Anlamsal Arşiv İndeksi"
                      hint={
                        reindexProgress
                          ? `${reindexProgress.current} / ${reindexProgress.total} ${
                              reindexProgress.phase === 'content'
                                ? 'içerik kuruluyor…'
                                : 'vektörleştiriliyor…'
                            }`
                          : 'Not, transkript, makale ve künye parçalarını baştan kurup BGE-M3 ile vektörleştirir.'
                      }
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void runReindex()}
                        disabled={reindexBusy || !aiEnabled || !aiStatus?.embed_ready}
                      >
                        {reindexBusy ? 'İndeksleniyor…' : 'Tümünü Yeniden İndeksle'}
                      </Button>
                    </SettingRow>
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
                <div className="flex items-center justify-between settings-card p-3.5">
                  <div>
                    <p className="text-sm font-medium">Whisper motoru</p>
                    <p className="text-xs text-muted-foreground">Yerel whisper.cpp CLI yürütücüsü{sizeSuffix('whisper', 4)}</p>
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
              <div className="settings-card flex flex-col divide-y divide-border/70 p-4">
                <SettingRow label="Tema" htmlFor="theme-toggle">
                  <ThemeToggle />
                </SettingRow>
                <SettingRow label="Sayfa başına kayıt" htmlFor="set-pagesize">
                  <Select
                    label="Sayfa boyutu"
                    className="w-28"
                    value={String(pageSize)}
                    onValueChange={(v) => onPageSizeChange(Number(v))}
                    options={pageSizes.map((n) => ({ value: String(n), label: `${n} kayıt` }))}
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
              <div className="settings-card flex flex-col divide-y divide-border/70 p-4">
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
                  hint="Kayıttan veya toplu indirmede hedef seçilmediğinde kullanılır."
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
                  label="Eşzamanlı indirme"
                  hint="Aynı anda indirilecek en fazla dosya sayısı. Fazlası kuyrukta bekler ve sırası gelince kendiliğinden başlar."
                >
                  <Select
                    label="Eşzamanlı indirme"
                    className="w-40"
                    value={String(dlSettings.max_concurrent)}
                    onValueChange={(v) => void updateDlSettings({ max_concurrent: Number(v) })}
                    options={CONCURRENCY_OPTIONS}
                  />
                </SettingRow>
                <SettingRow
                  label="Varsayılan kanal sayısı"
                  hint="Dosya kaç parçaya bölünerek indirilir. Sunucu izin verirse kanallar boşa çıktıkça en büyük parça ikiye bölünür (dinamik parçalama)."
                >
                  <Select
                    label="Kanal sayısı"
                    className="w-44"
                    value={String(dlSettings.default_connections)}
                    onValueChange={(v) =>
                      void updateDlSettings({ default_connections: Number(v) })
                    }
                    options={CONNECTION_OPTIONS}
                  />
                </SettingRow>
                <SettingRow
                  label="Toplam hız sınırı"
                  hint="Tüm indirmelerin paylaştığı üst sınır. Yavaş bir bağlantıda arşivi gezerken bant genişliğini serbest bırakmak için kullanılır."
                >
                  <Select
                    label="Hız sınırı"
                    className="w-40"
                    value={String(dlSettings.speed_limit_bps)}
                    onValueChange={(v) => void updateDlSettings({ speed_limit_bps: Number(v) })}
                    options={SPEED_LIMIT_OPTIONS}
                  />
                </SettingRow>
                <SettingRow
                  label="Kategori klasörleri"
                  hint="İndirilen dosya türüne göre alt klasöre ayrılır (Video, Ses, Sıkıştırılmış, Belge, Program, Diğer). Kapalıyken hepsi indirme köküne iner."
                >
                  <Switch
                    checked={dlSettings.category_folders}
                    onCheckedChange={(checked) =>
                      void updateDlSettings({ category_folders: checked })
                    }
                  />
                </SettingRow>
                <SettingRow
                  label="İndirme tamamlanınca"
                  hint="İndirme bittiğinde ne yapılsın. IDM'deki 'start downloading now / open file' davranışının karşılığı."
                >
                  <Select
                    label="Tamamlanınca"
                    className="w-40"
                    value={dlSettings.after_complete}
                    onValueChange={(v) =>
                      void updateDlSettings({
                        after_complete: v as DownloadSettings['after_complete'],
                      })
                    }
                    options={AFTER_COMPLETE_OPTIONS}
                  />
                </SettingRow>
                <SettingRow
                  label="Hata sonrası yeniden deneme"
                  hint="Bağlantı kopması gibi geçici hatalarda indirme kendiliğinden yeniden denenir ve kaldığı yerden sürer. Kalıcı hatalarda (ör. 404) denenmez."
                >
                  <Select
                    label="Yeniden deneme"
                    className="w-40"
                    value={String(dlSettings.retry_count)}
                    onValueChange={(v) => void updateDlSettings({ retry_count: Number(v) })}
                    options={RETRY_OPTIONS}
                  />
                </SettingRow>
                <SettingRow
                  label="Format seçince pencere kapansın"
                  hint="Kapalıyken indirme başladıktan sonra format ekranı açık kalır (Kapat ile kapatırsın, indirme arka planda sürer). Açıkken ekran kendiliğinden kapanır."
                >
                  <Switch
                    checked={dlSettings.close_format_after_pick}
                    onCheckedChange={(checked) =>
                      void updateDlSettings({ close_format_after_pick: checked })
                    }
                  />
                </SettingRow>
                <SettingRow
                  label="Tarayıcıdan indirince pencere öne gelsin"
                  hint="Tarayıcıda başlattığın indirmeyi uygulama devraldığında pencere öne gelir (IDM'in indirme penceresi gibi). Sayfanın kendiliğinden başlattığı indirmelerde de geçerlidir; rahatsız ederse kapat."
                >
                  <Switch
                    checked={dlSettings.raise_on_capture}
                    onCheckedChange={(checked) =>
                      void updateDlSettings({ raise_on_capture: checked })
                    }
                  />
                </SettingRow>
                {dlSettingsError && (
                  <p className="pt-2 text-sm text-destructive">{dlSettingsError}</p>
                )}
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
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 settings-card p-4">
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
                  <p className="text-xs text-muted-foreground">
                    {extension?.lastSeen ? (
                      <>
                        Eklenti bağlı — son temas:{' '}
                        <span data-num>{new Date(extension.lastSeen).toLocaleString('tr-TR')}</span>
                      </>
                    ) : (
                      'Eklenti bu kurulumda henüz bağlanmadı.'
                    )}
                  </p>
                </div>

                {/* Tarayıcı indirmelerini devralma (IDM'in "download takeover"ı). */}
                <div className="flex flex-col gap-2 settings-card p-4">
                  <span className="text-sm font-medium">Tarayıcıdan indirme devralma</span>
                  <p className="text-xs text-muted-foreground">
                    Eklenti kuruluyken tarayıcıda başlatılan indirmeler JointVault'a devredilir: tarayıcının
                    indirmesi iptal edilir ve dosya çok kanallı motorla, kaldığı yerden devam edebilen bir
                    indirmeyle iner. Adresin <span className="font-mono text-micro">Referer</span>'i ve
                    çerezleri de taşınır, böylece oturum gerektiren bağlantılar da çalışır.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Hangi uzantıların devralınacağını ve devralmayı açıp kapatmayı eklentinin kendi
                    penceresinden ayarlarsın. Uygulama kapalıyken devralma olmaz; indirme tarayıcıda iner.
                  </p>
                </div>

                <div className="flex flex-col gap-3 settings-card p-4">
                  <span className="text-sm font-medium">Eklentiyi kur</span>
                  <p className="text-xs text-muted-foreground">
                    X yer işaretleri, Instagram kaydedilenler ve YouTube oynatma listeleri yalnızca eklentiyle
                    içe aktarılır. Kurulum bir kez yapılır.
                  </p>
                  <ol className="list-inside list-decimal space-y-1 text-xs leading-relaxed text-muted-foreground">
                    <li>Eklenti klasörünü aç (aşağıdaki düğme).</li>
                    <li>
                      Chrome'da <span className="font-mono text-foreground">chrome://extensions</span> adresini
                      aç, sağ üstten <span className="text-foreground">Geliştirici modu</span>'nu aç.
                    </li>
                    <li>
                      <span className="text-foreground">Paketlenmemiş öğe yükle</span> → açılan eklenti klasörünü
                      seç.
                    </li>
                    <li>Eklenti penceresine yukarıdaki eşleşme anahtarını yapıştır.</li>
                  </ol>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!extension?.installed}
                      onClick={() => extension && open(extension.dir)}
                    >
                      Eklenti klasörünü aç
                    </Button>
                    {extension && !extension.installed && (
                      <span className="text-xs text-muted-foreground">
                        Bu derlemede eklenti klasörü yok — kurulum paketinden çalıştır.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB: BİLEŞENLER */}
            {tab === 'components' && <ComponentsSection />}

            {/* TAB: YEDEKLEME */}
            {tab === 'backup' && (
              <div className="flex flex-col gap-4">
                <DataBackupSection />
                <div className="flex flex-col gap-4 settings-card p-4">
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

      {/*
       * Açık rıza onayı. Etkinleştirme İNDİRME BAŞLATMAZ (yalnızca `enabled` yazılır);
       * vazgeçilirse hiçbir şey olmaz. Kapatma ise asistan + anlamsal aramanın
       * duracağını dürüstçe söyler — veri kaybı yok, modeller diskte kalır.
       */}
      <ConfirmDialog
        open={aiConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setAiConfirm(null);
        }}
        title={aiConfirm === 'disable' ? 'Yerel AI kapatılsın mı?' : "Yerel AI'yı etkinleştir"}
        description={
          aiConfirm === 'disable' ? (
            'Asistan ve anlamsal arama çalışmayı durdurur. İndirilmiş modeller diskte kalır; dilediğinde yeniden açabilirsin.'
          ) : (
            <>
              Yalnızca özellik açılır; <span className="font-medium text-foreground">hiçbir indirme başlamaz</span>.
              Gerekli bileşenler için toplam indirme {aiTotalLabel}. İndirmeleri Ayarlar → Bileşenler bölümünden sen
              başlatırsın.
            </>
          )
        }
        confirmLabel={aiConfirm === 'disable' ? 'Kapat' : 'Etkinleştir'}
        cancelLabel="Vazgeç"
        tone="default"
        onConfirm={() => {
          const enabled = aiConfirm !== 'disable';
          setAiConfirm(null);
          void runSetAiEnabled(enabled);
        }}
      />
    </div>
  );
}
