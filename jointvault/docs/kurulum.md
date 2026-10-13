# JointVault — Kurulum

Kişisel medya arşivi. Windows masaüstü uygulaması; hesap, bulut ve kota yok — her şey senin
diskinde kalır.

## İndir ve kur

1. **`JointVault_1.0.0_x64-setup.exe`** dosyasını indir ve çalıştır.
2. Windows **"Windows korumalı PC'niz"** (SmartScreen) uyarısı verir. Bu beklenen bir durumdur:
   uygulama kod imzalı değil. **Ek bilgi → Yine de çalıştır** ile devam et.
3. Kurulum **bu kullanıcı için** yapılır (yönetici izni istemez). Varsayılan konum:
   `%LOCALAPPDATA%\JointVault`.
4. Kurulum sırasında WebView2 gerekir. Windows 10 (1803+) ve Windows 11'de hazır gelir;
   gelmiyorsa kurulum onu internetten indirir.

Alternatif olarak **`JointVault_1.0.0_x64_en-US.msi`** (yönetici kurulumu) veya
**`JointVault_1.0.0_portable.zip`** (kurulum gerektirmez, klasörden çalışır) kullanılabilir.

## İlk açılış

Uygulama açılınca **ilk kurulum sihirbazı** çıkar. İstediğin adımları atlayabilirsin; atlarsan
uygulama çalışmaya devam eder ve eksikleri açıkça söyler.

- **ffmpeg/ffprobe indirilir (~150 MB).** İndirme/dönüştürme/kırpma araçlarının önkoşulu budur.
  İndirme iptal edilebilir; anlaşılır bir hata verir, yarım dosya bırakmaz.
- **İndirme klasörü** seçilir (varsayılan `İndirilenler\JointVault`).
- **Yerel AI kapalı gelir ve hiçbir şey indirmez.** Açmak istersen Ayarlar → AI'dan açık rıza
  verirsin; ne indirileceği ve kaç GB olacağı önce gösterilir.

Gereksinim: Windows 10/11 x64, 8 GB RAM, ~10 GB boş disk. GPU gerekmez (AI kapalıyken).

## Tarayıcı eklentisi (X / Instagram / YouTube içe aktarma)

Bu platformlardan içe aktarmanın tek yolu eklentidir ve klasörü uygulamayla birlikte kurulur.

1. Uygulamada **Ayarlar → Eklenti**'yi aç, **Eklenti klasörünü aç** düğmesine bas.
2. Chrome'da `chrome://extensions` adresini aç, sağ üstten **Geliştirici modu**'nu aç.
3. **Paketlenmemiş öğe yükle** → açılan `extension` klasörünü seç.
4. Eklenti penceresine **Ayarlar → Eklenti**'deki eşleşme anahtarını yapıştır.

Anahtarı yenilersen eklentiye yeniden girmen gerekir. Kurulumun çalıştığını aynı ekranda
**"Eklenti bağlı — son temas: …"** satırından doğrulayabilirsin.

## Verilerin nerede

| Ne | Yer |
|---|---|
| Arşiv veritabanı (`jointvault.db`), ayarlar, eşleşme anahtarı | `%APPDATA%\com.joint.vault` |
| Otomatik yedekler (son 5 kopya) | `%APPDATA%\com.joint.vault\backups` |
| İndirilen bileşenler (ffmpeg, whisper, modeller) | `%APPDATA%\com.joint.vault\components` |
| İndirilen medya | `İndirilenler\JointVault` (Ayarlar'dan değişir) |

Uygulamada **Ayarlar → Yedekleme**: "Şimdi yedekle", "Yedekten geri dön", "Veritabanını sıfırla"
ve tüm kayıtları JSON olarak dışa aktarma vardır.

## Kaldırma

**Ayarlar → Uygulamalar → JointVault → Kaldır.**

Kaldırma **arşivini silmez**: veritabanı, yedekler ve indirdiğin medya olduğu yerde kalır. Her
şeyi silmek istersen yukarıdaki tabloda yazan klasörleri ve `İndirilenler\JointVault`'u elle sil.
Taşınabilir sürümde klasörü silmek yeterlidir; geriye yalnızca `%APPDATA%\com.joint.vault` kalır.

## Sürüm

Bu sürüm **1.0.0**. Sürümün tek kaynağı `jointvault/package.json`'dır; kurulum dosyası adı,
uygulama ve `Cargo.toml` ondan senkronlanır (`node dev/set-version.mjs <sürüm>`).
