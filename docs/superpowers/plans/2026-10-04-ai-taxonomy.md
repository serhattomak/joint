# Kategorizasyon ve Etiketleme Kalitesi (C) Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Otomatik kategori/etiketleme mevcut taksonomiye sıkı bağlı, normalize, güven-eşikli ve LLM'siz hızlı olsun.

**Architecture:** Saf `taxonomy.ts` normalizasyon/eşleştirme/çözümleme yapar. `ai.ts` önce deterministik ön geçişi çalıştırır, boşluk varsa LLM'e gider, çıktıyı `taxonomy.ts` ile normalize edip mevcuda eşler. `batchCategorizeItems` güven eşiğiyle uygular ve genişletilmiş rapor döner. Ayarlar eşik seçici + rapor gösterir.

**Tech Stack:** React 19, TypeScript, Vite, `@tauri-apps/plugin-sql`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-04-ai-taxonomy-design.md`

## Global Constraints

- Çevrimdışı, tek kullanıcı, yeni npm bağımlılığı YOK; Rust'a dokunulmaz.
- Türkçe arayüz; mevcut AI kartı/liste dili ve `ui/select` primitifi kullanılır (yeni primitive yok).
- Mevcut `auto_apply_tags` semantiği korunur (kapalıysa hiç uygulanmaz).
- Mevcut imzalar: `applyCategorization(itemId, categoryNames, tagNames)` korunur.
- Doğrulama: `npm run typecheck && npm run lint && npm run test && npm run build`.

## Review Focus

1. **Aksan/tire eşleşmesi bozulmasın** — "yapay-zeka" ↔ "Yapay Zeka" eşleşmeli, kanonik ad korunmalı. *(T1 testi)*
2. **Yeni kategori patlaması** — düşük güvende veya `maxNew` üstünde yeni kategori açılmamalı. *(T1 testi)*
3. **Deterministik yanlış eşleşme** — kısa/genel ad (ör. "AI") metinde eşleşmemeli. *(T1 testi)*
4. **Eşik altı uygulanmamalı** — düşük güvenli öneri yazılmamalı, raporda görünmeli. *(T2 + manuel)*
5. **LLM geçersiz JSON'da deterministik korunmalı** — ayrıştırma hatası öneriyi yok etmemeli. *(T2 + manuel)*

---

## Task 1: `lib/taxonomy.ts` (saf)

**Files:**
- Create: `jointvault/src/lib/taxonomy.ts`
- Test: `jointvault/src/lib/taxonomy.test.ts`

**Interfaces:**
- Produces:
  - `normalizeKey(s: string): string`
  - `matchExisting(raw: string, existing: string[]): string | null`
  - `normalizeTag(raw: string): string | null`
  - `resolveCategories(suggested: string[], existing: string[], opts: { confidence: number; minConfidence: number; maxNew?: number }): { names: string[]; newNames: string[] }`
  - `resolveTags(suggested: string[], existing: string[], opts?: { max?: number }): string[]`
  - `matchTaxonomyInText(text: string, categories: string[], tags: string[]): { categories: string[]; tags: string[] }`

- [ ] **Step 1: Başarısız testi yaz** — `taxonomy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  matchExisting,
  matchTaxonomyInText,
  normalizeKey,
  normalizeTag,
  resolveCategories,
  resolveTags,
} from './taxonomy';

describe('normalizeKey', () => {
  it('tr büyük/küçük + aksan + tire/noktalama', () => {
    expect(normalizeKey('Yapay Zekâ & Veri-Bilimi')).toBe('yapay zeka veri bilimi');
    expect(normalizeKey('YAPAY-ZEKA')).toBe('yapay zeka');
    expect(normalizeKey('Işık')).toBe('isik');
  });
});

describe('matchExisting', () => {
  it('aksan/harf duyarsız mevcut adı döndürür', () => {
    expect(matchExisting('yapay-zeka', ['Yapay Zeka', 'Müzik'])).toBe('Yapay Zeka');
    expect(matchExisting('yok', ['Müzik'])).toBeNull();
  });
});

describe('normalizeTag', () => {
  it('# söker, küçük harf, kırpar', () => {
    expect(normalizeTag('#Python')).toBe('python');
    expect(normalizeTag('   ')).toBeNull();
  });
});

describe('resolveCategories', () => {
  it('mevcuda eşler; yeni yalnız eşik üstü ve maxNew sınırında', () => {
    const r = resolveCategories(
      ['yapay-zeka', 'Astronomi', 'Biyoloji'],
      ['Yapay Zeka'],
      { confidence: 0.9, minConfidence: 0.6, maxNew: 1 },
    );
    expect(r.names).toEqual(['Yapay Zeka', 'Astronomi']);
    expect(r.newNames).toEqual(['Astronomi']);
  });

  it('düşük güvende yeni kategori açmaz', () => {
    const r = resolveCategories(['Astronomi'], ['Yapay Zeka'], {
      confidence: 0.3,
      minConfidence: 0.6,
      maxNew: 1,
    });
    expect(r.names).toEqual([]);
  });
});

describe('resolveTags', () => {
  it('# söker, tekilleştirir, sınırlar', () => {
    const r = resolveTags(['#Python', 'python', 'Rust', 'Go', 'C', 'Java'], ['Python']);
    expect(r).toEqual(['Python', 'rust', 'go', 'c', 'java']);
  });
});

describe('matchTaxonomyInText', () => {
  it('token sınırı + min uzunluk', () => {
    const r = matchTaxonomyInText('Yapay zeka ve rust dili', ['Yapay Zeka', 'AI'], ['rust', 'x']);
    expect(r.categories).toEqual(['Yapay Zeka']);
    expect(r.tags).toEqual(['rust']);
  });

  it('kısa adı eşlemez', () => {
    expect(matchTaxonomyInText('AI çağı', ['AI'], []).categories).toEqual([]);
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npm test -- taxonomy` (workdir `jointvault`)
Expected: FAIL — modül yok.

- [ ] **Step 3: Modülü yaz** — `taxonomy.ts`:
  - `normalizeKey`: `toLocaleLowerCase('tr-TR')` → aksan katla (`ı→i, ş→s, ğ→g, ü→u, ö→o, ç→c, â→a, î→i, û→u`) → `[^a-z0-9]+` → tek boşluk → kırp. (Yalnızca anahtar; görünen ad değişmez.)
  - `matchExisting`: `normalizeKey` eşitliği; mevcut kanonik adı döndür.
  - `normalizeTag`: baştaki `#` sök, boşluk sadeleştir, tr-lower, ≤40, boş → null.
  - `resolveCategories`: sırayla; mevcuda eşlenen → kanonik; eşleşmeyen → yalnız `confidence >= minConfidence` ve `newNames.length < (maxNew ?? 1)` ise kabul; `normalizeKey` ile dedupe.
  - `resolveTags`: `normalizeTag`; mevcuda eşlenirse kanonik; dedupe; `max ?? 5`.
  - `matchTaxonomyInText`: `normalizeKey(text)` token'lara böl; adı da token'lara böl ve **ardışık** blok olarak ara; `normalizeKey(name).length >= 3`.

- [ ] **Step 4: Testi çalıştır, geçtiğini gör**

Run: `npm test -- taxonomy`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add jointvault/src/lib/taxonomy.ts jointvault/src/lib/taxonomy.test.ts
git commit -m "feat(taxonomy): normalizasyon + mevcuda esleme + deterministik eslesme"
```

---

## Task 2: `lib/ai.ts` — deterministik + eşik + rapor

**Files:**
- Modify: `jointvault/src/lib/ai.ts`

**Interfaces:**
- Consumes: `matchExisting`, `matchTaxonomyInText`, `resolveCategories`, `resolveTags` (`./taxonomy`).
- Produces:
  - `CategorizeAndTagResult` genişler: `source: 'deterministic' | 'llm' | 'both' | 'none'`
  - `TAG_THRESHOLD_KEY = 'jv-ai-tag-threshold'`, `readTagThreshold(): number` (varsayılan 0.6)
  - `batchCategorizeItems` dönüşü: `{ processed; applied; lowConfidence; failed; deterministic }`

- [ ] **Step 1: Tipi ve eşiği ekle** — `CategorizeAndTagResult`'a `source`; `TAG_THRESHOLD_KEY` + `readTagThreshold` (localStorage; geçersizde 0.6).

- [ ] **Step 2: `categorizeAndTagItem` akışını yenile**
  - `text = [title, note, transcript].filter(Boolean).join('\n')`.
  - `det = matchTaxonomyInText(text, cats, tags)`.
  - `needLlm = det.categories.length === 0 || det.tags.length < 2`.
  - `needLlm` ise `invoke('ai_categorize_and_tag', ...)` (try/catch → null).
  - `llmValid = !!llm && (llm.confidence > 0 || llm.categories.length > 0 || llm.tags.length > 0 || !!llm.summary)`.
  - `suggestedCats = [...det.categories, ...(llmValid ? llm.categories : [])]`; aynı etiketler.
  - `resolvedCats = resolveCategories(suggestedCats, cats, { confidence: llmValid ? llm.confidence : 0, minConfidence: readTagThreshold(), maxNew: 1 })`.
  - `resolvedTags = resolveTags(suggestedTags, tags, { max: 5 })`.
  - `detHasAny = det.categories.length > 0 || det.tags.length > 0`.
  - `applyConfidence = detHasAny ? 1 : llmValid ? llm.confidence : 0`.
  - `source = detHasAny && llmValid ? 'both' : detHasAny ? 'deterministic' : llmValid ? 'llm' : 'none'`.
  - Dönüş: `{ categories: resolvedCats.names, tags: resolvedTags, summary: llmValid ? llm.summary : '', confidence: applyConfidence, source }`.

- [ ] **Step 3: `batchCategorizeItems` eşik + rapor**
  - `const threshold = readTagThreshold();`
  - Sayaçlar: `processed, applied, lowConfidence, failed, deterministic`.
  - Her öğe: `result = await categorizeAndTagItem(it, allCats, allTags)`; `processed++`.
  - `if (result.source === 'deterministic' || result.source === 'both') deterministic++;`
  - `const hasSuggestions = result.categories.length > 0 || result.tags.length > 0;`
  - `const canApply = shouldApply && hasSuggestions && (result.source === 'deterministic' || result.source === 'both' || result.confidence >= threshold);`
  - `canApply` → `applyCategorization`; `applied++`; `allCats/allTags` güncelle (resolved adlarla).
  - değilse: `result.source === 'none' ? failed++ : lowConfidence++;`
  - Dönüş `{ processed, applied, lowConfidence, failed, deterministic }`.

- [ ] **Step 4: Doğrula**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add jointvault/src/lib/ai.ts
git commit -m "feat(ai): deterministik kategori/etiket + guven esigi + rapor"
```

---

## Task 3: `SettingsView` — eşik seçici + rapor

**Files:**
- Modify: `jointvault/src/components/SettingsView.tsx`

**Interfaces:**
- Consumes: `TAG_THRESHOLD_KEY`, `readTagThreshold` (`@/lib/ai`).

- [ ] **Step 1: Eşik seçici** — "Kategorisiz İçerikleri Düzenle" kartına `ui/select` ile güven eşiği (`0.3 · 0.5 · 0.6 · 0.7 · 0.8`), `readTagThreshold()` ile başlangıç; değişince `localStorage.setItem(TAG_THRESHOLD_KEY, value)` + yerel state.

- [ ] **Step 2: Rapor metni** — `runOrganizeUncategorized` sonucunu genişlet:
  `${res.applied} uygulandı · ${res.lowConfidence} düşük güvenle atlandı · ${res.deterministic} LLM'siz eşleşti` (uygun olduğunda `· ${res.failed} başarısız`).

- [ ] **Step 3: Doğrula**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add jointvault/src/components/SettingsView.tsx
git commit -m "feat(settings): kategori guven esigi + genisletilmis rapor"
```

---

## Task 4: Bütünsel doğrulama

- [ ] **Step 1: Tüm kapılar**

Run: `npm run typecheck && npm run lint && npm run test && npm run build` (workdir `jointvault`)
Expected: yeşil.

- [ ] **Step 2: Manuel smoke (`npx tauri dev`, AI açık)**

- [ ] "Kategorisizleri Düzenle" → rapor uygulanan/atlanan/LLM'siz sayılarını verir.
- [ ] Eşleşen öğeler (mevcut etiket metinde geçiyor) LLM'siz, hızlı işlenir.
- [ ] Yeni kategori sayısı gözle görülür azalır; "Yapay Zeka / yapay zeka" çoğalmaz.
- [ ] Eşiği 0.8'e çekince düşük güvenli öneriler uygulanmaz ve raporda artar.
- [ ] Bir öğenin etiket/kategorisi değişince arama tazelenir (B tazelik).

- [ ] **Step 3: DESIGN/PRODUCT tutarlılığı** — yeni kural yok.

## Self-Review Notları

- **Spec kapsamı:** §4→T1; §5/§6→T2; §7→T3; §8→T4.
- **Tip tutarlılığı:** `resolveCategories` dönüşü `{names,newNames}` (T1) ile T2 kullanımı uyumlu; `source` birleşimi T2'de tutarlı; `batchCategorizeItems` dönüş alanları T3 raporuyla eşleşir.
- **Basitleştirme:** LLM/IPC yolu için birim testi yok (plugin-sql/IPC); saf mantık T1'de, gerisi manuel smoke.
