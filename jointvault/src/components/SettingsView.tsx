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
import {
  applyMerges,
  makeNotebookDeps,
  readNotebookThreshold,
  runNotebookPipeline,
  writeNotebookThreshold,
  type DupeGroup,
  type NotebookReport,
} from '@/lib/notebook-pipeline';
import type { ComponentStatus } from '@/lib/components';

export type SettingsTab = 'view' | 'downloads' | 'speech' | 'ai' | 'diagnostics' | 'extension' | 'backup' | 'components';

const THRESHOLD_OPTIONS: SelectOption[] = ['0.3', '0.5', '0.6', '0.7', '0.8'].map((v) => ({
  value: v,
  label: v.replace('.', ','),
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
  { value: 'tray', label: 'Ã‡ekmeceye kÃ¼Ã§Ã¼lt (arka planda Ã§alÄ±ÅŸ)' },
  { value: 'quit', label: 'Tamamen kapat' },
];

const IDLE_OPTIONS: SelectOption[] = [
  { value: '0', label: 'Daima HazÄ±r (Asla Uyutma - 0s)' },
  { value: '300', label: '5 Dakika' },
  { value: '600', label: '10 Dakika (VarsayÄ±lan)' },
  { value: '1800', label: '30 Dakika' },
  { value: '3600', label: '1 Saat' },
];

// --- Yerel AI: donanÄ±m/offload gÃ¶rÃ¼nÃ¼mÃ¼ ve rÄ±za metni -------------------------
//
// Buradaki hiÃ§bir sayÄ± ELLE yazÄ±lmaz: boyutlar `components_status.approx_mb`'den,
// donanÄ±m `ai_status.gpu`'dan, karar/gerekÃ§e `ai_status.offload`'dan gelir. Eskiden
// sabit yazÄ±lan GPU adÄ±/VRAM iddialarÄ± bilinÃ§li olarak kaldÄ±rÄ±ldÄ±; yanlÄ±ÅŸ donanÄ±m
// adÄ± gÃ¶stermek, hiÃ§ gÃ¶stermemekten kÃ¶tÃ¼dÃ¼r.

const MB_PER_GB = 1024;

/** MiB â†’ okunur birim. 1024'Ã¼n altÄ± MB kalÄ±r; uydurma yuvarlama yok. */
function formatMb(mb: number): string {
  return mb >= MB_PER_GB ? `${(mb / MB_PER_GB).toFixed(1)} GB` : `${mb} MB`;
}

/*
 * DonanÄ±m satÄ±rÄ±: YALNIZCA tespit edileni sÃ¶yler.
 *   - nvidia-smi â†’ ad + gerÃ§ek VRAM
 *   - WMI â†’ yalnÄ±zca ad; VRAM okunamadÄ± (WMI'nin AdapterRAM'i 4 GB Ã¼stÃ¼nde taÅŸar,
 *     bu yÃ¼zden backend oradan VRAM vermez)
 *   - hiÃ§biri â†’ "bilinmiyor"
 * HiÃ§bir dalda uydurma sayÄ± yoktur.
 */
function gpuHardwareLine(gpu: AiGpuInfo | undefined): string {
  if (!gpu || (gpu.name === null && gpu.vram_mb === null)) {
    return 'GPU bilinmiyor â€” nvidia-smi ve WMI sonuÃ§ vermedi.';
  }
  if (gpu.name !== null && gpu.vram_mb !== null) {
    return `${gpu.name} Â· ${formatMb(gpu.vram_mb)} VRAM (kaynak: ${gpu.source})`;
  }
  if (gpu.name !== null) {
    return `${gpu.name} Â· VRAM okunamadÄ± (WMI yalnÄ±zca ad verir).`;
  }
  if (gpu.vram_mb !== null) {
    return `GPU adÄ± okunamadÄ± Â· ${formatMb(gpu.vram_mb)} VRAM (kaynak: ${gpu.source})`;
  }
  return 'GPU bilinmiyor â€” nvidia-smi ve WMI sonuÃ§ vermedi.';
}

/*
 * "Yerel AI neye ihtiyaÃ§ duyar" listesi: yalnÄ±zca KAYIT KÄ°MLÄ°KLERÄ° ve kullanÄ±cÄ±ya
 * dÃ¶nÃ¼k rol metni. Boyut burada YOK â€” her satÄ±rÄ±n MB'Ä± `components_status`'tan
 * okunur ki BileÅŸenler ekranÄ±yla iki farklÄ± sayÄ± gÃ¶sterilmesin (tek gerÃ§ek).
 */
const AI_COMPONENT_ITEMS: readonly { id: string; role: string }[] = [
  { id: 'llama-engine', role: 'AI motoru (llama-server)' },
  { id: 'llama-cudart', role: 'CUDA Ã§alÄ±ÅŸma zamanÄ± (GPU hÄ±zlandÄ±rma)' },
  { id: 'ai-model-llm', role: 'Qwen 2.5 14B sohbet modeli' },
  { id: 'ai-model-embed', role: 'BGE-M3 anlamsal gÃ¶mme modeli' },
];

export function SettingsView(props: SettingsViewProps) {
  const { pageSize, pageSizes, onPageSizeChange, onReplayTour, onClose, initialTab = 'ai' } = props;
  const { reveal } = useOpenTarget();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [closeMode, setCloseMode] = useState('tray');
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [watch, setWatch] = useState(() => isWatchEnabled());
  // Ä°ndirme klasÃ¶rÃ¼
  const [dir, setDir] = useState('');
  const [dirBusy, setDirBusy] = useState(false);
  const [dirError, setDirError] = useState<string | null>(null);
  const [quality, setQuality] = useState<DownloadQuality>(() => getDefaultQuality());
  // EÅŸleÅŸme anahtarÄ±
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [confirmRegenOpen, setConfirmRegenOpen] = useState(false);
  // KonuÅŸma (whisper): model seÃ§imi + lazy indirme
  const [whisperModel, setWhisperModelState] = useState<WhisperModel>(() => getWhisperModel());
  const [whisperStatus, setWhisperStatus] = useState<WhisperStatus | null>(null);
  const [dlModel, setDlModel] = useState<WhisperModel | null>(null);
  const [dlPercent, setDlPercent] = useState(0);
  const [dlError, setDlError] = useState<string | null>(null);
  // KonuÅŸma motoru (whisper.cpp CLI, ~4MB, bir kez)
  const [engDl, setEngDl] = useState(false);
  const [engPercent, setEngPercent] = useState(0);
  const [engError, setEngError] = useState<string | null>(null);
  /*
   * BileÅŸen kayÄ±t boyutlarÄ± (id â†’ approx_mb). Boyut ETÄ°KETLERÄ° buradan tÃ¼retilir:
   * aynÄ± modelin iki ekranda iki farklÄ± sayÄ± gÃ¶stermesi (Ã¶r. BGE ~1.5 GB vs
   * gerÃ§ek ~605 MB) "iki gerÃ§ek" Ã¼retirdi. KayÄ±ttan okunamazsa harf/sayÄ±
   * uydurulmaz; ilgili etiket yedek pin deÄŸerine dÃ¼ÅŸer.
   */
  const [componentSizes, setComponentSizes] = useState<Record<string, number | undefined>>({});

  // Yerel AI (Qwen 2.5 14B + BGE-M3 + llama-server)
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiEngineJob, setAiEngineJob] = useState<string | null>(null);
  const [aiModelJob, setAiModelJob] = useState<string | null>(null);
  const [aiModelType, setAiModelType] = useState<'llm' | 'embed' | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  // Ana anahtar (`enabled`) yazÄ±mÄ± ve aÃ§Ä±k rÄ±za onayÄ±: indirme DEÄÄ°L, tercih.
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
    // Boyut etiketleri kayÄ±ttan gelir (tek gerÃ§ek); okunamazsa yedek pin deÄŸerleri.
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
        title: type === 'llm' ? 'Qwen 2.5 14B Model DosyasÄ± (.gguf)' : 'BGE-M3 VektÃ¶r Modeli (.gguf)',
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
        title: 'llama-server.exe DosyasÄ±',
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
  // Defteri HazÄ±rla: adÄ±m gÃ¶stergesi + rapor + tekrar gruplarÄ±
  const [defterBusy, setDefterBusy] = useState(false);
  const [defterStep, setDefterStep] = useState<string | null>(null);
  const [defterReport, setDefterReport] = useState<NotebookReport | null>(null);
  const [defterGroups, setDefterGroups] = useState<DupeGroup[]>([]);
  const [defterDone, setDefterDone] = useState<Record<number, 'merged' | 'skipped'>>({});
  const [defterMsg, setDefterMsg] = useState<string | null>(null);
  const [defterError, setDefterError] = useState<string | null>(null);
  const [dedupeThreshold, setDedupeThreshold] = useState(() => readNotebookThreshold());

  // SÄ±radaki Ã¶ÄŸe sÄ±nÄ±rÄ±nda durur; gÃ¶rÃ¼nÃ¼m kapanÄ±rsa iÅŸ kalmasÄ±n.
  useEffect(() => () => analysisAbortRef.current?.abort(), []);

  const handleThresholdChange = (v: string): void => {
    setTagThreshold(Number(v));
    try {
      localStorage.setItem(TAG_THRESHOLD_KEY, v);
    } catch {
      // localStorage eriÅŸilemezse sessizce geÃ§
    }
  };

  /* Defteri HazÄ±rla */
  const describeNotebookReport = (r: NotebookReport): string[] => {
    const out: string[] = [];
    out.push(
      r.scrapeFailed > 0
        ? `AdÄ±m 1: ${r.scraped} tamamlandÄ±, ${r.scrapeFailed} baÅŸarÄ±sÄ±z`
        : `AdÄ±m 1: ${r.scraped} tamamlandÄ±`,
    );
    const cat = r.categorize;
    out.push(!cat ? 'AdÄ±m 2: Ã¶ÄŸe yok' : 'aiOff' in cat ? 'AdÄ±m 2: AI kapalÄ±, atlandÄ±' : `AdÄ±m 2: ${cat.applied} uygulandÄ±, ${cat.lowConfidence} dÃ¼ÅŸÃ¼k gÃ¼ven, ${cat.failed} baÅŸarÄ±sÄ±z`);
    const dd = r.dedupe;
    if (!dd) out.push('AdÄ±m 3: taranacak Ã¶ÄŸe yok');
    else if (dd.aiOff) out.push('AdÄ±m 3: AI kapalÄ±, atlandÄ±');
    else out.push(`AdÄ±m 3: ${dd.groups.length} tekrar grubu`);
    return out;
  };
  const runNotebook = async (): Promise<void> => {
    setDefterBusy(true);
    setDefterError(null);
    setDefterMsg(null);
    setDefterGroups([]);
    setDefterDone({});
    try {
      const report = await runNotebookPipeline(makeNotebookDeps(), (stage, done, total, label) =>
        setDefterStep(`AdÄ±m ${stage}/3 Â· ${label}: ${done}/${total}`),
      );
      setDefterReport(report);
      setDefterGroups(report.dedupe?.groups ?? []);
      setDefterMsg(describeNotebookReport(report).join(' Â· '));
    } catch (e) {
      setDefterError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Boru hattÄ± baÅŸarÄ±sÄ±z.');
    } finally {
      setDefterBusy(false);
      setDefterStep(null);
    }
  };
  const mergeNotebookGroup = async (index: number): Promise<void> => {
    const group = defterGroups[index];
    if (!group) return;
    setDefterBusy(true);
    try {
      const res = await applyMerges([group], makeNotebookDeps());
      setDefterDone((p) => ({ ...p, [index]: res.failedGroups.length === 0 ? 'merged' : 'skipped' }));
      if (res.failedGroups.length > 0) setDefterError(res.failedGroups[0].error);
    } finally {
      setDefterBusy(false);
    }
  };
  const mergeRemainingNotebook = async (): Promise<void> => {
    const pending = defterGroups.filter((_, i) => !defterDone[i]);
    if (pending.length === 0) return;
    setDefterBusy(true);
    try {
      const res = await applyMerges(pending, makeNotebookDeps());
      setDefterError(res.failedGroups.length > 0 ? `${res.failedGroups.length} grup baÅŸarÄ±sÄ±z` : null);
      setDefterDone((p) => {
        const next = { ...p };
        for (let i = 0; i < defterGroups.length; i++) if (!next[i]) next[i] = 'merged';
        for (const fg of res.failedGroups) {
          const idx = defterGroups.findIndex((g) => g.targetId === fg.targetId);
          if (idx >= 0) next[idx] = 'skipped';
        }
        return next;
      });
      setDefterMsg(`BirleÅŸtirme: ${res.merged} kayÄ±t birleÅŸti, artÄ±klar silindi.`);
    } finally {
      setDefterBusy(false);
    }
  };
  const retryFailedNotebook = async (): Promise<void> => {
    if (!defterReport || defterReport.scrapeFailures.length === 0) return;
    setDefterBusy(true);
    try {
      const res = await makeNotebookDeps().scrape(defterReport.scrapeFailures, (done, total) =>
        setDefterStep(`Yeniden kazÄ±ma: ${done}/${total}`),
      );
      setDefterReport({
        ...defterReport,
        scraped: defterReport.scraped + res.successCount,
        scrapeFailed: res.errorCount,
        scrapeFailures: res.failed,
      });
      setDefterMsg(res.failed.length === 0 ? 'BaÅŸarÄ±sÄ±zlar tamamlandÄ±.' : `HÃ¢lÃ¢ baÅŸarÄ±sÄ±z: ${res.failed.length}`);
    } catch (e) {
      setDefterError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Yeniden deneme baÅŸarÄ±sÄ±z.');
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
      // Yedek ZORUNLU: alÄ±namazsa iÅŸlem baÅŸlamaz.
      await createBackup(await getDb());
      const allItems = await listItems();
      const res = await batchCategorizeItems(allItems, {
        forceAutoApply: true,
        replaceExisting: true,
        onProgress: (current, total, title) => setRecatProgress({ current, total, title }),
      });
      setRecatResult(
        `${res.applied} kayÄ±t yeniden Ã¼retildi` +
          `${res.failed > 0 ? ` Â· ${res.failed} baÅŸarÄ±sÄ±z` : ''}. ` +
          'EÅŸik altÄ± kalan kayÄ±tlarda eski atamalar korundu.',
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
      /* N+1 YOK: Ã¶ÄŸe baÅŸÄ±na 2 sorgu yerine toplam 2 sorgu. Ã–lÃ§ek farkÄ± burada
         bÃ¼yÃ¼k â€” 2000 kayÄ±tlÄ±k arÅŸivde 4000 Ã§aÄŸrÄ± yerine 2. */
      const [tagsByItem, catsByItem] = await Promise.all([getAllTagsByItem(), getAllCategoriesByItem()]);
      const targetItems = allItems.filter(
        (item) => (catsByItem[item.id]?.length ?? 0) === 0 || (tagsByItem[item.id]?.length ?? 0) === 0,
      );

      if (targetItems.length === 0) {
        setOrganizeResult('Kategorisiz veya etiketsiz kayÄ±t bulunamadÄ± (tÃ¼mÃ¼ dÃ¼zenli).');
        return;
      }

      const res = await batchCategorizeItems(targetItems, {
        forceAutoApply: true,
        onProgress: (current, total, title) => {
          setOrganizeProgress({ current, total, title });
        },
      });

      setOrganizeResult(
        `${res.applied} uygulandÄ± Â· ${res.lowConfidence} dÃ¼ÅŸÃ¼k gÃ¼venle atlandÄ± Â· ` +
          `${res.deterministic} LLM'siz eÅŸleÅŸti` +
          `${res.failed > 0 ? ` Â· ${res.failed} baÅŸarÄ±sÄ±z` : ''}` +
          `${res.skipped > 0 ? ` Â· ${res.skipped} Ã¶neri (uygulama kapalÄ±)` : ''}.`,
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
      if (res.skipped > 0) parts.push(`${res.skipped} atlandÄ±`);
      if (res.failed > 0) parts.push(`${res.failed} baÅŸarÄ±sÄ±z`);
      setAnalysisResult(`${controller.signal.aborted ? 'Ä°ptal edildi Â· ' : ''}${parts.join(' Â· ')}`);
      // ArÅŸiv gÃ¶rÃ¼nÃ¼mÃ¼ indeks tazelenince yeniden yÃ¼klenir.
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
   * `enabled` ANA anahtardÄ±r: yalnÄ±zca Ã¶zelliÄŸi aÃ§ar/kapatÄ±r. Ä°NDÄ°RME BAÅLATMAZ ve
   * sÃ¼reÃ§ Ã§alÄ±ÅŸtÄ±rmaz (Rust `ai_save_config` yalnÄ±zca yapÄ±landÄ±rmayÄ± yazar).
   * `auto_warmup` bu karara GÄ°RMEZ; o ayrÄ± bir Ã¶n yÃ¼kleme tercihidir.
   */
  const runSetAiEnabled = async (enabled: boolean): Promise<void> => {
    setAiError(null);
    setAiConfigBusy(true);
    try {
      // YalnÄ±zca ana anahtar yazÄ±lÄ±r; `ai_save_config` indirme/sÃ¼reÃ§ baÅŸlatmaz.
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
    { id: 'ai', label: 'Yapay ZekÃ¢', icon: <Sparkles className="size-4" />, desc: 'Qwen 2.5 14B, BGE-M3, VRAM yÃ¶netimi, taksonomi ve indeksleme' },
    { id: 'speech', label: 'KonuÅŸma (Whisper)', icon: <Mic className="size-4" />, desc: 'Whisper.cpp yerel konuÅŸma tanÄ±ma motoru ve modelleri' },
    { id: 'view', label: 'GÃ¶rÃ¼nÃ¼m', icon: <Eye className="size-4" />, desc: 'ArayÃ¼z temasÄ±, sayfalama ve pano izleme tercihleri' },
    { id: 'downloads', label: 'Ä°ndirme', icon: <Download className="size-4" />, desc: 'Medya indirme klasÃ¶rÃ¼, varsayÄ±lan kalite ve sistem Ã§ekmecesi' },
    { id: 'components', label: 'BileÅŸenler', icon: <PackageCheck className="size-4" />, desc: 'ffmpeg, ffprobe, yt-dlp ve whisper motorunun kurulum durumu' },
    { id: 'diagnostics', label: 'TanÄ±lama', icon: <Activity className="size-4" />, desc: 'Sistem donanÄ±mÄ±, CUDA, ffmpeg ve yt-dlp saÄŸlÄ±k kontrolleri' },
    { id: 'extension', label: 'Eklenti', icon: <Plug className="size-4" />, desc: 'TarayÄ±cÄ± uzantÄ±sÄ± ile gÃ¼venli baÄŸlantÄ± eÅŸleÅŸme anahtarÄ±' },
    { id: 'backup', label: 'Yedekleme', icon: <Database className="size-4" />, desc: 'ArÅŸiv veritabanÄ±nÄ± JSON olarak dÄ±ÅŸa aktar veya geri yÃ¼kle' },
  ];

  const currentTab = tabs.find((t) => t.id === tab) ?? tabs[0];

  const doExport = async (): Promise<void> => {
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const data = await exportVault();
      /*
       * Yol RENDERER'DAN GEÃ‡MEZ: dosya seÃ§imini Rust yapar (`export_backup`).
       * BÃ¶ylece "kullanÄ±cÄ± seÃ§ti" iddiasÄ± doÄŸrulanabilir kalÄ±r â€” renderer istediÄŸi
       * yolu gÃ¶nderemez. (Eskiden `write_text_file` + burada seÃ§ilen yol vardÄ±.)
       */
      const written = await invoke<string | null>('export_backup', {
        content: JSON.stringify(data),
        suggestedName: `jointvault-backup-${new Date().toISOString().slice(0, 10)}.json`,
        filterName: 'JSON',
        extensions: ['json'],
      });
      if (!written) return;
      const count = Object.values(data.tables).reduce((n, rows) => n + rows.length, 0);
      setBackupMsg(`${count} satÄ±r yedeklendi.`);
    } catch (e) {
      setBackupMsg(typeof e === 'string' ? e : e instanceof Error ? e.message : 'DÄ±ÅŸa aktarma baÅŸarÄ±sÄ±z.');
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
      setBackupMsg(`${added} yeni satÄ±r iÃ§e aktarÄ±ldÄ± (tekrarlar atlandÄ±).`);
    } catch (e) {
      setBackupMsg(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Ä°Ã§e aktarma baÅŸarÄ±sÄ±z.');
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
   * KayÄ±ttan (`components_status.approx_mb`) okunan dÃ¼rÃ¼st boyut etiketi.
   * Bilinmiyorsa BOÅ string: uydurma sayÄ± yazmak yerine etiket gizlenir.
   * `fallbackMb` yalnÄ±zca kayÄ±t henÃ¼z okunamadÄ±ysa kullanÄ±lÄ±r ve kayÄ±ttaki
   * pinle aynÄ± tutulur (bkz. `whisper.ts WHISPER_MODELS`).
   */
  const sizeSuffix = (id: string, fallbackMb?: number): string => {
    const mb = componentSizes[id] ?? fallbackMb;
    return mb === undefined ? '' : ` (~${mb} MB)`;
  };

  // Yerel AI gÃ¶rÃ¼nÃ¼mÃ¼: etkinlik kararÄ± TEK yerden (`isAiEnabled`, fail-closed).
  const aiEnabled = isAiEnabled(aiStatus);
  const aiGpu = aiStatus?.gpu;
  const aiOffload = aiStatus?.offload;

  /*
   * RÄ±za metninin toplamÄ± KAYITTAN toplanÄ±r. Eksik boyut varsa toplam GÃ–STERÄ°LMEZ:
   * yarÄ±m toplamÄ± "kÃ¼Ã§Ã¼k bir indirme" gibi gÃ¶stermek yanlÄ±ÅŸ olurdu (uydurma sayÄ±).
   */
  const aiComponentRows = AI_COMPONENT_ITEMS.map((item) => ({ ...item, mb: componentSizes[item.id] }));
  const aiSizesComplete = aiComponentRows.every((row) => row.mb !== undefined);
  const aiTotalLabel = aiSizesComplete
    ? `â‰ˆ ${formatMb(aiComponentRows.reduce((sum, row) => sum + (row.mb ?? 0), 0))}`
    : 'boyut bilgisi yÃ¼kleniyorâ€¦';

  const aiServerRunning = aiStatus?.chat_server_running === true || aiStatus?.embed_server_running === true;
  const offloadTarget = aiOffload?.mode === 'gpu' ? "VRAM'e (GPU)" : 'belleÄŸe (CPU)';
  const aiStatusLine =
    warmupStatus.status === 'loading'
      ? `ğŸŸ¡ Modeller ${offloadTarget} yÃ¼kleniyor (Ä±sÄ±tÄ±lÄ±yor)â€¦`
      : aiServerRunning
        ? aiOffload?.mode === 'gpu'
          ? `ğŸŸ¢ Ã‡alÄ±ÅŸÄ±yor â€” tÃ¼m katmanlar GPU'da (${aiOffload.n_gpu_layers} katman)`
          : "ğŸŸ¢ Ã‡alÄ±ÅŸÄ±yor â€” CPU'da (VRAM kullanÄ±lmÄ±yor)"
        : 'âšª Uyku Modunda â€” sunucu kapalÄ±';

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Ãœst Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Settings className="size-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">Ayarlar</h1>
            <p className="text-2xs text-muted-foreground">
              Sistem tercihleri, modeller, donanÄ±m hÄ±zlandÄ±rma ve arÅŸiv yÃ¶netimi
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
            <ArrowLeft className="size-3.5" /> ArÅŸive DÃ¶n
          </Button>
        )}
      </header>

      {/* Ana GÃ¶vde: 2 SÃ¼tunlu Sayfa DÃ¼zeni */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sol Sekme MenÃ¼sÃ¼ (Desktop) */}
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

        {/* SaÄŸ Ä°Ã§erik AlanÄ±: RahatÃ§a AÅŸaÄŸÄ± Kayan DoÄŸal Sayfa */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-8">
          {/* Mobil Yatay Sekme MenÃ¼sÃ¼ */}
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

            {/* TAB: YAPAY ZEKÃ‚ */}
            {tab === 'ai' && (
              <div className="flex flex-col gap-4">
                {/* 0. AÃ§Ä±k rÄ±za: Yerel AI'yÄ± etkinleÅŸtir / kapat */}
                <div className="flex flex-col gap-3 settings-card p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Yerel AI</p>
                      <p className="text-xs text-muted-foreground">
                        {aiEnabled
                          ? 'Etkin. Asistan ve anlamsal arama kullanÄ±labilir.'
                          : 'KapalÄ±. Asistan ve anlamsal arama bu anahtar aÃ§Ä±lmadan Ã§alÄ±ÅŸmaz.'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {aiEnabled ? <Stamp state="local">etkin</Stamp> : <Stamp state="none">kapalÄ±</Stamp>}
                      <Button
                        variant={aiEnabled ? 'outline' : 'default'}
                        size="sm"
                        disabled={aiConfigBusy}
                        onClick={() => setAiConfirm(aiEnabled ? 'disable' : 'enable')}
                      >
                        {aiConfigBusy ? 'Kaydediliyorâ€¦' : aiEnabled ? "Yerel AI'yÄ± kapat" : "Yerel AI'yÄ± etkinleÅŸtir"}
                      </Button>
                    </div>
                  </div>

                  {/* RÄ±za metni: kullanÄ±cÄ± ONAYLAMADAN Ã¶nce ne indirileceÄŸini ve toplamÄ± gÃ¶rÃ¼r. */}
                  {!aiEnabled && (
                    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-background/40 p-3">
                      <p className="text-xs text-muted-foreground">
                        EtkinleÅŸtirmek <span className="font-medium text-foreground">hiÃ§bir ÅŸey indirmez</span>; yalnÄ±zca
                        Ã¶zelliÄŸi aÃ§ar. Gerekli dosyalar inene kadar asistan yanÄ±t veremez. Ä°ndirmeyi sen baÅŸlatÄ±rsÄ±n
                        (aÅŸaÄŸÄ±daki dÃ¼ÄŸmeler veya Ayarlar â†’ BileÅŸenler); kurulu bileÅŸenler yeniden indirilmez.
                      </p>
                      <ul className="flex flex-col gap-1">
                        {aiComponentRows.map((row) => (
                          <li key={row.id} className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">{row.role}</span>
                            <span className="font-mono text-2xs text-foreground">
                              {row.mb !== undefined ? formatMb(row.mb) : 'boyut okunamadÄ±'}
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

                {/* DonanÄ±m tespiti + offload kararÄ±: sabit metin YOK, tespit ne ise o yazÄ±lÄ±r. */}
                <div className="flex items-start justify-between gap-3 settings-card p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Yerel DonanÄ±m HÄ±zlandÄ±rma</p>
                    <p className="text-xs text-muted-foreground">{gpuHardwareLine(aiGpu)}</p>
                    <p className="text-xs text-muted-foreground">
                      Offload kararÄ±: {aiOffload?.reason ?? 'okunamadÄ± (tespit yok).'}
                    </p>
                  </div>
                  <Stamp state={aiOffload?.mode === 'gpu' ? 'local' : 'none'}>
                    {aiOffload
                      ? aiOffload.mode === 'gpu'
                        ? `GPU Â· ${aiOffload.n_gpu_layers} katman`
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
                          {aiEngineJob ? (aiEnginePct !== null && aiEnginePct >= 0 ? `%${Math.round(aiEnginePct)}` : 'â€¦') : 'Ä°ndir'}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => void pickAiEngineFile()}>
                        SeÃ§ (.exe)
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
                      <p className="text-xs text-muted-foreground">Ana AkÄ±l & Sohbet Modeli (GGUF Q4_K_M){sizeSuffix('ai-model-llm')}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {aiStatus?.llm_ready ? (
                        <Stamp state="local">hazÄ±r</Stamp>
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
                            ? (aiModelPct !== null && aiModelPct >= 0 ? `%${Math.round(aiModelPct)}` : 'â€¦')
                            : 'HF Ä°ndir'}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => void pickAiModelFile('llm')}>
                        Diskten SeÃ§ (.gguf)
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
                      <span className="text-sm font-medium">BGE-M3 VektÃ¶r Modeli</span>
                      <p className="text-xs text-muted-foreground">TÃ¼rkÃ§e & Ã‡ok Dilli Anlamsal Ä°ndeksleme{sizeSuffix('ai-model-embed')}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {aiStatus?.embed_ready ? (
                        <Stamp state="local">hazÄ±r</Stamp>
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
                            ? (aiModelPct !== null && aiModelPct >= 0 ? `%${Math.round(aiModelPct)}` : 'â€¦')
                            : 'HF Ä°ndir'}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => void pickAiModelFile('embed')}>
                        Diskten SeÃ§ (.gguf)
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
                      <p className="text-sm font-medium">Ã‡alÄ±ÅŸma Durumu & HÄ±zlandÄ±rma</p>
                      <p className="text-xs text-muted-foreground">{aiStatusLine}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Chat: {aiStatus?.chat_server_running ? 'ğŸŸ¢' : 'âšª'} | Embed: {aiStatus?.embed_server_running ? 'ğŸŸ¢' : 'âšª'}
                      </span>
                      {aiServerRunning ? (
                        <Button variant="outline" size="sm" onClick={() => void runStopAi()}>
                          {aiOffload?.mode === 'gpu' ? "VRAM'i BoÅŸalt" : 'Sunucuyu Durdur'}
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
                              ? 'YÃ¼kleniyorâ€¦'
                              : aiOffload?.mode === 'gpu'
                                ? "VRAM'e YÃ¼kle (IsÄ±t)"
                                : 'BelleÄŸe YÃ¼kle (IsÄ±t)'}
                          </Button>
                        )
                      )}
                    </div>
                  </div>

                  {/* AÃ§Ä±lÄ±ÅŸta Otomatik IsÄ±tma / Warmup + BoÅŸta Kalma: tek satÄ±r listesi */}
                  <div className="flex flex-col divide-y divide-border/70">
                    <SettingRow
                      label="AÃ§Ä±lÄ±ÅŸta Otomatik BaÅŸlat (Warmup)"
                      hint={`Yerel AI aÃ§Ä±kken uygulama baÅŸlarken modelleri arka planda ${offloadTarget} yÃ¼kler; ilk sorunuz anÄ±nda yanÄ±tlanÄ±r. Bu AYRI bir Ã¶n yÃ¼kleme tercihidir â€” kapatmak Yerel AI'yÄ± kapatmaz.`}
                    >
                      <Switch
                        checked={aiStatus?.auto_warmup ?? true}
                        onCheckedChange={(checked) => void handleToggleAutoWarmup(checked)}
                      />
                    </SettingRow>

                    <SettingRow
                      label="BoÅŸta Kalma SÃ¼resi (Uyku Modu)"
                      hint={`Belirtilen sÃ¼re iÅŸlem yapÄ±lmazsa ${aiOffload?.mode === 'gpu' ? 'VRAM' : 'model belleÄŸi'} otomatik boÅŸaltÄ±lÄ±r.`}
                    >
                      <div className="w-56">
                        <Select
                          label="BoÅŸta Kalma SÃ¼resi"
                          size="sm"
                          options={IDLE_OPTIONS}
                          value={String(aiStatus?.idle_timeout_secs ?? 600)}
                          onValueChange={(val) => void handleChangeIdleTimeout(Number(val))}
                        />
                      </div>
                    </SettingRow>
                  </div>
                </div>

                {/* 5. AkÄ±llÄ± Taksonomi & Otomasyon */}
                <div className="flex flex-col gap-3.5 settings-card p-4">
                  <div>
                    <p className="text-sm font-medium">AkÄ±llÄ± Taksonomi & Otomasyon</p>
                    <p className="text-xs text-muted-foreground">
                      Qwen 2.5'in iÃ§erikleri sÄ±nÄ±flandÄ±rma ve etiketleme davranÄ±ÅŸlarÄ±nÄ± yapÄ±landÄ±rÄ±n.
                    </p>
                  </div>

                  {/* SatÄ±r listesi: tek sÃ¶zlÃ¼k */}
                  <div className="flex flex-col divide-y divide-border/70">
                    <SettingRow
                      label="Ã–nerileri Otomatik Uygula"
                      hint="Yeni kayÄ±t eklendiÄŸinde veya altyazÄ± Ã§Ä±karÄ±ldÄ±ÄŸÄ±nda AI Ã¶nerilerini sormadan arÅŸive kaydeder."
                    >
                      <Switch
                        checked={aiStatus?.auto_apply_tags ?? false}
                        onCheckedChange={(checked) => void handleToggleAutoApply(checked)}
                      />
                    </SettingRow>

                    <SettingRow
                      label={`AI YanÄ±t SÄ±caklÄ±ÄŸÄ± (Temperature: ${aiStatus?.temperature ?? 0.7})`}
                      hint="DÃ¼ÅŸÃ¼k deÄŸerler daha kesin/tutarlÄ±, yÃ¼ksek deÄŸerler daha yaratÄ±cÄ± Ã¶neriler ve yanÄ±tlar Ã¼retir."
                    >
                      <div className="w-48">
                        <Select
                          label="AI SÄ±caklÄ±ÄŸÄ±"
                          size="sm"
                          options={[
                            { value: '0.2', label: '0.2 (Kesin & KatÄ±)' },
                            { value: '0.5', label: '0.5 (OdaklÄ±)' },
                            { value: '0.7', label: '0.7 (Dengeli - VarsayÄ±lan)' },
                            { value: '0.9', label: '0.9 (YaratÄ±cÄ± & Esnek)' },
                          ]}
                          value={String(aiStatus?.temperature ?? 0.7)}
                          onValueChange={(val) => void handleChangeTemperature(Number(val))}
                        />
                      </div>
                    </SettingRow>
                  </div>
                </div>

                {/* 6. ArÅŸiv BakÄ±m & DÃ¼zenleme AraÃ§larÄ± */}
                <div className="flex flex-col gap-3.5 settings-card p-4">
                  <div>
                    <p className="text-sm font-medium">ArÅŸiv BakÄ±m & DÃ¼zenleme AraÃ§larÄ±</p>
                    <p className="text-xs text-muted-foreground">
                      ArÅŸivdeki kayÄ±tlarÄ±n taksonomisini ve vektÃ¶r veritabanÄ±nÄ± toplu olarak yÃ¶netin.
                    </p>
                  </div>

                  {/* SatÄ±r listesi: aynÄ± sÃ¶zlÃ¼k */}
                  <div className="flex flex-col divide-y divide-border/70">
                    <SettingRow
                      label="Ã–neri GÃ¼ven EÅŸiÄŸi"
                      hint="Bu eÅŸiÄŸin altÄ±ndaki otomatik Ã¶neriler uygulanmaz; raporda 'atlandÄ±' olarak gÃ¶rÃ¼nÃ¼r."
                    >
                      <Select
                        value={String(tagThreshold)}
                        onValueChange={handleThresholdChange}
                        options={THRESHOLD_OPTIONS}
                        label="Ã–neri gÃ¼ven eÅŸiÄŸi"
                        size="sm"
                        className="w-24"
                      />
                    </SettingRow>

                    <SettingRow
                      label="Analiz EdilmemiÅŸleri Analiz Et"
                      hint={
                        <>
                          {analysisProgress
                            ? `${analysisProgress.done} / ${analysisProgress.total} analiz ediliyorâ€¦`
                            : 'Ä°ndirilmiÅŸ ama iÃ§eriÄŸi analiz edilmemiÅŸ kayÄ±tlarÄ± sÄ±rayla tarar; transkript, Ã¶zet, konu ve varsa tarif Ã§Ä±karÄ±r.'}
                          {analysisResult && (
                            <span className="mt-1 block font-medium text-emerald-400">âœ“ {analysisResult}</span>
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
                            Ä°ptal
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
                      label="Kategorisiz KayÄ±tlarÄ± DÃ¼zenle"
                      hint={
                        <>
                          {organizeProgress
                            ? `${organizeProgress.current} / ${organizeProgress.total}: ${organizeProgress.title} iÅŸleniyorâ€¦`
                            : 'Kategorisi veya etiketi olmayan kayÄ±tlarÄ± Qwen 2.5 ile sÄ±rayla tarar ve otomatik dÃ¼zenler.'}
                          {organizeResult && (
                            <span className="mt-1 block font-medium text-emerald-400">âœ“ {organizeResult}</span>
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
                        {organizeBusy ? 'Ä°ÅŸleniyorâ€¦' : 'Kategorisizleri DÃ¼zenle'}
                      </Button>
                    </SettingRow>

                    <SettingRow
                      label="Defteri HazÄ±rla"
                      hint={
                        <>
                          {defterStep ? defterStep : 'Eksik iÃ§erikleri toplar, kategorilendirir, tekrarlarÄ± bulur. BirleÅŸtirme yalnÄ±z sizin onayÄ±nÄ±zla olur.'}
                          {defterMsg && (
                            <span className="mt-1 block font-medium text-emerald-400">âœ“ {defterMsg}</span>
                          )}
                          {defterError && (
                            <span className="mt-1 block font-medium text-red-400">âš ï¸ {defterError}</span>
                          )}
                          {defterReport && (defterReport.dedupe?.missingEmbedding ?? 0) > 0 && (
                            <span className="mt-1 block text-muted-foreground">
                              {defterReport.dedupe?.missingEmbedding} kayÄ±t indekslenmemiÅŸ â€” 'TÃ¼m KayÄ±tlarÄ± Yeniden Ä°ndeksle' iÅŸini Ã§alÄ±ÅŸtÄ±rÄ±n.
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
                          {defterBusy ? 'HazÄ±rlanÄ±yorâ€¦' : 'Defteri HazÄ±rla'}
                        </Button>
                        {defterReport && defterReport.scrapeFailures.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void retryFailedNotebook()}
                            disabled={defterBusy}
                          >
                            BaÅŸarÄ±sÄ±zlarÄ± yeniden dene ({defterReport.scrapeFailures.length})
                          </Button>
                        )}
                      </div>
                    </SettingRow>

                    <SettingRow
                      label="Defter Tekrar EÅŸiÄŸi"
                      hint="Bu benzerliÄŸin Ã¼zerindeki kayÄ±tlar tekrar grubu olur; eÅŸik 0,80â€“0,98 arasÄ±nda ayarlanÄ±r."
                    >
                      <Select
                        value={String(dedupeThreshold)}
                        onValueChange={handleDedupeThresholdChange}
                        options={DEDUPE_THRESHOLD_OPTIONS}
                        label="Defter tekrar eÅŸiÄŸi"
                        size="sm"
                        className="w-24"
                      />
                    </SettingRow>

                    {defterGroups.length > 0 && (
                      <div className="flex flex-col gap-2 py-1">
                        <p className="text-xs text-muted-foreground">
                          Tekrar gruplarÄ± ({defterGroups.length}): solda hedef kayÄ±t, saÄŸÄ±nda artÄ±klar. Her grup iÃ§in karar verin.
                        </p>
                        <ul className="flex flex-col gap-1">
                          {defterGroups.map((g, i) => (
                            <li key={`${g.targetId}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                              <span className="min-w-0 truncate">
                                <span className="font-medium">{g.targetTitle}</span>
                                <span className="text-muted-foreground"> â† {g.victimTitles.join(', ')}</span>
                              </span>
                              {defterDone[i] ? (
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {defterDone[i] === 'merged' ? 'birleÅŸti' : 'atlandÄ±'}
                                </span>
                              ) : (
                                <span className="flex shrink-0 gap-1.5">
                                  <Button variant="outline" size="sm" onClick={() => void mergeNotebookGroup(i)} disabled={defterBusy}>
                                    BirleÅŸtir
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
                          {defterBusy ? 'BirleÅŸtiriliyorâ€¦' : 'Kalan TÃ¼mÃ¼nÃ¼ BirleÅŸtir'}
                        </Button>
                      </div>
                    )}

                    <SettingRow
                      label="TÃ¼m KayÄ±tlarÄ± Yeniden Kategorize Et"
                      hint={
                        <>
                          {recatProgress
                            ? `${recatProgress.current} / ${recatProgress.total}: ${recatProgress.title} iÅŸleniyorâ€¦`
                            : 'Her kaydÄ±n kategori/etiketi baÅŸtan Ã¼retilir. Ã–nce otomatik yedek alÄ±nÄ±r; eÅŸik altÄ± kayÄ±tlarda eski atamalar korunur.'}
                          {recatResult && (
                            <span className="mt-1 block font-medium text-emerald-400">âœ“ {recatResult}</span>
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
                        {recatBusy ? 'Yeniden Ã¼retiliyorâ€¦' : 'TÃ¼mÃ¼nÃ¼ Yeniden Kategorize Et'}
                      </Button>
                    </SettingRow>

                    <ConfirmDialog
                      open={confirmRecatOpen}
                      onOpenChange={setConfirmRecatOpen}
                      title="TÃ¼m kayÄ±tlar yeniden kategorize edilsin mi?"
                      description="Her kaydÄ±n mevcut kategori ve etiketleri, yeni Ã¼retilenlerle DEÄÄ°ÅTÄ°RÄ°LÄ°R. Ä°ÅŸlemden Ã¶nce otomatik yedek alÄ±nÄ±r; geri dÃ¶nmek istersen Yedekleme bÃ¶lÃ¼mÃ¼nÃ¼ kullanabilirsin."
                      confirmLabel="Yeniden Kategorize Et"
                      onConfirm={() => void runRecategorizeAll()}
                    />

                    <SettingRow
                      label="Anlamsal ArÅŸiv Ä°ndeksi"
                      hint={
                        reindexProgress
                          ? `${reindexProgress.current} / ${reindexProgress.total} ${
                              reindexProgress.phase === 'content'
                                ? 'iÃ§erik kuruluyorâ€¦'
                                : 'vektÃ¶rleÅŸtiriliyorâ€¦'
                            }`
                          : 'Not, transkript, makale ve kÃ¼nye parÃ§alarÄ±nÄ± baÅŸtan kurup BGE-M3 ile vektÃ¶rleÅŸtirir.'
                      }
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void runReindex()}
                        disabled={reindexBusy || !aiEnabled || !aiStatus?.embed_ready}
                      >
                        {reindexBusy ? 'Ä°ndeksleniyorâ€¦' : 'TÃ¼mÃ¼nÃ¼ Yeniden Ä°ndeksle'}
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

            {/* TAB: KONUÅMA (WHISPER) */}
            {tab === 'speech' && (
              <div className="flex flex-col gap-4">
                {/* Motor kartÄ± */}
                <div className="flex items-center justify-between settings-card p-3.5">
                  <div>
                    <p className="text-sm font-medium">Whisper motoru</p>
                    <p className="text-xs text-muted-foreground">Yerel whisper.cpp CLI yÃ¼rÃ¼tÃ¼cÃ¼sÃ¼{sizeSuffix('whisper', 4)}</p>
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
                    KonuÅŸma Modelleri
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
                                {isDownloading ? `%${dlPercent}` : 'Ä°ndir'}
                              </Button>
                            )}
                            {downloaded && !isSelected && (
                              <Button variant="ghost" size="sm" onClick={() => selectWhisperModel(m.id)}>
                                SeÃ§
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
                  {whisperStatus ? `Modeller: ${whisperStatus.models_dir}` : 'Model durumu yÃ¼kleniyorâ€¦'}
                </p>
                <div>
                  <Button variant="outline" size="sm" onClick={() => void refreshWhisper()}>
                    Durumu yenile
                  </Button>
                </div>
              </div>
            )}

            {/* TAB: GÃ–RÃœNÃœM */}
            {tab === 'view' && (
              <div className="settings-card flex flex-col divide-y divide-border/70 p-4">
                <SettingRow label="Tema" htmlFor="theme-toggle">
                  <ThemeToggle />
                </SettingRow>
                <SettingRow label="Sayfa baÅŸÄ±na kayÄ±t" htmlFor="set-pagesize">
                  <Select
                    label="Sayfa boyutu"
                    className="w-28"
                    value={String(pageSize)}
                    onValueChange={(v) => onPageSizeChange(Number(v))}
                    options={pageSizes.map((n) => ({ value: String(n), label: `${n} kayÄ±t` }))}
                  />
                </SettingRow>
                <SettingRow
                  label="Panoyu otomatik izle"
                  hint="Pano deÄŸiÅŸtikÃ§e algÄ±lar, yakala Ã§ubuÄŸuna hazÄ±rlar."
                  htmlFor="set-watch"
                >
                  <Switch checked={watch} onCheckedChange={handleWatchToggle} aria-labelledby="set-watch" />
                </SettingRow>
                <SettingRow
                  label="HÄ±zlÄ± baÅŸlangÄ±Ã§ turu"
                  hint="Klavye kÄ±sayollarÄ± ve temel kavramlarÄ± gÃ¶steren karÅŸÄ±lama turunu yeniden aÃ§ar."
                >
                  <Button variant="outline" size="sm" onClick={onReplayTour}>
                    Turu BaÅŸlat
                  </Button>
                </SettingRow>
              </div>
            )}

            {/* TAB: Ä°NDÄ°RME */}
            {tab === 'downloads' && (
              <div className="settings-card flex flex-col divide-y divide-border/70 p-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="set-dir" className="text-sm font-medium">
                    Ä°ndirme klasÃ¶rÃ¼
                  </label>
                  <div className="flex gap-2">
                    <Input
                      id="set-dir"
                      value={dir}
                      onChange={(e) => setDir(e.target.value)}
                      placeholder="Ã–rn: D:\Ä°ndirilenler\JointVault"
                    />
                    <Button variant="outline" size="sm" onClick={() => void pickDir()}>
                      SeÃ§â€¦
                    </Button>
                    <Button size="sm" onClick={() => void saveDir()} disabled={dirBusy}>
                      {dirBusy ? 'Kaydediliyorâ€¦' : 'Kaydet'}
                    </Button>
                    {/* Yolu aÃ§mak: klasÃ¶r yoksa/silinmiÅŸse artÄ±k sessiz kalmaz, bildirim Ã§Ä±kar. */}
                    <Button variant="outline" size="sm" onClick={() => reveal(dir)} disabled={!dir}>
                      AÃ§
                    </Button>
                  </div>
                  {dirError && <p className="text-sm text-destructive">{dirError}</p>}
                </div>
                <SettingRow
                  label="VarsayÄ±lan kalite"
                  hint="KayÄ±ttan veya toplu indirmede hedef seÃ§ilmediÄŸinde kullanÄ±lÄ±r."
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
                  label="Pencere kapatma davranÄ±ÅŸÄ±"
                  hint="Pencere [X] ile kapatÄ±ldÄ±ÄŸÄ±nda uygulamanÄ±n ne yapacaÄŸÄ±nÄ± belirler."
                  htmlFor="set-close-mode"
                >
                  <Select
                    label="Kapatma davranÄ±ÅŸÄ±"
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

            {/* TAB: EKLENTÄ° */}
            {tab === 'extension' && (
              <div className="flex flex-col gap-3 settings-card p-4">
                <span className="text-sm font-medium">EÅŸleÅŸme anahtarÄ±</span>
                <p className="text-xs text-muted-foreground">
                  TarayÄ±cÄ± eklentisine bir kez girilir; yenilersen eklentiye yeniden girmen gerekir.
                </p>
                <div className="flex gap-2">
                  <Input value={showToken ? token : 'â€¢'.repeat(24)} readOnly className="font-mono" />
                  <Button variant="outline" size="sm" onClick={() => setShowToken((s) => !s)}>
                    {showToken ? 'Gizle' : 'GÃ¶ster'}
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

            {/* TAB: BÄ°LEÅENLER */}
            {tab === 'components' && <ComponentsSection />}

            {/* TAB: YEDEKLEME */}
            {tab === 'backup' && (
              <div className="flex flex-col gap-4">
                <DataBackupSection />
                <div className="flex flex-col gap-4 settings-card p-4">
                <h3 className="text-sm font-medium">TaÅŸÄ±nabilir dÄ±ÅŸa aktarma (JSON)</h3>
                <p className="text-xs text-muted-foreground">
                  TÃ¼m kayÄ±tlar JSON olarak dÄ±ÅŸa aktarÄ±lÄ±r; iÃ§e aktarma mevcutla birleÅŸir, tekrarlar atlanÄ±r. Medya
                  dosyalarÄ± dahil deÄŸildir.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => void doExport()} disabled={backupBusy}>
                    DÄ±ÅŸa Aktar (JSON)
                  </Button>
                  <label
                    className={`inline-flex h-9 cursor-pointer items-center justify-center rounded-md border border-input bg-transparent px-3 text-sm font-medium transition hover:bg-accent hover:text-accent-foreground ${backupBusy ? 'pointer-events-none opacity-50' : ''}`}
                  >
                    Ä°Ã§e Aktar (JSON)
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
        title="EÅŸleÅŸme anahtarÄ± yenilensin mi?"
        description="Eski anahtarla eÅŸleÅŸmiÅŸ tarayÄ±cÄ± eklentileri baÄŸlantÄ±yÄ± kaybeder. Eklenti ayarlarÄ±na yeni anahtarÄ± girmen gerekir."
        confirmLabel="Yenile"
        onConfirm={() => void runRegenToken()}
      />

      {/*
       * AÃ§Ä±k rÄ±za onayÄ±. EtkinleÅŸtirme Ä°NDÄ°RME BAÅLATMAZ (yalnÄ±zca `enabled` yazÄ±lÄ±r);
       * vazgeÃ§ilirse hiÃ§bir ÅŸey olmaz. Kapatma ise asistan + anlamsal aramanÄ±n
       * duracaÄŸÄ±nÄ± dÃ¼rÃ¼stÃ§e sÃ¶yler â€” veri kaybÄ± yok, modeller diskte kalÄ±r.
       */}
      <ConfirmDialog
        open={aiConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setAiConfirm(null);
        }}
        title={aiConfirm === 'disable' ? 'Yerel AI kapatÄ±lsÄ±n mÄ±?' : "Yerel AI'yÄ± etkinleÅŸtir"}
        description={
          aiConfirm === 'disable' ? (
            'Asistan ve anlamsal arama Ã§alÄ±ÅŸmayÄ± durdurur. Ä°ndirilmiÅŸ modeller diskte kalÄ±r; dilediÄŸinde yeniden aÃ§abilirsin.'
          ) : (
            <>
              YalnÄ±zca Ã¶zellik aÃ§Ä±lÄ±r; <span className="font-medium text-foreground">hiÃ§bir indirme baÅŸlamaz</span>.
              Gerekli bileÅŸenler iÃ§in toplam indirme {aiTotalLabel}. Ä°ndirmeleri Ayarlar â†’ BileÅŸenler bÃ¶lÃ¼mÃ¼nden sen
              baÅŸlatÄ±rsÄ±n.
            </>
          )
        }
        confirmLabel={aiConfirm === 'disable' ? 'Kapat' : 'EtkinleÅŸtir'}
        cancelLabel="VazgeÃ§"
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

