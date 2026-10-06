/*
 * İçerik analizi kayıtları (item_analysis).
 *
 * Bu modül depolama sınırıdır: SQLite'ta düz kolonlar/JSON metinleri tutulur,
 * TS tarafına `ItemAnalysis` olarak çözülür. Analizi ÜRETEN mantık (LLM, ASR)
 * burada değildir; yalnızca oku/yaz/sil ve "analiz bekleyenler" sorgusu.
 */
import { getDb } from './client';
import type { AnalysisStatus, ItemAnalysis, RecipeText } from './types';

/** Ham SQLite satırı: JSON alanları metin, boolean 0/1, snake_case kolonlar. */
export interface ItemAnalysisRow {
  id: string;
  item_id: string;
  status: string;
  contains_recipe: number | null;
  confidence: number | null;
  language: string | null;
  summary: string | null;
  recipe_json: string | null;
  topics_json: string | null;
  keywords_json: string | null;
  visual_notes_json: string | null;
  transcript_source: string | null;
  transcript_path: string | null;
  model_versions_json: string | null;
  error_message: string | null;
  analyzed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Bozuk/eksik JSON deponun tamamını çökertmesin: fallback'e düş. */
function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Saf dönüşüm — DB'ye dokunmaz, bu yüzden doğrudan test edilir. */
export function toItemAnalysis(row: ItemAnalysisRow): ItemAnalysis {
  return {
    id: row.id,
    item_id: row.item_id,
    status: row.status as AnalysisStatus,
    contains_recipe: row.contains_recipe === null ? null : row.contains_recipe === 1,
    confidence: row.confidence,
    language: row.language,
    summary: row.summary,
    recipe: parseJson<RecipeText | null>(row.recipe_json, null),
    topics: parseJson<string[]>(row.topics_json, []),
    keywords: parseJson<string[]>(row.keywords_json, []),
    visual_notes: row.visual_notes_json === null ? null : parseJson<string[]>(row.visual_notes_json, []),
    transcript_source: row.transcript_source,
    transcript_path: row.transcript_path,
    model_versions: parseJson<Record<string, string> | null>(row.model_versions_json, null),
    error_message: row.error_message,
    analyzed_at: row.analyzed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const jsonOrNull = (value: unknown): string | null => (value === null ? null : JSON.stringify(value));

export async function getItemAnalysis(itemId: string): Promise<ItemAnalysis | null> {
  const db = await getDb();
  const rows = await db.select<ItemAnalysisRow[]>('SELECT * FROM item_analysis WHERE item_id = $1', [itemId]);
  return rows[0] ? toItemAnalysis(rows[0]) : null;
}

type ItemAnalysisInput = Omit<ItemAnalysis, 'id' | 'created_at' | 'updated_at'> & { id?: string };

export async function upsertItemAnalysis(input: ItemAnalysisInput): Promise<void> {
  const db = await getDb();
  const id = input.id ?? crypto.randomUUID();
  await db.execute(
    `INSERT INTO item_analysis (
      id, item_id, status, contains_recipe, confidence, language, summary,
      recipe_json, topics_json, keywords_json, visual_notes_json,
      transcript_source, transcript_path, model_versions_json, error_message, analyzed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT(item_id) DO UPDATE SET
      status = excluded.status,
      contains_recipe = excluded.contains_recipe,
      confidence = excluded.confidence,
      language = excluded.language,
      summary = excluded.summary,
      recipe_json = excluded.recipe_json,
      topics_json = excluded.topics_json,
      keywords_json = excluded.keywords_json,
      visual_notes_json = excluded.visual_notes_json,
      transcript_source = excluded.transcript_source,
      transcript_path = excluded.transcript_path,
      model_versions_json = excluded.model_versions_json,
      error_message = excluded.error_message,
      analyzed_at = excluded.analyzed_at,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [
      id,
      input.item_id,
      input.status,
      input.contains_recipe === null ? null : input.contains_recipe ? 1 : 0,
      input.confidence,
      input.language,
      input.summary,
      jsonOrNull(input.recipe),
      JSON.stringify(input.topics),
      JSON.stringify(input.keywords),
      jsonOrNull(input.visual_notes),
      input.transcript_source,
      input.transcript_path,
      jsonOrNull(input.model_versions),
      input.error_message,
      input.analyzed_at,
    ],
  );
}

export async function deleteItemAnalysis(itemId: string): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM item_analysis WHERE item_id = $1', [itemId]);
}

/** İndirilmiş ve analizi olmayan ya da hata almış öğeler (yeniden denenebilir). */
export async function listItemIdsNeedingAnalysis(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ id: string }[]>(
    `SELECT i.id FROM items i
     LEFT JOIN item_analysis a ON a.item_id = i.id
     WHERE i.local_path IS NOT NULL AND (a.item_id IS NULL OR a.status = 'error')
     ORDER BY i.updated_at DESC`,
  );
  return rows.map((r) => r.id);
}
