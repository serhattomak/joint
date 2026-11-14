# Dönüşüm Merkezi — Gereksinim Analizi ve Mimari

Tarih: 2026-11-14 · Durum: uygulandı (bu belge kararların kaynağıdır)

## 1. Amaç

JointVault'un bugünkü Dönüştürücüsü yalnızca `mp4 / mp3 / m4a / kırp` üretir. Yeni yapı,
tek bir **Dönüşüm Merkezi**'nde belge, PDF, tablo, sunum, görsel, ses ve videoyu dönüştürür;
çoklu kaynak, toplu iş, iptal, kalıcı geçmiş ve PDF araçlarını aynı sözlükte toplar.

Başarı ölçütü:

1. Kullanıcı bir kaynak seçip hedef biçimi tek bakışta görür; hangi motorun gerektiğini
   düşünmek zorunda kalmaz.
2. Aynı türden N dosya tek hedefle sırayla dönüşür; her satırın durumu ayrı okunur.
3. Motor eksikse iş sessizce ölmez: bileşen kurulumu açılır, kurulunca iş yeniden denenir.
4. PDF, ofis belgesi ve medya arasındaki sınırlar dürüstçe yazılır (aşağıdaki kalite notları).
5. Dönüşüm geçmişi uygulama yeniden açıldığında kaybolmaz.

## 2. Kapsam

### 2.1 Kaynak türleri

| Tür | Uzantılar |
|---|---|
| Belge (Writer) | `docx`, `doc`, `odt`, `rtf`, `txt`, `html`, `htm`, `md`, `markdown` |
| Tablo (Calc) | `xlsx`, `xls`, `ods`, `csv` |
| Sunum (Impress) | `pptx`, `ppt`, `odp` |
| PDF | `pdf` |
| Görsel | `png`, `jpg`, `jpeg`, `webp`, `bmp`, `tif`, `tiff`, `gif` |
| Ses | `mp3`, `m4a`, `aac`, `wav`, `flac`, `ogg`, `oga`, `opus`, `wma`, `aiff`, `aif`, `amr` |
| Video | `mp4`, `m4v`, `mkv`, `webm`, `mov`, `avi`, `wmv`, `flv`, `ts`, `mts`, `mpg`, `mpeg`, `3gp` |

Bilinmeyen uzantı listeye alınmaz; "desteklenmiyor" satırı üretilmez.

### 2.2 Hedef matrisi (gerçekten çalışan yönler)

| Kaynak | Hedefler |
|---|---|
| Belge | `pdf`, `docx`, `odt`, `rtf`, `txt`, `html`, `md` |
| Tablo | `pdf`, `xlsx`, `ods`, `csv`, `html` |
| Sunum | `pdf`, `pptx`, `odp` |
| PDF | `docx`, `xlsx`, `pptx`, `txt`, `md`, `html`, `png`, `jpg` |
| Görsel | `png`, `jpg`, `webp`, `bmp`, `tiff`, `gif`, `pdf` |
| Ses | `mp3`, `m4a`, `aac`, `wav`, `flac`, `ogg`, `opus` |
| Video | `mp4`, `mkv`, `webm`, `mov`, `avi`, `gif`, `mp3`, `m4a`, `wav` |

Aynı biçime dönüşüm (ör. `mp4 → mp4`) bilinçli olarak serbesttir: yeniden kodlama,
çözünürlük/bit hızı düşürme ve sesi ayırma için kullanılır.

### 2.3 PDF araçları (dönüşümden ayrı sekme)

- Birleştir: N PDF → tek PDF (lopdf).
- Sayfa ayır: seçilen aralıklar tek PDF'e ya da her sayfa ayrı dosyaya (lopdf).
- Sıkıştır: nesne akışları + en iyi sıkıştırma (lopdf).
- Döndür: seçili sayfaları 90/180/270° (lopdf).
- Görsellerden PDF: N görsel → tek PDF, A4/Letter/otomatik sayfa (printpdf).

### 2.4 Kapsam dışı

- PDF'ten birebir düzen koruyan Word/Excel çıktısı (taranmış PDF'lerde OCR yok).
- Şifreli PDF/Ofis dosyaları (parola istemi yok; motorun hatası dürüstçe gösterilir).
- Bulut kuyruğu, arka plan zamanlayıcısı, klasör izleme.
- Video düzenleme (kırpma/birleştirme mevcut Araçlar'da kalır; bu merkez biçim değiştirir).

## 3. Motor seçimi ve gerekçesi

| İş | Motor | Neden |
|---|---|---|
| Ofis ↔ PDF, ofis içi biçimler | **LibreOffice 26.8.3** (headless) | DOCX/XLSX/PPTX'i gerçek düzen motoruyla açar; yeni bir ofis renderer yazmak kapsam dışı. Markdown desteği 26.8'de geldi. |
| PDF metni, sayfa görüntüsü, PDF→ofis | **PDFium** (dinamik `pdfium.dll`) | BSD lisanslı, Chrome'un PDF motoru; metin segmentleri ve sayfa rasterleştirme güvenilir. |
| PDF birleştirme/ayırma/döndürme/sıkıştırma | **lopdf** (saf Rust) | Harici süreç yok; sayfa ağacı işlemleri için yeterli. |
| Görsel → PDF | **printpdf** (saf Rust) | Tek görsel veya çoklu görselden sayfa üretimi. |
| Görsel biçimleri | **image** (saf Rust) | PNG/JPEG/WebP/BMP/TIFF/GIF kod çözme-yazma; ffmpeg'e gereksiz bağımlılık yok. |
| Ses/video/GIF | **ffmpeg** (mevcut bileşen) | Zaten indirilebilir; codec/container matrisi geniş. |
| DOCX/XLSX/PPTX üretimi | Kendi OOXML yazıcıları | PDF→ofis çıktısı için harici bağımlılık yok; şablon dosyası taşımak gerekmez. |

### 3.1 Kalite notları (arayüzde görünür)

- **PDF → DOCX/XLSX:** metin konumları satır/kolon olarak yeniden kurulur. Görsel, tablo
  çizgisi ve birebir sayfa düzeni korunmaz; bu bir "metin aktarımı"dır.
- **PDF → PPTX:** her sayfa 16:9 slayta tam sayfa görsel olarak yerleşir; metin düzenlenebilir
  değildir. Görsel bütünlük korunur.
- **PDF → PNG/JPG:** seçilen DPI'da sayfa rasterleştirilir (72/150/300).
- **Ofis → PDF:** LibreOffice'in font ikamesi kullanılır; makinede olmayan fontlar kayabilir.
- **Ses/video:** kalite ön ayarı CRF/bit hızına çevrilir; kaynak codec desteklenmiyorsa ffmpeg'in
  Türkçeleştirilmiş hatası gösterilir.

## 4. Bileşenler ve pinler

| Bileşen | Sürüm/kaynak | Boyut | Lisans | Kurulum |
|---|---|---|---|---|
| `libreoffice` | 26.8.3, TDF MSI | ~359 MB (açılmış ~1.6 GB) | MPL-2.0 | `msiexec /a` ile yönetici izni gerekmeden çıkarılır; `program/bootstrap.ini` izole profile yönlendirilir. |
| `pdfium` | bblanchon `chromium/8152`, win-x64 tgz | ~4 MB (dll ~7.8 MB) | BSD-3 | Tar.gz içinden yalnız `pdfium.dll` çıkarılır. |
| `ffmpeg/ffprobe` | mevcut pin | ~191 MB | GPL | Mevcut bileşen yöneticisi. |

LibreOffice `UserInstallation` yaması neden gerekli: yönetici kurulumuyla çıkarılan ağaçta
`-env:UserInstallation` profili oluşturulamıyor ve süreç asılı kalıyor. `bootstrap.ini` içindeki
satır `$ORIGIN/../lo-profile` yapıldığında süreç kendi profilini açar ve dönüşümden sonra çıkar.
Bu davranış 26.8.3 ile ölçüldü (bkz. §9).

## 5. Mimari

### 5.1 Rust

```
src-tauri/src/conversion/
  mod.rs       # convert_file, convert_cancel, conversion_scan_dir, conversion_inspect
               # iş kaydı, ilerleme olayı, biçim doğrulama, hata eşleme
  media.rs     # ffmpeg argümanları, ses/video/GIF, görsel dönüşümü
  office.rs    # LibreOffice çözümleme, filtre/parametre üretimi, süreç yönetimi
  pdf.rs       # PDFium bağlama, metin/düzen çıkarma, rasterleştirme, lopdf araçları
  ooxml.rs     # DOCX/XLSX/PPTX yazıcıları
  paths.rs     # sayfa aralığı ayrıştırma, çıktı adı, benzersiz yol
```

- Tüm dönüşümler **sıralıdır** (`CONVERSION_LOCK`): aynı anda tek ağır motor. İndirme
  kuyruğundan ayrıdır; indirme ile dönüşüm paralel yaşayabilir.
- `convert_file` tek giriş noktasıdır. `target` uzantısı ve `source` türü backend'de yeniden
  doğrulanır; arayüz matrisi tek başına güven sınırı değildir.
- İlerleme: `convert-progress` olayı `{ jobId, percent, phase }` yayar. Eski `convert_media`
  tüketicileri `phase` alanını yok sayar.
- İptal: `convert_cancel` işin `CommandChild`'ını öldürür; saf Rust işleri sayfa/ satır
  sınırlarında `AtomicBool` okur.
- Çıktı çakışması: hedef varsa ` (2)`, ` (3)`… eklenir; kaynak dosyanın üzerine yazılmaz.

### 5.2 Arayüz

```
src/components/conversion/
  ConversionSources.tsx   # arşiv + harici + klasör kaynakları, seçim
  ConversionTarget.tsx    # hedef biçim ızgarası + seçenekler + çıktı yolu
  ConversionJobs.tsx      # iş listesi, satır ilerlemesi, sonuçlar
  PdfTools.tsx            # birleştir/ayır/sıkıştır/döndür/görsellerden PDF
  ConversionHistory.tsx   # kalıcı geçmiş
src/components/ConversionStudio.tsx
src/lib/conversion.ts     # biçim kataloğu, algılama, hedef matrisi, varsayılanlar
src/lib/conversion-run.ts # invoke + ilerleme aboneliği + iptal
src/lib/conversion-history.ts # DB kayıtları
```

- Tek sayfa kabuğu `PageSurface`; sekmeler `Tabs`; satırlar `settings-card` + hairline.
- Üç sütun: **Kaynaklar · Hedef · İşler**. `lg` altında tek kolona iner; dar pencerede
  kaynak listesi ve işler alt alta akar.
- Hedef ızgarası tür ailesine göre gruplanır; seçili hedef tek damga (systemBlue) taşır.
- İş satırı sabit sütunludur: durum ikonu · ad · ilerleme · yüzde · iptal. Sağ kenar kaymaz.
- Geçmiş sekmesi boşken öğretir; doluysa en son 50 kayıt.

## 6. Veri modeli

`migration 10`:

```sql
CREATE TABLE IF NOT EXISTS conversion_jobs (
  id TEXT PRIMARY KEY,
  input_path TEXT NOT NULL,
  output_paths_json TEXT NOT NULL DEFAULT '[]',
  target TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  status TEXT NOT NULL,              -- done | error | cancelled
  error_message TEXT,
  size_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversion_jobs_created ON conversion_jobs(created_at);
```

Geçmiş kaydı başarısız olursa dönüşüm sonucu geri alınmaz; kullanıcıya bilgi bildirimi
gösterilir (veri yazımı sessiz olamaz kuralı).

## 7. Durum sözlüğü

| Durum | Damga | Anlam |
|---|---|---|
| `queued` | `kuyrukta` | İş sırada, henüz başlamadı. |
| `running` | `dönüştürülüyor` | Motor çalışıyor; yüzde biliniyorsa akar. |
| `done` | `dönüştürüldü` | Çıktı üretildi. |
| `error` | `hata` | Hata metni satırda; "tekrar dene" var. |
| `cancelled` | `iptal` | Kullanıcı iptal etti; hata değil. |

## 8. Güvenlik ve dayanıklılık

- Komutlar argüman **dizisi** ile başlatılır (`Command::args`); kabuk dizesi kurulmaz.
- Bileşen indirmeleri sha256 + boyut kapısı + zip-slip/entry-cap ile mevcut motordan geçer;
  yeni `Msi` ve `TarGz` payload'ları aynı kapılara tabidir.
- MSI yönetici kurulumu geçici bir kardeş klasöre yapılır, doğrulanınca hedefe taşınır;
  yarım kurulum çalışan kurulumu bozmaz.
- PDF/Ofis dosyaları kullanıcı seçiminden gelir; dönüşüm çıktısı kaynağın yanına (ya da
  seçilen çıktı klasörüne) yazılır. `..` içeren çıktı yolları reddedilir.
- Bellek: PDF sayfaları tek tek işlenir; PPTX görselleri sırayla yazılır. Taranan dev PDF'lerde
  sayfa başına raster boyutu DPI ile sınırlanır (azami 4000 px genişlik).

## 9. Doğrulama planı

1. `cargo test` — sayfa aralığı, çıktı adı, biçim doğrulama, OOXML geçerliliği.
2. LibreOffice 26.8.3 yönetici çıkarma + `bootstrap.ini` yaması: `soffice --version`,
   HTML→DOCX, DOCX→PDF, XLSX→PDF, PPTX→PDF.
3. PDFium: PDF→PNG, PDF→metin, PDF→DOCX/XLSX/PPTX; üretilen DOCX/XLSX/PPTX tekrar
   LibreOffice ile PDF'e çevrilerek açılabilirlik doğrulanır.
4. ffmpeg: mp4→webm, mp4→mp3, wav→flac, video→GIF; süre/çözünürlük `ffprobe` ile okunur.
5. Görsel: png→jpg (alfa düzleştirme), png→webp, görseller→PDF (sayfa sayısı).
6. lodpf: iki PDF birleştir (sayfa sayısı toplamı), aralık ayır, döndür, sıkıştır.
7. `npm run check` + `npm run build` yeşil.
8. Bileşen yok senaryosu: `libreoffice`/`pdfium` silinmişken komut `BILESEN_EKSIK:` döner;
   arayüz kurulum diyaloğunu açar.

**Ölçülen sonuç (2026-11-14):** `npm run verify:conversion` 53/53 geçti. LibreOffice MSI
indirme + çıkarma + bootstrap yaması 53 sn sürdü; PDFium tar.gz 1 sn. PDFium binding'i süreç
genelinde TEK kez yükleniyor (`OnceLock<Pdfium>`), aksi hâlde ikinci PDF işi
`PdfiumLibraryBindingsAlreadyInitialized` veriyordu. İptal testi: 30 sn'lik MP4 → WebM işi
iptal edildi, `IPTAL` döndü ve yarım `.webm` dosyası silindi. UI üzerinden MP4 → MP3 işi
çalıştırıldı; geçmiş satırı yazıldı, arşiv kaydının `converted_path` alanı güncellendi,
test çıktısı ve geçmiş satırı temizlendi.

## 10. Alınan kararlar (oturum sırasında)

1. **Tek ekran, iki sekme:** Dönüştürücü ekranı büyütüldü; ikinci bir "dönüşüm" menüsü açılmadı
   (tek sözlük kuralı).
2. **LibreOffice zorunlu ama indirilebilir:** pakete gömülmez; ~359 MB olduğu için kullanıcı
   onayı ve ilerleme ile iner. Ofis→PDF ve ofis içi dönüşümler bu motoru ister.
3. **PDF→ofis metin tabanlıdır:** birebir düzen iddiası yok; arayüz bunu hedef açıklamasında
   yazar.
4. **PDF araçları ayrı sekmede:** dönüşüm matrisi ile birleştirme/ayırma aynı satırda
   karıştırılmaz.
5. **Geçmiş SQLite'ta:** localStorage değil; yedek/göç hattına dahil olur.
6. **Tek seferde tek ağır motor:** sıralı kuyruk; iptal her işin kendi çocuk sürecini öldürür.
7. **Aynı biçime dönüşüm serbest:** kalite düşürme ve ses ayırma senaryoları için.
8. **Yeni npm paketi yok:** arayüz mevcut primitiflerle kurulur.
