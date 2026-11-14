import { useCallback, useEffect, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  FolderOpen,
  History,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { useNotice } from '@/components/ui/notice';
import { clearConversionHistory, listConversionHistory } from '@/lib/db/client';
import type { ConversionJobRow, ConversionStatus } from '@/lib/db/types';
import { basenameOf } from '@/lib/convert-path';
import { useOpenTarget } from '@/lib/open-target';

const STATUS_MARK: Record<ConversionStatus, React.ComponentType<{ className?: string }>> = {
  done: CheckCircle2,
  error: XCircle,
  cancelled: Ban,
};

const STATUS_LABEL: Record<ConversionStatus, string> = {
  done: 'tamamlandı',
  error: 'hata',
  cancelled: 'iptal',
};

const STATUS_CLASS: Record<ConversionStatus, string> = {
  done: 'text-state-acquired',
  error: 'text-state-error',
  cancelled: 'text-muted-foreground',
};

const DATE_FORMAT = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

interface ConversionHistoryProps {
  refreshKey: number;
}

export function ConversionHistory({ refreshKey }: ConversionHistoryProps) {
  const notice = useNotice();
  const { reveal } = useOpenTarget();
  const [rows, setRows] = useState<ConversionJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setFailed(false);
    try {
      setRows(await listConversionHistory(50));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const clear = async (): Promise<void> => {
    try {
      await clearConversionHistory();
      setRows([]);
      notice.push({ text: 'Dönüşüm geçmişi temizlendi.', tone: 'info' });
    } catch {
      notice.push({ text: 'Geçmiş temizlenemedi.', tone: 'error' });
    }
  };

  return (
    <section className="settings-card flex flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border/70 p-4">
        <div>
          <h3 className="text-sm font-medium">Dönüşüm geçmişi</h3>
          <p className="text-micro text-muted-foreground">
            Son 50 iş; uygulama yeniden açıldığında da kalır.
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={rows.length === 0}
        >
          <Trash2 /> Temizle
        </Button>
      </header>

      {loading ? (
        <div className="flex flex-col gap-2 p-4" aria-label="Geçmiş yükleniyor">
          <span className="skeleton-paper h-9 w-full rounded-sm" />
          <span className="skeleton-paper h-9 w-full rounded-sm" />
          <span className="skeleton-paper h-9 w-2/3 rounded-sm" />
        </div>
      ) : failed ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <History className="size-7 text-muted-foreground" />
          <p className="text-title">Geçmiş okunamadı</p>
          <p className="text-sm text-muted-foreground">Veritabanına erişilemedi.</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Yeniden dene
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <History className="size-7 text-muted-foreground" />
          <p className="text-title">Henüz dönüşüm yok</p>
          <p className="max-w-[38ch] text-sm text-muted-foreground">
            Bir dosya dönüştürdüğünde iş burada listelenir; çıktıyı tek tıkla klasöründe
            gösterebilirsin.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border/70">
          {rows.map((row) => {
            const Mark = STATUS_MARK[row.status];
            const output = row.output_paths[0];
            return (
              <li key={row.id} className="flex items-center gap-2 px-4 py-2.5">
                <Mark className={`size-4 shrink-0 ${STATUS_CLASS[row.status]}`} aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm">{basenameOf(row.input_path)}</span>
                    <Badge variant="outline">.{row.target}</Badge>
                    {row.status !== 'done' && (
                      <span className="shrink-0 text-2xs text-muted-foreground">
                        {STATUS_LABEL[row.status]}
                      </span>
                    )}
                  </span>
                  <span className="truncate font-mono text-2xs text-muted-foreground">
                    {row.error_message ?? row.input_path}
                  </span>
                </div>
                {output && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => reveal(output)}
                    aria-label={`${basenameOf(output)} dosyasını klasörde göster`}
                    title="Klasörde göster"
                  >
                    <FolderOpen />
                  </Button>
                )}
                <span data-num className="w-[86px] shrink-0 text-right font-mono text-2xs text-muted-foreground">
                  {DATE_FORMAT.format(new Date(row.created_at))}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Dönüşüm geçmişi silinsin mi?"
        description="Yalnızca geçmiş kayıtları silinir; üretilen dosyalar diskte kalır."
        confirmLabel="Temizle"
        onConfirm={() => {
          setConfirmOpen(false);
          void clear();
        }}
      />
    </section>
  );
}
