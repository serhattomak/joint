# AI İndeksleme Doğruluğu ve Arama Hızı (B) Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chunk'lar tür kaybetmeden ve taze biçimde üretilsin; semantik arama sorgu başına base64 çözmeden, öğe bazında sınırlı ve hızlı çalışsın.

**Architecture:** Chunk üretimi `chunker.ts`'te tek saf fonksiyonda birleşir (meta+not+transcript+makale). `ai.ts` içindeki `refreshItemIndex` öğe bazlı tazeleme yapar; `ai-index.ts` olay abonesi kuyruklar. `reindexVault` iki fazlı + toplu embed. `vector-cache.ts` embedding'leri bir kez çözüp bellekte tutar; `searchHybridChunks` onu kullanır.

**Tech Stack:** Tauri v2, React 19, TypeScript, Vite, `@tauri-apps/plugin-sql`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-04-ai-indexing-search-design.md`

## Global Constraints

- Çevrimdışı, tek kullanıcı, yeni npm bağımlılığı YOK; SQLite kalır.
- Türkçe arayüz; `tr-TR` biçimler; `data-num` mono kuralı.
- Tasarım: `DESIGN.md` sözleşmesi (kart `settings-card`, tek sözlük, durumlar görünür).
- Performans bütçesi: 1000+ öğe; indeksleme/arama ölçeklenebilir olmalı.
- Mevcut genel API imzaları korunur: `searchHybridChunks`, `reindexVault`, `indexItemChunks`, `saveItemChunks`.
- Rust'a dokunulmaz (gerekmez).
- Doğrulama: `npm run typecheck && npm run lint && npm run test && npm run build`.

## Review Focus

Testlerin kapsamadığı, kullanıcıyı en olası yaralayacak girdiler/durumlar (sahibi göreve eklenir):

1. **Chunk tür kaybı** — makale/transcript/meta üretimi birbirini ezmemeli. *(T1 testi)*
2. **Vektör önbelleği bayat kalır** — embedding yazıldıktan sonra arama eski vektörü kullanmamalı (invalidate). *(T2 + T3)*
3. **Bellek taşması** — çok büyük kasa önbelleği şişirmemeli; tavan aşılırsa akışkan yola düşmeli. *(T2 testi)*
4. **Tazelik döngüsü** — olay → refresh → olay tetiklememeli; aynı öğe için yinelenen iş birleşmeli. *(T5, manuel)*
5. **Yarıda kalan toplu indeks** — bir parti embedding hatası tüm işlemi çökertmemeli; eksikler sonra tamamlanmalı. *(T4, manuel)*

---

## Task 1: Chunker — kategori + birleşik chunk üretimi

**Files:**
- Modify: `jointvault/src/lib/chunker.ts`
- Test: `jointvault/src/lib/chunker.test.ts` (yeni)

**Interfaces:**
- Consumes: mevcut `parseSrt`, `groupSrtIntoChunks`, `chunkArticleText`.
- Produces:
  - `buildMetaChunks(itemId, meta: { title?; platform?; note?; tags?: string[]; categories?: string[] }): ItemChunk[]` (kategoriler eklendi)
  - `buildItemChunks(itemId: string, input: { title?; platform?; note?; tags?: string[]; categories?: string[]; srt?: string | null; article?: string | null }): ItemChunk[]` (yeni; sıra meta → not → transcript → makale)

- [ ] **Step 1: Başarısız testi yaz** — `chunker.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildItemChunks, buildMetaChunks } from './chunker';

describe('buildMetaChunks', () => {
  it('kategorileri meta metnine yazar', () => {
    const chunks = buildMetaChunks('i1', { title: 'Tarif', categories: ['Yemek', 'Sağlık'] });
    expect(chunks[0]?.chunkType).toBe('meta');
    expect(chunks[0]?.chunkText).toContain('Kategoriler: Yemek, Sağlık');
  });

  it('kategori yoksa satır yazmaz', () => {
    const chunks = buildMetaChunks('i1', { title: 'Tarif' });
    expect(chunks[0]?.chunkText).not.toContain('Kategoriler');
  });
});

describe('buildItemChunks', () => {
  it('meta+not+transcript+makale türlerini birlikte üretir', () => {
    const srt = '1\n00:00:00,000 --> 00:00:02,000\nmerhaba dünya\n';
    const chunks = buildItemChunks('i1', {
      title: 'T', note: 'notum', tags: ['x'], categories: ['Yemek'], srt, article: 'uzun makale metni',
    });
    const types = chunks.map((c) => c.chunkType);
    expect(types).toContain('meta');
    expect(types).toContain('note');
    expect(types).toContain('transcript');
    expect(types).toContain('article');
  });

  it('boş girdide boş dizi döner', () => {
    expect(buildItemChunks('i1', {})).toEqual([]);
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npm test -- chunker` (workdir `jointvault`)
Expected: FAIL — `buildItemChunks` yok / `Kategoriler` bulunamaz.

- [ ] **Step 3: Uygula** — `chunker.ts`:
  - `buildMetaChunks` meta tipine `categories?: string[]` ekle; `meta.categories?.length` ise `Kategoriler: ${meta.categories.join(', ')}` satırını ekle (mevcut Başlık/Platform/Etiketler satırlarının yanına).
  - `buildItemChunks`: `meta = buildMetaChunks(...)`; sonra `note` (varsa), `srt` verilmişse `groupSrtIntoChunks(itemId, parseSrt(srt))`, `article` verilmişse `chunkArticleText(itemId, article)`; hepsini sırayla birleştir.

- [ ] **Step 4: Testi çalıştır, geçtiğini gör**

Run: `npm test -- chunker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add jointvault/src/lib/chunker.ts jointvault/src/lib/chunker.test.ts
git commit -m "feat(index): birlesik chunk uretimi + meta kategori"
```

---

## Task 2: `lib/vector-cache.ts`

**Files:**
- Create: `jointvault/src/lib/vector-cache.ts`
- Test: `jointvault/src/lib/vector-cache.test.ts`

**Interfaces:**
- Consumes: `base64ToVector` (`./chunker`), `type ItemChunkRow` (`./db/types`).
- Produces:
  - `interface VectorIndex { ids: string[]; vectors: Float32Array[]; dims: number }`
  - `const VECTOR_CACHE_MAX = 50_000`
  - `function invalidateVectorIndex(): void`
  - `function getVectorIndex(loader: () => Promise<ItemChunkRow[]>, max?: number): Promise<VectorIndex | null>` — `null` tavan aşıldığında (çağıran akışkan yola düşer).

- [ ] **Step 1: Başarısız testi yaz** — `vector-cache.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { vectorToBase64 } from './chunker';
import { getVectorIndex, invalidateVectorIndex } from './vector-cache';
import type { ItemChunkRow } from './db/types';

const row = (id: string, vec: number[]): ItemChunkRow => ({
  id, item_id: 'i1', chunk_type: 'meta', chunk_text: 'x',
  start_seconds: null, end_seconds: null, embedding: vectorToBase64(vec), created_at: '',
});

describe('vector-cache', () => {
  it('embeddingleri çözer', async () => {
    invalidateVectorIndex();
    const loader = vi.fn(async () => [row('a', [1, 0]), row('b', [0, 1])]);
    const idx = await getVectorIndex(loader);
    expect(idx?.ids).toEqual(['a', 'b']);
    expect(idx?.dims).toBe(2);
    expect(Array.from(idx!.vectors[0])).toEqual([1, 0]);
  });

  it('ikinci çağrıda yükleyici tekrar çağrılmaz', async () => {
    invalidateVectorIndex();
    const loader = vi.fn(async () => [row('a', [1, 0])]);
    await getVectorIndex(loader);
    await getVectorIndex(loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('invalidate sonrası yeniden kurar', async () => {
    invalidateVectorIndex();
    const loader = vi.fn(async () => [row('a', [1, 0])]);
    await getVectorIndex(loader);
    invalidateVectorIndex();
    await getVectorIndex(loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('tavan aşılırsa null döner', async () => {
    invalidateVectorIndex();
    const loader = vi.fn(async () => [row('a', [1]), row('b', [1]), row('c', [1])]);
    expect(await getVectorIndex(loader, 2)).toBeNull();
  });

  it('boş girdide boş indeks', async () => {
    invalidateVectorIndex();
    const idx = await getVectorIndex(async () => []);
    expect(idx).toEqual({ ids: [], vectors: [], dims: 0 });
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npm test -- vector-cache`
Expected: FAIL — modül yok.

- [ ] **Step 3: Modülü yaz** — `vector-cache.ts`:
  - Modül düzeyi `let cached: VectorIndex | null = null;`
  - `getVectorIndex(loader, max = VECTOR_CACHE_MAX)`: `cached` doluysa döndür; `rows = await loader()`; `rows.length > max` ise `null` döndür (ve önbelleğe yazma); değilse embedding'i olan satırları `base64ToVector` ile çöz, `{ids, vectors, dims: vectors[0]?.length ?? 0}` üret, `cached`'e yaz, döndür.
  - `invalidateVectorIndex()`: `cached = null`.
  - **`ponytail:` yorumu:** tavan (50k chunk) aşılırsa tam bellek yerine akışkan tarama; gerçekten gerekirse sqlite-vec'e yükseltme noktası burasıdır.

- [ ] **Step 4: Testi çalıştır, geçtiğini gör**

Run: `npm test -- vector-cache`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add jointvault/src/lib/vector-cache.ts jointvault/src/lib/vector-cache.test.ts
git commit -m "feat(index): cozulmus vektor onbellegi"
```

---

## Task 3: `db/client.ts` — önbellekli arama + geçersiz kılma + toplu embed yazımı + tazelik olayı

**Files:**
- Modify: `jointvault/src/lib/db/client.ts`

**Interfaces:**
- Consumes: `getVectorIndex`, `invalidateVectorIndex` (`../vector-cache`).
- Produces:
  - `setChunkEmbeddingsBatch(rows: { id: string; embedding: string }[]): Promise<void>` (runAtomic partileri)
  - `searchHybridChunks` aynı imza; artık önbellek kullanır, **öğe başına en fazla 2 chunk**, meta chunk'lara küçük RRF artışı.

- [ ] **Step 1: Önbelleği bağla** — `client.ts` başına `import { getVectorIndex, invalidateVectorIndex } from '../vector-cache';`

- [ ] **Step 2: Geçersiz kılma noktaları**
  - `saveItemChunks`, `deleteItemChunks`, `updateChunkEmbedding` sonuna `invalidateVectorIndex();`
  - `setChunkEmbeddingsBatch(rows)` ekle: boşsa dön; `runAtomic(db, 'UPDATE item_chunks SET embedding = $1 WHERE id = $2; ', [id, b64])` tek tek değil, **satır başına** ifadeyi parti (ör. 200) halinde birleştirip çağır (parametreler sırayla `$1,$2,$3,$4…`); sonunda `invalidateVectorIndex();`.

- [ ] **Step 3: `searchHybridChunks` içinde vektör taramasını değiştir**
  - `allChunks = await getAllChunksWithEmbeddings()` + JS döngüsü yerine:
    `const index = await getVectorIndex(() => getAllChunksWithEmbeddings());`
  - `index && queryEmbedding` ise `index.vectors` üzerinde kosinüs hesapla; `index.ids[i]` → chunk id. `null` ise mevcut akışkan yol (decode ederek) korunur.
  - Skorlama: `score = entry.rrf` + (`chunk.chunk_type === 'meta'` ise `META_BOOST`) — `META_BOOST = 0.002` (sıralama düzeltmesi).
  - Sonuçları sıraladıktan sonra **öğe başına en fazla 2**: `item_id` sayacı ile süz.

- [ ] **Step 4: Tazelik olayı** — `updateItem` sonunda:
  - `patch` içinde `title | note | platform | url` varsa `emitItemIndexDirty(id)` çağır.
  - Yardımcı (modül düzeyi, korumalı):
    ```ts
    function emitItemIndexDirty(id: string): void {
      if (typeof window === 'undefined') return;
      window.dispatchEvent(new CustomEvent('vault-item-index-dirty', { detail: { id } }));
    }
    ```

- [ ] **Step 5: Doğrula**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add jointvault/src/lib/db/client.ts
git commit -m "perf(index): onbellekli arama, toplu embed yazimi, tazelik olayi"
```

---

## Task 4: `lib/ai.ts` — tazeleme, birleşik indeks, iki fazlı reindex

**Files:**
- Modify: `jointvault/src/lib/ai.ts`

**Interfaces:**
- Consumes: `buildItemChunks` (`./chunker`), `getItem`, `getTagsForItem`, `getCategoriesForItem`, `getArticleForItem`, `saveItemChunks`, `setChunkEmbeddingsBatch`, `getChunksMissingEmbeddings`, `listItems`, `getAllTagsByItem`, `getAllCategoriesByItem` (`./db/client`), `invalidateVectorIndex` (`./vector-cache`).
- Produces:
  - `refreshItemIndex(itemId: string): Promise<void>`
  - `indexItemChunks(item, tags?, srtContent?)` — `refreshItemIndex` mantığıyla aynı çekirdeği kullanır (imza korunur).
  - `reindexVault(onProgress?)` — iki fazlı, toplu embed (imza korunur).

- [ ] **Step 1: Ortak çekirdek** — `embedAndSaveChunks(itemId, chunks)` (modül içi):
  - `saveItemChunks(itemId, chunks)`; `invalidateVectorIndex();`
  - `getAiStatus()` bir kez; `isAiEnabled && embed_ready && engine_available` ise `generateEmbeddings(texts)` (parti ~32 döngü) → `setChunkEmbeddingsBatch(...)`.

- [ ] **Step 2: `refreshItemIndex`**
  - `getItem`; yoksa dön. `getTagsForItem`, `getCategoriesForItem`, `getArticleForItem` paralel.
  - SRT: `item.local_path` varsa `preview_media_read_text` ile `-transkript.srt` oku (hata → null).
  - `buildItemChunks(itemId, { title, platform, note, tags, categories, srt, article: article?.content_text ?? null })`.
  - `await embedAndSaveChunks(itemId, chunks)`.

- [ ] **Step 3: `indexItemChunks` delege**
  - Mevcut imzayı koru; `categories` ve `article` okuyup `buildItemChunks` ile birleşik üret, `embedAndSaveChunks` çağır. (Eski meta+transcript ayrı yazımı kaldırılır.)

- [ ] **Step 4: `reindexVault` iki faz**
  - Faz 1 (**içerik kurulumu, öğe bazlı ilerleme**): `DELETE FROM item_chunks` + `item_chunks_fts`; `listItems`, `getAllTagsByItem`, `getAllCategoriesByItem` toplu; her öğe için `buildItemChunks` kur, `saveItemChunks` ile yaz. `onProgress(i+1, items.length)`.
  - Faz 2 (**vektörleme, chunk bazlı ilerleme**): mevcut `indexMissingEmbeddings(onProgress)` çağrılır (imza `(done,total)`; toplam = eksik embedding sayısı). `indexMissingEmbeddings` içi `setChunkEmbeddingsBatch` kullanacak şekilde güncellenir. Sonunda `invalidateVectorIndex();`
  - Durum (`isAiEnabled`) Faz 2 başında `indexMissingEmbeddings` içinde bir kez kontrol edilir (mevcut dürüst hata korunur).

- [ ] **Step 5: `indexMissingEmbeddings` toplu yazıma geçer** — döngüde `updateChunkEmbedding` yerine birikenleri `setChunkEmbeddingsBatch` ile yaz; durum kapısı (`isAiEnabled` → dürüst hata) korunur; AI kapalıysa hata at (mevcut davranış).

- [ ] **Step 6: `applyCategorization` olay yayar**
  - Fonksiyon sonunda (`vault-items-updated` yanında) `window.dispatchEvent(new CustomEvent('vault-item-index-dirty', { detail: { id: itemId } }));`

- [ ] **Step 6: Doğrula**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add jointvault/src/lib/ai.ts
git commit -m "feat(index): oge bazli tazeleme + iki fazli toplu reindex"
```

---

## Task 5: Wire-up — abone, çağrı yerleri, scraper/sync

**Files:**
- Create: `jointvault/src/lib/ai-index.ts`
- Modify: `jointvault/src/App.tsx` (abone kurulumu)
- Modify: `jointvault/src/lib/scraper.ts`
- Modify: `jointvault/src/lib/sync.ts`

**Interfaces:**
- Consumes: `refreshItemIndex` (`./ai`).
- Produces: `initItemIndexRefresh(): () => void` — `vault-item-index-dirty` olayını dinler; öğe başına birleştiren kuyruk + ~800ms debounce; concurrency 1.

- [ ] **Step 1: `ai-index.ts`**
  - Modül düzeyi `queue = new Set<string>()`, `running = false`, `timer`.
  - `push(id)`: kuyruğa ekle, `schedule()`; kısa süre sonra `drain()`.
  - `drain()`: çalışıyorsa dön; kuyruğu sırayla boşalt, her id için `await refreshItemIndex(id).catch(() => {})`.
  - `initItemIndexRefresh()`: `window.addEventListener('vault-item-index-dirty', handler)`; cleanup fonksiyonu döndürür.
  - **Döngü yok:** bu modül `ai.ts`'i import eder; `ai.ts` bunu import ETMEZ.

- [ ] **Step 2: `App.tsx`** — bir `useEffect(() => initItemIndexRefresh(), [])` ile aboneyi kur (yoksa mevcut effect düzenine ekle).

- [ ] **Step 3: `scraper.ts`** — makale kaydettikten sonra `chunkArticleText + saveItemChunks + embed` bloğunu **`await refreshItemIndex(itemId)`** ile değiştir (meta/not/transcript/kategori de birlikte tazelenir).

- [ ] **Step 4: `sync.ts`** — `indexItemChunks(item, tags, srtPreview)` çağrısı korunur (artık birleşik üretir).

- [ ] **Step 5: Doğrula**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add jointvault/src/lib/ai-index.ts jointvault/src/App.tsx jointvault/src/lib/scraper.ts jointvault/src/lib/sync.ts
git commit -m "feat(index): olay abonesi + scraper/sync birlesik tazeleme"
```

---

## Task 6: Ayarlar ilerleme metni

**Files:**
- Modify: `jointvault/src/components/SettingsView.tsx`

- [ ] **Step 1: Metni güncelle**
  - İlerleme: `${reindexProgress.current} / ${reindexProgress.total} chunk vektörleştiriliyor…`
  - Açıklama: not/transcript/makale/meta türlerinin birlikte baştan kurulduğunu söyle.

- [ ] **Step 2: Doğrula**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add jointvault/src/components/SettingsView.tsx
git commit -m "copy(settings): reindex ilerlemesi chunk bazli"
```

---

## Task 7: Bütünsel doğrulama

- [ ] **Step 1: Tüm kapılar**

Run: `npm run typecheck && npm run lint && npm run test && npm run build` (workdir `jointvault`)
Expected: yeşil.

- [ ] **Step 2: Manuel smoke (`npx tauri dev`, AI açık)**

Kontrol:
- [ ] "Semantik Kasa İndeksi"yi çalıştır → ilerleme chunk bazlı, süre belirgin kısalır.
- [ ] Reindex sonrası **makale** içeriği aranabilir; meta/transcript kaybolmaz.
- [ ] Kategori adı ("yemek") ile arama ilgili kayıtları getirir.
- [ ] Bir öğenin notunu/etiketini/kategorisini değiştir → kısa süre sonra arama tazelenir.
- [ ] Asistan sayım sorusu ("yemek kategorisinde kaç kayıt") doğru sayı verir.
- [ ] Arama ilk sonuçları hızlı döner (sorgu başına belirgin gecikme yok).

- [ ] **Step 3: DESIGN/PRODUCT tutarlılığı** — yeni kural yok; sapma varsa önce `DESIGN.md`.

## Self-Review Notları

- **Spec kapsamı:** §4→T1; §7→T2; §8/§5.1 yazma→T3; §5.1/§6→T4; §5.2→T5; §9→T6; §10→T7.
- **Tip tutarlılığı:** `getVectorIndex` dönüşü `VectorIndex | null` (T2) ile T3 kullanımı uyumlu; `setChunkEmbeddingsBatch` T3'te tanımlı, T4 tüketir; `buildItemChunks` imzası T1 ile T4/T5 uyumlu.
- **Basitleştirme:** `client.ts` arama değişikliği ve `ai-index.ts` kuyruğu için birim testi yok (plugin-sql/tarayıcı altyapısı); saf testler T1/T2'de, gerisi manuel smoke. `ponytail:` bellek tavanı T2'de işaretli.
