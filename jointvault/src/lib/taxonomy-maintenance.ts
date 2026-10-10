/**
 * Taksonomi bakımı yardımcıları (SAF).
 *
 * Yinelenen kategori/etiket adlarını gruplar ve LLM'in önerdiği yakın-anlam
 * gruplarını savunmacı biçimde ayrıştırır. DB/IPC yoktur; Node'da test edilir.
 */
import { normalizeKey } from './taxonomy';

/* --- Yeniden yapılandırma planı (tek seferlik, kullanıcı onaylı) --- */

/** Bir kaynak kategorinin gideceği yer. */
export interface RestructMove {
  /** Kaynak adı — girdi listesinde BİREBİR bulunmalı. */
  from: string;
  /** Hedef alt ad; boşsa kategori kök kalır. */
  toChild: string;
  /** Hedef üst ad; `toChild` boşsa yok sayılır. */
  toParent: string;
}

export interface RestructPlan {
  moves: RestructMove[];
  /** Birleştirilecek kaynaklar → kanonik hedef ad. */
  merges: { canonical: string; duplicates: string[] }[];
}

export interface RestructCheck {
  ok: boolean;
  /** Modelin görmediği/uyumsuz döndürdüğü kaynak adlar. */
  missing: string[];
  /** Aynı kaynak iki kez atanmışsa işaretlenir. */
  duplicated: string[];
}

/**
 * LLM'in döndürdüğü planı GİRDİYE karşı doğrular — kullanıcı onayından önceki
 * zorunlu kapı.
 *
 * Model listede olmayan bir ad uydurursa (`pizza tarafi`), uygulama onu
 * `getOrCreateCategory` ile **yeniden açardı**: kasada aslında hiç olmayan bir
 * kategori doğardı ve taşıma sessizce kaybolurdu. Bu yüzden bilinmeyen ad
 * işlemden düşer.
 */
export function validateRestructPlan(inputNames: string[], plan: RestructPlan): RestructCheck {
  const known = new Set(inputNames.map((n) => normalizeKey(n)));
  const seen = new Set<string>();
  const missing: string[] = [];
  const duplicated: string[] = [];

  for (const m of plan.moves) {
    const key = normalizeKey(m.from);
    if (!known.has(key)) {
      missing.push(m.from);
      continue;
    }
    if (seen.has(key)) duplicated.push(m.from);
    seen.add(key);
  }

  return { ok: missing.length === 0 && duplicated.length === 0, missing, duplicated };
}

/**
 * LLM'in ham metnini plana çevirir.
 *
 * `moves.from` ve `merges.duplicates` **kaynak** adlardır: girdi listesinde
 * olmalı, kanonik yazımla döner. `toChild`/`toParent`/`merges.canonical` ise
 * **hedef** adlardır — henüz kasada olmayabilirler, çünkü planın amacı tam da
 * onları oluşturmaktır; bu yüzden listeden geçirilmezler, yalnızca boşsa
 * düşürülürler.
 *
 * Bozuk JSON, bilinmeyen alan veya eksik eleman çökmez — eleman atlanır.
 */
export function parseRestructPlan(text: string, known: string[]): RestructPlan {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return { moves: [], merges: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { moves: [], merges: [] };
  }
  if (typeof parsed !== 'object' || parsed === null) return { moves: [], merges: [] };

  const canonByKey = new Map<string, string>();
  for (const k of known) {
    const key = normalizeKey(k);
    if (!canonByKey.has(key)) canonByKey.set(key, k);
  }
  /** Kaynak adı: girdide olmalı. */
  const canon = (v: unknown): string | null =>
    typeof v === 'string' ? (canonByKey.get(normalizeKey(v)) ?? null) : null;
  /** Hedef adı: yeni olabilir; yalnızca boşluk temizlenir. */
  const target = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

  const r = parsed as Record<string, unknown>;

  const moves: RestructMove[] = [];
  for (const m of Array.isArray(r.moves) ? r.moves : []) {
    if (typeof m !== 'object' || m === null) continue;
    const o = m as Record<string, unknown>;
    const from = canon(o.from);
    if (!from) continue;
    moves.push({ from, toChild: target(o.toChild), toParent: target(o.toParent) });
  }

  const merges: RestructPlan['merges'] = [];
  for (const m of Array.isArray(r.merges) ? r.merges : []) {
    if (typeof m !== 'object' || m === null) continue;
    const o = m as Record<string, unknown>;
    const canonical = target(o.canonical);
    if (!canonical) continue;
    const duplicates = Array.isArray(o.duplicates)
      ? o.duplicates.map(canon).filter((d): d is string => !!d && normalizeKey(d) !== normalizeKey(canonical))
      : [];
    if (duplicates.length > 0) merges.push({ canonical, duplicates });
  }

  return { moves, merges };
}

export interface DuplicateGroup {
  canonical: string;
  duplicates: string[];
}

/**
 * Türkçeye özgü harfler: aksanlı küçük/büyük sesliler ile noktalı/noktasız `i`
 * çifti. Noktasız büyük `I` de sayılır — Türkçede `ı`'nın büyüğüdür.
 */
const TURKISH_LETTERS = /[ıİIşŞğĞüÜöÖçÇ]/g;

/**
 * Adda Türkçeye özgü harf sayısı: "Yazılım" = 2, "Yazilim" = 0.
 *
 * Neden önemli: kullanıcı `Yazilim`'ı 200 kayıtta, `Yazılım`'ı 2 kayıtta
 * kullanıyor olabilir; birleştirmede **doğru Türkçe yazım** kazanmalı.
 */
export function turkishScore(name: string): number {
  return (name.match(TURKISH_LETTERS) ?? []).length;
}

/** Düzgün harf durumu: ne tümü küçük, ne tümü büyük. Harfsizse düzgün değil. */
function isProperCased(name: string): boolean {
  const letters = name.replace(/[^\p{L}]/gu, '');
  if (!letters) return false;
  return (
    letters !== letters.toLocaleLowerCase('tr-TR') &&
    letters !== letters.toLocaleUpperCase('tr-TR')
  );
}

/**
 * Bir grup içindeki yazım varyantlarından kanonik olanı seçer.
 *
 * Sıra (yüksek öncelik önce): imlâ (`turkishScore` ↓) → düzgün harf durumu ↓ →
 * kullanım sayısı ↓ → ad (↑). Son anahtar `ad`'dır: tam eşitlikte bile sonuç
 * **belirlidir**, girdi sırasına bağlı kalmaz.
 *
 * Boş dizide çağıran hatasıdır; sessizce `''` döndürmek yanlış ad yazar.
 */
export function preferCanonical(candidates: { name: string; count?: number }[]): string {
  if (candidates.length === 0) throw new Error('preferCanonical: aday listesi boş olamaz');

  const proper = (n: string): number => (isProperCased(n) ? 1 : 0);
  return [...candidates].sort(
    (a, b) =>
      turkishScore(b.name) - turkishScore(a.name) ||
      proper(b.name) - proper(a.name) ||
      (b.count ?? 0) - (a.count ?? 0) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  )[0].name;
}

/**
 * Aynı `normalizeKey`'e düşen adları gruplar. Kanonik = `preferCanonical`
 * (imlâ > harf durumu > kullanım > ad). Yalnızca >1 üyeli gruplar döner.
 */
export function duplicateGroups(
  entries: { name: string; count?: number }[],
): DuplicateGroup[] {
  const groups = new Map<string, { name: string; count?: number }[]>();
  for (const e of entries) {
    const key = normalizeKey(e.name);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  const out: DuplicateGroup[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const canonical = preferCanonical(list);
    out.push({
      canonical,
      duplicates: list.map((x) => x.name).filter((n) => n !== canonical),
    });
  }
  return out;
}

/**
 * LLM yanıtından yakın-anlam gruplarını ayıklar.
 *
 * Yalnızca `known` içindeki adlar (normalizeKey ile eşleşen, kanonik yazımla)
 * kabul edilir; tek-elemanlı gruplar atılır; bozuk/eksik JSON'da `[]`.
 */
export function parseMergeSuggestions(text: string, known: string[]): string[][] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const canonByKey = new Map<string, string>();
  for (const k of known) {
    const key = normalizeKey(k);
    // İlk atama korunur; matchExisting ile aynı "ilk eşleşen" semantiği.
    if (!canonByKey.has(key)) canonByKey.set(key, k);
  }

  const out: string[][] = [];
  for (const entry of parsed) {
    if (!Array.isArray(entry)) continue;
    const names: string[] = [];
    for (const item of entry) {
      if (typeof item !== 'string') continue;
      const canon = canonByKey.get(normalizeKey(item));
      if (canon && !names.includes(canon)) names.push(canon);
    }
    if (names.length >= 2) out.push(names);
  }
  return out;
}
