import {
  Ban,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FolderOpen,
  Loader2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { basenameOf } from '@/lib/convert-path';
import { useOpenTarget } from '@/lib/open-target';
import { cn } from 'cn';
import type { RunJobView, RunStatus } from './types';

const STATUS_MARK: Record<RunStatus, React.ComponentType<{ className?: string }>> = {
  queued: Clock3,
  running: Loader2,
  done: CheckCircle2,
  error: XCircle,
  cancelled: Ban,
};

const STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'kuyrukta',
  running: 'dönüştürülüyor',
  done: 'dönüştürüldü',
  error: 'hata',
  cancelled: 'iptal',
};

const STATUS_CLASS: Record<RunStatus, string> = {
  queued: 'text-muted-foreground',
  running: 'text-primary',
  done: 'text-state-acquired',
  error: 'text-state-error',
  cancelled: 'text-muted-foreground',
};

interface ConversionJobsProps {
  jobs: RunJobView[];
  running: boolean;
  onCancel: () => void;
}

export function ConversionJobs({ jobs, running, onCancel }: ConversionJobsProps) {
  const { reveal, open } = useOpenTarget();

  return (
    <section className="settings-card flex min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border/70 p-3">
        <div>
          <h3 className="text-sm font-medium">İşler</h3>
          <p className="text-micro text-muted-foreground">
            {jobs.length === 0
              ? 'Henüz iş yok'
              : `${jobs.filter((job) => job.status === 'done').length}/${jobs.length} tamamlandı`}
          </p>
        </div>
        {running && (
          <Button variant="outline" size="sm" onClick={onCancel}>
            Tümünü iptal et
          </Button>
        )}
      </header>

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <Clock3 className="size-7 text-muted-foreground" />
          <p className="text-title">İş listesi boş</p>
          <p className="max-w-[34ch] text-sm text-muted-foreground">
            Kaynakları seçip hedefi belirledikten sonra “Dönüştür”e bas. İşler sırayla
            çalışır; her satır kendi durumunu ve çıktısını taşır.
          </p>
        </div>
      ) : (
        <ul className="flex max-h-[34rem] flex-col divide-y divide-border/70 overflow-y-auto">
          {jobs.map((job) => {
            const Mark = STATUS_MARK[job.status];
            const output = job.outputs[0];
            return (
              <li key={job.id} className="flex flex-col gap-1.5 px-3 py-2.5">
                <div className="grid grid-cols-[16px_minmax(0,1fr)_96px_40px] items-center gap-2">
                  <Mark
                    className={cn(
                      'size-4 shrink-0',
                      STATUS_CLASS[job.status],
                      job.status === 'running' && 'animate-spin',
                    )}
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm" title={job.path}>
                      {job.name}
                    </span>
                    <span className="truncate font-mono text-2xs text-muted-foreground">
                      → .{job.target} · {STATUS_LABEL[job.status]}
                    </span>
                  </div>
                  <div className="min-w-0">
                    {job.status === 'running' ? (
                      <Progress
                        value={job.percent}
                        readout={false}
                        aria-label={`${job.name} ilerlemesi`}
                      />
                    ) : (
                      <span className="block h-1 rounded-xs bg-muted" aria-hidden />
                    )}
                  </div>
                  <span
                    data-num
                    className={cn('text-right font-mono text-2xs', STATUS_CLASS[job.status])}
                  >
                    {job.status === 'running' ? `%${Math.round(job.percent)}` : '—'}
                  </span>
                </div>

                {job.status === 'running' && job.phase && (
                  <p className="pl-6 text-2xs text-muted-foreground">{job.phase}</p>
                )}
                {job.error && (
                  <p className="pl-6 text-micro text-destructive" role="alert">
                    {job.error}
                  </p>
                )}
                {job.warnings.length > 0 && (
                  <ul className="flex flex-col gap-0.5 pl-6">
                    {job.warnings.map((warning) => (
                      <li key={warning} className="text-2xs text-muted-foreground">
                        {warning}
                      </li>
                    ))}
                  </ul>
                )}
                {output && (
                  <div className="flex items-center gap-1 pl-6">
                    <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
                      {basenameOf(output)}
                    </span>
                    {job.outputs.length > 1 && (
                      <span data-num className="shrink-0 text-2xs text-muted-foreground">
                        +{job.outputs.length - 1}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => reveal(output)}
                      aria-label={`${basenameOf(output)} dosyasını klasörde göster`}
                      title="Klasörde göster"
                    >
                      <FolderOpen />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => open(output)}
                      aria-label={`${basenameOf(output)} çıktısını aç`}
                      title="Çıktıyı aç"
                    >
                      <ExternalLink />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
