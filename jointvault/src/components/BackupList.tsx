/*
 * Yedek listesi.
 *
 * Ayrı bileşen: hem satır biçimi tek yerde kalsın hem de bölüm bileşeni
 * okunur boyutta tutulsun.
 */
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BackupInfo } from '@/lib/db/backup';

export interface BackupListProps {
  backups: BackupInfo[];
  busy: boolean;
  onRestore: (name: string) => void;
}

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

const formatDate = (ms: number): string => new Date(ms).toLocaleString('tr-TR');

export function BackupList({ backups, busy, onRestore }: BackupListProps) {
  if (backups.length === 0) {
    return <p className="text-xs text-muted-foreground">Henüz yedek yok.</p>;
  }

  return (
    <div className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border">
      {backups.map((backup) => (
        <div key={backup.name} className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-mono text-2xs">{backup.name}</span>
            <span className="text-2xs text-muted-foreground">
              <span data-num>{formatSize(backup.size_bytes)}</span> ·{' '}
              <span data-num>{formatDate(backup.modified_ms)}</span>
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5"
            disabled={busy}
            onClick={() => onRestore(backup.name)}
          >
            <RotateCcw className="size-3.5" /> Geri dön
          </Button>
        </div>
      ))}
    </div>
  );
}
