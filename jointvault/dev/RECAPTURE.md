# Canlı kanıt yeniden yakalama (item 3)

## Neden gerekli

Bitirme incelemesinden kalan tek açık kanıt boşluğu:

> Gerçek SQL verisiyle kasa hiç render edilmedi — bu ortamda Tauri çalışma zamanı yok.

Doğrulanmış olanlar: kabuk (yükleniyor durumunda), atom katmanı (sentetik veriyle),
düzenlenmiş yüzeyler (harness ile). Gerçek satırlarla çekilmiş bir ekran yok.

Bu boşluk **buradan kapatılamaz**, çünkü uygulama bir Tauri/WebView2 penceresinde
çalışır ve bu ortamda Tauri yok. Ama tek komuta indirilebilir.

## Nasıl çalıştırılır

Uygulama penceresi **kapalıyken** başla (yoksa eski süreç portu tutmaz):

```powershell
cd jointvault

# WebView2'ye hata ayıklama portunu açtır
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"

# Uygulamayı başlat (beforeDevCommand zaten vite'ı 5173'te ayağa kaldırır)
npx tauri dev
```

Pencere açıldıktan sonra, **ikinci bir terminalde**:

```powershell
cd jointvault
node dev/recapture-live.mjs
```

## Ne üretir

| Dosya | İçerik |
|---|---|
| `dev/out/live/live-desktop.png` | Arşiv görünümü, gerçek satırlarla, tam sayfa |
| `dev/out/live/live-mobile.png` | Aynı ekran, 390×844 |
| `dev/out/live/live-manifest.json` | Provenance: kaç gerçek kayıt, kaç kart/satır, URL, UA, zaman |

## Betiğin kasıtlı kapıları

Betik **kanıt uydurmayı reddeder**:

1. **9222'ye bağlanamazsa** çıkar ve sırayı yazar. Sessizce başka bir tarayıcı açıp
   "uygulama" fotoğrafı çekmez — o, kanıt değil temsil olurdu.
2. **Arşiv boşsa (0 kayıt) hiçbir dosya yazmaz.** Boş bir arşivin ekran görüntüsü
   "gerçek veriyle çalışıyor" iddiasını taşıyamaz. Önce gerçek kayıt ekle.
3. **Provenance yazar.** Sözleşmenin FINISH maddesi her rasterin kaynağını taşımasını
   istiyor; `live-manifest.json` bunu sayıyla verir.

## Bilinen sınırlar

- **WebView2 hata ayıklaması** `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` ile açılır.
  Kurumsal politikalar bu değişkeni yok sayabilir; o durumda bağlantı kurulmaz ve
  betik bunu açıkça söyler.
- **Pencere boyutu** CDP ile emülasyonla değiştirilir; native pencere yeniden
  boyutlanmaz. `live-mobile.png` 390×844 emülasyonudur, gerçek dar pencere değil.
  Gerçek dar pencere kanıtı için pencereyi elle ~640px'e getirip tekrar çalıştır.
- Betik **yalnızca okur**: tıklar (karşılama turunu atlar), veri yazmaz, silmez.

## Bu koşu sonrası

1. `live-desktop.png` / `live-mobile.png` dosyalarını gözle doğrula.
2. `live-manifest.json` içindeki `totalItems` beklediğin sayı mı?
3. Öyleyse item 3 kapanır ve DESIGN.md'deki "kanıt" notu güncellenebilir.
