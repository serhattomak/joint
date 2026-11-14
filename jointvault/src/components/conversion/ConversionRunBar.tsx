import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

/*
 * Çalıştırma çubuğu — dönüştürücünün tek başlatma yüzeyi.
 * Ayarların altında, kartın ayağında durur: solda özet (ne → ne), sağda tek
 * birincil eylem. İş sürerken aynı yer toplam ilerlemeye dönüşür; eylem ve
 * iptal aynı noktada kalır, kullanıcı aramaz.
 */
interface ConversionRunBarProps {
  summary: ReactNode;
  hint?: ReactNode;
  actionLabel: string;
  disabled?: boolean;
  running?: boolean;
  percent?: number;
  onRun: () => void;
  onCancel: () => void;
}

export function ConversionRunBar({
  summary,
  hint,
  actionLabel,
  disabled,
  running = false,
  percent = 0,
  onRun,
  onCancel,
}: ConversionRunBarProps) {
  return (
    <footer className="mt-auto flex flex-col gap-2 border-t border-border/70 p-3">
      {running ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-micro font-medium">Sürüyor</span>
            <span data-num className="font-mono text-2xs text-muted-foreground">
              %{Math.round(percent)}
            </span>
          </div>
          <Progress value={percent} readout={false} aria-label="Toplam dönüşüm ilerlemesi" />
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-2xs text-muted-foreground">{summary}</span>
            <Button variant="outline" size="sm" onClick={onCancel}>
              İptal
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <p className="truncate text-micro font-medium">{summary}</p>
            {hint && <p className="truncate text-2xs text-muted-foreground">{hint}</p>}
          </div>
          <Button size="lg" onClick={onRun} disabled={disabled} className="min-w-28">
            {actionLabel}
          </Button>
        </div>
      )}
    </footer>
  );
}
