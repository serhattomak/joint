/*
 * Çökme ve başlatma hatası ekranı.
 *
 * Eskiden hata olduğunda uygulama ya boş bir kabuk ya da sonsuz iskelet
 * gösteriyordu: kullanıcı ne olduğunu bilmiyor, elinden bir şey gelmiyordu.
 * Bu ekran ne olduğunu söyler ve iki çıkış yolu verir — yeniden dene, veri
 * klasörünü aç.
 */
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, ChevronDown, ChevronRight, FolderOpen, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/errors';
import { useOpenTarget } from '@/lib/open-target';

export interface CrashScreenProps {
  title: string;
  message: string;
  /** Ham hata; katlanır ayrıntı bölümünde gösterilir. */
  detail?: string;
  onRetry?: () => void;
}

export function CrashScreen({ title, message, detail, onRetry }: CrashScreenProps) {
  const { reveal } = useOpenTarget();
  const [showDetail, setShowDetail] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

  const openDataFolder = async (): Promise<void> => {
    setFolderError(null);
    try {
      reveal(await invoke<string>('app_data_path'));
    } catch (error) {
      /* Ham Tauri hatası tek başına belirsiz olabilir; ne yapılmak istendiğini de yaz. */
      setFolderError(`Veri klasörü açılamadı: ${describeError(error)}`);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-lg border border-border bg-card p-6 shadow-lift">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <Button size="sm" className="gap-1.5" onClick={onRetry}>
              <RotateCw className="size-3.5" /> Yeniden dene
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void openDataFolder()}
          >
            <FolderOpen className="size-3.5" /> Veri klasörünü aç
          </Button>
        </div>

        {folderError && <p className="text-sm text-destructive">{folderError}</p>}

        {detail && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setShowDetail((open) => !open)}
              aria-expanded={showDetail}
              className="flex w-fit items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
            >
              {showDetail ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              Ayrıntı
            </button>
            {showDetail && (
              <pre className="max-h-40 overflow-auto rounded-sm border border-border bg-muted/40 p-2 font-mono text-2xs whitespace-pre-wrap">
                {detail}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
