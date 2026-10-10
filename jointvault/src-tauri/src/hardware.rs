// Donanım tespiti: GPU adı, (varsa) GERÇEK VRAM ve toplam sistem RAM'i.
//
// SORUN: Uygulama bugüne kadar "RTX 5070 Ti" adını ve "99 katman" offload'unu
// SABİT yazıyordu. İkisi birlikte yanlıştır: başka bir GPU'da kullanıcıya yanlış
// donanım adı gösterilir ve VRAM'e sığmayan model GPU'ya itilip çalışma anında
// çöker. Bu modül YALNIZCA tespit üretir; offload KARARI `ai.rs`'te verilir
// (subtask 04). Tespit, kararın girdisidir — kararın kendisi değil.
//
// TESPİT SIRASI (onaylanmış karar; yeniden tartışılmaz):
//   1. `nvidia-smi` → AD + GERÇEK VRAM. Tek güvenilir VRAM kaynağı budur.
//   2. WMI `Win32_VideoController` → YALNIZCA AD. VRAM verilmez (None).
//   3. Aksi hâlde "bilinmiyor": her iki alan da None, kaynak `unknown`.
//
// NEDEN WMI'DAN VRAM ALINMIYOR? `Win32_VideoController.AdapterRAM` alanı 32 bit
// İŞARETSİZDİR ve 4 GB üzerindeki kartları TAŞIRARAK yanlış bildirir (ör. 16 GB
// kart "4 GB" görünür). Yanlış bir sayı, hiç sayı olmamasından KÖTÜDÜR: hem
// kullanıcıya yalan söyler hem de offload kararını bozar. Bu yüzden WMI'dan
// yalnızca AD alınır, VRAM ASLA.
//
// RAM NEDEN BURADA? Toplam sistem RAM'i, sihirbazın donanıma göre model kademesi
// ÖNERMESİ için gerekir (karar `ai.rs`'te verilir). Kaynak WMI
// `Win32_ComputerSystem.TotalPhysicalMemory`'dir: alan BAYT cinsinden tam sayıdır
// ve MiB'e çevrilir ki VRAM ve model boyutlarıyla aynı birimde karşılaştırılabilsin.
// Tespit başarısızsa dürüstçe `None` döner — uydurma sayı YOK.
//
// NEDEN ÖNBELLEK (OnceLock)? Her tespit bir süreç başlatır (`nvidia-smi` veya
// PowerShell); bu yavaştır. Durum komutu sık çağrıldığı için sonuç süreç başına
// BİR kez hesaplanır ve sonra bellekten okunur. Böylece hem tekrarlı süreç
// başlatma hem de her çağrıda titreyen (tutarsız) bir durum önlenir.
//
// NEDEN YENİ CRATE YOK? Tespit yan bir iştir; `std::process::Command` yeterlidir.
#![allow(dead_code)] // Bazı pub yardımcılar (as_str/is_known/has_vram) şu an yalnızca testlerce kullanılır; tespit artık `ai_status`'a bağlıdır (components.rs'teki desenle aynı).

use std::sync::OnceLock;

/// GPU bilgisinin NEREDEN geldiği. Arayüz bunu göstererek ne kadar emin olduğunu
/// dürüstçe söyler: `nvidia-smi` gerçek VRAM verir, `wmi` yalnızca ad verir.
#[derive(serde::Serialize, PartialEq, Eq, Clone, Copy, Debug)]
pub enum GpuSource {
    /// `nvidia-smi --query-gpu=name,memory.total` — AD + VRAM.
    #[serde(rename = "nvidia-smi")]
    NvidiaSmi,
    /// WMI `Win32_VideoController` — YALNIZCA AD (VRAM yok).
    #[serde(rename = "wmi")]
    Wmi,
    /// Hiçbiri işe yaramadı; her iki alan da boş.
    #[serde(rename = "unknown")]
    Unknown,
}

impl GpuSource {
    /// Tel/arayüz için sabit metin. `serde` adlarıyla AYNI olmak zorundadır;
    /// `source_wire_names_match_json` testi bu ikisini birbirine çiviler
    /// (iki yerde ayrı yazılsa da ayrışamazlar).
    pub fn as_str(&self) -> &'static str {
        match self {
            GpuSource::NvidiaSmi => "nvidia-smi",
            GpuSource::Wmi => "wmi",
            GpuSource::Unknown => "unknown",
        }
    }
}

/// Tespit edilen GPU. `None` = "bilinmiyor" — uydurma değer YOKTUR.
///
/// `vram_mb` yalnızca `nvidia-smi`'den gelir ve değeri MiB'dir (nvidia-smi
/// `memory.total` alanını MiB döner). `components.rs`'teki model dosya boyutları
/// da MiB cinsindendir; offload karşılaştırması aynı birimde yapılmalıdır ki
/// elmalarla portakal toplanmasın.
#[derive(serde::Serialize, PartialEq, Eq, Clone, Debug)]
pub struct GpuInfo {
    pub name: Option<String>,
    pub vram_mb: Option<u64>,
    pub source: GpuSource,
}

impl GpuInfo {
    /// Dürüst "bilinmiyor": tespit başarısız olduğunda tek meşru değer budur.
    pub fn unknown() -> Self {
        GpuInfo {
            name: None,
            vram_mb: None,
            source: GpuSource::Unknown,
        }
    }

    /// Herhangi bir bilgi var mı (ad veya VRAM)? Arayüz "bilinmiyor" işaretini
    /// buna dayandırır.
    pub fn is_known(&self) -> bool {
        self.name.is_some() || self.vram_mb.is_some()
    }

    /// Gerçek VRAM var mı? Offload kararı YALNIZCA buna dayanabilir (subtask 04);
    /// VRAM yoksa güvenli seçim CPU'dur.
    pub fn has_vram(&self) -> bool {
        self.vram_mb.is_some()
    }
}

// --- Tespit (G/Ç sınırı) -----------------------------------------------------

/// Tespit sonucu: pahalı kısım (süreç başlatma) süreç başına BİR kez yapılır.
///
/// Dönen değer üç küçük alanın kopyasıdır; asıl maliyet `detect_uncached`'tedir
/// ve `OnceLock` onu tekrarlamaz.
pub fn detect() -> GpuInfo {
    cached().clone()
}

/// Önbellekteki tespit: ilk çağrıda hesaplar, sonra aynı değeri döndürür.
fn cached() -> &'static GpuInfo {
    static CACHE: OnceLock<GpuInfo> = OnceLock::new();
    CACHE.get_or_init(detect_uncached)
}

/// Önbelleksiz tespit: süreçleri burada başlatır, kararı `resolve_gpu`'ya bırakır.
fn detect_uncached() -> GpuInfo {
    resolve_gpu(query_nvidia_smi().as_deref(), query_wmi().as_deref())
}

/// SAF karar: ham çıktıları öncelik sırasına göre `GpuInfo`'ya çevirir.
///
/// G/Ç'den AYRI tutulur; bu yüzden öncelik kuralı süreç başlatmadan test
/// edilebilir. `nvidia-smi` geçerliyse o kazanır (gerçek VRAM); değilse WMI
/// yalnızca ad verir; ikisi de yoksa "bilinmiyor".
fn resolve_gpu(nvidia_smi_output: Option<&str>, wmi_output: Option<&str>) -> GpuInfo {
    if let Some((name, vram_mb)) = nvidia_smi_output.and_then(parse_nvidia_smi) {
        return GpuInfo {
            name: Some(name),
            vram_mb: Some(vram_mb),
            source: GpuSource::NvidiaSmi,
        };
    }
    if let Some(name) = wmi_output.and_then(parse_wmi_name) {
        // VRAM bilinçli olarak `None`: `AdapterRAM` kullanılmaz (dosya başı notu).
        return GpuInfo {
            name: Some(name),
            vram_mb: None,
            source: GpuSource::Wmi,
        };
    }
    GpuInfo::unknown()
}

// --- Komut çalıştırma (yalnız Windows) ---------------------------------------
//
// Argümanlar SABİTTİR; kullanıcı girdisi geçmez → enjeksiyon yüzeyi yoktur
// (security-patterns: dış komut çağrısında girdi doğrulanır).

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// `nvidia-smi` sorgusu: AD + GERÇEK VRAM (MiB).
#[cfg(windows)]
const NVIDIA_SMI_ARGS: [&str; 2] = ["--query-gpu=name,memory.total", "--format=csv,noheader"];

/// WMI sorgusu.
///
/// NEDEN PowerShell, NEDEN `wmic` DEĞİL? `wmic` Windows 11 24H2'de kaldırıldı;
/// PowerShell desteklenen her sürümde vardır. `-NoProfile` kullanıcı profilini,
/// `-NonInteractive` etkileşimi kapatır (yan etki yok, daha hızlı).
///
/// NEDEN `try { ... } catch {}`? `[Console]::OutputEncoding` çıktı
/// yönlendirilmişken bazı kısıtlı ortamlarda hata fırlatabilir. Bu yalnızca bir
/// KODLAMA iyileştirmesidir, sorgunun önkoşulu değildir: başarısız olsa bile
/// sorguya devam ederiz (aksi hâlde tüm WMI yolu gereksizce "bilinmiyor"a düşerdi).
#[cfg(windows)]
const WMI_SCRIPT: &str = concat!(
    "try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}; ",
    "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
);

#[cfg(windows)]
fn query_nvidia_smi() -> Option<String> {
    run_capture("nvidia-smi", &NVIDIA_SMI_ARGS)
}

/// Windows dışında GPU tespiti yapılmaz: dürüstçe "bilinmiyor".
#[cfg(not(windows))]
fn query_nvidia_smi() -> Option<String> {
    None
}

#[cfg(windows)]
fn query_wmi() -> Option<String> {
    run_capture(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", WMI_SCRIPT],
    )
}

#[cfg(not(windows))]
fn query_wmi() -> Option<String> {
    None
}

/// Bir aracı çalıştırıp stdout'unu döndürür.
///
/// Süreç BAŞLATILAMAZSA `None` döner (araç yok / kısıtlı makine): hata
/// fırlatmayız, çağıran "bilinmiyor"a düşer. Çıkış kodu ayrıca DENETLENMEZ çünkü
/// araç hataları stderr'e gider; biz yalnızca stdout'u ayrıştırırız ve boş/bozuk
/// çıktıyı saf ayrıştırıcılar zaten reddeder.
#[cfg(windows)]
fn run_capture(program: &str, args: &[&str]) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        // GUI uygulaması: yanıp sönen konsol penceresi açılmasın.
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    Some(decode_stdout(&output.stdout))
}

// --- Saf ayrıştırıcılar ------------------------------------------------------
//
// Hepsi saf: aynı girdi → aynı çıktı, G/Ç yok, panik yok. Bozuk/eksik girdi
// `None` döner; üretim yolunda `unwrap`/`expect` ÇAĞRILMAZ.

/// stdout baytlarını metne çevirir ve baştaki UTF-8 BOM'unu atar.
///
/// Geçersiz baytlar kayıp (U+FFFD) ile değiştirilir — panik YOK. Gerçek GPU
/// adları ASCII olduğundan BOM dışında bir kodlama sorunu beklenmez; yine de
/// bozuk kodlama "bilinmiyor"a düşer, yanlış bir sayıya değil.
fn decode_stdout(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .trim_start_matches('\u{feff}')
        .to_string()
}

/// `nvidia-smi --format=csv,noheader` çıktısını ayrıştırır.
///
/// Beklenen biçim, GPU başına bir satır:  `<ad>, <bellek MiB>`
/// Örnek: `NVIDIA GeForce RTX 5070 Ti, 16384 MiB`
///
/// Çok GPU'lu sistemde **ilk satır** (ilk GPU) alınır. O satır bozuksa `None`
/// döneriz: sonraki satıra atlamak "hangi GPU'yu bildirdik" sorusunu
/// belirsizleştirir; `nvidia-smi` zaten kullanılabilir GPU'ları sırayla listeler.
pub fn parse_nvidia_smi(output: &str) -> Option<(String, u64)> {
    let line = output.lines().map(str::trim).find(|line| !line.is_empty())?;
    // Ad virgül içerebilir; bellek alanı virgül içermez → ayırımı SON virgülden
    // yaparız ki ad yanlışlıkla bölünmesin.
    let (name, memory) = line.rsplit_once(',')?;
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let vram_mb = parse_mib(memory)?;
    Some((name.to_string(), vram_mb))
}

/// Bellek alanından MiB sayısını çıkarır. Birim/yerel ayar bağımsızdır: alanın
/// BAŞINDAKİ ondalık rakamlar okunur.
///
/// `"16384 MiB"`, `"16384MiB"`, `"16384"` → `Some(16384)`;
/// `"N/A"`, `"Not Supported"`, `""`, `"abc"` → `None`.
///
/// `0` da `None`'dır: gerçek bir GPU 0 MB değildir; sürücü sorguya cevap
/// verememiştir. Sıfırı gerçek saymak offload kararını yanıltırdı.
fn parse_mib(field: &str) -> Option<u64> {
    let digits: String = field
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    let value = digits.parse::<u64>().ok()?;
    (value > 0).then_some(value)
}

/// WMI `Win32_VideoController` ad çıktısını ayrıştırır: ilk BOŞ OLMAYAN satır.
///
/// WMI yalnızca AD verir; VRAM vermez (`AdapterRAM` yanlış — dosya başı notu).
/// Çok adaptörlü sistemde (ör. Intel iGPU + NVIDIA dGPU) **ilk satır** alınır;
/// gerçek VRAM gerektiğinde zaten `nvidia-smi` önceliklidir.
pub fn parse_wmi_name(output: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

// --- Toplam sistem RAM'i (MiB) ----------------------------------------------
//
// Ayrı bir tespit: GPU ile ilgisi yok, ama AYNI sözleşmeye uyar (Windows'ta ölç,
// başarısızsa dürüstçe None). Sihirbazın donanıma göre model önerisi bunu girdi alır.

/// 1 MiB = 1024×1024 bayt. WMI bayt verir; VRAM ve model boyutları MiB'dir.
const BYTES_PER_MIB: u64 = 1024 * 1024;

/// WMI `Win32_ComputerSystem.TotalPhysicalMemory` sorgusu (BAYT, tam sayı).
///
/// Argümanlar SABİTTİR; kullanıcı girdisi geçmez → enjeksiyon yüzeyi yoktur.
#[cfg(windows)]
const RAM_SCRIPT: &str = concat!(
    "try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}; ",
    "Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty TotalPhysicalMemory",
);

#[cfg(windows)]
fn query_ram() -> Option<String> {
    run_capture(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", RAM_SCRIPT],
    )
}

/// Windows dışında RAM tespiti yapılmaz: dürüstçe "bilinmiyor".
#[cfg(not(windows))]
fn query_ram() -> Option<String> {
    None
}

/// Tespit edilen toplam sistem RAM'i (MiB). `None` = bilinmiyor.
///
/// GPU tespitiyle aynı gerekçeyle önbelleklenir: sorgu bir süreç başlatır ve
/// `ai_status` sık çağrılır; sonuç süreç başına BİR kez hesaplanır.
pub fn detect_ram() -> Option<u64> {
    *cached_ram()
}

fn cached_ram() -> &'static Option<u64> {
    static CACHE: OnceLock<Option<u64>> = OnceLock::new();
    CACHE.get_or_init(|| query_ram().as_deref().and_then(parse_total_ram_mib))
}

/// SAF: WMI `TotalPhysicalMemory` çıktısını MiB'e çevirir.
///
/// Beklenen: bayt cinsinden tek bir tam sayı (ör. `17179869184`). Çıktının ilk
/// BOŞ OLMAYAN satırı alınır; baştaki/sondaki boşluk ve `\r\n` hoş görülür.
///
/// Boş/`0`/bozuk (ör. `abc`, `17179869184 bytes`, ondalık) girdi → `None`.
/// `0` da `None`'dır: gerçek bir sistemin 0 bayt RAM'i olamaz; sorgu cevap
/// verememiştir. Uydurma sayı, hiç sayı olmamasından KÖTÜDÜR.
pub fn parse_total_ram_mib(output: &str) -> Option<u64> {
    let bytes = output
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?
        .parse::<u64>()
        .ok()?;
    let mib = bytes / BYTES_PER_MIB;
    (mib > 0).then_some(mib)
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- nvidia-smi ayrıştırıcı ---

    #[test]
    fn nvidia_smi_parses_name_and_vram_from_a_single_line() {
        // Arrange + Act
        let got = parse_nvidia_smi("NVIDIA GeForce RTX 5070 Ti, 16384 MiB\n");
        // Assert
        assert_eq!(
            got,
            Some(("NVIDIA GeForce RTX 5070 Ti".to_string(), 16384))
        );
    }

    #[test]
    fn nvidia_smi_takes_the_first_gpu_when_several_are_listed() {
        let out = "NVIDIA GeForce RTX 4090, 24564 MiB\nNVIDIA GeForce RTX 3060, 12288 MiB\n";
        assert_eq!(
            parse_nvidia_smi(out),
            Some(("NVIDIA GeForce RTX 4090".to_string(), 24564))
        );
    }

    #[test]
    fn nvidia_smi_tolerates_padding_and_carriage_returns() {
        assert_eq!(
            parse_nvidia_smi("  NVIDIA GeForce RTX 5070 Ti  ,  16384 MiB  \r\n"),
            Some(("NVIDIA GeForce RTX 5070 Ti".to_string(), 16384))
        );
    }

    #[test]
    fn nvidia_smi_accepts_missing_unit_and_commas_in_the_name() {
        assert_eq!(
            parse_nvidia_smi("GTX 1080, 8192"),
            Some(("GTX 1080".to_string(), 8192))
        );
        // Ad içindeki virgüller belleği bozmamalı: ayırım son virgülden yapılır.
        assert_eq!(
            parse_nvidia_smi("Some,Weird,GPU, 8192 MiB"),
            Some(("Some,Weird,GPU".to_string(), 8192))
        );
    }

    #[test]
    fn nvidia_smi_returns_none_for_empty_or_whitespace_output() {
        for input in ["", "   ", "\n\r\n", "\t \n  \n"] {
            assert_eq!(parse_nvidia_smi(input), None, "girdi: {input:?}");
        }
    }

    #[test]
    fn nvidia_smi_returns_none_for_malformed_lines() {
        for input in [
            "NVIDIA GeForce RTX 5070 Ti", // virgül yok
            ", 16384 MiB",                // ad boş
            "   , 16384 MiB",             // ad yalnızca boşluk
            "GeForce, abc MiB",           // bellek sayı değil
            "GeForce,",                   // bellek alanı boş
        ] {
            assert_eq!(parse_nvidia_smi(input), None, "girdi: {input:?}");
        }
    }

    #[test]
    fn nvidia_smi_returns_none_for_unreported_or_zero_memory() {
        // 'N/A' / 'Not Supported': nvidia-smi gerçek VRAM veremedi. '0 MB' ise
        // gerçek bir GPU değildir. Üçü de "tespit yok" demektir — 0 veya uydurma
        // sayı döndürmek yerine None.
        for input in ["GeForce, N/A", "GeForce, Not Supported", "GeForce, 0 MiB"] {
            assert_eq!(parse_nvidia_smi(input), None, "girdi: {input:?}");
        }
    }

    #[test]
    fn parse_mib_extracts_leading_digits_or_none() {
        assert_eq!(parse_mib("16384 MiB"), Some(16384));
        assert_eq!(parse_mib("  16384MiB"), Some(16384));
        assert_eq!(parse_mib("16384"), Some(16384));
        assert_eq!(parse_mib("007 MiB"), Some(7));
        for bad in [
            "",
            "  ",
            "N/A",
            "Not Supported",
            "0",
            "0 MiB",
            "abc",
            "MiB 16384",
        ] {
            assert_eq!(parse_mib(bad), None, "girdi: {bad:?}");
        }
    }

    // --- WMI ayrıştırıcı ---

    #[test]
    fn wmi_parses_the_first_adapter_name() {
        let out = "Intel(R) UHD Graphics\r\nNVIDIA GeForce RTX 5070 Ti\r\n";
        assert_eq!(
            parse_wmi_name(out),
            Some("Intel(R) UHD Graphics".to_string())
        );
    }

    #[test]
    fn wmi_returns_none_for_empty_output() {
        for input in ["", "  \r\n \n", "\t"] {
            assert_eq!(parse_wmi_name(input), None, "girdi: {input:?}");
        }
    }

    // --- RAM ayrıştırıcı ---

    #[test]
    fn ram_parses_bytes_into_mib() {
        // 16 GiB = 17179869184 bayt → 16384 MiB
        assert_eq!(parse_total_ram_mib("17179869184"), Some(16384));
        // Sınır: tam 1 MiB → 1; altı (1048575) yukarıdaki None testinde.
        assert_eq!(parse_total_ram_mib("1048576"), Some(1));
    }

    #[test]
    fn ram_tolerates_padding_and_carriage_returns() {
        assert_eq!(parse_total_ram_mib("  17179869184  \r\n"), Some(16384));
    }

    #[test]
    fn ram_takes_the_first_non_empty_line() {
        assert_eq!(parse_total_ram_mib("\r\n17179869184\r\n"), Some(16384));
    }

    #[test]
    fn ram_returns_none_for_empty_or_whitespace_output() {
        for input in ["", "   ", "\n\r\n", "\t \n  \n"] {
            assert_eq!(parse_total_ram_mib(input), None, "girdi: {input:?}");
        }
    }

    #[test]
    fn ram_returns_none_for_zero_or_sub_mib_values() {
        // 0 = sorgu cevap veremedi; <1 MiB = gerçek sistem değil. İkisi de None.
        for input in ["0", "0\r\n", "1048575"] {
            assert_eq!(parse_total_ram_mib(input), None, "girdi: {input:?}");
        }
    }

    #[test]
    fn ram_returns_none_for_malformed_output() {
        for input in [
            "abc",               // sayı değil
            "17179869184 bytes", // birim eki: tam sayı değil
            "-17179869184",      // işaretli (negatif)
            "17.179",            // ondalık
            "N/A",               // WMI bazen bunu döner
        ] {
            assert_eq!(parse_total_ram_mib(input), None, "girdi: {input:?}");
        }
    }

    // --- kod çözme ---

    #[test]
    fn decode_strips_utf8_bom_and_keeps_ascii_names() {
        assert_eq!(decode_stdout(b"\xef\xbb\xbfNVIDIA RTX"), "NVIDIA RTX");
        assert_eq!(
            decode_stdout(b"Intel(R) UHD Graphics"),
            "Intel(R) UHD Graphics"
        );
        assert_eq!(decode_stdout(b""), "");
    }

    #[test]
    fn decode_never_panics_on_invalid_bytes() {
        // Bozuk kodlama panik üretmez; kayıp karakterle metne döner. Önemli olan
        // çökmeden "bilinmiyor"a düşebilmektir.
        let decoded = decode_stdout(b"\xff\xfeGeForce");
        assert!(decoded.contains("GeForce"), "çözülen: {decoded:?}");
    }

    // --- öncelik kararı (saf; süreç başlatmadan) ---

    #[test]
    fn nvidia_smi_wins_and_supplies_real_vram() {
        let info = resolve_gpu(
            Some("NVIDIA GeForce RTX 5070 Ti, 16384 MiB\n"),
            Some("Intel(R) UHD Graphics\n"),
        );
        assert_eq!(info.name.as_deref(), Some("NVIDIA GeForce RTX 5070 Ti"));
        assert_eq!(info.vram_mb, Some(16384));
        assert_eq!(info.source, GpuSource::NvidiaSmi);
        assert!(info.is_known());
        assert!(info.has_vram());
    }

    #[test]
    fn malformed_nvidia_smi_falls_back_to_wmi_name_only() {
        let info = resolve_gpu(Some("GeForce, N/A\n"), Some("AMD Radeon RX 7900 XTX\n"));
        assert_eq!(info.name.as_deref(), Some("AMD Radeon RX 7900 XTX"));
        assert_eq!(info.vram_mb, None, "WMI VRAM veremez");
        assert_eq!(info.source, GpuSource::Wmi);
        assert!(info.is_known());
        assert!(!info.has_vram());
    }

    #[test]
    fn nvidia_smi_wins_even_when_wmi_is_missing() {
        let info = resolve_gpu(Some("NVIDIA RTX A4000, 16384 MiB"), None);
        assert_eq!(info.source, GpuSource::NvidiaSmi);
        assert_eq!(info.vram_mb, Some(16384));
    }

    #[test]
    fn empty_outputs_fall_through_to_unknown() {
        let info = resolve_gpu(Some(""), Some("  \n"));
        assert_eq!(info, GpuInfo::unknown());
    }

    #[test]
    fn both_sources_missing_is_honestly_unknown() {
        let info = resolve_gpu(None, None);
        assert_eq!(info, GpuInfo::unknown());
        assert_eq!(info.name, None);
        assert_eq!(info.vram_mb, None);
        assert_eq!(info.source, GpuSource::Unknown);
        assert!(!info.is_known());
        assert!(!info.has_vram());
    }

    // --- tel biçimi (serde) ---

    #[test]
    fn source_wire_names_match_json() {
        let cases = [
            (GpuSource::NvidiaSmi, "nvidia-smi"),
            (GpuSource::Wmi, "wmi"),
            (GpuSource::Unknown, "unknown"),
        ];
        for (source, expected) in cases {
            assert_eq!(source.as_str(), expected);
            // serde adı ile as_str ayrışamaz: ikisini birlikte çivileriz.
            assert_eq!(
                serde_json::to_string(&source).unwrap_or_default(),
                format!("\"{expected}\"")
            );
        }
    }

    #[test]
    fn gpu_info_serializes_with_nullable_fields() {
        let json = serde_json::to_string(&GpuInfo::unknown()).unwrap_or_default();
        assert_eq!(
            json,
            "{\"name\":null,\"vram_mb\":null,\"source\":\"unknown\"}"
        );
    }
}
