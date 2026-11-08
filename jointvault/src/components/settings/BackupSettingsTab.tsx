import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DataBackupSection } from '@/components/DataBackupSection';
import { Button } from '@/components/ui/button';
import { exportVault, importVault } from '@/lib/db/client';

export function BackupSettingsTab() {
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  const doExport = async (): Promise<void> => {
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const data = await exportVault();
      /*
       * Yol RENDERER'DAN GEÇMEZ: dosya seçimini Rust yapar (`export_backup`).
       * Böylece "kullanıcı seçti" iddiası doğrulanabilir kalır — renderer istediği
       * yolu gönderemez.
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
      setBackupMsg(
        typeof e === 'string' ? e : e instanceof Error ? e.message : 'Dışa aktarma başarısız.',
      );
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
      setBackupMsg(
        typeof e === 'string' ? e : e instanceof Error ? e.message : 'İçe aktarma başarısız.',
      );
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <DataBackupSection />
      <div className="flex flex-col gap-4 settings-card p-4">
        <h3 className="text-sm font-medium">Taşınabilir dışa aktarma (JSON)</h3>
        <p className="text-xs text-muted-foreground">
          Tüm kayıtlar JSON olarak dışa aktarılır; içe aktarma mevcutla birleşir, tekrarlar atlanır.
          Medya dosyaları dahil değildir.
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
  );
}
