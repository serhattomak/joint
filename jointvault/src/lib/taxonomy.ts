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

/**
 * Öneriyi mevcut bir ada indirger: `suggested`, `existing` adını içeriyorsa
 * ve fazlalık az ise (ör. "Pizza Tarifi" → "Pizza").
 *
 * Model "pizza tarifi" ve "pizza yapımı" diye iki ayrı kategori üretmesin diye
 * varlık sebebi. Tam eşleşme (matchExisting) zaten `resolveCategories` içinde
 * denendiği için buraya yalnızca içerme gelir.
 *
 * ponytail: sezgisel — eşikler (fazlalık ≤2 token, mevcut ad ≥4 karakter)
 *   ölçülmüş değil, elle seçildi. Yanlış birleşme en kötü durumda bir kaydın
 *   yanlış kategoriye oturması; kullanıcı tek tıkla düzeltebilir. Kötü
 *   belirtiler gelirse eşiği sıkılaştır, tam sözlük eşlemesine geç.
 */
export function collapseToExisting(
  suggested: string,
  existing: string[],
): string | null {
  const rawKey = normalizeKey(suggested);
  if (!rawKey) return null;
  const extraTokens = tokensOf(suggested).length;

  let best: { name: string; extra: number } | null = null;
  for (const name of existing) {
    const key = normalizeKey(name);
    if (!key || key.length < 4) continue;
    // Tam eşleşme bu fonksiyonun işi değil; burada yalnızca içerme.
    if (!rawKey.includes(key)) continue;
    const extra = extraTokens - tokensOf(name).length;
    if (extra <= 0 || extra > 2) continue;
    if (!best || extra < best.extra) best = { name, extra };
  }
  return best?.name ?? null;
}

/** Eşleştirme anahtarı: tr-lower + aksan katlama + noktalama sadeleştirme.
 *  Harf/rakam (her alfabe), `+` ve `#` korunur → "C" ≠ "C++" ≠ "C#". */
export function normalizeKey(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/[ışğüöçâîû]/g, (ch) => FOLD[ch] ?? ch)
    .replace(/[^\p{L}\p{N}\p{M}+#]+/gu, ' ')
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
  const t = raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
  if (!t) return null;
  return t.slice(0, 40).trim();
}

/** Hiyerarşi bilgisiyle bir kategori. `parent` verilmezse kök kabul edilir. */
export interface TaxonomyCategory {
  name: string;
  parent: string | null;
}

/**
 * Kategori önerilerini mevcuda eşler; eşleşmeyenleri **yalnızca** güven eşiği
 * üstündeyse ve `maxNew` sınırında yeni olarak kabul eder.
 *
 * Hiyerarşi kuralı: **bir kayıt yalnızca çocuk kategoriye bağlanır.** Öneri
 * bir üst kategori adıysa ve o üstün altı varsa, üst reddedilir — çünkü
 * kayıt, üstün altındaki hangi çocuğa ait olacağı belirsizdir. Böylece
 * "Yemek" ve "Pizza" aynı anda atanmaz, veri tek yerde durur.
 *
 * `parents` verilmezse hiyerarşi denetimi yapılmaz (düz taksonomi, geriye
 * dönük uyum).
 */
export function resolveCategories(
  suggested: string[],
  existing: string[],
  opts: {
    confidence: number;
    minConfidence: number;
    maxNew?: number;
    maxTotal?: number;
    /** Kategori adı → üst adı. Üstü olmayanlar köktür. */
    parents?: Map<string, string>;
  },
): { names: string[]; newNames: string[] } {
  const maxNew = opts.maxNew ?? 1;
  const maxTotal = opts.maxTotal ?? 2;
  const parents = opts.parents;
  const names: string[] = [];
  const newNames: string[] = [];
  const seen = new Set<string>();

  /** Üst adı, en az bir altı varsa atama için elenir. */
  const isBareParent = (name: string): boolean => {
    if (!parents) return false;
    const key = normalizeKey(name);
    for (const [child, parent] of parents) {
      if (normalizeKey(parent) === key && normalizeKey(child) !== key) return true;
    }
    return false;
  };

  for (const s of suggested) {
    if (names.length >= maxTotal) break;
    const raw = String(s ?? '').replace(/\s+/g, ' ').trim();
    if (!raw) continue;

    // Sıra önemli: tam eşleşme → içerme ("Pizza Tarifi" → "Pizza") → yeni.
    const existingMatch = matchExisting(raw, existing) ?? collapseToExisting(raw, existing);
    const name = existingMatch ?? raw.slice(0, 60).trim();
    const key = normalizeKey(name);
    if (!key || seen.has(key)) continue;

    if (existingMatch) {
      if (isBareParent(name)) continue;
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

/**
 * Etiket önerilerini normalize eder, mevcuda eşler, tekilleştirir ve sınırlar.
 *
 * Etiket **son tercihtir**: mevcut listeden eşleşenler her zaman alınır, ama
 * YENİ etiket yalnızca iki koşul birlikte sağlanırsa kabul edilir —
 * güven eşiği geçilmiş **ve** `gerekce` boş değil (model etiketin kaydı
 * gerçekten tanımladığını savunmak zorundadır). Aksi halde taksonomi
 * her işlenen kayıtla bir etiket daha birikir.
 */
export function resolveTags(
  suggested: string[],
  existing: string[],
  opts?: {
    max?: number;
    /** Yeni etiket için güven eşiği. Verilmezse yeni etiket kabul edilmez. */
    minConfidence?: number;
    confidence?: number;
    /** Yeni etiketlerin gerekçesi; anahtarla eşleşir. */
    reasons?: Record<string, string>;
    maxNew?: number;
  },
): string[] {
  const max = opts?.max ?? 5;
  const minConfidence = opts?.minConfidence;
  const confidence = opts?.confidence ?? 0;
  const reasons = opts?.reasons ?? {};
  const maxNew = opts?.maxNew ?? 1;
  const out: string[] = [];
  const seen = new Set<string>();
  let newCount = 0;

  for (const s of suggested) {
    const norm = normalizeTag(String(s ?? ''));
    if (!norm) continue;
    const existingMatch = matchExisting(norm, existing);
    const name = existingMatch ?? norm;
    const key = normalizeKey(name);
    if (!key || seen.has(key)) continue;

    if (!existingMatch) {
      // Yeni etiket: güven + gerekçe olmadan taksonomiye girmez.
      if (minConfidence === undefined) continue;
      if (confidence < minConfidence) continue;
      if (newCount >= maxNew) continue;
      const reason = (reasons[name] ?? reasons[norm] ?? '').trim();
      if (!reason) continue;
      newCount++;
    }

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
    // Boşluk hariç en az 3 karakter: "a b" gibi tek-harfli token'lar eşleşmez.
    if (key.replace(/ /g, '').length < 3) return false;
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

/** Model yanıtındaki alanları güvenle okur; eksik/yanlış tipte çökmez.
 *
 *  Alan adları Türkçedir (`ai.rs` prompt sözleşmesiyle birebir aynı):
 *  `kategori` tek seviye ad, `yeni` ise `{ust, alt}` ile önerilen hiyerarşi. */
export function normalizeLlmSuggestion(raw: unknown): {
  categories: string[];
  tags: string[];
  summary: string;
  confidence: number;
  newCategory: { parent: string; child: string } | null;
  newTagReason: Record<string, string>;
} {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [];

  // Yeni etiket ayrı alanda gelir; mevcut etiketlerin arasına karışmasın.
  const newTag = str(r.yeni_etiket ?? r.yeniEtiket);
  const allTags = newTag ? [...tags, newTag] : tags;

  const yeni = (typeof r.yeni === 'object' && r.yeni !== null ? r.yeni : {}) as Record<
    string,
    unknown
  >;
  const ust = str(yeni.ust);
  const alt = str(yeni.alt);
  const newCategory = ust && alt ? { parent: ust, child: alt } : null;

  // Eski şema (`categories`) yalnızca geçiş için: yeni alan yoksa okunur.
  const kategori = str(r.kategori);
  const categories = kategori
    ? [kategori]
    : Array.isArray(r.categories)
      ? r.categories.filter((c): c is string => typeof c === 'string')
      : [];

  return {
    categories,
    tags: allTags,
    summary: str(r.summary),
    confidence:
      typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? r.confidence : 0,
    newCategory,
    newTagReason: newTag ? { [newTag]: str(r.yeni_etiket_gerekce ?? r.yeniEtiketGerekce) } : {},
  };
}

/** Önerinin otomatik uygulanıp uygulanmayacağı (deterministik/both her zaman; llm eşikle). */
export function shouldAutoApply(
  source: 'deterministic' | 'llm' | 'both' | 'none',
  confidence: number,
  enabled: boolean,
  threshold: number,
): boolean {
  if (!enabled) return false;
  if (source === 'deterministic' || source === 'both') return true;
  return confidence >= threshold;
}
