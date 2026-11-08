# Eklenti paketleme ve yayın

## Paket

```powershell
cd jointvault
npm run package:extension
```

Çıktı: `jointvault/dev/out/jointvault-collector-<sürüm>.zip` (`dev/out` gitignore'da).

## Chrome Web Store adımları

1. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) hesabı aç.
2. Yeni öğe → ZIP'i yükle.
3. Mağaza kaydı:
   - Ad: **JointVault Collector**
   - Kategori: Verimlilik
   - Dil: Türkçe
   - Tek amaç: X/Instagram/YouTube listelerini ve tarayıcı indirmelerini yerel JointVault
     uygulamasına aktarmak.
4. Gizlilik:
   - Veri toplanmaz, sunucuya gönderilmez; yalnızca `127.0.0.1:48120` ile yerel uygulamaya bağlanır.
   - Çerezler yalnızca devralınan indirme isteğiyle birlikte, o adres için okunur.
   - `storage` yalnızca eşleşme anahtarı ve eklenti tercihleri içindir.
5. İzin gerekçeleri (inceleme formu):
   - `cookies`: oturum gerektiren indirmelerde çerez aktarımı.
   - `downloads`: tarayıcı indirmesini devralma.
   - `webRequest`: sayfadaki medya/arşiv kaynaklarını koklama.
   - `scripting` + `activeTab`: kaynak panelini yalnızca kullanıcının açtığı sekmede gösterme.
   - `contextMenus`: sağ tık menüsü.
   - `*://*/*`: keyfi sitedeki indirmeleri devralabilmek için (IDM davranışı). Yalnızca
     desteklenen platformlarla sınırlamak bu özelliği kırar.
6. İnceleme notu: eklenti tek bir yerel uygulamayla çalışır; uzak sunucu yoktur. Test için
   JointVault uygulamasının açık olması ve eşleşme anahtarının girilmesi gerekir.

## Sürüm

`extension/manifest.json` sürümü `jointvault/package.json` ile aynı tutulur. Sürüm
yükseltmesinden sonra ZIP'i yeniden üret.
