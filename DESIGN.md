---
name: JointVault
description: Kişisel medya arşivi — kütüphane fiş kataloğu dünyası
colors:
  graphite-rail: "#0b0d0f"
  graphite-ground: "#0f1113"
  card-stock: "#171a1d"
  bone-ink: "#e8e5dd"
  faded-ink: "#8f8c83"
  hairline-rule: "#262a2e"
  stamp-ultramarine: "#3d5afe"
  stamp-ultramarine-deep: "#2a3fd0"
  archive-verdigris: "#4f9a72"
  stamp-red: "#d9483b"
  bone-ground: "#eceae4"
  bone-card: "#f7f5f0"
  ink-black: "#15171a"
  src-instagram: "#d94f8a"
  src-tiktok: "#35c4c4"
  src-x: "#8f8c83"
  src-pinterest: "#b8352f"
  src-youtube: "#d0443a"
  src-other: "#6f6c65"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.018em"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.3125rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.012em"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  micro:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.45
  data:
    fontFamily: "JetBrains Mono, ui-monospace, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.04em"
rounded:
  xs: "2px"
  sm: "3px"
  md: "4px"
  lg: "5px"
  xl: "6px"
spacing:
  rail: "244px"
  capture-bar: "56px"
  rule-strip: "40px"
  accession-band: "28px"
  gutter: "16px"
components:
  button-primary:
    backgroundColor: "{colors.stamp-ultramarine}"
    textColor: "#f2f4ff"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
    typography: "{typography.body}"
  button-stamp:
    textColor: "{colors.stamp-ultramarine}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
    typography: "{typography.body}"
  button-outline:
    textColor: "{colors.bone-ink}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
    typography: "{typography.body}"
  input:
    backgroundColor: "#0f111300"
    textColor: "{colors.bone-ink}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
    typography: "{typography.body}"
  record-card:
    backgroundColor: "{colors.card-stock}"
    textColor: "{colors.bone-ink}"
    rounded: "{rounded.md}"
    padding: "12px"
  stamp-acquired:
    textColor: "{colors.archive-verdigris}"
    rounded: "{rounded.xs}"
    padding: "0 6px"
    height: "20px"
    typography: "{typography.data}"
  stamp-error:
    textColor: "{colors.stamp-red}"
    rounded: "{rounded.xs}"
    padding: "0 6px"
    height: "20px"
    typography: "{typography.data}"
  rail-item-active:
    backgroundColor: "{colors.card-stock}"
    textColor: "{colors.bone-ink}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "30px"
    typography: "{typography.body}"
---

# Design System: JointVault

## Overview

**Creative North Star: "Gece Okuma Odası"**

JointVault bir kişisel medya arşividir, yani kataloğun kendisidir. Arayüz bu yüzden arşivin
fiziksel mantığını ödünç alır: **çekmece → fiş → fişin arkası.** Sol rayda çekmeceler gruplanır
(Kasa · Araçlar · Sistem), ortada fiş ızgarası durur, bir fişin tam kaydı ise sağda açılan
kayıt panelinde görünür. Kayıt düzenlemek için ekranı kaplayan bir modal yoktur; ızgara hiç
terk edilmez. Sistem, kategorinin alışkanlığı olan "koyu panel + kart ızgarası + her iş için
modal" düzenini kasten reddeder.

Dünya koyu açılır ve bunun gerekçesi kategori değil sahne: gece, tek çalışma lambası, arka planda
inen bir kuyruk, binlerce fiş. Zemin kâğıt değil grafittir (`#0f1113`); kâğıt yalnızca fişin
kendisidir (`#171a1d`). Gündüz karşılığı soğuk kemik kâğıttır (`#eceae4`) — eski sıcak krem
(`#faf7f1`) bilerek terk edildi, çünkü aynı sıcaklıkta bir zemin eski dünyayı hatırlatırdı.

Malzeme hiçbir yerde doku resmiyle taklit edilmez. Kâğıt üç yapısal araçla kurulur: fişin üstünde
**sabit yükseklikte mono künye bandı** ve altındaki hairline cetvel, rayda **çekmece sekmesi çentiği**,
ve yalnızca durum taşıdığı yerde **perfore delik**. Süs yok: gölge yok, gradyan yok, cam yok,
parlama yok. Derinlik yalnızca üstte duran yapraklara (açılır panel, diyalog) aittir.

**Key Characteristics:**
- Düz mürekkep disiplini: tek aksan (ultramarin damga mürekkebi), tek hata rengi (damga kırmızısı), tek arşiv yeşili.
- Durum renkle değil **damgayla** bildirilir; her damga ikon + sözcük taşır.
- Tek yüz (Archivo) tüm yapısal metni taşır; rütbe **boyutla** kurulur, ağırlık karıştırmayla değil.
- Mono (JetBrains Mono) yalnızca ölçüm ve yol taşır; asla etiket süsü değildir.
- Radius 2–6px arası: kesilmiş kâğıt köşesi. Yuvarlaklık arttıkça dünya kaybolur.
- Kalıcı **kural şeridi**: hangi filtre yürürlükte, nasıl sıralı, kaç fiş var — gizli popover'da değil, okunur bantta.

## Colors

İki mürekkep grisi, bir ultramarin damga ve iki anlam rengi; palet ölçülü (Restrained), çünkü yüzey
görev yapmaya gelir. Renk asla tek başına anlam taşımaz: her renkli damga yanında ikon ve sözcük taşır.

### Primary
- **Damga Ultramarini** (#3d5afe koyu · #2a3fd0 açık): Birincil eylemler, aktif indirme durumu, seçili
  öğe, odak halkası, damga bloğunun çerçevesi. Mürekkep düz dolgudur — parlama, gölge veya gradyan eklenmez.

### Secondary
- **Arşiv Yeşili** (#4f9a72 koyu · #2f7d55 açık): Yalnızca "arşive girdi" anlamı — `YEREL` damgası,
  tamamlanmış ilerleme çubuğu, başarı bildirimi. Başka hiçbir yerde kullanılmaz.

### Tertiary
- **Damga Kırmızısı** (#d9483b koyu · #b3352a açık): Yalnızca hata ve yıkıcı eylem. Uyarı için ayrı bir
  sarı yoktur; uyarı metinle taşınır.

### Neutral
- **Grafit Ray** (#0b0d0f koyu · #e4e1d9 açık): Sol çekmece rayı. İçerik zemininden bir ton daha koyu;
  ikincil ray metni gri değil, ray mürekkebinden türetilir (`text-rail-foreground/65`).
- **Grafit Zemin** (#0f1113 koyu · #eceae4 açık): İçerik zemini.
- **Karton Fiş** (#171a1d koyu · #f7f5f0 açık): Kart, satır, panel yüzeyi.
- **Kemik Mürekkep** (#e8e5dd koyu · #15171a açık): Gövde metni. Koyu zeminde 15:1'in üzerinde kontrast.
- **Soluk Mürekkep** (#8f8c83 koyu · #63615c açık): İkincil metin; her iki temada WCAG AA üstü.
- **Hairline Cetvel** (#262a2e koyu · #d5d2c8 açık): Tüm bölmeler. Gölge yerine çizgi.
- **Platform Mürekkebi** (instagram #d94f8a · tiktok #35c4c4 · x #8f8c83 · pinterest #b8352f ·
  youtube #d0443a · diğer #6f6c65): Fişin üstündeki 2px sınıflandırma kuralı ve nokta işareti.
  Kütüphane pratiğidir, süs değil; etiket metni olmadan asla kullanılmaz.

### Named Rules
**The Tek Damga Kuralı.** Ekranda tek bir doygun aksan vardır: ultramarin. İkinci bir doygun renk
eklemek, dünyayı bir panoya çevirir. Yeşil ve kırmızı aksan değil, *anlam* rengidir; yalnızca
kazanılmış durumlarda ve yalnızca ikon + sözcükle birlikte görünür.

**The Asla-Gri-İkincil Kuralı.** Renkli bir yüzeyde (ray) ikincil metin gri tonlanmaz; o yüzeyin
mürekkebinden saydamlıkla türetilir.

## Typography

**Display Font:** Archivo (değişken, 100–900) · `ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif`
**Body Font:** Archivo — aynı yüz; ayrı bir gövde yüzü yoktur.
**Label/Mono Font:** JetBrains Mono (değişken, 100–800) · `ui-monospace, Consolas, monospace`

**Character:** Mekanik, kare omuzlu, idari bir grotesk. Fiş kataloglarının daktiloyla yazılmış künye
kartlarını hatırlatır ama daktilo taklidi yapmaz; mono yalnızca ölçüm taşır. İkisi de projeye gömülüdür
(`public/fonts`, latin + latin-ext, çevrimdışı çalışır) — çalışma anında uzak kaynak çekilmez.

### Hierarchy
- **Display** (600, 26px/1.08, -0.018em): Görünüm başlıkları ve uygulama adı. Yalnızca bir kez, en üstte.
- **Title** (600, 21px/1.15, -0.012em): Panel başlığı, fiş detay başlığı, boş durum başlığı, diyalog başlığı.
- **Body** (400, 14px/1.5): Satır ve kart başlıkları 15px/1.35 medium; gövde metni 14px. Ölçü 65–75ch.
- **Micro** (400, 12px/1.45): Alan etiketleri, yardım metni, ikincil açıklama. **Büyük harf ve harf aralığı yok.**
- **Data** (400, 11px/1.5, 0.04em, büyük harf): Künye bandı, damga, tarih, yüzde, hız, sayım, dosya yolu.

### Named Rules
**The Tek Yüz Kuralı.** Yapısal hiçbir metin ikinci bir yüz kullanmaz. Vurgu gerekiyorsa boyut
basamağı değişir (11 → 12 → 14 → 15 → 21 → 26), ağırlık karışımı ya da ikinci bir aile eklenmez.
Display serif yasaktır.

**The Mono-Veridir Kuralı.** JetBrains Mono yalnızca ölçülebilir şeyler içindir: tarih, yüzde, hız, süre,
adet, kimlik, dosya yolu. Bir bölüm başlığını mono ve büyük harfle yazmak "teknik görünsün" kostümüdür;
bölüm başlıkları Archivo, mikro boyut, normal harf aralığıdır. Uygulamada `data-num` özniteliği bu
yüzü ve tabular rakamları açar (`index.css`).

**The Büyük-Harf-Künye Kuralı.** Büyük harf ve harf aralığı yalnızca künye bandı ve damga gibi
*veri* yüzeylerinde görünür. Bir başlığın üstüne etiket (eyebrow/kicker) koymak yasaktır; başlık
kendi ağırlığını taşır.

## Layout

Spatial model: sabit çekmece rayı + akan içerik kolonu, üstte iki kalıcı bant.

- **Ray:** 244px, `md` altında gizlenir ve aynı çekmeceler yatay kaydırılabilir bir şeride iner —
  dar pencerede gezinme kaybolmaz.
- **Yakala çubuğu:** 56px, `sticky top-0`, tüm görünümlerde kalır. Tek satır, çift kişilik: yazarsan
  arar, link yapıştırırsan kaydeder.
- **Kural şeridi:** 40px, `sticky top-14`, kasa görünümünde. Filtre tetikleyicileri, sıralama,
  toplam fiş sayısı ve görünüm anahtarı.
- **Izgara:** 1 / 2 / 3 kolon (sm / xl). Kart yüksekliği içerikten gelir, sabitlenmez.
- **Kayıt paneli:** 360px, `lg` ve üstünde içerik kolonunun yanında `sticky`; altında tam ekran yaprak.
- **Yoğunluk:** satır görünümü ~52px satır, kart ~290px; 2.000 fiş taranabilir kalmalı. Kart ve satırlar
  `content-visibility: auto` taşır (`cv-card`, `cv-row`), sayfalama SQL'de yapılır, arama 250ms debounce'ludur.
- **Ritim:** gruplar sıkı, ayrım cömert; başlığın üstündeki boşluk altındakinden fazladır.

## Elevation & Depth

Sistem **düz**: fiş, kart ve satır gölge taşımaz (`--shadow-card: 0 0 0 0 transparent`). Derinlik
hairline cetvel ve kart kenarıyla kurulur. Gölge yalnızca gerçekten üstte duran yapraklara aittir.

### Shadow Vocabulary
- **Yaprak yükselmesi** (`box-shadow: 0 18px 40px -18px rgb(20 21 23 / 0.45), 0 3px 10px -4px rgb(20 21 23 / 0.3)`;
  koyu temada `0 22px 48px -20px rgb(0 0 0 / 0.75), 0 4px 12px -4px rgb(0 0 0 / 0.6)`): Açılır panel,
  menü, diyalog, bildirim. Gerçek ofset + yumuşak blur; sıfır ofsetli renkli hale yasaktır.

### Named Rules
**The Düz-Fiş Kuralı.** Dinlenme hâlinde hiçbir içerik yüzeyi gölge taşımaz. Kart hover'ı gölge değil,
kenar rengi ve 2px'lik kalkmadır. Boşluk veya vurgu için gölge eklemek, dünyayı hazır arayüze çevirir.

## Shapes

Kesilmiş kâğıt: radius 2px (xs) – 6px (xl) arası; kartlar 4px, girdiler ve butonlar 3px, damgalar 2px,
yapraklar 4–6px. Tam yuvarlak (`rounded-full`) yalnızca durum noktaları, anahtar yuvası ve avatar
benzeri kırpımlar için ayrılmıştır — bir kart ya da buton asla hap biçiminde olmaz.

Kenarlar 1px hairline'dır ve rolü bölmektir, süslemek değil. Bir yüzeyin soluna/üstüne kalın renkli
şerit koymak yasaktır (platform kuralı 2px'tir ve *veri* taşır). Sekme çentiği rayın kenarını kesen
küçük bir taşmadır; renkli sol şerit değildir.

Hairline çizgiler metin taşımaz; metin her zaman yüzeyin içinde nefes payıyla durur.

## Components

Genel duruş: **sakin kontrol, ölçülü hareket.** Geçişler 150–200ms, `cubic-bezier(0.22,1,0.36,1)`
(`ease-paper`) ve yalnızca durum değişimini anlatır. Basış 1px aşağı iner. Tek orkestralı hareket
"damganın basılması"dır (yeni fiş 180ms'de yerleşir) ve `prefers-reduced-motion` altında kaybolur.

### Buttons
- **Shape:** Kesilmiş kâğıt (3px radius), 32px yükseklik (sm 28px, lg 36px), 10px yatay dolgu.
- **Primary:** Ultramarin düz dolgu + kâğıt beyazı metin. Hover'da dolgu %85 opaklığa iner.
- **Stamp:** Damga varyantı — şeffaf zemin, ultramarin kenar ve metin; hover'da dolgu ultramarine döner.
  Yakala çubuğunun birincil eylemi budur.
- **Hover / Focus:** Odak halkası tek yerden gelir (`:focus-visible`, 2px `--color-ring`, 1px ofset);
  hiçbir varyant kendi ring'ini yazmaz. Basış `translateY(1px)`.
- **Secondary / Outline / Ghost / Destructive / Link:** İkincil; dışa çizgi; sessiz; kenarlıklı kırmızı
  düz blok (dolgu değil); bağlantı. Yıkıcı eylem asla dolu kırmızı değildir.

### Stamps (imza bileşen)
Durum sözlüğü: `kayıtsız` · `kuyrukta` · `iniyor` · `yerel` · `hata` · `yinelenen` · `favori` ·
`dönüştürüldü`. Her damga mono 11px büyük harf, 2px radius, 20px yükseklik ve **lucide ikonu** taşır —
glif veya emoji asla. Renk durumun kendisidir ama tek başına yetmez: ikon ve sözcük her zaman yanındadır.
`yinelenen` kesikli kenarla, diğerleri düz kenarla çizilir.

### Chips & Badges
- **Etiket (Badge):** Sınıflandırma ve sayım taşır, durum bildirmez (o iş damganın). Mono 11px, 2px radius,
  20px yükseklik, kenarlıklı; `default` ultramarin tonlu, `outline` nötr, `destructive` hata tonlu.

### Cards / Containers
- **Corner Style:** Karton fiş (4px).
- **Background:** `#171a1d` koyu / `#f7f5f0` açık.
- **Shadow Strategy:** Yok (bkz. Elevation).
- **Border:** 1px `#262a2e`; hover'da girdi rengine döner ve kart 2px kalkar. Seçili kart ultramarin kenar taşır.
- **Internal Padding:** 12px; künye bandı 28px sabit yükseklikte ve altında hairline.
- **Künye bandı:** Platform solda, tarih sağda, mono 11px büyük harf. Kartta platform ve tarih
  *yalnızca* burada yazılır; alt satırda tekrarlanmaz (tekrar, dünyanın en kolay bozulduğu yerdir).

### Inputs / Fields
- **Style:** Şeffaf zemin, 1px `--color-input` kenar, 3px radius, 32px yükseklik.
- **Focus:** Kenar `--color-ring`e döner; halka base katmandan gelir. Odak, kutuyu iki kez çizmez.
- **Error / Disabled:** `aria-invalid` kenarı kırmızıya çevirir ve alanın altına 12px hata satırı gelir;
  `disabled` zemini `--color-muted` yapar ve %55 opaklığa iner. Yer tutucu metin `--color-muted-foreground` %85.

### Navigation
- **Rail:** 244px, grafit, bölümler (Kasa · Araçlar · Sistem) mono olmayan, büyük harf olmayan
  11px bölüm etiketleriyle ayrılır. Öğe 30px yükseklik, 3px radius, 16px ikon.
- **Default / Hover / Active:** İkincil ray metni ray mürekkebinden türetilir; hover'da yüzey belirir.
  **Aktif öğe bir çekmece sekmesidir:** kart yüzeyini alır ve sağ kenara 4×16px'lik bir çentik taşarır,
  böylece rayın hairline'ı kesilir. Renkli sol şerit kullanılmaz.
- **Mobile:** `md` altında ray yatay kaydırılabilir bir şeride iner; aynı çekmeceler, aynı sıra.

### Yakala Çubuğu (imza bileşen)
Tek satır, çift kişilik. Değer alan adı veya şema içeriyorsa çubuk **kayıt moduna** geçer: sol ikon
bağlantıya döner, sağda platform damgası + "Ayrıntılı" + "Kaydet" (stamp varyantı) belirir; Enter kaydeder,
Escape temizler. Aksi hâlde **arama modundadır**: ikon büyüteç, sağda `Ctrl K` palet ipucu. Mod her zaman
görünürdür; tahmin edilmez. Kayıt anında olur, önizleme sonradan çekilir ve başarısız olursa kayıt bozulmaz.

## Do's and Don'ts

### Do:
- **Do** her durumu damgayla ve mutlaka ikon + sözcükle bildir; rengi yalnız bırakma.
- **Do** `data-num` kullan: tarih, yüzde, hız, süre, adet, kimlik, dosya yolu.
- **Do** ölçülebilir alanları `tabular-nums` ile hizala.
- **Do** yeni bir yüzey eklerken önce mevcut primitifi (Button, Input, Select, Stamp, Field, Progress, Menu,
  Popover, Dialog, ConfirmDialog) kullan; yeni bir sözlük icat etme.
- **Do** kayıt düzenlemeyi kayıt panelinde tut; modalı yalnızca kesinti veya korunmuş odak için sakla.
- **Do** yükleniyor durumunu iskeletle göster (`skeleton-paper`), boş durumu öğret (`kapak yok` gibi
  açıklayıcı metinle), dönen çarkla değil.
- **Do** dar pencereyi birinci sınıf tut: gezinme şeride iner, kart ve tablolar yeniden akar, yatay kaydırma çıkmaz.

### Don't:
- **Don't** ikinci bir doygun aksan ekleme; ultramarin tek damgadır.
- **Don't** ikincil metni gri yapma; renkli yüzeyde o yüzeyin mürekkebinden türet.
- **Don't** bir yüzeyin soluna kalın renkli şerit koyma; platform kuralı 2px'tir ve veri taşır.
- **Don't** kart ya da butonu hap biçiminde yapma; 2–6px kesilmiş kâğıt köşesi kuraldır.
- **Don't** gölgeyi dinlenme hâlindeki fişlere, kartlara veya satırlara ekleme.
- **Don't** büyük harf + harf aralığını gövde metnine ya da bölüm başlığına uygulama; o yalnızca künye
  ve damga gibi veri yüzeylerinin hakkıdır.
- **Don't** mono yazıyı etiket süsü olarak kullanma; mono ölçüm içindir.
- **Don't** gradyan metin, cam/blur dekoru, sert ofset gölge veya glif-ikon kullanma.
- **Don't** sayfaya ikinci bir "kaydet" eylemi koyma; birincil kayıt yakala çubuğunundur.
