import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  Archive,
  Check,
  Download,
  FileCode,
  FileText,
  Film,
  Folder,
  Music,
  Package,
  Zap,
} from 'lucide-react';
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
import { Select } from '@/components/ui/select';
import {
  createDownloadJob,
  detectCategoryFromFilename,
  type DownloadCategory,
} from '@/lib/db/client';
import { formatBytes } from '@/lib/downloads';
import { probeUrl, startTurboDownload, type ProbeResult } from '@/lib/turbo_download';

interface QuickDownloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialUrl?: string;
  onStarted?: (jobId: string) => void;
}

const THREAD_OPTIONS = [
  { value: '4', label: '4 Kanal (Hafif)' },
  { value: '8', label: '8 Kanal (Dengeli - Önerilen)' },
  { value: '16', label: '16 Kanal (Turbo - Yüksek Hız)' },
  { value: '32', label: '32 Kanal (Maksimum Agresif)' },
];

export function QuickDownloadDialog({
  open,
  onOpenChange,
  initialUrl = '',
  onStarted,
}: QuickDownloadDialogProps) {
  const [url, setUrl] = useState(initialUrl);
  const [probing, setProbing] = useState(false);
  const [probeData, setProbeData] = useState<ProbeResult | null>(null);
  const [filename, setFilename] = useState('');
  const [destDir, setDestDir] = useState('');
  const [threads, setThreads] = useState('16');
  const [category, setCategory] = useState<DownloadCategory>('other');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // İndirme klasörünü varsayılandan çek
  useEffect(() => {
    if (open) {
      void invoke<string>('get_download_dir').then((d) => setDestDir(d)).catch(() => {});
      if (initialUrl) {
        setUrl(initialUrl);
        void handleProbe(initialUrl);
      } else {
        setUrl('');
        setProbeData(null);
        setFilename('');
        setError(null);
      }
    }
  }, [open, initialUrl]);

  const handleProbe = async (targetUrl: string) => {
    if (!targetUrl.trim() || !targetUrl.startsWith('http')) return;
    setProbing(true);
    setError(null);
    try {
      const res = await probeUrl(targetUrl.trim());
      setProbeData(res);
      setFilename(res.filename);
      const cat = detectCategoryFromFilename(res.filename);
      setCategory(cat);
      if (!res.accepts_ranges) {
        setThreads('1');
      }
    } catch (e) {
      setError(typeof e === 'string' ? e : 'Dosya bilgileri okunamadı.');
    } finally {
      setProbing(false);
    }
  };

  const pickFolder = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: destDir || undefined,
      });
      if (selected && typeof selected === 'string') {
        setDestDir(selected);
      }
    } catch {
      // ignore
    }
  };

  const handleStart = async (startImmediately: boolean) => {
    if (!url.trim() || !filename.trim()) return;
    setBusy(true);
    try {
      const targetDir = destDir || (await invoke<string>('get_download_dir'));
      const fullPath = `${targetDir.replace(/[/\\]+$/, '')}/${filename}`;
      const threadCount = Number.parseInt(threads, 10) || 8;

      const job = await createDownloadJob({
        url: url.trim(),
        filename: filename.trim(),
        destination_path: fullPath,
        file_size: probeData?.file_size ?? 0,
        threads: threadCount,
        category,
        status: startImmediately ? 'active' : 'queued',
      });

      if (startImmediately) {
        await startTurboDownload({
          jobId: job.id,
          url: job.url,
          filename: job.filename,
          destinationPath: job.destination_path,
          fileSize: job.file_size,
          threads: threadCount,
        });
      }

      onOpenChange(false);
      onStarted?.(job.id);
    } catch (e) {
      setError(typeof e === 'string' ? e : 'İndirme başlatılamadı.');
    } finally {
      setBusy(false);
    }
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4 p-6 sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Zap className="size-5" />
            </span>
            <div>
              <DialogTitle className="text-lg">Turbo Hızlı İndirme (IDM)</DialogTitle>
              <DialogDescription className="text-xs">
                Çok kanallı paralel parçalı indirme motoru ile maksimum hızda indirin.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3.5 py-1">
          {/* URL Girişi */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">İndirme Bağlantısı (URL)</label>
            <div className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={() => void handleProbe(url)}
                placeholder="https://.../dosya.zip"
                className="text-sm font-mono"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleProbe(url)}
                disabled={probing || !url.trim()}
              >
                {probing ? 'Taranıyor…' : 'Sına'}
              </Button>
            </div>
          </div>

          {/* Dosya Bilgi Kartı */}
          {probeData && (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/40 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {getCategoryIcon(category)}
                  <span className="font-semibold text-foreground truncate max-w-[240px]">
                    {probeData.filename}
                  </span>
                </div>
                <Badge variant="outline" className="font-mono text-2xs">
                  {probeData.file_size > 0 ? formatBytes(probeData.file_size) : 'Bilinmeyen Boyut'}
                </Badge>
              </div>

              <div className="flex items-center gap-2 text-muted-foreground text-2xs">
                {probeData.accepts_ranges ? (
                  <span className="flex items-center gap-1 text-emerald-500 font-medium">
                    <Check className="size-3" /> Çok kanallı paralel hızlandırma destekleniyor
                  </span>
                ) : (
                  <span className="text-amber-500 font-medium">
                    Sunucu parça desteği vermiyor (Tek kanal indirilecek)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Dosya Adı */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Dosya Adı Olarak Kaydet</label>
            <Input
              value={filename}
              onChange={(e) => {
                setFilename(e.target.value);
                setCategory(detectCategoryFromFilename(e.target.value));
              }}
              placeholder="dosya.zip"
              className="text-sm"
            />
          </div>

          {/* Hedef Klasör */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Hedef Klasör</label>
            <div className="flex gap-2">
              <Input value={destDir} readOnly className="text-xs font-mono truncate" />
              <Button variant="outline" size="sm" onClick={() => void pickFolder()}>
                <Folder className="size-3.5 mr-1" /> Seç
              </Button>
            </div>
          </div>

          {/* Kanal / Thread Sayısı */}
          {(!probeData || probeData.accepts_ranges) && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <div>
                <p className="text-xs font-medium text-foreground">Paralel Bağlantı (Kanal Sayısı)</p>
                <p className="text-2xs text-muted-foreground">
                  IDM gibi dosyayı parçalara bölerek aynı anda indirir.
                </p>
              </div>
              <div className="w-48">
                <Select
                  label="Kanal Sayısı"
                  value={threads}
                  onValueChange={setThreads}
                  options={THREAD_OPTIONS}
                  size="sm"
                />
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive bg-destructive/10 p-2 rounded-md">{error}</p>}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleStart(false)}
            disabled={busy || !filename.trim()}
          >
            Kuyruğa Ekle
          </Button>
          <Button
            size="sm"
            onClick={() => void handleStart(true)}
            disabled={busy || !filename.trim()}
            className="gap-1.5"
          >
            <Download className="size-4" /> Hemen İndir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
