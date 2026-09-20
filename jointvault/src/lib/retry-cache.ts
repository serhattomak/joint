/*
 * Tek-uçuşlu, hatayı CACHE'LEMEYEN yükleyici.
 *
 * Neden gerekli: `getDb()` reddedilen promise'i saklıyordu. DB bir kez
 * açılamadığında (kilitli, yarım yazılmış, izin sorunu) oturumun tamamı o
 * hataya bağlanıyor ve kullanıcının "yeniden dene" yolu kalmıyordu — uygulama
 * boş kabuk olarak kalıyordu.
 *
 * Doğru davranış: aynı anda gelen çağrılar tek yükleme paylaşır (tek-uçuş),
 * başarı önbelleğe alınır, **başarısızlık alınmaz** — bir sonraki çağrı
 * yeniden dener.
 */

export interface RetryCache<T> {
  get: () => Promise<T>;
  /** Önbelleği unutturur; sonraki `get` yeniden yükler. */
  reset: () => void;
}

export function createRetryCache<T>(load: () => Promise<T>): RetryCache<T> {
  let pending: Promise<T> | null = null;

  return {
    get(): Promise<T> {
      if (!pending) {
        pending = load().catch((error: unknown) => {
          pending = null;
          throw error;
        });
      }
      return pending;
    },
    reset(): void {
      pending = null;
    },
  };
}
