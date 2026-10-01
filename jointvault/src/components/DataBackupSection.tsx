/*
 * Kasa yedekleri (veritabanı düzeyi).
 *
 * JSON dışa aktarmadan farkı: bu bölüm kasanın TAMAMINI (şema + tüm tablolar)
 * kapsar ve OTOMATİK çalışır — açılışta günde bir, her göçten önce zorunlu.
 *
 * Geri dönme ve sıfırlama uygulamayı YENİDEN BAŞLATIR: geri yükleme sonrası
 * bellekteki her şey bayattır ve yarı-bayat bir arayüz göstermek, işlemin
 * başarısız olduğu izlenimi verirdi.
 */
import { useCallback, useEffect, useState } from 'react';
import { Database, FolderOpen, Save, TriangleAlert } from 'lucide-react';
import { BackupList } from '@/components/BackupList';
import { ResetDatabaseDialog } from '@/components/ResetDatabaseDialog';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { useNotice } from '@/components/ui/notice';
import { describeError } from '@/lib/errors';
import { useOpenTarget } from '@/lib/open-target';
import { backupsPath, createBackup, listBackups, resetDatabase, restoreBackup, type BackupInfo } from '@/lib/db/backup';
import { closeDb, getDb } from '@/lib/db/client';

/** Geri yükleme/sıfırlama sonrası temiz durum: bellekteki veri artık geçersiz. */
const restartApp = (): void => window.location.reload();

export function DataBackupSection() {
  const notice = useNotice();
  const { reveal } = useOpenTarget();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setBackups(await listBackups());
    } catch (error) {
      notice.push({ text: `Yedekler okunamadı: ${describeError(error)}`, tone: 'error' });
    }
  }, [notice]);

  useEffect(() => {
    void load();
  }, [load]);

  const fail = (prefix: string, error: unknown): void => {
    notice.push({ text: `${prefix}: ${describeError(error)}`, tone: 'error' });
    setBusy(false);
  };

  const handleBackupNow = async (): Promise<void> => {
    setBusy(true);
    try {
      const name = await createBackup(await getDb());
      notice.push({ text: `Yedek alındı: ${name}`, tone: 'ok' });
      await load();
      setBusy(false);
    } catch (error) {
      fail('Yedek alınamadı', error);
    }
  };

  const handleRestore = async (): Promise<void> => {
    const name = restoreTarget;
    setRestoreTarget(null);
    if (!name) return;
    setBusy(true);
    try {
      /* Açık SQLite dosyası kilitlidir: üzerine yazmadan önce havuz kapanmalı. */
      await closeDb();
      await restoreBackup(name);
      restartApp();
    } catch (error) {
      fail('Geri dönülemedi', error);
    }
  };

  const handleReset = async (): Promise<void> => {
    setResetOpen(false);
    setBusy(true);
    try {
      /* Zorunlu adım: sıfırlamadan önce yedek. */
      await createBackup(await getDb());
      await closeDb();
      await resetDatabase();
      restartApp();
    } catch (error) {
      fail('Sıfırlanamadı', error);
    }
  };

  return (
    <div className="settings-card flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Database className="size-4" /> Kasa yedekleri
        </h3>
        <p className="text-xs text-muted-foreground">
          Şema ve tüm tablolar dahil tam kopya. Açılışta günde bir, her şema güncellemesinden önce bir kez ve
          istediğinde elle alınır. Son <span data-num>5</span> yedek saklanır.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void handleBackupNow()} disabled={busy}>
          <Save className="size-3.5" /> Şimdi yedekle
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => void backupsPath().then(reveal)}
        >
          <FolderOpen className="size-3.5" /> Yedek klasörünü aç
        </Button>
      </div>

      <BackupList backups={backups} busy={busy} onRestore={setRestoreTarget} />

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          Sıfırlama kasayı boşaltır. Önce otomatik yedek alınır, ama geri dönmek yine de elle bir adımdır.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-fit border-destructive/40 text-destructive"
          disabled={busy}
          onClick={() => setResetOpen(true)}
        >
          Veritabanını sıfırla
        </Button>
      </div>

      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        title="Bu yedekten geri dönülsün mü?"
        description={`${restoreTarget ?? ''} kasanın yerine geçecek. Mevcut kasa önce otomatik olarak saklanır.`}
        confirmLabel="Geri dön"
        onConfirm={() => void handleRestore()}
      />
      <ResetDatabaseDialog
        key={resetOpen ? 'acik' : 'kapali'}
        open={resetOpen}
        onOpenChange={setResetOpen}
        onConfirm={handleReset}
        busy={busy}
      />
    </div>
  );
}
