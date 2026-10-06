# Tasarım: İçerik Defteri (toplu içerik tamamlama + AI kategorilendirme + tekrar birleştirme + Defter görünümü)

Tarih: 2026-10-07
Durum: Onaylandı (konuşma üzerinden: görüşme soruları + iki bölüm onayı) — spec incelemesi bekliyor
Kapsam: `jointvault/` (Tauri v2 + React 19 + TS) + `src-tauri/src/ai.rs`, yeni Rust komutları
İlişki: AI taksonomi (2026-10-04) ve AI indeks/arama (2026-10-04) üzerine inşa edilir; terminoloji
(A iş kolu) sonrası tek sözlüğe **Defter** terimi eklenir.

## 1. Amaç

Arşivdeki kayıtların (X başta, tüm platformlar) tam içerikleri tek hatta toplanır, AI ile
kategorilendirilir/etalenir, embedding benzerliğiyle tekrarlı kayıtlar **tek birleşik kayıtta**
toplanır ve kategori başına okunabilir **Defter** sayfaları sunulur. Kullanıcının ifadesiyle:
"UI/UX tasarımlarını bir yerde toplamak; UI kütüphaneleri ve linklerini tek bir yerde biriktirmek."

## 2. Onaylanan kararlar (kullanıcı onaylı)

| Karar | Seçim |
|---|---|
| Defter biçimi | Uygulama içinde yeni görünüm (dışa aktarma dosyası yok) |
| Tekrar semantiği | Birleştirme: birleşik kayıt tek, artıklar silinir |
| Veri durumu | Çoğunlukla içerik eksik → geriye dönük toplu içerik çekimi iş kolu |
| Mimari | AI-merkezli: tekrar tespiti embedding benzerliği, defter girişinde LLM özeti |
| Kapsam | Tüm arşiv (yalnız X değil) |

## 3. Kapsam dışı (YAGNI)

- Defteri Markdown/HTML/PDF dışa aktarma (ileri teklif olarak not: tek eylemle eklenebilir).
- Defter sayfasının kalıcı belge olarak saklanması — sayfa verisi DB'den canlı türetilir;
  kalıcı olan yalnız LLM özetidir.
- Birleştirme "geri al" veya denetim günlüğü: birleştirme transaksiyondadır; geri dönüş
  yedekten (PORT Faz 5 altyapısı) yapılır.
- Platforma özel ayrı eşik/kurallar: tek eşik, tek hat.

## 4. Boru hattı: "Defteri Hazırla" (tek eylem)

Ayarlar → AI sekmesinde tek eylem; adım çubuğu + ilerleme + iptal edilebilir. Üç aşama
sıradadır; her aşama bağımsız durdurulabilir ve raporu ayrıdır. Pipeline'ın sahip olduğu
tek iş: deterministik kısım (Adım 1) ağ habersiz çalışır; Adım 2-3 AI gerektirir.

### 4.1 Adım 1 — İçerik tamamla (backfill, AI'sız)

- Taranan küme: `item_articles` sayfadan kayıt bulunmayan tüm `items` (tüm platformlar).
- Her öğe için mevcut `scrapeAndStoreArticle(itemId, url)` kullanılır; platform router
  (X→fxtwitter, YouTube, genel web) zaten mevcuttur; Rust değişmez.
- Öğe arası ~500 ms bekleme; ilerleme çubuğu; iptal edilebilir (yarıda kalan öğede
  kısmi kayıt yoktur: scrape başarısızsa `item_articles` boş kalır, rapora girer).
- Rapor: `N tamamlandı · M başarısız`; başarısız listesi başlık+URL, tek
  düğmeyle başarısızlara yeniden deneme.
- Zaten içerikli öğelere dokunulmaz (yeniden kazıma yok; `scraped_at` bilinçli ezilmez).

### 4.2 Adım 2 — Kategorilendirme + etiketleme (AI)

- Mevcut `batchCategorizeItems` yeniden kullanılır: `taxonomy.ts` normalize + deterministik
  ön geçiş + güven eşiği (`jv-ai-tag-threshold`, varsayılan 0.6) + rapor. Kategorisiz
  (veya kategorizasyon içi boş) öğelere çalışır.
- Adım 1 bu boruyu besler: LLM çağrısına giden öğe metnine artık tam makale metni girer
  (chunk indeksleme `scrapeAndStoreArticle` içinde yapıldığından ek iş yok).
- AI kapalıysa: boru adım 2'de durur; raporda "AI kapalı — Ayarlar'dan aç" gösterilir;
  adım 1'in sonucu (tamamlanan içerikler) kalır.

### 4.3 Adım 3 — Tekrar tespiti + birleştirme (AI, embedding)

- Temsil vektörü: öğenin `item_chunks.embedding` değerlerinin **ortalaması**
  (`getAllChunksWithEmbeddings` mevcut). Embedding'i eksik öğe "yeniden indeksle"
  yönlendirmesiyle çözülür (AI indeks altyapısı; yeni kod yok).
- Çiftli cosine JS dışında: yeni Rust komutu
  `dedupe_candidates(vectors: Vec<Vec<f32>>, threshold: f32) -> Vec<Vec<usize>>`
  (yeni `similarity.rs`; düz döngü + union-find; 1000×1600 ≈ 1.6 GFLOP, yaklaşık 1-3 sn).
- Eşik: varsayılan 0.90; `jv-notebook-dedup-threshold` localStorage; Ayarlar → AI'da
  0.80–0.98 aralığında kaydırıcı.
- Gruplama: union-find bağlı bileşenler; tek üyeli gruplar rapora girmez.
- Onay ekranı: grup tablosu — benzerlik %, üyelerin başlık/yazar/tarih; "Hepsini
  birleştir" veya grup bazlı onay/atlama. Hedef kayıt: varsayılan en eski `created_at`;
  kullanıcı tek tek değiştirebilir.
- Birleştirme kuralları (`mergeItems(targetId, victimIds, {…})`, tek transaction):
  - URL: hedefin URL'i kalır; artık URL'ler raporda listelenir (DB'de kopya tutulmaz).
  - Etiket/kategori: union (hedef + victims).
  - Notlar: hedef notu + victims notları, `\n\n` ayırıcıyla tek `note`'e; boşlar yok sayılır.
  - `favorite`: OR (biri true ise true).
  - `created_at`: en eski kalır (hedefin değeri değil, min).
  - `title`/`thumbnail`: hedefte boşsa dolu olan tarafa taşınır.
  - `item_articles`: hedefte kayıt yoksa victim'ınkisi hedefe taşınır ( contradictory
    durumlarda hedefin article'ı kazanır; victim'ın article'ı silinir).
  - `item_chunks`/embedding: hedef için `refreshItemIndex(targetId)` (tek öğe yeniden
    indeksleme mevcut yoldur).
  - victims: mevcut silme yoluyla (verify-foreign-keys desenli transaction) silinir.
- Rapor: `G grup · B birleşen kayıt · S atlanan grup`.
- AI kapalıysa adım 3 tümüyle devre dışı; ulaşılabilir "embedding taraması AI ister" bildirimi.

## 5. Defter görünümü (UI)

- Sidebar: yeni nav **Defter** (ARŞİV grubunda; mevcut `NavEntry` deseni).
- Ekran: ikili bölme — solda kategori listesi (kategori adı + kayıt sayısı), sağda sayfa.
- Sayfa üstü: başlık (kategori adı), kayıt sayısı, **Özet oluştur / Yenile** — LLM özeti
  `notebook_summaries`'ten kalıcı; AI kapalıysa "AI kapalı — Ayarlar'dan aç" bilgisi,
  düğme devre dışı.
- Kayıt blokları (tarih azalan):
  - başlık, platform rozeti, tarih, yazar (X'te "Ad (@handle)" metinden ayrılır)
  - tam metin: `item_articles.content_text` (düz okunur blok; kırpılmaz)
  - inline görseller (`images_json`): tek satır küçük çerçeveler; 4+ ise "+N" taşıp
    `count` çip'i; tıklayınca mevcut `MediaPlayerModal`/resim görüntüleyici (mevcut desen)
  - **Bağlantılar** alt başlığı: metin içi URL'ler (content_markdown link sorgulaması)
    + images/videos kaynak URL'ler tekilleştirilmi listede; satırbaşı "sistemde aç"
    (mevcut `openPath`/`opener` izniyle; URL ise tarayıcı opsiyonu mevcut desen)
  - etiket pill'leri (mevcut tag desen)
- Sınıflandırılmamış sayfası: kategoriye bağlanmamış öğeler ("Sınıflandırılmamış");
  AI açıkken bu sayfadan tek düğmeyle "Kategorilendir" tetiklenebilir (4.2 motoru),
  AI kapalıyken hata değil, düz liste (boş durum metinleri dahil).
- Performans: `LIMIT/OFFSET` SQL sayfalama; bloklarda `content-visibility: auto`; 1000+
  kayıt bütçesi korunur.
- Durumlar: yükleniyor / boş / hata (+ yeniden dene) mevcut desenlerle.

## 6. Veri modeli + IPC

- Yeni göç (migrations.ts `MIGRATIONS[]` dizisine son sürüm+1):
  ```sql
  CREATE TABLE IF NOT EXISTS notebook_summaries (
    category_id TEXT PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    model TEXT,
    generated_at TEXT NOT NULL
  );
  ```
- `src/lib/db/client.ts`: `getCategorySummary(categoryId)`, `saveCategorySummary`,
  `listNotebookCategories` (ad + kayıt sayısı; 0 kayıtlı kategoriler de listelenir),
  `listNotebookItems(categoryId|null, page, pageSize)`,
  `countItemsWithoutArticle()`, `listItemsWithoutArticle()`, `mergeItems`.
- `src/lib/ai.ts`: `summarizeCategory(categoryName, texts) → string` — yeni Rust komutu
  `ai_summarize_category` (ai.rs mevcut llama-server HTTP deseni; `dedupe_cap` yeniden
  kullanılır; 300-600 kelime Türkçe özet; kaynak metinlerin örnek linklerini **yazmaz**,
  genel malzemeyi yazar).
- Kod tanımlayıcıları İngilizce kalır (`notebook_summaries`, `dedupe_candidates`); görünen
  metin Türkçe.

## 7. Terminoloji + doküman sözleşmesi (AGENTS.md gereği önce doküman)

- `PRODUCT.md` Sözlük tablosuna ek satır:
  `Kategorilere göre derlenmiş okunabilir derlem | **Defter**` — amaç bölümüne tek cümle
  dokunuş ("arşivdeki kayıtlar kategori bazlı okunabilir bir içerik defterine derlenir").
- `DESIGN.md` Terimler tablosuna aynı satır; Primitives listesine `NotebookView` bu işin
  planında eklenir (kod yazılınca güncellenir).
- Terim: "Sayfa" belirsiz değil; Defter içi birim **"sayfa"** (kategori başına bir sayfa)
  olarak kullanılır; ikinci bir eşanlamlı sözcük (ör. "bölüm", "kale") girmez.

## 8. Dosyalar

**Yeni:**
- `src/components/NotebookView.tsx` — kategori listesi + kayıt sayfası + özet bloğu
- `src/lib/notebook-pipeline.ts` — "Defteri Hazırla" orkestrasyonu (adım 1/2/3, rapor)
- `src/lib/similarity.ts` — saf: `meanVector`, `cosine`; Rust'a vektör gönderim dönüşümü
- `src/lib/notebook.ts` — saf: `extractLinks(markdown, images, videos)`, sayfa sıralama
- `src/lib/similarity.test.ts`, `src/lib/notebook.test.ts` — saf testler
- `src-tauri/src/similarity.rs` — `dedupe_candidates` (vectör cosine + union-find)

**Değişen:**
- `src/lib/db/migrations.ts` — yeni göç (tek tablo)
- `src/lib/db/client.ts` — bölüm 6'daki IPC fonksiyonları
- `src/lib/ai.ts` — `summarizeCategory`
- `src/components/SettingsView.tsx` — AI sekmesine "Defteri Hazırla" kartı (adım çubuğu +
  rapor + eşik kaydırıcı); mevcut "Kategorisiz İçerikleri Düzenle" kartı yerinde kalır
  ve adım 2 için aynı motoru kullanır
- `src/components/Sidebar.tsx`, `src/App.tsx` — Defter nav + route
- `src-tauri/src/ai.rs` — `ai_summarize_category`; `lib.rs` — komut kaydı
- `PRODUCT.md`, `DESIGN.md` — Terimler + amaç cümlesi

## 9. Doğrulama

- Saf testler (vitest): `meanVector`/`cosine` sayısal doğruluk; eşik gruplaşması
  (union-find belirsizlik senaryosu); `extractLinks` — markdown link + image URL +
  video URL tekilleştirme; boş veri durumları.
- `mergeItems` transaksiyon doğrulaması: iki/üç sahte öğeyle union taşınma,
  article taşıma, victims silme; dev/verify-* desenine uygun bir `dev/verify-merge.mjs`
  (plugin-sql varken doğrudan; en azından SQL semantiği `schema.test.ts` tarzı saf
  testte korunur).
- `npm run check` yeşil; `cargo check` yeşil.
- Manuel: AI açık ve kapalı iki yolda smoke; X e-to-e (kaydet → tamamla → kategorile →
  birleştir → defter sayfasında tam metin+görsel+link+etiket görünür); boş arşivde
  anlaşılır boş durum.

## 10. Riskler ve önlemler

- fxtwitter/scraper hız sınırı ya da kez kapalı uç: öğe arası bekleme + başarısız raporu
  + "başarısızlara yeniden dene" tek düğme; boru yok karıştırmaz.
- Yanlış birleştirme (benzer ama farklı iki tweet): eşik yüksek (0.90) + kullanıcı onayı
  ekranı + hedef seçimi + grup atlama; silme bu yüzden onaydan sonra.
- 1000+ öğe vektör yükü: vektör verisi bir kez IPC'den geçer (1000×1600 f32 JSON ≈
  6-7 MB tekil transfer; tek seferlik, kabul edilebilir; ölçülürse chunking notür).
- Embedding indeksi eski olan öğeler: "yeniden indeksle" yöneldirtici (AI indeks
  altyapısının mevcut işi; bu işte yeniden üretilmez).
- `priorities`/`categories` değrsiz kayıtlar: Sınıflandırılmamış sayfası birinci sınıf
  durum sayılır; sıralama deterministik (tarih azalan).

## 11. Çıkış kriterleri

- [ ] "Defteri Hazırla" adım 1 eksik içerikli öğeleri tamamlar; rapor doğrudur.
- [ ] Adım 2 AI açıkken kategorisiz öğelerin kategori/etiketlerini üretir (mevcut
      taxonomy davranışı korunur).
- [ ] Adım 3 benzerlık ≥ eşik grupları gösterir; onay sonrası birleşik kayıt tüm
      metaveriyi taşıyır, victims silinir, işlem tek transaction'dır.
- [ ] Defter görünümü kategori başına okunabilir sayfa: tam metin + inline görseller +
      bağlantılar + etiketler; sayfalama SQL'dedir.
- [ ] LLM özeti yalnız AI açıkken üretilebilir; `notebook_summaries` kalıcıdır.
- [ ] AI kapalı: içerik tamamla + Defter sayfası (özet yoke, tekrar taraması devre dışı)
      çalışır; doğru durum metinleri görünür.
- [ ] PRODUCT.md/DESIGN.md terminolojisi "Defter" ile güncel; tek sözlük korunur.
- [ ] Saf testler + `npm run check` + `cargo check` yeşil; manuel smoke kanıtı.
