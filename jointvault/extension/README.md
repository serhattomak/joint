# JointVault tarayıcı eklentisi

Dört iş yapar:

1. X yer işaretlerini, Instagram kaydedilenleri ve YouTube oynatma listelerini uygulamanın
   localhost köprüsüne (`127.0.0.1:48120`) aktarır.
2. **Tarayıcı indirmelerini devralır** (IDM'in "download takeover"ı): başlatılan indirmeyi
   uygulamaya verir, uygulama kabul ederse tarayıcı indirmesini iptal eder.
3. **Sayfadaki kaynakları koklar**: yanıt başlıklarından medya/arşiv kaynaklarını bulur;
   araç çubuğunda sayaç rozeti, sayfanın üstünde yüzen panel, popup'ta tam liste.
4. **Sağ tık menüsü** sunar: bağlantı, fotoğraf, medya, seçili bağlantı, sayfa içeriği
   (kalite seç / sormadan) ve sayfadaki tüm kaynakları devralma — her öğe ayrı açılıp
   kapatılabilir.

Eşleşme anahtarı uygulamada **Ayarlar → Eklenti**'de üretilir ve popup'a yapıştırılır.

## Dosyalar

| Dosya | Rol |
|---|---|
| `manifest.json` | MV3 bildirimi ve izinler |
| `popup.html` / `popup.js` | Arayüz, sunucu bağlantısı denetimi, toplu gönderim, kuyruğa alma, devralma ayarı, kaynak listesi |
| `outbox.js` | Giden kutusu (saf katman, `chrome`'a bağımlı değil) + `canonicalizeUrl` (uygulama portu) |
| `outbox.test.mjs` | Kuyruk testi — `npm run test` içinde koşar |
| `background.js` | Arka plan aktarıcı + indirme devralma + kaynak koklama (servis çalışanı, modül) |
| `background.test.mjs` | Üç sözleşmenin testleri |
| `panel.js` | Sayfaya **enjekte edilen** yüzen kaynak paneli (Shadow DOM) |
| `fonts/` | Inter + JetBrains Mono (uygulamanın `public/fonts` kopyası); popup ve panel çevrimdışı aynı yüzü kullanır |
| `scrape.js` | Genel adaptör (X + otomatik sayfa kaydırma) |
| `scrape-youtube.js` | YouTube oynatma listesi adaptörü |
| `scrape-instagram.js` | Instagram kaydedilenler adaptörü |

## İndirme devralma

`chrome.downloads.onCreated` ile başlatılan indirme, uzantısı kullanıcı listesindeyse
`POST /download`'a verilir. Gönderilen: `url` · `Referer` · **o adresin çerezleri** · UA.
Çerez olmadan oturum gerektiren sunucular 403 döner; IDM de bu yüzden çerezleri taşır.

**Sıra bağlayıcıdır: önce uygulamaya sorulur, sonra iptal edilir.** Uygulama kapalıysa ya da
`401` dönerse tarayıcı indirmesine **hiç dokunulmaz** — dosya kaybolmaz, yalnızca
hızlandırılmaz. Tersi sıra, uygulama kapalıyken indirmeyi kaybederdi.

`/download` ve `POST /collect` (`mode: download`) başarılı olduğunda uygulama **penceresini
öne getirir** (`tray::raise_main_window`): iş uygulamada koşuyor, görünmesi gerekir.
Ayarlar → İndirme → *"Tarayıcıdan indirince pencere öne gelsin"* anahtarıyla kapatılır.

- **Uzantı listesi:** popup'tan düzenlenir; **boş bırakılırsa varsayılan liste** kullanılır
  (varsayılanlar tek yerde, `background.js`'tedir — popup onları tekrar etmez).
- **Sağ tık menüsü:** bağlantı/görsel/video üzerinde "JointVault ile indir" (iptal edilecek
  bir indirme yoktur; yalnızca kuyruğa girer).
- **İzinler:** `downloads`, `contextMenus`, `webRequest` ve her sitede çerez okuyabilmek için
  `*://*/*` host izni. Bunlar eklentiyi kurarken/güncellerken onay ister; IDM'in entegrasyon
  modülü de aynı erişimi ister. Ayrıca yazı tipleri `web_accessible_resources` ile sayfaya
  açılır (yüzen panel aynı yüzü kullanır) — panel iskeleti ve simgesi dışında hiçbir dosya
  sayfaya açılmaz.

## Sağ tık menüsü

Her öğe popup'tan ayrı açılıp kapatılır (`chrome.storage.local.menus`); kapatılan öğe
menüde **hiç kurulmaz**. Varsayılanlar tek yerde (`background.js` → `DEFAULT_MENUS`).

| Öğe | Göründüğü yer | Gittiği hat |
|---|---|---|
| `jv-link` | Bağlantı | `/download` → çok kanallı motor |
| `jv-image` | Fotoğraf | `/download` |
| `jv-media` | Video · ses | `/download` |
| `jv-selection` | Seçili metin | `/download` (bağlantı değilse uygulama reddeder) |
| `jv-page-ask` | Sayfa — **yalnız X/YouTube/Instagram** | `/collect` (`mode: download`) → "Önizle ve onayla" diyaloğu |
| `jv-page-silent` | Sayfa — yalnız aynı siteler | `/collect` (`mode: download, silent: true`) → diyalogsuz, uygulamanın **varsayılan kalitesiyle** |
| `jv-batch` | Sayfa — **yalnız koklanan kaynak varsa** | her kaynak için `/download` |

- **Yalnız `page-ask`/`page-silent` için geçerli olan sayfada kurulur**: koşullu öğeler
  menüye `tabs.onUpdated` / `onActivated` / koklama değişiminde yeniden kurulur
  (`removeAll` + `create`) — desteklenmeyen sayfada **ölü menü öğesi durmaz**.
- **Başlık sırası**: JointVault önekli adlar; menü dili uygulamanın tek sözlüğüdür.
- **`silent` yolu** uygulamada `XSyncReviewDialog` içinde tek bir yürütme fonksiyonundan
  (`runRows`) geçer; diyaloglu ve diyalogsuz yollar **aynı işi** koşar, ayrışmaz.

## Kaynak koklama ve yüzen panel

`chrome.webRequest.onHeadersReceived` ile **yanıt başlıkları** okunur. Ölçütler tek yerde
(`background.js`):

- Yalnız medya/arşiv/belge/program tipleri; `application/octet-stream` ancak uzantısı
  tanınıyorsa kabul edilir (tek başına kanıt değildir).
- **512 KB eşiği**: boyut biliniyorsa altındakiler listelenmez (ikon, parça, önizleme).
- **HLS/DASH dışlanır** (`video/mp2t`, `*.m3u8`, `*.ts`, `*.m4s`, `*.mpd`): akış tek bir
  "video" değil, yüzlerce küçük parçadır. JointVault'un akış indirmesi yok — gürültü hiç
  üretilmez.
- Boyut bilinmiyorsa yalnız `video/*` · `audio/*` kabul edilir.

Sonuçlar **sekme başına** `chrome.storage.session`'da tutulur (URL ile tekilleştirilir, 50 ile
sınırlı), sekme kapanınca/adres değişince temizlenir. Görünürlük üç yerde:

1. **Rozet:** araç çubuğu ikonunda sayı.
2. **Yüzen panel** (`panel.js`): ilk kaynakta sayfaya enjekte edilir. Kapatılırsa o sekme için
   bir daha açılmaz; kaynak bulunamayan sayfaya hiç enjekte edilmez.
3. **Popup listesi:** tüm kaynaklar, "Devral" ve "Tümünü Devral".

`panel.js` **enjekte edilir** (`chrome.scripting.executeScript({files})`): modül değildir,
`import`/`export` kullanamaz. Her şey Shadow DOM'un içindedir ve `:host { all: initial }` ile
sayfadan miras alınan özellikler sıfırlanır — sayfanın CSS'i paneli bozamaz.

## Kuyruk (outbox) — uygulama kapalıyken toplamak

"Topla" isteği uygulamaya **ulaşamazsa** (uygulama kapalı) parti
`chrome.storage.local`'daki kuyruğa yazılır; uygulama açılınca aktarılır.

- **Aktarım tetikleyicileri:** ~1 dk'lık `chrome.alarms` alarmı · tarayıcı açılışı
  (`runtime.onStartup`) · popup açılışı · başarılı bir gönderim sonrası. Hepsi kuyruğu
  **tek partide** POST eder → uygulamada tek "Önizle ve onayla" diyaloğu açılır.
- **Tekilleştirme:** iki katmanlı. Kuyrukta `canonicalizeUrl` ile (aynı gönderi iki kez
  girmez); uygulamada `XSyncReviewDialog` zaten kayıtlı olanı `KAYITLI/ÇİFT` diye atlar —
  bu yüzden tekrar gönderim güvenlidir.
- **Yalnızca "Topla" kuyruğa girer.** Tekil "Arşive İndir" uygulama kapalıysa bugünkü
  hatayı verir (kuyrukta iki farklı mod karışınca uygulama diyaloğu birbirini ezerdi).
- **Hata durumunda kuyruk silinmez:** ağ yok → yerinde kalır; `401` → çipte bekleyen
  sayısı ve "Eşleşme anahtarı geçersiz" uyarısı görünür.
- **Tavan:** 20.000 kayıt. Aşılırsa en eski kayıtlar düşürülür ve durumda belirtilir.
- **Sınır:** `chrome.alarms` tarayıcı kapalıyken çalışmaz; aktarım en geç tarayıcı açıkken
  bir dakika içinde olur.

## Görsel dil

`popup.html` uygulamanın token katmanını taşır: değerler `jointvault/src/index.css`
(`@theme` + `.dark`) ile birebir aynı rol adlarıdır ve `prefers-color-scheme` ile
gece/gündüz döner. Kural kaynağı `DESIGN.md`'dir (tek aksan systemBlue, kart = opak
`settings-card`, emoji/glif yok, lucide ikon). `src/index.css` değişirse buradaki
token bloğu da güncellenir.

## `scrape-*.js` çalışma modeli (lint muafiyetinin gerekçesi)

Bu betikler sayfaya **enjekte edilir** (`chrome.scripting.executeScript`, `files: [...]`).
Betiğin tamamlanma değeri bir Promise'dir ve `executeScript` onu bekler — yani dosyanın
son ifadesi olan IIFE'nin dönüş değeri **anlam taşır**.

Bu yüzden `.oxlintrc.json` içinde `typescript/no-floating-promises` kuralı `extension/**`
için **kapatılmıştır**: lint'in önerdiği `void` öneki tamamlanma değerini `undefined`'a
çevirir ve beklenen Promise'i koparır. Kural burada yanlış öneri veriyor — kapatma
bilinçlidir, ihmal değil.

`popup.js` normal bir eklenti sayfasıdır (enjekte edilmez); orada kural geçerlidir.
