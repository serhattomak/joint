/**
 * mergeItems'in SQL gövdesi — saf builder, DB bağımlılığı yok.
 *
 * BİNDING KURALI (ölçülmüş davranış): plugin-sql her ifadeye `values`
 * dizisini SIRAYLA bağlar (setTagsForItem bunu ispat eder; atomic.ts notu).
 * Paylaşılan düz dizi ile cümle başına param sayısı uymadığından tüm gövde
 * TEK parametre (? = JSON blob) kullanır: her cümle aynı blob'u pozisyonal
 * olarak görür, yanlış bağlama imkânsızlaşır. JSON1 modern amalgamation
 * çekirdeğindedir (SQLite ≥ 3.38) ve node:sqlite testleri aynı DDL'i koşar.
 *
 * DML'in tamamı tek `BEGIN...COMMIT` gövdesindedir (runAtomic; havuz
 * gerçeği); temp tablolar bağlantıya özgüdür ve sonda düşürülür, kazaya
 * bırakılmışını temizlemek için başta DROP IF EXISTS vardır.
 */
export interface MergePayload {
  target: string;
  note: string;
  favorite: boolean;
  title: string | null;
  thumbnail: string | null;
  created_at: string;
  updated_at: string;
}

export function buildMergeBlob(
  payload: MergePayload,
  victimIds: string[],
): { body: string; values: unknown[] } {
  const blob = JSON.stringify({
    target: payload.target,
    note: payload.note,
    favorite: payload.favorite ? 1 : 0,
    title: payload.title,
    thumbnail: payload.thumbnail,
    created_at: payload.created_at,
    updated_at: payload.updated_at,
    victims: victimIds,
  });
  const body = [
    /* Baştan temiz: yarım kalan bir önceki işlem temp tabloyu bırakmış olabilir. */
    'DROP TABLE IF EXISTS temp.jv_merge;',
    'DROP TABLE IF EXISTS temp.jv_merge_victims;',
    `CREATE TEMP TABLE jv_merge (
      target TEXT NOT NULL PRIMARY KEY,
      note TEXT, favorite INTEGER, title TEXT, thumbnail TEXT,
      created TEXT, updated TEXT
    );`,
    `CREATE TEMP TABLE jv_merge_victims (rid TEXT NOT NULL PRIMARY KEY);`,
    /* Tek cümlede blob'dan header: cümle param sayısı = 1 (blob, ?1 numaralı). */
    `INSERT INTO jv_merge (target, note, favorite, title, thumbnail, created, updated)
     SELECT json_extract(?1,'$.target'), json_extract(?1,'$.note'),
            json_extract(?1,'$.favorite'), json_extract(?1,'$.title'),
            json_extract(?1,'$.thumbnail'), json_extract(?1,'$.created_at'),
            json_extract(?1,'$.updated_at');`,
    `INSERT INTO jv_merge_victims (rid)
     SELECT je.value FROM json_each(json_extract(?1,'$.victims')) je;`,
    /* Junction union: etiket/kategori hedefe taşınır (duplicate'e dokunmaz). */
    `INSERT OR IGNORE INTO item_tags (item_id, tag_id)
     SELECT (SELECT target FROM jv_merge), t.tag_id FROM jv_merge_victims vv
     JOIN item_tags t ON t.item_id = vv.rid;`,
    `INSERT OR IGNORE INTO item_categories (item_id, category_id)
     SELECT (SELECT target FROM jv_merge), c.category_id FROM jv_merge_victims vv
     JOIN item_categories c ON c.item_id = vv.rid;`,
    /* Scalar patch: COALESCE — patch'te null = "hedef dolu, taşınmaz". */
    `UPDATE items SET
       note = v.note,
       favorite = v.favorite,
       title = COALESCE(v.title, items.title),
       thumbnail = COALESCE(v.thumbnail, items.thumbnail),
       created_at = v.created,
       updated_at = v.updated
     FROM jv_merge v WHERE items.id = v.target;`,
    /* Article taşıma: yalnız hedefte article yokken, en eski scraped_at'lı victim'inki. */
    `UPDATE item_articles SET item_id = (SELECT v.target FROM jv_merge v)
     WHERE item_id = (
       SELECT ja.item_id FROM item_articles ja
       JOIN jv_merge_victims vv ON ja.item_id = vv.rid
       ORDER BY ja.scraped_at ASC
       LIMIT 1
     )
     AND NOT EXISTS (
       SELECT 1 FROM item_articles ea
       WHERE ea.item_id = (SELECT v.target FROM jv_merge v)
     );`,
    /* Artık victim article'ları açıkça sil (taşınan PK çakışması önlenir). */
    `DELETE FROM item_articles WHERE item_id IN (SELECT rid FROM jv_merge_victims);`,
    /* Victim chunk FTS temizliği: fts5 DELETE rowid ile garanti. */
    `DELETE FROM item_chunks_fts WHERE rowid IN (
       SELECT rowid FROM item_chunks_fts WHERE item_id IN (SELECT rid FROM jv_merge_victims)
     );`,
    /* Cascade: junction/article/chunk satırlarını FK temizler. */
    `DELETE FROM items WHERE id IN (SELECT rid FROM jv_merge_victims);`,
    'DROP TABLE temp.jv_merge_victims;',
    'DROP TABLE temp.jv_merge;',
  ].join(' ');
  return { body, values: [blob] };
}
