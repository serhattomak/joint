import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Archive,
  ArrowDownUp,
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  FileText,
  Film,
  FolderOpen,
  Link2,
  MoreHorizontal,
  Music,
  Package,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Scissors,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useOpenTarget } from '@/lib/open-target';
import { QuickDownloadDialog } from '@/components/QuickDownloadDialog';
import { useComponentInstaller } from '@/components/ComponentInstaller';
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
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { useNotice } from '@/components/ui/notice';
import { PageSurface } from '@/components/ui/page-surface';
import { Switch } from '@/components/ui/switch';
import { writeClipboardText } from '@/lib/clipboard';
import {
  clearCompletedDownloads,
  createDownloadJob,
  detectCategoryFromFilename,
  listDownloadJobs,
  listDownloadedItems,
  removeDownloadJob,
  removeItem,
  setDownloadState,
  updateDownloadJob,
  updateItem,
  type DownloadCategory,
  type DownloadJob,
  type DownloadStatus,
} from '@/lib/db/client';
import type { Item } from '@/lib/db/types';
import { PLATFORM_META, type Platform } from '@/lib/platform';
import {
  destinationPath,
  formatBytes,
  sortTransfers,
  uniqueDownloadPath,
  useDownloadProgress,
  DOWNLOADS_CHANGED_EVENT,
  startDownload,
  type TransferSort,
} from '@/lib/downloads';
import { missingComponentText, parseMissingComponent } from '@/lib/components';
import { describeError } from '@/lib/errors';
import {
  cancelTurboDownload,
  formatEta,
  formatSpeed,
  getDownloadSettings,
  pauseTurboDownload,
  probeUrl,
  startTurboDownload,
  useTurboProgressListener,
  type ChunkProgress,
  type DownloadSettings,
  type TurboProgressPayload,
} from '@/lib/turbo_download';

/**
 * Oturum başına bir kez çalışır. Önceki oturumdan 'active' kalmış işler
 * gerçekte çalışmıyordur (hiçbir motor yok); bir kez kuyruğa alınırlar.
 * Bu bayrak olmadan, görünüm yeniden bağlandığında **çalışan** işler de
 * kuyruğa alınır ve iki motor aynı part dosyalarına yazardı.
 */
let reconciledThisSession = false;

export interface DownloadsViewProps {
  onClose?: () => void;
  onOpenItem?: (item: Item) => void;
  onConvert?: (item: Item) => void;
  onPlayMedia?: (item: Item) => void;
  /** Hatalı/yeniden indirmelerde linkin gerçek formatlarını seçtirir. */
  onPickFormat?: (target: { id: string; url: string; title?: string | null }) => void;
}

type RowStatus = 'active' | 'queued' | 'paused' | 'error' | 'done';
type SortKey = TransferSort;

interface BaseTransfer {
  key: string;
  id: string;
  title: string;
  source: string;
  engine: string;
  detail: string;
  status: RowStatus;
  progress: number;
  size: number;
  downloaded: number;
  speed: number;
  eta: number;
  speedText: string | null;
  etaText: string | null;
  path: string | null;
  convertedPath: string | null;
  createdAt: string;
  platform: string;
  category: DownloadCategory;
  error: string | null;
}

interface TurboTransfer extends BaseTransfer {
  kind: 'turbo';
  job: DownloadJob;
}

interface VaultTransfer extends BaseTransfer {
  kind: 'vault';
  item: Item;
}

type Transfer = TurboTransfer | VaultTransfer;

const SORT_LABELS: Record<SortKey, string> = {
  newest: 'En yeni',
  oldest: 'En eski',
  name: 'Ad (A→Z)',
  size: 'Boyut',
};

const CATEGORY_LABEL: Record<DownloadCategory, string> = {
  video: 'Video',
  audio: 'Ses',
  archive: 'Sıkıştırılmış',
  document: 'Belge',
  program: 'Program',
  other: 'Dosya',
};

const TURBO_STATUS: Record<DownloadStatus, RowStatus> = {
  active: 'active',
  queued: 'queued',
  paused: 'paused',
  error: 'error',
  completed: 'done',
};

const TIME_FORMAT = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
const DATE_FORMAT = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit' });

function isToday(iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return isToday(iso) ? TIME_FORMAT.format(d) : DATE_FORMAT.format(d);
}

function shortSource(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '');
}

function baseName(path: string): string {
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? path;
}

function categoryIcon(category: DownloadCategory) {
  switch (category) {
    case 'video':
      return <Film className="size-3.5" />;
    case 'audio':
      return <Music className="size-3.5" />;
    case 'archive':
      return <Archive className="size-3.5" />;
    case 'document':
      return <FileText className="size-3.5" />;
    case 'program':
      return <FileCode className="size-3.5" />;
    default:
      return <Package className="size-3.5" />;
  }
}

export function DownloadsView({
  onClose,
  onOpenItem,
  onConvert,
  onPlayMedia,
  onPickFormat,
}: DownloadsViewProps) {
  const { open, reveal } = useOpenTarget();
  const notice = useNotice();
  const installer = useComponentInstaller();

  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [vaultItems, setVaultItems] = useState<Item[]>([]);
  const [vaultLoading, setVaultLoading] = useState(true);

  // Tek hat: arama + sıralama. Durum filtreleri şerit başlıklarına taşındı.
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('newest');

  // Seçim ve satır içi açıklama (modal yok).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [completedOpen, setCompletedOpen] = useState(true);
  const [showAllCompleted, setShowAllCompleted] = useState(false);

  // Yeni iş: tek satırlık besteci. Gelişmiş seçenekler mevcut diyaloğu açar.
  const [composerUrl, setComposerUrl] = useState('');
  const [composerBusy, setComposerBusy] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickUrl, setQuickUrl] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchUrls, setBatchUrls] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);

  // Tek silme diyaloğu: turbo işleri ve arşiv kayıtları birlikte.
  const [deleteTarget, setDeleteTarget] = useState<{
    jobs: DownloadJob[];
    items: Item[];
  } | null>(null);
  const [deleteDisk, setDeleteDisk] = useState(true);
  const [deleteRecord, setDeleteRecord] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Canlı parça durumları (hafızada: jobId -> chunks[]).
  const [liveChunks, setLiveChunks] = useState<Record<string, ChunkProgress[]>>({});
  const [dlSettings, setDlSettings] = useState<DownloadSettings | null>(null);
  const [downloadDir, setDownloadDir] = useState('');

  // Motora gönderilmiş kuyruk işleri: aynı iş iki kez başlatılmaz.
  const dispatchedRef = useRef<Set<string>>(new Set());
  // İlerlemenin DB'ye son yazılma anı (iş başına) — ≈3 sn'de bir.
  const lastPersistRef = useRef<Record<string, number>>({});
  // İş başına kendiliğinden yeniden deneme sayacı.
  const attemptsRef = useRef<Record<string, number>>({});
  // İlerleme olayı, listede olmayan bir işi işaret edebilir: o an listeyi tazeleriz.
  const jobsRef = useRef<DownloadJob[]>([]);
  // Ayarlar, `useCallback([])` içinden okunur: ref üzerinden güncel tutulur.
  const settingsRef = useRef<DownloadSettings | null>(null);

  const reloadJobs = async () => {
    try {
      setLoading(true);
      let list = await listDownloadJobs();
      // Çökme/kesinti sonrası uzlaştırma: 'active' kalan iş gerçekte
      // çalışmıyordur. Part dosyaları yerinde olduğu için kuyruğa alınması
      // kaldığı yerden devam etmesi demektir (IDM'in kesinti sonrası davranışı).
      if (!reconciledThisSession) {
        reconciledThisSession = true;
        const stale = list.filter((j) => j.status === 'active');
        for (const j of stale) {
          await updateDownloadJob(j.id, { status: 'queued', speed_bps: 0, eta_secs: 0 });
        }
        if (stale.length > 0) {
          list = list.map((j) =>
            j.status === 'active' ? { ...j, status: 'queued' as DownloadStatus } : j,
          );
        }
      }
      setJobs(list);
    } finally {
      setLoading(false);
    }
  };

  /**
   * `silent` = arka plan tazelemesi: "yükleniyor…" yer tutucusunu göstermez.
   * İndirme olayları bu listeyi sık tazelediği için şart — yoksa liste her
   * olayda bir anlığına kaybolurdu.
   */
  const reloadVaultItems = async (silent = false) => {
    try {
      if (!silent) setVaultLoading(true);
      const items = await listDownloadedItems();
      setVaultItems(items);
    } finally {
      if (!silent) setVaultLoading(false);
    }
  };

  /**
   * Arşiv medyası indirmelerinin canlı yüzdesi. `download-progress` yüzdeyi
   * verir ama **bitişi vermez**; bitiş `DOWNLOADS_CHANGED_EVENT` ile gelir ve
   * liste o an tazelenir (damga "iniyor" → "yerel" geçer).
   */
  const [vaultPercent, setVaultPercent] = useState<Record<string, number>>({});
  const [vaultMeta, setVaultMeta] = useState<
    Record<string, { speed?: string | null; eta?: string | null }>
  >({});
  const markedActiveRef = useRef<Set<string>>(new Set());
  const vaultItemsRef = useRef<Item[]>([]);

  useEffect(() => {
    vaultItemsRef.current = vaultItems;
  }, [vaultItems]);

  useDownloadProgress(
    useCallback((e: { itemId: string; percent: number; speed?: string | null; eta?: string | null }) => {
      setVaultPercent((p) => ({ ...p, [e.itemId]: e.percent }));
      setVaultMeta((m) => ({ ...m, [e.itemId]: { speed: e.speed, eta: e.eta } }));
      // İlk olay kuyruk→iniyor geçişini yazar (indirme başına bir kez).
      if (!markedActiveRef.current.has(e.itemId)) {
        markedActiveRef.current.add(e.itemId);
        void setDownloadState(e.itemId, { status: 'active' }).then((updated) => {
          setVaultItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
        });
      }
      // Listede yoksa (başka ekrandan başlatılmış) listeyi tazele.
      if (!vaultItemsRef.current.some((it) => it.id === e.itemId)) void reloadVaultItems(true);
    }, []),
  );

  // Başladı/bitti bildirimi: liste ve damgalar tazelenir (yer tutucu göstermeden).
  useEffect(() => {
    const onChanged = (): void => void reloadVaultItems(true);
    window.addEventListener(DOWNLOADS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(DOWNLOADS_CHANGED_EVENT, onChanged);
  }, []);

  useEffect(() => {
    void reloadJobs();
    void reloadVaultItems();
    void getDownloadSettings().then(setDlSettings).catch(() => {});
    void invoke<string>('get_download_dir').then(setDownloadDir).catch(() => {});
  }, []);

  // Escape seçimi bırakır (diyaloglar kendi Escape'ini yönetir).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    settingsRef.current = dlSettings;
  }, [dlSettings]);

  /** Bir işi motora verir. Kuyruk akışı, devam ve yeniden deneme buradan geçer. */
  const startJob = useCallback(async (job: DownloadJob): Promise<void> => {
    await updateDownloadJob(job.id, { status: 'active', error_message: null });
    try {
      await startTurboDownload({
        jobId: job.id,
        url: job.url,
        filename: job.filename,
        destinationPath: job.destination_path,
        fileSize: job.file_size,
        threads: job.threads,
      });
    } catch (e) {
      await updateDownloadJob(job.id, {
        status: 'error',
        error_message: typeof e === 'string' ? e : 'İndirme başlatılamadı.',
      });
    }
  }, []);

  // Kuyruk kendiliğinden akar: 'queued' işler motora verilir, motor da
  // eşzamanlılık kapısında bekletir ve sıra gelince başlatır (IDM kuyruğu).
  useEffect(() => {
    for (const job of jobs) {
      if (job.status !== 'queued') continue;
      if (dispatchedRef.current.has(job.id)) continue;
      dispatchedRef.current.add(job.id);
      void startJob(job);
    }
  }, [jobs, startJob]);

  /**
   * Hata sonrası kendiliğinden yeniden deneme (IDM'in davranışı).
   * Kalıcı hatalarda (`retryable === false`) denenmez; parça dosyaları yerinde
   * kaldığı için deneme **kaldığı yerden** sürer.
   */
  const scheduleRetry = useCallback(
    (jobId: string, retryable: boolean): void => {
      const limit = settingsRef.current?.retry_count ?? 0;
      if (!retryable || limit <= 0) return;
      const used = attemptsRef.current[jobId] ?? 0;
      if (used >= limit) return;
      attemptsRef.current[jobId] = used + 1;
      window.setTimeout(
        () => {
          const job = jobsRef.current.find((j) => j.id === jobId);
          if (job) void startJob(job);
        },
        3000 * (used + 1),
      );
    },
    [startJob],
  );

  /** İndirme sonrası eylem: hiçbir şey · dosyayı aç · klasörde göster. */
  const runAfterComplete = useCallback(
    (jobId: string): void => {
      const action = settingsRef.current?.after_complete ?? 'none';
      if (action === 'none') return;
      const path = jobsRef.current.find((j) => j.id === jobId)?.destination_path;
      if (!path) return;
      if (action === 'open') open(path);
      else reveal(path);
    },
    [open, reveal],
  );

  // Canlı İlerleme Dinleyicisi
  const handleProgress = useCallback((payload: TurboProgressPayload) => {
    // Yakalanan (tarayıcıdan devralınan) indirme, bu görünüm açıkken başlamış
    // olabilir: listede yoksa DB'den tazele, yoksa ilerleme görünmez.
    if (!jobsRef.current.some((j) => j.id === payload.job_id)) {
      void reloadJobs();
    }
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== payload.job_id) return j;
        return {
          ...j,
          downloaded_size: payload.downloaded_size,
          file_size: payload.file_size || j.file_size,
          status: payload.status as DownloadStatus,
          speed_bps: payload.speed_bps,
          eta_secs: payload.eta_secs,
          error_message: payload.error ?? null,
        };
      }),
    );

    if (payload.chunks && payload.chunks.length > 0) {
      setLiveChunks((prev) => ({
        ...prev,
        [payload.job_id]: payload.chunks,
      }));
    }

    const terminal =
      payload.status === 'completed' ||
      payload.status === 'paused' ||
      payload.status === 'error';
    if (terminal) {
      delete lastPersistRef.current[payload.job_id];
      void updateDownloadJob(payload.job_id, {
        status: payload.status as DownloadStatus,
        downloaded_size: payload.downloaded_size,
        speed_bps: 0,
        eta_secs: 0,
        error_message: payload.error ?? null,
      });
      if (payload.status === 'completed') {
        delete attemptsRef.current[payload.job_id];
        runAfterComplete(payload.job_id);
      } else if (payload.status === 'error') {
        scheduleRetry(payload.job_id, payload.retryable !== false);
      }
      return;
    }
    // Kuyrukta bekleyen iş 'active' yazılmaz; durum yalan olur.
    if (payload.status !== 'active') return;

    // İlerleme ≈3 sn'de bir DB'ye yazılır: uygulama çökerse liste doğru
    // durumu gösterir (IDM de durumu sık sık kaydeder).
    const now = Date.now();
    if (now - (lastPersistRef.current[payload.job_id] ?? 0) < 3000) return;
    lastPersistRef.current[payload.job_id] = now;
    void updateDownloadJob(payload.job_id, {
      status: 'active',
      downloaded_size: payload.downloaded_size,
      speed_bps: payload.speed_bps,
      eta_secs: payload.eta_secs,
    });
  }, [runAfterComplete, scheduleRetry]);

  useTurboProgressListener(handleProgress);

  // --- Eylemler -------------------------------------------------------------

  const handlePause = async (job: DownloadJob) => {
    await pauseTurboDownload(job.id);
    await updateDownloadJob(job.id, { status: 'paused', speed_bps: 0, eta_secs: 0 });
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, status: 'paused', speed_bps: 0, eta_secs: 0 } : j)),
    );
  };

  const handleResume = async (job: DownloadJob) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, status: 'active', error_message: null } : j)),
    );
    await startJob(job);
  };

  /**
   * Hatalı arşiv indirmesini yeniden dener. Tür **tahmin edilmez**: linkin
   * gerçek formatları sunulur — tahmin, ses kaydını video sanıp indirmeyi kırardı.
   */
  const retryVaultDownload = async (item: Item): Promise<void> => {
    markedActiveRef.current.delete(item.id);
    setVaultItems((prev) =>
      prev.map((it) =>
        it.id === item.id ? { ...it, download_status: 'queued', download_error: null } : it,
      ),
    );
    if (onPickFormat) onPickFormat({ id: item.id, url: item.url, title: item.title });
    else await startDownload(item.id, item.url, 'video');
  };

  const handlePauseAll = async () => {
    for (const job of jobs.filter((j) => j.status === 'active')) {
      await handlePause(job);
    }
  };

  const handleResumeAll = async () => {
    for (const job of jobs.filter((j) => j.status === 'paused' || j.status === 'queued')) {
      await handleResume(job);
    }
  };

  const handleClearCompleted = async () => {
    await clearCompletedDownloads();
    setJobs((prev) => prev.filter((j) => j.status !== 'completed'));
  };

  /** Pano yazımı sessiz kalmaz: başarı/başarısızlık bildirime dönüşür. */
  const copyText = useCallback(
    async (text: string, label: string): Promise<void> => {
      const res = await writeClipboardText(text);
      notice.push(
        res.ok ? { text: `${label} kopyalandı.`, tone: 'ok' } : { text: res.error, tone: 'error' },
      );
    },
    [notice],
  );

  /** Besteciden tek adımda indirme: yokla → hedef yolu çöz → işi başlat. */
  const startFromComposer = async (): Promise<void> => {
    const url = composerUrl.trim();
    if (!url.startsWith('http')) {
      notice.push({ text: 'Geçerli bir bağlantı yapıştır.', tone: 'error' });
      return;
    }
    setComposerBusy(true);
    try {
      const probe = await probeUrl(url);
      const baseDir = downloadDir || (await invoke<string>('get_download_dir'));
      const separate = dlSettings?.category_folders ?? true;
      const category = detectCategoryFromFilename(probe.filename);
      const threads = probe.accepts_ranges
        ? (dlSettings?.default_connections ?? 8)
        : 1;
      const fullPath = await uniqueDownloadPath(
        destinationPath(baseDir, probe.filename, category, separate),
      );
      const job = await createDownloadJob({
        url,
        filename: fullPath.split(/[/\\]/).pop() ?? probe.filename,
        destination_path: fullPath,
        file_size: probe.file_size,
        threads,
        category,
        status: 'active',
      });
      await startTurboDownload({
        jobId: job.id,
        url: job.url,
        filename: job.filename,
        destinationPath: job.destination_path,
        fileSize: job.file_size,
        threads,
      }).catch(async (e: unknown) => {
        await updateDownloadJob(job.id, {
          status: 'error',
          error_message: typeof e === 'string' ? e : 'İndirme başlatılamadı.',
        });
        throw e;
      });
      setComposerUrl('');
      await reloadJobs();
      notice.push({ text: 'İndirme başladı.', tone: 'ok' });
    } catch (e) {
      notice.push({ text: describeError(e, 'İndirme başlatılamadı.'), tone: 'error' });
    } finally {
      setComposerBusy(false);
    }
  };

  // Toplu Link İndirme (Batch Grabber)
  const handleStartBatch = async () => {
    const lines = batchUrls
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('http'));
    if (lines.length === 0) return;

    setBatchBusy(true);
    try {
      const defaultDir = downloadDir || (await invoke<string>('get_download_dir').catch(() => '')) || '';
      for (const line of lines) {
        const name = line.split('/').pop()?.split('?')[0] || `batch_${Date.now()}`;
        const targetPath = `${defaultDir.replace(/[/\\]+$/, '')}/${name}`;
        await createDownloadJob({
          url: line,
          filename: name,
          destination_path: targetPath,
          status: 'queued',
          threads: 8,
          category: detectCategoryFromFilename(name),
        });
      }
      setBatchUrls('');
      setBatchOpen(false);
      await reloadJobs();
    } finally {
      setBatchBusy(false);
    }
  };

  // --- Silme (tek diyalog) --------------------------------------------------

  const requestDelete = (jobsToDelete: DownloadJob[], itemsToDelete: Item[]) => {
    if (jobsToDelete.length === 0 && itemsToDelete.length === 0) return;
    setDeleteTarget({ jobs: jobsToDelete, items: itemsToDelete });
    setDeleteDisk(true);
    setDeleteRecord(false);
  };

  const handleConfirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteBusy(true);
    try {
      for (const job of target.jobs) {
        // Önce motoru durdur: süren iş dosyayı yeniden yazmasın.
        await cancelTurboDownload(job.id);
        if (deleteDisk && job.destination_path) {
          await invoke('delete_file', { path: job.destination_path }).catch((err) => {
            console.warn('[delete_file] Turbo hedef dosyası silinemedi:', err);
          });
        }
        await removeDownloadJob(job.id);
      }

      for (const item of target.items) {
        if (deleteDisk) {
          if (item.local_path) {
            await invoke('delete_file', { path: item.local_path }).catch((err) => {
              console.warn('[delete_file] Yerel dosya silinemedi (zaten silinmiş olabilir):', err);
            });
          }
          if (item.converted_path) {
            await invoke('delete_file', { path: item.converted_path }).catch((err) => {
              console.warn('[delete_file] Dönüştürülen dosya silinemedi:', err);
            });
          }
        }

        if (deleteRecord) {
          await removeItem(item.id);
        } else {
          await setDownloadState(item.id, { status: 'none', local_path: null, error: null });
          await updateItem(item.id, { converted_path: null });
        }
      }

      const removedJobs = new Set(target.jobs.map((j) => j.id));
      const removedItems = new Set(target.items.map((i) => i.id));
      setJobs((prev) => prev.filter((j) => !removedJobs.has(j.id)));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of removedJobs) next.delete(`t:${id}`);
        for (const id of removedItems) next.delete(`v:${id}`);
        return next;
      });
      setDeleteTarget(null);
      await reloadVaultItems();
    } catch (err) {
      console.error('[delete_download]', err);
      notice.push({ text: describeError(err, 'Silme tamamlanamadı.'), tone: 'error' });
    } finally {
      setDeleteBusy(false);
    }
  };

  // --- Türetilmiş liste -----------------------------------------------------

  const rows = useMemo<Transfer[]>(() => {
    const out: Transfer[] = [];

    for (const job of jobs) {
      const pct =
        job.status === 'completed'
          ? 100
          : job.file_size > 0
            ? Math.min(100, (job.downloaded_size / job.file_size) * 100)
            : 0;
      out.push({
        kind: 'turbo',
        key: `t:${job.id}`,
        id: job.id,
        title: job.filename,
        source: job.url,
        engine: 'Turbo',
        detail: `${job.threads} parça`,
        status: TURBO_STATUS[job.status],
        progress: pct,
        size: job.file_size,
        downloaded: job.downloaded_size,
        speed: job.speed_bps || 0,
        eta: job.eta_secs || 0,
        speedText: null,
        etaText: null,
        path: job.destination_path,
        convertedPath: null,
        createdAt: job.created_at,
        platform: '',
        category: job.category,
        error: job.error_message,
        job,
      });
    }

    for (const item of vaultItems) {
      const status: RowStatus =
        item.download_status === 'active'
          ? 'active'
          : item.download_status === 'queued'
            ? 'queued'
            : item.download_status === 'error'
              ? 'error'
              : 'done';
      const category = detectCategoryFromFilename(item.local_path ?? item.title ?? item.url);
      out.push({
        kind: 'vault',
        key: `v:${item.id}`,
        id: item.id,
        title: item.title || baseName(item.local_path ?? item.url),
        source: item.url,
        engine: 'yt-dlp',
        detail: CATEGORY_LABEL[category],
        status,
        progress:
          status === 'done' ? 100 : Math.round(vaultPercent[item.id] ?? 0),
        size: 0,
        downloaded: 0,
        speed: 0,
        eta: 0,
        speedText: vaultMeta[item.id]?.speed ?? null,
        etaText: vaultMeta[item.id]?.eta ?? null,
        path: item.local_path ?? item.converted_path,
        convertedPath: item.converted_path,
        createdAt: item.created_at,
        platform: PLATFORM_META[item.platform as Platform]?.label ?? item.platform,
        category,
        error: item.download_error,
        item,
      });
    }

    return out;
  }, [jobs, vaultItems, vaultPercent, vaultMeta]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.title, row.source, row.path ?? '', row.engine, row.detail, row.platform].some((value) =>
        value.toLowerCase().includes(q),
      ),
    );
  }, [rows, query]);

  const lanes = useMemo(() => {
    const sorted = sortTransfers(filteredRows, sortBy);
    return (
      [
        { id: 'active' as const, label: 'İniyor', tone: 'var(--color-state-active)' },
        { id: 'queued' as const, label: 'Kuyrukta', tone: 'var(--color-state-queued)' },
        { id: 'paused' as const, label: 'Duraklatıldı', tone: '#ff9f0a' },
        { id: 'error' as const, label: 'Hata', tone: 'var(--color-state-error)' },
        { id: 'done' as const, label: 'Tamamlandı', tone: 'var(--color-state-acquired)' },
      ]
        .map((lane) => ({ ...lane, rows: sorted.filter((row) => row.status === lane.id) }))
        .filter((lane) => lane.rows.length > 0)
    );
  }, [filteredRows, sortBy]);

  const activeCount = useMemo(
    () => rows.filter((row) => row.status === 'active').length,
    [rows],
  );
  const queuedCount = useMemo(
    () => rows.filter((row) => row.status === 'queued').length,
    [rows],
  );
  const completedTurboCount = useMemo(
    () => jobs.filter((job) => job.status === 'completed').length,
    [jobs],
  );
  const totalSpeed = useMemo(
    () => rows.reduce((sum, row) => sum + (row.status === 'active' ? row.speed : 0), 0),
    [rows],
  );

  const selectedJobs = useMemo(
    () => jobs.filter((job) => selected.has(`t:${job.id}`)),
    [jobs, selected],
  );
  const selectedItems = useMemo(
    () => vaultItems.filter((item) => selected.has(`v:${item.id}`)),
    [vaultItems, selected],
  );
  const selectedSize = useMemo(
    () => selectedJobs.reduce((sum, job) => sum + (job.file_size || 0), 0),
    [selectedJobs],
  );
  const canPauseSelected = selectedJobs.some((job) => job.status === 'active');
  const canResumeSelected = selectedJobs.some(
    (job) => job.status === 'paused' || job.status === 'error',
  );
  const selectedLiveCount = selectedJobs.length + selectedItems.length;

  const deleteCount = (deleteTarget?.jobs.length ?? 0) + (deleteTarget?.items.length ?? 0);
  const deleteNames = [
    ...(deleteTarget?.jobs.map((job) => job.filename) ?? []),
    ...(deleteTarget?.items.map((item) => item.title || baseName(item.local_path ?? item.url)) ?? []),
  ];

  const toggleSelected = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleExpanded = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePauseSelected = async (): Promise<void> => {
    for (const job of selectedJobs) {
      if (job.status === 'active') await handlePause(job);
    }
  };

  const handleResumeSelected = async (): Promise<void> => {
    for (const job of selectedJobs) {
      if (job.status === 'paused' || job.status === 'error') await handleResume(job);
    }
  };

  const doneRows = lanes.find((lane) => lane.id === 'done')?.rows ?? [];
  const doneLimit = 6;
  const doneToday = doneRows.filter((row) => isToday(row.createdAt)).length;

  // --- Satır -----------------------------------------------------------------

  const renderRow = (row: Transfer) => {
    const isSelected = selected.has(row.key);
    const isOpen = expanded.has(row.key);
    const error = row.error;
    const missing = row.kind === 'turbo' ? parseMissingComponent(error) : null;
    const errorText = missing ? missingComponentText(missing) : error;
    const chunks = row.kind === 'turbo' ? (liveChunks[row.job.id] ?? []) : [];
    const isDone = row.status === 'done';

    const primary = (() => {
      if (row.kind === 'turbo') {
        if (row.status === 'active') {
          return (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Duraklat"
              title="Duraklat"
              onClick={() => void handlePause(row.job)}
            >
              <Pause className="size-3.5 text-amber-500" />
            </Button>
          );
        }
        if (row.status === 'paused' || row.status === 'queued') {
          return (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Başlat"
              title="Başlat"
              onClick={() => void handleResume(row.job)}
            >
              <Play className="size-3.5 text-emerald-500" />
            </Button>
          );
        }
        if (row.status === 'error') {
          return (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Yeniden dene"
              title="Yeniden dene"
              onClick={() => void handleResume(row.job)}
            >
              <RotateCw className="size-3.5 text-primary" />
            </Button>
          );
        }
        return (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs"
            aria-label="Dosyayı aç"
            onClick={() => open(row.job.destination_path)}
          >
            <ExternalLink className="size-3.5" /> Aç
          </Button>
        );
      }

      if (row.status === 'error') {
        return (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs"
            onClick={() => void retryVaultDownload(row.item)}
          >
            <RotateCw className="size-3.5" /> Dene
          </Button>
        );
      }
      if (row.status === 'done') {
        return (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-xs"
            onClick={() => {
              if (onPlayMedia) onPlayMedia(row.item);
              else if (row.item.local_path) open(row.item.local_path);
            }}
          >
            {onPlayMedia ? (
              <Play className="size-3 text-emerald-500 fill-emerald-500" />
            ) : (
              <ExternalLink className="size-3.5" />
            )}
            {onPlayMedia ? 'Oynat' : 'Aç'}
          </Button>
        );
      }
      return null;
    })();

    return (
      <div key={row.key} className="border-b border-border/70">
        <div
          className={`transfer-row cursor-pointer px-1.5 py-2.5 transition-colors ${
            isSelected ? 'bg-primary/5' : 'hover:bg-muted/30'
          } ${isDone ? 'is-done' : ''}`}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button, input, a, label')) return;
            toggleExpanded(row.key);
          }}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelected(row.key)}
            aria-label={`${row.title} seç`}
            className="tr-check size-3.5 shrink-0 cursor-pointer rounded-2xs border-border"
          />

          <span
            className={`tr-glyph flex size-7 shrink-0 items-center justify-center rounded-md border ${
              row.status === 'error'
                ? 'border-state-error/25 bg-state-error/10 text-state-error'
                : row.status === 'done'
                  ? 'border-state-acquired/25 bg-state-acquired/10 text-state-acquired'
                  : row.status === 'active'
                    ? 'border-primary/20 bg-primary/10 text-primary'
                    : row.status === 'paused'
                      ? 'border-amber-500/25 bg-amber-500/10 text-amber-500'
                      : 'border-border/40 bg-muted/60 text-muted-foreground'
            }`}
          >
            {row.status === 'error' ? (
              <TriangleAlert className="size-3.5" />
            ) : row.status === 'done' ? (
              <Check className="size-3.5" strokeWidth={2.5} />
            ) : (
              categoryIcon(row.category)
            )}
          </span>

          <span className="tr-name flex flex-col gap-0.5">
            <span className="truncate text-sm font-medium leading-tight" title={row.title}>
              {row.title}
            </span>
            <span
              className="truncate font-mono text-2xs text-muted-foreground"
              title={`${row.source}${row.platform ? ` · ${row.platform}` : ''}`}
            >
              {row.status === 'error' && errorText ? (
                <span className="text-destructive">{errorText}</span>
              ) : (
                <>
                  {shortSource(row.source)}
                  <span className="px-1 opacity-60">·</span>
                  {row.engine}
                  <span className="px-1 opacity-60">·</span>
                  {row.detail}
                </>
              )}
            </span>
          </span>

          <span className="tr-actions shrink-0">
            {primary}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={row.path ? 'Klasörde göster' : 'İndirme klasörünü aç'}
              title={row.path ? 'Klasörde göster' : 'İndirme klasörünü aç'}
              onClick={() => {
                if (row.path) reveal(row.path);
                else if (downloadDir) open(downloadDir);
              }}
            >
              <FolderOpen className="size-3.5 text-muted-foreground" />
            </Button>

            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Daha fazla eylem"
                    title="Daha fazla eylem"
                  />
                }
              >
                <MoreHorizontal className="size-3.5 text-muted-foreground" />
              </MenuTrigger>
              <MenuContent align="end" className="min-w-48">
                <MenuItem onClick={() => void copyText(row.source, 'Bağlantı')}>
                  <Link2 className="size-3.5" /> Bağlantıyı kopyala
                </MenuItem>
                {row.path && (
                  <MenuItem onClick={() => void copyText(row.path!, 'Dosya yolu')}>
                    <Copy className="size-3.5" /> Dosya yolunu kopyala
                  </MenuItem>
                )}
                {row.kind === 'vault' && row.status === 'done' && (
                  <>
                    <MenuSeparator />
                    {onConvert && row.item.local_path && (
                      <MenuItem onClick={() => onConvert(row.item)}>
                        <Scissors className="size-3.5" /> Dönüştür / Kırp
                      </MenuItem>
                    )}
                    {onOpenItem && (
                      <MenuItem onClick={() => onOpenItem(row.item)}>
                        <Pencil className="size-3.5" /> Kaydı Aç
                      </MenuItem>
                    )}
                  </>
                )}
                <MenuSeparator />
                <MenuItem
                  onClick={() =>
                    requestDelete(
                      row.kind === 'turbo' ? [row.job] : [],
                      row.kind === 'vault' ? [row.item] : [],
                    )
                  }
                >
                  <Trash2 className="size-3.5" /> Sil
                </MenuItem>
              </MenuContent>
            </Menu>

            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={isOpen ? 'Ayrıntıyı kapat' : 'Ayrıntıyı aç'}
              title={isOpen ? 'Ayrıntıyı kapat' : 'Ayrıntıyı aç'}
              onClick={() => toggleExpanded(row.key)}
            >
              <ChevronDown
                className={`size-3.5 text-muted-foreground transition-transform duration-200 ${
                  isOpen ? 'rotate-180' : ''
                }`}
              />
            </Button>
          </span>

          {!isDone && (
            <span className="tr-progress">
              <span className="flex items-baseline justify-between gap-2 font-mono text-2xs text-muted-foreground">
                <span data-num className="font-medium text-foreground">
                  %{Math.round(row.progress)}
                </span>
                <span data-num className="truncate">
                  {row.size > 0
                    ? `${formatBytes(row.downloaded)} / ${formatBytes(row.size)}`
                    : ''}
                </span>
              </span>
              <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className={`block h-full rounded-full transition-[width] duration-300 ${
                    row.status === 'error'
                      ? 'bg-destructive'
                      : row.status === 'paused'
                        ? 'bg-amber-500'
                        : 'bg-primary'
                  }`}
                  style={{ width: `${row.progress}%` }}
                />
              </span>
            </span>
          )}

          {!isDone ? (
            <span className="tr-metrics font-mono text-2xs text-muted-foreground">
              <span data-num className="truncate font-medium text-foreground">
                {row.kind === 'turbo'
                  ? row.status === 'active'
                    ? `${formatSpeed(row.speed)}${row.eta > 0 ? ` · ${formatEta(row.eta)}` : ''}`
                    : row.status === 'queued'
                      ? 'Sırada'
                      : row.status === 'paused'
                        ? 'Duraklatıldı'
                        : 'Yeniden denenebilir'
                  : [row.speedText, row.etaText ? `kalan ${row.etaText}` : null]
                      .filter(Boolean)
                      .join(' · ') || 'yt-dlp'}
              </span>
              <span className="truncate">
                {row.kind === 'turbo'
                  ? row.detail
                  : row.platform || row.engine}
              </span>
            </span>
          ) : (
            <span className="tr-metrics font-mono text-2xs text-muted-foreground">
              <span data-num>{stamp(row.createdAt)}</span>
              {row.size > 0 && <span data-num>{formatBytes(row.size)}</span>}
            </span>
          )}
        </div>

        {isOpen && (
          <div className="border-t border-border/60 bg-muted/25 px-1.5 py-2.5 lg:pl-[54px]">
            <div className="flex flex-col gap-2">
              {row.path && (
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-11 shrink-0 text-2xs text-muted-foreground">Hedef</span>
                  <code
                    className="min-w-0 flex-1 truncate font-mono text-2xs"
                    title={row.path}
                  >
                    {row.path}
                  </code>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Dosya yolunu kopyala"
                    title="Dosya yolunu kopyala"
                    onClick={() => void copyText(row.path!, 'Dosya yolu')}
                  >
                    <Copy className="size-3" />
                  </Button>
                </div>
              )}
              {row.convertedPath && row.convertedPath !== row.path && (
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-11 shrink-0 text-2xs text-muted-foreground">Dönüşen</span>
                  <code
                    className="min-w-0 flex-1 truncate font-mono text-2xs"
                    title={row.convertedPath}
                  >
                    {row.convertedPath}
                  </code>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Dönüşen dosya yolunu kopyala"
                    title="Dönüşen dosya yolunu kopyala"
                    onClick={() => void copyText(row.convertedPath!, 'Dosya yolu')}
                  >
                    <Copy className="size-3" />
                  </Button>
                </div>
              )}
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-11 shrink-0 text-2xs text-muted-foreground">Kaynak</span>
                <code className="min-w-0 flex-1 truncate font-mono text-2xs" title={row.source}>
                  {row.source}
                </code>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Bağlantıyı kopyala"
                  title="Bağlantıyı kopyala"
                  onClick={() => void copyText(row.source, 'Bağlantı')}
                >
                  <Link2 className="size-3" />
                </Button>
              </div>

              {row.kind === 'turbo' && row.status === 'active' && chunks.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-2xs text-muted-foreground">Parçalar</span>
                  <div className="flex h-5 items-stretch gap-1">
                    {chunks.map((chunk) => (
                      <span key={chunk.id} className="relative flex-1 overflow-hidden rounded-xs bg-muted">
                        <span
                          className="absolute inset-y-0 left-0 bg-primary"
                          style={{ width: `${chunk.percent}%` }}
                        />
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {errorText && (
                <div className="flex flex-wrap items-center gap-2 rounded-md bg-destructive/10 px-2 py-1.5">
                  <p className="min-w-0 flex-1 font-mono text-2xs text-destructive">
                    Hata: {errorText}
                  </p>
                  {missing && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-2xs"
                      onClick={() =>
                        installer.request(missing.id, () => {
                          if (row.kind === 'turbo') void handleResume(row.job);
                        })
                      }
                    >
                      <Download className="size-3" /> Bileşeni kur
                    </Button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {row.kind === 'vault' && row.status === 'done' && onConvert && row.item.local_path && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-2xs"
                    onClick={() => onConvert(row.item)}
                  >
                    <Scissors className="size-3" /> Dönüştür / Kırp
                  </Button>
                )}
                {row.kind === 'vault' && onOpenItem && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-2xs"
                    onClick={() => onOpenItem(row.item)}
                  >
                    <Pencil className="size-3" /> Kaydı aç
                  </Button>
                )}
                {row.kind === 'turbo' && row.status === 'active' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-2xs"
                    onClick={() => void handlePause(row.job)}
                  >
                    <Pause className="size-3" /> Duraklat
                  </Button>
                )}
                <span className="ml-auto font-mono text-2xs text-muted-foreground">
                  {row.kind === 'turbo' ? `#${row.id.slice(0, 8)}` : row.platform}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderLane = (lane: (typeof lanes)[number]) => {
    const laneSpeed = lane.rows.reduce(
      (sum, row) => sum + (row.status === 'active' ? row.speed : 0),
      0,
    );
    const isDoneLane = lane.id === 'done';
    const visibleRows =
      isDoneLane && !showAllCompleted ? lane.rows.slice(0, doneLimit) : lane.rows;

    return (
      <section key={lane.id} className="mt-5">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-1 pb-1.5">
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: lane.tone }}
            aria-hidden
          />
          <b className="text-xs font-semibold">{lane.label}</b>
          <span data-num className="rounded-xs bg-muted px-1.5 font-mono text-2xs text-muted-foreground">
            {lane.rows.length}
          </span>
          <span className="ml-auto font-mono text-2xs text-muted-foreground">
            {isDoneLane
              ? `${doneToday} bugün`
              : lane.id === 'active' && laneSpeed > 0
                ? formatSpeed(laneSpeed)
                : lane.id === 'queued' && dlSettings
                  ? `${activeCount}/${dlSettings.max_concurrent} eşzamanlı`
                  : ''}
          </span>
          {isDoneLane && (
            <button
              type="button"
              onClick={() => setCompletedOpen((v) => !v)}
              className="text-2xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {completedOpen ? 'Gizle' : 'Göster'}
            </button>
          )}
        </div>
        {(!isDoneLane || completedOpen) && (
          <div>
            {visibleRows.map(renderRow)}
            {isDoneLane && !showAllCompleted && lane.rows.length > doneLimit && (
              <div className="flex items-center gap-2 border-b border-border/70 px-1.5 py-2 font-mono text-2xs text-muted-foreground">
                <span>
                  +{lane.rows.length - doneLimit} tamamlanan daha
                </span>
                <button
                  type="button"
                  className="text-primary transition-colors hover:underline"
                  onClick={() => setShowAllCompleted(true)}
                >
                  Tümünü gör
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <PageSurface
      icon={<Download />}
      title="İndirme Yöneticisi"
      description="Her indirme tek listede — durum, hız, hedef."
      width="5xl"
      actions={
        <>
          <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
            <span
              className={`size-2 shrink-0 rounded-full ${
                activeCount > 0 ? 'animate-pulse bg-state-active' : 'bg-muted-foreground/30'
              }`}
              aria-hidden
            />
            <span className="font-mono text-2xs text-muted-foreground">
              <span data-num>{activeCount}</span> iniyor ·{' '}
              <span data-num>{queuedCount}</span> kuyrukta
            </span>
            <span data-num className="border-l border-border pl-2 font-mono text-xs font-semibold">
              {formatSpeed(totalSpeed)}
            </span>
          </div>

          {downloadDir && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => open(downloadDir)}
              title={downloadDir}
              aria-label="İndirme klasörünü aç"
              className="gap-1.5"
            >
              <FolderOpen className="size-3.5" />
              <span className="max-w-[140px] truncate">{baseName(downloadDir)}</span>
            </Button>
          )}

          {onClose && (
            <Button variant="outline" size="sm" onClick={onClose}>
              <ArrowLeft /> Arşive Dön
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Tek satır besteci: modal yok, iş burada başlar. */}
        <form
          className="settings-card flex flex-col gap-2 px-3 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void startFromComposer();
          }}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Input
              value={composerUrl}
              onChange={(e) => setComposerUrl(e.target.value)}
              placeholder="Bağlantıyı yapıştır — Enter ile başlat"
              aria-label="İndirme bağlantısı"
              className="h-8 min-w-[13rem] flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                type="submit"
                size="sm"
                disabled={composerBusy || !composerUrl.trim()}
                className="gap-1.5"
              >
                <Download className="size-3.5" />
                {composerBusy ? 'Başlatılıyor…' : 'İndir'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuickUrl(composerUrl.trim());
                  setQuickOpen(true);
                }}
              >
                Seçenekler
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setBatchOpen(true)}>
                Toplu
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 font-mono text-2xs text-muted-foreground">
            {downloadDir && (
              <button
                type="button"
                onClick={() => open(downloadDir)}
                title={downloadDir}
                className="truncate transition-colors hover:text-foreground"
              >
                Hedef · {baseName(downloadDir)}
              </button>
            )}
            {dlSettings && (
              <span>
                <span data-num>{dlSettings.max_concurrent}</span> eşzamanlı ·{' '}
                <span data-num>{dlSettings.default_connections}</span> kanal
              </span>
            )}
            {dlSettings && (
              <span>
                Bitince ·{' '}
                {dlSettings.after_complete === 'open'
                  ? 'dosyayı aç'
                  : dlSettings.after_complete === 'reveal'
                    ? 'klasörde göster'
                    : 'bekle'}
              </span>
            )}
          </div>
        </form>

        {/* Arama + sıralama + sayfa eylemleri */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-72">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ada, kaynağa veya yola göre ara"
              aria-label="İndirmelerde ara"
              className="pl-9 text-sm"
            />
          </div>

          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  aria-label={`Sırala: ${SORT_LABELS[sortBy]}`}
                />
              }
            >
              <ArrowDownUp className="size-3.5" />
              <span className="text-muted-foreground">Sırala ·</span>
              {SORT_LABELS[sortBy]}
            </MenuTrigger>
            <MenuContent align="end" className="min-w-40">
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <MenuItem key={key} onClick={() => setSortBy(key)}>
                  <Check className={sortBy === key ? 'size-3.5 text-primary' : 'size-3.5 opacity-0'} />
                  {SORT_LABELS[key]}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>

          <Menu>
            <MenuTrigger
              render={
                <Button size="icon-sm" variant="ghost" aria-label="Sayfa eylemleri" title="Sayfa eylemleri" />
              }
            >
              <MoreHorizontal className="size-4" />
            </MenuTrigger>
            <MenuContent align="end" className="min-w-52">
              <MenuItem onClick={() => void handleResumeAll()}>
                <Play className="size-3.5" /> Tümünü başlat
              </MenuItem>
              <MenuItem onClick={() => void handlePauseAll()}>
                <Pause className="size-3.5" /> Tümünü duraklat
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                onClick={() => {
                  setQuickUrl('');
                  setQuickOpen(true);
                }}
              >
                <Plus className="size-3.5" /> Gelişmiş indirme…
              </MenuItem>
              <MenuItem onClick={() => setBatchOpen(true)}>
                <Download className="size-3.5" /> Toplu bağlantı ekle…
              </MenuItem>
              {downloadDir && (
                <MenuItem onClick={() => open(downloadDir)}>
                  <FolderOpen className="size-3.5" /> İndirme klasörünü aç
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem
                disabled={completedTurboCount === 0}
                title="Turbo kuyruğundaki tamamlanmış kayıtları listeden siler; arşiv medyalarına ve dosyalara dokunmaz."
                onClick={() => void handleClearCompleted()}
              >
                <Trash2 className="size-3.5" /> Tamamlanan turbo kayıtlarını temizle
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>

        {selectedLiveCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2">
            <span data-num className="text-xs font-medium">
              {selectedLiveCount} seçili
            </span>
            {selectedSize > 0 && (
              <span data-num className="font-mono text-2xs text-muted-foreground">
                {formatBytes(selectedSize)}
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {canPauseSelected && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-2xs"
                  onClick={() => void handlePauseSelected()}
                >
                  <Pause className="size-3 text-amber-500" /> Duraklat
                </Button>
              )}
              {canResumeSelected && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-2xs"
                  onClick={() => void handleResumeSelected()}
                >
                  <Play className="size-3 text-emerald-500" /> Başlat
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                className="h-7 gap-1 text-2xs"
                onClick={() => requestDelete(selectedJobs, selectedItems)}
              >
                <Trash2 className="size-3" /> Sil
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-2xs"
                onClick={() => setSelected(new Set())}
              >
                Vazgeç
              </Button>
            </div>
          </div>
        )}

        {(loading || vaultLoading) && rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">İndirmeler yükleniyor…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
            <Download className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-base font-semibold">Henüz indirme yok</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Bağlantıyı yukarıdaki alana yapıştır; Enter ile başlar. Panoya kopyaladığın
              bağlantı da yakalanır.
            </p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
            <Search className="mx-auto mb-3 size-8 text-muted-foreground/50" />
            <p className="text-base font-semibold">Bu aramaya uygun indirme yok</p>
            <Button size="sm" variant="outline" className="mt-4" onClick={() => setQuery('')}>
              Aramayı temizle
            </Button>
          </div>
        ) : (
          <div>{lanes.map(renderLane)}</div>
        )}
      </div>

      {/* HIZLI İNDİRME (gelişmiş seçenekler) */}
      <QuickDownloadDialog
        open={quickOpen}
        onOpenChange={setQuickOpen}
        initialUrl={quickUrl}
        onStarted={() => void reloadJobs()}
      />

      {/* TOPLU LİNK */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-md gap-4 p-6">
          <DialogHeader>
            <DialogTitle>Toplu Bağlantı Ekle</DialogTitle>
            <DialogDescription className="text-xs">
              Her satıra bir indirme bağlantısı yapıştır. Dosyalar kuyruğa eklenir.
            </DialogDescription>
          </DialogHeader>

          <textarea
            value={batchUrls}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBatchUrls(e.target.value)}
            rows={6}
            placeholder="https://example.com/dosya1.zip&#10;https://example.com/dosya2.mp4&#10;https://example.com/dosya3.iso"
            className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />

          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setBatchOpen(false)}>
              İptal
            </Button>
            <Button
              size="sm"
              onClick={() => void handleStartBatch()}
              disabled={batchBusy || !batchUrls.trim()}
            >
              {batchBusy ? 'Ekleniyor…' : 'Kuyruğa Ekle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SİLME (turbo + arşiv, tek diyalog) */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md gap-4 p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-destructive">
              <Trash2 className="size-5" />
              {deleteCount === 1
                ? deleteTarget?.items.length
                  ? 'Medyayı Sil'
                  : 'İndirmeyi Sil'
                : `${deleteCount} Kaydı Sil`}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {deleteCount === 1
                ? `"${deleteNames[0]}" için silme seçeneklerini belirleyin.`
                : `${deleteCount} kayıt için silme seçeneklerini belirleyin.`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-1">
            <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-xs">
              <span className="mb-1 block text-3xs font-semibold tracking-wider text-muted-foreground uppercase">
                Dosya
              </span>
              {deleteNames.slice(0, 4).map((name, i) => (
                <p key={`${name}-${i}`} className="truncate text-2xs text-foreground" title={name}>
                  {name}
                </p>
              ))}
              {deleteNames.length > 4 && (
                <p data-num className="mt-1 text-2xs text-muted-foreground">
                  +{deleteNames.length - 4} dosya daha
                </p>
              )}
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-card p-3 select-none transition hover:bg-muted/30">
              <Switch
                checked={deleteDisk}
                onCheckedChange={setDeleteDisk}
                className="pointer-events-none mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-foreground">
                  Dosyaları diskten de sil
                </span>
                <span className="text-2xs leading-relaxed text-muted-foreground">
                  İndirilen dosya kalıcı olarak silinir; yer açılır.
                </span>
              </span>
            </label>

            {(deleteTarget?.items.length ?? 0) > 0 && (
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-card p-3 select-none transition hover:bg-muted/30">
                <Switch
                  checked={deleteRecord}
                  onCheckedChange={setDeleteRecord}
                  className="pointer-events-none mt-0.5"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold text-foreground">
                    Arşiv kaydını da kaldır
                  </span>
                  <span className="text-2xs leading-relaxed text-muted-foreground">
                    {deleteRecord
                      ? 'Kayıt ve bağlantısı arşivden tamamen silinir.'
                      : 'Kapalı: kayıt arşivde kalır, yalnızca indirilmiş medya temizlenir.'}
                  </span>
                </span>
              </label>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteBusy}
            >
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleConfirmDelete()}
              disabled={deleteBusy}
              className="gap-1.5"
            >
              <Trash2 className="size-3.5" />
              {deleteBusy ? 'Siliniyor…' : deleteCount === 1 ? 'Sil' : `${deleteCount} Kaydı Sil`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSurface>
  );
}
