/**
 * Toplu taksonomi temizliğinin SAF karar mantığı (DB/IPC yok).
 *
 * Buradaki tek soru: kullanıcı onay diyaloğunda ne yazacak, ve ne zaman
 * onay diyaloğu hiç açılmamalı. Yanlış sayı gösterip sonra başka sayı
 * silmek, kullanıcının güvenini yıkar.
 */

/** Silme öncesi sayım — onay metni bu sayılardan kurulur. */
export interface PurgePreview {
  /** Silinecek kategori/etiket adedi. */
  count: number;
  /** Etkilenecek kayıt adedi (bağı düşecek olanlar). */
  affectedItems: number;
  /** Hiçbir şey yoksa buton devre dışı kalmalı. */
  canPurge: boolean;
}

/** Silme işleminin uygulanıp uygulanmayacağı ve neden. */
export interface PurgeDecision {
  ok: boolean;
  /** Kullanıcıya gösterilecek gerekçe (onay reddedildiğinde). */
  reason: string | null;
}

/**
 * Bakım penceresindeki tek tek silmeden sonra kalan son durumdan sayım üretir.
 *
 * `count` kategori/etiket satırlarını, `affectedItems` **bağı olan** kayıtları
 * sayar — hiyerarşi öncesi ve sonrası aynı kural: bağı olmayan kategori silinir
 * ama kullanıcıya "kayıt etkilendi" denmemeli.
 */
export function purgePreview(
  entries: { count?: number }[],
  affectedItems: number,
): PurgePreview {
  const count = entries.length;
  return { count, affectedItems, canPurge: count > 0 };
}

/**
 * Onay kararı. Yedek alınmadan silme yapılmaz — geri alınamaz işlem.
 */
export function purgeDecision(preview: PurgePreview, backupTaken: boolean): PurgeDecision {
  if (!preview.canPurge) {
    return { ok: false, reason: 'Silinecek kategori ya da etiket yok.' };
  }
  if (!backupTaken) {
    return { ok: false, reason: 'Yedek alınmadan toplu silme yapılamaz.' };
  }
  return { ok: true, reason: null };
}

/** Onay diyaloğunun metni — ne silineceğini ve geri alınamazlığı söyler. */
export function purgeConfirmText(
  kind: 'categories' | 'tags',
  preview: PurgePreview,
): string {
  const adet = preview.count.toLocaleString('tr-TR');
  const kayit = preview.affectedItems.toLocaleString('tr-TR');
  const ad = kind === 'categories' ? 'kategori' : 'etiket';

  if (preview.affectedItems === 0) {
    return (
      `${adet} ${ad} silinecek. Hiçbiri bir kayda bağlı değil, bu yüzden kayıt etkilenmez. ` +
      'İşlem geri alınamaz.'
    );
  }

  return (
    `${adet} ${ad} ve ${kayit} kayıt bağlantısı silinecek. ` +
    'Kayıtların kendisi SİLİNMEZ, yalnız bu bağları kalkar. İşlem geri alınamaz; önce yedek alınır.'
  );
}