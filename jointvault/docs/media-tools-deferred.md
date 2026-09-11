# Ertelenen İşler — Medya Araçları Paketi (A9)

Tarih: 2026-09-12 · Oturum: `.tmp/sessions/2026-09-12-media-tools-package/context.md`
Durum: 01–06 tamamlandı, bu dosyadaki maddeler BİLİNÇLİ olarak sonraya bırakıldı. Kod değişikliği YOK, sadece yol haritası.

## 1. whisper binary temini (ÇÖZÜLDÜ — uygulama-içi indirme)

**Durum (güncel):** `download_whisper_engine` komutu eklendi — Ayarlar → Konuşma sekmesindeki
"Motoru indir (~4MB)" butonu v1.7.6 `whisper-bin-x64.zip`'i indirip sha256 doğrulayıp
`whisper-cli.exe`'yi sidecar konumuna çıkarıyor ve `--help` probuyla doğruluyor
(NOT: güncel v1.9.4 release'inin eki YOK, bu yüzden v1.7.6'ya sabitlendi).
`tauri.conf.json` → `externalBin` satırı hâlâ YOK (bilerek — dosya repoda yokken build patlıyor);
motor çalışma zamanında indiriliyor.

**Otomatik (onerilen):** Ayarlar → Konusma → "Motoru indir" — exe+DLL'leri exe yanina (aninda kullanim: dev'de target/debug) ve `src-tauri/binaries/`'e (bundling) yazar, `--help` probuyla dogrular. NOT: sidecar() her zaman exe yanina bakar; `src-tauri/binaries/` sadece build kopyasidir.

**Manuel yedek yol (otomatik indirme başarısız olursa):**
1. whisper.cpp release'inden `whisper-cli` edin (seçenekler: GitHub Releases'tan indir
   `https://github.com/ggml-org/whisper.cpp/releases`, ya da `cmake -B build && cmake --build
   build -j --config Release` ile derle — `./build/bin/whisper-cli`).
2. Dosyayı `jointvault/src-tauri/binaries/whisper-x86_64-pc-windows-msvc.exe` olarak koy
   (mevcut `ffmpeg-…`, `yt-dlp-…` ile aynı adlandırma kuralı).
3. `tauri.conf.json` → `bundle.externalBin` listesine `"binaries/whisper"` satırını geri ekle.
4. Doğrula: `cd jointvault/src-tauri; cargo check` (exit=0) + `npx tauri dev` ile Ayarlar → Konuşma
   sekmesinden model indirip transkript üret.
5. Ek platformlar (ileride): her triple için ayrı binary + aynı klasöre koyma yeterli, kod değişmez.

## 2. Tek-tık installer + otomatik güncelleme (A9-a)

**Ne:** `tauri-plugin-updater` entegrasyonu + imzalı MSI/NSIS çıktısı + sürüm kontrol endpoint'i.
**Neden sonra:** Dağıtım altyapısı (imzalama sertifikası, update sunucusu, CI) gerektirir; tek oturumluk iş değil.
**Önkoşullar:**
- `tauri-plugin-updater` crate + npm paketi ekleme, `capabilities/default.json`'a updater izni.
- Windows code-signing sertifikası + `TAURI_SIGNING_PRIVATE_KEY` CI secret'ı.
- Güncelleme manifestosu sunan statik endpoint (örn. GitHub Releases + `latest.json`).
- `tauri.conf.json` → `bundle` + `plugins.updater` (`active: true`, `pubkey`, `endpoints`).
- Test: sürüm bump → eski kurulumun güncellemeyi çektiği e2e provası.
- Whisper prod notu: exe `externalBin` ile exe yanına gelir; ggml*.dll + whisper.dll icin `bundle.resources` + ilk açılışta exe yanına kopyalama (veya statik-linkli whisper derlemesi) gerekir — yoksa prod'da 0xC0000135.

## 3. TR/EN dokümantasyon + örnek dosyalar (A9-d)

**Kapsam:**
- `jointvault/docs/tools-*.md`: 4 araç için TR kullanım kılavuzu (Birleştir, Sessizlik, GIF/WebM, Altyazı)
  + limit tablosu (GIF≤15sn, WebM≤30sn, genişlik 160–640, fps 5–20, preset değerleri).
- EN çevirileri (`tools-*.en.md`) — TR onaylandıktan sonra.
- Örnek dosyalar: kısa bir örnek video + örnek `.srt` (telifsiz, repo-ici `docs/samples/`).
- README'ye "Araç Kutusu" bölümü (ekran görüntülü, 5 satır).
- Whisper model tablosu (tiny 75MB / base 142MB / small 466MB) + "ilk açılışta indirilmez" notu.

## 4. Bilinen tasarım borçları (kodda sapma notları)

- `ConvertOp` union'ına dokunulmadı (A8): merge/silence/gif için standalone `*OutputPath()` fonksiyonları
  (`convert-path.ts`). Yeni dönüştürme op'u eklenirse union genişletilebilir ama ConverterStudio'ya
  buton enjekte edeceği unutulmamalı.
- Transkript (`.srt`) vault'a `converted_path` olarak BAĞLANMIYOR (oynatıcı bozar); sadece gömülü
  çıktı (mp4) bağlanıyor (A7/A14). Not/ek alanı istenirse şema değişikliği gerekir (`schema.sql`).
- `transcribe` progress faz-bazlı (wav 10 → bitince 100); whisper `--print-progress` parse edilmedi.
  Canlı yüzde istenirse stderr parse eklenebilir.
- `health.rs` model yolu `whisper.rs`'teki join'in kopyası; iki taraftan biri değişirse diğeri elle
  senkronlanmalı (küçük `pub(crate)` helper'a taşınabilir).
- GifTool segment seçimi TrimEditor'ı yeniden kullanıyor; bağımsız timeline istenirse ayrı component gerekir.

## 5. Sonraki agent için devralma kontrol listesi

- [ ] `PROGRESS.md` (`.tmp/tasks/media-tools-package/`): 01–06 completed, bu dosya 07'nin çıktısı.
- [ ] Doğrulama komutları: `cd jointvault; npm run build` + `npm run lint` · `cd src-tauri; cargo check`.
- [ ] Commit disiplini: bu paket henüz commit'lenmedi (`git status` ile 01–06 diff'ini gözden geçir).
- [ ] Öncelik sırası: §1 whisper binary → §3 docs → §2 updater.
