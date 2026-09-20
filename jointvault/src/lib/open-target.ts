/*
 * Dosyayı aç / klasörde göster — hata görünür.
 *
 * `openPath` ve `revealItemInDir` reddedebilir: izin yok, dosya silinmiş, yol
 * geçersiz. Eskiden bu red sessizdi — düğmeye basarsın, hiçbir şey olmaz,
 * hiçbir şey söylenmez. Burada tek yerde yakalanıp bildirime çevrilir.
 */
import { useCallback } from 'react';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { useNotice } from '@/components/ui/notice';
import { describeError } from './errors';

export interface OpenTargetActions {
  open: (path: string) => void;
  reveal: (path: string) => void;
}

export function useOpenTarget(): OpenTargetActions {
  const notice = useNotice();

  const open = useCallback(
    (path: string): void => {
      void openPath(path).catch((error: unknown) => {
        notice.push({ text: `Dosya açılamadı: ${describeError(error)}`, tone: 'error' });
      });
    },
    [notice],
  );

  const reveal = useCallback(
    (path: string): void => {
      void revealItemInDir(path).catch((error: unknown) => {
        notice.push({ text: `Klasörde gösterilemedi: ${describeError(error)}`, tone: 'error' });
      });
    },
    [notice],
  );

  return { open, reveal };
}
