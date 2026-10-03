/**
 * Taksonomi bakımı yardımcıları (SAF).
 *
 * Yinelenen kategori/etiket adlarını gruplar ve LLM'in önerdiği yakın-anlam
 * gruplarını savunmacı biçimde ayrıştırır. DB/IPC yoktur; Node'da test edilir.
 */
import { normalizeKey } from './taxonomy';

export interface DuplicateGroup {
  canonical: string;
  duplicates: string[];
}

/**
 * Aynı `normalizeKey`'e düşen adları gruplar. Kanonik = en yüksek `count`
 * (eşitlikte en kısa ad, yoksa ilk). Yalnızca >1 üyeli gruplar döner.
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
    const canonical = [...list].sort((a, b) => {
      const ca = a.count ?? 0;
      const cb = b.count ?? 0;
      if (cb !== ca) return cb - ca;
      return a.name.length - b.name.length;
    })[0];
    out.push({
      canonical: canonical.name,
      duplicates: list.filter((x) => x !== canonical).map((x) => x.name),
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
