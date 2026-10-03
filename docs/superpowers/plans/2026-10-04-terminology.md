# Terminoloji ve Yerelleştirme (A) Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Görünür arayüz metinlerini **Arşiv · Kayıt · Araçlar · Asistan** sözlüğüne taşımak; kod kimliklerine dokunmadan.

**Architecture:** `PRODUCT.md`/`DESIGN.md` sözleşmeleri elle güncellenir (`DESIGN.md` önce). Kaynak metinleri, uzun→kısa sıralı bir **çekim sözlüğü** ile tek geçişte çevrilir; ardından diff elle okunup Türkçe çekim/bağlam düzeltilir. Kod tanımlayıcıları (IPC olayları, tablolar, `jv-*`, tipler) değişmez.

**Tech Stack:** React 19 + TS + Tailwind; Vite; Vitest.

**Spec:** `docs/superpowers/specs/2026-10-04-terminology-design.md`

## Global Constraints

- Yalnız **görünür** dizeler: JSX metni, `title`/`placeholder`/`aria-label`, `label`/`hint`, bildirim/uyarı.
- **Kod kimlikleri dokunulmaz:** `vault*`, `ItemRecord`, `vault-items-updated`, `vault-item-index-dirty`, tablo/tip adları, `jv-*` anahtarları, `toolboxOnly`/`aiOnly` gibi değişkenler.
- Ürün adı **JointVault** kalır. Arayüz Türkçe, "sen" hitabı, sıcak-teknik ton.
- Sözlük: Kasa→Arşiv, Fiş→Kayıt, Araç Kutusu→Araçlar, Kasa Asistanı→Asistan, Semantik Kasa İndeksi→Anlamsal Arşiv İndeksi, yer imi/gönderi→Kayıt.
- Doğrulama: `npm run typecheck && npm run lint && npm run test && npm run build`.

## Review Focus

1. **Türkçe çekim doğruluğu** — "Kasaya Dön"→"Arşive Dön", "Fişi Aç"→"Kaydı Aç"; mekanik çeviri artıkları ("arşivsını", "arşivdaki") kalmamalı. *(T2 diff okuması + grep)*
2. **Kod kimliği korunması** — IPC olay adları/`jv-*`/tablolar değişmemeli. *(T2 grep)*
3. **Görünür artık terim kalmaması** — `Kasa/Fiş/Araç Kutusu/yer imi/gönderi` yalnız kod/yorum. *(T2 grep)*
4. **Doküman tutarlılığı** — `PRODUCT.md`/`DESIGN.md` sözlükle uyumlu. *(T1)*
5. **Kapsam taşması** — yorum değişikliği yalnız yanlış öğretiyorsa; diff gereksiz büyümemeli. *(T2)*

---

## Task 1: Dokümanlar — sözlük + terim güncellemesi

**Files:**
- Modify: `PRODUCT.md`
- Modify: `DESIGN.md`

**Interfaces:** Yok (metin).

- [ ] **Step 1: `DESIGN.md`'ye "Terimler" bölümü** — `## Primitives` bölümünün üstüne ekle:

```markdown
## Terimler

Arayüzün sözlüğü Türkçedir ve tekildir; eşanlamlı ikinci bir sözcük kullanılmaz.

| Kavram | Terim |
|---|---|
| Kullanıcının tüm medya kaydı | **Arşiv** |
| Tek bir kayıtlı öğe (post/video/makale) | **Kayıt** |
| Yerel medyayı işleyen araçlar bölümü | **Araçlar** |
| Yerel yapay zekâ sohbeti | **Asistan** |

"Kasa", "fiş", "araç kutusu", "yer imi", "gönderi" kullanılmaz.
```

- [ ] **Step 2: `DESIGN.md` gövdesindeki terimler** — metinde geçen "Kasa/Kasa medyası/Kasa ölçeği/Fiş" terimlerini Arşiv/Kayıt'a çevir (teknik kurallar aynen kalır). Bileşen sözlüğündeki görünür örnek metinler güncellenir.

- [ ] **Step 3: `PRODUCT.md`'ye "Sözlük" bölümü** — `## Product Principles` altına ya da uygun yere kısa bir bölüm ekle (aynı tablo, kısa). Gövdedeki "kasa/kayıt/öğe" anlatımını sözlükle uyumla; ürün tanımındaki "kişisel medya arşivi" ifadesi zaten doğru.

- [ ] **Step 4: Doğrula**

Run: `git grep -n -i -e 'kasa' -e 'fiş' -- PRODUCT.md DESIGN.md`
Expected: yalnız sözlük bölümündeki "kullanılmaz" örnekleri kalır (terim listesi); anlatı metni temiz.

- [ ] **Step 5: Commit**

```bash
git add PRODUCT.md DESIGN.md
git commit -m "docs(term): sozluk - Arşiv/Kayıt/Araçlar/Asistan"
```

---

## Task 2: Kaynak metinleri — çekim sözlüğüyle çevir + elle düzelt

**Files:**
- Modify: `jointvault/src` altında görünür metin taşıyan tüm bileşenler (Sidebar, App, Toolbar, ItemGrid, ItemViews, ItemRecord, CollectionsView, DownloadsView, ToolboxHub, MergeTool, SilenceTool, GifTool, SubtitleTool, DuplicatesView, ConverterStudio, SyncView, StatsView, SettingsView, AiAssistantView, ChatMessages, ChatHistoryPanel, ClipboardWatcher, DataBackupSection, ResetDatabaseDialog, BulkActions, RuleStrip, TagPicker, MediaPlayerModal …).

**Interfaces:** Yok.

- [ ] **Step 1: Artık-terim envanterini çıkar**

Run: `git grep -l -i -e 'kasa' -e 'fiş' -e 'Araç Kutusu' -e 'yer imi' -e 'gönderi' -- jointvault/src`
Expected: hedef dosya listesi (planın dosya listesiyle tutarlı).

- [ ] **Step 2: Geçici çeviri betiğini yaz** — `.tmp/terms.mjs` (git-ignored):

```js
import { readFileSync, writeFileSync } from 'node:fs';

// UZUN → KISA sıralı (çekimler önce). Elle gözden geçirilecek; ilk geçiş.
const MAP = [
  ['Semantik Kasa İndeksi', 'Anlamsal Arşiv İndeksi'],
  ['Kasa Asistanı', 'Asistan'],
  ['Araç Kutusu', 'Araçlar'],
  ['Kasamdaki', 'Arşivimdeki'], ['kasamdaki', 'arşivimdeki'],
  ['Kasamda', 'Arşivimde'], ['kasamda', 'arşivimde'],
  ['Kasamın', 'Arşivimin'], ['kasamın', 'arşivimin'],
  ['Kasama', 'Arşivime'], ['kasama', 'arşivime'],
  ['Kasamı', 'Arşivimi'], ['kasamı', 'arşivimi'],
  ['Kasam', 'Arşivim'], ['kasam', 'arşivim'],
  ['Kasadaki', 'Arşivdeki'], ['kasadaki', 'arşivdeki'],
  ['Kasasını', 'Arşivini'], ['kasasını', 'arşivini'],
  ['Kasaya', 'Arşive'], ['kasaya', 'arşive'],
  ['Kasadan', 'Arşivden'], ['kasadan', 'arşivden'],
  ['Kasada', 'Arşivde'], ['kasada', 'arşivde'],
  ['Kasanın', 'Arşivin'], ['kasanın', 'arşivin'],
  ['Kasanla', 'Arşivinle'], ['kasanla', 'arşivinle'],
  ['Kasayı', 'Arşivi'], ['kasayı', 'arşivi'],
  ['Kasası', 'Arşivi'], ['kasası', 'arşivi'],
  ['Kasa', 'Arşiv'], ['kasa', 'arşiv'],
  ['Fişlerden', 'Kayıtlardan'], ['fişlerden', 'kayıtlardan'],
  ['Fişleri', 'Kayıtları'], ['fişleri', 'kayıtları'],
  ['Fişler', 'Kayıtlar'], ['fişler', 'kayıtlar'],
  ['Fişten', 'Kayıttan'], ['fişten', 'kayıttan'],
  ['Fişin', 'Kaydın'], ['fişin', 'kaydın'],
  ['Fişi', 'Kaydı'], ['fişi', 'kaydı'],
  ['Fişe', 'Kayda'], ['fişe', 'kayda'],
  ['Fiş', 'Kayıt'], ['fiş', 'kayıt'],
  ['Yer imi', 'Kayıt'], ['yer imi', 'kayıt'],
  ['Gönderileri', 'Kayıtları'], ['gönderileri', 'kayıtları'],
  ['Gönderi', 'Kayıt'], ['gönderi', 'kayıt'],
];

for (const file of process.argv.slice(2)) {
  let text = readFileSync(file, 'utf8');
  for (const [from, to] of MAP) text = text.split(from).join(to);
  writeFileSync(file, text);
}
console.log('done:', process.argv.length - 2, 'dosya');
```

- [ ] **Step 3: Betiği hedef dosyalara uygula**

Run (envanter dosyalarıyla):
```bash
node .tmp/terms.mjs $(git grep -l -i -e 'kasa' -e 'fiş' -e 'Araç Kutusu' -e 'yer imi' -e 'gönderi' -- jointvault/src)
```
Expected: "done: N dosya". (Windows'ta gerekirse dosya listesini elle ver.)

- [ ] **Step 4: Diff'i OKU ve çekim/bağlam hatalarını elle düzelt** — `git diff` çıktısını gözden geçir:
  - "arşivsını"/"arşivdaki"/"fişleri" gibi yanlış kalıntıları bul.
  - "Arşiv Asistanı" → "Asistan"; "Anlamsal Arşiv İndeksi" doğru.
  - Cümle başı büyük harf/çekim akışını düzelt (ör. "Kasanla Doğal Dille Konuş" → "Arşivinle Doğal Dille Konuş").
  - Sidebar grup etiketini elle **ARŞİV** yap (kaynakta `'Kasa'` grup etiketi varsa; `Sidebar.tsx` `<GroupLabel>Kasa</GroupLabel>`).

- [ ] **Step 5: Kod kimliklerinin korunduğunu doğrula**

Run:
```bash
git grep -n -e "vault-items-updated" -e "vault-item-index-dirty" -e "jv-ai-" -e "jv-sidebar" -e "jv-sort" -- jointvault/src | head
```
Expected: değişmemiş (bu adlar hâlâ yerinde).

- [ ] **Step 6: Artık görünür terim taraması**

Run:
```bash
git grep -n -i -e 'kasa' -e 'fiş' -e 'Araç Kutusu' -e 'yer imi' -e 'gönderi' -- jointvault/src
```
Expected: kalan eşleşmeler yalnız **kod/yorum** (ör. `vault` değil; Türkçe sözcük yalnız yorumda). Görünür dizede kalan varsa elle düzelt.

- [ ] **Step 7: Doğrula**

Run: `npm run typecheck && npm run lint && npm run test && npm run build` (workdir `jointvault`)
Expected: yeşil.

- [ ] **Step 8: Commit**

```bash
git add jointvault/src
git commit -m "refactor(term): gorunur metinler Arşiv/Kayıt/Araçlar/Asistan sozlugune"
```

---

## Task 3: Bütünsel doğrulama

- [ ] **Step 1: Tüm kapılar**

Run: `npm run typecheck && npm run lint && npm run test && npm run build` (workdir `jointvault`)
Expected: yeşil.

- [ ] **Step 2: Manuel smoke (`npx tauri dev`)**

- [ ] Ray grupları: **ARŞİV · ARAÇLAR · SİSTEM**; "Asistan" öğesi.
- [ ] Büyük başlık/boş durumlar: "Arşiv boş", "Bu kurallara uyan kayıt yok".
- [ ] Kayıt modalı: "Kaydı Aç", "Kayıt Detayları", not alanı.
- [ ] Araç Kutusu başlığı **Araçlar**; alt araçlarda "Araçlar'a dön".
- [ ] İndirmeler: "Arşiv Medyaları", "Arşive Dön".
- [ ] Ayarlar: "Arşiv Bakım", "Anlamsal Arşiv İndeksi", yedek metinleri.
- [ ] Asistan: başlık "Asistan", örnek sorular "Arşivimde…".
- [ ] Tüm cümlelerde çekim doğru; "kasa/fiş" görünmüyor.

- [ ] **Step 3: Sözlük tutarlılığı** — `DESIGN.md` "Terimler" ve `PRODUCT.md` "Sözlük" uygulamayla uyumlu; sapma varsa önce docs.

## Self-Review Notları

- **Spec kapsamı:** §3/§4→T2; §5→T1; §6→T3.
- **Tip tutarlılığı:** Yok (metin değişikliği); kod kimlikleri korunur (§4).
- **Basitleştirme:** Birim testi yoktur (dize değişikliği); doğrulama gözle diff okuma + `git grep` + build ile yapılır. Betik `.tmp`'de throwaway'dır (commit edilmez).
- **Risk:** Mekanik çeviri artıkları; Step 4 zorunlu elle okuma ile yakalanır.
