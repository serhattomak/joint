/*
 * Hata metni — kullanıcıya gösterilecek tek satıra çevirir.
 *
 * Tauri bazen string, bazen Error fırlatır; ikisi de taşınabilir olmalı.
 * Aynı dönüşüm birkaç dosyada kopyalanmıştı, burada tek yerde durur.
 */
export const describeError = (error: unknown, fallback = 'bilinmeyen hata'): string => {
  if (typeof error === 'string' && error.trim().length > 0) return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};
