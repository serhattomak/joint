/**
 * Asistanın arşive "hâkimiyet" katmanı.
 *
 * İki parça: (1) her prompt'a eklenen hafif arşiv özeti, (2) modelin ürettiği
 * `action:query` yapısal sorgusunu güvenli biçimde SQLite'a çevirip çalıştırma.
 * Uydurma yok: filtre eşleşmezse dürüstçe 0 sonuç döner.
 */
import {
  getDb,
  ITEM_SORTS,
  listCategories,
  listCategoriesWithCounts,
  listItemsPage,
  listTags,
  listTagsWithCounts,
  type ItemFilters,
  type ItemSort,
} from './db/client';
import type { VaultQueryItem } from './ai-chat';

export type { VaultQueryItem };

export interface VaultQuery {
  query?: string;
  platform?: string;
  tag?: string;
  category?: string;
  favorite?: boolean;
  downloaded?: boolean;
  sinceDays?: number;
  sort?: ItemSort;
  limit?: number;
  countOnly?: boolean;
}

const MAX_LIMIT = 30;
const DEFAULT_LIMIT = 10;
const SUMMARY_MAX_CHARS = 1800;

const asString = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
};

/** Katı boolean: yalnızca `true/false` ve `'true'/'false'` kabul edilir. */
const asBool = (v: unknown): boolean | undefined => {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return undefined;
};

const asInt = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};

/** Model çıktısını güvenli bir `VaultQuery`'ye indirger (SQL'e kullanıcı metni girmez). */
export function normalizeVaultQuery(raw: unknown): VaultQuery {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: VaultQuery = {};

  const query = asString(r.query);
  if (query) out.query = query;
  const platform = asString(r.platform);
  if (platform) out.platform = platform;
  const tag = asString(r.tag);
  if (tag) out.tag = tag;
  const category = asString(r.category);
  if (category) out.category = category;

  const favorite = asBool(r.favorite);
  if (favorite !== undefined) out.favorite = favorite;
  const downloaded = asBool(r.downloaded);
  if (downloaded !== undefined) out.downloaded = downloaded;
  const countOnly = asBool(r.countOnly);
  if (countOnly !== undefined) out.countOnly = countOnly;

  const sinceDays = asInt(r.sinceDays);
  if (sinceDays !== undefined && sinceDays > 0) out.sinceDays = sinceDays;

  if (typeof r.sort === 'string' && (ITEM_SORTS as readonly string[]).includes(r.sort)) {
    out.sort = r.sort as ItemSort;
  }

  const limit = asInt(r.limit);
  if (limit !== undefined) out.limit = Math.min(MAX_LIMIT, Math.max(1, limit));

  return out;
}

/** Her prompt'a eklenen kompakt arşiv özeti (~1200 karakter tavanı). */
export async function buildVaultSummary(): Promise<string> {
  const db = await getDb();

  const platformRows = await db.select<{ platform: string; n: number }[]>(
    'SELECT platform, COUNT(*) AS n FROM items GROUP BY platform ORDER BY n DESC',
  );
  const total = platformRows.reduce((sum, r) => sum + r.n, 0);
  const [favRow] = await db.select<{ n: number }[]>(
    'SELECT COUNT(*) AS n FROM items WHERE favorite = 1',
  );
  const [localRow] = await db.select<{ n: number }[]>(
    'SELECT COUNT(*) AS n FROM items WHERE local_path IS NOT NULL',
  );

  // Taksonomi SAYIYA göre sıralanır ve tamamı görünür: kullanıcı "X kategorisinde
  // kaç kayıt" diye sorduğunda kategori özetten düşmemeli.
  const cats = (await listCategoriesWithCounts())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  const tags = (await listTagsWithCounts())
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
  const recent = (await listItemsPage(5, 0, { sort: 'new' })).rows;

  const lines: string[] = [];
  lines.push(
    `Arşiv: ${total} kayıt · ${favRow?.n ?? 0} favori · ${localRow?.n ?? 0} yerel indirilmiş.`,
  );
  if (platformRows.length > 0) {
    lines.push(`Platformlar: ${platformRows.map((p) => `${p.platform} (${p.n})`).join(', ')}.`);
  }
  if (cats.length > 0) {
    lines.push(`Kategoriler: ${cats.map((c) => `${c.name} (${c.count})`).join(', ')}.`);
  }
  if (tags.length > 0) {
    lines.push(`Etiketler: ${tags.map((t) => `${t.name} (${t.count})`).join(', ')}.`);
  }
  if (recent.length > 0) {
    lines.push('Son eklenenler:');
    for (const it of recent) {
      const date = it.created_at.slice(0, 10);
      lines.push(`- ${it.title || it.url} [${it.platform}] ${date}`);
    }
  }

  const text = lines.join('\n');
  return text.length > SUMMARY_MAX_CHARS ? `${text.slice(0, SUMMARY_MAX_CHARS)}…` : text;
}

/** Etiket/kategori ADINI id'ye çevirir; yoksa null (uydurma sonuç yok). */
async function resolveName(
  name: string,
  loader: () => Promise<{ id: string; name: string }[]>,
): Promise<string | null> {
  const rows = await loader();
  const target = name.toLowerCase();
  return rows.find((r) => r.name.toLowerCase() === target)?.id ?? null;
}

/** `VaultQuery`'yi sorgu filtresine çevirir; üç durumlu `favorite`/`hasLocal` korunur. */
export function vaultQueryToFilters(q: VaultQuery): ItemFilters {
  return {
    query: q.query,
    platform: q.platform,
    favorite: q.favorite,
    hasLocal: q.downloaded,
    sinceDays: q.sinceDays,
    sort: q.sort,
  };
}

export async function executeVaultQuery(
  q: VaultQuery,
): Promise<{ count: number; items: VaultQueryItem[] }> {
  const filters = vaultQueryToFilters(q);

  if (q.tag) {
    const tagId = await resolveName(q.tag, listTags);
    if (!tagId) return { count: 0, items: [] };
    filters.tagId = tagId;
  }
  if (q.category) {
    const categoryId = await resolveName(q.category, listCategories);
    if (!categoryId) return { count: 0, items: [] };
    filters.categoryId = categoryId;
  }

  const limit = q.limit ?? DEFAULT_LIMIT;
  const { rows, total } = await listItemsPage(q.countOnly ? 0 : limit, 0, filters);

  const items: VaultQueryItem[] = q.countOnly
    ? []
    : rows.map((r) => ({
        id: r.id,
        title: r.title,
        url: r.url,
        platform: r.platform,
        favorite: r.favorite,
        downloaded: r.local_path !== null,
        createdAt: r.created_at,
      }));

  return { count: total, items };
}

// --- Deterministik yapısal niyet tespiti ---
//
// Küçük yerel modeller `action:query` bloğunu güvenilir üretmez (kanıtlandı: sayı
// sorularında kaçamak yanıt). Bu yüzden sayı/liste/filtre sorularını burada
// DETERMİNİSTİK yakalayıp modelden ÖNCE çalıştırırız; model yalnızca dili kurar.

export interface VaultTaxonomy {
  categories: string[];
  tags: string[];
  platforms: string[];
}

/** Arşivdeki taksonomi adları + platform slug'ları (niyet tespiti için). */
export async function loadTaxonomy(): Promise<VaultTaxonomy> {
  const db = await getDb();
  const [cats, tags, platRows] = await Promise.all([
    listCategories(),
    listTags(),
    db.select<{ platform: string }[]>('SELECT DISTINCT platform FROM items'),
  ]);
  return {
    categories: cats.map((c) => c.name),
    tags: tags.map((t) => t.name),
    platforms: platRows.map((p) => p.platform),
  };
}

const COUNT_RE = /(kaç|adet|toplam|sayısı|sayisi|tane|ne kadar)/i;
const DURATION_RE =
  /kaç\s*(dakika|saniye|saat|gün|günlük|dakikalık|saniyelik|mb|gb|kb|bit|lira|tl|para)/i;
const LIST_RE =
  /(listele|listesi|listesini|göster|hangileri|neler|neler var|var mı|var mi|çıkar|kaydettim|kayıtlarım|arşivim)/i;
const FAV_NEG_RE = /(favori olmayan|favorisiz|favori olmayanlar)/i;
const FAV_RE = /(favori|favoriler|favorilerim)/i;
const LOCAL_NEG_RE = /(indirilmemiş|indirilmeyen|yerel olmayan)/i;
const LOCAL_RE = /(indirilmiş|indirilen|yerel|diskte|indirmiş)/i;

/**
 * Sorudan yapısal niyet çıkarır.
 *
 * Yalnızca bir "sorgu sinyali" (sayı / liste / favori / yerel / tarih) varsa
 * döner; taksonomi eşleşmesi tek başına yetmez (aksi hâlde içerik soruları da
 * yapısal sorguya dönüşürdü).
 */
export function detectStructuralIntent(query: string, tax: VaultTaxonomy): VaultQuery | null {
  const q = query.toLocaleLowerCase('tr-TR');

  const countWord = COUNT_RE.test(q) && !DURATION_RE.test(q);
  const listWord = LIST_RE.test(q);

  let favorite: boolean | undefined;
  if (FAV_NEG_RE.test(q)) favorite = false;
  else if (FAV_RE.test(q)) favorite = true;

  let downloaded: boolean | undefined;
  if (LOCAL_NEG_RE.test(q)) downloaded = false;
  else if (LOCAL_RE.test(q)) downloaded = true;

  let sinceDays: number | undefined;
  const sinceMatch = q.match(/son\s+(\d{1,3})\s*g[üu]n/);
  if (sinceMatch) {
    const n = Number(sinceMatch[1]);
    if (Number.isFinite(n) && n > 0) sinceDays = n;
  } else if (/bu\s+hafta/.test(q)) sinceDays = 7;
  else if (/geçen\s+hafta/.test(q)) sinceDays = 14;
  else if (/bu\s+ay/.test(q)) sinceDays = 30;

  const hasSignal =
    countWord ||
    listWord ||
    favorite !== undefined ||
    downloaded !== undefined ||
    sinceDays !== undefined;
  if (!hasSignal) return null;

  const category = tax.categories.find((c) => q.includes(c.toLocaleLowerCase('tr-TR')));
  const tag = tax.tags.find((t) => q.includes(t.toLocaleLowerCase('tr-TR')));
  const platform = tax.platforms.find(
    (p) => p.length >= 3 && q.includes(p.toLocaleLowerCase('tr-TR')),
  );

  // "kategori"/"etiket" KELİMESİ geçiyor ama ad eşleşmiyorsa yapısal sorgu
  // çalıştırma: aksi hâlde "tüm arşiv" sayısı o kategoriye aitmiş gibi sunulur.
  // Bu durumda model, arşiv özetindeki gerçek kategori listesinden yanıtlar.
  if (/kategori/.test(q) && !category) return null;
  if (/etiket/.test(q) && !tag) return null;

  const out: VaultQuery = { limit: 10 };
  if (category) out.category = category;
  if (tag) out.tag = tag;
  if (platform) out.platform = platform;
  if (favorite !== undefined) out.favorite = favorite;
  if (downloaded !== undefined) out.downloaded = downloaded;
  if (sinceDays !== undefined) out.sinceDays = sinceDays;
  return out;
}

function describeQuery(q: VaultQuery): string {
  const parts: string[] = [];
  if (q.category) parts.push(`kategori="${q.category}"`);
  if (q.tag) parts.push(`etiket="${q.tag}"`);
  if (q.platform) parts.push(`platform="${q.platform}"`);
  if (q.favorite === true) parts.push('yalnız favoriler');
  if (q.favorite === false) parts.push('favori olmayanlar');
  if (q.downloaded === true) parts.push('yerel indirilmiş');
  if (q.downloaded === false) parts.push('indirilmemiş');
  if (q.sinceDays) parts.push(`son ${q.sinceDays} gün`);
  if (q.query) parts.push(`"${q.query}"`);
  return parts.length > 0 ? `(${parts.join(', ')}) ` : '';
}

/** Yapısal sorgu sonucunu modele verilecek KESİN bir metne çevirir. */
export function formatQueryResult(
  q: VaultQuery,
  result: { count: number; items: VaultQueryItem[] },
): string {
  const head = `${describeQuery(q)}Sorgu sonucu: ${result.count} kayıt.`;
  if (result.items.length === 0) return head;
  const lines = result.items.map(
    (i) => `- ${i.title ?? i.url} [${i.platform}] ${i.createdAt.slice(0, 10)} (ID: ${i.id})`,
  );
  return `${head}\n${lines.join('\n')}`;
}
