# JointVault

Kişisel medya arşivi: farklı platformlarda kaydedilen post/video/fotoğraflar, X/Instagram/YouTube içe aktarma, IDM tarzı indirme (yt-dlp), ffmpeg dönüştürme/kırpma ve mini video editörü — hepsi tek masaüstü uygulamasında.

## Özellikler

- **Arşiv**: link kaydetme (tekli/toplu), koleksiyon + kategori + etiket, favoriler, tam-metin arama, kart/satır görünümü, sayfalama
- **İçe aktarma**: tarayıcı eklentisi (`extension/`) — X yer işaretleri, Instagram kaydedilenler, YouTube playlistleri (otomatik kaydırarak toplar)
- **İndirme**: yt-dlp sidecar ile mp4/m4a, kalite seçimi (gerçek format listesi), sıralı kuyruk, satır-içi ilerleme, eşleşme anahtarlı localhost köprüsü
- **İndirme yöneticisi (IDM tarzı)**: çok kanallı motor (`turbo_download.rs`) — dinamik parçalama (en büyük parçayı ikiye bölme), duraklat/devam, `.meta` ile çökme-dayanıklılık, eşzamanlılık kuyruğu, global hız sınırı, `Referer`+çerez, kategori klasörleri, hata sonrası yeniden deneme, üzerine yazmayan hedef adı (`unique_path`)
- **Tarayıcı devralma ve koklama**: eklenti `chrome.downloads` ile indirmeyi devralır, `webRequest` ile sayfa kaynaklarını koklar (rozet · yüzen panel `panel.js` · popup listesi), sağ tık menüsünde 7 öğe sunar (her biri ayrı açılıp kapatılabilir; koşullu öğeler yalnız geçerli sayfada kurulur)
- **Araçlar**: medya dönüştürücü (mp4/mp3/m4a/kırp), timeline'lı kırpma editörü (film şeridi + dalga formu), yinelenen bulucu (URL + dosya hash), pano izleyici, komut paleti (Ctrl+K), tray'de arka plan servisi

## Teknoloji

Tauri v2 (Rust) + React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui. SQLite (`tauri-plugin-sql`), sidecar: yt-dlp + whisper. ffmpeg/ffprobe **repoda tutulmaz** (313 MB'lık yük); ilk kullanımda Ayarlar → Bileşenler bölümünden indirilir — sha256 doğrulamalı, iptal edilebilir ilerlemeli indirme. Araçlar aracı bileşen kaydından çözer (indirilen → gömülü), yani indirilen kopya otomatik kullanılır.

## Geliştirme

Önkoşullar: Node 20+, Rust stable, Windows'ta WebView2 (hazır gelir).

```powershell
cd jointvault
npm install
npx tauri dev        # arayüz + backend birlikte
```

Doğrulama: `npm run build` (tsc + vite), `cd src-tauri; cargo check`.

## Eklenti

`chrome://extensions` → Geliştirici modu → `jointvault/extension` klasörünü paketlenmemiş yükle. Uygulamada Ayarlar → Eklenti sekmesindeki anahtarı eklentiye yapıştır.

## Paketleme

```powershell
npx tauri build      # src-tauri/target/release/bundle/ altına MSI/NSIS
```

## Veri

SQLite: `jointvault.db` (uygulama veri dizini). İndirilenler: `Downloads/JointVault` (Ayarlar'dan değişir); kategori klasörleri açıkken dosya türüne göre alt klasöre iner. Eşleşme anahtarı, indirme klasörü ve indirme ayarları (`download_settings.json`) uygulama veri dizinindeki dosyalarda saklanır. İndirilen bileşenler (ffmpeg/ffprobe) uygulama veri dizinindeki `components/` klasörüne yazılır; yönetici izni gerekmez.
