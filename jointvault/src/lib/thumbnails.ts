import { convertFileSrc, invoke } from '@tauri-apps/api/core';

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
