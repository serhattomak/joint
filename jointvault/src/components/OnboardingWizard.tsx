import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Stamp } from '@/components/ui/stamp';
import { HealthRow } from '@/components/DiagnosticsPanel';
import { markOnboarded } from '@/components/WelcomeDialog';
import { getHealth, type HealthReport } from '@/lib/health';
import { WHISPER_MODELS } from '@/lib/whisper';
import { getAiStatus, saveAiConfig, type AiStatus } from '@/lib/ai';
import { recommendChatModel } from '@/lib/chat-model';
import {
  cancelComponentDownload,
  downloadComponent,
  useComponentDownloadProgress,
  type ComponentStatus,
} from '@/lib/components';

// WelcomeDialog görsel dili: aynı Dialog, adım noktaları, "Atla" hep görünür.
// Eksik parça asla engellemez — her adımda tek satırlık TR sonraki adım var.
//
// İki indirme de PAYLAŞILAN motordan geçer (`downloadComponent` → `component_download`);
// burada ikinci bir indirme motoru YOKTUR. AI adımı varsayılan olarak KAPALIDIR ve
// kullanıcı istemeden hiçbir şey indirmez.
const STEPS = ['Medya motoru', 'Konuşma', 'Yapay zekâ (opsiyonel)', 'İndirme klasörü'];

// ffmpeg + ffprobe TEK arşivde (`ffmpeg-tools`, ~191 MB) iner; ffmpeg satırı yeter.
const FFMPEG_COMPONENT_ID = 'ffmpeg';

/*
 * Boyutlar bileşen kaydından (`components_status.approx_mb`) okunur; kayıt
 * okunamazsa (backend'e ulaşılamadı) pin değerleri kullanılır. Pin'ler
 * `components.rs` ile birebir: ffmpeg-tools 191, 3B 1841, 7B 4466, 14B 8572.
 */
const FALLBACK_MB: Record<string, number> = {
  ffmpeg: 191,
  'ai-model-llm-3b': 1841,
  'ai-model-llm-7b': 4466,
  'ai-model-llm': 8572,
};

const MIB = 1024;

/** MiB → okunur birim (1024'ün altı MB kalır; uydurma yuvarlama yok). */
function formatMb(mb: number): string {
  return mb >= MIB ? `${(mb / MIB).toFixed(1)} GB` : `${mb} MB`;
}

// Donanıma göre model önerisi `lib/chat-model.ts`'e taşındı (saf, test edilir);
// bileşen yalnızca tüketir. `ChatModelRecommendation` tipi oradan gelir.

interface OnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
}

export function OnboardingWizard({ open, onOpenChange, onOpenSettings }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [checked, setChecked] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [components, setComponents] = useState<
    Record<string, { mb?: number; installed: boolean }>
  >({});
  // ffmpeg tek tık indirme (paylaşılan motor; `jobId` ile süzülür).
  const [ffmpegJob, setFfmpegJob] = useState<string | null>(null);
  const [ffmpegPct, setFfmpegPct] = useState<number | null>(null);
  const [ffmpegError, setFfmpegError] = useState<string | null>(null);
  // Opsiyonel AI: önerilen sohbet modeli indirmesi.
  const [chatJob, setChatJob] = useState<{ id: string; jobId: string } | null>(null);
  const [chatPct, setChatPct] = useState<number | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const last = step >= STEPS.length - 1;

  const ffmpegJobRef = useRef<string | null>(null);
  const chatJobRef = useRef<string | null>(null);
  // Tek abonelik: her indirme aynı olayı yayar, işi `jobId` ayırır.
  useComponentDownloadProgress((e) => {
    if (e.jobId === ffmpegJobRef.current) setFfmpegPct(e.percent);
    if (e.jobId === chatJobRef.current) setChatPct(e.percent);
  });

  useEffect(() => {
    if (!open) return;
    setChecked(false);
    setHealth(null);
    setFfmpegError(null);
    setChatError(null);
    void getHealth().then((h) => {
      setHealth(h);
      setChecked(true);
    });
    // Backend'e ulaşılamazsa `null` — "bilinmiyor" olarak kalır, uydurulmaz.
    void getAiStatus()
      .then(setAiStatus)
      .catch(() => setAiStatus(null));
    void invoke<ComponentStatus[]>('components_status')
      .then((rows) => {
        const map: Record<string, { mb?: number; installed: boolean }> = {};
        for (const row of rows) map[row.id] = { mb: row.approx_mb, installed: row.installed };
        setComponents(map);
      })
      .catch(() => setComponents({}));
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

  const startFfmpeg = async (): Promise<void> => {
    if (ffmpegJobRef.current) return;
    setFfmpegError(null);
    setFfmpegPct(0);
    const jobId = crypto.randomUUID();
    ffmpegJobRef.current = jobId;
    setFfmpegJob(jobId);
    const res = await downloadComponent(FFMPEG_COMPONENT_ID, jobId);
    if (ffmpegJobRef.current !== jobId) return; // iptal edildi: hata değil
    ffmpegJobRef.current = null;
    setFfmpegJob(null);
    if (!res.ok) {
      setFfmpegPct(null);
      setFfmpegError(res.error ?? 'İndirilemedi.');
      return;
    }
    setFfmpegPct(100);
    setHealth(await getHealth());
  };

  const cancelFfmpeg = async (): Promise<void> => {
    const jobId = ffmpegJobRef.current;
    if (!jobId) return;
    ffmpegJobRef.current = null;
    setFfmpegJob(null);
    setFfmpegPct(null);
    await cancelComponentDownload(jobId);
  };

  const startChatModel = async (id: string): Promise<void> => {
    if (chatJobRef.current) return;
    setChatError(null);
    setChatPct(0);
    const jobId = crypto.randomUUID();
    chatJobRef.current = jobId;
    setChatJob({ id, jobId });
    const res = await downloadComponent(id, jobId);
    if (chatJobRef.current !== jobId) return; // iptal edildi: hata değil
    chatJobRef.current = null;
    setChatJob(null);
    if (!res.ok) {
      setChatPct(null);
      setChatError(res.error ?? 'Model indirilemedi.');
      return;
    }
    setChatPct(100);
    setComponents((prev) => ({ ...prev, [id]: { mb: prev[id]?.mb, installed: true } }));
    // Seçimi KALICI yaz: sihirbazda indirilen model, sonradan kurulan daha büyük bir
    // modelin onu sessizce geçmesini engeller (Exit 3: "seçim kalıcı").
    try {
      const rows = await invoke<ComponentStatus[]>('components_status');
      const path = rows.find((row) => row.id === id)?.path;
      if (path) await saveAiConfig({ llm_path: path });
    } catch {
      // Kalıcı yazılamazsa indirme yine başarılıdır; kullanıcı Ayarlar'dan seçebilir.
    }
  };

  const cancelChat = async (): Promise<void> => {
    const jobId = chatJobRef.current;
    if (!jobId) return;
    chatJobRef.current = null;
    setChatJob(null);
    setChatPct(null);
    await cancelComponentDownload(jobId);
  };

  const ffmpegReady = health?.ffmpeg.available === true && health?.ffprobe.available === true;
  const ffmpegMb = components[FFMPEG_COMPONENT_ID]?.mb ?? FALLBACK_MB[FFMPEG_COMPONENT_ID];

  const ramMb = aiStatus?.ram_mb ?? null;
  const vramMb = aiStatus?.gpu?.vram_mb ?? null;
  const rec = recommendChatModel(ramMb, vramMb);
  const recMb = components[rec.id]?.mb ?? FALLBACK_MB[rec.id];
  const recInstalled = components[rec.id]?.installed ?? false;
  const hardwareLine =
    `RAM ${ramMb !== null ? formatMb(ramMb) : 'okunamadı'} · ` +
    `${aiStatus?.gpu?.name ?? 'GPU yok/bilinmiyor'}` +
    (vramMb !== null ? ` (${formatMb(vramMb)} VRAM)` : '');

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
                      'Bulunamadı — aşağıdan tek tıkla indirebilirsin.')
                }
              />
              <HealthRow
                ok={flag(health?.ffprobe.available)}
                label={health?.ffprobe.version ? `FFprobe — ${health.ffprobe.version}` : 'FFprobe'}
                hint={
                  !checked
                    ? pendingHint
                    : (health?.ffprobe.version ??
                      'Bulunamadı — ffmpeg ile aynı pakette, aşağıdan iner.')
                }
              />
              {checked && !ffmpegReady && (
                <div className="flex flex-col gap-1.5">
                  {ffmpegJob ? (
                    <div className="flex items-center gap-2">
                      {ffmpegPct !== null && ffmpegPct >= 0 ? (
                        <Progress value={ffmpegPct} className="flex-1" label="ffmpeg indiriliyor" />
                      ) : (
                        <span className="flex-1 text-xs text-muted-foreground">İndiriliyor…</span>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => void cancelFfmpeg()}>
                        İptal
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <Button size="sm" onClick={() => void startFfmpeg()}>
                        ffmpeg + ffprobe indir (≈{formatMb(ffmpegMb)})
                      </Button>
                    </div>
                  )}
                  {ffmpegError && <p className="text-xs text-destructive">{ffmpegError}</p>}
                </div>
              )}
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
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Yerel AI (Asistan) tamamen opsiyoneldir; varsayılan seçim{' '}
                  <span className="font-medium text-foreground">“AI’yı kullanmak istemiyorum”</span>.
                  Sen istemeden hiçbir şey indirilmez — sonra Ayarlar → Yapay Zekâ’dan açıp
                  yönetebilirsin.
                </p>
                <Stamp state="none">kapalı</Stamp>
              </div>
              <p className="text-xs text-muted-foreground">
                {!checked
                  ? 'Donanım okunuyor…'
                  : aiStatus === null
                    ? 'Donanım bilgisi okunamadı — öneri en hafif modelde kalır.'
                    : hardwareLine}
              </p>
              {checked && (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm">
                      Önerilen model: <span className="font-medium">{rec.label}</span>
                      <span className="text-muted-foreground"> (≈{formatMb(recMb)})</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{rec.reason}</p>
                  </div>
                  {chatJob?.id === rec.id ? (
                    <Button variant="ghost" size="sm" onClick={() => void cancelChat()}>
                      İptal
                    </Button>
                  ) : recInstalled ? (
                    <Stamp state="local">kurulu</Stamp>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={chatJob !== null}
                      onClick={() => void startChatModel(rec.id)}
                    >
                      İndir
                    </Button>
                  )}
                </div>
              )}
              {chatJob &&
                (chatPct !== null && chatPct >= 0 ? (
                  <Progress value={chatPct} label="model indiriliyor" />
                ) : (
                  <p className="text-xs text-muted-foreground">İndiriliyor…</p>
                ))}
              {chatError && <p className="text-xs text-destructive">{chatError}</p>}
              <p className="text-xs text-muted-foreground">
                Asistanın yanıt vermesi için{' '}
                <span className="font-medium text-foreground">llama-server motoru</span> da gerekir;
                Ayarlar → Yapay Zekâ’dan kurulur.
              </p>
              <div>
                <Button variant="outline" size="sm" onClick={goSettings}>
                  Ayarlar’dan yönet
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
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
