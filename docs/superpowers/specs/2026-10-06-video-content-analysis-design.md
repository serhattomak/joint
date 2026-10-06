# Tasarım: Videodan İçerik Analizi (Tarif / Konu / Anahtar Kelime)

Tarih: 2026-10-06
Durum: Önerildi — uygulama planı öncesi spec incelemesi bekliyor
Kapsam: `jointvault/` (Tauri v2 + Rust + React 19 + TS)
İlişki: Mevcut AI (B/C iş kolları: indeks/arama + taksonomi) ve whisper altyapısı üzerine kurulur. Bu spec yeni bir yetenek ekler; B/C'yi değiştirmez, onları kullanır.

## 1. Amaç

İndirilmiş bir videonun **içeriğini** analiz edip şunları üretmek:

1. Videonun **ne ile ilgili** olduğu (özet + konular).
2. İçinde **tarif varsa** tarifi (malzemeler + adımlar).
3. **Anahtar kelimeler** (arama/taksonomi için).

Amaç, arşivdeki videoları yalnızca başlıkla değil **içeriğiyle** aranabilir/düzenlenebilir kılmak. Bugünkü durum ve somut eksikler:

1. **Türkçe transkript kalitesi yetersiz** — kurulu whisper modelleri yalnızca `tiny`/`base`/`small` (bkz. `components.rs:542-603`). Küçük model + Türkçe = yüksek WER.
2. **Video içeriğinden yapısal çıkarım yok** — `ai_summarize`/`ai_categorize_and_tag` metin özeti/etiket üretir ama **tarif** gibi yapısal çıktı yok; girdi olarak da yalnızca metin alır, görseli görmez.
3. **Görsel içerik hiç okunmuyor** — ekranda duran tarif yazısı, yemek görüntüsü tamamen kayıp.
4. **Analiz sonucu kalıcı bir yüzeyi yok** — sonuçlar item'ın `chunks`'ına dağılıyor, kullanıcı "bu videonun tarifi" diye bakamıyor.

Bu özellik **iki fazda** teslim edilir: **Faz 1 metin-only** (hızlı değer, Türkçe kalitesini de düzeltir), **Faz 2 görsel** (deneysel VLM riskini izole eder).

## 2. Onaylanan kararlar (konuşma üzerinden)

| Karar | Seçim |
|---|---|
| Analiz girdisi | Hepsi: hazır altyazı → yoksa whisper → + meta (başlık/açıklama) + görsel kareler (Faz 2) |
| Kapsam | Yalnızca `local_path` dolu (indirilmiş) kayıtlar |
| Tetikleme | Kayıt detayında **manuel** buton + **toplu** "analiz edilmemişleri analiz et" |
| Çıktı | `recipe` (nullable) + `topics`→kategoriler + `keywords`→etiketler + `summary` |
| Tarif biçimi | Faz 1: **düz metin** malzeme/adım; ileride miktar/birim/porsiyon/süre (şema değişmeden) |
| Dil | TR + EN algıla; **çıktı Türkçe**; kategori/etiket otomatik (mevcut `auto_apply_tags`'e saygılı) |
| ASR | `large-v3-q5_0` varsayılan, `large-v3` "yüksek doğruluk"; hazır altyazı öncelikli |
| Görsel (Faz 2) | `Qwen2.5-VL-7B Q4_K_M` + `mmproj-f16`, ayrı port **28082**, GPU mutex (chat durur), 3B fallback |
| Kare (Faz 2) | ffmpeg **sahne tespiti**, maks ~40 kare; OCR yok (VLM okur) |
| Pipeline | **İki aşamalı**: VLM kareleri açıklar → **14B** transkript+görsel not+meta ile final JSON |
| Uzun video | Mevcut `chunker` ile parçala → map-reduce |
| Depolama | Yeni **`item_analysis`** tablosu; kayıt başına tek satır, üzerine yazılır |
| Tekrar analiz | Analizli kayıt atlanır; `force` ile yeniden |
| Hata | 7B→OOM→3B→OOM→CPU→başarısızsa **yalnız-metin, "kısmi"**; asla çökme/veri kaybı |
| Toplu | Seri (tek `QUEUE`), **iptal edilebilir**, "N/M" ilerleme; duraklatma yok |
| UI | Kayıt detayında "İçerik Analizi" bölümü + toplu ilerleme; `DESIGN.md` token'ları |
| Sıra | **Faz 1: metin-only → Faz 2: görsel** |

## 3. Kapsam dışı (YAGNI)

- URL'si olup indirilmemiş kayıtlar (Faz sonrası).
- Makale/metin içeriği analizi (mevcut `scraper` + özetleme yolu ayrı).
- Ayrı Tesseract OCR (Qwen2.5-VL ekran yazısını okur).
- Bulut/uzak model çağrısı (ürün invariant'ı: tamamen yerel/offline — `PRODUCT.md`).
- Tarif miktar/birim/porsiyon/süre ayrıştırma (ileri faz; şema rezerve).
- Duraklat/devam (ekstra kalıcı durum makinesi; iptal + yeniden başlatma yeter).
- Ayrı "Analiz" görünümü (bağlam kayıt detayıdır).

## 4. Faz 1 — Metin-only analiz

### 4.1 ASR yükseltmesi (bileşen kaydı)

`components.rs` spec kaydına iki whisper modeli eklenir (mevcut tiny/base/small deseniyle birebir):

| id | dosya | ~boyut | not |
|---|---|---|---|
| `whisper-model-large-v3-q5` | `ggml-large-v3-q5_0.bin` | 1.1 GB | **varsayılan** |
| `whisper-model-large-v3` | `ggml-large-v3.bin` | 2.9 GB | "yüksek doğruluk" |

- `dest: Dest::Models`, `kind: Kind::Asset`, `sha256` + `expected_bytes` doğrulanır (mevcut `DownloadSpec` deseni).
- `whisper.rs::valid_model` (`whisper.rs:36`) yeni id'leri tanır; `models_dir` çözümü aynı kalır.
- Ayarlar → Bileşenler'de mevcut model indirme UI'ı üzerinden gelir; ayrı UI yok.

### 4.2 Kaynak seçimi: altyazı önceliği

`analyze.rs` içinde tek karar noktası:

```
altyazı var mı? (yt-dlp ile video'da/otomatik, tr/en)
  ├─ evet → onu kullan (transcript_source = 'captions' | 'embedded')
  └─ hayır → whisper large-v3(-q5) ile üret (transcript_source = 'whisper')
```

- Mevcut `whisper::extract_subtitle` (`whisper.rs:423`) gömülü altyazıyı çıkarır; indirme tarafında yt-dlp altyazı seçeneği eklenecekse `download.rs` argv'sine opsiyonel `--write-subs/--write-auto-subs` eklenir (yalnız analiz istendiğinde).
- Üretilen `.srt` yolu `item_analysis.transcript_path`'e yazılır (not: bugün `.srt` item'a bağlanmıyor — `docs/media-tools-deferred.md:55`; bu spec onu analiz kapsamında bağlar).

### 4.3 Pipeline — `analyze.rs` (yeni Rust modülü) + `lib/analysis.ts` (TS orkestrasyon)

**Sorumluluk ayrımı (mevcut `transcribe` deseniyle uyumlu):** Rust'ta DB erişimi yoktur; bu yüzden **Rust yalnızca ağır işi yapar** (transkript + LLM), **TS kalıcılık/taksonomi/indeksleme sahibidir.**

Rust komutu `analyze_media` (payload: `item_id, input_path, url, title, platform, language, job_id`) + event `analyze-progress`:

```
1. QUEUE kilidi al (tek ağır iş).
2. transkript edin (4.2): mevcut .srt → gömülü → yt-dlp → whisper. Hiçbiri yoksa hata.
3. transkripti parçala (map) → her parça için 14B LLM "aday çıkarım" (4.4).
4. reduce: adayları birleştir → tek final JSON.
5. JSON string döndür: { analysis, transcript_source, transcript_path, model_versions }.
```

TS `analyzeItem(itemId, { force, jobId })`:

```
1. AI kapalı / local_path yok → fail-closed hata.
2. item_analysis var ve force değilse → atla (idempotent).
3. analyze_media çağır; status='running' yaz.
4. taksonomi normalizasyonu (`taxonomy.ts`; kanonik eşleme + eşik) uygula.
5. item_analysis'e yaz; done/partial/error; auto_apply_tags açıksa kategorileri/etiketleri uygula.
6. refreshItemIndex ile aramayı tazele.
```

- Ağır işler mevcut **`download::QUEUE` kilidi** altında serileşir (indirme/transcode ile eşzamanlı çalışmaz).
- LLM çağrıları mevcut `ai.rs` `ensure_server_running` + `/v1/chat/completions` yolu üzerinden (yeni sunucu yok, 14B zaten var).
- AI kapalı/model eksikse komut **fail-closed**: net hata + Ayarlar'a yönlendirme (`components.rs:969` mesaj deseni).

### 4.4 Çıktı şeması (LLM'e zorlanan JSON)

```json
{
  "contains_recipe": true,
  "confidence": 0.82,
  "language": "tr",
  "title": "...",
  "summary": "...",
  "topics": ["..."],
  "keywords": ["..."],
  "recipe": {
    "title": "...",
    "ingredients": ["..."],
    "steps": ["..."],
    "notes": ""
  }
}
```

- `recipe` **nullable**. `ingredients`/`steps` düz metin (Q5b). İleride `{ad,miktar,birim}` nesnelerine **şema değişmeden** genişler (JSON kolonu).
- Geçersiz JSON tespiti: `contains_recipe=false && summary=='' && topics==[] && keywords==[]` → "başarısız" (taksonomi spec'indeki ayrıştırma-hatası konvansiyonuyla uyumlu).
- `confidence ≥ 0.6` iken tarif kartı gösterilir; **her zaman saklanır** (eşik yalnız gösterim kararı).

### 4.5 Taksonomi disiplini (TS tarafı)

Taksonomi `taxonomy.ts`'te (TS) yaşadığı için normalizasyon **TS orkestrasyonunda** (`lib/analysis.ts`) yapılır; Rust ham topic/keyword döner.

- `topics` → `resolveCategories` (yeni kategori yalnız eşik üstü, öğe başına ≤ `maxNew`), `keywords` → `resolveTags` (`max` sınırı).
- Mevcut `taxonomy.ts` fonksiyonları **aynen** kullanılır; çoğalma önleyici zaten orada (`docs/superpowers/specs/2026-10-04-ai-taxonomy-design.md`).
- `auto_apply_tags` açıkken uygulanır; kapalıyken yalnız `item_analysis`'e yazılır (öneri).

### 4.6 Uzun video

- Transkript `chunker` ile parçalanır (mevcut `buildItemChunks`/SRT gruplama mantığı).
- **Map**: her chunk'tan aday JSON. **Reduce**: adaylar birleştirilir; `contains_recipe` OR'lanır, `confidence` en yüksek, listeler dedupe + cap.
- Basit kırpma (ilk N dk) **kullanılmaz** — tarif sonda olabilir.

## 5. Faz 2 — Görsel analiz

### 5.1 Model + motor

| id | dosya | ~boyut | rol |
|---|---|---|---|
| `vlm-qwen2.5-vl-7b` | `Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf` | 4.7 GB | ana |
| `vlm-qwen2.5-vl-7b-mmproj` | `mmproj-...-f16.gguf` | 1.3 GB | projeksiyon |
| `vlm-qwen2.5-vl-3b` | `Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf` | 1.9 GB | fallback |
| `vlm-qwen2.5-vl-3b-mmproj` | `mmproj-...-Q8_0.gguf` | 0.85 GB | fallback projeksiyon |

- **Yeni motor yok**: mevcut `llama-server.exe` (b10964) `mtmd.dll` + `-mmproj` destekliyor. VLM, **port 28082**'de ayrı bir `llama-server` süreci olarak çalışır.
- `ai.rs` port sabitlerine `VLM_PORT = 28082` eklenir; `tauri.conf.json:24` CSP `connect-src`'ye `http://127.0.0.1:28082` eklenir.
- **GPU mutex**: 16 GB VRAM'de 14B (~8.6 GB) + VLM-7B (~4.7 GB) + mmproj (~1.3 GB) birlikte sığmaz. Analiz başlarken mevcut chat sunucusu durdurulur; analiz bitince yeniden başlatılır (mevcut `ProcessSlot` yönetimi genişletilir). Kullanıcıya görünür sonuç: **analiz sürerken Asistan sohbeti duraklar**.

### 5.2 Kare çıkarımı

- ffmpeg sahne tespiti (`select='gt(scene,0.35)'`) ile anahtar kareler, **maks 40** kare, genişlik ~768 px.
- Sahne değişimi olmayan videolar (sabit konuşma başı) için fallback: düzgün aralıklı örnekleme, yine ≤ 40.
- Kareler geçici dizinde tutulur; iş sonunda silinir.

### 5.3 İki aşamalı akış

```
Aşama 1 (VLM, kareler): her kare için kısa açıklama
  → ekran yazısı (tarif metni!), yemek/sahne, görünen malzemeler → visual_notes[]
Aşama 2 (14B, metin): transkript + meta + visual_notes → final JSON (4.4)
```

- Yapısal çıkarım (recipe/topic/keyword) **14B metin modelinde** kalır; VLM yalnız "ne görüyor" der.
- `visual_notes` ayrıca `item_analysis.visual_notes_json`'a yazılır (denetlenebilirlik).

### 5.4 Hata merdiveni

```
7B dene → OOM/hata → 3B dene → OOM/hata → CPU'da dene → yine olmazsa
  → görsel atlanır, yalnız-metin analizi yapılır, status='partial'
```

- Hiçbir adımda çökme veya veri kaybı yok. `partial` kaydında alanlar dolu, `visual_notes_json = null`.

## 6. Depolama — `item_analysis` (migration 6)

`src/lib/db/schema.sql` + `migrations.ts` (mevcut en son 5 → **6**):

```sql
CREATE TABLE IF NOT EXISTS item_analysis (
  id                   TEXT PRIMARY KEY,   -- uygulama UUID PK konvansiyonu
  item_id              TEXT NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'pending', -- pending|running|done|partial|error
  contains_recipe      INTEGER,            -- 0/1, NULL = bilinmiyor
  confidence           REAL,
  language             TEXT,               -- algılanan kaynak dil
  summary              TEXT,
  recipe_json          TEXT,               -- 4.4 recipe nesnesi (nullable)
  topics_json          TEXT,               -- ham LLM konuları
  keywords_json        TEXT,               -- ham LLM keywordleri
  visual_notes_json    TEXT,               -- Faz 2; Faz 1'de NULL (rezerve)
  transcript_source    TEXT,               -- captions|embedded|whisper
  transcript_path      TEXT,
  model_versions_json  TEXT,               -- whisper/vlm/llm sürümleri (yeniden analiz kararı)
  error_message        TEXT,
  analyzed_at          TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_item_analysis_status ON item_analysis(status);
```

- `UNIQUE(item_id)` → idempotent üzerine-yazma.
- Faz 2 alanları (`visual_notes_json`) Faz 1'de **rezerve**; şema değişmez.
- `ON DELETE CASCADE` → item silinince analiz de gider (mevcut chunks deseniyle uyumlu).
- Faz 1 sonuçları mevcut indekse beslenir: özet + transkript + tarif metni `indexItemChunks`/`refreshItemIndex` ile chunk'lanıp `item_chunks`'a (`chunk_type='transcript'` yanında yeni `chunk_type='analysis'` kabul edilebilir) yazılabilir → arama ve `askVault` sonuçlarına düşer.

## 7. UI (Faz 1)

`DESIGN.md` + `PRODUCT.md` okunur; mevcut primitives/token'lar kullanılır (yeni görsel dil yok).

- **Kayıt detayı** → "İçerik Analizi" bölümü:
  - Durum: analiz yok / analiz ediliyor (ilerleme) / sonuç / kısmi / hata.
  - Tarif kartı (`confidence ≥ 0.6` ve `contains_recipe`): başlık, malzeme listesi, adım listesi, notlar, **kopyala**.
  - Özet + konu/keyword çipleri (mevcut etiket çipi bileşeni).
  - Aksiyonlar: **Analiz et**, **Yeniden analiz et** (force).
- **Toplu (Ayarlar → Yapay Zekâ, `SettingsView`)**: "Analiz edilmemişleri analiz et" eylemi; "N/M" ilerleme + **İptal**. (Kayıt listesinde ayrı toplu yüzey yok — bilinçli UX kararı.)
- AI kapalı veya gerekli model eksikse eylemler kilitli + yönlendirme mesajı (mevcut desen).

## 8. Test ve doğrulama

**Rust (`analyze.rs`, `whisper.rs`, `ai.rs`):**
- Çıktı JSON ayrıştırma: geçerli/geçersiz/eksik alan; `recipe: null`; bozuk JSON → "başarısız" tespiti.
- Chunk map-reduce birleştirme: `contains_recipe` OR, `confidence` max, dedupe + cap.
- Hata merdiveni seçimi: VRAM/parametre verilince 7B→3B→CPU sırası (saf fonksiyon testi).
- `valid_model`: yeni large-v3 id'leri kabul, bilinmeyen reddedilir.
- CSP/port sabiti testi: `VLM_PORT` tek yerde.

**TS (`taxonomy` entegrasyonu, `item_analysis` client, şema ayrıştırma):**
- LLM çıktısı → `resolveCategories`/`resolveTags` normalize + eşik + `maxNew`/`max` sınırı.
- `contains_recipe` + `confidence` eşik gösterim kararı (`≥ 0.6`).
- `item_analysis` CRUD: UNIQUE üzerine yazma, `status` geçişleri, CASCADE.

**Manuel (IPC/gerçek model):** transkript üretimi (captions vs whisper), uzun video map-reduce, Faz 2 kare+VLM, GPU mutex (chat durur/döner).

**Bitirmeden:** `npm run typecheck && npm run lint && npm run test && npm run build` (+ Rust: `cargo test`).

## 9. Dosya listesi

**Faz 1 — Yeni:** `src-tauri/src/analyze.rs` · `src/lib/db/item_analysis.ts` (client) — "İçerik Analizi" bölümü ayrı panel değil, **`src/components/ItemRecord.tsx`** içinde (+ `analysis.test.ts` / `item_analysis.test.ts`)
**Faz 1 — Değişen:** `src-tauri/src/whisper.rs` · `src-tauri/src/components.rs` · `src-tauri/src/ai.rs` · `src-tauri/src/lib.rs` · `src/lib/db/schema.sql` · `src/lib/db/migrations.ts` · `src/lib/db/client.ts` · `src/lib/ai.ts` · `src/lib/analysis.ts` · `src/lib/taxonomy.ts` (gerekirse) · `src/components/ItemRecord.tsx` · `src/components/SettingsView.tsx` (toplu analiz)

**Faz 2 — Yeni:** `src-tauri/src/vision.rs` (VLM süreci + kare) · `src/lib/vision.ts`
**Faz 2 — Değişen:** `src-tauri/src/ai.rs` (VLM_PORT) · `src-tauri/src/components.rs` (VLM modelleri) · `tauri.conf.json` (CSP) · `analyze.rs` (Aşama 1) · UI (visual_notes)

## 10. Riskler ve önlemler

- **Türkçe WER hâlâ yüksek** → large-v3(-q5) + hazır altyazı önceliği; ileride Türkçe fine-tune değerlendirilebilir (resmi ggml değil, ayrı iş).
- **VLM deneysel (llama.cpp mtmd)** → hata merdiveni + `partial` yalnız-metin; Faz 2 ayrı teslim, Faz 1 riski sıfır.
- **Base64 görsel bug'ı (#26770)** → b10964'te doğrulanacak; olmazsa `/completion` + `multimodal_data` yolu.
- **VRAM/sohbet kesintisi** → beklenen davranış; mutex + bitince geri yükleme; kullanıcıya bildirim.
- **Uzun analiz süresi** → ilerleme + iptal; seri QUEUE; kullanıcı bekleyebilir.
- **Kategori patlaması** → mevcut `taxonomy.ts` eşik + `maxNew`; LLM ham çıktısı `topics_json`'da ayrıca saklanır.
- **Taksonomi tekrarı** → `taxonomy.ts` yeniden yazılmaz, aynen çağrılır.
- **Model indirme boyutları** (Faz 2 toplam ~9 GB) → mevcut Bileşenler UI'ı; opsiyonel modül, zorunlu değil.
- **Context taşması** → map-reduce (4.6).

## 11. Çıkış kriterleri

- [ ] Hazır altyazı varsa kullanılır; yoksa whisper large-v3(-q5) üretir (`transcript_source` doğru).
- [ ] Analiz indirilmiş kayıtta manuel + toplu tetiklenebilir; sonuç `item_analysis`'e yazılır.
- [ ] Çıktı: özet, konular (kategorilere normalize + eşikli), keywordler (etiketlere normalize + sınırlı), `recipe` (varsa, nullable).
- [ ] `confidence ≥ 0.6` tarif kartı gösterilir; altı saklanır ama gösterilmez.
- [ ] Analizli kayıt varsayılan atlanır; `force` ile üzerine yazılır; `UNIQUE(item_id)` korunur.
- [ ] Uzun video map-reduce ile tek JSON'a iner; kırpma yok.
- [ ] AI kapalı/model eksik → fail-closed, net mesaj, çökme yok.
- [ ] (Faz 2) Kare+VLM çalışır; başarısızlıkta `partial` yalnız-metin; chat GPU mutex ile durup döner.
- [ ] Yeni testler geçer; `typecheck + lint + test + build` (+ `cargo test`) yeşil.

## 12. Açık sorular / uygulamada netleşecek

- Yeni whisper modellerinin **sha256**'sı HF'de yok (repo SHA1 tutuyor) → bir kez indirilip **yerelde hesaplanarak** sabitlenir. VLM modelleri için aynı yöntem.
- yt-dlp altyazısı **analiz anında** best-effort çekilir (video indirilirken değil); başarısızsa gömülü/whisper'a düşer.
- Analiz sonucu **ayrı bir `chunk_type` açmaz**; `refreshItemIndex` mevcut transkript/metin chunk'larını tazeler (Faz 1). Ayrı `chunk_type='analysis'` ileri faz.
