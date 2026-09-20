/*
 * Şema metnini sırayla çalıştırılacak ifadelere böler.
 *
 * `execute()` çok ifadeli metni kabul etmeyebildiği için şema ';' ile bölünür.
 * Bir yorumun İÇİNDEKİ ';' parçayı ortadan keser: kesilen artık satır yorum
 * olmaktan çıkar ve sözdizimi hatası verir. Bu tam olarak yaşandı — initDb
 * patladı, getDb() reddetti ve uygulama hiçbir kaydı gösteremedi. Satır
 * yorumlarını bölmeden önce düşürmek bu hata sınıfını tümden kapatır.
 *
 * Bilerek saf: Tauri'ye bağlı değil, bu yüzden test edilebilir (client.ts edemez).
 */

/** Yalnızca-yorum satırlarını düşürür; satır sonundaki satır içi yorumlara dokunmaz. */
export const stripCommentLines = (sql: string): string => sql.replace(/^[ \t]*--[^\n]*$/gm, '');

/** Şemayı çalıştırılacak ifadelere böler; boş parçaları atar. */
export const splitSqlStatements = (sql: string): string[] =>
  stripCommentLines(sql)
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
