import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HealthRow } from '@/components/DiagnosticsPanel';
import { markOnboarded } from '@/components/WelcomeDialog';
import { getHealth, type HealthReport } from '@/lib/health';
import { WHISPER_MODELS } from '@/lib/whisper';

// WelcomeDialog görsel dili: aynı Dialog, adım noktaları, "Atla" hep görünür.
// Eksik parça asla engellemez — her adımda tek satırlık TR sonraki adım var.
const STEPS = ['Medya motoru', 'Konuşma', 'İndirme klasörü'];

interface OnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
}

export function OnboardingWizard({ open, onOpenChange, onOpenSettings }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [checked, setChecked] = useState(false);
  const last = step >= STEPS.length - 1;

  useEffect(() => {
    if (!open) return;
    setChecked(false);
    setHealth(null);
    void getHealth().then((h) => {
      setHealth(h);
      setChecked(true);
    });
  }, [open]);

  const close = (done: boolean): void => {
    if (done) markOnboarded();
    setStep(0);
    onOpenChange(false);
  };

  const goSettings = (): void => {
    close(true);
    onOpenSettings();
  };

  // Kontrol bitmeden null (nabız), bitince bayrak; backend'e ulaşılamazsa eksik say.
  const flag = (v: boolean | undefined): boolean | null => (checked ? (v ?? false) : null);
  const pendingHint = 'Kontrol ediliyor…';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close(false);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Kurulum kontrolü</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <p className="text-title">{STEPS[step]}</p>

          {step === 0 && (
            <>
              <HealthRow
                ok={flag(health?.ffmpeg.available)}
                label={health?.ffmpeg.version ? `FFmpeg — ${health.ffmpeg.version}` : 'FFmpeg'}
                hint={
                  !checked
                    ? pendingHint
                    : (health?.ffmpeg.version ??
                      'Bulunamadı — uygulamayı yeniden kurman gerekebilir.')
                }
              />
              <HealthRow
                ok={flag(health?.ffprobe.available)}
                label={health?.ffprobe.version ? `FFprobe — ${health.ffprobe.version}` : 'FFprobe'}
                hint={
                  !checked
                    ? pendingHint
                    : (health?.ffprobe.version ??
                      'Bulunamadı — uygulamayı yeniden kurman gerekebilir.')
                }
              />
            </>
          )}

          {step === 1 && (
            <>
              <HealthRow
                ok={flag(health?.whisper.available)}
                label="Whisper (konuşma)"
                hint={
                  !checked
                    ? pendingHint
                    : health?.whisper.available
                      ? 'Kurulu — transkript üretebilirsin.'
                      : 'Bulunamadı — uygulamayı yeniden kurman gerekebilir.'
                }
              />
              {WHISPER_MODELS.map((m) => {
                const done = health?.models[m.id] ?? false;
                return (
                  <HealthRow
                    key={m.id}
                    ok={checked ? done : null}
                    label={`${m.id} (≈${m.sizeMb} MB)`}
                    hint={
                      !checked
                        ? pendingHint
                        : done
                          ? 'İndirildi.'
                          : m.id === 'base'
                            ? 'Önerilen model — Ayarlar → Konuşma’dan indir.'
                            : 'Eksik — gerekirse Ayarlar → Konuşma’dan indir.'
                    }
                  />
                );
              })}
              <div>
                <Button variant="outline" size="sm" onClick={goSettings}>
                  Ayarlar’dan indir
                </Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="truncate font-mono text-xs text-muted-foreground" title={health?.download_dir ?? ''}>
                {health?.download_dir
                  ? `İndirme klasörü: ${health.download_dir}`
                  : 'İndirme klasörü bilinmiyor.'}
              </p>
              <p className="text-sm text-muted-foreground">
                Her şey hazır olmasa da kullanabilirsin — eksikler seni engellemez, sonra
                Ayarlar → Tanılama’dan bakabilirsin.
              </p>
            </>
          )}

          <div className="flex gap-1.5" aria-label={`Adım ${step + 1} / ${STEPS.length}`}>
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(true)}>
            Atla
          </Button>
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              Geri
            </Button>
          )}
          {!last && (
            <Button variant="outline" onClick={() => setStep((s) => s + 1)}>
              İleri
            </Button>
          )}
          {last && <Button onClick={() => close(true)}>Bitir</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
