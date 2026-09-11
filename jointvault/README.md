# JointVault

Kişisel medya arşivi: farklı platformlarda kaydedilen post/video/fotoğraflar, X/Instagram/YouTube içe aktarma, IDM tarzı indirme (yt-dlp), ffmpeg dönüştürme/kırpma ve mini video editörü — hepsi tek masaüstü uygulamasında.

## Özellikler

- **Arşiv**: link kaydetme (tekli/toplu), koleksiyon + kategori + etiket, favoriler, tam-metin arama, kart/satır görünümü, sayfalama
- **İçe aktarma**: tarayıcı eklentisi (`extension/`) — X yer işaretleri, Instagram kaydedilenler, YouTube playlistleri (otomatik kaydırarak toplar)
- **İndirme**: yt-dlp sidecar ile mp4/m4a, kalite seçimi (gerçek format listesi), sıralı kuyruk, satır-içi ilerleme, eşleşme anahtarlı localhost köprüsü
- **Araçlar**: medya dönüştürücü (mp4/mp3/m4a/kırp), timeline'lı kırpma editörü (film şeridi + dalga formu), yinelenen bulucu (URL + dosya hash), pano izleyici, komut paleti (Ctrl+K), tray'de arka plan servisi

## Teknoloji

Tauri v2 (Rust) + React 19 + TypeScript + Vite + Tailwind v4 + shadcn/ui. SQLite (`tauri-plugin-sql`), sidecar: yt-dlp + ffmpeg/ffprobe (git-lfs ile repoda).

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

SQLite: `jointvault.db` (uygulama veri dizini). İndirilenler: `Downloads/JointVault` (Ayarlar'dan değişir). Eşleşme anahtarı ve indirme klasörü uygulama veri dizinindeki dosyalarda saklanır.
