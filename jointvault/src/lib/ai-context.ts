/**
 * Asistanın kasaya "hâkimiyet" katmanı.
 *
 * İki parça: (1) her prompt'a eklenen hafif kasa özeti, (2) modelin ürettiği
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
const SUMMARY_MAX_CHARS = 1200;

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

/** Her prompt'a eklenen kompakt kasa özeti (~1200 karakter tavanı). */
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

  const cats = (await listCategoriesWithCounts()).filter((c) => c.count > 0).slice(0, 10);
  const tags = (await listTagsWithCounts()).filter((t) => t.count > 0).slice(0, 10);
  const recent = (await listItemsPage(8, 0, { sort: 'new' })).rows;

  const lines: string[] = [];
  lines.push(
    `Kasa: ${total} kayıt · ${favRow?.n ?? 0} favori · ${localRow?.n ?? 0} yerel indirilmiş.`,
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
