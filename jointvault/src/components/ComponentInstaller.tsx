/*
 * Bileşen kurulum akışı — TEK uygulama (7c-2).
 *
 * ffmpeg gibi bir araç eksikken ilgili özellik sessizce ölmesin diye ekranlar
 * eksik-bileşen sinyalini tanır (ayrıştırma: src/lib/components.ts) ve
 * çağrıldığı anda `request()` ile bu diyaloğu açar. Diyalog, etiket/boyutu
 * kayıtlı `components_status` durumundan okur ve
 * indirmeyi 7b'nin TEK motoruna (`downloadComponent`) devreder. İkinci bir
 * indirme/iptal/ilerleme uygulaması bilinçli olarak YOKTUR: bu dosya,
 * ComponentsSection'daki davranışın (tek iş, jobId süzgeci, çift başlatma
 * koruması, iptalin hata sayılmaması) ortak bir çıkarımıdır.
 *
 * Kritik kural: indirilemeyen (`downloadable === false`) bir bileşen için diyalog
 * AÇILMAZ. Bugün whisper ve yt-dlp böyledir; indirme yolları 7c-3'te gelecek.
 * Kurulum yapamayacak bir diyalog göstermek kullanıcıya yalan olurdu; bu yüzden
 * `request` bu durumda 'unavailable' döner, çağıran da dürüst yönlendirme metnine
 * düşer. Aynı sebeple durum okunamazsa da (indirilebilirliği doğrulayamayız)
 * diyalog açılmaz.
 *
 * Önek burada BİLİNMEZ: ayrıştırma `src/lib/components.ts`'te yaşar; bu modül
 * yalnızca kurulum akışıdır ve öneki hiçbir metne koymaz.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useNotice } from '@/components/ui/notice';
import { Progress } from '@/components/ui/progress';
import { Stamp } from '@/components/ui/stamp';
import {
  cancelComponentDownload,
  downloadComponent,
  useComponentDownloadProgress,
  type ComponentDownloadPhase,
  type ComponentStatus,
} from '@/lib/components';
import { describeError } from '@/lib/errors';

/** Fazın kullanıcıya dönük Türkçesi; beklenmeyen faz geldiği gibi gösterilir. */
const PHASE_LABEL: Record<string, string> = {
  downloading: 'indiriliyor',
  verifying: 'doğrulanıyor',
  extracting: 'çıkarılıyor',
  done: 'tamamlandı',
};

/** İptal, hata değil; backend reddi boşsa gösterilecek yedek metin. */
const CANCELLED_TEXT = 'İptal edildi.';
const FAILED_TEXT = 'Bileşen indirilemedi.';

/** `request` sonucu: diyalog açıldı mı, yoksa dürüst yönlendirmeye mi düşülür? */
export type InstallRequestResult = 'opened' | 'unavailable';

/** Tek kurulumun sonucu. `busy` = zaten süren bir iş var (sessizce yutulur). */
export type InstallOutcome =
  | { kind: 'ok' }
  | { kind: 'cancelled'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'busy' };

/** Çalışan tek iş; ekranlar satır içi ilerlemeyi buradan okur. */
export interface ActiveInstall {
  jobId: string;
  /** Başlatırken verilen satır id'si (paket kimliği değil). */
  componentId: string;
  percent: number;
  phase: ComponentDownloadPhase;
}

export interface ComponentInstallerApi {
  /**
   * Kapı akışı: bileşen indirilebilirse diyaloğu açar ve 'opened' döner.
   * İndirilemeyen/okunamayan durumda diyalog AÇILMAZ, 'unavailable' döner.
   * Never-throw; promise `void` ile bağlanır.
   */
  request: (componentId: string, onInstalled?: () => void) => Promise<InstallRequestResult>;
  /**
   * Satır içi (diyalogsuz) indirme — ComponentsSection gibi kendi ilerleme
   * şeridini çizen yerler için. Aynı anda tek iş; sonuç `active` ile izlenir.
   */
  install: (componentId: string) => Promise<InstallOutcome>;
  /** Çalışan/kuyruktaki işi iptal et. İptal hata değildir. */
  cancel: (jobId: string) => void;
  /** Aktif iş; yoksa null. */
  active: ActiveInstall | null;
}

interface ComponentInfo {
  /** Durum satırı okunamazsa ham id'ye düşülür; etiket asla boş gösterilmez. */
  label: string;
  /** Boyut bilinmiyorsa null: uydurma sayı yazmak yerine satır gizlenir. */
  approxMb: number | null;
}

interface PendingInstall {
  componentId: string;
  info: ComponentInfo;
  /** Her istekte artan kimlik: diyaloğu tazelemek (eski hata metnini taşımamak) için. */
  requestId: number;
  /** Başarılı kurulumdan sonra çağıran, başarısız eylemini yeniden dener. */
  onInstalled?: () => void;
}

const ComponentInstallerContext = createContext<ComponentInstallerApi | null>(null);

/*
 * Provider + kanca aynı modülde (notice.tsx deseni). Kanca, Fast Refresh'in
 * "yalnız bileşen dışa aktar" kuralını biçimsel olarak deler; bu modül HMR'a
 * duyarlı bir bileşen dosyası değil (sağlayıcı yerleşimi App'te sabit), bu yüzden
 * uyarıyı büyütmemek için kural bu tek satırda susturulur.
 */
// oxlint-disable-next-line react/only-export-components
export function useComponentInstaller(): ComponentInstallerApi {
  const ctx = useContext(ComponentInstallerContext);
  if (!ctx) throw new Error('useComponentInstaller: ComponentInstallerProvider bulunamadı.');
  return ctx;
}

/** Kurulmuş VE çalıştırılabiliyor mu (ComponentsSection ile aynı ölçüt). */
function isUsable(component: ComponentStatus): boolean {
  return component.installed && component.runnable;
}

/** Durum satırından diyaloğun göstereceği etiket/boyut (boş etiket id'ye düşer). */
function infoFor(componentId: string, row: ComponentStatus): ComponentInfo {
  const label = row.label.trim();
  return { label: label.length > 0 ? label : componentId, approxMb: row.approx_mb };
}

/*
 * Kurulum başarısını GERÇEK durumdan doğrular: ffmpeg indirmesi ffprobe'u da
 * kurar (aynı paket), bu yüzden paketin TÜM satırları kullanılabilir olmalı.
 * "İndirme başarılı" yanıtı tek başına yeşil damga için yeterli değildir.
 */
function verifyInstalled(
  rows: ComponentStatus[],
  componentId: string,
): { label: string; ok: boolean } {
  const target = rows.find((row) => row.id === componentId);
  if (!target) return { label: componentId, ok: false };
  const bundle = target.bundle;
  const members = bundle ? rows.filter((row) => row.bundle === bundle) : [target];
  return { label: members.map((row) => row.label).join(' + '), ok: members.every(isUsable) };
}

export function ComponentInstallerProvider({ children }: { children: React.ReactNode }) {
  const notice = useNotice();
  const [pending, setPending] = useState<PendingInstall | null>(null);
  const [active, setActive] = useState<ActiveInstall | null>(null);
  // İstek sayacı: aynı bileşen yeniden açıldığında da diyalog sıfırlansın.
  const requestSeqRef = useRef(0);

  // Aynı anda tek indirme: hem çift başlatmayı engeller hem olayları jobId'ye bağlar.
  const activeJobRef = useRef<string | null>(null);
  // İptali biz istedik: backend'in reddini hata gibi göstermemek için.
  const cancelledRef = useRef<string | null>(null);

  // Tek abonelik burada: olay yalnızca aktif işin jobId'siyle eşleşirse akar.
  useComponentDownloadProgress((event) => {
    if (event.jobId !== activeJobRef.current) return; // başka/eski işin olayı
    setActive((prev) =>
      prev && prev.jobId === event.jobId
        ? { ...prev, percent: event.percent, phase: event.phase }
        : prev,
    );
  });

  /* Durumu oku; okunamazsa bildirip null dön (sessiz yutma yok, fail-closed). */
  const loadStatus = useCallback(async (): Promise<ComponentStatus[] | null> => {
    try {
      return await invoke<ComponentStatus[]>('components_status');
    } catch (error) {
      notice.push({ text: `Bileşenler okunamadı: ${describeError(error)}`, tone: 'error' });
      return null;
    }
  }, [notice]);

  const install = useCallback(
    async (componentId: string): Promise<InstallOutcome> => {
      if (activeJobRef.current) return { kind: 'busy' }; // çift başlatma koruması
      const jobId = crypto.randomUUID();
      activeJobRef.current = jobId;
      cancelledRef.current = null;
      setActive({ jobId, componentId, percent: -1, phase: 'downloading' });

      const result = await downloadComponent(componentId, jobId);
      // İptali önce yakala, sonra temizle: gerçek başarıyı iptal maskesin diye.
      const wasCancelled = cancelledRef.current === jobId;
      cancelledRef.current = null;
      activeJobRef.current = null;
      setActive(null);

      if (!result.ok) {
        const message = describeError(result.error, wasCancelled ? CANCELLED_TEXT : FAILED_TEXT);
        // İptal hata değildir: bilgi tonunda duyurulur, kırmızı gösterilmez.
        notice.push({ text: message, tone: wasCancelled ? 'info' : 'error' });
        return wasCancelled ? { kind: 'cancelled', message } : { kind: 'error', message };
      }

      // Başarı iddiasını kanıtla: satırlar gerçekten kullanılabilir mi?
      const rows = await loadStatus();
      if (!rows) return { kind: 'error', message: 'Bileşen durumu okunamadı.' };
      const verified = verifyInstalled(rows, componentId);
      if (verified.ok) {
        notice.push({ text: `${verified.label} kuruldu.`, tone: 'ok' });
        return { kind: 'ok' };
      }
      const message = `${verified.label} hâlâ kullanılamıyor.`;
      notice.push({ text: message, tone: 'error' });
      return { kind: 'error', message };
    },
    [notice, loadStatus],
  );

  const cancel = useCallback((jobId: string): void => {
    cancelledRef.current = jobId;
    void cancelComponentDownload(jobId);
  }, []);

  const request = useCallback(
    async (componentId: string, onInstalled?: () => void): Promise<InstallRequestResult> => {
      const rows = await loadStatus();
      // Durum okunamıyorsa indirilebilirlik DOĞRULANAMAZ; kapat (fail-closed).
      if (!rows) return 'unavailable';
      const row = rows.find((item) => item.id === componentId);
      // İndirilemeyen bileşen için ölü diyalog açma (bugün whisper/yt-dlp böyle).
      if (!row || !row.downloadable) return 'unavailable';
      setPending({
        componentId,
        info: infoFor(componentId, row),
        requestId: (requestSeqRef.current += 1),
        onInstalled,
      });
      return 'opened';
    },
    [loadStatus],
  );

  const close = useCallback((): void => setPending(null), []);

  const value = useMemo<ComponentInstallerApi>(
    () => ({ request, install, cancel, active }),
    [request, install, cancel, active],
  );

  return (
    <ComponentInstallerContext.Provider value={value}>
      {children}
      <InstallDialog
        /* `key`: her yeni istekte diyalog SIFIRDAN kurulur, böylece önceki
           denemenin hata metni taşınmaz. Bunu bir effect ile yapmak
           `set-state-in-effect` uyarısı üretiyordu; key ile aynı sonuç
           React'in kendi kurulum yolundan geliyor. */
        key={pending ? pending.requestId : 'idle'}
        pending={pending}
        active={active}
        onInstall={install}
        onCancel={cancel}
        onClose={close}
      />
    </ComponentInstallerContext.Provider>
  );
}

/*
 * Kurulum diyaloğu. Diyalog açıkken global olarak TEK iş olur: bu iş bu
 * bileşene aitse ilerleme şeridi, değilse "başka indirme sürüyor" notu görünür.
 * İndirme sürerken kapatma kilitlenir; kullanıcı ya bitmesini bekler ya İptal eder.
 */
function InstallDialog({
  pending,
  active,
  onInstall,
  onCancel,
  onClose,
}: {
  pending: PendingInstall | null;
  active: ActiveInstall | null;
  onInstall: (componentId: string) => Promise<InstallOutcome>;
  onCancel: (jobId: string) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const open = pending !== null;
  // Etiket boş kalmışsa ham id'ye düş (durum okunamadı senaryosunun görünür ağı).
  const label = pending ? pending.info.label || pending.componentId : '';
  const approxMb = pending?.info.approxMb ?? null;
  const running =
    active && pending && active.componentId === pending.componentId ? active : null;
  const busyElsewhere = active !== null && running === null;
  // `known` ayrı bir değere bağlanır: `-1` (bilinmeyen toplam) asla "0%" olmaz.
  const percent = running ? running.percent : -1;
  const known = percent >= 0;
  // Boş string'e düşülür (jobId hiç boş olmaz): kapanışlarda daraltma derdi olmasın.
  const runningJobId = running?.jobId ?? '';

  const handleInstall = (): void => {
    if (!pending) return;
    const target = pending;
    void onInstall(target.componentId).then((outcome) => {
      if (outcome.kind === 'ok') {
        onClose();
        target.onInstalled?.(); // çağıran başarısız eylemini burada yeniden dener
        return;
      }
      if (outcome.kind === 'error') setError(outcome.message);
      // 'cancelled' hata değil: bildirim bilgi tonunda gösterildi, alan temiz kalır.
      if (outcome.kind === 'cancelled') setError(null);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // İndirme sürerken kazara kapanma yok: İptal açık bir karardır.
        if (!next && running) return;
        onClose();
      }}
    >
      <DialogContent showCloseButton={running === null}>
        <DialogHeader>
          <DialogTitle>{label} kurulacak</DialogTitle>
          <DialogDescription>
            Bu bileşen, ona bağlı özelliklerin çalışması için gerekli. Kurulum tek bir
            indirmeyle yapılır ve bittiğinde işlem kendiliğinden yeniden denenir.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <span className="truncate">{label}</span>
            {running ? <Stamp state="active">iniyor</Stamp> : <Stamp state="none">eksik</Stamp>}
          </span>
          <span className="shrink-0 text-2xs text-muted-foreground">
            {approxMb !== null ? (
              <>
                indirilecek: ~<span data-num>{approxMb}</span> MB
              </>
            ) : (
              'boyut bilinmiyor'
            )}
          </span>
        </div>

        {running && (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {PHASE_LABEL[running.phase] || running.phase}
            </span>
            <Progress
              value={known ? percent : null}
              readout={known}
              /* Toplam uzunluk bilinmiyorken 0% yalanı yerine tarama. */
              indicatorClassName={known ? undefined : 'skeleton-paper w-full'}
              aria-label={`${label} indirme ilerlemesi`}
            />
          </div>
        )}

        {busyElsewhere && (
          <p className="text-xs text-muted-foreground">
            Başka bir indirme sürüyor; bitince yeniden deneyin.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        )}

        <DialogFooter>
          {runningJobId !== '' ? (
            <Button variant="outline" size="sm" onClick={() => onCancel(runningJobId)}>
              İptal
            </Button>
          ) : (
            <Button size="sm" disabled={busyElsewhere} onClick={handleInstall}>
              İndir
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
