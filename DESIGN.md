---
name: JointVault
description: Kişisel medya arşivi — macOS masaüstü uygulaması dilinde
colors:
  ground-dark: "#1c1c1e"
  ground-light: "#f2f2f7"
  card-dark: "#2c2c2e"
  card-light: "#ffffff"
  label-dark: "#ffffff"
  label-light: "#1d1d1f"
  secondary-label-dark: "rgba(235,235,245,0.6)"
  secondary-label-light: "#6e6e73"
  separator-dark: "#3a3a3c"
  separator-light: "#e0e0e5"
  accent-dark: "#0a84ff"
  accent-light: "#007aff"
  system-red-dark: "#ff453a"
  system-red-light: "#ff3b30"
  system-green-dark: "#30d158"
  system-green-light: "#34c759"
  system-gray: "#8e8e93"
  rail-dark: "rgba(38,38,41,0.72)"
  rail-light: "rgba(232,232,237,0.72)"
  toolbar-dark: "rgba(28,28,30,0.72)"
  toolbar-light: "rgba(242,242,247,0.72)"
  sheet-dark: "rgba(44,44,46,0.8)"
  sheet-light: "rgba(255,255,255,0.78)"
  src-instagram: "#d94f8a"
  src-tiktok: "#35c4c4"
  src-x: "#8f8c83"
  src-pinterest: "#b8352f"
  src-youtube: "#d0443a"
  src-other: "#6f6c65"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.022em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.18
    letterSpacing: "-0.018em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.006em"
  micro:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.006em"
  data:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0.02em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  "2xl": "16px"
spacing:
  toolbar: "52px"
  sidebar: "244px"
  rule-strip: "44px"
  accession-band: "28px"
  gutter: "16px"
components:
  button-primary:
    backgroundColor: "{colors.accent-light}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
    typography: "{typography.body}"
  input:
    backgroundColor: "#ffffff00"
    textColor: "{colors.label-light}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
    typography: "{typography.body}"
  card:
    backgroundColor: "{colors.card-light}"
    textColor: "{colors.label-light}"
    rounded: "{rounded.xl}"
    padding: "12px"
  sheet:
    backgroundColor: "{colors.sheet-light}"
    textColor: "{colors.label-light}"
    rounded: "{rounded.xl}"
    padding: "16px"
  toolbar:
    backgroundColor: "{colors.toolbar-light}"
    textColor: "{colors.label-light}"
    height: "52px"
  rail-item-active:
    backgroundColor: "{colors.card-light}"
    textColor: "{colors.label-light}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "30px"
    typography: "{typography.body}"
  scope-tab-active:
    backgroundColor: "{colors.ground-light}"
    textColor: "{colors.label-light}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "24px"
    typography: "{typography.micro}"
---

# Design System: JointVault

> **Bu dosya yeni bir sohbet/session için tek sözleşmedir.** Yeni bir ekran ya da özellik
> geliştirirken önce bunu, sonra `PRODUCT.md`'yi (ürün gerçeği ve dokunulmazlar), gerekiyorsa
> `jointvault/src/index.css` (`@theme` — token'ların kaynağı) okunur. Buradaki bir kural eskiyse
> **önce bu dosya güncellenir**, sonra kod yazılır; tersi değil.
>
> Değişmez çerçeve: dil **macOS masaüstü uygulaması**, Windows'ta çalışır (pencere kontrolleri
> sağda). Mimari: Tauri v2 + React 19 + Tailwind v4 (`@theme`) + `@base-ui/react` + lucide.
> Türkçe arayüz. 1000+ öğe bütçesi, çevrimdışı font, WCAG AA, `prefers-reduced-motion`.

## Overview

**Creative North Star: "Masaüstü Uygulaması"**

JointVault bir *arşiv* olarak doğar ama bir *macOS uygulaması* olarak davranır. Kabuk sessiz,
malzeme gerçek, hareket fizikseldir: pencere, ray ve araç çubuğu kullanıcının arkasındaki
içeriği bulanıklaştıran yarı saydam katmanlardır; içerik onların altından akar. Arayüz süslenmez —
Apple'ın deyimiyle *craft* edilir: her boşluk, süre ve yarıçap savunulabilir bir karardır.

Bu yön, kayıtlı **"Gece Okuma Odası / Kartoteks"** yönünün yerini alır. Eski yön cama, gradyana,
6px üstü yarıçapa ve ikinci bir yazı yüzüne açıkça yasak koyuyordu; o kısıtlar bu sürümde
kaldırıldı ve `DESIGN.md` yeni sözleşme olarak yeniden yazıldı. Terk edilen dünya marka mirası
değildir.

Dünya gündüz de gece de kurulur ve ikisi de Apple'ın semantiğiyle konuşur: gece `#1c1c1e` zemin,
gündüz `#f2f2f7`. Kâğıt/seramik taklidi yok; yüzeyler **malzeme**dir — yarı saydam taban +
`backdrop-filter`, üstlerinde ışığı yakalayan ince bir çizgi.

**Key Characteristics:**
- Tek aksan: **systemBlue** (`#0a84ff` gece · `#007aff` gündüz). Kırmızı ve yeşil aksan değil,
  *anlam* rengidir (`systemRed`, `systemGreen`).
- Renk asla tek başına anlam taşımaz: her durum ikon + sözcükle birlikte yazılır.
- Tek yüz: **Inter** (SF Pro'ya en yakın serbest yüz, yerelden gömülü). Ölçüm **JetBrains Mono**.
- Boyuta bağlı harf aralığı: büyük metin negatif, küçük metin pozitif.
- Sürekli köşe: radius 4–16px. Hap biçimi yalnızca durum noktası ve anahtar yuvasına ayrılmıştır.
- Malzeme gerçek: ray, araç çubuğu ve yaprak yarı saydamdır ve arkalarını bulanıklaştırır.
- Hareket fiziksel: basış ölçekle iner, geçişler güçlü `ease-out`, süre 150–250ms.
- **Tek sözlük:** aynı işi yapan iki farklı kontrol bir hatadır. Bu kural mimari kadar bağlayıcıdır.

## Colors

Palet ölçülü ve **semantik**. Apple'ın `system*` renkleri anlam taşır; aksan tektir.

### Primary
- **systemBlue** (`#0a84ff` gece · `#007aff` gündüz): Birincil eylemler, aktif indirme durumu,
  seçili öğe, odak halkası, anahtar (switch) ve ilerleme. Düz dolgu; parlama veya gradyan eklenmez.

### Semantic
- **systemGreen** (`#30d158` gece · `#34c759` gündüz): Yalnızca "arşive girdi" — `YEREL` damgası,
  tamamlanmış ilerleme, başarı bildirimi. Başka yerde kullanılmaz.
- **systemRed** (`#ff453a` gece · `#ff3b30` gündüz): Yalnızca hata ve yıkıcı eylem. Uyarı için ayrı
  bir sarı yoktur; uyarı metinle taşınır.
- **systemGray** (`#8e8e93`): Kuyrukta / kayıtsız gibi nötr durumlar.

### Neutral
- **Zemin** (`#1c1c1e` gece · `#f2f2f7` gündüz): İçerik zemini.
- **Kart** (`#2c2c2e` gece · `#ffffff` gündüz): Kart, satır, panel yüzeyi.
- **Etiket** (`#ffffff` gece · `#1d1d1f` gündüz): Gövde metni.
- **İkincil etiket** (`rgba(235,235,245,.6)` gece · `#6e6e73` gündüz): Yardımcı metin.
- **Ayırıcı** (`#3a3a3c` gece · `#e0e0e5` gündüz): Bölmeler ve hairline kenarlar.
- **Platform Mürekkebi** (instagram #d94f8a · tiktok #35c4c4 · x #8f8c83 · pinterest #b8352f ·
  youtube #d0443a · diğer #6f6c65): Marka rengidir, semantik değil; etiket metni olmadan kullanılmaz.
  Yalnızca **nokta** olarak yaşar (filtre çipi, algılama rozeti, kayıt başlığı) — kart ya da satır
  yüzeyine renkli şerit olarak uzanmaz.

### Named Rules
**The Tek Damga Kuralı.** Ekranda tek bir doygun aksan vardır: systemBlue. İkinci bir doygun renk
eklemek dünyayı bir panoya çevirir. Kırmızı ve yeşil aksan değil, *anlam* rengidir; yalnızca
kazanılmış veya bozuk durumlarda ve yalnızca ikon + sözcükle görünür.

**The Semantik Ad Kuralı.** Token adları rolü söyler (`background`, `border`, `muted`), değeri değil.
Yeni bir yüzey eklerken ham hex yazmak yerine en yakın rol token'ı kullanılır; iki tema da tek
yerden döner.

## Typography

**System Font:** Inter (değişken, 100–900) · `ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
**Measurement Font:** JetBrains Mono (değişken, 100–800) · `ui-monospace, SF Mono, Consolas, monospace`

**Character:** Nötr, açık omuzlu bir grotesk; sistem yüzünün işini yapar ve kendini hatırlatmaz.
Inter, SF Pro'nun lisans kısıtı yüzünden **bilinçli ikame**dir. İkisi de projeye gömülüdür
(`public/fonts`, latin + latin-ext, çevrimdışı çalışır) — çalışma anında uzak kaynak çekilmez.
`font-optical-sizing: auto` açıktır.

### Hierarchy
- **Display** (700, 28px/1.12, -0.022em): Görünüm başlıkları (`text-display`).
- **Title** (600, 22px/1.18, -0.018em): Panel, kayıt detayı, boş durum ve diyalog başlığı (`text-title`).
- **Body** (400, 14px/1.5, -0.006em): Gövde metni. Kart/satır başlıkları 15px medium.
- **Micro** (400, 12px/1.4, +0.006em): Alan etiketleri, yardım metni. Büyük harf yok (`text-micro`).
- **Data · damga & künye** (400, 11px/1.45, +0.02em, büyük harf · `text-2xs`): Damga, künye bandı,
  tarih, yüzde, hız, sayım.
- **Data · yol & kimlik** (400, 12px/1.4, mono · `text-micro` + `data-num`): Dosya yolu ve kimlik.

### Named Rules
**The Boyuta-Göre-Aralık Kuralı.** Harf aralığı boyutun fonksiyonudur: display negatif, gövde hafif
negatif, mikro ve veri pozitif. Bir başlığa mikro aralığı vermek ya da tersini yapmak ölçeği bozar.

**The Mono-Veridir Kuralı.** JetBrains Mono yalnızca ölçülebilir şeyler içindir: tarih, yüzde, hız,
süre, adet, kimlik, dosya yolu. Bölüm başlığını mono ve büyük harfle yazmak "teknik görünsün"
kostümüdür. Uygulamada `data-num` özniteliği bu yüzü ve tabular rakamları açar (`index.css`).

**The Büyük-Harf-Künye Kuralı.** Büyük harf ve geniş harf aralığı yalnızca damga ve künye gibi *veri*
yüzeylerinde görünür. Başlığın üstüne etiket (eyebrow) koymak yasaktır; başlık ağırlığını taşır.

## Layout

Spatial model: **sabit çekmece rayı + akan içerik kolonu**, üstte **tek kalıcı araç çubuğu**.

- **Araç çubuğu:** 52px, tam genişlik, `sticky top-0 z-40`, `material-toolbar`. Rayın **da** üstünde
  tek şerittir — ayrı bir marka başlığı yoktur.
- **Ray:** 244px, `material-rail`, `sticky top-[52px] h-[calc(100vh-52px)]` (araç çubuğunun altından
  başlar). `md` altında gizlenir; aynı çekmeceler yatay şeride iner (`SidebarStrip`) — gezinme
  kaybolmaz. Kapatılabilir: tercih `localStorage`'da (`jv-sidebar`), kapalıyken içerik genişler.
- **Kural şeridi:** 44px (`h-11`), `sticky`, arşiv görünümünde; altında içerik akar.
- **İndirme şeridi:** 44px (`h-11`), `sticky top-[52px]`, **yalnız süren indirme varken**
  çizilir; araç çubuğunun hemen altında tek satırdır: iş sayısı · ortalama yüzde · (varsa)
  toplam hız · `Yönet`. Tıklanınca İndirme Yöneticisi açılır; `X` ile kapatılır ve **kapatma
  o indirme kümesine aittir** — yeni bir indirme başlayınca şerit geri gelir. İş bitince
  kendiliğinden kaybolur.
- **Büyük başlık:** arşiv görünümünde `text-display`; altında kapsam sekmeleri. Sayfa yüzeylerinde
  başlık `PageSurface` başlığıdır.
- **Izgara:** 1 / 2 / 3 kolon (sm / xl). Kart yüksekliği içerikten gelir, sabitlenmez.
- **Yoğunluk:** satır görünümü ~52px, kart ~290px; 2.000 kayıt taranabilir kalmalı. Kart ve satırlar
  `content-visibility: auto` taşır (`cv-card`, `cv-row`), sayfalama SQL'de yapılır, arama 250ms
  debounce'ludur.
- **Ritim:** gruplar sıkı, ayrım cömert; başlığın üstündeki boşluk altındakinden fazladır.
- **Kaydırma:** kök `min-h-screen` + sayfa kaydırma. Yüzeyler kendi kaydırma kabını açmaz.

### Named Rules
**The Sıra-Kolon-Değil Kuralı.** Bir sayfa birden çok bölümü (kart, tablo, boş durum) art arda
koyuyorsa aralarındaki ritmi **bölümleri saran kapsayıcı** verir (`flex flex-col gap-6`) —
`PageSurface` gövdesi kendi boşluğunu **vermez**. "Kartlar birbirine yapışık" görünüyorsa sebep
budur.

**The Kart-İçinde-Kart-Yok Kuralı.** Bir kartın içine ikinci bir kart koymak yasaktır. Gruplama
gerekiyorsa: ya başlık + hairline satır listesi (kart **içinde**), ya ayrı kartlar (kart **yanında**).

## Pencere çerçevesi (titlebar)

Pencere çerçevesizdir (`decorations: false`); yerel başlık çubuğu yoktur. **Araç çubuğu aynı
zamanda titlebar'dır:** boş alanları sürüklenebilir (`data-tauri-drag-region` → Windows'ta
`HTCAPTION`; taşıma, yarı-ekrana yapıştırma ve çift tıkla büyütme yerel kalır). Çerçevesizlik
Windows'ta kenardan boyutlandırmayı götürdüğü için görünmez kenar/köşe tutamaçları
`startResizeDragging` ile bunu geri koyar — tutamaçlar bir kabuk ayrıntısıdır, çizilmez ve odak almaz.

Pencere kontrolleri **sağda** durur (Windows alışkanlığı korunur) ama Mac trafik ışığı biçiminde
çizilir: 12px daireler — küçült `#febc2e`, büyüt `#28c840`, kapat `#ff5f57`; grup üzerine gelince
glifler belirir, pencere odak dışındayken üçü de `--color-input` grisine döner. Işıklar bir
*pencere kabuğu* işaretidir, veri değil: 11px mono künye basamağına girmez, `data-num` taşımaz.

Değişen yalnızca görünümdür: native başlık çubuğunun sağ-tık sistem menüsü ve Windows 11'in
"maximize üzerine gel → snap layouts" paneli yoktur; geri kalan davranış (taşıma, boyutlandırma,
yarı-ekran, tepsiye kapanma) aynen sürer.

## Araç çubuğu (imza bileşen)

Tek 52px bant, üç bölge (`Toolbar.tsx`):

- **Sol (rayın üstünde):** ray daralt/göster (`PanelLeft`, tercih kalıcı) + **geri/ileri**
  (gerçek görünüm geçmişi; sınırda `disabled`) + **marka** (ray açıkken görünür, kapalıyken gizlenir).
  Dar pencerede marka gizlenir, denetimler kalır.
- **Orta — yakala/ara alanı:** uygulamanın imza etkileşimi. Alan ortada, hafif dolgulu
  (`rounded-lg bg-card/60`), `Ctrl K` ipucu **alanın içinde sağda**. Durum ikonu modu söyler:
  bağlantı (kayıt), büyüteç (arama), kıvılcım (semantik). Kayıt modunda sağda platform damgası +
  **Ayrıntılı** + **Kaydet** (stamp varyantı) belirir; Enter kaydeder, Escape temizler. Arama
  modunda yanında **Semantik** ve **Eşitle** sessiz düğmeleri durur.
- **Sağ:** görünüm (kart/satır) segmenti (yalnızca arşivde) + tema + **pencere kontrolleri**.

**The Tek-Yakala Kuralı.** Kaydetme eylemi yalnızca araç çubuğundadır; sayfaya ikinci bir "kaydet"
koymak yasaktır.

## Sayfa yüzeyi

Tam-sayfa görünümler (Koleksiyonlar, İndirilenler, Eşitleme, İstatistikler, Araçlar, Dönüştürücü,
Araçlar alt ekranları) tek bir `PageSurface` kabuğu kullanır — Apple'ın gruplandırılmış sayfa
ritmi: solda ikon çipi (`size-8 rounded-lg bg-primary/10 text-primary`, ikon 18px), yanında **tek**
başlık ölçeği (`text-title`), altında açıklama, sağda eylemler; tek padding
(`px-6 pt-6 pb-12 md:px-8`) ve içeriğe göre genişlik (`3xl`–`6xl`). Görünüm kendi
`min-h-screen` / `max-w-*` / `px-*` kabuğunu ve kendi başlık ölçeğini yazmaz.

**The Tek-Sayfa-Kabuğu Kuralı.** Yeni bir tam-sayfa görünüm eklerken başlık, padding ve genişlik elle
kurulmaz; `PageSurface` kullanılır. Kaydırma yüzeye ait değildir.

## Kapsam sekmeleri (arşiv görünümü)

Arşivin kapsamı bir segmenttir: **`Tümü · Favoriler · Yerel`** (`ItemGrid`, büyük başlığın altında).
Segment dili: `rounded-lg border border-border bg-card/60 p-0.5`; aktif öğe
`rounded-md bg-background font-medium shadow-xs`, pasif `text-muted-foreground`.

- Kapsam bir **sekmedir**, gezinme durağı değil: sidebar'da yer almaz, geri/ileri geçmişine yazılmaz.
- Filtre uygulamak seçili sekmeyi bozmaz.
- "Tümü" sidebar öğesi **arşiv açık olduğu sürece** aktiftir; ayrımı sekmeler verir.
- Bir kayıt grubunu daraltmak (platform, koleksiyon, kategori, etiket) **filtredir**, kapsam değil.

## Filtre paneli

Seçim tek bir **`Filtrele`** düğmesinden yapılır; ama **yürürlükteki kurallar gizlenmez**.

- Düğme: filtre ikonu + "Filtrele" + aktif sayı rozeti; aktifken aksan kenarı (`border-primary/40
  bg-primary/10`).
- Panel: iki bölmeli — solda filtre adları (dolu olan nokta işaretli), sağda **arama alanı** +
  seçenekler (TR-duyarlı süzme, `Bulunamadı` durumu).
- **Aktif filtreler şeritte çip olarak kalır** (`YouTube ✕`) ve tek tıkla kaldırılır. Seçim panele,
  durum şeride aittir.
- **Kategori paneli bir ağaçtır** (`CategoryTree`): her düğüm girintili, aç/kapa oklu; bir dal
  açıldığında altları görünür. Seçim **tüm alt ağacı kapsar** — "Yemek" seçiliyken altındaki
  bütün düğümlerin kayıtları gelir. Arama, eşleşen düğümün **atalarını kendiliğinden açar**,
  böylece derin bir eşleşme görünür kalır ("pizza" yazınca `Yemek › Pizza` açılır).
- Sağda sıralama + `N kayıt` sayımı (`data-num`) sabittir.

**The Kural-Görünür-Kalır Kuralı.** Bir filtre ya da ayar yürürlükteyse, onu açan panel kapalıyken
de görünür olmalıdır (çip, damga, etiket). Durum asla yalnızca panel içinde kalmaz.

## Kategori ve etiket

Kavramlar karışmaz; ikisi de kaydı tamamlar ama işleri farklıdır.

| | Kategori | Etiket |
|---|---|---|
| Hiyerarşi | **En fazla 5 seviye**: üst › alt › … | Yok, düz |
| Kayda atanma | Tek kategori; **en derin uyan** (yaprak olmak zorunda değil) | Birden çok |
| Sıra | Kanonik — kayıt künyede **tam yol**: `Yemek › Tatlı › Sütlü Tatlı` | Kullanım sırasına göre |

- **Kayıt tek kategoriye bağlanır ve bu yaprak olmak zorunda değildir:** kayıt en derin uyan
  düğüme oturur; var olandan daha özgülse mevcut bir üstün altında **tek** yeni alt açılır.
  Seçim sorgu katmanında çözülür (`resolveCategoryFilterIds`); üst seçmek **tüm alt ağacı**
  kapsar.
- **Derinlik en fazla 5 seviyedir.** Ağacı bozan yazımlar (kendini üst yapmak, çevrim, sınırı
  aşmak) yazımdan önce doğrulanır (`validateCategoryMove`, `validateCategoryCreate`).
- **Taksonomide aynı anlama gelen iki ad durmaz.** Asistan mevcut listede yakın bir ad varsa
  (`Pizza`) yenisiyle (`Pizza Tarifi`) değiştirmez; adı var olanın altına indirger. Önerilen
  birleştirmeler **hiyerarşiye duyarlıdır** (üst ile onun altı birleştirilmez) ve **imlâya
  duyarlıdır**: aynı kavramın iki yazımında (`Yazilim` / `Yazılım`) kanonik seçim, kullanım
  sayısına bakılmaksızın doğru Türkçe yazımdır (`preferCanonical` / `turkishScore`). Bu,
  şişmeyi baştan keser.
- **Etiket son tercihtir.** Mevcut etiketler her zaman kullanılabilir; yeni etiket
  ancak **güven eşiğini** ve **gerekçeyi** birlikte geçerse önerilir. Gerekçesiz
  etiket taksonomiye girmez — her işlenen kayıtla kası bir etiket büyümez.
- Yeniden yapılandırma (**Koleksiyonlar › Taksonomi bakımı › Plan Oluştur**) her taşımada tam
  **yolu** taşır, böylece N seviyeli ağaç kurabilir; yalnızca **önerir** — kullanıcı önizlemeyi
  görüp onaylayana kadar hiçbir şey değişmez. Onay geri alınamaz; önce yedek alınır.

## Materials

Malzeme, dünyanın en belirgin Apple izidir: yüzen katman **yarı saydamdır ve arkasını
bulanıklaştırır**, böylece altındaki içerik hem görünür hem geri iter.

| Malzeme | Nerede | Gece | Gündüz | Blur |
|---|---|---|---|---|
| `material-rail` | Sol çekmece rayı, dar-pencere şeridi | `rgb(38 38 41 / .72)` | `rgb(232 232 237 / .72)` | 24px · saturate 180% |
| `material-toolbar` | Araç çubuğu | `rgb(28 28 30 / .72)` | `rgb(242 242 247 / .72)` | 24px · saturate 180% |
| `material-sheet` | Diyalog, yaprak, denetçi | `rgb(44 44 46 / .8)` | `rgb(255 255 255 / .78)` | 40px · saturate 180% |

- **Malzeme yalnızca altından bir şey geçtiğinde anlamlıdır.** Sabit bir kolonun arkasında düz zemin
  varsa blur görünmez; bu yüzden `material-rail` çoğunlukla *ton* olarak okunur.
- **Üstteki ince ışık çizgisi** (`inset 0 1px 0 rgb(255 255 255 / .06)`) malzemenin ışığı yakaladığı
  yerdir; süs değil, yön bilgisidir.
- **Işık malzemeyi kesmez:** malzeme üstüne ikinci bir yarı saydam yüzey yığılmaz; okunabilirlik çöker.
  Saydamlık malzemenin işidir — **kart opaktır**.

### Named Rules
**The Azaltılmış-Saydamlık Kuralı.** `prefers-reduced-transparency: reduce` altında üç malzemenin
tabanı opak karşılığına döner ve blur kapanır (`index.css`).

## Elevation & Depth

Derinlik **katmanlı ve yumuşak**tır. Sıfır-ofsetli renkli hale yasaktır.

### Shadow Vocabulary
- **`shadow-card`**: etkileşimli içerik kartının dinlenme gölgesi (neredeyse görünmez).
- **`shadow-hover`**: kart yalnızca fare üzerindeyken yükselir (dokunmatikte tetiklenmez).
- **`shadow-lift`**: yüzen katmanlar — diyalog, menü, popover, bildirim, toplu eylem çubuğu.

**Kenar yapı taşır, gölge yükseklik.** Gruplanmış kart (`settings-card`) dinlenmede gölge taşımaz;
gölge yalnızca etkileşim ve yüzme içindir.

## Shapes

Sürekli köşe: radius 4px (xs) – 16px (2xl). **Kartlar 12px** (`settings-card`), girdi ve butonlar
6px, damgalar 4px, yapraklar 12–16px. Tam yuvarlak (`rounded-full`) yalnızca durum noktaları,
anahtar yuvası, avatar kırpımı ve pencere trafik ışıkları içindir — bir kart ya da buton asla hap
değildir.

Kenarlar 1px hairline'dır ve rolü bölmektir. Bir yüzeyin kenarına kalın renkli şerit koymak yasaktır:
platform bir renk alanı değil, künye bandındaki bir *sözcüktür*. Renk yalnızca noktada kalır.

## Marka işareti

İkon bir **kutu ve içine giren kayıtlar**dır: kutunun ağzından üç kayıt çıkar, ortadaki mavidir
(son giren), yanındakiler geldikleri platformun noktasını taşır. Geometrinin tek kaynağı
`public/favicon.svg`'dir; paket ikonları ondan üretilir (`npx tauri icon public/favicon.svg`).

- **Tam ikon:** 1024 karede squircle (rx 186), grafit `#1c1c1e` zemin, kâğıt `#f2f2f7` kutu,
  yan kartlar `#c6c6ce`, ortadaki kart `#0a84ff`. Noktalar **platform mürekkebidir** ve kural
  gereği yalnız nokta olarak yaşar.
- **Araç çubuğu:** `BrandMark` (`src/components/BrandMark.tsx`) gövdeyi temaya uyarlar — kutu ve
  yan kartlar `currentColor` (kartlar %45), ortadaki kart `primary`. Noktalar düşer (18px'te ölür).
  viewBox işaretin kendi sınırlarına kırpılır: 18px kutuda kaybolmaz.
- **Tek varyant:** ikinci bir sade/monokrom ikon çizilmez; küçük ölçek aynı geometriden gelir.

## Motion

Hareket bir katman değil, arayüzün kendisidir; görsellerle birlikte tasarlanır.

- **Eğriler:** `--ease-out` `cubic-bezier(0.23,1,0.32,1)` (giriş ve basış) · `--ease-in-out`
  `cubic-bezier(0.77,0,0.175,1)` · `--ease-drawer` `cubic-bezier(0.32,0.72,0,1)`. `--ease-paper`
  adı korunur ama değeri `--ease-out`'tur.
- **Süre:** 150ms (basış/hover) · 200ms (katman girişi) · 250ms (yaprak). UI hareketi 300ms'i geçmez.
- **Basış:** `active:scale-[0.97]`; `:active`'te başlar (bırakışta değil), `motion-reduce` altında kapanır.
- **Giriş/Çıkış:** `data-[starting-style]` / `data-[ending-style]` ile `opacity 0` + `scale .95`
  girer, `scale .97` + `opacity 0`'a çıkar. Hiçbir şey `scale(0)`'dan gelmez; çıkış girişten hızlıdır.
- **Çekip-kapat (drag-to-dismiss):** `motion` paketi (`lib/use-drag-dismiss`). Kayıt ve oynatıcı
  yaprakları **aşağı** çekilerek kapatılır; eşik = mesafe > 120px **veya** hız > 600px/s.
  `prefers-reduced-motion` altında tamamen kapalıdır (kapatma düğmesi ve Escape kalır).
- **Etkileşimli hiçbir şey kilitlenmez.**

### Named Rules
**The Basış-Parmak-Altında Kuralı.** Buton yalnızca tıklanınca değil, basılı tutulduğu anda tepki
verir. Sadece bırakışta geri bildirim veren kontrol ölü hisseder.

**The Azaltılmış-Hareket Kuralı.** `prefers-reduced-motion: reduce` altında süreler ve animasyonlar
anlamlı biçimde sadeleşir, ama opaklık/renk geçişleri kalır — azaltmak yok etmek değildir.

## Components

Genel duruş: **sakin kontrol, ölçülü hareket.**

### Buttons
- **Shape:** 6px radius, 32px yükseklik (sm 28px, lg 36px), 10px yatay dolgu.
- **Primary:** systemBlue düz dolgu + beyaz metin. Hover'da dolgu %85 opaklığa iner.
- **Stamp:** Çerçeveli aksan varyantı — şeffaf zemin, mavi kenar ve metin; hover'da doluya döner.
- **Hover / Focus:** Odak halkası tek yerden gelir (`:focus-visible`, 2px `--color-ring`); hiçbir
  varyant kendi ring'ini yazmaz. Basış `scale(.97)`.
- **Secondary / Outline / Ghost / Destructive:** İkincil; dışa çizgi; sessiz; kenarlıklı kırmızı
  blok (dolgu değil). Yıkıcı eylem asla dolu kırmızı değildir.

### Stamps (imza bileşen)
Durum sözlüğü: `kayıtsız` · `kuyrukta` · `iniyor` · `yerel` · `hata` · `yinelenen` · `favori` ·
`dönüştürüldü`. Her damga mono 11px büyük harf, 4px radius, 20px yükseklik ve **lucide ikonu** taşır —
glif veya emoji asla. Renk durumun kendisidir ama tek başına yetmez: ikon ve sözcük her zaman yanındadır.

### Cards / Containers
- **Tek kabuk:** Her kart `settings-card` yardımcı sınıfıdır — 1px kenar, 12px sürekli köşe, **opak**
  `--color-card` zemin. Elle yazılmış `rounded-* border border-border bg-card` varyantları
  sürüklenmedir. Yarı saydam kart (`bg-card/30`…) yoktur.
- **Elevation:** Dinlenmede gölge yok; etkileşimli kart hover'da 2px kalkıp `shadow-hover` alır.
- **Border:** 1px ayırıcı; hover'da girdi rengine döner.
- **Internal Padding:** 12px; künye bandı (`record-band`) 28px sabit yükseklikte ve altında hairline.
- **Künye bandı:** Platform solda, tarih sağda, mono 11px büyük harf. Kartta platform ve tarih
  *yalnızca* burada yazılır; alt satırda tekrarlanmaz.

### Gruplanmış liste (kart içi satır) — `SettingRow` / `FieldGroup`
Ayarlar dili ve tüm listelerin ortak sözlüğü:
- Kap: `settings-card` + `divide-y divide-border/70` (hairline'lar **alt** kenara yazılır).
- Satır (`SettingRow`): solda etiket (`text-sm`) + ipucu (`text-micro text-muted-foreground`),
  sağda kontrol (`shrink-0`). Etiket bloğu `flex-1 min-w-0` — uzun ipucu kontrolü alt satıra düşürmez.
- Kenar yastığı satırda: `px-4` (kap) ya da satır `p-3`.
- **Liste öğesi (ör. Araçlar):** tinted ikon çipi (`size-8 rounded-lg bg-primary/10 text-primary
  [&_svg]:size-[18px]`) + başlık (`text-sm font-medium`) + açıklama (`text-micro`) + sağda ok
  (`ChevronRight`). Her satır aynı yükseklik ve aynı hizada.

### Inputs / Fields
- **Style:** Şeffaf zemin, 1px `--color-input` kenar, 6px radius, 32px yükseklik.
- **Focus:** Kenar `--color-ring`e döner; halka base katmandan gelir. Odak kutuyu iki kez çizmez.
- **Error / Disabled:** `aria-invalid` kenarı kırmızıya çevirir ve alanın altına 12px hata satırı gelir.

### Sheets & Dialogs
Yalnızca kesinti veya korunmuş odak gerektiren işler buraya gelir; kayıt düzenleme ve araç işleri
satır içi panelde yaşar. Yaprak `material-sheet` + 12px radius + `shadow-lift` taşır; örtü
`--color-overlay` ile zemini geri iter. Giriş `data-[starting-style]` ile ölçek+opaklık birlikte,
çıkış daha hızlıdır.

**Not (tarihsel karar):** Kayıt detayı için sağda sabit **denetçi** denendi; içerik dar kaldığı için
reddedildi ve **merkezî modal** korundu (1024×704, medya solda büyük / künye sağda). Bir denetçiyi
yeniden gündeme getirirken dar içerik sütununun okunurluğu test edilir.

### Navigation
- **Rail:** 244px, `material-rail`, gruplar **ARŞİV · ARAÇLAR · SİSTEM**. Bölüm etiketi 11px, mono ya
  da büyük harf **değil**. Öğe 30px yükseklik, 6px radius, 16px lucide ikon.
- **Default / Hover / Active:** Hover'da sessiz yüzey belirir; **aktif ray öğesi** kart yüzeyidir
  (`bg-card` + `font-medium`) ve sağ kenara taşan küçük bir **çentik** rayın hairline'ını keser —
  ray öğesi hap/kapsül değildir. Tinted kapsül seçim (`bg-primary/15` + aksan ikon) **Ayarlar'ın
  pano listesinin** dilidir, ana rayın değil.
- **Mobile:** `md` altında ray yatay kaydırılabilir şeride iner (`SidebarStrip`).

### Kapsam sekmeleri & Filtre paneli
Yukarıdaki iki bölüm (`## Kapsam sekmeleri`, `## Filtre paneli`) bu sözlüğün parçasıdır.

### Empty states
Her boş/öğretici durum aynı üçlüdür: **ikon (`size-7`, `text-muted-foreground` ya da anlam rengi) +
başlık (`text-title`) + açıklama (`text-sm text-muted-foreground`, ~46ch)**. Ortalanır, bol dikey
boşluk alır. Üç hâl ayrıdır ve karıştırılmaz: **tarama öncesi** (ne yapılacağını öğretir),
**işlem sürerken** (spinner + durum), **sonuç yok** (olumlu "Temiz" durumu). Boş bir kart ya da
"bulunamadı" satırı **çizilmez**; bölüm yoksa o bölüm render edilmez.

### İndirme Yöneticisi — Tek Hat (bağlayıcı)

İndirme bir **iştir**, motor bir ayrıntıdır: iki motor (yt-dlp / Turbo) tek listede yaşar.

- **Tek liste, durum şeritleri:** `İniyor · Kuyrukta · Duraklatıldı · Hata · Tamamlandı`.
  Motor yalnız satır künyesinde (`Turbo`, `yt-dlp`) yazılır; **motor sekmeleri yoktur**.
  Şeritler boşsa çizilmez; sayaç ve `bugün` ölçümü başlıkta kalır.
- **Besteci satır içidir:** bağlantı alanı + `İndir`; tek indirme için modal açılmaz.
  Gelişmiş seçenekler (dosya adı, kanal, hedef) ayrı diyalogda durur.
- **Satır:** `transfer-row` (`index.css`) — sabit sütunlar: seçim · ikon · ad · ilerleme ·
  ölçüm · aksiyonlar. Dar pencerede ilerleme ve ölçüm alt satıra iner; sağ kenar kaymaz.
- **Ayrıntı satır içinde açılır:** hedef yol, kaynak, parça haritası ve hata; modal yok.
- **Silme tek diyalogdur:** turbo işleri ve arşiv kayıtları birlikte seçilebilir; "diskten sil"
  ve "arşiv kaydını da kaldır" ayrı anahtarlardır.
- **Tamamlanan katlanır:** ilk 6 satır; `Tümünü gör` ile açılır. Toplu eylem çubuğu seçim
  varken listenin üstünde belirir (bildirim alanıyla çakışmaması için yüzen sabit çubuk değildir).

### Satır görünümü hizalama (bağlayıcı)
`ItemRowView` her satırda **sabit sütunlar** taşır; durum (indirilmiş/indiriliyor/hata/kuyrukta) ve
aksiyon sayısı değişse bile sütunlar kaymaz:

| Sütun | Genişlik | Hizalama |
|---|---|---|
| onay kutusu | `size-3.5` | başta |
| küçük görsel | `size-9` | başta |
| başlık + künye | `flex-1 min-w-0` | sola, taşarsa `truncate` |
| "Okunabilir" çipi | `w-[84px]` | sağa (yoksa da yer tutar) |
| tarih | `w-[72px]` | sağa |
| durum (`DownloadControl`) | `w-[140px]` | sağa |
| aksiyonlar (`ActionButtons`) | `w-[148px]` | sağa (hover'da yalnızca opaklık değişir, yer değişmez) |

**The Hizalı-Satır Kuralı.** Değişken genişlikli bir sağ blok, solundaki bütün sütunları kaydırır —
hizasızlık buradan doğar. Sağdaki her şey **sabit genişlik + sağa hizalı** olur; künye satırı tek
satır `truncate` edilir; tarih ve çip kendi sabit sütununda durur. Ölçerek doğrula: farklı durumdaki
satırların sağ kenarları **birebir** eşit çıkmalı.

## Asistan (sohbet) yüzeyi

Asistan tam-sayfa bir sohbet yüzeyidir; `PageSurface` başlığı kullanmaz, çünkü başlığı
oturumun kendisidir. İki bölge: solda **geçmiş paneli**, sağda mesaj akışı + giriş çubuğu.

- **Geçmiş paneli:** `material-rail` dilinde kolon (`w-60`); satırlar `divide-y divide-border/70`.
  Her satır: başlık (`text-sm`, `truncate`) + göreli tarih (`text-2xs`, mono, `data-num`). Aktif
  satır kart yüzeyidir (`bg-card` + `font-medium`); pasif hover'da sessiz yüzey. `Sabitlenenler` /
  `Diğer` grupları. Üstte arama alanı + `+ Yeni sohbet`.
- **Dar pencere:** `md` altında panel kolon olmaktan çıkar, `absolute` **çekmeceye** iner; gezinme
  kaybolmaz. Açık/kapalı tercihi `localStorage` (`jv-ai-history`).
- **Mesaj balonu (kart DEĞİL):** kullanıcı sağda `rounded-xl bg-primary text-primary-foreground`;
  asistan solda `rounded-xl border border-border bg-card text-card-foreground`. Balon opaktır; kart
  içine kart koyma kuralına tabi değildir çünkü *kabuk* değil *balon*dur. Sabit sözlüktür — ikinci bir
  balon biçimi açılmaz.
- **Durum sözcükleri:** `Arşiv taranıyor…` (yapısal sorgu sürerken, spinner + sözcük), akan imleç
  (streaming), `⚠️ <hata>`. Renk tek başına anlam taşımaz.
- **Bulunan Kayıtlar:** yapısal sorgu sonucu satır kartları — solda platform rozeti + `truncate`
  başlık, sağda `data-num` tarih; tıklayınca kayıt modalı açılır. Referans (chunk) kartlarıyla aynı
  ailedendir; ikinci bir "sonuç kartı" sözlüğü açılmaz.
- **Dışa aktarma:** başlıkta tek eylem; oturum Markdown olarak yazılır (yol renderer'a uğramaz).

### AI çalışma zamanı ve yedekler (bağlayıcı)

Yerel AI **opsiyoneldir** ve **tek anahtarla** açılır; temiz kurulum kapalı başlar. Anahtar
kapalıyken **ölü kontrol çizilmez**: semantik arama düğmesi gizlenir, Asistan yüzeyi "AI kapalı"
der ama sohbet geçmişi okunur kalır.

- **Motor:** llama.cpp **Vulkan** build'i varsayılandır (tek küçük indirme; GPU'suz
  makinede **CPU backend'e düşer**). GPU hızlanması bugün yalnızca **NVIDIA**'da
  gerçekleşir (offload VRAM'e bağlıdır, VRAM yalnız `nvidia-smi`'den gelir); AMD/Intel
  şimdilik CPU'da çalışır. **CUDA** yalnızca NVIDIA'da azami hız için ayrı opsiyondur.
  İndirme **yalnızca AI'a katılınca** yapılır; installer'a gömülmez.
- **Model seçimi:** sohbet için **3B/7B/14B** (Q4) sabit hat + **serbest GGUF** ("doğrulanmadı"
  damgası taşır). Gömme **BGE-M3**, whisper **base** varsayılan. Seçim kalıcıdır; donanıma
  göre öneri ilk-kurulum sihirbazında verilir.
- **AI'sız yedekler (aynı yüzey, dürüst etiket):** "Asistan ile Düzenle" → **Kural tabanlı
  düzenle** (mevcut taksonomi adlarını eşler); defter sayfa özeti → **sayısal özet**;
  taksonomi bakımında deterministik temizlik (yinelenen/boş) kalır. **Asistan sohbeti ve
  hiyerarşi planı AI-only'dir** — deterministik karşılıkları yoktur, AI kapalıyken gizlenir.
- **Semantik arama:** AI kapalıyken düğme gizli; AI açık ama gömme modeli yokken tam-metin
  aramaya (FTS) düşer ve görünür bir not gösterir.

**The Ölü-Kontrol-Yok Kuralı.** Çalışmayan bir AI kontrolü asla çizilmez: ya AI'ı açmanın tek
yolu (Ayarlar) gösterilir, ya kontrol gizlenir. Aynı iş, AI yokken deterministik fiille görünür —
ikinci bir "kural tabanlı mod" ekranı açılmaz.

## Terimler

Arayüzün sözlüğü Türkçedir ve tekildir; eşanlamlı ikinci bir sözcük kullanılmaz.

| Kavram | Terim |
|---|---|
| Kullanıcının tüm medya kaydı | **Arşiv** |
| Tek bir kayıtlı öğe (post/video/makale) | **Kayıt** |
| Yerel medyayı işleyen araçlar bölümü | **Araçlar** |
| Yerel yapay zekâ sohbeti | **Asistan** |
| Kategorilere göre derlenmiş okunabilir derlem | **Defter** |

"Kasa", "fiş", "araç kutusu", "yer imi", "gönderi" kullanılmaz. Defter birimleri: kategori başına bir **sayfa**; ikinci bir eşanlamlı ("bölüm", "kale") girmez. Kategori hiyerarşisinde "üst/alt" denir; "ana kategori", "bölüm", "klasör" girmez.

## Primitives (koddaki sözlük — yeniden icat etme)

Koordinatlar `jointvault/` köküne göredir.

- **Kabuk:** `src/components/Toolbar.tsx` · `src/components/Sidebar.tsx` (`Sidebar`,
  `SidebarStrip`) · `src/App.tsx` (kabuk düzeni, kapsam sekmeleri burada bağlanır).
- **Yüzey:** `src/components/ui/page-surface.tsx` · `src/components/ui/window-controls.tsx`.
- **Controls:** `ui/button` · `ui/input` · `ui/select` · `ui/switch` · `ui/badge` · `ui/stamp` ·
  `ui/progress` · `ui/tabs` · `ui/dialog` · `ui/alert-dialog` (`ConfirmDialog`) · `ui/popover` ·
  `ui/menu` · `ui/tooltip` · `ui/notice` · `ui/field` (`Field`, `SettingRow`, `FieldGroup`).
- **Arşiv:** `src/components/ItemGrid.tsx` (ızgara, büyük başlık, sekmeler, sayfalama) ·
  `src/components/RuleStrip.tsx` (Filtrele paneli) · `src/components/CategoryTree.tsx`
  (paylaşılan kategori ağacı — Filtrele paneli, Defter kenar çubuğu, Koleksiyonlar) ·
  `src/components/ItemViews.tsx`
  (`ItemCardView`, `ItemRowView`, `Stamp`, `DownloadControl`, `ActionButtons`).
- **Tam-sayfa yüzeyler:** `CollectionsView` · `NotebookView` · `DownloadsView` · `SyncView` · `StatsView` ·
  `ToolboxHub` (+ `MergeTool`/`SilenceTool`/`GifTool`/`SubtitleTool`/`DuplicatesView`) ·
  `ConverterStudio` · `SettingsView`.
- **İndirme şeridi:** `src/components/DownloadStrip.tsx` (araç çubuğunun altındaki tek satır;
  iki motorun işlerini toplar, `download-progress` bitişi bildirmediği için bitişi
  `lib/downloads.ts` → `DOWNLOADS_CHANGED_EVENT` taşır).
- **Yardımcılar:** `lib/nav-history.ts` (geri/ileri) · `lib/use-drag-dismiss.ts` (çekip-kapat) ·
  `lib/theme.ts` (tema) · `lib/platform.ts` (platform mürekkebi).
- **CSS yardımcıları (`index.css`):** `material-rail|toolbar|sheet` · `settings-card` ·
  `transfer-row` · `record-band` · `cv-card` · `cv-row` · `skeleton-paper` · `scroll-edge-b`.
- **Eklenti:** `extension/popup.html` bu sözlüğü ve `@theme` token'larını taşır (aynı rol
  adları, gece/gündüz); ayrı bir tasarım dili kurmaz. Kaynak token değişince orası da güncellenir.
  `extension/panel.js` aynı katmanın ikinci taşıyıcısıdır (sayfaya enjekte edilen yüzen kaynak
  paneli): tokenları Shadow DOM içinde kendi `<style>`'ında tutar, yazı tiplerini eklentinin
  kendi dosyalarından yükler — yabancı sayfanın CSS'inden hiçbir şey miras almaz
  (`:host { all: initial }`). Ölçü ve sözlük popup'la aynıdır.

## Yeni ekran/özellik için kontrol listesi

Koda başlamadan:
1. Bu dosyayı ve `PRODUCT.md`'yi oku; dokunulmazları (Türkçe metin, IPC/veri akışı, performans
   bütçesi, çevrimdışı, erişilebilirlik) not et.
2. Ekran **tam-sayfa** mı → `PageSurface`. **Modal/kesinti** mi → `Dialog`. **Satır içi** mi →
   panel. Modalı refleksle seçme.
3. Mevcut primitif var mı? (yukarıdaki envanter) — varsa **kullan**, yoksa tek bir yeni sözlük kur.
4. Token kullan (`index.css` `@theme`); ham hex yazma.
5. Durumları say: hover · focus · disabled · loading · **boş** · hata · seçili. Boş durumu **öğret**.

Yazarken:
6. Kart = `settings-card` (opak). Kart içine kart koyma. Liste = `divide-y divide-border/70` satırlar.
7. Sağ blokları **sabit genişlik + sağa hizalı** yap (satır hizalaması).
8. Yürürlükteki filtre/ayar kapalı panelde de görünür kalsın (çip/damga).
9. Hareket: giriş `ease-out`, basış `scale(.97)`, `data-[starting-style]`, `motion-reduce` +
   `reduced-transparency` sinyallerini ele al.
10. Dar pencereyi birinci sınıf tut (gezinme şeride iner, kart/tablo yeniden akar).

Bitirmeden:
11. `npm run typecheck && npm run lint && npm run test && npm run build` — dördü de yeşil olmalı.
12. Görsel doğrula (`npx tauri dev`, ya da saf bileşenler için `dev/kitchen-sink.html` /
    `dev/verify-controls.html`). Ölçebildiğini **ölç** (örn. satır hizası: sağ kenarlar eşit mi?).
13. Bu dosyada değişen bir kural olduysa **önce burayı güncelle**.

## Do's and Don'ts

### Do:
- **Do** her durumu damgayla ve mutlaka ikon + sözcükle bildir; rengi yalnız bırakma.
- **Do** `data-num` kullan: tarih, yüzde, hız, süre, adet, kimlik, dosya yolu.
- **Do** yüzen katmanları malzemeyle kur (`material-toolbar`, `material-sheet`); içerik altlarından aksın.
- **Do** yeni bir yüzey eklerken önce mevcut primitifi kullan; yeni bir sözlük icat etme.
- **Do** kart dilini tek tut (`settings-card`), listeyi hairline satırlarla kur.
- **Do** sağ blokları sabit genişlikte tut; satırları **ölçerek** hizala.
- **Do** yükleniyor durumunu iskeletle göster (`skeleton-paper`), boş durumu öğret.
- **Do** dar pencereyi birinci sınıf tut.
- **Do** AI'sız yedeği dürüst etiketle ("Kural tabanlı düzenle", sayısal defter özeti); çalışmayan AI kontrolünü çizme.

### Don't:
- **Don't** ikinci bir doygun aksan ekleme; systemBlue tek damgadır.
- **Don't** kart içine kart koyma; gruplama satır listesi ya da kardeş kartlarla yapılır.
- **Don't** yarı saydam kart kullanma (`bg-card/30`…); saydamlık malzemenin hakkıdır.
- **Don't** emoji ya da unicode glifi ikon yerine kullanma; lucide çizilir.
- **Don't** elle `rounded-* border border-border bg-card` kart yazma; `settings-card` var.
- **Don't** filtre/ayar durumunu yalnızca panel içinde bırakma; çip/damga ile görünür tut.
- **Don't** harf aralığını tek değere sabitleme; boyutun fonksiyonudur.
- **Don't** bir yüzeyin kenarına kalın renkli şerit koyma; platform künye bandında sözcüktür.
- **Don't** kart ya da butonu hap biçiminde yapma; 4–16px sürekli köşe kuraldır.
- **Don't** `scale(0)`'dan animasyon başlatma; hiçbir şey yoktan belirmez.
- **Don't** `ease-in` kullanma; giriş her zaman `ease-out`.
- **Don't** UI hareketini 300ms'in üstüne çıkarma.
- **Don't** `prefers-reduced-motion` / `prefers-reduced-transparency` sinyallerini yok sayma.
- **Don't** büyük harf + geniş aralığı gövde metnine uygulama; o damga ve künyenin hakkıdır.
- **Don't** sayfaya ikinci bir "kaydet" eylemi koyma; birincil kayıt araç çubuğunundur.
- **Don't** AI kapalıyken çalışmayan bir AI kontrolü (semantik toggle, asistan girişi) gösterme; ya gizle ya Ayarlar'a tek yol ver.
