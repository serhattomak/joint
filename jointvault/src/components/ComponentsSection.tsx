/*
 * Bileşenler (araç zinciri).
 *
 * ffmpeg hem indirmenin hem 6 medya aracının ön koşulu. Bugün paketle geliyor ve
 * eksik olduğunda ilgili özellikler **sessizce** başarısız oluyordu. Bu bölüm
 * neyin kurulu olduğunu GERÇEK kontrolden okur (dosya + `-version` çalıştırma);
 * sabit bir liste değildir.
 *
 * İndirme kablolaması (7b/7c-2) burada DEĞİL: tek iş, jobId süzgeci, iptal ve
 * ilerleme `ComponentInstaller`'da tek yerde yaşar; bu bölüm onu
 * `useComponentInstaller()` üzerinden tüketir. ffmpeg + ffprobe AYNI arşivden
 * geldiği için (bundle) iki ayrı ~186 MB indirme DEĞİL, tek indirme olarak
 * sunulur. Kurulum başarısında satırlar `components_status` yeniden okunarak
 * `kurulu`ya döner.
 *
 * 7c-3: satır listesi artık TÜM kayıttır (whisper motoru + 3 modeli, llama
 * motoru, cudart, Qwen ve BGE dâhil) — ekran veri-güdümlü olduğu için yeni
 * bileşenler kendiliğinden çizilir. Boyut `components_status.approx_mb`'den
 * gelir: pin/YOK. "Kurulu mu?" kararı tür-farkındadır (`isUsable`): kurulu bir
 * `.gguf`/`.bin` modeli çalışmasa da kuruludur ve bir daha indirmeye sunulmaz.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FolderOpen, PackageCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Stamp } from '@/components/ui/stamp';
import { useNotice } from '@/components/ui/notice';
import { useComponentInstaller, type ActiveInstall } from '@/components/ComponentInstaller';
import { describeError } from '@/lib/errors';
import { useOpenTarget } from '@/lib/open-target';
import { isUsable, type ComponentStatus } from '@/lib/components';

const SOURCE_LABEL: Record<'downloaded' | 'bundled', string> = {
  downloaded: 'indirildi',
  bundled: 'paketle geldi',
};

/*
 * Tür etiketi — satırın çalıştırılabilir mi yoksa veri dosyası mı olduğunu
 * söyler. Boyutu tek başına göstermek "8.5 GB ne indiriyorum?" sorusunu açık
 * bırakırdı; tür, kullanıcının neyi taahhüt ettiğini netleştirir.
 */
const KIND_LABEL: Record<'binary' | 'asset', string> = {
  binary: 'araç',
  asset: 'veri dosyası',
};

/** Fazın kullanıcıya dönük Türkçesi; beklenmeyen faz geldiği gibi gösterilir. */
const PHASE_LABEL: Record<string, string> = {
  downloading: 'indiriliyor',
  verifying: 'doğrulanıyor',
  extracting: 'çıkarılıyor',
  done: 'tamamlandı',
};

/*
 * İndirilebilir ama kullanılamıyor: bu satır için indirme gerekir. Kullanılabilirlik
 * `isUsable`'dan gelir (tür-farkında): kurulu bir model/asset "kullanılabilir"
 * sayıldığı için bir daha indirmeye sunulmaz.
 */
function requiresInstall(component: ComponentStatus): boolean {
  return component.downloadable && !isUsable(component);
}

/** Satırları paket kimliğine göre grupla; paketsizler tek başına durur. */
function groupKeyOf(component: ComponentStatus): string {
  return component.bundle ?? `component:${component.id}`;
}

interface ComponentGroup {
  key: string;
  rows: ComponentStatus[];
  /** Boyut/etiket için temsili indirilebilir satır. */
  primary: ComponentStatus;
  /** Grupta kurulum gerektiren en az bir satır var mı. */
  needsInstall: boolean;
  /** Birden çok satır tek arşivden mi kurulur (ör. ffmpeg + ffprobe). */
  shared: boolean;
  label: string;
}

/*
 * Paket bilinçli gruplama: aynı `bundle`'ı paylaşan satırlar TEK gruba düşer,
 * böylece tek arşiv için tek indirme düğmesi çıkar. Sıra korunur.
 */
function groupComponents(components: ComponentStatus[]): ComponentGroup[] {
  const buckets = new Map<string, ComponentStatus[]>();
  const order: string[] = [];
  for (const component of components) {
    const key = groupKeyOf(component);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(component);
    } else {
      buckets.set(key, [component]);
      order.push(key);
    }
  }
  return order.map((key) => {
    const rows = buckets.get(key) ?? [];
    const primary = rows.find((row) => row.downloadable) ?? rows[0];
    return {
      key,
      rows,
      primary,
      needsInstall: rows.some(requiresInstall),
      shared: rows.length > 1,
      label: rows.map((row) => row.label).join(' + '),
    };
  });
}

/*
 * İndirme komutuna verilecek satır: komut kaynağı satır id'siyle çözer ve
 * kuruluysa atlar; bu yüzden önce kurulu OLMAYAN indirilebilir satır seçilir.
 */
function downloadTarget(group: ComponentGroup): ComponentStatus {
  return group.rows.find((row) => row.downloadable && !row.installed) ?? group.primary;
}

/*
 * Çalışan işin hangi gruba ait olduğunu satır id'sinden türetir: provider işi
 * başlatırken satır id'sini bilir, groupsa bundle kimliğiyle çizilir. Eşleşmeyen
 * (ör. liste henüz gelmemiş) iş hiçbir gruba düşmez; yanlış şerit çizilmez.
 */
function activeGroupKeyFor(
  components: ComponentStatus[],
  active: ActiveInstall | null,
): string | null {
  if (!active) return null;
  const row = components.find((component) => component.id === active.componentId);
  return row ? groupKeyOf(row) : null;
}

/** Tek bileşen satırı — mevcut üç durumlu damga + sürüm/kaynak dili korunur. */
function ComponentRow({
  component,
  shared,
  onReveal,
}: {
  component: ComponentStatus;
  /** Satır bir paketin parçası mı (indirme tek arşivden, satır başına değil). */
  shared: boolean;
  onReveal: (path: string) => void;
}) {
  const path = component.path;
  // Tür-farkında kullanılabilirlik: kurulu bir asset çalışmasa da "kurulu"dur.
  const usable = isUsable(component);
  const kindLabel = component.kind ? KIND_LABEL[component.kind] : null;
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm">
          {component.label}
          {!component.installed ? (
            <Stamp state="none">eksik</Stamp>
          ) : usable ? (
            <Stamp state="local">kurulu</Stamp>
          ) : (
            /* Dosya var ama binary çalışmıyor (ör. eksik DLL): sessiz kalma.
               Asset'ler buraya DÜŞMEZ — onlar `usable` sayılır. */
            <Stamp state="error">çalıştırılamıyor</Stamp>
          )}
        </span>
        <span className="truncate text-2xs text-muted-foreground">
          {component.installed ? (
            <>
              {component.source && SOURCE_LABEL[component.source]}
              {component.version ? (
                <>
                  {' · '}
                  <span data-num>{component.version}</span>
                </>
              ) : component.kind === 'asset' ? (
                /* Veri dosyasının sürümü OLMAZ; "okunamadı" demek onu kusurlu
                   gösterirdi. Türünü dürüstçe söyleriz. */
                ' · veri dosyası'
              ) : (
                ' · sürüm okunamadı'
              )}
            </>
          ) : component.downloadable ? (
            /* Paylaşılan arşivde boyut satır başına yazılmaz: kullanıcı iki ayrı
               indirme sanmasın. Boyut tek yerde, paketin indirme şeridinde. */
            shared ? (
              'tek arşivden kurulur'
            ) : (
              <>
                indirilecek: ~<span data-num>{component.approx_mb}</span> MB
                {kindLabel ? ` · ${kindLabel}` : ''}
              </>
            )
          ) : null}
        </span>
      </div>
      {path && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-2xs"
          onClick={() => onReveal(path)}
        >
          Konumu aç
        </Button>
      )}
    </div>
  );
}

/** Bir paketin indirme şeridi: boşta düğme, çalışırken ilerleme + İptal. */
function DownloadAction({
  group,
  download,
  disabled,
  onStart,
  onCancel,
}: {
  group: ComponentGroup;
  download: ActiveInstall | null;
  disabled: boolean;
  onStart: (group: ComponentGroup) => void;
  onCancel: (jobId: string) => void;
}) {
  if (!download) {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-xs text-muted-foreground">
            {group.shared ? `${group.label} birlikte kurulur` : group.primary.label}
          </span>
          <span className="text-2xs text-muted-foreground">
            indirilecek: ~<span data-num>{group.primary.approx_mb}</span> MB
            {group.shared ? ' · tek arşiv' : ''}
          </span>
        </span>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 text-2xs"
          disabled={disabled}
          onClick={() => onStart(group)}
        >
          İndir
        </Button>
      </div>
    );
  }

  const known = download.percent >= 0;
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-xs text-muted-foreground">
          {group.shared ? `${group.label} · ` : ''}
          {PHASE_LABEL[download.phase] || download.phase}
        </span>
        <Progress
          value={known ? download.percent : null}
          readout={known}
          /* Toplam uzunluk bilinmiyorken 0% yalanı yerine tarama. */
          indicatorClassName={known ? undefined : 'skeleton-paper w-full'}
          aria-label={`${group.label} indirme ilerlemesi`}
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 text-2xs"
        onClick={() => onCancel(download.jobId)}
      >
        İptal
      </Button>
    </div>
  );
}

export function ComponentsSection() {
  const notice = useNotice();
  const { reveal } = useOpenTarget();
  const [components, setComponents] = useState<ComponentStatus[]>([]);
  const [busy, setBusy] = useState(false);
  // İndirme durumu paylaşılan akıştan gelir: bu bölüm kendi iş/iptal ref'lerini
  // ve olay aboneliğini TUTMAZ. Tek kaynak ComponentInstallerProvider'dır.
  const { install, cancel, active } = useComponentInstaller();

  const refresh = useCallback(async (): Promise<ComponentStatus[]> => {
    setBusy(true);
    try {
      const next = await invoke<ComponentStatus[]>('components_status');
      setComponents(next);
      return next;
    } catch (error) {
      notice.push({ text: `Bileşenler okunamadı: ${describeError(error)}`, tone: 'error' });
      return [];
    } finally {
      setBusy(false);
    }
  }, [notice]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * Satır içi kurulum: tek iş, iptal ve bildirimleri provider yönetir (bu yüzden
   * burada ikinci bir hata/başarı bildirimi YOK). Yalnızca gerçek başarıda
   * listeyi tazeleriz; başarısız veya iptal edilen iş satırları değiştirmez.
   */
  const startDownload = async (group: ComponentGroup): Promise<void> => {
    const outcome = await install(downloadTarget(group).id);
    if (outcome.kind === 'ok') await refresh();
  };

  const groups = groupComponents(components);
  const activeGroupKey = activeGroupKeyFor(components, active);
  const missing = components.filter((component) => !component.installed);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card/30 p-4 shadow-xs">
      <div className="flex flex-col gap-1">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <PackageCheck className="size-4" /> Bileşenler
        </h3>
        <p className="text-xs text-muted-foreground">
          İndirme ve medya araçlarının ihtiyaç duyduğu araçlar. Durum gerçek kontrolden okunur: dosyanın varlığı
          ve çalışıp çalışmadığı.
        </p>
      </div>

      {missing.length > 0 && (
        <p className="rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {missing.length} bileşen eksik. Eksik bileşen, ona bağlı özelliklerin çalışmaması demektir.
        </p>
      )}

      <div className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border">
        {groups.map((group) => (
          <Fragment key={group.key}>
            {group.rows.map((component) => (
              <ComponentRow
                key={component.id}
                component={component}
                shared={group.shared}
                onReveal={reveal}
              />
            ))}
            {group.needsInstall && (
              <DownloadAction
                group={group}
                download={active && activeGroupKey === group.key ? active : null}
                disabled={active !== null}
                onStart={(target) => void startDownload(target)}
                onCancel={cancel}
              />
            )}
          </Fragment>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => void refresh()}
          disabled={busy || active !== null}
        >
          <RefreshCw className="size-3.5" /> Durumu yenile
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => void invoke<string>('components_path').then(reveal)}
        >
          <FolderOpen className="size-3.5" /> Bileşen klasörünü aç
        </Button>
      </div>
    </div>
  );
}
