# Tasarım: Yeniden Kategorize + Taksonomi Bakımı

Tarih: 2026-10-04
Durum: Onaylandı (konuşma üzerinden) — uygulama planı öncesi spec incelemesi bekliyor
Kapsam: `jointvault/` (Tauri v2 + React 19 + TS)

## 1. Amaç

İki eksik kapatılır:

1. **Mevcut kayıtları yeniden kategori/etiketle** — bugüne dek yalnız *kategorisiz/
   etiketsiz* kayıtlar düzenleniyordu. Kullanıcı, **atamaları olan** kayıtları da
   baştan üretmek istiyor (temiz, tutarlı taksonomi).
2. **Mevcut taksonominin kendisini denetle/temizle** — yinelenen adlar (ör.
   "yapay-zeka" ↔ "Yapay Zeka"), kullanılmayan kategoriler/etiketler ve yakın-anlam
   grupları (ör. "ai" ↔ "yapay zeka") için birleştirme/silme + denetim.

## 2. Onaylanan kararlar

| Karar | Seçim |
|---|---|
| Mevcut atamalar | **Sıfırdan yeniden üret** (uygulanabilirse) |
| Güvenlik | **Otomatik yedek + yıkıcı onay + rapor** |
| Taksonomi bakımı | Yinelenen birleştir + kullanılmayanı sil + denetim + **yakın-anlam (LLM) önerileri** |
| Yerleşim | Yeniden kategorize → **Ayarlar/Arşiv Bakım**; taksonomi bakımı → **Koleksiyonlar** |
| Rust | Değişmez (yakın-anlam önerisi `ai_chat_stream` ile) |

## 3. Kapsam dışı (YAGNI)

- Etiketin kaynağını (AI/elle) izleme; onun yerine yedek+onay.
- Etiket/kategori yeniden adlandırmanın yaygın (URL/başlık) etkisi.
- Otomatik zamanlanmış taksonomi bakımı.
- Yakın-anlam birleştirmesini otomatik uygulama (yalnız ÖNERİ + onay).

## 4. Bölüm 1 — Mevcut kayıtları yeniden kategorize

### 4.1 `batchCategorizeItems` genişlemesi (`lib/ai.ts`)
- Yeni seçenek: `replaceExisting?: boolean`.
- Yeni sayaç: `replaced: number`.
- Davranış: `canApply` ise:
  - `replaceExisting` **true** → önce `setCategoriesForItem(id, [])` +
    `setTagsForItem(id, [])` (temizle), sonra `applyCategorization`.
  - `false` → mevcut davranış (ekle).
- `canApply` değilse **temizleme YAPILMAZ** — mevcut atamalar korunur (boşa veri kaybı yok).
- Dönüş: `{ processed, applied, lowConfidence, failed, deterministic, skipped, replaced }`.

### 4.2 Ayarlar (`SettingsView`)
- "Arşiv Bakım & Düzenleme Araçları" kartına **"Tüm Kayıtları Yeniden Kategorize Et"**.
- Akış: `createBackup(await getDb())` → `ConfirmDialog` (yıkıcı) → `batchCategorizeItems(tümItems, { forceAutoApply: true, replaceExisting: true, onProgress })` → rapor:
  `"{applied} yeniden üretildi · {lowConfidence} düşük güvenle atlandı · {failed} başarısız"`.
- AI/model hazır değilse düğme kilitli (mevcut `aiEnabled`/`llm_ready` kapısı).

### 4.3 Seçili kayıtlar (`BulkActions`)
- Mevcut "AI ile kategorize" toplu eylemine, aynı yedek+onay altında
  `replaceExisting: true` yolu (kullanıcı onaylar).

## 5. Bölüm 2 — Taksonomi bakımı

### 5.1 `lib/taxonomy-maintenance.ts` (yeni, saf)
- `normalizeKey` (mevcut `taxonomy.ts`) ile çalışır.
- `duplicateGroups(entries: { name: string; count?: number }[]): { canonical: string; duplicates: string[] }[]`
  — aynı normalize anahtara düşen adları gruplar; **kanonik** = en yüksek `count`
  (eşitlikte en kısa ad, yoksa ilk ad); `count` yoksa ilk ad.
- `parseMergeSuggestions(text: string, known: string[]): string[][]`
  — LLM metninden `[[...], [...]]` gruplarını ayıklar; bilinmeyen adları atar,
  tek-elemanlı grupları atar; bozuk JSON'da `[]`.

### 5.2 `lib/db/client.ts` birleştirme
- `mergeTags(canonicalId: string, duplicateIds: string[]): Promise<void>`
  `INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT item_id, $1 FROM item_tags WHERE tag_id IN (...);`
  sonra `DELETE FROM tags WHERE id IN (...)` (FK CASCADE artık satırları temizler).
- `mergeCategories(canonicalId, duplicateIds)` — aynısı `item_categories`/`categories`.
- Tümü `runAtomic` ile.

### 5.3 Yakın-anlam önerisi (`lib/ai.ts`)
- `suggestTaxonomyMerges(kind: 'tags' | 'categories', names: string[]): Promise<string[][]>`
  — `streamAiChat` (mevcut `ai_chat_stream`) ile bir istem gönderir, yanıtı
  `parseMergeSuggestions` ile ayrıştırır. AI kapalıysa boş döner (düğme kilitli).

### 5.4 Koleksiyonlar "Taksonomi Bakımı" paneli (`CollectionsView`)
- Denetim listesi: kategori/etiket adı + kullanım sayısı (`listTagsWithCounts`/
  `listCategoriesWithCounts`); satır işaretleri: **yinelenen**, **kullanılmayan (0)**.
- **Yinelenenleri birleştir**: `duplicateGroups`; her grup için kanonik seç + onayla.
- **Kullanılmayanları sil**: count 0 olanlar; onayla (toplu).
- **Yakın-anlam önerileri** (AI açıksa düğme): `suggestTaxonomyMerges`; gruplar
  listelenir, her biri onayla-birleştir.
- Her yıkıcı işlemden önce `createBackup` + `ConfirmDialog`.
- Sonrası: `vault-items-updated` + etkilenen öğeler için `vault-item-index-dirty`.

## 6. Güvenlik

- **Yedek zorunlu:** her iki bölümde de yıkıcı işlem öncesi `createBackup(await getDb())`
  (VACUUM INTO; mevcut yedek ezilmez). Yedek alınamazsa işlem BAŞLAMAZ.
- **Onay:** yıkıcı eylemler `ConfirmDialog` (kırmızı) ile.
- **Kurtarma:** yedekten geri dönüş mevcut Yedekleme bölümünden.

## 7. Test ve doğrulama

- `taxonomy-maintenance.test.ts` (yeni, saf):
  - `duplicateGroups`: "Yapay Zeka" / "yapay-zeka" / "YAPAY ZEKA" tek grup; farklı
    adlar ayrı; sayaç verilince kanonik en çok kullanılan.
  - `parseMergeSuggestions`: geçerli JSON gruplar; bilinmeyen ad atılır; tek-eleman
    atılır; bozuk metinde `[]`.
- `batchCategorizeItems` `replaceExisting` yolu: IPC/db; manuel smoke.
- Manuel smoke: tüm kayıtları yeniden kategorize → yedek alındı mı, rapor doğru mu,
  eşik altı kayıtların eski etiketleri korundu mu; yinelenen birleştirme üyeleri
  taşıdı mı; kullanılmayanlar silindi mi; AI önerileri geldi mi.
- Bitirmeden: `npm run typecheck && npm run lint && npm run test && npm run build`.

## 8. Dosya listesi

**Yeni:** `src/lib/taxonomy-maintenance.ts` · `src/lib/taxonomy-maintenance.test.ts`
**Değişen:** `src/lib/ai.ts` · `src/lib/db/client.ts`
· `src/components/SettingsView.tsx` · `src/components/BulkActions.tsx`
· `src/components/CollectionsView.tsx`

## 9. Riskler ve önlemler

- **Veri kaybı (sıfırdan üret):** yedek + onay; ayrıca eşik altında temizleme yok.
- **Yavaşlık (tüm kayıt):** deterministik ön geçiş çoğu kaydı LLM'siz işler;
  ilerleme gösterilir.
- **LLM öneri gürültüsü:** öneriler otomatik uygulanmaz; kullanıcı onaylar.
- **Birleştirme yanlış kanonik:** kanonik kullanıcı seçer (öneri gösterilir).
- **Yedek alınamaması:** işlem başlamaz (fail-safe).

## 10. Çıkış kriterleri

- [ ] Tüm kayıtlar (veya seçili) yeniden kategorize edilebilir; `replaceExisting` ile.
- [ ] Eşik altı/başarısız kayıtlarda eski atamalar KORUNUR.
- [ ] Her yıkıcı işlemden önce otomatik yedek alınır; alınamazsa başlamaz.
- [ ] Yinelenen taksonomi adları birleştirilebilir (üyeler taşınır).
- [ ] Kullanılmayanlar (0) silinebilir.
- [ ] AI açıkken yakın-anlam grupları önerilir; onayla birleştirilir.
- [ ] Yeni saf testler geçer; tüm suite + typecheck/lint/build yeşil.
