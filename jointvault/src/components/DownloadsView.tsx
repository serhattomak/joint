import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useOpenTarget } from '@/lib/open-target';
import {
  Archive,
  ArrowLeft,
  Download,
  FileCode,
  FileText,
  Film,
  FolderOpen,
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
  Zap,
} from 'lucide-react';
import { QuickDownloadDialog } from '@/components/QuickDownloadDialog';
import { useComponentInstaller } from '@/components/ComponentInstaller';
import { Badge } from '@/components/ui/badge';
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
import { PageSurface } from '@/components/ui/page-surface';
import { Switch } from '@/components/ui/switch';
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
import { formatBytes, useDownloadProgress, DOWNLOADS_CHANGED_EVENT, startDownload } from '@/lib/downloads';
import { Stamp } from '@/components/ui/stamp';
import { Progress } from '@/components/ui/progress';
import { missingComponentText, parseMissingComponent } from '@/lib/components';
import {
  cancelTurboDownload,
  formatEta,
  formatSpeed,
  getDownloadSettings,
  pauseTurboDownload,
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

type FilterStatus = 'all' | 'active' | 'queued' | 'completed' | 'paused' | 'error';
type FilterCategory = 'all' | DownloadCategory;

export function DownloadsView({ onClose, onOpenItem, onConvert, onPlayMedia, onPickFormat }: DownloadsViewProps) {
  const { open, reveal } = useOpenTarget();
  const installer = useComponentInstaller();
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(true);

  // Arşiv İndirmeleri
  const [sourceTab, setSourceTab] = useState<'vault' | 'turbo'>('vault');
  const [vaultItems, setVaultItems] = useState<Item[]>([]);
  const [vaultLoading, setVaultLoading] = useState(true);
  const [vaultSearch, setVaultSearch] = useState('');
  const [vaultPlatform, setVaultPlatform] = useState('all');

  // Filtreler (Turbo için)
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Canlı Parça (Chunk) Durumları (Hafızada tutulur: jobId -> chunks[])
  const [liveChunks, setLiveChunks] = useState<Record<string, ChunkProgress[]>>({});

  // İndirme ayarları (hız sınırı, eşzamanlılık) — yalnız gösterim için.
  const [dlSettings, setDlSettings] = useState<DownloadSettings | null>(null);
  // Motora gönderilmiş kuyruk işleri: aynı iş iki kez başlatılmaz.
  const dispatchedRef = useRef<Set<string>>(new Set());
  // İlerlemenin DB'ye son yazılma anı (iş başına) — ≈3 sn'de bir.
  const lastPersistRef = useRef<Record<string, number>>({});
  // İş başına kendiliğinden yeniden deneme sayacı.
  const attemptsRef = useRef<Record<string, number>>({});
  // İlerleme olayı, listede olmayan bir işi işaret edebilir: yakalanan indirme
  // bu görünüm açıkken başlatılmıştır. O an listeyi tazeleriz.
  const jobsRef = useRef<DownloadJob[]>([]);
  // Ayarlar, `useCallback([])` içinden okunur: ref üzerinden güncel tutulur.
  const settingsRef = useRef<DownloadSettings | null>(null);

  // Diyaloglar
  const [quickOpen, setQuickOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchUrls, setBatchUrls] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);

  // Arşiv Medyası Silme Durumu (Diskten ve/veya Arşivden)
  const [vaultItemToDelete, setVaultItemToDelete] = useState<Item | null>(null);
  const [deleteVaultDiskFile, setDeleteVaultDiskFile] = useState(true);
  const [deleteVaultRecord, setDeleteVaultRecord] = useState(false);
  const [vaultDeleteBusy, setVaultDeleteBusy] = useState(false);

  // Turbo İndirme Silme Durumu (Diskten ve/veya Kuyruktan)
  const [turboJobToDelete, setTurboJobToDelete] = useState<DownloadJob | null>(null);
  const [deleteTurboDiskFile, setDeleteTurboDiskFile] = useState(true);
  const [turboDeleteBusy, setTurboDeleteBusy] = useState(false);

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
      // Eğer Arşivde henüz indirme yok ama turbo kuyruğunda varsa turbo sekmesine geç
      if (items.length === 0 && jobs.length > 0) {
        setSourceTab('turbo');
      }
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
  // (`startJob` tanımından sonra durur: blok kapsamlı değişken önce okunamaz.)
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

  // Aksiyonlar
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

  // Arşiv Medyası Silme İşlemi (Diskten ve/veya Arşivden)
  const handleConfirmDeleteVaultItem = async () => {
    if (!vaultItemToDelete) return;
    setVaultDeleteBusy(true);
    try {
      // 1. Bilgisayardan dosyayı sil
      if (deleteVaultDiskFile) {
        if (vaultItemToDelete.local_path) {
          await invoke('delete_file', { path: vaultItemToDelete.local_path }).catch((err) => {
            console.warn('[delete_file] Yerel dosya silinemedi (zaten silinmiş olabilir):', err);
          });
        }
        if (vaultItemToDelete.converted_path) {
          await invoke('delete_file', { path: vaultItemToDelete.converted_path }).catch((err) => {
            console.warn('[delete_file] Dönüştürülen dosya silinemedi:', err);
          });
        }
      }

      // 2. Arşiv kaydını tamamen sil veya indirme durumunu sıfırla
      if (deleteVaultRecord) {
        await removeItem(vaultItemToDelete.id);
      } else {
        await setDownloadState(vaultItemToDelete.id, {
          status: 'none',
          local_path: null,
          error: null,
        });
        await updateItem(vaultItemToDelete.id, {
          converted_path: null,
        });
      }

      setVaultItemToDelete(null);
      await reloadVaultItems();
    } catch (err) {
      console.error('[delete_vault_item]', err);
    } finally {
      setVaultDeleteBusy(false);
    }
  };

  // Turbo İndirme Silme İşlemi (Diskten ve/veya Kuyruktan)
  const handleConfirmDeleteTurboJob = async () => {
    if (!turboJobToDelete) return;
    setTurboDeleteBusy(true);
    try {
      if (deleteTurboDiskFile && turboJobToDelete.destination_path) {
        await invoke('delete_file', { path: turboJobToDelete.destination_path }).catch((err) => {
          console.warn('[delete_file] Turbo hedef dosyası silinemedi:', err);
        });
      }
      await cancelTurboDownload(turboJobToDelete.id);
      await removeDownloadJob(turboJobToDelete.id);
      setJobs((prev) => prev.filter((j) => j.id !== turboJobToDelete.id));
      setTurboJobToDelete(null);
    } catch (err) {
      console.error('[delete_turbo_job]', err);
    } finally {
      setTurboDeleteBusy(false);
    }
  };

  const handlePauseAll = async () => {
    const activeJobs = jobs.filter((j) => j.status === 'active');
    for (const j of activeJobs) {
      void handlePause(j);
    }
  };

  const handleResumeAll = async () => {
    const pausedJobs = jobs.filter((j) => j.status === 'paused' || j.status === 'queued');
    for (const j of pausedJobs) {
      void handleResume(j);
    }
  };

  const handleClearCompleted = async () => {
    await clearCompletedDownloads();
    setJobs((prev) => prev.filter((j) => j.status !== 'completed'));
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
      const defaultDir = (await invoke<string>('get_download_dir').catch(() => '')) || '';
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

  // Toplam İstatistikler
  const totalSpeed = useMemo(() => {
    return jobs
      .filter((j) => j.status === 'active')
      .reduce((sum, j) => sum + (j.speed_bps || 0), 0);
  }, [jobs]);

  const activeCount = useMemo(() => jobs.filter((j) => j.status === 'active').length, [jobs]);
  const queuedCount = useMemo(() => jobs.filter((j) => j.status === 'queued').length, [jobs]);
  const completedCount = useMemo(() => jobs.filter((j) => j.status === 'completed').length, [jobs]);

  // Filtreleme
  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (statusFilter !== 'all' && j.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && j.category !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return j.filename.toLowerCase().includes(q) || j.url.toLowerCase().includes(q);
      }
      return true;
    });
  }, [jobs, statusFilter, categoryFilter, searchQuery]);

  const filteredVaultItems = useMemo(() => {
    return vaultItems.filter((item) => {
      if (vaultPlatform !== 'all' && item.platform !== vaultPlatform) return false;
      if (vaultSearch.trim()) {
        const q = vaultSearch.toLowerCase();
        return (
          (item.title?.toLowerCase().includes(q) ?? false) ||
          item.url.toLowerCase().includes(q) ||
          (item.local_path?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    });
  }, [vaultItems, vaultPlatform, vaultSearch]);

  const getCategoryIcon = (cat: DownloadCategory) => {
    switch (cat) {
      case 'video':
        return <Film className="size-4 text-sky-400" />;
      case 'audio':
        return <Music className="size-4 text-emerald-400" />;
      case 'archive':
        return <Archive className="size-4 text-amber-400" />;
      case 'document':
        return <FileText className="size-4 text-indigo-400" />;
      case 'program':
        return <FileCode className="size-4 text-purple-400" />;
      default:
        return <Package className="size-4 text-muted-foreground" />;
    }
  };

  return (
    <PageSurface
      icon={<Download />}
      title={
        <span className="inline-flex items-center gap-2">
          İndirme Yöneticisi
          <Badge variant="outline" className="font-mono text-xs font-normal">
            {sourceTab === 'vault' ? 'Arşiv Medyaları' : 'Turbo Engine'}
          </Badge>
        </span>
      }
      description={
        sourceTab === 'vault'
          ? "Arşivdeki indirilen YouTube, X ve medya dosyalarınızı yönetin, doğrudan oynatın veya klasörde açın."
          : 'Çok kanallı paralel parçalı indirme motoru ile dosyalarınızı en yüksek hızda indirin ve yönetin.'
      }
      width="5xl"
      actions={
        <>
          {/* Ana Kaynak Seçici: Arşiv Medyaları vs Turbo İndirmeler */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/60 p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => setSourceTab('vault')}
              className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-medium transition ${
                sourceTab === 'vault'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Film className="size-3.5 text-primary" />
              <span>Arşiv Medyaları</span>
              <span className="rounded-full bg-primary/15 px-1.5 py-0.2 font-mono text-2xs text-primary font-semibold">
                {vaultItems.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSourceTab('turbo')}
              className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-medium transition ${
                sourceTab === 'turbo'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Zap className="size-3.5 text-amber-500" />
              <span>Çok Kanallı (Turbo)</span>
              <span className="rounded-full bg-muted px-1.5 py-0.2 font-mono text-2xs">
                {jobs.length}
              </span>
            </button>
          </div>

          {sourceTab === 'turbo' && (
            <div className="settings-card flex items-center gap-2 px-3.5 py-1.5">
              <span
                className={`size-2.5 rounded-full ${
                  activeCount > 0 ? 'animate-pulse bg-emerald-500' : 'bg-muted-foreground/30'
                }`}
              />
              <div className="flex flex-col">
                <span className="text-2xs text-muted-foreground leading-none">Toplam Hız</span>
                <span className="font-mono text-sm font-semibold text-foreground">
                  {formatSpeed(totalSpeed)}
                </span>
              </div>
              {dlSettings && dlSettings.speed_limit_bps > 0 && (
                <span className="border-l border-border pl-2.5 font-mono text-2xs text-muted-foreground">
                  sınır {formatSpeed(dlSettings.speed_limit_bps)}
                </span>
              )}
              {dlSettings && (
                <span className="border-l border-border pl-2.5 font-mono text-2xs text-muted-foreground">
                  {activeCount}/{dlSettings.max_concurrent} eşzamanlı
                </span>
              )}
            </div>
          )}

          {onClose && (
            <Button variant="outline" size="sm" onClick={onClose}>
              <ArrowLeft /> Arşive Dön
            </Button>
          )}
        </>
      }
    >

      {sourceTab === 'vault' ? (
        <div className="flex flex-col gap-5">
          {/* Arama ve Platform Filtreleri */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={vaultSearch}
                onChange={(e) => setVaultSearch(e.target.value)}
                placeholder="Arşiv indirmelerinde ara (başlık, URL, dosya)…"
                className="pl-9 text-sm"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs w-full sm:w-auto">
              {[
                { id: 'all', label: 'Tüm Platformlar' },
                { id: 'youtube', label: 'YouTube' },
                { id: 'x', label: 'X (Twitter)' },
                { id: 'instagram', label: 'Instagram' },
                { id: 'other', label: 'Diğer Web' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setVaultPlatform(p.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition whitespace-nowrap ${
                    vaultPlatform === p.id
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* İndirme Listesi / Kartları */}
          {vaultLoading ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Arşiv indirmeleri yükleniyor…</p>
          ) : filteredVaultItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-14 text-center bg-card/30">
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Film className="size-7" />
              </div>
              <h3 className="text-lg font-semibold">
                {vaultItems.length === 0 ? 'Henüz İndirilmiş Medya Yok' : 'Filtreye Uygun Medya Bulunamadı'}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                {vaultItems.length === 0
                  ? "Arşiv (Tümü) ekranındaki herhangi bir YouTube, X veya video kartının sağ altındaki İndir butonuna tıklayarak medyayı bilgisayarınıza indirebilirsiniz. İndirilen tüm video ve ses dosyaları burada listelenir."
                  : 'Farklı bir arama terimi veya platform filtresi deneyebilirsiniz.'}
              </p>
              {vaultItems.length === 0 && onClose && (
                <div className="mt-6 flex justify-center">
                  <Button onClick={onClose} className="gap-2">
                    <ArrowLeft className="size-4" /> Arşive Dön ve Medyaları İndir
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredVaultItems.map((item) => (
                <div
                  key={item.id}
                  className="settings-card group flex flex-col overflow-hidden transition hover:border-primary/40 hover:shadow-md"
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-muted/60 border-b border-border">
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="" className="h-full w-full object-cover group-hover:scale-102 transition-transform duration-200" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center font-mono text-2xs text-muted-foreground uppercase">
                        Kapak Yok
                      </div>
                    )}
                    <span className="absolute top-2 left-2 rounded-md bg-black/75 px-2 py-0.5 text-2xs font-medium text-white backdrop-blur-xs">
                      {PLATFORM_META[item.platform as Platform]?.label ?? item.platform}
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col p-4 gap-2.5">
                    <h4
                      className="line-clamp-2 text-sm font-semibold leading-snug cursor-pointer hover:text-primary transition-colors"
                      title={item.title ?? item.url}
                      onClick={() => onOpenItem?.(item)}
                    >
                      {item.title || item.url}
                    </h4>

                    {/* Durum damgası + canlı ilerleme: arşiv satırındaki sözlüğün aynısı.
                        (Eskiden burada koşulsuz "İndirildi" yazıyordu — iniş sürerken bile.) */}
                    {item.download_status === 'queued' || item.download_status === 'active' ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Stamp state={item.download_status === 'queued' ? 'queued' : 'active'} />
                          <span data-num className="text-2xs text-muted-foreground">
                            %{Math.round(vaultPercent[item.id] ?? 0)}
                            {vaultMeta[item.id]?.speed ? ` · ${vaultMeta[item.id]?.speed}` : ''}
                            {vaultMeta[item.id]?.eta ? ` · kalan ${vaultMeta[item.id]?.eta}` : ''}
                          </span>
                        </div>
                        <Progress value={vaultPercent[item.id] ?? 0} />
                      </div>
                    ) : item.download_status === 'error' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Stamp state="error" />
                        <span className="min-w-0 flex-1 truncate text-2xs text-destructive" title={item.download_error ?? ''}>
                          {item.download_error ?? 'İndirme başarısız.'}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-2xs"
                          onClick={() => void retryVaultDownload(item)}
                        >
                          <RotateCw className="size-3" /> Yeniden dene
                        </Button>
                      </div>
                    ) : (
                      <Stamp state="local" />
                    )}

                    {item.local_path && (
                      <p
                        className="truncate font-mono text-2xs text-muted-foreground bg-muted/70 px-2 py-1 rounded border border-border/40"
                        title={item.local_path}
                      >
                        {item.local_path}
                      </p>
                    )}

                    <div className="mt-auto pt-3 flex items-center gap-2 border-t border-border">
                      {item.local_path && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs h-8 flex-1 font-medium"
                            onClick={() => {
                              if (onPlayMedia) {
                                onPlayMedia(item);
                              } else if (item.local_path) {
                                open(item.local_path);
                              }
                            }}
                          >
                            <Play className="size-3 text-emerald-500 fill-emerald-500" /> Oynat
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="h-8 w-8"
                            title="Windows Gezgini'nde Göster"
                            onClick={() => {
                              if (item.local_path) reveal(item.local_path);
                            }}
                          >
                            <FolderOpen className="size-3.5 text-muted-foreground" />
                          </Button>
                        </>
                      )}
                      {onConvert && item.local_path && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="h-8 w-8"
                          title="Dönüştür / Kırp"
                          onClick={() => onConvert(item)}
                        >
                          <Scissors className="size-3.5 text-muted-foreground" />
                        </Button>
                      )}
                      {onOpenItem && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="h-8 w-8"
                          title="Kaydı Aç"
                          onClick={() => onOpenItem(item)}
                        >
                          <Pencil className="size-3.5 text-muted-foreground" />
                        </Button>
                      )}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Medyayı Sil (Listeden / Bilgisayardan)"
                        onClick={() => {
                          setVaultItemToDelete(item);
                          setDeleteVaultDiskFile(true);
                          setDeleteVaultRecord(false);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* ARAÇ ÇUBUĞU (AKSIYON BUTONLARI) */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setQuickOpen(true)} className="gap-1.5 shadow-xs">
                <Plus className="size-4" /> Yeni İndirme Ekle
              </Button>
              <Button variant="outline" size="sm" onClick={() => setBatchOpen(true)} className="gap-1.5">
                <Download className="size-3.5" /> Toplu Link Ekle
              </Button>
              <div className="h-4 w-px bg-border mx-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleResumeAll()}
                disabled={jobs.filter((j) => j.status === 'paused' || j.status === 'queued').length === 0}
                className="gap-1.5 text-xs"
              >
                <Play className="size-3.5 text-emerald-500" /> Tümünü Başlat
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handlePauseAll()}
                disabled={activeCount === 0}
                className="gap-1.5 text-xs"
              >
                <Pause className="size-3.5 text-amber-500" /> Tümünü Duraklat
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleClearCompleted()}
                disabled={completedCount === 0}
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Tamamlananları Temizle
              </Button>
            </div>

            {/* Canlı Arama */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="İndirmelerde ara…"
                className="pl-9 text-sm"
              />
            </div>
          </div>

          {/* SEKME VE KATEGORİ FİLTRELERİ */}
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-4">
            {/* Durum Sekmeleri */}
            <div className="flex items-center gap-1 overflow-x-auto p-1 bg-muted/40 rounded-lg border border-border">
              {[
                { id: 'all', label: 'Tümü', count: jobs.length },
                { id: 'active', label: 'İndiriliyor', count: activeCount },
                { id: 'queued', label: 'Kuyrukta', count: queuedCount },
                { id: 'completed', label: 'Tamamlandı', count: completedCount },
                { id: 'paused', label: 'Duraklatıldı', count: jobs.filter((j) => j.status === 'paused').length },
                { id: 'error', label: 'Hatalı', count: jobs.filter((j) => j.status === 'error').length },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id as FilterStatus)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition whitespace-nowrap ${
                    statusFilter === tab.id
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className="rounded bg-muted px-1.5 py-0.2 font-mono text-2xs">
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Kategori Filtresi */}
            <div className="flex items-center gap-1 overflow-x-auto text-xs">
              {[
                { id: 'all', label: 'Tüm Dosyalar' },
                { id: 'video', label: 'Videolar' },
                { id: 'audio', label: 'Ses' },
                { id: 'archive', label: 'Sıkıştırılmış' },
                { id: 'document', label: 'Belgeler' },
                { id: 'program', label: 'Programlar' },
              ].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryFilter(c.id as FilterCategory)}
                  className={`rounded-full px-2.5 py-1 transition ${
                    categoryFilter === c.id
                      ? 'bg-primary/15 font-semibold text-primary'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* İNDİRME LİSTESİ / KARTLARI */}
          {loading ? (
            <p className="py-16 text-center text-sm text-muted-foreground">İndirmeler yükleniyor…</p>
          ) : filteredJobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-16 text-center">
              <Download className="mx-auto mb-3 size-10 text-muted-foreground/50" />
              <p className="text-base font-semibold">Aktif veya kayıtlı indirme bulunamadı</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                Yukarıdaki '+ Yeni İndirme Ekle' butonuna tıklayarak veya panoya dosya bağlantısı kopyalayarak çok kanallı indirmeyi başlatabilirsiniz.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredJobs.map((job) => {
                const pct =
                  job.file_size > 0
                    ? Math.min(100, (job.downloaded_size / job.file_size) * 100)
                    : job.status === 'completed'
                    ? 100
                    : 0;

                const chunks = liveChunks[job.id] ?? [];

                // Turbo satırının hata alanı da makine işareti taşıyabilir; önek
                // asla gösterilmez. İşaret varsa okunabilir cümle + kurulum eylemi.
                const missingError = parseMissingComponent(job.error_message);
                const errorText = missingError ? missingComponentText(missingError) : job.error_message;

                return (
                  <div
                    key={job.id}
                    className="settings-card group flex flex-col gap-3 p-4 transition hover:border-primary/40"
                  >
                    {/* ÜST SATIR: İKON + DOSYA ADI + METRİKLER + AKSİYONLAR */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 border border-border/40">
                          {getCategoryIcon(job.category)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold leading-tight text-foreground" title={job.filename}>
                              {job.filename}
                            </span>
                            {job.threads > 1 && (
                              <Badge variant="outline" className="text-3xs font-mono py-0 px-1 text-muted-foreground">
                                {job.threads} parça
                              </Badge>
                            )}
                          </div>
                          <p className="truncate text-micro text-muted-foreground font-mono mt-0.5" title={job.url}>
                            {job.url}
                          </p>
                        </div>
                      </div>

                      {/* Durum & Butonlar */}
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                        <span className="font-mono text-xs text-muted-foreground">
                          {job.status === 'active' && formatSpeed(job.speed_bps)}
                          {job.status === 'active' && job.eta_secs > 0 && ` · ${formatEta(job.eta_secs)}`}
                        </span>

                        {job.status === 'completed' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1 text-xs"
                            onClick={() => open(job.destination_path)}
                          >
                            <FolderOpen className="size-3.5" /> Dosyayı Aç
                          </Button>
                        )}

                        {job.status === 'active' && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => void handlePause(job)}
                            title="Duraklat"
                          >
                            <Pause className="size-3.5 text-amber-500" />
                          </Button>
                        )}

                        {job.status === 'paused' && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => void handleResume(job)}
                            title="Devam Et"
                          >
                            <Play className="size-3.5 text-emerald-500" />
                          </Button>
                        )}

                        {job.status === 'error' && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => void handleResume(job)}
                            title="Tekrar Dene"
                          >
                            <Play className="size-3.5 text-primary" />
                          </Button>
                        )}

                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => {
                            setTurboJobToDelete(job);
                            setDeleteTurboDiskFile(true);
                          }}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="İndirmeyi Sil (Listeden / Bilgisayardan)"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* İLERLEME ÇUBUĞU */}
                    <div className="flex flex-col gap-1">
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full transition-all duration-300 ${
                            job.status === 'completed'
                              ? 'bg-emerald-500'
                              : job.status === 'paused'
                              ? 'bg-amber-500'
                              : job.status === 'error'
                              ? 'bg-destructive'
                              : 'bg-primary'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between font-mono text-2xs text-muted-foreground">
                        <span>
                          {formatBytes(job.downloaded_size)} /{' '}
                          {job.file_size > 0 ? formatBytes(job.file_size) : 'Bilinmeyen'} (%{pct.toFixed(1)})
                        </span>
                        <span className="truncate max-w-[280px]" title={job.destination_path}>
                          {job.destination_path}
                        </span>
                      </div>
                    </div>

                    {/* PARÇA (CHUNK) GÖRSELLEŞTİRME (SADECE AKTİFSE) */}
                    {job.status === 'active' && chunks.length > 0 && (
                      <div className="mt-1 flex flex-col gap-1 border-t border-border/40 pt-2">
                        <span className="text-3xs font-medium text-muted-foreground uppercase tracking-wider">
                          Parça Durumları ({chunks.length} iş parçacığı):
                        </span>
                        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                          {chunks.map((ch) => (
                            <div
                              key={ch.id}
                              className="flex flex-col gap-0.5 rounded bg-muted/40 p-1 text-center"
                            >
                              <div className="relative h-6 w-full overflow-hidden rounded bg-muted/50">
                                <div
                                  className="absolute bottom-0 left-0 right-0 bg-primary/80 transition-all duration-200"
                                  style={{ height: `${ch.percent}%` }}
                                />
                              </div>
                              <span className="font-mono text-3xs text-muted-foreground">
                                {Math.round(ch.percent)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {errorText && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-destructive/10 p-2">
                        <p className="font-mono text-xs text-destructive">Hata: {errorText}</p>
                        {missingError && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-2xs"
                            onClick={() => void installer.request(missingError.id, () => void handleResume(job))}
                          >
                            <Download className="size-3" /> Bileşeni kur
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* HIZLI İNDİRME DİYALOĞU */}
      <QuickDownloadDialog
        open={quickOpen}
        onOpenChange={setQuickOpen}
        onStarted={() => void reloadJobs()}
      />

      {/* TOPLU LİNK İNDİRME DİYALOĞU */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-md gap-4 p-6">
          <DialogHeader>
            <DialogTitle>Toplu Bağlantı İndirme (Batch Grabber)</DialogTitle>
            <DialogDescription className="text-xs">
              Her satıra bir adet indirme bağlantısı (URL) yapıştırın. Dosyalar kuyruğa eklenecektir.
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

      {/* ARŞİV MEDYASI SİLME DİYALOĞU */}
      <Dialog
        open={vaultItemToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !vaultDeleteBusy) setVaultItemToDelete(null);
        }}
      >
        <DialogContent className="max-w-md gap-4 p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-destructive">
              <Trash2 className="size-5" />
              İndirilen Medyayı Sil
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              "{vaultItemToDelete?.title || vaultItemToDelete?.url}" için silme seçeneklerini belirleyin.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-1">
            {vaultItemToDelete?.local_path && (
              <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-xs">
                <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Dosya Konumu
                </span>
                <p className="font-mono text-2xs break-all text-foreground select-all">
                  {vaultItemToDelete.local_path}
                </p>
                {vaultItemToDelete.converted_path && (
                  <>
                    <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground block mt-2 mb-1">
                      Dönüştürülen Dosya
                    </span>
                    <p className="font-mono text-2xs break-all text-foreground select-all">
                      {vaultItemToDelete.converted_path}
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Seçenek 1: Bilgisayardan Sil */}
            <div
              onClick={() => setDeleteVaultDiskFile((v) => !v)}
              className="flex items-start gap-3 rounded-lg border border-border/70 bg-card p-3 cursor-pointer hover:bg-muted/30 transition select-none"
            >
              <Switch
                checked={deleteVaultDiskFile}
                onCheckedChange={(checked) => setDeleteVaultDiskFile(checked)}
                className="mt-0.5 pointer-events-none"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-foreground">
                  Dosyayı bilgisayardan kalıcı olarak sil
                </span>
                <span className="text-2xs text-muted-foreground leading-relaxed">
                  İndirilmiş olan video/ses dosyası diskten silinir ve yer açılır.
                </span>
              </div>
            </div>

            {/* Seçenek 2: Arşiv Kaydını da Kaldır */}
            <div
              onClick={() => setDeleteVaultRecord((v) => !v)}
              className="flex items-start gap-3 rounded-lg border border-border/70 bg-card p-3 cursor-pointer hover:bg-muted/30 transition select-none"
            >
              <Switch
                checked={deleteVaultRecord}
                onCheckedChange={(checked) => setDeleteVaultRecord(checked)}
                className="mt-0.5 pointer-events-none"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-foreground">
                  Kaydı Arşivden tamamen kaldır
                </span>
                <span className="text-2xs text-muted-foreground leading-relaxed">
                  {deleteVaultRecord
                    ? 'Kayıt ve bağlantısı arşivden tamamen silinecektir.'
                    : 'Kapalı: Kayıt arşivde kalır, yalnızca indirilmiş medya temizlenir ve listeden çıkarılır.'}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVaultItemToDelete(null)}
              disabled={vaultDeleteBusy}
            >
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleConfirmDeleteVaultItem()}
              disabled={vaultDeleteBusy}
              className="gap-1.5"
            >
              <Trash2 className="size-3.5" />
              {vaultDeleteBusy ? 'Siliniyor…' : 'Medyayı Sil'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TURBO İNDİRME SİLME DİYALOĞU */}
      <Dialog
        open={turboJobToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !turboDeleteBusy) setTurboJobToDelete(null);
        }}
      >
        <DialogContent className="max-w-md gap-4 p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-destructive">
              <Trash2 className="size-5" />
              Turbo İndirmeyi Sil
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              "{turboJobToDelete?.filename}" indirme görevi listeden kaldırılacak.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-1">
            {turboJobToDelete?.destination_path && (
              <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-xs">
                <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                  Hedef Dosya Konumu
                </span>
                <p className="font-mono text-2xs break-all text-foreground select-all">
                  {turboJobToDelete.destination_path}
                </p>
              </div>
            )}

            {/* Seçenek: Bilgisayardan Sil */}
            <div
              onClick={() => setDeleteTurboDiskFile((v) => !v)}
              className="flex items-start gap-3 rounded-lg border border-border/70 bg-card p-3 cursor-pointer hover:bg-muted/30 transition select-none"
            >
              <Switch
                checked={deleteTurboDiskFile}
                onCheckedChange={(checked) => setDeleteTurboDiskFile(checked)}
                className="mt-0.5 pointer-events-none"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-foreground">
                  İndirilen dosyayı bilgisayardan da sil
                </span>
                <span className="text-2xs text-muted-foreground leading-relaxed">
                  Diskte oluşturulan veya indirilen dosya kalıcı olarak silinir.
                </span>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTurboJobToDelete(null)}
              disabled={turboDeleteBusy}
            >
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleConfirmDeleteTurboJob()}
              disabled={turboDeleteBusy}
              className="gap-1.5"
            >
              <Trash2 className="size-3.5" />
              {turboDeleteBusy ? 'Siliniyor…' : 'İndirmeyi Sil'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSurface>
  );
}
