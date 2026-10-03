# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Tek kullanıcı: uygulamanın sahibi. Türkçe konuşan, teknik olarak yetkin bir "medya biriktiricisi" — X/Instagram/YouTube/TikTok'ta kaydettiği post, video ve fotoğrafları kaybetmeden tek yerde tutmak isteyen; yt-dlp, ffmpeg ve komut satırı araçlarının ne yaptığını bilen, ama her seferinde terminale dönmek istemeyen biri.

Kullanım sahnesi: masaüstü (Windows), varsayılan 1280×800 pencere, sık sık yarı ekrana yapıştırılmış; gündüz çalışma ışığı ile akşam loş ortam arasında değişen koşullar. İş: akışta gördüğü bir şeyi anında arşive atmak, sonra arşivde bulmak ve üzerinde işlem yapmak.

## Product Purpose

JointVault kişisel medya arşividir: linkleri tek tek veya toplu kaydeder, tarayıcı eklentisiyle X/Instagram/YouTube'dan içe aktarır, yt-dlp ile indirir, ffmpeg ile dönüştürür/kırpar/altyazılar, yinelenenleri bulur ve hepsini koleksiyon/kategori/etiket ile düzenler. Amaç, dağınık platform kayıtlarını kaybolmayan, aranabilir, üzerinde iş yapılabilir tek bir yerel arşive dönüştürmek.

Başarı ölçütü (kullanıcı tarafından onaylandı):
1. Bir şeyi kaydetmek tek hareket olur — gözle aranmaz.
2. Arşivi gezmek keyif verir; kapaklar bir koleksiyon gibi durur.
3. İndirme/dönüştürme/kırpma bir montaj masası gibi ciddi ve okunur hisseder.
4. Aynı işi yapan farklı görünümlü kontroller tek bir görsel sözlüğe iner.

## Positioning

Rakip bir ürünün dürüstçe kopyalayamayacağı mekanizma: **kaydetme, indirme ve dönüştürme tek yerel hatta bağlıdır** — tarayıcı eklentisi → eşleşme anahtarlı localhost köprüsü → SQLite arşivi → yt-dlp kuyruğu → ffmpeg/whisper araçları. Bulut yok, hesap yok, kota yok; dosya kullanıcının diskinde, kayıt kullanıcının veritabanında kalır. Arayüz bu hattın görünür hâli olmalı.

## Operating Context

- Aktarım yolları: tekil link ekleme, toplu aktarım, URL'den indirme, pano izleyici (kopyalanan linki yakalar), tarayıcı eklentisi (X yer işaretleri / Instagram kaydedilenler / YouTube oynatma listeleri, otomatik kaydırarak toplar).
- Satır içi indirme: gerçek format listesinden kalite seçimi, sıralı kuyruk, satır içi yüzde + hız/ETA, hata durumunda yeniden deneme.
- Araçlar: medya dönüştürücü (mp4/mp3/m4a/kırp), zaman çizelgeli kırpma editörü (film şeridi + dalga formu), video birleştirme, sessizlik kırpma, GIF/WebM üretimi, altyazı gömme/çıkarma ve whisper ile otomatik üretim (model lazy indirilir), yinelenen bulucu (URL + dosya hash), istatistikler.
- Kabuk: sistem tepsisi (kapatınca arka planda devam / gerçekten çık), tek örnek kilidi, Ctrl+K komut paleti, tema geçişi, karşılama turu + ilk kurulum sihirbazı, tanılama paneli, vault yedekleme/geri yükleme, eklenti eşleşme anahtarı.
- Dil: arayüzün tamamı Türkçe; `tr-TR` tarih biçimi ve Türkçe onay/uyarı metinleri.

## Capabilities and Constraints

- Yığın sabit: Tauri v2 + React 19 + TypeScript + Vite + Tailwind v4 (`@theme`) + `@base-ui/react` 1.8 + lucide-react + recharts (yalnızca İstatistikler, lazy). Yeni npm paketi eklenmesi kullanıcı tarafından serbest bırakıldı; gerekmedikçe eklenmez.
- `@base-ui/react` 1.8 zaten popover, menu, select, tabs, switch, slider, progress, toast, scroll-area, toolbar, toggle-group, alert-dialog, accordion, collapsible, drawer, meter, field/form sağlıyor. El yapımı açılır paneller, stillendirilmemiş yerel `<select>` ve `window.confirm` bunlarla değiştirilmeli.
- Masaüstü çalışma zamanı: pencere varsayılan 1280×800, yeniden boyutlandırılabilir, tanımlı minimum yok. Dar pencere (≈640px) gerçek bir kullanım durumudur; bugün `md` altında sol menü tamamen kayboluyor ve yerine hiçbir gezinme gelmiyor.
- Performans bütçesi bağlayıcı: 1000+ öğelik arşiv. Sayfalama SQL'de (LIMIT/OFFSET), kart/satır için `content-visibility: auto`, arama 250ms debounce, İstatistikler lazy. Bu kazanımlar korunur.
- Çevrimdışı: font ve görsel varlıklar yerelden servis edilir; çalışma anında uzak kaynak çekilmez.
- Dokunulmazlar: tüm özellikler, akışlar, Türkçe metinler, klavye kısayolları ve IPC/veri akışları korunur. Ek izinler: modal kullanımını azaltmak, etiket ve boş/hata durum metinlerini iyileştirmek (anlam ve vaat değişmez).
- Mevcut görsel dil (sıcak krem kâğıt `#faf7f1` + Georgia serif display + kiremit aksan `#9a3412`) **terk edilecek dünya** olarak kayda geçti; korunacak marka mirası değil.

## Brand Commitments

- Ad: **JointVault** (tek kelime, CamelCase). Wordmark bir "arşiv" fikrini taşımalı; mevcut lucide `Archive` ikonu tesadüfi, bağlayıcı değil.
- Ses: Türkçe, "sen" hitabı, sıcak ama teknik (mevcut metinlerin tonu korunur).
- Var olan görsel varlıklar: `public/favicon.svg`, `public/icons.svg`, `src-tauri/icons/*` paket ikonları. Korunur, gerekirse yeniden çizilir.
- Bağlayıcı estetik kısıtı yok; yalnızca ton **teknik/profesyonel** olarak sabitlendi. Tema: koyu ve açık tam kurulur, açılış koyu.

## Evidence on Hand

- Gerçek ürün kanıtı kodun kendisi: çalışan Tauri uygulaması, 30 React bileşeni, SQLite şeması, Rust komutları, gömülü yt-dlp/ffmpeg/whisper sidecar'ları, tarayıcı eklentisi.
- Gerçek içerik yok: depoda örnek/seed medya, ekran görüntüsü veya demo verisi bulunmuyor. Arayüz önizlemeleri için yazılacak her örnek başlık/görsel **sentetik** olarak işaretlenir; uydurulmuş metrik, müşteri adı, referans veya kapasite iddiası yazılmaz.
- Ekran görüntüsü/test altyapısı yok: görsel regresyon golden'ı, Storybook, test koşucusu yok. Doğrulama `npm run build` + `cargo check` + elle çalıştırma.
- Kullanıcının kendi arşivi (gerçek başlıklar, gerçek thumbnail'lar) tasarımın gerçek malzemesidir; arayüz 0 / 1 / 50 / 2000 öğe durumlarında çalışmalıdır.

## Sözlük

Arayüzün sözlüğü Türkçedir ve tekildir; eşanlamlı ikinci bir sözcük kullanılmaz.

| Kavram | Terim |
|---|---|
| Kullanıcının tüm medya kaydı | **Arşiv** |
| Tek bir kayıtlı öğe (post/video/makale) | **Kayıt** |
| Yerel medyayı işleyen araçlar bölümü | **Araçlar** |
| Yerel yapay zekâ sohbeti | **Asistan** |

"Kasa", "fiş", "araç kutusu", "yer imi", "gönderi" kullanılmaz.

## Product Principles

1. **Kaydetmek görünmez bir hareket olmalı.** Linki yapıştır ve bitti; onay diyaloğu, ikinci pencere, alan doldurma yok. Kaydetme her ekrandan erişilebilir ve uygulamanın en belirgin kontrolü olur.
2. **Durum her zaman okunur olmalı.** Her öğe tek bakışta nereden geldiğini (platform), ne durumda olduğunu (indirilmedi / kuyrukta / iniyor / yerel / hata) ve hangi araçların ona dokunabileceğini gösterir. Sessiz belirsizlik yok.
3. **Yoğunluk bir özelliktir.** Bu bir arşiv: 2000 satır taranabilir olmalı. Ferahlık için bilgi saklanmaz; hiyerarşi tipografi ve çizgiyle kurulur.
4. **Tek sözlük.** Buton, giriş, sekme, açılır panel, ilerleme, boş durum, hata: her biri tek bir biçimde görünür. Aynı işi yapan iki farklı kontrol bir hatadır.
5. **Kabuk sessiz, medya önde.** Renk ve ölçek kullanıcının kendi kapağına aittir. Arayüz süslenmez, çalışır.

## Accessibility & Inclusion

- Klavye bağlayıcı: Ctrl+K komut paleti, Escape ile kapatma, Enter ile onay, görünür odak halkasıyla tam Tab sırası. Fare gerektiren birincil eylem yok.
- Renk tek başına anlam taşımaz: platform ve indirme durumu her zaman metin/ikon eşliğinde yazılır.
- `prefers-reduced-motion` altında hareket anlamlı biçimde sadeleşir.
- Dar pencere (640–900px) birinci sınıf: gezinme kaybolmaz, tablolar yatay kaydırma yerine yeniden akar.
- Gövde metni en az WCAG AA kontrast; hairline çizgiler metin taşımaz.
