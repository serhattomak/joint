/*
 * Veritabanı başlatma hatalarının sınıflandırılması.
 *
 * "Bir şeyler ters gitti" demek yetmez: kullanıcı ne yapacağını bilmeli.
 * Kilitli dosya beklemekle geçebilir, bozuk dosya yedekten dönmeyi gerektirir,
 * izin sorunu başka bir yeri işaret eder. Sınıflandırma bu yüzden var.
 *
 * Bilerek saf: Tauri'ye bağlı değil, bu yüzden test edilebilir.
 */

export type DbInitErrorKind = 'locked' | 'corrupt' | 'unwritable' | 'schema' | 'unknown';

export interface DbInitError {
  kind: DbInitErrorKind;
  /** Kullanıcıya gösterilecek cümle. */
  message: string;
  /** Ham hata metni (katlanır ayrıntı bölümünde). */
  detail: string;
}

const MESSAGES: Record<DbInitErrorKind, string> = {
  locked: 'Arşiv veritabanı başka bir süreç tarafından kilitlenmiş görünüyor.',
  corrupt: 'Arşiv veritabanı dosyası okunamıyor (bozulmuş olabilir).',
  unwritable: 'Arşiv veritabanına yazılamıyor — klasör izinlerini kontrol et.',
  schema: 'Arşiv veritabanının yapısı beklenenden farklı.',
  unknown: 'Arşiv veritabanı açılamadı.',
};

const PATTERNS: { kind: DbInitErrorKind; test: RegExp }[] = [
  { kind: 'locked', test: /database is locked|is locked|busy/i },
  { kind: 'corrupt', test: /not a database|malformed|corrupt|encrypted/i },
  { kind: 'unwritable', test: /readonly|read-only|permission denied|access is denied|unable to open database file|os error 5/i },
  { kind: 'schema', test: /no such table|no such column|syntax error/i },
];

const toDetail = (error: unknown): string => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const classifyDbError = (error: unknown): DbInitError => {
  const detail = toDetail(error);
  const match = PATTERNS.find((p) => p.test.test(detail));
  const kind = match?.kind ?? 'unknown';
  return { kind, message: MESSAGES[kind], detail };
};
