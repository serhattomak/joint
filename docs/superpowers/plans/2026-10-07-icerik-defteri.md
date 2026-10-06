# İçerik Defteri — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arşive "İçerik Defteri" kazandırmak: eksik içerikleri toplayan boru hattı + AI kategorilendirme + embedding tabanlı tekrar tespiti/birleştirme + kategori başına okunabilir Defter görünümü.

**Architecture:** Mevcut materyal yeniden kullanılır (`listItemsWithoutArticle`, `batchScrapeItems`, `batchCategorizeItems`, `summarizeText`, `getAllChunksWithEmbeddings`, `runAtomicSafe`). Yeni kod: saf benzerlik/defter yardımcıları (vitest'lenir), Rust vektör tarama komutu, tek göç (version 7), orkestrasyon (`notebook-pipeline.ts`), Settings karta bağlantı ve `NotebookView` + Sidebar/App nav.

**Tech Stack:** Tauri v2 + React 19 + TS + Vitest (saf testler) + Rust (std, yeni crate yok) + plugin-sql.

**Spec:** `docs/superpowers/specs/2026-10-07-icerik-defteri-design.md`

## Global Constraints

- Görünen metin Türkçe (tek sözlük: Arşiv/Kayıt/Araçlar/Asistan/**Defter**); kod tanımlayıcıları İngilizce.
- Yeni npm paketi **yok**; `@base-ui/react` + `lucide-react` mevcudunu kullan.
- `jv-*` localStorage anahtar kuralı: `jv-notebook-dedup-threshold` (varsayılan 0.90).
- DB performans bütçesi: sayfalama SQL'de (`LIMIT/OFFSET`), `content-visibility: auto` bloklarda; 1000+ öğe.
- Yazma yolları `runAtomicSafe`/mevcut transaction desenini izler (`setTagsForItem` gibi); `PRAGMA foreign_keys = ON` varsayım.
- invoke: `import { invoke } from '@tauri-apps/api/core'`.
- Kapı: `npm run check` (typecheck+lint+vitest) yeşil; Rust için `cargo check`/`cargo test`.

## Review Focus

1. **fxtwitter/scraper tek öğe hatası** boruyu durdurmamalı — hatası olan öğe rapor düşer, diğerleri tamamlar. (T7 testi: fake deps scrape yarısı hata atar → fail listesi eksiksiz, başarı sayısı doğru.)
2. **AI kapalıyken boru deve durumu** — Adım 2-3 çalışmaz ama sessiz kalmaz; rapor "AI kapalı" der ve Adım 1 sonucu kalır. (T7 testi.)
3. **Merge'de victim article kaybı** — hedefte article yokken en eski `scraped_at`'lı victim article'ı taşınır; kalan victim article'ları açıkça silinir (PK çakışmasını önler). Yükü taşıyan SQL adımı T5 (c); hedef-boş fallback patch alanları T4 testi; canlı doğrulama T10 manuel (d).
4. **Yanlış birleştirme (benzer ama farklı iki kayıt)** — eşik 0.90 + onay tablosu; grup atlanabilir, merge yalnız kullanıcı onayında koşar. (T7 testi: merge yalnız approve çağrısında; T8/T10 manuel.)
5. **Boş/ekstrem veri** — 0 kategori, 0 öğe, embedding'siz öğe: görünüm boş durum gösterir; embedding'siz öğe taramadan dışlanır ve "yeniden indeksle" yönlendirmesi çıkar. (T7 testi case 4; T9/T10 manuel.)

---

### Task 1: Terminoloji — PRODUCT.md/DESIGN.md

**Files:**
- Modify: `PRODUCT.md` (Sözlük tablosu + Purpose)
- Modify: `DESIGN.md` (Terimler tablosu)

**Interfaces:**
- Consumes: —
- Produces: sözlükte `Kategorilere göre derlenmiş okunabilir derlem | **Defter**`(sabit satır); görünen terim "Defter", sayfa birimi "sayfa".

- [ ] **Step 1:** PRODUCT.md Purpose'a tek cümle: arşiv kayıtlarının kategori bazlı okunabilir bir içerik defterine derlenmesi. Sözlük tablosuna Defter satırı.
- [ ] **Step 2:** DESIGN.md Terimler tablosuna aynı satır; "bölüm/kale" gibi eşanlamlı girmez.
- [ ] **Step 3:** `git commit -m "docs: terimlere Defter ekle (sozluk)"`

### Task 2: `src/lib/similarity.ts` — saf benzerlik + IPC kabığı

**Files:**
- Create: `src/lib/similarity.ts`
- Test: `src/lib/similarity.test.ts`

**Interfaces:**
- Consumes: `invoke` (`@tauri-apps/api/core`).
- Produces:
  - `meanVector(vecs: Float32Array[]): Float32Array` (boş → uzunluk 0; tüm vektörler aynı boyut — DB değişmezliği)
  - `cosine(a: number[] | Float32Array, b: number[] | Float32Array): number`
  - `findSimilarGroups(vectors: number[][], threshold: number): Promise<number[][]>` (Rust'a `invoke('dedupe_candidates', { vectors, threshold })`)

- [ ] **Step 1 (test):** `similarity.test.ts` — case'ler: cosine dik `[1,0]×[0,1]≈0`, paralel `[1,1]×[2,2]≈1`, sıfır vektör → 0; `meanVector([[1],[3]]) ≈ [2]`, `meanVector([]) → len 0`.
- [ ] **Step 2:** `npx vitest run src/lib/similarity.test.ts` → FAIL (modül yok).
- [ ] **Step 3 (kod):** İmzası yukarıdaki iki saf fonksiyon + findSimilarGroups (saf fonksiyonlar `Float32Array`/`number[]`; tolerance `1e-6`).
- [ ] **Step 4:** vitest → PASS; `npm run check` yeşil.
- [ ] **Step 5:** `git commit -m "feat(notebook): saf benzerlik yardimcilari (meanVector/cosine/findSimilarGroups)"`

### Task 3: Rust `similarity.rs` — `dedupe_candidates`

**Files:**
- Create: `src-tauri/src/similarity.rs`
- Modify: `src-tauri/src/lib.rs` (mod + `invoke_handler` kaydı)

**Interfaces:**
- Consumes: —
- Produces: `#[tauri::command] pub async fn dedupe_candidates(vectors: Vec<Vec<f32>>, threshold: f32) -> Result<Vec<Vec<usize>>, String>` — eşikte bağlı bileşenler (union-find); yalnızca ≥2 üyeli gruplar; gruplar içinde ve gruplar arasında indeks sıralı. JS çağrısı: `invoke('dedupe_candidates', { vectors, threshold })`.

- [ ] **Step 1 (test):** `#[cfg(test)]` içinde `cosine` sayısal (paralel 1, dik 0, sıfır vektör 0) ve gruplaşma: eşik üstü çift birleşir; geçişli zincir a~b~c tek grup; eşik altı ayrı; tek üye gruplar dönmez.
- [ ] **Step 2:** `cargo test similarity` → FAIL.
- [ ] **Step 3 (kod):** düz döngü O(n²) cosine; NaN guard: boş vektör → 0.00; union-find (path-compress); lib.rs'e `mod similarity;` + handler.
- [ ] **Step 4:** `cargo test similarity` PASS; `cargo check` yeşil.
- [ ] **Step 5:** `git commit -m "feat(notebook): rust dedupe_candidates (vektor benzerlik gruplari)"`

### Task 4: `src/lib/notebook.ts` — saf defter yardımcıları

**Files:**
- Create: `src/lib/notebook.ts`
- Test: `src/lib/notebook.test.ts`
- Modify: `src/lib/scraper.ts:125-149` (`batchScrapeItems` raporu zenginleşir)

**Interfaces:**
- Consumes: `Item` (`db/types.ts`), `ScrapedMedia` (images_json/videos_json), `parseArticleImages`/`parseArticleVideos` (scraper.ts, mevcut).
- Produces:
  - `extractLinks(article: { content_markdown?: string | null; images_json?: string | null; videos_json?: string | null }): string[]` — makale md linkleri + image/video `url` alanları; `http(s)` dışı eleme; sıra korunur, tekilleştir.
  - `sortNotebookItems<T extends { created_at: string }>(items: T[]): T[]` — tarih azalan, eşitlikte title A→z.
  - `planItemMerge(target: Item, victims: Item[]): { note: string; favorite: boolean; title: string | null; thumbnail: string | null; created_at: string; victimIds: string[] }` — notlar `\n\n` birleştir; `favorite` OR; `title/thumbnail` hedef boşsa dolu victim'ten (tekrarlayıcı: ilk dolu); `created_at` min.
  - `buildCategoryDigest(texts: string[], maxChars = 8000): string` — trim, lowercase-tekillenmiş, `\n\n` birleşik, `maxChars` sonunda kes.
  - `batchScrapeItems` dönüşü genişler: `... , failed: Item[]` + param `delayMs = 0` (öğe arası bekleme; BulkActions çağrısı değişmez — mevcut dönüş alanları korunur).

- [ ] **Step 1 (test):** `notebook.test.ts` — extractLinks: markdown link + image url + video url tekillik/sıra/dışı eleme; sortNotebookItems tarih azalan + eşitlikte title determinizm; planItemMerge: not birleşimi `\n\n`, favorite OR, boş-hedef fallback, min created_at; buildCategoryDigest dedupe + son kesme.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3 (kod):** imzalar yukarıdaki; `batchScrapeItems` güncellemesi mevcut gövdeye try/catch hata listesi + `delayMs` uyku ekler (dönüş alanları artar, çıkarılmaz).
- [ ] **Step 4:** vitest PASS; `npm run check` (BulkActions derleniyor).
- [ ] **Step 5:** `git commit -m "feat(notebook): saf notebook yardimcilari + batchScrapeItems raporu zenginlesti"`

### Task 5: Göç 7 + client.ts yeni DB fonksiyonları

**Files:**
- Modify: `src/lib/db/migrations.ts` (yeni nokta, versiyon 7)
- Modify: `src/lib/db/migrations.test.ts` (varsa son sürüm pin'i 6→7)
- Modify: `src/lib/db/client.ts`

**Interfaces:**
- Consumes: `runAtomicSafe` (`client.ts` mevcut — `setTagsForItem` bu deseni kullanır).
- Produces:
  - göç 7: `CREATE TABLE IF NOT EXISTS notebook_summaries (category_id TEXT PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE, summary TEXT NOT NULL, model TEXT, generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`
  - `getCategorySummary(categoryId: string): Promise<{ category_id: string; summary: string; model: string | null; generated_at: string } | null>`
  - `saveCategorySummary(categoryId: string, summary: string, model: string | null): Promise<void>`
  - `interface NotebookItemRow extends Item { content_text: string | null; content_markdown: string | null; images_json: string | null; videos_json: string | null; author: string | null; published_at: string | null }`
  - `listItemsMissingCategory(): Promise<Item[]>` (`WHERE NOT EXISTS (SELECT 1 FROM item_categories)`)
  - `listNotebookItems(categoryId: string | null, limit = 48, offset = 0, sort: 'new'|'old' = 'new'): Promise<{ rows: NotebookItemRow[]; total: number }>` — `LEFT JOIN item_articles`; `categoryId=null` "Sınıflandırılmamış" (`NOT EXISTS`).
  - `type MergePatch = { note: string; favorite: boolean; title: string | null; thumbnail: string | null; created_at: string }` (planItemMerge dönüşünden `victimIds` düşülmüş hali)
  - `mergeItems(targetId: string, victimIds: string[], patch: MergePatch): Promise<void>` — tek `runAtomicSafe` gövde, sıra: (a) `INSERT OR IGNORE` junction union (item_tags + item_categories, `SELECT ... WHERE item_id IN victims`); (b) scalar `UPDATE items WHERE id=target` (patch alanları); (c) article taşıma `UPDATE item_articles SET item_id=target WHERE item_id=(SELECT victim with lowest scraped_at) AND NOT EXISTS target-article`; artık victim article'ları `DELETE FROM item_articles WHERE item_id IN victims`; (d) victim fts temizliği — `deleteItemChunks`'te kullanılan fts SQL desenini (grep `deleteItemChunks`) victim'lere uygula; (e) `DELETE FROM items WHERE id IN victims` (junction/chunk/article cascade).
- NOT: `listCategoriesWithCounts` zaten var (client.ts:998) — **yazma**, NotebookView onu kullanır.

- [ ] **Step 1:** göç 7'yi dizide ekle; `npx vitest run src/lib/db/migrations.test.ts` — sürüm süreklilik assertion'ları çalışır; son-sürüm pin'i varsa 6→7 güncelle.
- [ ] **Step 2:** client.ts fonksiyonlarını ekle (SQL desenleri `setTagsForItem`/`listItemsPage`'ten aynen izlenir). mergeItems gövdesi runAtomicSafe tek body; (a)-(e) sırası korunur.
- [ ] **Step 3:** `npm run check` yeşil.
- [ ] **Step 4:** `git commit -m "feat(notebook): goc 7 + notebook db fonksiyonlari (summary/items/mergeItems)"`

### Task 6: `src/lib/ai.ts` — kategori özeti

**Files:**
- Modify: `src/lib/ai.ts` (yeni bölge, `summarizeText` yanına)

**Interfaces:**
- Consumes: `buildCategoryDigest` (Task 4), `summarizeText` (`ai.ts` mevcut, IPC `ai_summarize`).
- Produces: `summarizeCategory(categoryName: string, texts: string[]): Promise<string>` — tek kullanıcı istemi, sabit copy: `"Aşağıdaki kayıtların ortak malzemesini 300-600 kelime Türkçe özetle; kaynak linki yazma. Kategori: <kategori adı>\n\n<digest>"`. Dönüş: ham özet string; AI kapalı kontrolü çağıran tarafın işi (Task 8 kart).

- [ ] **Step 1:** fonksiyonu ekle (gövde: `buildCategoryDigest` → `summarizeText`).
- [ ] **Step 2:** `npm run check` yeşil.
- [ ] **Step 3:** `git commit -m "feat(notebook): summarizeCategory"`
- Not: istem copy sabittir; tek kaynak bu satırdır.

### Task 7: `src/lib/notebook-pipeline.ts` — orkestrasyon

**Files:**
- Create: `src/lib/notebook-pipeline.ts`
- Test: `src/lib/notebook-pipeline.test.ts`
- (Kaba bağımlılık yok: tüm dış etkiler `NotebookDeps` ile enjekte edilir — başka dosya değişmezi bu taskte.)

**Interfaces:**
- Consumes: `Item`, `batchScrapeItems` (Task 4), `batchCategorizeItems` (ai.ts mevcut), `findSimilarGroups` (Task 2), `meanVector` (Task 2), `getAllChunksWithEmbeddings`/`mergeItems`/`listItemsMissingCategory` (Task 5), `refreshItemIndex` (ai.ts mevcut), `isAiEnabled`/`getAiStatus` (ai.ts mevcut).
- Produces:
  - `readNotebookThreshold(): number` / `writeNotebookThreshold(v: number)` — localStorage `jv-notebook-dedup-threshold`, varsayılan 0.90, clamp 0.80–0.98.
  - `interface NotebookDeps { listBackfill: () => Promise<Item[]>; scrape: (items: Item[], onProgress?: (done: number, total: number, current: Item) => void) => Promise<{ successCount: number; errorCount: number; failed: Item[] }>; isAi: () => Promise<boolean>; categorize: (items: Item[], onProgress?: (current: number, total: number, itemTitle: string) => void) => Promise<ReturnType<batchCategorizeItems>>; vectors: (items: Item[]) => Promise<Map<string, Float32Array>>; findGroups: (vectors: number[][], threshold: number) => Promise<number[][]>; merge: (targetId: string, victimIds: string[], patch: MergePatch) => Promise<void>; itemDelay?: number }`
  - `interface NotebookReport { scraped: number; scrapeFailed: number; scrapeFailures: Item[]; categorize?: ReturnType<batchCategorizeItems> | { aiOff: true }; dedupe?: { aiOff: true; missingEmbedding: number; groups: { targetId: string; victimIds: string[]; patch: MergePatch }[] } }`
  - `runNotebookPipeline(deps: NotebookDeps, onProgress: (stage: 1 | 2 | 3, done: number, total: number, label: string) => void): Promise<NotebookReport>` — sıra: Adım1 (`deps.scrape`, failed izolasyon) → Adım2 (`isAi=false` → `{ aiOff: true }`, değilse `listItemsMissingCategory` öğelerini `deps.categorize`'e ver) → Adım3 (aynı AI kapısı): `deps.vectors` + embedding'i eksik öğe dışlanır ve `missingEmbedding` sayılır → `findGroups` → grup başına `planItemMerge` (hedef = min `created_at`) → **merge çağrılmaz, teklif** raporda.
  - `applyMerges(groups: { targetId: string; victimIds: string[]; patch: MergePatch }[], deps): Promise<{ merged: number; failedGroups: { targetId: string; error: string }[] }>` — her grup sırayla `deps.merge` + `refreshItemIndex(targetId)`; hata izolasyonlu (biri düşer, diğerleri devam).

- [ ] **Step 1 (test):** fake deps — case'ler: (1) üç aşama sıralı ve `onProgress` stage/done doğru; (2) `isAi:false` → Adım 2-3 `{ aiOff: true }`, `categorize`/`vectors` çağrılmaz; (3) scrape yarı hata → failed eksiksiz, diğerleri tamamlanır; (4) embedding'i `null` öğe gruplaşmaya katılmaz, `missingEmbedding` sayılır; (5) `applyMerges` ayrı çağrılır — pipeline kendi başına hiçbir silme yapmaz.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3 (kod):** imzalar yukarıdaki; gerçek `vectors` dep `getAllChunksWithEmbeddings`'ten base64 f32 decode — client.ts `searchHybridChunks` (L790) içindeki decode yolu varsa aynen yeniden kullan, yoksa `atob` + DataView f32.
- [ ] **Step 4:** vitest PASS; `npm run check`.
- [ ] **Step 5:** `git commit -m "feat(notebook): Defteri Hazirla orkestrasyonu + onay tablo raporu"`

### Task 8: SettingsView — "Defteri Hazırla" kartı + eşik kaydırıcı

**Files:**
- Modify: `src/components/SettingsView.tsx` (AI sekmesi; "Kategorisiz İçerikleri Düzenle" kartının altına yeni `settings-card`)
- Modify: `src/lib/notebook-pipeline.ts` (gerçek deps fabrika `makeNotebookDeps()` bu taskte eklenir)

**Interfaces:**
- Consumes: Task 7 tüm çıktılar (`runNotebookPipeline`, `applyMerges`, `readNotebookThreshold`, `writeNotebookThreshold`).
- Produces:
  - `makeNotebookDeps(): NotebookDeps` — gerçek IPC bağımlılıklarını notebook-pipeline'a bağlayan fabrika; `itemDelay: 500`.
  - Kart: tek eylem "Defteri Hazırla" — adım 1/2/3 ayrı satır (mevcut `runOrganizeUncategorized` desenli durum + ilerleme); Adım 2-3 AI kapalıyken metin "AI kapalı — Ayarlar'dan aç", düğme yok; grup onay tablosu (hedef başlık + üye başlıklar/yazar/tarih; benzerlik %'si wire'da yok — listelemede gösterilmez) + "Tümünü birleştir"/grup bazlı onay+atla; başarısızlara yeniden dene (`scrapeFailures` kümesiyle); eşik kaydırıcı 0.80–0.98 (step 0.01, `writeNotebookThreshold`); `dedupe.missingEmbedding > 0` ise satır: "X kayıt indekslenmemiş — Ayarlar'daki Yeniden İndeksle'yi kullanır" (yönlendirme metni; yeni eylem yok).
  - `batchCategorizeItems(items, { onProgress })` çağrılır (`forceAutoApply` verilmez; mevcut auto_apply ayarına saygı korunur).

- [ ] **Step 1:** `makeNotebookDeps()` fabrika: gerçek IPC yok — Task 7 deps'lerini gerçek fonksiyonlara bağla (`listItemsWithoutArticle`, `batchScrapeItems`, `batchCategorizeItems`, vektör/grup/merge yolları), `itemDelay: 500`; SettingsView'a "Defteri Hazırla" kartı ekle (`settings-card`; durum yönetimi `runOrganizeUncategorized` desenini izler; bildirim yok — mevcut `Notice` gerekirse).
- [ ] **Step 2:** `npm run build` yeşil (TS yolu) + `npm run check` yeşil.
- [ ] **Step 3:** `git commit -m "feat(notebook): Ayarlarda Defteri Hazirla karti + esik kaydirici"`

### Task 9: `NotebookView` + Sidebar + App nav

**Files:**
- Create: `src/components/NotebookView.tsx`
- Modify: `src/components/Sidebar.tsx` (`SidebarView` union + `viewBtn('notebook', ikon, 'Defter', 'arşiv')`; ikon: lucide `BookMarked`)
- Modify: `src/App.tsx` (`openNotebook`, `applyDest` branch, render branch — `openDuplicates` + DuplicatesView render desenini aynen izle; ItemGrid'in kullanan aynı yerde `NotebookView`'a `onOpenItem` bağla)
- Modify: `DESIGN.md` (Terimler bölümündeki **Primitives** → Tam-sayfa yüzeyler listesine `NotebookView`)

**Interfaces:**
- Consumes: `listNotebookItems` + `NotebookItemRow` (Task 5), `listCategoriesWithCounts` (client.ts:998 mevcut), `getAllTagsByItem` (client.ts:431) — kayıt başına ayrı tag okuma pahalı; sayfa yüklemede bir kez çekilip rows'a eşlenir. `getCategorySummary`/`saveCategorySummary` (Task 5), `summarizeCategory` (Task 6), `getAiStatus`+`isAiEnabled` (ai.ts mevcut).
- Produces: `NotebookView({ onOpenItem: (id: string) => void })`:
  - Sol katman: kategori listesi (`listCategoriesWithCounts`; `Sınıflandırılmamış` alias `null` listenin en üstünde, sayısı ayrı sorgu `listNotebookItems(null, 1, 0).total`).
  - Sağ sayfa: başlık (kategori adı) + kayıt sayısı + özet bloğu: `getCategorySummary` → özet yoksa ve AI açıksa "Özet oluştur" (`summarizeCategory(sayı: rows.content_text'ler)` → `saveCategorySummary` → yeniden oku); AI kapalıysa düğme yerine "AI kapalı — Ayarlar'dan aç".
  - Kayıt blokları (SQL sıralı, sayfalı): başlık + platform rozeti + tarih (tr-TR) + yazar (`author` düz metin) + tam metin (`content_text`, kırpılmaz) + inline görseller (`parseArticleImages(row)`; ≤3 direkt, fazlası "+N" çipi; `content-visibility: auto` + `containIntrinsicSize`; görsel tıkla → `onOpenItem` — büyütme eylemi kayıt modalında yaşar; ItemRecord gövdesindeki images render desenini aynen izle: grep `images_json` in ItemRecord.tsx) + **Bağlantılar** bölümü (`extractLinks(row)`; satır + "sistemde aç" eylemi — ItemRecord'un link açma desenini aynen izle: `openPath`/opener kullanımını grep) + etiket pill'leri.
  - Sıralama: SQL `ORDER BY created_at DESC/ASC` (`sort` prop); `sortNotebookItems` sayfa içi title-çarpışma determinizmi için ikincil key olarak kullanılır.

- [ ] **Step 1:** `NotebookItemRow` çekirdeği + `listNotebookItems` JOIN değişim (Task 5'ten devir) + NotebookView bileşen (durum ekranları: `loading`/`empty`/`error` — `DownloadsView` yüklenme/hata desenleri gibi).
- [ ] **Step 2:** Sidebar/App bağlantı (union + viewBtn + openNotebook + applyDest + render).
- [ ] **Step 3:** `npm run build && npm run check` yeşil; elle: `npm run dev` → Defter nav görünür; boş arşivde anlaşılır boş durum; kategori/öğeli durum hand test (SQL profiler el ile).
- [ ] **Step 4:** `git commit -m "feat(notebook): NotebookView + sidebar/nav butunlesmesi"`

### Task 10: Entegrasyon kanıtı + son düzeltme

**Files:**
- (Beklenen kod değişikliği yok; küçük düzeltmeler çıkarsa aynı commit altına girer.)

**Interfaces:**
- Consumes: hepsi.
- Produces: —

- [ ] **Step 1:** `npm run check` — tam yeşil çıktı task raporuna kopyalanır.
- [ ] **Step 2:** `cargo check && cargo test similarity` — yeşil.
- [ ] **Step 3:** Manuel smoke (kullanıcı verisiyle): (a) X URL kaydet → boş article; (b) Ayarlar→AI→"Defteri Hazırla" → Adım 1 N tamamlandı raporu; (c) Adım 2 kategorilendirme beklenen; (d) Adım 3 grup önerisi → onay → merge → artıklar silinmiş, article taşınmış; (e) Defter nav → kategori sayfasında tam metin + görseller + Bağlantılar + etiketler; (f) AI kapalı rapor davranışı. Kanıt: ekran görüntüleri `dev/out/` altına.
- [ ] **Step 4:** Spec çıkış kriterleri kontrol (`docs/superpowers/specs/2026-10-07-icerik-defteri-design.md` §11); eksik varsa görev açılır.
- [ ] **Step 5:** `git commit -m "docs: icerik defteri smoke kaniti"` (görüntüler `dev/out/`; gitignored ise kilavozda yolu belirtilir).

---
## Notlar

- Bağımlılık sırası: T1 ‖ T2 ‖ T3 ‖ T4 ‖ T5 ‖ T6 paralel koşabilir; T7 hepsinden sonra (2+3+4+5+6 toplar); T8 ve T9 T7'yi ister ama birbirinden bağımsız; T10 en son.
- `batchScrapeItems` imzası T4'te zenginleşir: dönüşe `failed: Item[]` ve param `delayMs = 0` eklenir; BulkActions'taki mevcut `.successCount`/`.errorCount` kullanımı bozulmaz.
- `itemDelay`: gerçek fabrika (`makeNotebookDeps`) 500 ms; test fake'leri 0 — spec §4.1 sabit 500 ms.
- Plan: her task sonunda `npm run check` yeşil; Rust işleri `cargo check` + `cargo test similarity`.
