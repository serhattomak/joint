/*
 * Yedekleme ve kurtarma (arayüz tarafı).
 *
 * Yedek ÜRETİMİ `VACUUM INTO` ile yapılır: düz dosya kopyası WAL'de bekleyen
 * commit'leri kaçırabilir; VACUUM tutarlı bir anlık görüntü üretir ve var olan
 * dosyanın üzerine yazmayı reddeder (kazara yedek ezme yok).
 *
 * Liste/geri dönme/sıfırlama dosya işidir ve Rust tarafında yapılır.
 *
 * DİKKAT — bu modül `client.ts`'i İÇE AKTARMAZ (döngü olurdu): yedeklenecek
 * bağlantı parametre olarak gelir. Geri dönme/sıfırlama, canlı dosyanın
 * üzerine yazdığı için çağıran ÖNCE `closeDb()` çağırmalıdır; açık bir SQLite
 * dosyası kilitlidir ve Windows'ta üzerine yazma başarısız olur.
 */
import { invoke } from '@tauri-apps/api/core';
import type Database from '@tauri-apps/plugin-sql';

export interface BackupInfo {
  name: string;
  size_bytes: number;
  modified_ms: number;
}

/** Listeden en yeni `keep` tanesini bırakıp silinecekleri döndürür. */
export const selectBackupsToPrune = (backups: BackupInfo[], keep: number): BackupInfo[] =>
  keep <= 0 ? [...backups] : backups.slice(keep);

/** `jointvault-20260920-153045.db` biçiminde okunur damga. */
export const backupFileName = (date: Date = new Date()): string => {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `jointvault-${stamp}.db`;
};

const backupsDir = (): Promise<string> => invoke<string>('backups_path');

/** Yedek klasörünün yolu (yoksa Rust tarafı oluşturur). */
export const backupsPath = (): Promise<string> => backupsDir();

/**
 * Yedeği verilen bağlantıyla alır (göç öncesi kanca gibi "elde bağlantı
 * varken" çağrılan yerler için).
 */
export async function createBackupWith(db: Database, date: Date = new Date()): Promise<string> {
  const dir = await backupsDir();
  const name = backupFileName(date);
  await db.execute('VACUUM INTO $1', [`${dir.replace(/\\/g, '/')}/${name}`]);
  return name;
}

/** Uygulama açıkken yedek alır (çağıran bağlantıyı verir). */
export async function createBackup(db: Database): Promise<string> {
  return createBackupWith(db);
}

export async function listBackups(): Promise<BackupInfo[]> {
  return invoke<BackupInfo[]>('list_backups');
}

/** Son `keep` yedeği bırakır; silinenlerin adlarını döndürür. */
export async function pruneBackups(keep = 5): Promise<string[]> {
  const backups = await listBackups();
  const stale = selectBackupsToPrune(backups, keep);
  for (const backup of stale) {
    await invoke('delete_backup', { name: backup.name });
  }
  return stale.map((backup) => backup.name);
}

/**
 * Yedekten geri döner. Çağıran ÖNCE `closeDb()` çağırmış olmalıdır.
 * Mevcut arşiv Rust tarafında `pre-restore-<damga>.db` olarak saklanır; dönen
 * değer o güvenlik kopyasının adıdır, böylece yanlış yedek seçilirse geri
 * dönülebilir.
 */
export async function restoreBackup(name: string): Promise<string> {
  return invoke<string>('restore_backup', { name });
}

/**
 * Arşivi sıfırlar. Çağıran ÖNCE `closeDb()` çağırmış olmalıdır.
 * Yedeği çağıran alır (zorunlu adım); burada dosya silinir ve bir sonraki
 * `getDb()` şemayı sıfırdan kurar.
 */
export async function resetDatabase(): Promise<void> {
  await invoke('reset_database');
}

/** Verilen andan sonra alınmış yedek var mı? */
export const wasBackedUpSince = (backups: BackupInfo[], sinceMs: number): boolean =>
  backups.some((backup) => backup.modified_ms >= sinceMs);

/** Bugünün başlangıcı (yerel saat): "günde bir" kuralının eşiği. */
export const startOfToday = (now: Date = new Date()): number =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

/**
 * Açılış yedeği: günde en fazla bir kez, son 5 kopya kalacak şekilde.
 *
 * "Bugün yedek alındı mı" sorusu bir İŞARETE değil, **mevcut yedeklere**
 * sorulur. İşaret tutmak (ör. localStorage) arşive değil profile bağlı olurdu:
 * arşiv değişince ya da geri dönüldüğünde yanlış cevap verirdi.
 */
export async function runDailyBackupIfDue(db: Database): Promise<string | null> {
  const existing = await listBackups();
  if (wasBackedUpSince(existing, startOfToday())) return null;

  const name = await createBackup(db);
  await pruneBackups(5).catch(() => undefined);
  return name;
}
