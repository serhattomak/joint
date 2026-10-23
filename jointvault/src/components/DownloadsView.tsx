import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useOpenTarget } from '@/lib/open-target';
import {
  Archive,
  ArrowDownUp,
  ArrowLeft,
  Check,
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
  Zap,
} from 'lucide-react';
import { QuickDownloadDialog } from '@/components/QuickDownloadDialog';
import { useComponentInstaller } from '@/components/ComponentInstaller';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { useNotice } from '@/components/ui/notice';
import { writeClipboardText } from '@/lib/clipboard';
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
import { formatBytes, sortDownloadJobs, useDownloadProgress, DOWNLOADS_CHANGED_EVENT, startDownload, type DownloadSort } from '@/lib/downloads';
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

/** Arşiv sekmesinde durum filtresi — hatalı/iniyor kaydı bulmanın yolu. */
type VaultStatusFilter = 'all' | 'local' | 'active' | 'error';

const TURBO_SORT_LABELS: Record<DownloadSort, string> = {
  newest: 'En yeni',
  oldest: 'En eski',
  name: 'Ad (A→Z)',
  size: 'Boyut',
  status: 'Durum',
};

/** Arşiv kaydı "yerel" sayılır: inişi sürmüyor ve hata taşımıyor. */
function isVaultLocal(status: Item['download_status']): boolean {
  return status !== 'queued' && status !== 'active' && status !== 'error';
}

export function DownloadsView({ onClose, onOpenItem, onConvert, onPlayMedia, onPickFormat }: DownloadsViewProps) {
  const { open, reveal } = useOpenTarget();
  const notice = useNotice();
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
  const [sortBy, setSortBy] = useState<DownloadSort>('newest');

  // Arşiv sekmesi durum filtresi + toplu seçim kümeleri.
  const [vaultStatus, setVaultStatus] = useState<VaultStatusFilter>('all');
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [selectedVault, setSelectedVault] = useState<Set<string>>(new Set());

  // Ayarlardaki indirme kökü: başlıktaki "İndirme Klasörü" eylemi.
  const [downloadDir, setDownloadDir] = useState('');

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
  // Dizidir: tek satırdan açılan diyalog ile toplu silme aynı akışı kullanır.
  const [vaultItemsToDelete, setVaultItemsToDelete] = useState<Item[]>([]);
  const [deleteVaultDiskFile, setDeleteVaultDiskFile] = useState(true);
  const [deleteVaultRecord, setDeleteVaultRecord] = useState(false);
  const [vaultDeleteBusy, setVaultDeleteBusy] = useState(false);

  // Turbo İndirme Silme Durumu (Diskten ve/veya Kuyruktan)
  const [turboJobsToDelete, setTurboJobsToDelete] = useState<DownloadJob[]>([]);
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
    void invoke<string>('get_download_dir').then(setDownloadDir).catch(() => {});
  }, []);

  // Seçim, listeden düşen kimlikleri taşımaz: sayaç ve eylemler canlı kümeyle türetilir.
  // Escape seçimi bırakır (diyaloglar kendi Escape'ini yönetir).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      setSelectedJobs(new Set());
      setSelectedVault(new Set());
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
  const handleConfirmDeleteVaultItems = async () => {
    if (vaultItemsToDelete.length === 0) return;
    setVaultDeleteBusy(true);
    try {
      for (const item of vaultItemsToDelete) {
        // 1. Bilgisayardan dosyayı sil
        if (deleteVaultDiskFile) {
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

        // 2. Arşiv kaydını tamamen sil veya indirme durumunu sıfırla
        if (deleteVaultRecord) {
          await removeItem(item.id);
        } else {
          await setDownloadState(item.id, {
            status: 'none',
            local_path: null,
            error: null,
          });
          await updateItem(item.id, {
            converted_path: null,
          });
        }
      }

      setVaultItemsToDelete([]);
      setSelectedVault(new Set());
      await reloadVaultItems();
    } catch (err) {
      console.error('[delete_vault_item]', err);
    } finally {
      setVaultDeleteBusy(false);
    }
  };

  // Turbo İndirme Silme İşlemi (Diskten ve/veya Kuyruktan)
  const handleConfirmDeleteTurboJobs = async () => {
    if (turboJobsToDelete.length === 0) return;
    setTurboDeleteBusy(true);
    try {
      const removed = new Set<string>();
      for (const job of turboJobsToDelete) {
        // Önce motoru durdur: süren iş dosyayı yeniden yazmasın.
        await cancelTurboDownload(job.id);
        if (deleteTurboDiskFile && job.destination_path) {
          await invoke('delete_file', { path: job.destination_path }).catch((err) => {
            console.warn('[delete_file] Turbo hedef dosyası silinemedi:', err);
          });
        }
        await removeDownloadJob(job.id);
        removed.add(job.id);
      }
      setJobs((prev) => prev.filter((j) => !removed.has(j.id)));
      setSelectedJobs(new Set());
      setTurboJobsToDelete([]);
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

  // Toplu eylemler seçili küme üzerinde çalışır; kuyruk kapısı motorda kalır.
  const selectedJobObjects = useMemo(
    () => jobs.filter((j) => selectedJobs.has(j.id)),
    [jobs, selectedJobs],
  );

  const selectedVaultItems = useMemo(
    () => vaultItems.filter((i) => selectedVault.has(i.id)),
    [vaultItems, selectedVault],
  );

  const handlePauseSelected = async (): Promise<void> => {
    for (const job of selectedJobObjects) {
      if (job.status === 'active') await handlePause(job);
    }
  };

  const handleResumeSelected = async (): Promise<void> => {
    for (const job of selectedJobObjects) {
      if (job.status === 'paused' || job.status === 'error') await handleResume(job);
    }
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

  // Filtreleme + sıralama (sıralama yalnız görünümü etkiler, DB'yi değil).
  const filteredJobs = useMemo(() => {
    const list = jobs.filter((j) => {
      if (statusFilter !== 'all' && j.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && j.category !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return j.filename.toLowerCase().includes(q) || j.url.toLowerCase().includes(q);
      }
      return true;
    });

    return sortDownloadJobs(list, sortBy);
  }, [jobs, statusFilter, categoryFilter, searchQuery, sortBy]);

  const filteredTotalSize = useMemo(
    () => filteredJobs.reduce((sum, j) => sum + (j.file_size || 0), 0),
    [filteredJobs],
  );

  // Platform + arama tabanı; durum çipleri bu küme içinde sayılır (yanıltıcı toplam yok).
  const vaultBaseItems = useMemo(() => {
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

  const filteredVaultItems = useMemo(() => {
    return vaultBaseItems.filter((item) => {
      if (vaultStatus === 'error' && item.download_status !== 'error') return false;
      if (
        vaultStatus === 'active' &&
        item.download_status !== 'queued' &&
        item.download_status !== 'active'
      ) {
        return false;
      }
      if (vaultStatus === 'local' && !isVaultLocal(item.download_status)) return false;
      return true;
    });
  }, [vaultBaseItems, vaultStatus]);

  const vaultStatusCounts = useMemo(
    () => ({
      all: vaultBaseItems.length,
      local: vaultBaseItems.filter((i) => isVaultLocal(i.download_status)).length,
      active: vaultBaseItems.filter(
        (i) => i.download_status === 'queued' || i.download_status === 'active',
      ).length,
      error: vaultBaseItems.filter((i) => i.download_status === 'error').length,
    }),
    [vaultBaseItems],
  );

  const allJobsSelected =
    filteredJobs.length > 0 && filteredJobs.every((j) => selectedJobs.has(j.id));
  const allVaultSelected =
    filteredVaultItems.length > 0 && filteredVaultItems.every((i) => selectedVault.has(i.id));

  const toggleJobSelection = (id: string): void => {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleVaultSelection = (id: string): void => {
    setSelectedVault((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllJobs = (): void => {
    setSelectedJobs(allJobsSelected ? new Set() : new Set(filteredJobs.map((j) => j.id)));
  };

  const toggleAllVault = (): void => {
    setSelectedVault(allVaultSelected ? new Set() : new Set(filteredVaultItems.map((i) => i.id)));
  };

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
        <span className="inline-flex max-w-full flex-wrap items-center gap-2">
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
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/60 p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => setSourceTab('vault')}
              className={`flex shrink-0 items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-medium whitespace-nowrap transition ${
                sourceTab === 'vault'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Film className="size-3.5 text-primary" />
              <span>Arşiv Medyaları</span>
              <span className="shrink-0 rounded-full bg-primary/15 px-1.5 font-mono text-2xs font-semibold text-primary">
                {vaultItems.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSourceTab('turbo')}
              className={`flex shrink-0 items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-medium whitespace-nowrap transition ${
                sourceTab === 'turbo'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Zap className="size-3.5 text-amber-500" />
              <span>Çok Kanallı (Turbo)</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 font-mono text-2xs">
                {jobs.length}
              </span>
            </button>
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
              <span className="hidden xl:inline">İndirme Klasörü</span>
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
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-xs sm:w-auto">
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
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition ${
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

          {/* Durum filtresi: hatalı/iniyor kaydı aramanın yolu. */}
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {(
              [
                { id: 'all', label: 'Tümü' },
                { id: 'local', label: 'Yerel' },
                { id: 'active', label: 'İniyor' },
                { id: 'error', label: 'Hata' },
              ] as { id: VaultStatusFilter; label: string }[]
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={vaultStatus === s.id}
                onClick={() => setVaultStatus(s.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1 font-medium whitespace-nowrap transition ${
                  vaultStatus === s.id
                    ? 'bg-card text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span>{s.label}</span>
                <span data-num className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-2xs">
                  {vaultStatusCounts[s.id]}
                </span>
              </button>
            ))}
          </div>

          {selectedVaultItems.length > 0 && (
            <div className="settings-card flex flex-wrap items-center gap-2 px-3 py-2">
              <span data-num className="text-xs font-medium">{selectedVaultItems.length} seçili</span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-2xs"
                  onClick={() => setSelectedVault(new Set())}
                >
                  Vazgeç
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 gap-1 text-2xs"
                  onClick={() => {
                    setVaultItemsToDelete(selectedVaultItems);
                    setDeleteVaultDiskFile(true);
                    setDeleteVaultRecord(false);
                  }}
                >
                  <Trash2 className="size-3" /> Seçilenleri Sil
                </Button>
              </div>
            </div>
          )}

          {filteredVaultItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 px-1 text-2xs text-muted-foreground">
              <input
                type="checkbox"
                checked={allVaultSelected}
                onChange={toggleAllVault}
                aria-label="Görünen medyaların tümünü seç"
                className="size-3.5 cursor-pointer rounded-2xs border-border"
              />
              <span data-num>
                {filteredVaultItems.length} medya
                {filteredVaultItems.length !== vaultItems.length
                  ? ` (${vaultItems.length} içinden)`
                  : ''}
              </span>
            </div>
          )}

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
                  : 'Farklı bir arama terimi, platform veya durum filtresi deneyebilirsiniz.'}
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
                  className={`settings-card group flex flex-col overflow-hidden transition hover:border-primary/40 hover:shadow-md ${
                    selectedVault.has(item.id) ? 'border-primary/60' : ''
                  }`}
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-muted/60 border-b border-border">
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="" className="h-full w-full object-cover group-hover:scale-102 transition-transform duration-200" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center font-mono text-2xs text-muted-foreground uppercase">
                        Kapak Yok
                      </div>
                    )}
                    <span className="absolute top-2 left-2 max-w-[calc(100%-3.25rem)] truncate rounded-md bg-black/75 px-2 py-0.5 text-2xs font-medium text-white backdrop-blur-xs">
                      {PLATFORM_META[item.platform as Platform]?.label ?? item.platform}
                    </span>
                    <label className="absolute top-2 right-2 flex size-6 cursor-pointer items-center justify-center rounded-md border border-border bg-background shadow-xs">
                      <input
                        type="checkbox"
                        checked={selectedVault.has(item.id)}
                        onChange={() => toggleVaultSelection(item.id)}
                        aria-label={`${item.title ?? item.url} seç`}
                        className="size-3.5 cursor-pointer rounded-2xs border-border"
                      />
                    </label>
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
                          <span data-num className="min-w-0 truncate text-2xs text-muted-foreground">
                            %{Math.round(vaultPercent[item.id] ?? 0)}
                            {vaultMeta[item.id]?.speed ? ` · ${vaultMeta[item.id]?.speed}` : ''}
                            {vaultMeta[item.id]?.eta ? ` · kalan ${vaultMeta[item.id]?.eta}` : ''}
                          </span>
                        </div>
                        <Progress value={vaultPercent[item.id] ?? 0} readout={false} />
                      </div>
                    ) : item.download_status === 'error' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Stamp state="error" />
                        <span className="line-clamp-2 min-w-0 flex-1 text-2xs text-destructive" title={item.download_error ?? ''}>
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
                      <Stamp state="local" className="self-start" />
                    )}

                    {item.local_path && (
                      <p
                        className="truncate font-mono text-2xs text-muted-foreground bg-muted/70 px-2 py-1 rounded border border-border/40"
                        title={item.local_path}
                      >
                        {item.local_path}
                      </p>
                    )}

                    <div className="mt-auto flex items-center justify-end gap-2 border-t border-border pt-3">
                      {item.local_path && (
                        <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 min-w-0 flex-1 gap-1.5 text-xs font-medium"
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
                            title="Klasörde Göster"
                            aria-label="Klasörde göster"
                            onClick={() => {
                              if (item.local_path) reveal(item.local_path);
                            }}
                          >
                            <FolderOpen className="size-3.5 text-muted-foreground" />
                          </Button>
                        </>
                      )}
                      <Menu>
                        <MenuTrigger
                          render={
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="h-8 w-8"
                              title="Daha fazla eylem"
                              aria-label="Daha fazla eylem"
                            />
                          }
                        >
                          <MoreHorizontal className="size-3.5 text-muted-foreground" />
                        </MenuTrigger>
                        <MenuContent align="end" className="min-w-44">
                          <MenuItem onClick={() => void copyText(item.url, 'Bağlantı')}>
                            <Link2 className="size-3.5" /> Bağlantıyı kopyala
                          </MenuItem>
                          {item.local_path && (
                            <MenuItem
                              onClick={() => {
                                if (item.local_path) void copyText(item.local_path, 'Dosya yolu');
                              }}
                            >
                              <Copy className="size-3.5" /> Dosya yolunu kopyala
                            </MenuItem>
                          )}
                          {(onConvert && item.local_path) || onOpenItem ? <MenuSeparator /> : null}
                          {onConvert && item.local_path && (
                            <MenuItem onClick={() => onConvert(item)}>
                              <Scissors className="size-3.5" /> Dönüştür / Kırp
                            </MenuItem>
                          )}
                          {onOpenItem && (
                            <MenuItem onClick={() => onOpenItem(item)}>
                              <Pencil className="size-3.5" /> Kaydı Aç
                            </MenuItem>
                          )}
                        </MenuContent>
                      </Menu>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Medyayı Sil (Listeden / Bilgisayardan)"
                        aria-label="Medyayı sil"
                        onClick={() => {
                          setVaultItemsToDelete([item]);
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
          <div className="mb-6 flex flex-col gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                title="Kayıtları listeden siler; dosyalar diskte kalır"
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Tamamlananları Temizle
              </Button>
            </div>

            {/* Sıralama + canlı arama */}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      aria-label={`Sırala: ${TURBO_SORT_LABELS[sortBy]}`}
                    />
                  }
                >
                  <ArrowDownUp className="size-3.5" />
                  <span className="text-muted-foreground">Sırala:</span>
                  {TURBO_SORT_LABELS[sortBy]}
                </MenuTrigger>
                <MenuContent align="end" className="min-w-40">
                  {(Object.keys(TURBO_SORT_LABELS) as DownloadSort[]).map((key) => (
                    <MenuItem key={key} onClick={() => setSortBy(key)}>
                      <Check
                        className={
                          sortBy === key ? 'size-3.5 text-primary' : 'size-3.5 opacity-0'
                        }
                      />
                      {TURBO_SORT_LABELS[key]}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
              <div className="relative min-w-0 flex-1 sm:max-w-64">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="İndirmelerde ara…"
                  className="pl-9 text-sm"
                />
              </div>
            </div>
          </div>

          {/* SEKME VE KATEGORİ FİLTRELERİ */}
          <div className="mb-5 flex flex-col gap-3 border-b border-border/60 pb-4">
            {/* Durum Sekmeleri */}
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
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
                  className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap transition ${
                    statusFilter === tab.id
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-2xs">
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Kategori Filtresi */}
            <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
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
                  className={`shrink-0 rounded-full px-2.5 py-1 whitespace-nowrap transition ${
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

          {selectedJobObjects.length > 0 && (
            <div className="settings-card mb-3 flex flex-wrap items-center gap-2 px-3 py-2">
              <span data-num className="text-xs font-medium">{selectedJobObjects.length} seçili</span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-2xs"
                  onClick={() => void handleResumeSelected()}
                  disabled={
                    !selectedJobObjects.some((j) => j.status === 'paused' || j.status === 'error')
                  }
                >
                  <Play className="size-3 text-emerald-500" /> Başlat
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-2xs"
                  onClick={() => void handlePauseSelected()}
                  disabled={!selectedJobObjects.some((j) => j.status === 'active')}
                >
                  <Pause className="size-3 text-amber-500" /> Duraklat
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-2xs"
                  onClick={() => setSelectedJobs(new Set())}
                >
                  Vazgeç
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-7 gap-1 text-2xs"
                  onClick={() => {
                    setTurboJobsToDelete(selectedJobObjects);
                    setDeleteTurboDiskFile(true);
                  }}
                >
                  <Trash2 className="size-3" /> Sil
                </Button>
              </div>
            </div>
          )}

          {!loading && filteredJobs.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-2xs text-muted-foreground">
              <input
                type="checkbox"
                checked={allJobsSelected}
                onChange={toggleAllJobs}
                aria-label="Görünen indirmelerin tümünü seç"
                className="size-3.5 shrink-0 cursor-pointer rounded-2xs border-border"
              />
              <span data-num className="whitespace-nowrap">
                {filteredJobs.length} indirme
                {filteredJobs.length !== jobs.length ? ` (${jobs.length} içinden)` : ''}
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      activeCount > 0 ? 'animate-pulse bg-emerald-500' : 'bg-muted-foreground/30'
                    }`}
                  />
                  <span data-num>{formatSpeed(totalSpeed)}</span>
                  {dlSettings && (
                    <span data-num className="text-muted-foreground/70">
                      {activeCount}/{dlSettings.max_concurrent} eşzamanlı
                    </span>
                  )}
                  {dlSettings && dlSettings.speed_limit_bps > 0 && (
                    <span data-num className="text-muted-foreground/70">
                      sınır {formatSpeed(dlSettings.speed_limit_bps)}
                    </span>
                  )}
                </span>
                <span data-num className="whitespace-nowrap">
                  Toplam boyut: {formatBytes(filteredTotalSize)}
                </span>
              </span>
            </div>
          )}

          {/* İNDİRME LİSTESİ / KARTLARI */}
          {loading ? (
            <p className="py-16 text-center text-sm text-muted-foreground">İndirmeler yükleniyor…</p>
          ) : filteredJobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-16 text-center">
              <Download className="mx-auto mb-3 size-10 text-muted-foreground/50" />
              <p className="text-base font-semibold">Aktif veya kayıtlı indirme bulunamadı</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                Bağlantıyı yapıştır, kalanını motor halleder. Panoya kopyaladığın bağlantı da
                yakalanır.
              </p>
              <Button size="sm" className="mt-4 gap-1.5" onClick={() => setQuickOpen(true)}>
                <Plus className="size-3.5" /> Yeni İndirme Ekle
              </Button>
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
                    className={`settings-card group flex flex-col gap-3 p-4 transition hover:border-primary/40 ${
                      selectedJobs.has(job.id) ? 'border-primary/60' : ''
                    }`}
                  >
                    {/* ÜST SATIR: SEÇİM + İKON + DOSYA ADI + METRİKLER + AKSİYONLAR */}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedJobs.has(job.id)}
                          onChange={() => toggleJobSelection(job.id)}
                          aria-label={`${job.filename} seç`}
                          className="size-3.5 shrink-0 cursor-pointer rounded-2xs border-border"
                        />
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 border border-border/40">
                          {getCategoryIcon(job.category)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
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

                      {/* Durum & Butonlar — buton kümesi sabit genişlikte, sağa hizalı. */}
                      <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                        <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                          {job.status === 'active' && formatSpeed(job.speed_bps)}
                          {job.status === 'active' && job.eta_secs > 0 && ` · ${formatEta(job.eta_secs)}`}
                        </span>

                        <div className="flex items-center justify-end gap-2 sm:min-w-[13.75rem]">
                          {/* Dosya konumu: tamamlanmışsa Gezgin'de seçer, sürüyorsa kökü açar. */}
                          {job.status === 'completed' ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Klasörde göster"
                              title="Klasörde göster"
                              onClick={() => reveal(job.destination_path)}
                            >
                              <FolderOpen className="size-3.5 text-muted-foreground" />
                            </Button>
                          ) : downloadDir ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="İndirme klasörünü aç"
                              title="İndirme klasörünü aç"
                              onClick={() => open(downloadDir)}
                            >
                              <FolderOpen className="size-3.5 text-muted-foreground" />
                            </Button>
                          ) : null}

                          {job.status === 'completed' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1 text-xs"
                              aria-label="Dosyayı aç"
                              onClick={() => open(job.destination_path)}
                            >
                              <ExternalLink className="size-3.5" /> Dosyayı Aç
                            </Button>
                          )}

                          {job.status === 'active' && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => void handlePause(job)}
                              title="Duraklat"
                              aria-label="Duraklat"
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
                              aria-label="Devam et"
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
                              aria-label="Tekrar dene"
                            >
                              <Play className="size-3.5 text-primary" />
                            </Button>
                          )}

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
                            <MenuContent align="end" className="min-w-44">
                              <MenuItem onClick={() => void copyText(job.url, 'Bağlantı')}>
                                <Link2 className="size-3.5" /> Bağlantıyı kopyala
                              </MenuItem>
                              <MenuItem
                                onClick={() => void copyText(job.destination_path, 'Dosya yolu')}
                              >
                                <Copy className="size-3.5" /> Dosya yolunu kopyala
                              </MenuItem>
                              {errorText && (
                                <>
                                  <MenuSeparator />
                                  <MenuItem onClick={() => void copyText(errorText, 'Hata ayrıntısı')}>
                                    <Copy className="size-3.5" /> Hata ayrıntısını kopyala
                                  </MenuItem>
                                </>
                              )}
                            </MenuContent>
                          </Menu>

                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => {
                              setTurboJobsToDelete([job]);
                              setDeleteTurboDiskFile(true);
                            }}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            title="İndirmeyi Sil (Listeden / Bilgisayardan)"
                            aria-label="İndirmeyi sil"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
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

                      <div className="flex items-center justify-between gap-3 font-mono text-2xs text-muted-foreground">
                        <span className="shrink-0">
                          {formatBytes(job.downloaded_size)} /{' '}
                          {job.file_size > 0 ? formatBytes(job.file_size) : 'Bilinmeyen'} (%{pct.toFixed(1)})
                        </span>
                        <span className="min-w-0 max-w-[17.5rem] truncate" title={job.destination_path}>
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

      {/* ARŞİV MEDYASI SİLME DİYALOĞU (tek veya toplu) */}
      <Dialog
        open={vaultItemsToDelete.length > 0}
        onOpenChange={(open) => {
          if (!open && !vaultDeleteBusy) setVaultItemsToDelete([]);
        }}
      >
        <DialogContent className="max-w-md gap-4 p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-destructive">
              <Trash2 className="size-5" />
              {vaultItemsToDelete.length === 1
                ? 'İndirilen Medyayı Sil'
                : `${vaultItemsToDelete.length} Medyayı Sil`}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {vaultItemsToDelete.length === 1
                ? `"${vaultItemsToDelete[0]?.title || vaultItemsToDelete[0]?.url}" için silme seçeneklerini belirleyin.`
                : `${vaultItemsToDelete.length} indirilmiş medya için silme seçeneklerini belirleyin.`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-1">
            <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-xs">
              <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                Dosya Konumu
              </span>
              {vaultItemsToDelete.length === 1 ? (
                <p className="font-mono text-2xs break-all text-foreground select-all">
                  {vaultItemsToDelete[0]?.local_path ?? vaultItemsToDelete[0]?.url}
                </p>
              ) : (
                vaultItemsToDelete.slice(0, 4).map((item) => (
                  <p
                    key={item.id}
                    className="truncate text-2xs text-foreground"
                    title={item.local_path ?? item.url}
                  >
                    {item.title ?? item.local_path ?? item.url}
                  </p>
                ))
              )}
              {vaultItemsToDelete.length > 4 && (
                <p data-num className="mt-1 text-2xs text-muted-foreground">
                  +{vaultItemsToDelete.length - 4} medya daha
                </p>
              )}
            </div>

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
              onClick={() => setVaultItemsToDelete([])}
              disabled={vaultDeleteBusy}
            >
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleConfirmDeleteVaultItems()}
              disabled={vaultDeleteBusy}
              className="gap-1.5"
            >
              <Trash2 className="size-3.5" />
              {vaultDeleteBusy
                ? 'Siliniyor…'
                : vaultItemsToDelete.length === 1
                  ? 'Medyayı Sil'
                  : `${vaultItemsToDelete.length} Medyayı Sil`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TURBO İNDİRME SİLME DİYALOĞU (tek veya toplu) */}
      <Dialog
        open={turboJobsToDelete.length > 0}
        onOpenChange={(open) => {
          if (!open && !turboDeleteBusy) setTurboJobsToDelete([]);
        }}
      >
        <DialogContent className="max-w-md gap-4 p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-destructive">
              <Trash2 className="size-5" />
              {turboJobsToDelete.length === 1
                ? 'Turbo İndirmeyi Sil'
                : `${turboJobsToDelete.length} İndirmeyi Sil`}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {turboJobsToDelete.length === 1
                ? `"${turboJobsToDelete[0]?.filename}" indirme görevi listeden kaldırılacak.`
                : `${turboJobsToDelete.length} indirme görevi listeden kaldırılacak.`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-1">
            <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-xs">
              <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground block mb-1">
                Hedef Dosya Konumu
              </span>
              {turboJobsToDelete.length === 1 ? (
                <p className="font-mono text-2xs break-all text-foreground select-all">
                  {turboJobsToDelete[0]?.destination_path}
                </p>
              ) : (
                turboJobsToDelete.slice(0, 4).map((job) => (
                  <p
                    key={job.id}
                    className="truncate text-2xs text-foreground"
                    title={job.destination_path}
                  >
                    {job.filename}
                  </p>
                ))
              )}
              {turboJobsToDelete.length > 4 && (
                <p data-num className="mt-1 text-2xs text-muted-foreground">
                  +{turboJobsToDelete.length - 4} dosya daha
                </p>
              )}
            </div>

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
              onClick={() => setTurboJobsToDelete([])}
              disabled={turboDeleteBusy}
            >
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleConfirmDeleteTurboJobs()}
              disabled={turboDeleteBusy}
              className="gap-1.5"
            >
              <Trash2 className="size-3.5" />
              {turboDeleteBusy
                ? 'Siliniyor…'
                : turboJobsToDelete.length === 1
                  ? 'İndirmeyi Sil'
                  : `${turboJobsToDelete.length} İndirmeyi Sil`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSurface>
  );
}
