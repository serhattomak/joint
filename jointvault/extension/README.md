# JointVault tarayıcı eklentisi

X yer işaretlerini, Instagram kaydedilenleri ve YouTube oynatma listelerini uygulamanın
localhost köprüsüne (`127.0.0.1:48120`) aktarır. Eşleşme anahtarı uygulamada
**Ayarlar → Eklenti**'de üretilir ve popup'a yapıştırılır.

## Dosyalar

| Dosya | Rol |
|---|---|
| `manifest.json` | MV3 bildirimi ve izinler |
| `popup.html` / `popup.js` | Arayüz, sunucu bağlantısı denetimi, toplu gönderim, kuyruğa alma |
| `outbox.js` | Giden kutusu (saf katman, `chrome`'a bağımlı değil) + `canonicalizeUrl` (uygulama portu) |
| `outbox.test.mjs` | Kuyruk testi — `npm run test` içinde koşar |
| `background.js` | Arka plan aktarıcı (servis çalışanı, modül) |
| `fonts/` | Inter + JetBrains Mono (uygulamanın `public/fonts` kopyası); popup çevrimdışı aynı yüzü kullanır |
| `scrape.js` | Genel adaptör (X + otomatik sayfa kaydırma) |
| `scrape-youtube.js` | YouTube oynatma listesi adaptörü |
| `scrape-instagram.js` | Instagram kaydedilenler adaptörü |

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
