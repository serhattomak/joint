---
version: 1
slug: "jointvault-src-app-tsx"
primary_target: "jointvault/src/App.tsx"
related_targets: []
---

# Surface: JointVault masaüstü kabuğu (Tümü · Favoriler · İndirilenler · araç yüzeyleri · diyaloglar)

<!-- impeccable:surface-schema 1 -->

## Scope and mode

**Operate.** Uygulamanın tamamı: sol çekmece rayı, yakala çubuğu, kural şeridi, fiş ızgarası/satırları,
araç yüzeyleri (Dönüştürücü, Araç Kutusu ve dört araç, Yinelenenler, İstatistikler) ve tüm diyaloglar.
Kapsam kullanıcı tarafından "her şey sıfırdan" olarak onaylandı. Özellikler, Türkçe metinler, kısayollar
ve veri akışları dokunulmaz; modal azaltma ve metin iyileştirme izni verildi.

## Audience, job, action

Tek kullanıcı: Türkçe konuşan, teknik olarak yetkin medya biriktiricisi; Windows'ta 1280×800 pencere,
sık sık yarı ekrana yapıştırılmış, gece loş ortam ağırlıklı. İş: akışta gördüğü şeyi anında kasaya atmak,
sonra arşivde bulmak ve üzerinde ffmpeg/yt-dlp işi yapmak.

- **Eylem:** yapıştır–kaydet (birincil), ara–bul, indir–dönüştür–kırp.
- **Kanıt/içerik:** kullanıcının kendi başlıkları ve kapakları gerçek malzeme; depoda seed yok, örnek
  içerik yazılırsa sentetik olarak işaretlenir. Uydurma metrik/müşteri/kapasite iddiası yasak.
- **Kısıtlar:** 1000+ öğe performansı (SQL sayfalama, `content-visibility`, 250ms debounce, lazy Stats);
  çevrimdışı (font/görsel yerelden); `@base-ui/react` 1.8 primitifleri; dar pencere ≈640px birinci sınıf.

## Chosen direction

**Kartoteks** — kütüphane fiş katalogları / arşiv çekmeceleri. Kendi 7 adaylık toprak listemin 4.'sü;
seed anahtarı `2d0ef9d3` (`--scope direction --mode operate`). Yerleşik dünya (krem kâğıt + Georgia
serif + kiremit aksan) terk edildi; gerekçe: Impeccable'ın kalibrasyonunda adı geçen yığın kümesi.

- **Hatırlanacak an:** yakala çubuğuna link yapıştırıldığında çubuğun kendini "Kaydet" moduna çevirmesi
  ve kaydedilen fişin damgasını 180ms'de basması.
- **Zardan gelen yükseltmeler (düşen adayların disiplini, adlarıyla):**
  - *Emigre ölçek merdiveni* — tek yüz, tam sayı adımlı boyut merdiveni; rütbe boyutla kurulur.
  - *Tensegrity kılavuz çizgisi* — meta veri artefakta hairline kılavuz çizgisiyle bağlanır; değerler mono.
  - *Yerçekimi bahçesi kural şeridi* — filtre/sıralama/kuyruk kuralları gizli popover'da değil, kalıcı şeritte.
- **Kalan çözülmemiş karar:** yok. Ölçek merdiveninin tam basamakları ve platform mürekkep renkleri
  inşa sırasında ölçülerek sabitlenir.

## Direction contract

**THESIS.** Arşivin kendisi arayüz olur: çekmece → fiş → fişin arkası. Kategori varsayılanı olan
"koyu panel + kart ızgarası + her iş için modal" düzenini reddeder; kaydın tamamı modalda değil,
sağdaki kayıt panelinde açılır, fiş ızgarası hiç terk edilmez.

**OWN-WORLD.** Grafit kart stoğu `#0f1113`, kemik mürekkep `#e8e5dd`, tek ultramarin damga mürekkebi
`#3d5afe`, soluk kart `#8f8b81`, hairline cetvel `#262a2e`. Kâğıt malzemesi üç araçla kurulur: sabit
künye bandı + altındaki hairline, rail'de sekme çentiği, yalnızca durum taşıyan perfore delik.
Archivo (UI + başlık) + JetBrains Mono (yol · süre · yüzde · hız · adet). Kesilmiş kâğıt köşesi: radius
2–4px. Gölge yok — bölme hairline'ı ve kart kenarı var. Durum renk değil **damga**: `— kayıtsız`,
`◷ kuyrukta`, `▮▮▮ %42 · 1,2 MB/s`, `✓ YEREL`, `✕ HATA` (yalnızca hata kırmızısı `#d9483b`),
`⊘ yinelenen`. Düz mürekkep: parlama, gradyan, cam yok.

**STORY.** Kullanıcı (1) tek hareketle kaydeder, (2) ızgarada her fişin nereden geldiğini ve hangi
durumda olduğunu damgadan okur, (3) fişi açıp arkasında tüm kaydı ve dokunabilecek araçları bulur.

**FIRST VIEWPORT.** Solda 244px çekmece rayı (KASA · ARAÇLAR · SİSTEM bölümleri, aktif öğede çentik).
Sağda içerik kolonu, üç bant: 56px **yakala çubuğu** (geniş giriş, solda Ara↔Kaydet ikonu, sağda ipucu
çipi; yapıştırılan linkte birincil Kaydet düğmesi belirir), 36px **kural şeridi** (filtre · sıralama ·
toplam fiş, kalıcı ve okunur), ardından **fiş ızgarası** (1280'de 3 kolon; her fişte üstte platform renk
kuralı, ortada kapak, altta künye + damga). Birincil eylem yakala çubuğunun içindedir; sayfada ikinci
bir "kaydet" yoktur.

**FORM.** Atanan toprak, listemde 4/7, seed `2d0ef9d3`. Raises: Emigre ölçek merdiveni · tensegrity
kılavuz çizgisi · yerçekimi-bahçesi kural şeridi. Karşıtlar: Kesim Tezgâhı (yarışır), Veri Matığı
(yarışır), Modüler Kimlik (yarışır); düşenler: Bitmap Specimen, Yerçekimi Bahçesi, Tensegrity Kolon.

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
