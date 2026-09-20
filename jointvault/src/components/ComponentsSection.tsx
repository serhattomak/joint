/*
 * Bileşenler (araç zinciri).
 *
 * ffmpeg hem indirmenin hem 6 medya aracının ön koşulu. Bugün paketle geliyor ve
 * eksik olduğunda ilgili özellikler **sessizce** başarısız oluyordu. Bu bölüm
 * neyin kurulu olduğunu GERÇEK kontrolden okur (dosya + `-version` çalıştırma);
 * sabit bir liste değildir.
 */
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FolderOpen, PackageCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Stamp } from '@/components/ui/stamp';
import { useNotice } from '@/components/ui/notice';
import { describeError } from '@/lib/errors';
import { useOpenTarget } from '@/lib/open-target';

export interface ComponentStatus {
  id: string;
  label: string;
  approx_mb: number;
  installed: boolean;
  /** Dosya var VE çalıştırılabiliyor mu (sürüm okunabildi mi). */
  runnable: boolean;
  path: string | null;
  source: 'downloaded' | 'bundled' | null;
  version: string | null;
  downloadable: boolean;
}

const SOURCE_LABEL: Record<'downloaded' | 'bundled', string> = {
  downloaded: 'indirildi',
  bundled: 'paketle geldi',
};

export function ComponentsSection() {
  const notice = useNotice();
  const { reveal } = useOpenTarget();
  const [components, setComponents] = useState<ComponentStatus[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      setComponents(await invoke<ComponentStatus[]>('components_status'));
    } catch (error) {
      notice.push({ text: `Bileşenler okunamadı: ${describeError(error)}`, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }, [notice]);

  useEffect(() => {
    void load();
  }, [load]);

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
        {components.map((component) => (
          <div key={component.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-2 text-sm">
                {component.label}
                {!component.installed ? (
                  <Stamp state="none">eksik</Stamp>
                ) : component.runnable ? (
                  <Stamp state="local">kurulu</Stamp>
                ) : (
                  /* Dosya var ama çalışmıyor: sessiz kalmak yerine söyle.
                     (Bugün whisper böyle: DLL'leri yok — Faz 8'in konusu.) */
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
                    ) : (
                      ' · sürüm okunamadı'
                    )}
                  </>
                ) : (
                  component.downloadable && (
                    <>
                      indirilecek: ~<span data-num>{component.approx_mb}</span> MB
                    </>
                  )
                )}
              </span>
            </div>
            {component.installed && component.path && (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-2xs"
                onClick={() => reveal(component.path as string)}
              >
                Konumu aç
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()} disabled={busy}>
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
