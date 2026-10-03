# Tasarım: Terminoloji ve Yerelleştirme (İş Kolu A)

Tarih: 2026-10-04
Durum: Onaylandı (konuşma üzerinden) — uygulama planı öncesi spec incelemesi bekliyor
Kapsam: `jointvault/` görünür arayüz metinleri + `PRODUCT.md` / `DESIGN.md`
İlişki: Program B → C → **A**. B ve C tamamlandı. Bu spec programın son iş kolu.

## 1. Amaç

Arayüzdeki terimler ("Kasa", "Fiş", "Kasa Asistanı", "Araç Kutusu") soyut/absürt
duruyor ve sözlük tutarsız (yer imi / gönderi / kayıt / içerik / medya karışık).
Arayüz Türkçe, sıcak ama teknik ve **tek sözlük** konuşmalı (PRODUCT.md ilke 4).

## 2. Onaylanan kararlar

| Karar | Seçim |
|---|---|
| Terim sözlüğü | **Arşiv · Kayıt · Araçlar · Asistan** |
| Kapsam | Yalnız **görünür arayüz metinleri** + `PRODUCT.md`/`DESIGN.md` |
| Kod tanımlayıcıları | **Değişmez** (değişken, IPC olayı, tablo/tip adı) |
| Kaçkın terimler | "yer imi" / "gönderi" → **Kayıt** |
| Yorumlar | Yalnız terminolojiyi yanlış öğretiyorsa güncellenir |

## 3. Sözlük (çekimleriyle)

| Eski | Yeni |
|---|---|
| Kasa · Kasam · Kasaya · Kasadan · Kasada · Kasanın · Kasanla | Arşiv · Arşivim · Arşive · Arşivden · Arşivde · Arşivin · Arşivinle |
| Fiş · Fişi · Fişler · Fişe · Fişten | Kayıt · Kaydı · Kayıtlar · Kayda · Kayıttan |
| Araç Kutusu · Araç Kutusu'na | Araçlar · Araçlar'a |
| Kasa Asistanı | Asistan |
| Semantik Kasa İndeksi | Anlamsal Arşiv İndeksi |
| yer imi · gönderi | Kayıt |

Ek eşlemeler:
- Sidebar grup etiketi: **KASA → ARŞİV**.
- "Kasaya Ekle / Kasaya Dön / Kasa Medyaları / Kasa Yedekleri / Kasa Bakım /
  Kasa özeti / Kasa boş / Kasaya Uygula / Merkezi Fişi Aç / Fiş Detayları …" →
  Arşiv/Kayıt karşılıkları.
- Asistan örnek soruları ve istemleri: "Kasamda…" → "Arşivimde…".

## 4. Sınır ve yaklaşım

- Yalnız kullanıcıya **görünen** dizeler (JSX metni, `title`/`placeholder`/
  `aria-label`, `label`/`hint`, bildirim/uyarı metinleri) güncellenir.
- **Kod tanımlayıcıları dokunulmaz:** `vault`, `ItemRecord`, `vault-items-updated`,
  `vault-item-index-dirty`, tablo/tip adları, `jv-*` localStorage anahtarları.
  Bunlar kullanıcıya görünmez; yeniden adlandırmak veri/kırılma riski taşır (YAGNI).
- "Fiş" İngilizce yer tutucularda farklı olabilir; yalnız görüneni çevrilir.
- Çekim: mekanik toplu değiştirme YETMEZ (Türkçe ekler). Her dize bağlamında elle
  doğru çekimle yazılır; sözlük tablosu rehberdir.

## 5. Dokümanlar

- `PRODUCT.md`: kısa bir **"Sözlük"** bölümü eklenir (Arşiv/Kayıt/Araçlar/Asistan);
  gövdedeki terimler güncellenir (Kasa→Arşiv vb.). Ürün adı **JointVault** kalır.
- `DESIGN.md`: **"Terimler"** bölümü eklenir; bileşen sözlüğündeki metin terimleri
  güncellenir ("Kasa medyası", "Fiş" vb.). Teknik/tasarım kuralları değişmez.

## 6. Doğrulama

- **Artık terim taraması:** `git grep -i -e 'kasa' -e 'fiş' -e 'Araç Kutusu'
  -e 'yer imi' -e 'gönderi' -- jointvault/src` sonrası kalan eşleşmeler yalnız
  **kod/yorum** olmalı (görünür dize kalmamalı). Elle onaylanır.
- `npm run typecheck && npm run lint && npm run test && npm run build` yeşil.
- Manuel smoke: gezinme (ray grupları), büyük başlık, boş durumlar, kayıt modalı,
  indirmeler, araç kutusu, ayarlar, asistan; terimler tutarlı ve doğru çekimde.

## 7. Dosya listesi (görünür metni olanlar)

`PRODUCT.md`, `DESIGN.md`; ve `jointvault/src` altında görünür metin taşıyan
bileşenler: `Sidebar`, `App`, `Toolbar`, `ItemGrid`, `ItemViews`, `ItemRecord`,
`CollectionsView`, `DownloadsView`, `ToolboxHub` (+ `MergeTool`/`SilenceTool`/
`GifTool`/`SubtitleTool`/`DuplicatesView`), `SyncView`, `StatsView`,
`SettingsView`, `AiAssistantView`, `ChatMessages`, `ChatHistoryPanel`,
`ClipboardWatcher`, `ConverterStudio`, `DataBackupSection`, `ResetDatabaseDialog`,
`BulkActions`, `RuleStrip`, `TagPicker`, `MediaPlayerModal`, `not-found`/boş
durum metinleri.

> Not: Tam dosya listesi uygulama planında grep ile kesinleştirilir; bu liste
> kapsamı tarif eder, sınırı değil.

## 8. Riskler ve önlemler

- **Yanlış çekim** (mekanik değiştirme): her dize bağlamında elle; sözlük rehber.
- **Kod tanımlayıcısının yanlışlıkla değişmesi:** yalnız dize içerikleri; grep
  doğrulaması kod adlarının korunduğunu gösterir.
- **Anlam kaybı:** "Kasa" bir marka/metafordu; "Arşiv" PRODUCT.md'nin kendi
  tanımıdır → anlam korunur.
- **Kapsam taşması:** yalnız görünür metin; yorum/kimlik dokunulmaz.

## 9. Çıkış kriterleri

- [ ] Görünür metinlerde "Kasa/Fiş/Araç Kutusu/yer imi/gönderi" kalmaz.
- [ ] Terimler tutarlı ve doğru Türkçe çekimde (Arşiv/Kayıt/Araçlar/Asistan).
- [ ] Kod tanımlayıcıları (IPC olayları, tablolar, `jv-*`) değişmemiş.
- [ ] `PRODUCT.md` ve `DESIGN.md` sözlük bölümleriyle güncel.
- [ ] `typecheck/lint/test/build` yeşil; manuel smoke tutarlı.
