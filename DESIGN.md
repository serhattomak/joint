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
  rail: "244px"
  capture-bar: "56px"
  rule-strip: "40px"
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
    rounded: "{rounded.lg}"
    padding: "12px"
  sheet:
    backgroundColor: "{colors.sheet-light}"
    textColor: "{colors.label-light}"
    rounded: "{rounded.xl}"
    padding: "16px"
  rail-item-active:
    backgroundColor: "{colors.card-light}"
    textColor: "{colors.label-light}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "30px"
    typography: "{typography.body}"
---

# Design System: JointVault

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
- Boyuta bağlı harf aralığı: büyük metin negatif, küçük metin pozitif. Tek bir `letter-spacing` yanlıştır.
- Sürekli köşe: radius 4–16px. Hap biçimi yalnızca durum noktası ve anahtar yuvasına ayrılmıştır.
- Malzeme gerçek: ray, araç çubuğu ve yaprak yarı saydamdır ve arkalarını bulanıklaştırır.
- Hareket fiziksel: basış ölçekle iner, geçişler güçlü `ease-out`, süre 150–250ms.

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
- **Display** (700, 28px/1.12, -0.022em): Görünüm başlıkları ve uygulama adı.
- **Title** (600, 22px/1.18, -0.018em): Panel, fiş detayı, boş durum ve diyalog başlığı.
- **Body** (400, 14px/1.5, -0.006em): Gövde metni. Kart/satır başlıkları 15px medium.
- **Micro** (400, 12px/1.4, +0.006em): Alan etiketleri, yardım metni. Büyük harf yok.
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

Spatial model: sabit çekmece rayı + akan içerik kolonu, üstte iki kalıcı bant.

- **Ray:** 244px, `md` altında gizlenir ve aynı çekmeceler yatay şeride iner — dar pencerede
  gezinme kaybolmaz.
- **Yakala çubuğu:** 56px, `sticky top-0`, tüm görünümlerde kalır. Altından içerik akar; bu yüzden
  ayrım sert bir çizgi değil, **kayan kenar**tır (`scroll-edge-b`: hairline yerine kısa gradyan).
- **Kural şeridi:** 40px, `sticky top-14`, kasa görünümünde.
- **Izgara:** 1 / 2 / 3 kolon (sm / xl). Kart yüksekliği içerikten gelir, sabitlenmez.
- **Kayıt paneli:** 360px, `lg` ve üstünde içerik kolonunun yanında `sticky`; altında tam ekran yaprak.
- **Yoğunluk:** satır görünümü ~52px, kart ~290px; 2.000 fiş taranabilir kalmalı. Kart ve satırlar
  `content-visibility: auto` taşır (`cv-card`, `cv-row`), sayfalama SQL'de yapılır, arama 250ms debounce'ludur.
- **Ritim:** gruplar sıkı, ayrım cömert; başlığın üstündeki boşluk altındakinden fazladır.

### Pencere çerçevesi (titlebar)

Pencere çerçevesizdir (`decorations: false`); yerel başlık çubuğu yoktur. Üstteki 56px'lik bant
(solda marka bloğu, sağda yakala çubuğu) aynı zamanda titlebar'dır: boş alanları sürüklenebilir
(`data-tauri-drag-region` → Windows'ta `HTCAPTION`; taşıma, yarı-ekrana yapıştırma ve çift tıkla
büyütme yerel kalır). Çerçevesizlik Windows'ta kenardan boyutlandırmayı götürdüğü için görünmez
kenar/köşe tutamaçları `startResizeDragging` ile bunu geri koyar — tutamaçlar bir kabuk
ayrıntısıdır, çizilmez ve odak almaz.

Pencere kontrolleri **sağda** durur (Windows alışkanlığı korunur) ama Mac trafik ışığı biçiminde
çizilir: 12px daireler — küçült `#febc2e`, büyüt `#28c840`, kapat `#ff5f57`; grup üzerine gelince
glifler belirir, pencere odak dışındayken üçü de `--color-input` grisine döner. Işıklar bir
*pencere kabuğu* işaretidir, veri değil: 11px mono künye basamağına girmez, `data-num` taşımaz.

Değişen yalnızca görünümdür: native başlık çubuğunun sağ-tık sistem menüsü ve Windows 11'in
"maximize üzerine gel → snap layouts" paneli yoktur; geri kalan davranış (taşıma, boyutlandırma,
yarı-ekran, tepsiye kapanma) aynen sürer.

## Materials

Malzeme, dünyanın en belirgin Apple izidir: yüzen katman **yarı saydamdır ve arkasını
bulanıklaştırır**, böylece altındaki içerik hem görünür hem geri iter.

| Malzeme | Nerede | Gece | Gündüz | Blur |
|---|---|---|---|---|
| `material-rail` | Sol çekmece rayı, dar-pencere şeridi | `rgb(38 38 41 / .72)` | `rgb(232 232 237 / .72)` | 24px · saturate 180% |
| `material-toolbar` | Yakala çubuğu | `rgb(28 28 30 / .72)` | `rgb(242 242 247 / .72)` | 24px · saturate 180% |
| `material-sheet` | Diyalog, albüm, ayarlar | `rgb(44 44 46 / .8)` | `rgb(255 255 255 / .78)` | 40px · saturate 180% |

- **Malzeme yalnızca altından bir şey geçtiğinde anlamlıdır.** Sabit bir kolonun arkasında düz zemin
  varsa blur görünmez; bu yüzden `material-rail` çoğunlukla *ton* olarak okunur, `material-toolbar`
  ve `material-sheet` ise gerçekten bulanıklaştırır.
- **Üstteki ince ışık çizgisi** (`inset 0 1px 0 rgb(255 255 255 / .06)`) malzemenin ışığı yakaladığı
  yerdir; süs değil, yön bilgisidir.
- **Işık malzemeyi kesmez:** malzeme üstüne ikinci bir yarı saydam yüzey yığılmaz; okunabilirlik çöker.

### Named Rules
**The Azaltılmış-Saydamlık Kuralı.** `prefers-reduced-transparency: reduce` altında üç malzemenin
tabanı opak karşılığına döner ve blur kapanır (`index.css`). Apple'ın üçüncü erişilebilirlik sinyali
budur ve görmezden gelinmez.

## Elevation & Depth

Derinlik **katmanlı ve yumuşak**tır. Gölge artık yasak değil, ama sıfır-ofsetli renkli hale hâlâ
yasaktır.

### Shadow Vocabulary
- **Kart** (`0 1px 2px rgb(0 0 0 / .05), 0 1px 1px rgb(0 0 0 / .03)` · gece `…/.4, …/.24`):
  Dinlenme hâlindeki kart ve satır kabı. Neredeyse görünmez; kenarı besler.
- **Kart hover** (`0 6px 20px rgb(0 0 0 / .1), 0 2px 6px rgb(0 0 0 / .05)`): Kart yalnızca fare
  üzerindeyken yükselir; dokunmatikte tetiklenmez (Tailwind `hover:` `@media (hover: hover)` içindedir).
- **Yaprak** (`0 12px 32px rgb(0 0 0 / .14), 0 2px 8px rgb(0 0 0 / .06)` · gece `…/.55, …/.35`):
  Diyalog, menü, popover, bildirim. Gerçek ofset + yumuşak blur.

## Shapes

Sürekli köşe: radius 4px (xs) – 16px (2xl). Kartlar 10px, girdi ve butonlar 6px, damgalar 4px,
yapraklar 12–16px. Tam yuvarlak (`rounded-full`) yalnızca durum noktaları, anahtar yuvası,
avatar kırpımı ve pencerenin trafik ışıkları için ayrılmıştır — bir kart ya da buton asla hap değildir.

Kenarlar 1px hairline'dır ve rolü bölmektir. Bir yüzeyin soluna kalın renkli şerit koymak yasaktır
(platform kuralı 2px'tir ve *veri* taşır).

## Motion

Hareket bir katman değil, arayüzün kendisidir; görsellerle birlikte tasarlanır.

- **Eğriler:** `--ease-out` `cubic-bezier(0.23,1,0.32,1)` (giriş ve basış) · `--ease-in-out`
  `cubic-bezier(0.77,0,0.175,1)` (ekranda yer değiştirme) · `--ease-drawer` `cubic-bezier(0.32,0.72,0,1)`
  (yaprak/drawer). `--ease-paper` adı korunur ama değeri `--ease-out`'tur, böylece mevcut yüzeylerin
  tamamı tek satır değişmeden yeni eğriye geçer.
- **Süre:** 150ms (basış/hover) · 200ms (katman girişi) · 250ms (yaprak). UI hareketi 300ms'i geçmez.
- **Basış:** `active:scale-[0.97]`. Basış `:active`'tedir, yani parmak değer değmez geri bildirim
  başlar; `motion-reduce` altında ölçek kapanır.
- **Giriş:** hiçbir şey `scale(0)`'dan gelmez. Katmanlar `opacity 0` + `scale .95`'ten girer
  (`data-[starting-style]`), `scale .97` + `opacity 0`'a çıkar (`data-[ending-style]`).
- **Malzeme birden belirmez:** yaprak girerken ölçek ve opaklık birlikte hareket eder.
- **Etkileşimli hiçbir şey kilitlenmez:** geçiş sürerken yeni girdi kabul edilir.

### Named Rules
**The Basış-Parmak-Altında Kuralı.** Buton yalnızca tıklanınca değil, basılı tutulduğu anda tepki
verir. Sadece bırakışta geri bildirim veren kontrol ölü hisseder.

**The Azaltılmış-Hareket Kuralı.** `prefers-reduced-motion: reduce` altında tüm süreler ve animasyonlar
anlamlı biçimde sadeleşir (global `!important` bloğu), ama opaklık/renk geçişleri kalır — azaltmak
yok etmek değildir.

## Components

Genel duruş: **sakin kontrol, ölçülü hareket.**

### Buttons
- **Shape:** 6px radius, 32px yükseklik (sm 28px, lg 36px), 10px yatay dolgu.
- **Primary:** systemBlue düz dolgu + beyaz metin. Hover'da dolgu %85 opaklığa iner.
- **Stamp:** Çerçeveli aksan varyantı — şeffaf zemin, mavi kenar ve metin; hover'da doluya döner.
  Yakala çubuğunun birincil eylemi budur.
- **Hover / Focus:** Odak halkası tek yerden gelir (`:focus-visible`, 2px `--color-ring`, 1px ofset);
  hiçbir varyant kendi ring'ini yazmaz. Basış `scale(.97)`.
- **Secondary / Outline / Ghost / Destructive:** İkincil; dışa çizgi; sessiz; kenarlıklı kırmızı
  blok (dolgu değil). Yıkıcı eylem asla dolu kırmızı değildir.

### Stamps (imza bileşen)
Durum sözlüğü: `kayıtsız` · `kuyrukta` · `iniyor` · `yerel` · `hata` · `yinelenen` · `favori` ·
`dönüştürüldü`. Her damga mono 11px büyük harf, 4px radius, 20px yükseklik ve **lucide ikonu** taşır —
glif veya emoji asla. Renk durumun kendisidir ama tek başına yetmez: ikon ve sözcük her zaman yanındadır.

### Cards / Containers
- **Corner Style:** 10px sürekli köşe.
- **Background:** `#2c2c2e` gece / `#ffffff` gündüz.
- **Shadow Strategy:** Dinlenmede neredeyse görünmez bir kart gölgesi; hover'da yükselir. Seçili kart
  aksan kenar taşır.
- **Border:** 1px ayırıcı; hover'da girdi rengine döner ve kart 2px kalkar.
- **Internal Padding:** 12px; künye bandı 28px sabit yükseklikte ve altında hairline.
- **Künye bandı:** Platform solda, tarih sağda, mono 11px büyük harf. Kartta platform ve tarih
  *yalnızca* burada yazılır; alt satırda tekrarlanmaz.

### Inputs / Fields
- **Style:** Şeffaf zemin, 1px `--color-input` kenar, 6px radius, 32px yükseklik.
- **Focus:** Kenar `--color-ring`e döner; halka base katmandan gelir. Odak kutuyu iki kez çizmez.
- **Error / Disabled:** `aria-invalid` kenarı kırmızıya çevirir ve alanın altına 12px hata satırı gelir.

### Sheets & Dialogs
Yalnızca kesinti veya korunmuş odak gerektiren işler buraya gelir; kayıt düzenleme ve araç işleri
satır içi panelde yaşar. Yaprak `material-sheet` + 12px radius + yaprak gölgesi taşır; örtü `--color-overlay`
ile zemini geri iter. Giriş `data-[starting-style]` ile ölçek+opaklık birlikte, çıkış daha hızlıdır.

### Navigation
- **Rail:** 244px, `material-rail`, bölümler (Kasa · Araçlar · Sistem) mono olmayan, büyük harf
  olmayan 11px bölüm etiketleriyle ayrılır. Öğe 30px yükseklik, 6px radius, 16px ikon.
- **Default / Hover / Active:** Hover'da yüzey belirir; aktif öğe bir çekmece sekmesidir (kart yüzeyi
  + sağ kenara taşan çentik).
- **Mobile:** `md` altında ray yatay kaydırılabilir bir şeride iner; aynı çekmeceler, aynı sıra.

### Yakala Çubuğu (imza bileşen)
Tek satır, çift kişilik. Değer alan adı veya şema içeriyorsa çubuk **kayıt moduna** geçer: sol ikon
bağlantıya döner, sağda platform damgası + "Ayrıntılı" + "Kaydet" (stamp varyantı) belirir; Enter
kaydeder, Escape temizler. Aksi hâlde **arama modundadır**: ikon büyüteç, sağda `Ctrl K` ipucu.
Mod her zaman görünürdür; tahmin edilmez. Çubuğun sağ ucunda pencere kontrolleri durur.

## Do's and Don'ts

### Do:
- **Do** her durumu damgayla ve mutlaka ikon + sözcükle bildir; rengi yalnız bırakma.
- **Do** `data-num` kullan: tarih, yüzde, hız, süre, adet, kimlik, dosya yolu.
- **Do** yüzen katmanları malzemeyle kur (`material-toolbar`, `material-sheet`); içerik altlarından aksın.
- **Do** yeni bir yüzey eklerken önce mevcut primitifi (Button, Input, Select, Stamp, Field, Progress,
  Menu, Popover, Dialog, ConfirmDialog) kullan; yeni bir sözlük icat etme.
- **Do** kayıt düzenlemeyi kayıt panelinde tut; modalı yalnızca kesinti veya korunmuş odak için sakla.
- **Do** yükleniyor durumunu iskeletle göster (`skeleton-paper`), boş durumu öğret, dönen çarkla değil.
- **Do** dar pencereyi birinci sınıf tut: gezinme şeride iner, kart ve tablolar yeniden akar.

### Don't:
- **Don't** ikinci bir doygun aksan ekleme; systemBlue tek damgadır.
- **Don't** harf aralığını tek değere sabitleme; boyutun fonksiyonudur.
- **Don't** bir yüzeyin soluna kalın renkli şerit koyma; platform kuralı 2px'tir ve veri taşır.
- **Don't** kart ya da butonu hap biçiminde yapma; 4–16px sürekli köşe kuraldır.
- **Don't** `scale(0)`'dan animasyon başlatma; hiçbir şey yoktan belirmez.
- **Don't** `ease-in` kullanma; arayüzü yavaş hissettirir. Giriş her zaman `ease-out`.
- **Don't** UI hareketini 300ms'in üstüne çıkarma.
- **Don't** `prefers-reduced-motion` / `prefers-reduced-transparency` sinyallerini yok sayma.
- **Don't** büyük harf + geniş aralığı gövde metnine uygulama; o damga ve künyenin hakkıdır.
- **Don't** sayfaya ikinci bir "kaydet" eylemi koyma; birincil kayıt yakala çubuğunundur.
