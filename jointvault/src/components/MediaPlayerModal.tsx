import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  FileText,
  FolderOpen,
  MonitorPlay,
  Scissors,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MediaPlayer } from '@/components/MediaPlayer';
import type { Item } from '@/lib/db/types';
import { PLATFORM_META, type Platform } from '@/lib/platform';

interface MediaPlayerModalProps {
  item: Item | null;
  initialTime?: number;
  onClose: () => void;
  onConvert?: (item: Item) => void;
  onOpenItem?: (item: Item) => void;
}

export function MediaPlayerModal({
  item,
  initialTime = 0,
  onClose,
  onConvert,
  onOpenItem,
}: MediaPlayerModalProps) {
  if (!item || !item.local_path) return null;

  const platform = PLATFORM_META[item.platform as Platform] ?? PLATFORM_META.other;

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] max-w-6xl max-h-[92vh] sm:max-w-6xl p-0 flex flex-col overflow-hidden bg-black/95 text-white border border-white/10 shadow-2xl rounded-2xl z-50 focus:outline-none backdrop-blur-md"
      >
        <DialogTitle className="sr-only">{item.title || 'Medya Oynatıcı'}</DialogTitle>
        <DialogDescription className="sr-only">JointVault Sinema Modu Medya Oynatıcısı</DialogDescription>

        {/* Üst Başlık ve Hızlı Eylemler */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-neutral-950/80 px-4 sm:px-6 backdrop-blur-xs">
          {/* Sol: Platform Rozeti ve Başlık */}
          <div className="flex min-w-0 max-w-[55%] items-center gap-2.5">
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-semibold text-white/90">
              <span className={`size-2 rounded-full ${platform.dot}`} />
              <span>{platform.label}</span>
            </span>
            <h3
              className="truncate text-xs font-medium text-white/90 sm:text-sm"
              title={item.title || item.url}
            >
              {item.title || item.url}
            </h3>
          </div>

          {/* Sağ: Yardımcı Butonlar ve Kapat */}
          <div className="flex items-center gap-1 sm:gap-2">
            {onConvert && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onClose();
                        onConvert(item);
                      }}
                      className="h-8 gap-1.5 px-2 text-xs text-white/80 hover:bg-white/15 hover:text-white"
                    />
                  }
                >
                  <Scissors className="size-3.5" />
                  <span className="hidden sm:inline">Kırp / Dönüştür</span>
                </TooltipTrigger>
                <TooltipContent>Kırp / Dönüştür</TooltipContent>
              </Tooltip>
            )}

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void revealItemInDir(item.local_path!)}
                    className="text-white/80 hover:bg-white/15 hover:text-white"
                    aria-label="Dosyayı klasörde göster"
                  />
                }
              >
                <FolderOpen className="size-4" />
              </TooltipTrigger>
              <TooltipContent>Klasörde Göster</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void openPath(item.local_path!)}
                    className="text-white/80 hover:bg-white/15 hover:text-white"
                    aria-label="Sistem oynatıcısında (VLC vb.) aç"
                  />
                }
              >
                <MonitorPlay className="size-4" />
              </TooltipTrigger>
              <TooltipContent>Sistem Oynatıcısında Aç</TooltipContent>
            </Tooltip>

            {onOpenItem && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        onClose();
                        onOpenItem(item);
                      }}
                      className="text-white/80 hover:bg-white/15 hover:text-white"
                      aria-label="Fiş detaylarını incele"
                    />
                  }
                >
                  <FileText className="size-4" />
                </TooltipTrigger>
                <TooltipContent>Fiş Detayları</TooltipContent>
              </Tooltip>
            )}

            <div className="mx-1 h-4 w-px bg-white/15" />

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="text-white/80 hover:bg-white/20 hover:text-white"
              aria-label="Kapat"
              title="Kapat (Esc)"
            >
              <X className="size-4" />
            </Button>
          </div>
        </header>

        {/* Gövde: Medya Oynatıcı */}
        <div className="relative flex flex-1 min-h-[360px] sm:min-h-[480px] max-h-[calc(92vh-7rem)] items-center justify-center bg-black">
          <MediaPlayer
            src={item.local_path}
            poster={item.thumbnail}
            title={item.title || item.url}
            autoPlay
            initialTime={initialTime}
            className="size-full max-h-full"
          />
        </div>

        {/* Alt Kısayol Bilgilendirme Çubuğu */}
        <footer className="flex h-8 shrink-0 items-center justify-center border-t border-white/10 bg-neutral-950/80 px-4 text-3xs text-white/50">
          <span className="hidden sm:inline">
            <span className="font-mono text-white/70">Boşluk</span>: Oynat/Duraklat ·{' '}
            <span className="font-mono text-white/70">← / →</span>: 5 sn sar ·{' '}
            <span className="font-mono text-white/70">↑ / ↓</span>: Ses ·{' '}
            <span className="font-mono text-white/70">M</span>: Sessiz ·{' '}
            <span className="font-mono text-white/70">F</span>: Tam Ekran ·{' '}
            <span className="font-mono text-white/70">Esc</span>: Kapat
          </span>
          <span className="sm:hidden">
            JointVault Medya Oynatıcı
          </span>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
