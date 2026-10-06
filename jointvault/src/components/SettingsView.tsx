import { useEffect, useRef, useState } from 'react';
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
import type { ComponentStatus } from '@/lib/components';

export type SettingsTab = 'view' | 'downloads' | 'speech' | 'ai' | 'diagnostics' | 'extension' | 'backup' | 'components';

const THRESHOLD_OPTIONS: SelectOption[] = ['0.3', '0.5', '0.6', '0.7', '0.8'].map((v) => ({
  value: v,
  label: v,
}));

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
const AI_COMPONENT_ITEMS: readonly { id: string; role: string }[] = [
  { id: 'llama-engine', role: 'AI motoru (llama-server)' },
  { id: 'llama-cudart', role: 'CUDA çalışma zamanı (GPU hızlandırma)' },
  { id: 'ai-model-llm', role: 'Qwen 2.5 14B sohbet modeli' },
  { id: 'ai-model-embed', role: 'BGE-M3 anlamsal gömme modeli' },
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
  /*
   * Bileşen kayıt boyutları (id → approx_mb). Boyut ETİKETLERİ buradan türetilir:
   * aynı modelin iki ekranda iki farklı sayı göstermesi (ör. BGE ~1.5 GB vs
   * gerçek ~605 MB) "iki gerçek" üretirdi. Kayıttan okunamazsa harf/sayı
   * uydurulmaz; ilgili etiket yedek pin değerine düşer.
   */
  const [componentSizes, setComponentSizes] = useState<Record<string, number | undefined>>({});

  // Yerel AI (Qwen 2.5 14B + BGE-M3 + llama-server)
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiEngineJob, setAiEngineJob] = useState<string | null>(null);
  const [aiModelJob, setAiModelJob] = useState<string | null>(null);
  const [aiModelType, setAiModelType] = useState<'llm' | 'embed' | null>(null);
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
    // Boyut etiketleri kayıttan gelir (tek gerçek); okunamazsa yedek pin değerleri.
    void invoke<ComponentStatus[]>('components_status')
      .then((rows) => {
        const sizes: Record<string, number> = {};
        for (const row of rows) sizes[row.id] = row.approx_mb;
        setComponentSizes(sizes);
      })
      .catch(() => setComponentSizes({}));
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
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{ done: number; total: number } | null>(null);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const [tagThreshold, setTagThreshold] = useState(() => readTagThreshold());

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
    { id: 'ai', label: 'Yapay Zekâ', icon: <Sparkles className="size-4" />, desc: 'Qwen 2.5 14B, BGE-M3, VRAM yönetimi, taksonomi ve indeksleme' },
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

  // Yerel AI görünümü: etkinlik kararı TEK yerden (`isAiEnabled`, fail-closed).
  const aiEnabled = isAiEnabled(aiStatus);
  const aiGpu = aiStatus?.gpu;
  const aiOffload = aiStatus?.offload;

  /*
   * Rıza metninin toplamı KAYITTAN toplanır. Eksik boyut varsa toplam GÖSTERİLMEZ:
   * yarım toplamı "küçük bir indirme" gibi göstermek yanlış olurdu (uydurma sayı).
   */
  const aiComponentRows = AI_COMPONENT_ITEMS.map((item) => ({ ...item, mb: componentSizes[item.id] }));
  const aiSizesComplete = aiComponentRows.every((row) => row.mb !== undefined);
  const aiTotalLabel = aiSizesComplete
    ? `≈ ${formatMb(aiComponentRows.reduce((sum, row) => sum + (row.mb ?? 0), 0))}`
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
                            <span className="text-muted-foreground">{row.role}</span>
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

                {/* 2. LLM Modeli */}
                <div className="flex flex-col gap-2 settings-card p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium">Qwen 2.5 14B-Instruct</span>
                      <p className="text-xs text-muted-foreground">Ana Akıl & Sohbet Modeli (GGUF Q4_K_M){sizeSuffix('ai-model-llm')}</p>
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
