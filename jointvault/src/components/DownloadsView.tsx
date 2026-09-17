import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCode,
  FileText,
  Film,
  FolderOpen,
  Music,
  Package,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
  Zap,
} from 'lucide-react';
import { QuickDownloadDialog } from '@/components/QuickDownloadDialog';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
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
import {
  clearCompletedDownloads,
  createDownloadJob,
  detectCategoryFromFilename,
  listDownloadJobs,
  removeDownloadJob,
  updateDownloadJob,
  type DownloadCategory,
  type DownloadJob,
  type DownloadStatus,
} from '@/lib/db/client';
import { formatBytes } from '@/lib/downloads';
import {
  cancelTurboDownload,
  formatEta,
  formatSpeed,
  pauseTurboDownload,
  startTurboDownload,
  useTurboProgressListener,
  type ChunkProgress,
  type TurboProgressPayload,
} from '@/lib/turbo_download';

export interface DownloadsViewProps {
  onClose?: () => void;
}

type FilterStatus = 'all' | 'active' | 'queued' | 'completed' | 'paused' | 'error';
type FilterCategory = 'all' | DownloadCategory;

export function DownloadsView({ onClose }: DownloadsViewProps) {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtreler
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<FilterCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Canlı Parça (Chunk) Durumları (Hafızada tutulur: jobId -> chunks[])
  const [liveChunks, setLiveChunks] = useState<Record<string, ChunkProgress[]>>({});

  // Diyaloglar
  const [quickOpen, setQuickOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchUrls, setBatchUrls] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const reloadJobs = async () => {
    try {
      setLoading(true);
      const list = await listDownloadJobs();
      setJobs(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reloadJobs();
  }, []);

  // Canlı İlerleme Dinleyicisi
  const handleProgress = useCallback((payload: TurboProgressPayload) => {
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

    // Durum değişimlerini DB'ye periyodik kaydet
    if (payload.status === 'completed' || payload.status === 'paused' || payload.status === 'error') {
      void updateDownloadJob(payload.job_id, {
        status: payload.status as DownloadStatus,
        downloaded_size: payload.downloaded_size,
        speed_bps: 0,
        eta_secs: 0,
        error_message: payload.error ?? null,
      });
    }
  }, []);

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
    await updateDownloadJob(job.id, { status: 'active', error_message: null });
    await startTurboDownload({
      jobId: job.id,
      url: job.url,
      filename: job.filename,
      destinationPath: job.destination_path,
      fileSize: job.file_size,
      threads: job.threads,
    });
  };

  const handleCancel = async (jobId: string) => {
    await cancelTurboDownload(jobId);
    await removeDownloadJob(jobId);
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    setPendingDelete(null);
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
    <div className="flex min-h-screen flex-col bg-background px-6 py-8 text-foreground md:px-10">
      {/* ÜST BAŞLIK VE HIZ GÖSTERGESİ */}
      <div className="mb-6 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Zap className="size-5" />
            </span>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">İndirme Yöneticisi</h1>
              <Badge variant="outline" className="text-xs font-mono font-normal">
                IDM Turbo Engine
              </Badge>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Çok kanallı paralel parçalı indirme motoru ile dosyalarınızı en yüksek hızda indirin ve yönetin.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Toplam Canlı Hız */}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3.5 py-1.5 shadow-xs">
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
          </div>

          {onClose && (
            <Button variant="outline" size="sm" onClick={onClose}>
              <ArrowLeft className="mr-1.5 size-4" /> Kasaya Dön
            </Button>
          )}
        </div>
      </div>

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

            return (
              <div
                key={job.id}
                className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xs transition hover:border-primary/40"
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
                          <Badge variant="outline" className="font-mono text-2xs px-1.5 py-0">
                            {job.threads} Kanal
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-2xs font-mono text-muted-foreground/80 mt-0.5" title={job.url}>
                        {job.url}
                      </p>
                    </div>
                  </div>

                  {/* Durum & Metrikler */}
                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <div className="flex flex-col items-end text-right font-mono text-xs">
                      {job.status === 'active' ? (
                        <>
                          <span className="font-semibold text-primary">{formatSpeed(job.speed_bps)}</span>
                          <span className="text-2xs text-muted-foreground">Kalan: {formatEta(job.eta_secs)}</span>
                        </>
                      ) : job.status === 'completed' ? (
                        <span className="flex items-center gap-1 text-emerald-500 font-medium text-xs">
                          <CheckCircle2 className="size-3.5" /> Tamamlandı
                        </span>
                      ) : job.status === 'paused' ? (
                        <span className="text-amber-500 text-xs font-medium">Duraklatıldı</span>
                      ) : job.status === 'queued' ? (
                        <span className="text-muted-foreground text-xs font-medium">Kuyrukta</span>
                      ) : (
                        <span className="text-destructive text-xs font-medium flex items-center gap-1">
                          <AlertCircle className="size-3" /> Hata
                        </span>
                      )}
                    </div>

                    {/* Aksiyon Düğmeleri */}
                    <div className="flex items-center gap-1">
                      {job.status === 'active' && (
                        <Button
                          size="icon"
                          variant="outline"
                          className="size-8 text-amber-500 hover:text-amber-600"
                          onClick={() => void handlePause(job)}
                          title="Duraklat"
                        >
                          <Pause className="size-3.5" />
                        </Button>
                      )}

                      {(job.status === 'paused' || job.status === 'queued' || job.status === 'error') && (
                        <Button
                          size="icon"
                          variant="outline"
                          className="size-8 text-emerald-500 hover:text-emerald-600"
                          onClick={() => void handleResume(job)}
                          title="Devam Et"
                        >
                          <Play className="size-3.5" />
                        </Button>
                      )}

                      {job.status === 'completed' && (
                        <>
                          <Button
                            size="icon"
                            variant="outline"
                            className="size-8 text-primary"
                            onClick={() => void openPath(job.destination_path)}
                            title="Dosyayı Aç"
                          >
                            <ExternalLink className="size-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            className="size-8 text-muted-foreground hover:text-foreground"
                            onClick={() => void revealItemInDir(job.destination_path)}
                            title="Klasörde Göster"
                          >
                            <FolderOpen className="size-3.5" />
                          </Button>
                        </>
                      )}

                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDelete(job.id)}
                        title="İndirmeyi Sil"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* İLERLEME ÇUBUĞU & BOYUT BİLGİSİ */}
                <div className="flex flex-col gap-1.5">
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

                {/* IDM SEGMENT / PARALEL KANAL DOLUM GÖSTERGESİ */}
                {job.status === 'active' && chunks.length > 1 && (
                  <div className="flex flex-col gap-1 rounded-lg border border-border/50 bg-muted/20 p-2">
                    <div className="flex items-center justify-between text-2xs text-muted-foreground">
                      <span className="font-semibold text-foreground flex items-center gap-1">
                        <Zap className="size-3 text-primary" /> Çok Kanallı Parça Akışı ({chunks.length} Segment)
                      </span>
                      <span>IDM Paralel Hızlandırıcı</span>
                    </div>

                    <div className="grid grid-cols-4 sm:grid-cols-8 md:grid-cols-16 gap-1 mt-1">
                      {chunks.map((ch) => (
                        <div
                          key={ch.id}
                          className="flex flex-col items-center gap-0.5 rounded bg-card p-1 border border-border/60"
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

                {job.error_message && (
                  <p className="text-xs text-destructive bg-destructive/10 p-2 rounded-md font-mono">
                    Hata: {job.error_message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
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

      {/* SİLME ONAY DİYALOĞU */}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="İndirme kaydı silinsin mi?"
        description="İndirme yöneticisindeki kayıt silinecektir."
        confirmLabel="Sil"
        tone="destructive"
        onConfirm={() => {
          if (pendingDelete) void handleCancel(pendingDelete);
        }}
      />
    </div>
  );
}
