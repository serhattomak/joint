import type { Item } from './db/types';
import { parseArticleImages, parseArticleVideos } from './scraper';

/**
 * Saf defter yardımcıları: bağlantı çıkarımı, sayfa sıralaması, birleştirme
 * planı, kategori özeti malzemesi. DB/IPC yok — vitest'lenir.
 */

const httpUrl = (s: string): boolean => /^https?:\/\//i.test(s);

/** Makale içinden http(s) bağlantıları: md linkleri + görsel/video url'leri. */
export function extractLinks(
  article: {
    content_markdown?: string | null;
    images_json?: string | null;
    videos_json?: string | null;
  },
): string[] {
  const out: string[] = [];
  const push = (s: string | undefined | null): void => {
    if (s && httpUrl(s) && !out.includes(s)) out.push(s);
  };
  // Markdown link hedefleri: [metin](url)
  const md = article.content_markdown ?? '';
  for (const match of md.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
    push(match[1]);
  }
  for (const media of parseArticleImages(article)) push(media.url);
  for (const media of parseArticleVideos(article)) push(media.url);
  return out;
}

/** Tarih azalan; eşitlikte başlık A→z (determinizm ikincil anahtar). */
export function sortNotebookItems<T extends { created_at: string; title?: string | null }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const byDate = b.created_at.localeCompare(a.created_at);
    if (byDate !== 0) return byDate;
    return (a.title ?? '').localeCompare(b.title ?? 'z', 'tr-TR');
  });
}

export interface MergePatch {
  note: string;
  favorite: boolean;
  title: string | null;
  thumbnail: string | null;
  created_at: string;
  victimIds: string[];
}

/**
 * Birleştirme planı: hedef + artıklardan tek kaydın metaverisi.
 * SQL tarafı (mergeItems) junction union/article taşımayı kendi işi yapar;
 * bu plan yalnız scalar kolonları belirler.
 * `title/thumbnail` null: hedef dolu, taşımaya gerek yok.
 */
export function planItemMerge(target: Item, victims: Item[]): MergePatch {
  const notes = [...victims, target] // hedef notu sonda kalsın
    .map((it) => (it.note && it.note.trim() ? it.note.trim() : null))
    .filter((n): n is string => Boolean(n));
  const fallback = (pick: (v: Item) => string | null): string | null => {
    const own = pick(target);
    if (own && own.trim()) return null;
    for (const v of victims) {
      const value = pick(v);
      if (value && value.trim()) return value;
    }
    return null;
  };
  return {
    note: notes.join('\n\n'),
    favorite: [target, ...victims].some((it) => it.favorite),
    title: fallback((it) => it.title),
    thumbnail: fallback((it) => it.thumbnail),
    created_at: [target, ...victims]
      .map((it) => it.created_at)
      .sort((a, b) => a.localeCompare(b))[0],
    victimIds: victims.map((it) => it.id),
  };
}

/** Sayısal defter özetinin ihtiyaç duyduğu alanlar (saf, DB'siz). */
export interface NumericSummaryItem {
  platform: string;
  local_path?: string | null;
  created_at: string;
}

/**
 * AI kapalıyken defter sayfa özeti: LLM yerine sayısal gerçek. Sayfadaki kayıt
 * sayısı, platform dağılımı, yerel/indirilmedi sayısı ve tarih aralığı tek metne
 * iner. Girdi boşsa `null` — çağıran boş durumu öğretir.
 *
 * Determinizm: platform (adet ↓, ad ↑ tr-TR), tarih ISO sırası.
 */
export function buildNumericSummary(items: NumericSummaryItem[]): string | null {
  if (items.length === 0) return null;

  const byPlatform = new Map<string, number>();
  for (const it of items) {
    const key = it.platform || 'bilinmiyor';
    byPlatform.set(key, (byPlatform.get(key) ?? 0) + 1);
  }
  const platforms = [...byPlatform.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'tr-TR'))
    .map(([name, n]) => `${name} (${n})`)
    .join(', ');

  const local = items.filter((it) => it.local_path != null).length;
  const dates = items
    .map((it) => it.created_at)
    .filter((d): d is string => Boolean(d))
    .sort();
  const range = dates.length > 0 ? `${dates[0].slice(0, 10)} – ${dates[dates.length - 1].slice(0, 10)}` : '';

  const lines = [
    `Bu sayfada ${items.length} kayıt.`,
    `Platformlar: ${platforms}.`,
    `Yerel: ${local} · indirilmedi: ${items.length - local}.`,
  ];
  if (range) lines.push(`Tarih aralığı: ${range}.`);
  return lines.join('\n');
}

/**
 * Kategori özeti malzemesi: trim + tekilleştir (büyük/küçük duyarsız),
 * sırayla `maxChars` karaktere kadar.
 */
export function buildCategoryDigest(texts: string[], maxChars = 8000): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  let len = 0;
  for (const raw of texts) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLocaleLowerCase('tr-TR');
    if (seen.has(key)) continue;
    const cost = parts.length === 0 ? t.length : 2 + t.length;
    if (len + cost > maxChars) {
      const room = parts.length === 0 ? maxChars : maxChars - len - 2;
      if (room <= 0) break;
      parts.push(t.slice(0, room));
      break; // bütçe doldu; kalan beklemeye alınır
    }
    seen.add(key);
    parts.push(t);
    len += cost;
    if (len >= maxChars) break;
  }
  return parts.join('\n\n');
}
