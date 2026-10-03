# Tasarım: AI İndeksleme Doğruluğu ve Arama Hızı (İş Kolu B)

Tarih: 2026-10-04
Durum: Onaylandı (konuşma üzerinden) — uygulama planı öncesi spec incelemesi bekliyor
Kapsam: `jointvault/` (Tauri v2 + React 19 + TS)
İlişki: Program B → C → A. Bu spec **yalnızca B** (indeks & arama).

## 1. Amaç

Kasa Asistanı ve semantik arama doğru **sayı/getirme** ve makul **hız** versin.
Bugünkü somut kök nedenler:

1. **Chunk türleri birbirini eziyor.** `saveItemChunks` öğenin tüm chunk'larını
   siler. `scraper.ts` makale chunk'larını yazınca meta/transcript silinir;
   `indexItemChunks` (meta+transcript) yazınca makale chunk'ları silinir.
2. **`reindexVault` makale chunk'larını geri kurmuyor** (chunkArticleText yalnızca
   scraper'da kullanılıyor) → "Semantik Kasa İndeksi" içeriği yiyor.
3. **Kategori meta chunk'ta yok** → "yemek" gibi kategori adları semantik aramada
   geçmiyor.
4. **Değişiklikte tazeleme yok** → not/etiket/kategori değişince arama eski kalıyor.
5. **Arama, her sorguda tüm embedding'leri base64 çözer** → yavaş; indeksleme ise
   öğe başına IPC çağrısıyla sıralı → uzun.

## 2. Onaylanan kararlar

| Karar | Seçim |
|---|---|
| Arama motoru | Bağımlılıksız optimizasyon; SQLite kalır. sqlite-vec yalnızca ÖLÇÜLEN ihtiyaç doğarsa sonraki adım. |
| PostgreSQL | Alınmaz (çevrimdışı, tek kullanıcı, sıfır kurulum sözleşmesini bozar). |
| Tazelik | Otomatik, **öğe bazlı**; tam yeniden indeks manuel kalır. |
| Vektörlerin yeri | SQLite `TEXT` (base64) kalır; arama için bellekte çözülmüş önbellek. |

## 3. Kapsam dışı (YAGNI)

- sqlite-vec veya Rust'a vektör taraması (ölçülen ihtiyaç doğana kadar).
- PostgreSQL / bulut / çok kullanıcı.
- Embedding modeli veya boyut değişikliği (BGE-M3, 1024).
- Kategorizasyon/etiketleme kalitesi (B değil, C) ve terminoloji (A).

## 4. B1 — Chunk üretimi tek geçiş

### 4.1 `buildMetaChunks`
`categories?: string[]` alanı eklenir; meta metni `Kategoriler: X, Y` satırını
(yalnız dolu ise) içerir. Mevcut başlık/platform/etiket satırları korunur.

### 4.2 `buildItemChunks`
`lib/chunker.ts`'te yeni saf fonksiyon:

```ts
buildItemChunks(itemId: string, input: {
  title?: string | null;
  platform?: string | null;
  note?: string | null;
  tags?: string[];
  categories?: string[];
  srt?: string | null;         // ham SRT metni (varsa)
  article?: string | null;     // makale düz metni (varsa)
}): ItemChunk[]
```

Sıra: **meta → not → transcript → makale**. Tek öğe için TÜM türler birlikte
üretilir; kimse kimseyi ezmez.

### 4.3 Yazma
`saveItemChunks` sil-sonra-yaz davranışı korunur ama artık çağıranlar yalnızca
`buildItemChunks` çıktısını verir. `scraper.ts` ve `sync.ts` makale/transcript
için ayrı yazmaz; tazeleme yolunu kullanır.

## 5. B2 — Otomatik tazelik (öğe bazlı)

### 5.1 `refreshItemIndex(itemId)`
`lib/ai.ts` (mevcut indeksleme fonksiyonlarının yanında; `ai-index.ts` DEĞİL):

1. `getItem(itemId)`, `getTagsForItem`, `getCategoriesForItem`,
   `getArticleForItem`, ve varsa SRT dosyasını (`item.local_path` → `-transkript.srt`)
   okur.
2. `buildItemChunks(...)` ile chunk'ları kurar.
3. `saveItemChunks(itemId, chunks)` ile yazar (tüm türler birlikte).
4. AI açık + embed hazırsa tek partide embedding üretir ve yazar; **değilse yalnızca
   metin kalır** (embedding sonraki tarama/tazelemede tamamlanır — mevcut davranış).
5. `invalidateVectorIndex()` çağırır.

Embedding üretimi başarısız olursa hata yutulur (metin indeksli kalır); bu bilinçli
ve mevcut davranışla aynıdır.

### 5.2 Tetikleyiciler
Tek olay: `window.dispatchEvent(new CustomEvent('vault-item-index-dirty', { detail: { id } }))`.

`lib/ai-index.ts` **yalnızca abonedir**: olayı dinler, öğe başına **kuyruk + kısa
debounce** (aynı öğe için art arda istekler birleşir), eşgüdümlü (concurrency 1)
`refreshItemIndex` çağırır. `ai-index.ts` → `ai.ts` **tek yönlü** bağımlıdır; böylece
`ai.ts` `ai-index.ts`'i import etmez (döngü yok). Abone `App.tsx`'te bir kez kurulur.

Olay yayanlar:
- `db/client.ts` → `updateItem`: `title | note | platform | url` değişirse.
  (`typeof window !== 'undefined'` korumalı yardımcı.)
- `lib/ai.ts` → `applyCategorization` (etiket/kategori uygulaması).
- `TagPicker` / kayıt detayı not-otomatik-kaydetme (mevcut kayıt yolu `updateItem`
  üzerinden gittiği için ek çağrı gerekmez).
- `scraper.ts` (makale kazıma) ve Whisper transkripti sonrası: `refreshItemIndex`
  doğrudan (olay yerine) çağrılır; çünkü bu yollar zaten embed üretmek istiyor.

`indexItemChunks` (mevcut) `refreshItemIndex`'e delege edilir (imza korunur:
`item, tags, srtContent`) — yeni çağrı yerleri delegeyi kullanır.

## 6. B3 — Toplu & hızlı yeniden indeks

`reindexVault(onProgress)` iki faz:

- **Faz 1 (chunk üretimi):** `listItems`, `getAllTagsByItem`, `getAllCategoriesByItem`
  toplu okunur; her öğe için `buildItemChunks` (SRT + makale metinleri dahil)
  bellekte kurulur. Önce `DELETE FROM item_chunks` + `item_chunks_fts`. Chunk'lar
  `runAtomic` partileriyle (ör. 200 satır) yazılır. İlerleme chunk sayısı üzerinden.
- **Faz 2 (vektörleme):** tüm chunk metinleri toplanır; `ai_embed` **toplu** çağrılır
  (parti ~32); dönen embedding'ler `runAtomic` partileriyle tek tek değil toplu
  yazılır. Durum (`ai_status`, `isAiEnabled`, `embed_ready`, `engine_available`)
  **bir kez** kontrol edilir.

İmza korunur: `reindexVault(onProgress?: (current, total) => void)` (artık chunk
bazlı). AI kapalıysa mevcut dürüst hata korunur (`indexMissingEmbeddings` gibi).

## 7. B4 — Vektör önbelleği

`lib/vector-cache.ts` (yeni):

```ts
interface VectorIndex { ids: string[]; vectors: Float32Array[]; dims: number }
export async function getVectorIndex(loader: () => Promise<ItemChunkRow[]>): Promise<VectorIndex>
export function invalidateVectorIndex(): void
```

- Tembel kurulur: `getAllChunksWithEmbeddings()` bir kez çağrılır, her embedding
  `base64ToVector` ile çözülür, `{ids, vectors}` tutulur.
- `invalidateVectorIndex()`, sıradaki erişimde yeniden kurar.
- Geçersiz kılma noktaları: `saveItemChunks`, `deleteItemChunks`,
  `updateChunkEmbedding`, `invalidate` sonrası `indexMissingEmbeddings`, ve
  `reindexVault` sonu. (`client.ts` içinden import döngüsü olmaması için
  `vector-cache` `client`'a bağımlı olmaz; yükleyici dışarıdan verilir.)
- `searchHybridChunks` artık `getVectorIndex()`'i kullanır; sorgu başına base64
  çözme yoktur. Kosinüs, önbellekteki `Float32Array`'ler üzerinde hesaplanır.
- **`ponytail:` bellek tavanı.** Önbellek toplam vektör sayısı/boyutu bir eşiği
  aşarsa (ör. > 50.000 chunk veya > ~200 MB) tam bellek yerine akışkan tarama
  (satır satır çöz) yoluna düşülür; gerçekten gerekirse sqlite-vec'e yükseltme
  noktası buradadır. Eşik `vector-cache.ts`'te sabit + yorumla işaretlenir.

## 8. B5 — Arama kalitesi

- **Öğe bazında tekilleştirme/sınırlama:** aynı öğeden en fazla 2 chunk döner
  (referanslar çeşitlensin; tek öğe sonucu doldurmasın).
- **Meta ağırlığı:** `chunk_type = 'meta'` sonuçlarına küçük bir RRF artışı
  (kategori/başlık içerir) — sayı değil sıralama iyileştirmesi; RRF korunur.
- Sorgu FTS temizliği mevcut (`'"token"*' OR`) korunur.
- `searchHybridChunks` imzası ve dönüş tipi (`HybridSearchResult[]`) korunur.

## 9. B6 — Ayarlar/UX

- "Semantik Kasa İndeksi" ilerlemesi **chunk bazlı** gösterilir
  (`{current} / {total} chunk vektörleştiriliyor…`).
- Açıklama metni tüm chunk türlerinin (not/transcript/makale/meta) baştan
  kurulduğunu söyler.
- (Opsiyonel, düşük maliyet) "Yalnız eksik embedding'leri tamamla" eylemi
  `indexMissingEmbeddings`'i çağırır; zaten mevcut.

## 10. Test ve doğrulama

- `chunker.test.ts` (yeni):
  - `buildMetaChunks` kategori verildiğinde `Kategoriler:` satırı içerir; verilmezse
    içermez.
  - `buildItemChunks` meta + not + transcript + makale türlerini **birlikte** üretir
    (hiçbiri diğerini düşürmez).
- `vector-cache.test.ts` (yeni): sahte yükleyici ile (a) çözüp `ids/vectors` döner,
  (b) `invalidate` sonrası yükleyici yeniden çağrılır, (c) yükleyici boşsa boş indeks.
- Mevcut göç/ai-chat/ai-context testleri korunur.
- Manuel smoke: reindex → kategori adıyla arama kayıt getirir; makale içeriği
  aranabilir; not değiştir → arama tazelenir; asistan sayım sorusu doğru.
- Bitirmeden: `npm run typecheck && npm run lint && npm run test && npm run build`
  + `cargo check` (Rust dokunulmazsa gerekmez).

## 11. Dosya listesi

**Yeni:** `src/lib/vector-cache.ts` · `src/lib/ai-index.ts` (olay abonesi) ·
`src/lib/chunker.test.ts` · `src/lib/vector-cache.test.ts`

**Değişen:** `src/lib/chunker.ts` · `src/lib/ai.ts` · `src/lib/db/client.ts` ·
`src/lib/scraper.ts` · `src/lib/sync.ts` · `src/components/SettingsView.tsx` ·
`src/App.tsx` (aboneyi kur)

## 12. Riskler ve önlemler

- **Çift tazeleme / döngü:** olay → refresh → `updateItem` tekrar olay yaymasın.
  Refresh yalnızca chunk yazar; item güncellemez.
- **Bellek:** vektör önbelleği `ponytail:` tavanıyla korunur; tavan aşılırsa akışkan
  tarama.
- **Eşzamanlı refresh:** aynı öğe için kuyruk birleştirir; farklı öğeler sıralı
  (concurrency 1) — yarış yok.
- **Faz 2 embedding hatası:** parti hatası o partiyi atlar, işlem devam eder;
  eksik embedding kalanlar bir sonraki taramada tamamlanır.
- **Geri uyum:** `searchHybridChunks`, `reindexVault`, `indexItemChunks` imzaları
  korunur; çağrı yerleri değişmez.

## 13. Çıkış kriterleri

- [ ] `buildItemChunks` meta+not+transcript+makale türlerini birlikte üretir.
- [ ] Meta chunk kategori adlarını içerir.
- [ ] `reindexVault` makale chunk'larını da kurar; maksimum içerik indekslenir.
- [ ] Yeniden indeksleme toplu embed ile belirgin hızlanır; ilerleme chunk bazlı.
- [ ] Not/etiket/kategori değişince ilgili öğe otomatik tazelenir.
- [ ] Arama sorgu başına base64 çözmez (önbellek); öğe bazında sınırlama vardır.
- [ ] Yeni saf testler geçer; tüm suite yeşil; typecheck/lint/build yeşil.
- [ ] `ponytail:` bellek tavanı koda işaretlendi.
