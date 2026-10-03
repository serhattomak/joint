# Tasarım: Kategorizasyon ve Etiketleme Kalitesi (İş Kolu C)

Tarih: 2026-10-04
Durum: Onaylandı (konuşma üzerinden) — uygulama planı öncesi spec incelemesi bekliyor
Kapsam: `jointvault/` (Tauri v2 + React 19 + TS)
İlişki: Program B → **C** → A. B (indeks/arama) tamamlandı. Bu spec yalnızca C.

## 1. Amaç

Otomatik kategori/etiketleme **tutarlı, öngörülebilir ve hızlı** olsun; taksonomi
çoğalmasın; düşük kaliteli öneriler körlemesine yazılmasın. Bugünkü somut sorunlar:

1. **Normalizasyon/doğrulama yok** — model çıktısı olduğu gibi DB'ye gider;
   kırpma, küçük harf, `#` sökme, uzunluk sınırı, tekilleştirme ve mevcut adlarla
   **harf/aksan/tire duyarsız** eşleştirme yok → "Yapay Zeka / yapay zeka / yapay-zeka".
2. **`confidence` yok sayılır** — düşük güvenli öneriler de uygulanır.
3. **Sınırsız yeni kategori** — `applyCategorization` her bilinmeyen adı kategori açar.
4. **Ayrıştırma hatası sessiz** — model JSON dışı dönerse boş sonuç; sebep görünmez.
5. **Sıralı + öğe başına LLM** — yavaş.

## 2. Onaylanan kararlar

| Karar | Seçim |
|---|---|
| Taksonomi disiplini | Mevcuda **sıkı bağlı** + normalize; yeni kategori seyrek ve eşikli |
| Uygulama davranışı | **Güven eşiği** (varsayılan 0.6, ayarlanabilir) + rapor |
| Öneri üretimi | **Deterministik ön geçiş + LLM** (boşluklar için) |
| Rust | Değişmez (geçersiz JSON = boş + confidence 0 ile tespit edilir) |

## 3. Kapsam dışı (YAGNI)

- Önizleme/onay UI'ı (eşik + rapor yeterli).
- Mevcut yinelenen kategorileri birleştirme aracı (bu, ileri taksonomi yönetimi).
- Bulut/uzak model; kategori önerisi için yeni model.
- Terminoloji (iş kolu A).

## 4. C1 — `lib/taxonomy.ts` (yeni, saf)

### 4.1 `normalizeKey(s: string): string`
Eşleştirme anahtarı: `toLocaleLowerCase('tr-TR')`; Türkçe aksan katlama
(`ı→i, İ→i, ş→s, ğ→g, ü→u, ö→o, ç→c`); tire/noktalama/boşluk → tek boşluk; kırp.
**Yalnızca karşılaştırma içindir**, görünen adı değiştirmez.

### 4.2 `matchExisting(raw: string, existing: string[]): string | null`
`existing` içinde `normalizeKey` eşleşeni bulur ve **mevcut kanonik adı** döndürür
(DB'deki yazım korunur). Eşleşme yoksa `null`. Çoğalmanın birincil önleyicisi budur.

### 4.3 `normalizeTag(raw: string): string | null`
Baştaki `#` sök; kırp; boşluk sadeleştir; `toLocaleLowerCase('tr-TR')`; uzunluk ≤ 40;
boşsa `null`.

### 4.4 `resolveCategories(suggested, existing, opts)`
`opts: { confidence: number; minConfidence: number; maxNew: number }` (varsayılan
`maxNew = 1`, `minConfidence` = eşik)
- Her öneri `matchExisting` ile mevcuda eşlenir (kanonik ad).
- Eşleşmeyenler: yalnızca `confidence >= minConfidence` ve toplam yeni sayısı
  `maxNew`'i aşmıyorsa kabul (normalize edilmiş ad).
- Dönüş: `{ names: string[]; newNames: string[] }` (dedupe, sıra korunur).

### 4.5 `resolveTags(suggested, existing, opts)`
`opts: { max: number }`
- Her öneri `normalizeTag`; mevcuda eşlenirse kanonik, değilse normalize ad.
- Tekilleştir (normalizeKey), `max` ile sınırla.
- Dönüş: `string[]`.

### 4.6 `matchTaxonomyInText(text, categories, tags)`
- Metni `normalizeKey`'e çevir; ardından **boşlukla token'lara** böl.
- Her kategori/etiket adını da `normalizeKey` + token'lara böl; metin token
  dizisinde **ardışık** token bloğu olarak ara (sözcük sınırı böyle kurulur).
- Yalnızca `normalizeKey(name).length >= 3` adlar aranır.
- Dönüş: `{ categories: string[]; tags: string[] }` (kanonik adlar).

## 5. C2 — Öneri hattı (`categorizeAndTagItem`)

`lib/ai.ts`:

1. Öğe metni = başlık + not + transkript (`getItemTranscriptText`).
2. Mevcut taksonomi yüklenir (çağıran verirse o).
3. **Deterministik ön geçiş:** `matchTaxonomyInText(text, cats, tags)`.
4. **Boşluk varsa** (kategori yok ya da etiket sayısı < 2) LLM çağrısı (`ai_categorize_and_tag`).
5. LLM çıktısı:
   - Geçersiz JSON tespiti: `confidence === 0 && categories.length === 0 && tags.length === 0 && summary === ''` → "başarısız".
   - `resolveCategories` / `resolveTags` ile normalize + mevcuda eşlenir.
6. Deterministik + LLM birleşir (dedupe, cap: kategori ≤ 2, etiket ≤ 5).
7. Dönüş genişler:

```ts
export interface CategorizeAndTagResult {
  categories: string[];
  tags: string[];
  summary: string;
  confidence: number;
  /** Önerinin nereden geldiği (teşhis/rapor). */
  source: 'deterministic' | 'llm' | 'both' | 'none';
}
```

- Deterministik eşleşme varsa `confidence` en az `1.0` sayılır (kanonik eşleşme).
- LLM başarısızsa deterministik sonuç yine döner; ikisi de yoksa `source: 'none'`.

## 6. C3 — Uygulama eşiği + rapor (`batchCategorizeItems`)

- Eşik: `localStorage['jv-ai-tag-threshold']` (yoksa **0.6**).
- `auto_apply_tags` kapalıysa hiçbir şey uygulanmaz (yalnız öneri üretilir).
- Açıkken: `result.confidence >= threshold` **veya** `source === 'deterministic'`
  ise `applyCategorization` çağrılır; aksi hâlde atlanır.
- Dönüş genişler:

```ts
{ processed: number; applied: number; lowConfidence: number; failed: number; deterministic: number }
```

- `failed` = LLM ayrıştırma hatası **ve** deterministik sonuç da boş olan öğeler.

## 7. C4 — UI (`SettingsView`)

- "Kategorisiz İçerikleri Düzenle" kartına **güven eşiği** kaydırıcısı (0–1, adım 0.05;
  mevcut `ui/slider` veya `ui/select`). Değer `localStorage`'a yazılır.
- Rapor metni: "N uygulandı · M düşük güvenle atlandı · K LLM'siz eşleşti".
- AI kapalıyken eylemler kilitli (B'de yapıldı; korunur).

## 8. Test ve doğrulama

- `taxonomy.test.ts` (yeni, saf):
  - `normalizeKey`: tr büyük/küçük harf, aksan katlama, tire/boşluk/noktalama.
  - `matchExisting`: "yapay-zeka" ↔ "Yapay Zeka" eşleşir, kanonik ad döner.
  - `resolveCategories`: mevcut eşlenir; yeni yalnız eşik üstü ve `maxNew` sınırında.
  - `resolveTags`: `#` sökülür, dedupe, `max` sınırı.
  - `matchTaxonomyInText`: kısa ad (<3) eşleşmez; sözcük sınırı; aksanlı metin eşleşir.
- `lib/ai.ts` LLM yolu manuel (IPC).
- Bitirmeden: `npm run typecheck && npm run lint && npm run test && npm run build`.

## 9. Dosya listesi

**Yeni:** `src/lib/taxonomy.ts` · `src/lib/taxonomy.test.ts`
**Değişen:** `src/lib/ai.ts` · `src/components/SettingsView.tsx`

## 10. Riskler ve önlemler

- **Aşırı katı eşik** önerileri tümden atlar → eşik ayarlanabilir; rapor atlananı gösterir.
- **Deterministik yanlış eşleşme** (kısa/genel ad) → min uzunluk 3 + sözcük sınırı.
- **Aksan katlama görünen adı bozar** → katlama yalnızca anahtar üretiminde; ad korunur.
- **`auto_apply_tags` semantiği** → kapalıyken hiç uygulanmaz (mevcut ayar korunur).
- **Rust'a dokunulmaz** → geçersiz JSON boş+0 ile tespit edilir (yanlış-pozitif düşük;
  boş bir gerçek öneri de zaten uygulanacak bir şey taşımaz).

## 11. Çıkış kriterleri

- [ ] Model önerileri normalize edilir; mevcut adlara harf/aksan/tire duyarsız eşlenir.
- [ ] Yeni kategori seyrek (öğe başına ≤ `maxNew`) ve yalnız eşik üstünde açılır.
- [ ] Deterministik ön geçiş eşleşen öğelerde LLM'siz sonuç üretir (hız).
- [ ] Güven eşiği altı uygulanmaz; rapor uygulanan/atlanan/eşleşen sayılarını verir.
- [ ] LLM geçersiz JSON'unda deterministik sonuç korunur; `source` doğru raporlanır.
- [ ] Yeni saf testler geçer; tüm suite + typecheck/lint/build yeşil.
