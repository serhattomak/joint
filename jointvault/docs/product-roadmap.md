# JointVault — Ürünleşme Yol Haritası

Tarih: 2026-09-20
Durum: Onaylandı (grilling oturumu çıktısı)
Kapsam kararı: **Dar çevre için gerçek ürün** (birkaç kişi kurup kullanacak). Ticari hedef yok.
Platform kararı: **Bugün Windows**; kod platform-bağımsız dikişlerle yazılır, macOS pipeline'ı yazılmaz.

---

## Bu belge nasıl okunur

- Her faz **tek bir çalışma oturumuna** sığacak kadar küçüktür. Büyük görünen fazlar bölünebilir; birleştirilemez.
- Her faz: **amaç → işler (dosyalar) → çıkış kriteri → kanıt → risk**.
- **Kanıt üretilmeyen faz kapanmaz.** Kanıt = `npm run check` yeşil çıktısı + faz için tanımlı doğrulama (test, senaryo veya önce/sonra ekran görüntüsü).
- Her faz kendi commit'ini alır. Faz sonunda `.tmp/tasks/` altına faz raporu yazılır (ne yapıldı, ne kanıtlandı, ne ertelendi).
- Faz sırası bağımlılıklara göre verilmiştir. **P0 fazları (2–10) kendi aralarında sıra değiştirmemelidir**; sonrası esnektir.

### Faz özeti

| Faz | Konu | Tip | Kanıt türü |
|-----|------|-----|-----------|
| 0 | Kapı ve ölçüm altyapısı | Altyapı | çıktı + baseline görseller |
| 1 | Tip güvenliği kapısı (`strict`) | Altyapı | `check` + sayı tablosu |
| 2 | **P0** İzinler: sessiz ölü düğmeler | Düzeltme | senaryo + assert |
| 3 | **P0** İndirme klasörü gerçeği | Düzeltme | gerçek indirme testi |
| 4 | **P0** Açılış dayanıklılığı | Düzeltme | hata enjeksiyonu |
| 5 | **P0** Göç + yedek + kurtarma | Altyapı | eski DB ile açılış |
| 6 | **P0** Transaction + indeksler | Borç | vitest + süre ölçümü |
| 7 | **P0** Bileşen Yöneticisi + ffmpeg indirme | Özellik | temiz profil senaryosu |
| 8 | **P0** Whisper paketleme + AI opt-in | Düzeltme + özellik | temiz profil + donanım |
| 9 | **P0** Güvenlik sertleştirme | Güvenlik | reddetme testleri |
| 10 | **P0** Transkript veri kaybı | Düzeltme | arama buluyor mu |
| 11 | Ölü ayarların silinmesi + `strings.ts` | Temizlik | `check` + sync çalışıyor |
| 12 | Eklenti kurulumu görünür olsun | Özellik | sıfırdan kurulum senaryosu |
| 13 | Durum ekranları + bildirim yaygınlaştırma | Cila | önce/sonra görsel |
| 14 | Çekirdek akış: arşiv | Özellik | senaryo |
| 15 | Klavye + erişilebilirlik | Cila | klavye-only tur |
| 16 | Görsel/deneyim cilası | Cila | önce/sonra görsel |
| 17 | İlk açılış deneyimi | Özellik | boş makine senaryosu |
| 18 | Paketleme ve dağıtım | Dağıtım | kurulum testi |
| B | Backlog (bilerek ertelenen) | — | — |

---

## Faz 0 — Kapı ve ölçüm altyapısı

**Neden ilk:** Bundan sonraki her fazın "bitti" tanımı bu fazın kurduğu kapıya dayanıyor. Bugün sıfır test, sıfır uzak kopya, sıfır ölçüm var.

**İşler**
- `vitest` devDependency olarak eklenir; `package.json`'a `test`, `typecheck`, `check` script'leri.
  - `npm run check` = `tsc --noEmit` + `oxlint` + `vitest run` (tek komut, yeşil/kırmızı).
- `dev/check-schema.mjs` mantığı vitest testine taşınır (`schema.sql`'in `initDb` splitter'ından geçmesi).
- `dev/verify-controls.mjs` ve `dev/shoot.mjs` `npm run evidence` altında standartlaştırılır; çıktı `dev/out/` (gitignore).
- `.oxlintrc.json` genişletilir: `no-empty`, `no-constant-condition`, `no-unused-vars` hata; `no-floating-promises` (varsa) ve `react-hooks/exhaustive-deps` **uyarı** olarak başlar (hata değil — mevcut borç yüzünden).
- Özel git remote açılır (`origin`), ilk push. LFS nesneleri dahil.
- **Baseline kanıtı**: tüm ekranların ekran görüntüsü (`npm run evidence`), `npm run check` çıktısı, mevcut `console.error` ve sessiz `catch` sayımı, ekran envanteri.

**Çıkış kriteri**
- `npm run check` tek komutla çalışıyor ve yeşil.
- Remote bağlı, LFS nesneleri push edilmiş.
- Baseline klasörü tam: her görünüm için görsel + ölçüm raporu.

**Kanıt:** `npm run check` çıktısı, baseline görselleri, ölçüm raporu (`.tmp/tasks/roadmap-00/`).

**Risk:** `tsc --noEmit` `strict` kapalıyken az şey yakalar — bu fazın sınırı bu; Faz 1 onu güçlendiriyor.

---

## Faz 1 — Tip güvenliği kapısı

**Neden:** `strict` **kapalı**. `null`/`undefined` ve örtük `any` proje genelinde denetlenmiyor. 0 gerçek `any` var ama 54 `as` ve 8 `!` var — yani tip sistemi bugün dekoratif.

**İşler**
- `tsconfig.app.json` + `tsconfig.node.json`: `strict: true` (+ `strictNullChecks`, `noImplicitAny`, `noFallthroughCasesInSwitch` korunur). `noUncheckedIndexedAccess` **şimdilik kapalı** (ayrı karar, gürültüsü yüksek).
- Ortaya çıkan hataların temizliği. Öncelik sırası:
  1. `JSON.parse(...) as X` olan üç yer (`health.ts:20`, `whisper.ts:36,100`) → çalışma zamanı doğrulaması (küçük guard fonksiyonları).
  2. `Sidebar.tsx:123` `entries.find(...) as NavEntry` → `undefined` durumu (gerçek hata üretir).
  3. Kalan `as` cast'lerinden yalnızca tip güvenliği kazandıranlar; meşru olanlar (`as const`) kalır.
  4. 8 `!` → guard veya erken çıkış.
- `oxlint` `no-floating-promises` **uyarıdan hataya** yükseltilir (Faz 0'da uyarıydı).

**Çıkış kriteri**
- `strict: true` ile `npm run check` yeşil.
- `no-floating-promises` hata seviyesinde.
- Faz raporunda önce/sonra sayı tablosu: `as`, `!`, sessiz `catch`, `console.error`.

**Kanıt:** `npm run check` çıktısı + sayı tablosu.

**Risk:** Tek oturuma sığmazsa faz bölünür: **1a** `strict` + `client.ts`/`lib/`, **1b** bileşenler.

---

## Faz 2 — P0: İzinler, yani sessiz ölü düğmeler

**Neden:** Kanıtlandı — `clipboard-manager:default` boş bir izin dizisi (`permissions: []`), `opener:default` ise `allow-open-path` içermiyor. Yani **pano izleme ölü**, **"anahtarı kopyala" ölü** ve **6 yerde "sistem oynatıcısında aç" ölü**. Hepsi sessiz: düğmeye basarsın, hiçbir şey olmaz.

**İşler**
- `src-tauri/capabilities/default.json`:
  - `clipboard-manager:allow-read-text`, `clipboard-manager:allow-write-text`
  - `opener:allow-open-path` (+ uygun scope)
- Çağrı yerlerinde hata görünür hale gelir (başarısızlık artık sessiz kalmaz):
  - `ClipboardWatcher.tsx:44` (okuma)
  - `SettingsView.tsx:171` (anahtar kopyalama)
  - `openPath`: `ItemViews.tsx:195`, `DownloadsView.tsx:567,798`, `MediaPlayerModal.tsx:107`, `ItemRecord.tsx:707`, `MediaPlayer.tsx:370`
- Yan iş: `void openPath(...)` çağrıları `catch`'lenir; dosya yoksa anlaşılır mesaj ("Dosya bulunamadı: …") verilir.

**Çıkış kriteri**
- Pano izleyici panodaki yeni URL'yi gerçekten yakalıyor.
- "Anahtarı kopyala" panoya yazıyor (yapıştırıp doğrulanır).
- 6 "sistemde aç" düğmesi dosyayı gerçekten açıyor; dosya yokken anlaşılır hata veriyor.

**Kanıt:** `npm run verify-controls` assertion'ları + elle senaryo listesi (düğme → beklenen sonuç → gözlenen).

**Risk:** `allow-open-path` scope'unu fazla dar verirsek meşru dosyalar reddedilir; fazla geniş verirsek Faz 9'un işini bozarız. Scope `vault` + indirme klasörü + dönüştürülen dosyalar dizinleriyle sınırlı tutulur.

---

## Faz 3 — P0: İndirme klasörü gerçeği

**Neden:** Ayarlar'daki "İndirme klasörü" yt-dlp indirmelerinde **hiç kullanılmıyor**. `download.rs:48-56` sabit `{Downloads}/JointVault` döndürüyor; dosyada `settings` import'u bile yok. Ayar; kullanıcıya yalan söylüyor.

**İşler**
- `download.rs`: yerel `download_dir()` kaldırılır, `settings::get_download_dir(app)` kullanılır (`download.rs:151`).
- Klasör seçimi tek kaynağa iner; `health.rs:58` ile çakışma biter.
- Ayarlar → İndirme: gerçek yol gösterilir + "klasörü aç" (`revealItemInDir`, izinli).
- Devam eden/kuyruktaki işler için davranış tanımlanır: klasör değişikliği **yeni** işlere uygulanır, mevcut işin hedefi `destination_path`'te sabittir (değişmez).
- Klasör oluşturulamaz/yazılamazsa `set_download_dir` daha önce hata verir — bu hata artık Ayarlar'da görünür.

**Çıkış kriteri**
- Ayarlar'dan özel klasör seçilir → indirilen dosya **gerçekten oraya** düşer.
- Varsayılana dönülür → dosya varsayılan klasöre düşer.
- Yazma izni olmayan klasör seçilirse anlaşılır hata görünür.

**Kanıt:** İki farklı klasörle yapılmış küçük bir gerçek indirme; dosya yollarının ekran görüntüsü + `ls` çıktısı.

**Risk:** Eski kayıtların `local_path`'i eski klasörde kalır — bu **doğru** davranış, ama kullanıcıya karışık görünebilir. Arşiv görünümünde dosya yolu gösterildiği için kabul edilebilir; gerekirse "konum taşındı" bilgisi sonraki fazda eklenir.

---

## Faz 4 — P0: Açılış dayanıklılığı

**Neden:** `client.ts:65-68` reddedilen promise'i cache'liyor: DB bir kez açılamazsa **oturum boyunca** her çağrı aynı hatayı alıyor. `App.tsx:130-132` `catch`siz, `ItemGrid.tsx:118-162` normal dalı try dışında → **sonsuz iskelet**. Hiç `ErrorBoundary` yok: bir render hatası tüm uygulamayı boşaltıyor.

**İşler**
- `client.ts`: başarısız init promise'i **cache'lenmez**; "yeniden dene" ile tekrar denenebilir; hata tipi ayrıştırılır (dosya kilitli / bozuk / yazılamaz / şema hatası).
- `ErrorBoundary` bileşeni: yakalar, "Bir şeyler ters gitti" + "Yeniden dene" + "Veri klasörünü aç" + hata detayı (katlanır).
- Başlatma hatası ekranı: uygulama boş kabuk yerine **ne olduğunu söyler**.
- `ItemGrid`, `App.tsx`, `AddItemDialog`, `ItemRecord`, `TagPicker`, `CaptureBar`, `StatsView`, `SettingsView` — floating promise'ler bağlanır (bu madde Faz 13 ile paylaşılır; burada yalnızca **başlatma yolundakiler** yapılır).
- `ItemGrid` yükleme hatası: iskelet yerine hata + "yeniden dene".

**Çıkış kriteri**
- DB dosyası okunamaz/kilitli hale getirildiğinde: anlaşılır hata ekranı çıkar, "yeniden dene" çalışır, sonsuz iskelet **yok**.
- Bir bileşen render'da patladığında uygulama boşalmaz; hata sınırı yakalar ve geri dönüş yolu verir.
- DB hatası düzeltildiğinde uygulama **yeniden başlatmadan** çalışır.

**Kanıt:** Hata enjeksiyonu senaryosu (DB dosyasını kilitle/boz → ekran görüntüsü → düzelt → kurtarma görüntüsü).

**Risk:** "Yeniden dene" sonsuz döngüye girmemeli — denemeler arası artan bekleme + kullanıcı tetiklemesi.

---

## Faz 5 — P0: Göç + yedek + kurtarma

**Neden:** Göç sistemi yok (`PRAGMA user_version` yok, sadece `CREATE TABLE IF NOT EXISTS` + elle iki `ALTER`). Şema yorumundaki `;` tuzağı yüzünden bir kez uygulama hiç kayıt gösterememiş (`client.ts:16-25`, commit `fa704bc`). Yedek yok, sıfırlama yok.

**İşler**
- `PRAGMA user_version` tabanlı sıralı göç sistemi: `src/lib/db/migrations/` altında numaralı, sıralı uygulanan göçler. `schema.sql` göç **0** olur.
- Mevcut iki `ALTER` (`local_path`/`download_status`/`download_error`, `converted_path`) numaralı göçlere dönüştürülür; `stripCommentLines` kırılganlığı göçler için ortadan kalkar.
- Yedek politikası:
  - Konum `app_data/backups/`, isim `jointvault-YYYYMMDD-HHmm.db`, **son 5 kopya** tutulur.
  - Ne zaman: (1) her şema göçünden hemen önce — **zorunlu**, (2) açılışta **günde en fazla 1**, (3) Ayarlar'da "şimdi yedekle".
- Ayarlar → Veri: "Yedekten geri dön" (liste + boyut + tarih), "Veritabanını sıfırla" (yazılı onay ister, sıfırlamadan önce yedek alır).
- `PRAGMA foreign_keys = ON`'un her bağlantıda uygulandığı doğrulanır (plugin-sql havuz kullanıyorsa sessizce kapalı olabilir). Değilse her sorgu öncesi garanti altına alınır.

**Çıkış kriteri**
- Bilerek eski `user_version`'da bırakılmış bir DB ile açılış: göç uygulanır, veri korunur, yedek alınır.
- Bozuk bir DB ile açılış: sıfırlama/geri dönme yolu çalışır.
- Yedek listesi doğru tarih/boyut gösterir; geri dönme sonrası veri gerçekten eski haldedir.

**Kanıt:** Eski şemalı DB dosyası ile açılış testi + geri dönme testi + `user_version` önce/sonra çıktısı.

**Risk:** Göç sırası hatası veri kaybettirir → göç öncesi zorunlu yedek tam da bunun için. Göçler **yalnızca ileri** yönde; geri alma yedekten yapılır.

**Bağımlılık:** Faz 6'daki indeks eklemeleri şema değişikliğidir → bu faz onlardan **önce** gelir.

---

## Faz 6 — P0: Transaction ve indeksler

**Neden:** Repoda **tek bir SQL transaction yok**. `setTagsForItem` etiket başına ayrı `INSERT`, `importVault` satır başına ayrı `INSERT` ve atomik değil — yarıda kalırsa veri yarım kalır. `updated_at`, `download_status`, `favorite` indekssiz.

**İşler**
- `client.ts`: yazma yolları transaction'a alınır (`setTagsForItem`, `setCategoriesForItem`, `importVault`, toplu taşıma/etiketleme, silme akışları).
- `importVault`: tek transaction + hazırlıklı ifade (`prepare`) kullanımı.
- İndeksler (`schema.sql` + yeni göç): `items(updated_at)`, `items(download_status)`, `items(favorite)`.
- `listItems()`'ın sınırsız kullanıldığı yerler gözden geçirilir: yalnızca gerçekten tamamı gereken yerlerde kalır (`getAllChunksWithEmbeddings`, `StatsView`, `runOrganizeUncategorized`) — bunlar bu fazda **filtrelenir veya sayfalanır**.
- `SettingsView.runOrganizeUncategorized` N+1 döngüsü (2 IPC/öğe) tek sorguya indirilir.

**Çıkış kriteri**
- Yarım kalan bir ithalat sonrası DB'de yarım kayıt **yok** (transaction testi).
- Yeni indeksler `EXPLAIN QUERY PLAN`'da kullanılıyor.
- `dev/bench-items-query.mjs` medyan süresi önce/sonra karşılaştırılır.
- Yeni davranış vitest ile korunur (transaction geri alma testi).

**Kanıt:** vitest çıktısı + `EXPLAIN` önce/sonra + süre ölçümü.

**Risk:** Transaction'a alırken `plugin-sql` API'sinin transaction semantiği doğrulanmalı; tek bağlantı varsayımı yanlışsa `BEGIN/COMMIT` beklenmedik davranır → doğrulama bu fazın ilk işi.

---

## Faz 7 — P0: Bileşen Yöneticisi + ffmpeg/ffprobe indirme

**Neden:** ffmpeg hem indirmenin hem 6 medya aracının önkoşulu, ama bugün repoda **156 MB + 156 MB** olarak gömülü; kurulum ~330 MB olur. Ayrıca her özellik kendi indiricisini kurmuş durumda (whisper'ın var, AI'nın var, ffmpeg'in yok).

**İşler**
- **Bileşenler ekranı** (Ayarlar içinde yeni sekme): her bileşen için durum (kurulu / eksik / eski), boyut, sürüm, `indir / iptal et / onar / kaldır`.
  - Bileşenler: `ffmpeg+ffprobe`, `yt-dlp`, `whisper motoru`, `whisper modeli` (tiny/base/small), `llama-server (+CUDA)`, `LLM/embedding modelleri`.
  - Tek indirme kuyruğu, tek ilerleme altyapısı, tek `sha256` doğrulama, iptal edilebilir, çevrimdışıyken net hata.
- **Eksik bileşen durumu uygulama genelinde**: ffmpeg yokken Dönüştürücü / Kırpma / GIF / Sessizlik / Birleştirme / Altyazı / İndirme ekranları **çağrıldığında** kurulum akışını açar; sessiz başarısızlık yok.
- ffmpeg + ffprobe ilk kullanımda indirilir; **yt-dlp gömülü kalır** (17 MB).
- **Repo temizliği (bu fazın sonunda)**: ffmpeg/ffprobe LFS'ten ve repodan çıkarılır → repo ~19 MB. LFS geçmişi ayrıca temizlenir.

**Çıkış kriteri**
- Temiz profil: bileşen yok → Dönüştürücü açılır → kurulum akışı çıkar → indir (iptal edilebilir) → araç çalışır.
- İndirme sırasında iptal → yarım dosya kalmaz, tekrar denenebilir.
- Çevrimdışı → anlaşılır hata, uygulama çökmüyor.
- `sha256` uyuşmazlığı simüle edilirse kurulum reddedilir.
- Repo boyutu ~19 MB, `git clone` sonrası ffmpeg repoda yok.

**Kanıt:** Temiz profil senaryo kaydı/görselleri + `git count-objects -vH` önce/sonra.

**Risk:** İndirme kaynağı (nereye, hangi URL, hangi sürüm) sabitlenmeli ve **projede tanımlı** olmalı; dış kaynak kaybolursa sürüm pin'i sayesinde en azından ne indirildiği bilinir. Kaynak yedekleme (ayna) bu fazın kapsamı dışında, not olarak kalır.

---

## Faz 8 — P0: Whisper paketleme + AI opt-in

**Neden:** `bundle.resources` **hiç yok** → `whisper.dll`/`ggml*.dll` pakete girmiyor, prod'da `0xC0000135` ile çöküyor (kendi belgesi `docs/media-tools-deferred.md:38` söylüyor). Ayrıca arayüzde **sabit kodlu "RTX 5070 Ti (16 GB GDDR7)"** yazıyor (`SettingsView.tsx:577,724`, `AiAssistantView.tsx:184`, `ai.rs:306,404`) — başka makinede yalan.

**İşler**
- Whisper DLL sorunu Faz 7'nin bileşen yöneticisine bağlanır: ya `bundle.resources` ile gelir ya da motor indirmesi tek yol olur — **iki ayrı yol kalmaz**.
- AI **varsayılan kapalı** gelir; Ayarlar → AI'da açık rıza akışı ("Yerel AI'yı etkinleştir"), ne indirileceği ve kaç GB olacağı önceden gösterilir.
- Sabit donanım metinleri kaldırılır; gerçek donanım tespiti (GPU adı/bellek, tespit edilemezse "bilinmiyor").
- CUDA/model indirmeleri Faz 7 kuyruğuna taşınır (iptal edilebilir, ilerlemeli, disk alanı kontrolü önce).
- AI kapalıyken: asistan görünümü ve semantik arama "AI kapalı — Ayarlar'dan aç" durumunu dürüstçe gösterir; ölü düğme yok.

**Çıkış kriteri**
- Temiz kurulumda AI kapalı gelir ve hiçbir şey indirilmez.
- Farklı donanımda (GPU'suz dahil) doğru metin görünür; sabit "5070 Ti" hiçbir yerde kalmaz (grep ile kanıt).
- Paketlenmiş kurulumda whisper motoru indirilip transkripsiyon çalışır (`0xC0000135` yok).
- Disk alanı yetersizse indirme başlamadan uyarır.

**Kanıt:** Temiz profil senaryosu + sabit metin grep'i + paketlenmiş kurulumda transkripsiyon.

**Risk:** AI + whisper aynı fazda büyük olabilir → bölünürse **8a** whisper paketleme, **8b** AI opt-in.

---

## Faz 9 — P0: Güvenlik sertleştirme

**Neden:** `csp: null`, `assetProtocol: ["**"]`, renderer'a açık `write_text_file` / `delete_file` / `sql:allow-execute`. Köprüde (`127.0.0.1:48120`) `Origin` kontrolü yok, token karşılaştırması düz `==`. Cookie'ler ve eşleşme anahtarı **diskte düz metin**. Uygulama dış ağdan içerik çekiyor → saldırı yüzeyi gerçek.

**İşler**
- CSP açılır (Tauri'ye uygun, kazıma/AI görsellerini kırmayacak şekilde), `assetProtocol` scope'u arşiv/kapak/dönüştürme/indirme kökleriyle sınırlanır.
- Köprüde `Origin`/`Host` kontrolü; token karşılaştırması **sabit zamanlı**.
- `write_text_file` / `delete_file` **izinli köklerle** sınırlanır (app_data, vault, seçili indirme klasörü, kullanıcı seçtiği dışa aktarma yolu).
- yt-dlp/ffmpeg çağrılarında argüman enjeksiyonuna karşı guard (`--` ayırıcı; baştaki `-` ile başlayan URL reddi).
- `sync_clear_cookies_file` gerçekten silinip silinmediğini raporlar (`sync.rs:301-308` bugün koşulsuz `Ok(true)`).
- AI sunucusuna yerel erişim anahtarı **bu fazın kapsamı dışı** (not olarak backlog).

**Çıkış kriteri**
- Tarayıcıdan `127.0.0.1:48120`'ye yapılan istek reddedilir (kanıt: tarayıcı konsolu / curl).
- İzinli kök dışına dosya yazma/silme denemesi reddedilir.
- `-` ile başlayan girdi yt-dlp'ye argüman olarak geçmez.
- Uygulama tüm normal akışlarında (kaydet, indir, araç, okuyucu) çalışmaya devam eder.

**Kanıt:** Reddetme testleri (çıktılarıyla) + tüm ekranların duman turu görselleri.

**Risk:** CSP yanlış yazılırsa görseller/kapaklar kırılır → CSP önce rapor-only değil ama dar başlar, ekran turuyla doğrulanır.

---

## Faz 10 — P0: Transkript veri kaybı

**Neden:** `preview_media_read_text` komutu **yok** ama `ai.ts:340,445` onu çağırıyor gibi davranıyor → yeniden indeksleme ve AI kategorilendirmede transkriptler **sessizce** kaybediliyor. Ayrıca transkript arşive bağlanmıyor (yalnızca önizleme).

**İşler**
- Eksik okuma yolu tamamlanır (yeni komut ya da mevcut bir komuta SRT okuma parametresi).
- Transkript, mevcut `item_chunks` tablosuna `chunk_type = 'transcript'` ile yazılır (şema değişikliği **gerekmiyor** — tablo zaten var ve FTS'e bağlı).
- `SubtitleTool` transkripti arşive bağlar; "arşive yazılmaz" notu kaldırılır.
- Hata yolu: transkript okunamazsa **sessizce yutulmaz**, bildirim çıkar ve işlem "kısmi başarılı" olarak raporlanır.
- Not: `.srt`'yi `converted_path` yapmak oynatıcıyı bozar (`media-tools-deferred.md:55-56`) → transkript ayrı yaşar, `converted_path`'e dokunulmaz.

**Çıkış kriteri**
- Transkript üretilir → yeniden indeksleme çalıştırılır → transkriptteki bir kelime aramada **bulunur**.
- AI kategorilendirme transkripte dayalı sonuç üretebiliyor.
- Transkript okunamadığında kullanıcı bunu görüyor.

**Kanıt:** Uçtan uca senaryo (video → transkript → indeks → arama sonucu ekran görüntüsü).

**Risk:** Whisper'a bağımlı (Faz 8). Faz 8 bitmeden tam kanıt üretilemez → küçük bir test SRT dosyasıyla da doğrulanabilir (kanıt yolu ikili).

---

## Faz 11 — Ölü ayarların silinmesi + `strings.ts`

**Neden:** Beş alan sıfır işlev taşıyor: `x_browser`, `instagram_browser`, `instagram_url` (okunuyor, hiç yazılmıyor; eklenti yolu bunları gereksiz kıldı), `auto_sync_interval_hours` (ne zamanlayıcı ne okuyucu — **tamamen ölü**), `external_api_url` (hiçbir istek oraya gitmiyor).

**İşler**
- Rust: `sync.rs` config struct'ı, `ai.rs` `AiConfig` + `ai_status`/`ai_save_config`; TS tipleri; `SyncView.tsx:184`'teki tek okuma; varsa Ayarlar alanları.
- Mevcut `sync_config.json` / `jointvault-ai-config.json` dosyalarında bu alanlar kalırsa **sessizce yok sayılır** (ileri uyumlu okuma).
- `strings.ts`: sabit Türkçe metinler tek modülde toplanmaya başlar — bu fazda **Ayarlar + bildirimler + hata mesajları**. Kalan ekranlar sonraki fazlarda taşınır (`strings/` klasörü, ekran başına dosya).
- X/IG ölü **görünen** koda dokunulmaz: `sync.rs`'teki `platform == "x"` erken çıkışları kasıtlıdır, yorumla açıkça işaretlenir ("bu yol eklenti tarafından yönetiliyor, diriltmeye çalışma").

**Çıkış kriteri**
- Beş alan koddan tamamen kalkar (grep ile kanıt: hiçbir yerde geçmiyor).
- X/IG içe aktarma **hâlâ çalışıyor** (regresyon yok).
- AI ve sync ayarları bozulmadan okunuyor/yazılıyor.
- `npm run check` yeşil.

**Kanıt:** grep çıktıları + X/IG aktarma senaryosu + AI ayar kaydetme testi.

**Risk:** `sync_get_config` bugün bozuk JSON'da sessizce varsayılana dönüyor (`sync.rs:74`) → bu davranış korunur ama artık **uyarı** verir (Faz 13 ile birlikte).

---

## Faz 12 — Eklenti kurulumu görünür olsun

**Neden:** X/IG içe aktarmanın **tek yolu** eklenti, yerel yedek yol kasıtlı kapalı. Ama eklenti `bundle` kaynaklarına girmiyor: kullanıcı `extension/` klasörünü elle yüklemeli. Bunu bilmeyen için özellik **yok hükmünde**.

**İşler**
- `extension/` klasörü `bundle.resources` olarak pakete girer.
- Ayarlar → Eklenti: 
  - adım adım rehber (1. klasörü aç → 2. `chrome://extensions` → 3. Geliştirici modu → 4. Paketlenmemiş yükle),
  - "eklenti klasörünü aç" düğmesi (`revealItemInDir`, Faz 2 ile çalışıyor),
  - anahtarı kopyala (Faz 2 ile çalışıyor),
  - **bağlantı durumu**: "son temas: 3 dk önce" + "bekleniyor" göstergesi (köprü son isteğinin zaman damgası).
- Eklenti bağlanmadıysa içe aktarma ekranı "eklenti bağlı değil — kurulum rehberi" der, boş liste göstermez.

**Çıkış kriteri**
- Temiz kurulumdan itibaren rehberi takip eden biri X yer işaretlerini aktarabilir (senaryo olarak kaydedilir).
- Eklenti kurulmadan içe aktarma ekranı ne yapılacağını söylüyor.
- Bağlantı durumu göstergesi gerçeği yansıtıyor.

**Kanıt:** Sıfırdan kurulum senaryosu (adım görselleri) + bağlantı göstergesi doğrulaması.

**Risk:** Chrome tarafında "paketlenmemiş yükleme" kullanıcı için hâlâ teknik bir adım; rehber olabildiğince görsel olmalı. Chrome Web Store bilerek ertelendi (ticari hedef yok, mağaza bakımı taahhüt istiyor).

---

## Faz 13 — Durum ekranları + bildirim yaygınlaştırma

**Neden:** Tek bildirim kanalı `NoticeProvider` var ama neredeyse hiç kullanılmıyor: 31 `console.error` (kullanıcı görmüyor), ~35 sessiz `catch`, `SyncView`'da 6 `alert()`. `StatsView` yüklenirken "Veri yok." diyor — boş arşivden ayırt edilemiyor.

**İşler**
- `StatsView`, `DownloadsView`, `CollectionsView`, `AiAssistantView`: yükleniyor / boş / hata (+ "yeniden dene") durumları.
- `SyncView`'daki 6 `alert()` (`:141,143,178,186,222,232`) → `Notice` sistemi.
- Sessiz `catch`'ler gözden geçirilir: her biri ya bilinçli sessiz (yorumla gerekçelenir) ya kullanıcıya bildirilir. Kural: **veri yazma yolları asla sessiz olamaz.**
- Kalan floating promise'ler bağlanır (`App.tsx:451`, `AddItemDialog.tsx:76-79`, `ItemRecord.tsx:145-148`, `StatsView.tsx:70-86`, `TagPicker.tsx:19`, `SettingsView.tsx:133`, `SubtitleTool.tsx:92`, `CaptureBar.tsx:69,83`).
- Bozuk ayar dosyaları (`sync_config.json`, AI config) artık **uyarı** verir, sessizce sıfırlanmaz.
- Ayarlar'a **"varsayılana dön"** eklenir (localStorage ayarları: tema, görünüm, sıralama, sayfa boyu, kalite, whisper modeli, pano izleme).

**Çıkış kriteri**
- Hiçbir ekran "yükleniyor"u "boş" gibi göstermiyor.
- Hiçbir ekranda ham `alert()` kalmadı (grep).
- Yazma hatası olan bir senaryoda kullanıcı görünür bildirim alıyor.
- "Varsayılana dön" tüm localStorage ayarlarını sıfırlıyor.

**Kanıt:** Önce/sonra görseller + grep çıktıları + hata enjeksiyonu senaryosu.

**Risk:** Kapsam kayması — bu faz "her ekranı elden geçir"e dönüşebilir. Sınır: yalnızca **durum** ve **hata yüzeyi**; görsel tasarım Faz 16.

---

## Faz 14 — Çekirdek akış: arşiv

**Neden:** Arşiv çekirdeğin kalbi; burada dört yarım iş var.

**İşler**
1. **Toplu içe aktarmada taksonomi**: `BulkImportDialog` kaydetmeden önce koleksiyon / etiket / kategori atayabilsin; mevcut kayıtlara da uygulanabilsin.
2. **Komut paletinden kaydı açma**: `CommandPalette.tsx:88-92` yalnızca dışarı açıyor → uygulama içinde öğe kaydı / okuyucu açılsın.
3. **Silme semantiği**: silme diyaloğunda "indirilen dosyayı da sil" onay kutusu — **varsayılan kapalı**, dosya adı ve boyutu gösterilir; toplu silmede de sorulur. Yetim dosya temizliği bu kuralla çalışır (yalnızca indirme kökü altındaki dosyalar).
4. **Turbo kuyruğu**: kuyrukta bekleyen işler için "hepsini başlat" + kuyruk kalıcılığı (yeniden başlatınca kaybolmasın). Otomatik zamanlayıcı **yok** (ürün kararı: kullanıcı tetikler).

**Çıkış kriteri**
- 20 link toplu aktarılır, tek seferde koleksiyon+etiket+kategori atanır, doğru kaydedilir.
- Paletten bir kayıt uygulama içinde açılır.
- Öğe silinirken kutu işaretlenmezse dosya kalır; işaretlenirse dosya silinir ve bu diskte doğrulanır.
- Kuyruktaki işler uygulama yeniden başlatılınca durur, "hepsini başlat" ile devam eder.

**Kanıt:** Dört senaryonun adım adım kaydı + disk/kütüphane karşılaştırması.

**Risk:** Toplu silme + dosya silme birleşimi en tehlikeli akış → yazılı onay + önce/sonra dosya sayısı gösterimi.

---

## Faz 15 — Klavye ve erişilebilirlik temelleri

**Neden:** Ctrl+K dışında global kısayol yok; sekmeler `<button>` yığını (rol/`aria-selected` yok), palet listbox değil (ok tuşu seçimi ekran okuyucuya duyurulmuyor), tıklanabilir `<div>`'ler var, `<nav>` etiketsiz.

**İşler**
- Global kısayollar: `Ctrl+N` yeni öğe, `/` veya `Ctrl+F` aramaya odaklan, `Ctrl+,` ayarlar, `Esc` görünümden çık, `Ctrl+1..9` görünüm değiştir. Kısayol listesi `WelcomeDialog`'da güncellenir.
- Sekme semantiği (`role="tablist"/"tab"`, `aria-selected`, ok tuşu gezinme): Ayarlar, İndirmeler durum/kategori çipleri, Koleksiyonlar sekmeleri.
- Komut paleti listbox semantiği (`role="listbox"`, `aria-activedescendant`).
- Tıklanabilir `<div>`'ler `button` veya `role` + `tabIndex` + klavye; `DownloadsView:1001-1018,1021-1040,1097-1114`.
- `<nav>` etiketi + "içeriğe geç" bağlantısı; odak yönetimi (`ItemRecord` açılış/kapanış odak dönüşü).
- Kontrast denetimi (koyu tema dahil).

**Çıkış kriteri**
- Fareye dokunmadan yapılabilecek bir tur: öğe ekle → ara → aç → düzenle → sil.
- Ekran okuyucu (Windows Anlatıcı) sekme ve palet seçimlerini duyuyor.
- Klavye tuzağı yok; `Esc` her yerde çalışıyor.

**Kanıt:** Klavye-only tur kaydı + erişilebilirlik denetimi çıktısı.

**Risk:** Yeni kısayollar mevcut metin girişleriyle çakışabilir → yalnızca girdi alanı odaklı değilken tetiklenir.

---

## Faz 16 — Görsel/deneyim cilası

**Neden:** Mevcut "kağıt/arşiv" dili karakterli, jenerik değil — korunacak. Eksik olan **durum cilası** ve içerik yoğunluğunun görselleştirilmesi.

**İşler**
- Mevcut dilin güçlendirilmesi: tipografi ölçeği, boşluk ritmi, kart/kapak oranları, `skeleton-paper` tutarlılığı (her ekranda aynı desen).
- Geçişler: görünüm geçişleri, diyalog açılış/kapanış, liste öğesi ekleme/çıkarma (kısa, 150–250 ms; `prefers-reduced-motion` desteklenir).
- Mikro etkileşimler: kaydetme onayı, kopyalama geri bildirimi, indirme durum geçişleri.
- Medya araçlarında ilerleme/iptal görünümü standardı (Faz 7 kuyruğuyla aynı dil).
- Uzun listelerde okunabilirlik (kart yoğunluğu, satır yüksekliği) — sanallaştırma **bu fazın işi değil** (backlog).
- Karanlık/aydınlık tema tutarlılık turu.

**Çıkış kriteri**
- Her ekranın önce/sonra görseli; "yarım görünen" ekran kalmadı.
- `prefers-reduced-motion` açıkken animasyonlar kapanıyor.
- Tema geçişi hiçbir ekranda bozuk renk bırakmıyor.

**Kanıt:** Tam ekran turu önce/sonra görselleri.

**Risk:** "Zevk işi" sonsuza gider → sınır: yeni özellik yok, yalnızca var olanın cilası; her ekran için en fazla bir tur.

---

## Faz 17 — İlk açılış deneyimi

**Neden:** Kurulum sonrası ilk açılış, "ürün" olup olmadığının kararı. Bugünkü sihirbaz yalnızca araç sağlığını kontrol ediyor; ffmpeg zorunlu bağımlılığı, eklenti kurulumu ve ilk kayıt akışı yok.

**İşler**
- Yenilenen sihirbaz adımları:
  1. Hoş geldin + ne yapar (30 sn, atlanabilir).
  2. **Zorunlu bileşen**: ffmpeg+ffprobe indirme (ilerleme, iptal, disk kontrolü).
  3. **İndirme klasörü** seçimi (gerçek yol gösterilir — Faz 3 sayesinde yalan söylemiyor).
  4. **Opsiyonel**: whisper + AI (net "şimdi değil" seçeneği, boyut bilgisiyle).
  5. **Tarayıcı eklentisi** rehberi (Faz 12) — "şimdi" veya "sonra".
  6. **İlk kaydın**: tek link yapıştır → arşive düşsün (boş ekranla başlamak yerine).
- Kurulum tamamlanmadan hiçbir ekran "ölü" görünmez: bileşen yoksa her özellik kurulum akışına yönlendirir.
- `WelcomeDialog` (özellik turu) yeni kısayollarla ve yeni bileşen akışıyla güncellenir.

**Çıkış kriteri**
- Boş makinede kurulumdan sonra hiçbir yere tıklamadan sihirbaz çıkar.
- Sihirbaz bitince: ffmpeg kurulu, klasör seçili, en az bir kayıt arşivde.
- Sihirbaz atlanırsa uygulama yine çalışır ve eksikleri açıkça söyler.

**Kanıt:** Boş profil/VM senaryosu, adım adım görseller.

**Risk:** Zorunlu indirme adımı kullanıcıyı kaçırabilir → iptal edilebilir olmalı ve atlanırsa uygulama "eksik bileşen" modunda tamamen çalışmaya devam etmeli.

---

## Faz 18 — Paketleme ve dağıtım

**Neden:** `targets: "all"` macOS'ta kırık artefakt üretiyor; sürüm üç yerde farklı (`package.json` `0.0.0`, `Cargo.toml` `0.1.0`, `tauri.conf.json` `0.1.0`); installer'ın nasıl dağıtılacağı tanımsız.

**İşler**
- `bundle.targets`: yalnızca Windows (`nsis` + `msi`).
- **Tek sürüm kaynağı**: `package.json` → build sırasında `tauri.conf.json` ve `Cargo.toml`'a aktarılır (script ile); üç yerde farklı sürüm imkânsız hale gelir.
- NSIS installer + **taşınabilir ZIP** üretimi; ikisi de aynı build'den.
- `bundle.resources`: eklenti klasörü (Faz 12) + whisper DLL'leri (Faz 8).
- `Cargo.toml` metadata'sı düzeltilir (açıklama, yazarlar, lisans alanı).
- Ayarlar → Hakkında: sürüm, veri klasörünü aç, yedek klasörünü aç, teşhis raporunu kopyala.
- Kısa kurulum notu (`docs/kurulum.md`): akıllı ekran uyarısı, veri konumu, kaldırma, yedek.

**Çıkış kriteri**
- `npx tauri build` → NSIS + ZIP çıkar; ikisi de temiz makinede kurulup açılır.
- Kurulum sonrası sihirbaz (Faz 17) doğru çalışır, whisper `0xC0000135` vermez.
- Sürüm tek yerde değiştirilir, üç yerde tutarlı görünür.

**Kanıt:** Temiz makinede kurulum senaryosu + sürüm tutarlılık çıktısı.

**Risk:** İmzasız kurulum Windows'ta uyarı verir → kurulum notunda açıklanır (kod imzalama bilinçli olarak kapsam dışı).

---

## Backlog — bilerek ertelenenler

Bunlar **unutulmadı, karar verildi**: şimdi yapılmıyor.

| Konu | Neden ertelendi |
|---|---|
| `items` için FTS5 + toplu yazma + sanallaştırma + polling azaltma (pano 2.5 sn tam-tablo dedupe, Sidebar 10 sn) / embedding kosinüsünün gözden geçirilmesi | Gerçek veri ölçeği sorun olana kadar gereksiz; Faz 6'daki indeksler acil kısmı çözüyor |
| Geri dönüşüm kutusu (`vault/_cop/`, 30 gün) | Faz 14'teki onay kutusu ilk tur için dürüst çözüm; tam yaşam döngüsü ayrı iş |
| Cookie/anahtar şifrelemesi (Windows DPAPI) | Faz 9'daki izin/kök kısıtlamaları acil riski kapatıyor |
| Küçültülmüş ffmpeg derlemesi (statik, ~40-60 MB) | Faz 7 indirme akışı sorunu çözüyor; küçültme build zincirine yeni iş |
| Gerçek Tauri penceresinde WebDriver E2E (tauri-driver) | Faz 0'ın kanıt katmanı yeterli; Windows'ta kurulum/bakım yükü |
| "Arka plan davranışı" fazı: iş bitince bildirim, sıraya koyma, kapatma davranışı tutarlılığı | Kendi başına bir tasarım turu hak ediyor |
| Chrome Web Store yayını | Mağaza bakımı sürekli taahhüt; ticari hedef yok |
| Kazıma/okuyucu kalitesi (DOM kütüphanesi, JS ağırlıklı siteler) | Bağımsız bir kalite projesi; mevcut hali "çalışıyor ama kırılgan" |
| AI sunucusuna yerel erişim anahtarı + SSRF koruması | Faz 9 sonrası risk düşük; uygulama yerel |
| GitHub Actions CI | Tek geliştirici + yerel kapı yeterli; remote açıldığında değerlendirilir |

---

## Yol haritası yazılırken alınan küçük kararlar

Bunlar grilling oturumunda sorulmadı; **sessizce varsayılmasın** diye açıkça yazıldı. İtirazın varsa değiştiririz.

1. **Sürümün tek kaynağı `package.json`** olur (Faz 18'de build script'i dağıtır). `tauri.conf.json` sürümü elle düzenlenmez.
2. **`noUncheckedIndexedAccess` şimdilik kapalı** (Faz 1). Gürültüsü yüksek, faydası `strict`'ten sonra ölçülür.
3. **`oxlint` yeni kuralları uyarı olarak başlar**, Faz 1'de `no-floating-promises` hata seviyesine çıkar.
4. **Yedek dosya adı** `jointvault-YYYYMMDD-HHmm.db`, klasör `app_data/backups/`, 5 kopya (Faz 5).
5. **Silme yalnızca indirme kökü altındaki dosyalara** dokunur (Faz 14) — arşiv klasörünün tamamında gezinmez.
6. **"Varsayılana dön"** (Faz 13) yalnızca localStorage ayarlarını sıfırlar; veriyi, indirme klasörünü ve eşleşme anahtarını **silmez**.
7. **Whisper için tek yol** kalır (Faz 8): ya pakete gömülür ya indirilir — iki ayrı kurulum hikâyesi bakılmaz.
8. **Zorunlu bileşen yalnızca ffmpeg/ffprobe**'dur; whisper, AI, LLM, modeller **hepsi opsiyoneldir** (Faz 7/17).
9. **X/IG için yerel tarayıcı kodu diriltilmez** (Faz 11) — eklenti yolu kalıcı mimaridir.
10. **Faz 9'da CSP dar başlar** ve tam ekran duman turuyla doğrulanır; "sonra gevşetiriz" yok.

---

## Ölçüm: "bitti" nasıl anlaşılır

Ürün hedefi: **bir arkadaşın kurup, kimseye sormadan kullanabildiği uygulama.**

Kapanış kontrol listesi (tüm fazlar sonrası):
- [ ] Temiz makinede kurulum → sihirbaz → ffmpeg kurulu → ilk kayıt arşivde
- [ ] X/IG içe aktarma rehberle çalışıyor
- [ ] İndirme, seçilen klasöre gerçekten iniyor, ilerleme ve iptal çalışıyor
- [ ] Pano izleme, kopyalama, "sistemde aç", "klasörde göster" çalışıyor
- [ ] Hiçbir özellik sessizce başarısız olmuyor (çağrıldığında ya çalışır ya açıkça söyler)
- [ ] DB bozulursa yedekten dönme çalışıyor
- [ ] AI/whisper kapalı geliyor; açmak isteyen net akışla açabiliyor
- [ ] Klavye ile temel tur yapılabiliyor
- [ ] Her ekranın yükleniyor/boş/hata durumu var
- [ ] `npm run check` yeşil; `npm run evidence` tüm ekranları üretiyor
