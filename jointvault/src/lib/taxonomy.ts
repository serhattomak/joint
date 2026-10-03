/**
 * Taksonomi normalizasyonu ve mevcut adlara eşleme (SAF).
 *
 * Amaç: modelin ürettiği kategori/etiketleri mevcut taksonomiye harf/aksan/tire
 * duyarsız biçimde bağlamak, çoğalmayı önlemek ve deterministik ön geçişle
 * LLM'siz eşleşme sağlamak. Ağ/DB yoktur; Node'da test edilebilir.
 */

const FOLD: Record<string, string> = {
  ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u',
};

/** Eşleştirme anahtarı: tr-lower + aksan katlama + noktalama sadeleştirme. */
export function normalizeKey(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/[ışğüöçâîû]/g, (ch) => FOLD[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const tokensOf = (s: string): string[] => normalizeKey(s).split(' ').filter(Boolean);

/** `existing` içinde normalizeKey eşleşenin **kanonik** (DB'deki) adını döndürür. */
export function matchExisting(raw: string, existing: string[]): string | null {
  const key = normalizeKey(raw);
  if (!key) return null;
  return existing.find((e) => normalizeKey(e) === key) ?? null;
}

/** Etiketi normalleştirir: `#` sök, sadeleştir, tr-lower, ≤40; boşsa null. */
export function normalizeTag(raw: string): string | null {
  const t = raw.replace(/^#+/, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
  if (!t) return null;
  return t.slice(0, 40).trim();
}

/**
 * Kategori önerilerini mevcuda eşler; eşleşmeyenleri **yalnızca** güven eşiği
 * üstündeyse ve `maxNew` sınırında yeni olarak kabul eder.
 */
export function resolveCategories(
  suggested: string[],
  existing: string[],
  opts: { confidence: number; minConfidence: number; maxNew?: number },
): { names: string[]; newNames: string[] } {
  const maxNew = opts.maxNew ?? 1;
  const names: string[] = [];
  const newNames: string[] = [];
  const seen = new Set<string>();

  for (const s of suggested) {
    const raw = String(s ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;

    const existingMatch = matchExisting(raw, existing);
    const name = existingMatch ?? raw.slice(0, 60).trim();
    const key = normalizeKey(name);
    if (!key || seen.has(key)) continue;

    if (existingMatch) {
      seen.add(key);
      names.push(existingMatch);
    } else if (opts.confidence >= opts.minConfidence && newNames.length < maxNew) {
      seen.add(key);
      names.push(name);
      newNames.push(name);
    }
  }

  return { names, newNames };
}

/** Etiket önerilerini normalize eder, mevcuda eşler, tekilleştirir ve sınırlar. */
export function resolveTags(
  suggested: string[],
  existing: string[],
  opts?: { max?: number },
): string[] {
  const max = opts?.max ?? 5;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const s of suggested) {
    const norm = normalizeTag(String(s ?? ''));
    if (!norm) continue;
    const name = matchExisting(norm, existing) ?? norm;
    const key = normalizeKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= max) break;
  }

  return out;
}

/** Metinde geçen mevcut taksonomi adlarını (token sınırı, min 3) döndürür. */
export function matchTaxonomyInText(
  text: string,
  categories: string[],
  tags: string[],
): { categories: string[]; tags: string[] } {
  const textTokens = tokensOf(text);
  const tokenSet = new Set(textTokens);

  const includes = (name: string): boolean => {
    const key = normalizeKey(name);
    if (key.length < 3) return false;
    const parts = key.split(' ').filter(Boolean);
    if (parts.length === 0) return false;
    if (parts.length === 1) return tokenSet.has(parts[0]);
    for (let i = 0; i + parts.length <= textTokens.length; i++) {
      let ok = true;
      for (let j = 0; j < parts.length; j++) {
        if (textTokens[i + j] !== parts[j]) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  };

  return {
    categories: categories.filter(includes),
    tags: tags.filter(includes),
  };
}
