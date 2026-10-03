# Yeniden Kategorize + Taksonomi Bakımı Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mevcut kayıtları yeniden kategorize et (yedek+onay) ve mevcut taksonomiyi denetle/birleştir/temizle (yinelenen + kullanılmayan + yakın-anlam önerileri).

**Architecture:** Saf yardımcılar `taxonomy-maintenance.ts`'te (gruplama + LLM yanıtı ayrıştırma). `ai.ts`'e `replaceExisting` (temizle+yeniden üret) ve `suggestTaxonomyMerges` (LLM). `client.ts`'e atomik `mergeTags/mergeCategories`. UI: Ayarlar'da toplu yeniden kategorize, Koleksiyonlar'da Taksonomi Bakımı paneli. Her yıkıcı işlem yedek+onay.

**Tech Stack:** React 19, TypeScript, Vite, `@tauri-apps/plugin-sql`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-04-taxonomy-maintenance-design.md`

## Global Constraints

- Çevrimdışı, tek kullanıcı; Rust'a dokunulmaz (`ai_chat_stream` yeniden kullanılır).
- Her yıkıcı işlemden ÖNCE `createBackup(await getDb())`; yedek alınamazsa işlem başlamaz.
- Yıkıcı eylemler `ConfirmDialog` ile onaylanır.
- Terminaloji: **Arşiv · Kayıt · Araçlar · Asistan** (yeni metinler bu sözlüğe uyar).
- Kod kimlikleri korunur.
- Doğrulama: `npm run typecheck && npm run lint && npm run test && npm run build`.

## Review Focus

1. **Veri kaybı** — `replaceExisting` yalnız `canApply` iken temizlemeli; eşik altında eski atamalar korunmalı. *(T2 + manuel)*
2. **Yedek fail-safe** — yedek alınamazsa işlem başlamamalı. *(T4/T6 manuel)*
3. **Birleştirme doğruluğu** — üyeler kanoniğe taşınmalı, fazlalık silinmeli, üye kaybı olmamalı. *(T3, manuel SQL)*
4. **LLM yanıtı bozuk** — `parseMergeSuggestions` çökmemeli, bilinmeyen/tek-elemanlı grupları atmalı. *(T1 testi)*
5. **Yinelenen kanonik seçimi** — en çok kullanılan ad kanonik olmalı. *(T1 testi)*

---

## Task 1: `lib/taxonomy-maintenance.ts` (saf)

**Files:**
- Create: `jointvault/src/lib/taxonomy-maintenance.ts`
- Test: `jointvault/src/lib/taxonomy-maintenance.test.ts`

**Interfaces:**
- Consumes: `normalizeKey` (`./taxonomy`).
- Produces:
  - `duplicateGroups(entries: { name: string; count?: number }[]): { canonical: string; duplicates: string[] }[]`
  - `parseMergeSuggestions(text: string, known: string[]): string[][]`

- [ ] **Step 1: Başarısız testi yaz** — `taxonomy-maintenance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { duplicateGroups, parseMergeSuggestions } from './taxonomy-maintenance';

describe('duplicateGroups', () => {
  it('normalizeKey eşleşenleri gruplar; kanonik en çok kullanılan', () => {
    const g = duplicateGroups([
      { name: 'Yapay Zeka', count: 5 },
      { name: 'yapay-zeka', count: 1 },
      { name: 'YAPAY ZEKA' },
      { name: 'Müzik', count: 3 },
    ]);
    expect(g).toEqual([{ canonical: 'Yapay Zeka', duplicates: ['yapay-zeka', 'YAPAY ZEKA'] }]);
  });

  it('yinelenen yoksa boş döner', () => {
    expect(duplicateGroups([{ name: 'A' }, { name: 'B' }])).toEqual([]);
  });
});

describe('parseMergeSuggestions', () => {
  const known = ['ai', 'yapay zeka', 'fotoğraf'];

  it('geçerli grupları döndürür, tek-elemanlıyı atar', () => {
    const out = parseMergeSuggestions('[[ "ai", "yapay zeka" ], ["fotoğraf"]]', known);
    expect(out).toEqual([['ai', 'yapay zeka']]);
  });

  it('bilinmeyen adları atar', () => {
    expect(parseMergeSuggestions('[["ai","bilinmeyen"]]', known)).toEqual([]);
  });

  it('bozuk metinde boş döner', () => {
    expect(parseMergeSuggestions('üzgünüm JSON yok', known)).toEqual([]);
    expect(parseMergeSuggestions('{bozuk', known)).toEqual([]);
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `npm test -- taxonomy-maintenance` (workdir `jointvault`)
Expected: FAIL — modül yok.

- [ ] **Step 3: Modülü yaz** — `taxonomy-maintenance.ts`:
  - `duplicateGroups`: `normalizeKey(name)` ile `Map<key, entries[]>`; her grup `length>1` ise kanonik = en yüksek `count` (eşitlikte en kısa ad, yoksa ilk); `duplicates` = gruptaki diğer adlar (aynı normalize anahtar altında, kanonik hariç). Dönüş yalnızca yinelenen grupları içerir.
  - `parseMergeSuggestions`: metinden ilk `[` … son `]` aralığını al; `JSON.parse`; `Array.isArray`; iç diziler `Array.isArray` + tüm öğeler `known` içinde (küçük/büyük harf duyarsız `normalizeKey` ile karşılaştır, dönen ad `known`'dan kanonik olsun); tek-elemanlı grupları at; hata → `[]`.

- [ ] **Step 4: Testi çalıştır, geçtiğini gör**

Run: `npm test -- taxonomy-maintenance`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add jointvault/src/lib/taxonomy-maintenance.ts jointvault/src/lib/taxonomy-maintenance.test.ts
git commit -m "feat(taxonomy): yinelenen gruplama + LLM birlestirme onerisi ayristirma"
```

---

## Task 2: `lib/ai.ts` — `replaceExisting` + `suggestTaxonomyMerges`

**Files:**
- Modify: `jointvault/src/lib/ai.ts`

**Interfaces:**
- Consumes: `parseMergeSuggestions` (`./taxonomy-maintenance`); mevcut `setCategoriesForItem`, `setTagsForItem`, `streamAiChat`, `getAiStatus`, `isAiEnabled`.
- Produces:
  - `batchCategorizeItems` opsiyonu `replaceExisting?: boolean`; dönüşe `replaced: number`.
  - `suggestTaxonomyMerges(kind: 'tags' | 'categories', names: string[]): Promise<string[][]>`.

- [ ] **Step 1: `replaceExisting`** — `batchCategorizeItems`:
  - Opsiyonlara `replaceExisting?: boolean` ekle; `let replaced = 0;`.
  - `canApply` bloğunda: `if (replaceExisting) { await setCategoriesForItem(it.id, []); await setTagsForItem(it.id, []); }` **sonra** `await applyCategorization(...)`; `applied++`; `if (replaceExisting) replaced++;`.
  - **Temizleme yalnız `canApply` içinde** (eşik altında dokunma).
  - Dönüşe `replaced` ekle.

- [ ] **Step 2: `suggestTaxonomyMerges`**
  - AI kapalı/model yoksa `[]`.
  - `streamAiChat(crypto.randomUUID(), [{ role:'user', content: prompt }], system)` ile yanıt al.
  - sistem: "Sen taksonomi düzenleme asistanısın; yalnızca JSON dizisi döndür."
  - istem: verilen adlar içinde **aynı kavramı** taşıyanları grup; örnek `["ai","yapay zeka"]`; yalnız JSON dizi.
  - `return parseMergeSuggestions(text, names);`

- [ ] **Step 3: Doğrula**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add jointvault/src/lib/ai.ts
git commit -m "feat(ai): replaceExisting ile yeniden uretim + taksonomi birlestirme onerisi"
```

---

## Task 3: `lib/db/client.ts` — atomik birleştirme

**Files:**
- Modify: `jointvault/src/lib/db/client.ts`

**Interfaces:**
- Produces:
  - `mergeTags(canonicalId: string, duplicateIds: string[]): Promise<void>`
  - `mergeCategories(canonicalId: string, duplicateIds: string[]): Promise<void>`

- [ ] **Step 1: `mergeTags`**
  - `duplicateIds` boşsa dön.
  - `runAtomic(db, 'INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT item_id, $1 FROM item_tags WHERE tag_id IN (...); DELETE FROM tags WHERE id IN (...);', [canonicalId, ...duplicateIds])` — `IN` yer tutucuları `$2..$N` (tekrarlı kullanım için ikinci grup `$2..` yeniden).
  - FK CASCADE, silinen etiketlerin `item_tags` satırlarını temizler.

- [ ] **Step 2: `mergeCategories`** — aynısı `item_categories`/`categories`.

- [ ] **Step 3: Doğrula**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add jointvault/src/lib/db/client.ts
git commit -m "feat(db): etiket/kategori birlestirme (atomik)"
```

---

## Task 4: `SettingsView` — Tüm Kayıtları Yeniden Kategorize Et

**Files:**
- Modify: `jointvault/src/components/SettingsView.tsx`

**Interfaces:**
- Consumes: `batchCategorizeItems`, `listItems`, `getDb`, `createBackup`.

- [ ] **Step 1: Durum + işleyici** — yeni `recatBusy`, `recatResult`, `recatProgress`; `confirmRecat` (onay).
- [ ] **Step 2: Akış** — onaydan sonra:
  - `await createBackup(await getDb());` (hata → `setAiError`, DUR).
  - `const items = await listItems();`
  - `await batchCategorizeItems(items, { forceAutoApply: true, replaceExisting: true, onProgress })`.
  - Rapor: `"{applied} yeniden üretildi · {replaced} değişti · {lowConfidence} düşük güvenle atlandı · {failed} başarısız"`.
- [ ] **Step 3: UI** — "Arşiv Bakım & Düzenleme Araçları" kartına `SettingRow` (label: "Tüm Kayıtları Yeniden Kategorize Et", hint: yedek + onay notu) + düğme; `disabled={recatBusy || !aiEnabled || !aiStatus?.llm_ready}`; `ConfirmDialog`.
- [ ] **Step 4: Doğrula** — `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "feat(settings): tum kayitlari yeniden kategorize et (yedek+onay)"`.

---

## Task 5: `BulkActions` — seçili kayıtları yeniden kategorize

**Files:**
- Modify: `jointvault/src/components/BulkActions.tsx`

- [ ] **Step 1:** Mevcut AI kategorize toplu eylemine `replaceExisting: true` yolu ekle; çalıştırmadan önce `createBackup(await getDb())` + `ConfirmDialog`; sonuç raporu (`replaced`).
- [ ] **Step 2:** Doğrula (`npm run typecheck && npm run lint`) + commit `feat(bulk): secili kayitlari yeniden kategorize et`.

---

## Task 6: `CollectionsView` — Taksonomi Bakımı paneli

**Files:**
- Modify: `jointvault/src/components/CollectionsView.tsx`

**Interfaces:**
- Consumes: `listTagsWithCounts`, `listCategoriesWithCounts`, `mergeTags`, `mergeCategories`, `removeTag`, `removeCategory` (`@/lib/db/client`); `duplicateGroups`, `suggestTaxonomyMerges` (`@/lib/ai`); `createBackup`, `getDb`.

- [ ] **Step 1: Panel** — başlığa "Taksonomi Bakımı" düğmesi → `Dialog`; iki sekme/liste (Etiketler/Kategoriler).
- [ ] **Step 2: Denetim** — `*WithCounts()` ile satırlar; her satır: ad + `data-num` kullanım; "yinelenen"/"kullanılmayan (0)" işareti.
- [ ] **Step 3: Yinelenenleri birleştir** — `duplicateGroups(entries)`; her grup için kanonik seçimi göster + `ConfirmDialog` → `mergeTags/mergeCategories(canonicalId, duplicateIds)`.
- [ ] **Step 4: Kullanılmayanları sil** — count 0 olanlar; `ConfirmDialog` (toplu) → `removeTag/removeCategory`.
- [ ] **Step 5: Yakın-anlam önerileri** — AI açıksa düğme → `suggestTaxonomyMerges(kind, names)`; gruplar; her biri onayla-birleştir. AI kapalıysa düğme gizli/kilitli.
- [ ] **Step 6: Güvenlik** — her birleştirme/silme öncesi `createBackup(await getDb())`; hata → işlem yok.
- [ ] **Step 7: Sonrası** — `window.dispatchEvent(new CustomEvent('vault-items-updated'))`; etkilenen öğe id'leri için `vault-item-index-dirty` yay (birleştirmede üye öğeler).
- [ ] **Step 8: Doğrula** — `npm run typecheck && npm run lint && npm run test && npm run build`.
- [ ] **Step 9: Commit** — `git commit -m "feat(collections): taksonomi bakimi - birlestir/sil/oneriler"`.

---

## Task 7: Bütünsel doğrulama

- [ ] **Step 1:** `npm run typecheck && npm run lint && npm run test && npm run build` (workdir `jointvault`) → yeşil.
- [ ] **Step 2: Manuel smoke (`npx tauri dev`)**
  - [ ] "Tüm Kayıtları Yeniden Kategorize Et": yedek alındı mı; onay; rapor; eşik altı kayıtların eski etiketleri KORUNDU mu.
  - [ ] Seçili kayıtlarda aynı işlem.
  - [ ] Koleksiyonlar → Bakım: yinelenen grup birleştir → üyeler kanoniğe taşındı mı, fazlalık silindi mi.
  - [ ] Kullanılmayanlar silindi.
  - [ ] AI açık: yakın-anlam önerileri gelir; onayla birleşir.
- [ ] **Step 3:** `DESIGN.md`/`PRODUCT.md` sözlük uyumu (yeni metinler).

## Self-Review Notları

- **Spec kapsamı:** §4→T2/T4/T5; §5.1→T1; §5.2→T3; §5.3→T2; §5.4→T6; §7→T7.
- **Tip tutarlılığı:** `duplicateGroups` girişi `{name,count?}` (T1) ile T6 kullanımı uyumlu; `batchCategorizeItems` dönüşü `replaced` (T2) ile T4/T5 raporu; `mergeTags/mergeCategories` imzaları (T3) T6.
- **Basitleştirme:** LLM/SQL uçları için birim testi yok; saf mantık T1'de, gerisi manuel smoke. Yedek fail-safe manuel doğrulanır.
