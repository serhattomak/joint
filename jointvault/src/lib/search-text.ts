/**
 * Arşiv araması için tek normalizasyon noktası.
 *
 * SQLite'ın `NOCASE` eşleşmesi yalnızca ASCII'de çalışır: `Şarkı` ile `şarkı`
 * eşleşmez, `I` ile `ı` ayrı harf sayılır. Bu yüzden yazma anında Türkçe
 * küçültme + aksan katlama yapılır ve arama bu normalize metin üzerinden
 * yürür. Aynı kural hem `items.search_text` hem sorgu tarafında kullanılır.
 */
const TR_FOLD: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

export function normalizeSearchText(...parts: Array<string | null | undefined>): string {
  return parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(' ')
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâîû]/g, (ch) => TR_FOLD[ch] ?? ch)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `LIKE` deseninde kullanıcı girdisini joker olmaktan çıkarır. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
