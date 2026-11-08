import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listItemsWithRemoteThumbnail, updateItem } from './db/client';

/**
 * Uzak kapak URL'sini yerel önbelleğe indirir ve `asset:` URL'si döndürür.
 * Başarısız olursa orijinal URL korunur: kapak yüzünden kayıt engellenmez.
 */
export async function cacheThumbnail(
  itemId: string,
  url: string | null,
): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return url;
  try {
    const path = await invoke<string>('cache_thumbnail', { url, itemId });
    return convertFileSrc(path);
  } catch {
    return url;
  }
}

/**
 * Eski kayıtların uzak kapaklarını arka planda yerelleştirir.
 * Oturum başına en fazla `limit` kayıt: açılışı ve ağı bloke etmez; kalanlar
 * sonraki açılışta tamamlanır. Hata tek tek yutulur, kapak yüzünden akış durmaz.
 */
export async function backfillThumbnails(limit = 100): Promise<number> {
  const rows = await listItemsWithRemoteThumbnail(limit);
  if (rows.length === 0) return 0;

  const queue = [...rows];
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const row = queue.shift();
      if (!row) return;
      const local = await cacheThumbnail(row.id, row.thumbnail);
      if (local && local !== row.thumbnail) {
        try {
          await updateItem(row.id, { thumbnail: local });
          done++;
        } catch {
          // tek kayıt başarısızsa diğerleri devam eder
        }
      }
    }
  };

  await Promise.all([worker(), worker()]);
  return done;
}
