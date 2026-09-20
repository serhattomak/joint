# JointVault tarayıcı eklentisi

X yer işaretlerini, Instagram kaydedilenleri ve YouTube oynatma listelerini uygulamanın
localhost köprüsüne (`127.0.0.1:48120`) aktarır. Eşleşme anahtarı uygulamada
**Ayarlar → Eklenti**'de üretilir ve popup'a yapıştırılır.

## Dosyalar

| Dosya | Rol |
|---|---|
| `manifest.json` | MV3 bildirimi ve izinler |
| `popup.html` / `popup.js` | Arayüz, sunucu bağlantısı denetimi, toplu gönderim |
| `scrape.js` | Genel adaptör (X + otomatik sayfa kaydırma) |
| `scrape-youtube.js` | YouTube oynatma listesi adaptörü |
| `scrape-instagram.js` | Instagram kaydedilenler adaptörü |

## `scrape-*.js` çalışma modeli (lint muafiyetinin gerekçesi)

Bu betikler sayfaya **enjekte edilir** (`chrome.scripting.executeScript`, `files: [...]`).
Betiğin tamamlanma değeri bir Promise'dir ve `executeScript` onu bekler — yani dosyanın
son ifadesi olan IIFE'nin dönüş değeri **anlam taşır**.

Bu yüzden `.oxlintrc.json` içinde `typescript/no-floating-promises` kuralı `extension/**`
için **kapatılmıştır**: lint'in önerdiği `void` öneki tamamlanma değerini `undefined`'a
çevirir ve beklenen Promise'i koparır. Kural burada yanlış öneri veriyor — kapatma
bilinçlidir, ihmal değil.

`popup.js` normal bir eklenti sayfasıdır (enjekte edilmez); orada kural geçerlidir.
