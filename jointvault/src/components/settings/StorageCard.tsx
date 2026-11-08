import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { listDownloadedItems, listDownloadJobs } from '@/lib/db/client';
import { formatBytes } from '@/lib/downloads';
import { describeError } from '@/lib/errors';
import { normalizePath, scanStorage, type StorageFile } from '@/lib/storage';

export function StorageCard() {
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalSize, setTotalSize] = useState(0);
  const [orphans, setOrphans] = useState<StorageFile[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const scan = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const [files, items, jobs] = await Promise.all([
        scanStorage(),
        listDownloadedItems(),
        listDownloadJobs(),
      ]);
      const known = new Set<string>();
      for (const item of items) {
        if (item.local_path) known.add(normalizePath(item.local_path));
        if (item.converted_path) known.add(normalizePath(item.converted_path));
      }
      for (const job of jobs) known.add(normalizePath(job.destination_path));
      setTotalSize(files.reduce((sum, f) => sum + f.size, 0));
      setOrphans(files.filter((f) => !known.has(normalizePath(f.path))));
      setActiveCount(
        items.filter((i) => i.download_status === 'active' || i.download_status === 'queued')
          .length,
      );
      setScanned(true);
    } catch (e) {
      setError(describeError(e, 'Depolama taranamadı.'));
    } finally {
      setBusy(false);
    }
  };

  const removeOrphans = async (): Promise<void> => {
    if (activeCount > 0) return;
    setConfirmOpen(false);
    setBusy(true);
    setError(null);
    const failures: string[] = [];
    for (const file of orphans) {
      try {
        await invoke('delete_file', { path: file.path });
      } catch (e) {
        failures.push(`${file.path}: ${describeError(e)}`);
      }
    }
    setBusy(false);
    if (failures.length > 0) setError(`Bazı dosyalar silinemedi: ${failures[0]}`);
    await scan();
  };

  const orphanSize = orphans.reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="flex flex-col gap-3 settings-card p-4">
      <div>
        <span className="text-sm font-medium">Depolama</span>
        <p className="text-xs text-muted-foreground">
          İndirme klasöründeki dosyaları arşiv kayıtlarıyla karşılaştırır; hiçbir kayda bağlı
          olmayanları bulur.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void scan()} disabled={busy}>
          {busy ? 'Taranıyor…' : scanned ? 'Yeniden tara' : 'Depolamayı tara'}
        </Button>
        {scanned && (
          <>
            <span data-num className="font-mono text-2xs text-muted-foreground">
              {formatBytes(totalSize)} toplam
            </span>
            <span data-num className="font-mono text-2xs text-muted-foreground">
              {orphans.length} yetim · {formatBytes(orphanSize)}
            </span>
            {orphans.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                className="ml-auto"
                onClick={() => setConfirmOpen(true)}
                disabled={busy || activeCount > 0}
                title={
                  activeCount > 0
                    ? 'Süren indirme varken yetim dosya silinmez.'
                    : 'Yetim dosyaları sil'
                }
              >
                Yetim dosyaları sil
              </Button>
            )}
          </>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {scanned && activeCount > 0 && (
        <p className="text-2xs text-muted-foreground">
          {activeCount} indirme sürüyor; yanlış dosya silmemek için temizlik kilitli.
        </p>
      )}

      {scanned && orphans.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-border/60 bg-muted/30 p-2">
          {orphans.slice(0, 8).map((file) => (
            <p key={file.path} className="truncate font-mono text-2xs text-muted-foreground" title={file.path}>
              {file.path}
            </p>
          ))}
          {orphans.length > 8 && (
            <p data-num className="text-2xs text-muted-foreground">
              +{orphans.length - 8} dosya daha
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`${orphans.length} yetim dosya silinsin mi?`}
        description="Bu dosyalar arşivdeki hiçbir kayda bağlı değil. Silme kalıcıdır ve yalnızca indirme klasöründe çalışır."
        confirmLabel="Sil"
        onConfirm={() => void removeOrphans()}
      />
    </div>
  );
}
