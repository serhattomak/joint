import { CheckCircle2, ExternalLink, FolderOpen, ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Stamp, type StampState } from '@/components/ui/stamp';
import { basenameOf } from '@/lib/convert-path';
import { useOpenTarget } from '@/lib/open-target';
import type { RunJobView, RunStatus } from './types';

const STATUS_STAMP: Record<RunStatus, StampState> = {
  queued: 'queued',
  running: 'active',
  done: 'converted',
  error: 'error',
  cancelled: 'none',
};

const STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'kuyrukta',
  running: 'dönüştürülüyor',
  done: 'dönüştürüldü',
  error: 'hata',
  cancelled: 'iptal',
};

interface ConversionJobsProps {
  jobs: RunJobView[];
  running: boolean;
}

export function ConversionJobs({ jobs, running }: ConversionJobsProps) {
  const { reveal, open } = useOpenTarget();
  const done = jobs.filter((job) => job.status === 'done').length;
  const failed = jobs.filter((job) => job.status === 'error').length;
  const cancelled = jobs.filter((job) => job.status === 'cancelled').length;
  const overall =
    jobs.length === 0
      ? 0
      : jobs.reduce(
          (sum, job) =>
            sum + (job.status === 'done' ? 100 : job.status === 'running' ? job.percent : 0),
          0,
        ) / jobs.length;

  const summary =
    jobs.length === 0
      ? 'Henüz iş yok'
      : [
          `${done}/${jobs.length} tamamlandı`,
          failed > 0 ? `${failed} hata` : null,
          cancelled > 0 ? `${cancelled} iptal` : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <section className="settings-card flex min-h-0 flex-col">
      <header className="flex flex-col gap-2 border-b border-border/70 p-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">
            İşler
            <span data-num className="ml-1.5 font-mono text-2xs text-muted-foreground">
              {jobs.length}
            </span>
          </h3>
          <p className="text-micro text-muted-foreground" aria-live="polite">
            {summary}
          </p>
        </div>
        {running && <Progress value={overall} aria-label="Toplam iş ilerlemesi" />}
      </header>

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <ListChecks className="size-7 text-muted-foreground" />
          <p className="text-title">İş listesi boş</p>
          <p className="max-w-[34ch] text-sm text-muted-foreground">
            Kaynakları seçip hedefi belirledikten sonra “Dönüştür”e bas. İşler sırayla çalışır;
            her satır kendi durumunu ve çıktısını taşır.
          </p>
        </div>
      ) : (
        <ul
          className="flex max-h-[34rem] flex-col divide-y divide-border/70 overflow-y-auto"
          aria-label="Dönüşüm işleri"
          aria-busy={running}
        >
          {jobs.map((job) => {
            const output = job.outputs[0];
            return (
              <li key={job.id} className="flex animate-rise flex-col gap-1.5 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Stamp state={STATUS_STAMP[job.status]}>{STATUS_LABEL[job.status]}</Stamp>
                  <span
                    data-num
                    className="w-9 shrink-0 text-right font-mono text-2xs text-muted-foreground"
                  >
                    {job.status === 'running' ? `%${Math.round(job.percent)}` : '—'}
                  </span>
                </div>

                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm" title={job.path}>
                    {job.name}
                  </span>
                  <span className="flex min-w-0 items-baseline gap-1.5 text-2xs text-muted-foreground">
                    <span data-num className="shrink-0 font-mono">
                      → .{job.target}
                    </span>
                    {job.status === 'running' && job.phase && (
                      <span className="truncate">{job.phase}</span>
                    )}
                  </span>
                </div>

                {job.status === 'running' && (
                  <Progress
                    value={job.percent}
                    readout={false}
                    aria-label={`${job.name} ilerlemesi`}
                  />
                )}

                {job.error && (
                  <p role="alert" className="text-micro text-destructive">
                    {job.error}
                  </p>
                )}

                {job.warnings.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {job.warnings.map((warning) => (
                      <li key={warning} className="text-2xs text-muted-foreground">
                        {warning}
                      </li>
                    ))}
                  </ul>
                )}

                {output && (
                  <div className="flex items-center gap-1">
                    <CheckCircle2
                      aria-hidden
                      className="size-3.5 shrink-0 text-state-acquired"
                      strokeWidth={2.5}
                    />
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
