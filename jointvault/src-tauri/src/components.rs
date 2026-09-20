// Bileşen kaydı (component registry).
//
// Sorun: "hangi araç kurulu, nerede duruyor" bilgisi bugün üç yere dağılmıştı —
// `health.rs` sidecar'a bakıyor, `whisper.rs` kendi yolunu hesaplıyor,
// `download.rs` ffmpeg'i `<indirme>/.tools` altına kopyalıyor. Aynı bilginin
// kopyaları zamanla ayrışır (bu, `docs/media-tools-deferred.md:59-60`'ta
// kayıtlı bir borç).
//
// Burada tek kaynak: her bileşen için id, etiket, beklenen dosya adı, gömülü
// sidecar adı, sürüm komutu ve (varsa) **pinlenmiş indirme kaynağı**. Durum
// UYDURULMAZ — dosya ve çalıştırma kontrolü gerçekten yapılır.
//
// İndirme kaynağı neden burada? Kaynak seçimi (URL/sha256/hangi arşiv) ürünün
// değişmez bir kararıdır; indirme MOTORU (`component_download.rs`) bu kararı
// bilmez, yalnızca uygular. Böylece "ne iniyor" sorusunun tek cevabı olur.
//
// Arama sırası: **indirilenler klasörü → uygulamanın yanındaki gömülü sidecar**.
// İndirilenler kullanıcı verisine yazılır (yönetici izni gerekmez); gömülü olan
// paketle birlikte gelir ve son çare olarak kalır.
//
// 7c-3: her spec artık bir HEDEF (`Dest`) ve bir TÜR (`Kind`) taşır. Neden?
// "Bileşen" tek bir şekil değildir: ffmpeg gibi çalıştırılabilirler `components/`
// altında yaşar, modeller `.gguf`/`.bin` VERİ dosyasıdır ve çalıştırılamaz, AI
// motoru ise bambaşka bir dizinde (`jointvault-binaries`) durur. Türü açıkça
// yazmazsak kurulu bir `.gguf` arayüzde "çalıştırılamıyor" görünür ve her açılışta
// yeniden indirilir. Bu yüzden `kind` ÇALIŞTIRMA hükmünün tek kaynağıdır; `dest`
// ise dosyanın nerede aranacağının tek kaynağıdır.
//
// Mevcut dizinler KORUNUR (yeni ad icat edilmez): modeller `jointvault-models`,
// AI ikilileri `jointvault-binaries` altında zaten kurulu; taşımak o dosyaları
// öksüz bırakır (regresyon). Kayıt yalnızca bu adları BİLİR.
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Bileşen nereden geldi: kullanıcı indirdi mi, paketle mi geldi.
///
/// `Clone + Copy`: çözümlenen yolu alan çağrı yerleri kaynağı da yanında taşır ve
/// gerektiğinde yeniden kullanır (ör. `download.rs` hem ffmpeg hem ffprobe kaynağını
/// aynı anda bildirmek ister). Küçük, düz bir değer; kopyalamak ucuz.
#[derive(serde::Serialize, PartialEq, Clone, Copy, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ComponentSource {
    Downloaded,
    Bundled,
}

/// Bileşenin kurulduğu yer. Üç ayrı yaşam alanı vardır ve karıştırılamaz:
///   - `Components` → `components_dir()`: indirilen çalıştırılabilirler (ffmpeg,
///     ffprobe, yt-dlp, whisper motoru).
///   - `Models` → `app_data_dir()/jointvault-models`: veri dosyaları (`.bin`, `.gguf`).
///   - `Binaries` → `app_data_dir()/jointvault-binaries`: AI motoru (llama-server + DLL).
///
/// `Models`/`Binaries` dizinleri BUGÜNKÜ adlarıyla korunur (bkz. dosya başı notu):
/// whisper/AI dosyaları zaten orada duruyor. Kayıt yeni bir yol uydurmaz.
#[derive(PartialEq, Eq, Clone, Copy, Debug)]
pub enum Dest {
    Components,
    /// Modeller (`.bin`/`.gguf`): whisper tiny/base/small ve Qwen/BGE. Veri
    /// dosyasıdır, çalıştırılmaz — tür kararı `Kind` ile verilir.
    Models,
    /// AI motoru (llama-server + CUDA DLL'leri).
    Binaries,
}

/// Bileşenin türü. "Çalıştırılamıyor" hükmü YALNIZCA buradan türer.
///   - `Binary`: çalıştırılabilir dosya; `resolve_tool`/`require_tool`/`probe_version`
///     ve `runnable` bu türde anlamlıdır (bugünkü davranış).
///   - `Asset`: veri dosyası (`.bin`, `.gguf`). "Kurulu" demek DOSYA VAR demektir;
///     sürüm sorulamaz ve çalıştırılamaz — bu bir kusur değil, "kurulum ≠ çalıştırma"dır.
///     Arayüz kararı `kind` ile verir (bkz. `is_usable`), `runnable` ile değil.
#[derive(serde::Serialize, PartialEq, Eq, Clone, Copy, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Binary,
    /// Veri dosyası: `.bin`/`.gguf` modeller ve çalıştırılamayan DLL kümeleri
    /// (llama cudart). "Kurulu" demek DOSYA VAR demektir; sürüm sorulamaz ve
    /// çalıştırılamaz — bu bir kusur değil, "kurulum ≠ çalıştırma"dır.
    Asset,
}

#[derive(serde::Serialize)]
pub struct ComponentStatus {
    id: String,
    label: String,
    /// Kabaca indirme boyutu (kullanıcı ne indireceğini bilsin).
    approx_mb: u32,
    /// Bileşenin türü: `"binary"` | `"asset"`. Arayüz "kurulu ama çalıştırılamıyor"
    /// hükmünü `runnable`'a değil BURAYA dayandırır: kurulu bir veri dosyası `asset`
    /// olduğu için kullanılabilir sayılır (`is_usable`).
    kind: Kind,
    installed: bool,
    /// Dosya var VE çalıştırılabiliyor mu (sürüm okunabildi mi).
    /// "Dosya var" tek başına yetmez: `whisper.exe` DLL'leri olmadan durur.
    ///
    /// `Asset`'te KASITLI olarak `false`'tur ve `version` de `None`'dur: veri dosyası
    /// ne çalıştırılır ne de sürümü sorulur. 7a sondası (`verify-components`) her satırda
    /// `runnable === Boolean(version)` beklediğinden bu iki alan birlikte tutarlı kalır;
    /// tür kararı `kind` ile verilir.
    runnable: bool,
    /// Bileşenin bulunduğu tam yol (kuruluysa).
    path: Option<String>,
    source: Option<ComponentSource>,
    /// Sürüm/prob çıktısının ilk satırı (kuruluysa). Argüman spec'ten gelir
    /// (ffmpeg `-version`, whisper `--help`, llama `--version`); `Asset`'te `None`.
    version: Option<String>,
    /// Bu bileşen indirilebilir mi (paketle gelenler için false).
    /// Pinlenmiş kaynağı olmayan bileşen indirilebilir SAYILMAZ (bkz. `Spec::download`).
    downloadable: bool,
    /// Aynı indirme arşivini paylaşan bileşenlerin paket kimliği (ör. `ffmpeg-tools`).
    /// Arayüz bununla satırları gruplar: ffmpeg + ffprobe TEK arşivden kurulur.
    bundle: Option<String>,
    /// İçerik biçimi: `"archive"` (zip) ya da `"plain"` (düz dosya).
    /// İndirilemeyen bileşenlerde `None`. Arayüz etiketlemek için kullanır.
    framework: Option<String>,
}

/// Kurulum-sonrası TEK, açık adım. Dinamik sevk YOKTUR: her varyant ne yaptığını
/// açıkça söyler ve `apply_post_install` yalnızca bu değerleri kullanır. Spec
/// üzerinde taşınır ki "ne iniyor"un tek kaynağı ile "indikten sonra ne oluyor"
/// aynı yerde okunsun.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PostInstall {
    /// Arşivden çıkan exe'yi çalışma-anı adına taşı (whisper: `whisper-cli.exe` →
    /// `whisper.exe`). Çalışma-anı adı `spec.downloaded_file` ile AYNI olmalıdır;
    /// var olan hedef ÖNCE silinir çünkü Windows'ta `rename` "already exists" ile düşer
    /// (DLL'leri eksik, çalışmayan bir `whisper.exe` yerinde durabilir).
    ///
    /// Alanlar kurulum yolunda (`apply_post_install`) okunur; whisper motoru bu
    /// kancayı kayıtta taşır.
    Rename {
        from: &'static str,
        to: &'static str,
    },
}

/// Tek bir bileşenin değişmez tarifi.
///
/// Alanlar `pub`: komut köprüsü (`component_download::install_component`) planı ve
/// kancayı buradan okur. Kayıt motorun tiplerine bağımlı DEĞİLDİR ve olmamalıdır:
/// aksi hâlde "ne iniyor" sorusu motora sızardı (bkz. dosya başı notu).
pub struct Spec {
    pub id: &'static str,
    pub label: &'static str,
    pub approx_mb: u32,
    /// Bileşenin kurulduğu yer (Components/Models/Binaries).
    pub dest: Dest,
    /// Bileşenin türü (Binary/Asset) — "çalıştırılabilir mi" hükmünün tek kaynağı.
    pub kind: Kind,
    /// İndirildiğinde kullanılacak dosya adı (hedef dizin içinde).
    pub downloaded_file: &'static str,
    /// Paketle gelen sidecar adı (varsa). YALNIZCA exe yanında paketlenen
    /// bileşenlerde doludur; modeller gömülü gelmez, bu yüzden model spec'lerinde `None`.
    pub sidecar: Option<&'static str>,
    /// Sürüm sorgusunda kullanılacak argüman (yalnızca `Binary`).
    pub version_arg: &'static str,
    /// Pinlenmiş indirme kaynağı. `None` → bu bileşen bu komuttan inmez:
    /// yt-dlp paketle gömülü gelir. whisper/AI kaynakları 7c-3'te buraya taşındı.
    /// `downloadable` bu alandan TÜRETİLİR — kaynağı olmayan "indirilebilir" sayılmaz.
    pub download: Option<DownloadSpec>,
    /// İndirme başarıyla bittikten SONRA çalışan açık adım (varsa). `None` → hiçbir
    /// şey yapılmaz, davranış bugünküyle aynıdır. Kaynağı olmayan bir spec'te kanca
    /// ATIL durur: `install_recipe` zaten "indirilemiyor" diyerek durur, kanca çalışmaz.
    pub post_install: Option<PostInstall>,
}

/// Arşivden ne çıkarılacak ve tek girdi güvenlik sınırı.
pub enum PayloadRule {
    /// Tek düz dosya: `<hedef>/<file_name>`. Model indirmeleri (`.bin`/`.gguf`)
    /// buraya bağlıdır; motor tarafı hazır (`Payload::Raw`).
    Raw { file_name: &'static str },
    /// Zip: yalnızca `wanted` basename'leri hedefe çıkarılır; her girdi
    /// `max_entry_bytes`'ı aşarsa kurulum reddedilir (zip-bomba).
    Zip {
        wanted: &'static [&'static str],
        max_entry_bytes: u64,
    },
}

/// Pinlenmiş indirme kaynağı.
///
/// URL/sha256 değerleri mevcut kaynak tablosundan (`whisper.rs`/`ai.rs`)
/// **birebir** taşınır; burada uydurma kaynak yoktur (`docs/product-roadmap.md` §7
/// riski: kaynak sabitlenmeli, dış kaynak kaybolsa bile ne indirildiği bilinmeli).
pub struct DownloadSpec {
    /// Paket kimliği (ilerleme olayında görünür). Aynı arşivi paylaşan satırlar
    /// aynı değeri taşır (`ffmpeg-tools`); tek arşivli bileşende kendi id'sidir.
    pub bundle: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    /// İndirilen arşiv boyutu (yayıncının beyanı). İlerleme toplamı için yedek.
    pub expected_bytes: u64,
    /// Tepe disk ihtiyacı: arşiv + çıkarılan dosyalar. Disk kapısı bunu kullanır.
    pub disk_required_bytes: u64,
    pub payload: PayloadRule,
}

impl DownloadSpec {
    /// İçerik biçiminin tek kelimelik özeti: arşiv mi, düz dosya mı?
    /// `PayloadRule`'dan TÜRETİLİR; ayrı bir alan tutmak ayrışma riski olurdu.
    pub fn framework(&self) -> &'static str {
        match &self.payload {
            PayloadRule::Zip { .. } => "archive",
            PayloadRule::Raw { .. } => "plain",
        }
    }
}

// --- ffmpeg + ffprobe: TEK arşiv (BtbN tarihli, değişmez tag) ---
//
// Tarihli tag neden? `latest`/master akışı zamanla değişir ve kayıtlı sha256 bir gün
// sessizce yanlış olur; tarihli tag'de indirilen şey önceden bilinir.

const FFMPEG_TOOLS_BUNDLE: &str = "ffmpeg-tools";

const FFMPEG_TOOLS_URL: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-20-13-11/ffmpeg-N-126716-g3faf57342f-win64-gpl.zip";

/// Yayıncının `checksums.sha256` dosyasından; GitHub asset `digest` alanıyla doğrulandı.
const FFMPEG_TOOLS_SHA256: &str =
    "1e41954de78ce3ebdee55bbe6beb74aa89878b9fdf57b196a9e7e656a03f0a3b";

/// Arşiv boyutu: 194_564_474 bayt = 185.55 MiB (≈185.6 MB). Değer, GitHub asset
/// `size` alanından ve context.md pin tablosundaki 185.6 MB gösteriminden doğrulandı.
const FFMPEG_TOOLS_ARCHIVE_BYTES: u64 = 194_564_474;

/// Arşiv içindeki `ffmpeg.exe` boyutu: 156.62 MiB (164.23 MB).
const FFMPEG_EXE_BYTES: u64 = 164_232_192;
/// Arşiv içindeki `ffprobe.exe` boyutu: 156.42 MiB (164.02 MB).
const FFPROBE_EXE_BYTES: u64 = 164_022_784;

/// Tek arşiv girdisi için üst sınır: 400 MiB. Gerçek ikililer ~156 MiB olduğundan
/// meşru derleme geçer; şişirilmiş (zip-bomba) bir girdi burada reddedilir.
const FFMPEG_ENTRY_CAP_BYTES: u64 = 400 * 1024 * 1024;

/// Tepe disk ihtiyacı: indirilen arşiv + çıkarılan İKİ ikili. Çıkarma bitene kadar
/// arşiv de diskte durur; bu sayı verilmezse kullanıcı indirme ORTASINDA "yer yok"
/// hatası alır — kapının amacı tam olarak bunu önlemek.
const FFMPEG_TOOLS_DISK_BYTES: u64 =
    FFMPEG_TOOLS_ARCHIVE_BYTES + FFMPEG_EXE_BYTES + FFPROBE_EXE_BYTES;

/// Arşivde `bin/` altında dururlar; motor basename ile seçtiği için düz adlar verilir.
const FFMPEG_TOOLS_WANTED: &[&str] = &["ffmpeg.exe", "ffprobe.exe"];

/// Paylaşılan arşivin MB cinsinden gösterimi (iki satır da bu sayıyı taşır:
/// 80+80 değil, TEK ~186 MB indirme).
const FFMPEG_TOOLS_APPROX_MB: u32 = 186;

/// `app_data_dir()` altındaki mevcut klasör adları — DEĞİŞTİRİLMEZ. whisper/AI
/// dosyaları bugün bu adlarda kurulu; taşımak onları öksüz bırakırdı. Bu iki ad
/// burada TEK kaynak olarak durur; `ai.rs`/`whisper.rs`/`health.rs`'teki kopyalar
/// subtask 03/04'te buraya delege edilecek.
const MODELS_DIR_NAME: &str = "jointvault-models";
const BINARIES_DIR_NAME: &str = "jointvault-binaries";

/// 1 MiB (bayt). Boyut sabitleri bu birim üzerinden yazılır ki "242 MB" gibi
/// ondalık/gigabayt karışıklığı olmasın; pin tablosu MiB cinsindendir.
const MIB: u64 = 1024 * 1024;

/// `Asset` spec'lerinde `version_arg` HİÇ ÇALIŞTIRILMAZ (`probe_component` türü
/// kontrol edip erken döner, `components_status` yalnızca `Binary`'yi yoklar).
/// Alan zorunlu olduğu için nötr bir değer taşınır; "-version" seçilmesi veri
/// dosyasına yanlışlıkla çalıştırma yolu açılmasın diye DEĞİL, alanın anlamsız
/// olduğunu okuyana göstermek içindir.
const ASSET_VERSION_ARG: &str = "-version";

// --- whisper motoru + modelleri (7c-3) ---
//
// Pinler `whisper.rs`'teki mevcut kaynak tablosundan BİREBİR taşındı; subtask 03
// kopyaları silecek. Burada uydurma URL/sha256 yoktur (security-patterns: kaynak
// pinlenir; dış kaynak kaybolsa bile ne indirildiği bilinir).

/// Tek arşiv: PAYLAŞILAN paket yoktur, bu yüzden paket kimliği bileşenin kendi
/// id'sidir (7c-3 kuralı: bundle yalnızca birden çok satırı olan arşivlerde
/// farklıdır, ör. `ffmpeg-tools`). İlerleme olayı `jobId` ile süzülür; bu değer
/// yalnızca arayüzün satırları gruplamasına yarar.
const WHISPER_ENGINE_BUNDLE: &str = "whisper";
const WHISPER_ENGINE_URL: &str =
    "https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip";
const WHISPER_ENGINE_SHA256: &str =
    "0d2eca299c248f965bd0341bcb219db4b433c7f0c0ce2200d4df85765e8156a9";
/// Arşiv `whisper-cli.exe` getirir; çalışma-anı adı `whisper.exe` olmalıdır
/// (kanca bu adı taşır).
const WHISPER_ENGINE_ARCHIVE_EXE: &str = "whisper-cli.exe";
const WHISPER_ENGINE_FILE: &str = "whisper.exe";
/// Pin tablosundaki indirme boyutu (~4 MB). Sunucu `Content-Length` vermezse
/// ilerleme toplamı bu olur; motor yalnızca yedek olarak kullanır.
const WHISPER_ENGINE_ARCHIVE_BYTES: u64 = 4 * MIB;
/// Tepe disk: `.part` arşiv + açılan exe/DLL'ler bir an birlikte durur. Arşiv
/// ~4 MB, açılan içerik ~8 MB; 32 MiB güvenli üst sınırdır.
const WHISPER_ENGINE_PEAK_BYTES: u64 = 32 * MIB;
/// Tek arşiv girdisi üst sınırı. Gerçek girdiler birkaç MB'tır (exe + DLL'ler);
/// 200 MiB yalnızca şişirilmiş (zip-bomba) girdiye karşı gevşek bir emniyet
/// kemeridir — arşiv zaten sha256 ile pinlidir.
const WHISPER_ENGINE_ENTRY_CAP_BYTES: u64 = 200 * MIB;
/// SDL2.dll bilinçli olarak DIŞARIDA: sunucu tarafı transkript yolunda gereksiz
/// (bugünkü paketli dosya kümesiyle aynı).
const WHISPER_ENGINE_WANTED: &[&str] = &[
    WHISPER_ENGINE_ARCHIVE_EXE,
    "whisper.dll",
    "ggml.dll",
    "ggml-base.dll",
    "ggml-cpu.dll",
];
const WHISPER_ENGINE_APPROX_MB: u32 = 4;

// whisper modelleri: VERİ dosyasıdır (`Asset`), hedef `jointvault-models`. Düz
// dosyada tepe disk = indirilenin kendisidir: `.part` doğrulamadan sonra aynı
// birimde atomik taşınır, açılan ikinci bir kopya yoktur.
const WHISPER_MODEL_TINY_FILE: &str = "ggml-tiny.bin";
const WHISPER_MODEL_TINY_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin";
const WHISPER_MODEL_TINY_SHA256: &str =
    "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21";
const WHISPER_MODEL_TINY_BYTES: u64 = 74 * MIB;
const WHISPER_MODEL_TINY_MB: u32 = 74;

const WHISPER_MODEL_BASE_FILE: &str = "ggml-base.bin";
const WHISPER_MODEL_BASE_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const WHISPER_MODEL_BASE_SHA256: &str =
    "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
const WHISPER_MODEL_BASE_BYTES: u64 = 141 * MIB;
const WHISPER_MODEL_BASE_MB: u32 = 141;

const WHISPER_MODEL_SMALL_FILE: &str = "ggml-small.bin";
const WHISPER_MODEL_SMALL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";
const WHISPER_MODEL_SMALL_SHA256: &str =
    "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b";
const WHISPER_MODEL_SMALL_BYTES: u64 = 465 * MIB;
const WHISPER_MODEL_SMALL_MB: u32 = 465;

// --- llama.cpp motoru + CUDA çalışma zamanı (7c-3) ---
//
// İki AYRI arşivdir ve ortak bundle VERİLMEZ: biri `llama-server.exe` + CPU/CUDA
// backend DLL'leri, diğeri yalnızca cudart/cublas DLL'leridir. Ayrı paketlenince
// "hangi dosya eksik" sorusu da ayrı ve net kalır.

const LLAMA_ENGINE_BUNDLE: &str = "llama-engine";
const LLAMA_ENGINE_URL: &str =
    "https://github.com/ggml-org/llama.cpp/releases/download/b10964/llama-b10964-bin-win-cuda-12.4-x64.zip";
const LLAMA_ENGINE_SHA256: &str =
    "264f20d7ee3860aecca9ec12418357a9f3e80349a2b186f66c63859ded1a9593";
/// Kurulu mu? `ai.rs` bugün `binaries_dir()/llama-server.exe` varlığına bakıyor;
/// aynı işaret dosyası korunur ki "varsa atla" davranışı değişmesin.
const LLAMA_ENGINE_FILE: &str = "llama-server.exe";
const LLAMA_ENGINE_ARCHIVE_BYTES: u64 = 242 * MIB;
/// Tepe disk: `.part` arşiv doğrulanana kadar hedef klasörde durur ve çıkarma da
/// aynı klasöre yapılır. Arşiv ~242 MiB; CUDA backend DLL'i (`ggml-cuda.dll`) tek
/// başına arşivi katlar, CPU varyantları ve `libomp.dll` de eklenir. Cömert bir üst
/// sınır veriyoruz: kesin koruma, akış sırasındaki `WriteFailed`'dır.
const LLAMA_ENGINE_PEAK_BYTES: u64 = 1_200 * MIB;
/// İki llama arşivinin ortak girdi sınırı. Gerçek tek girdiler yüzlerce MB'tır
/// (`ggml-cuda.dll`, `cublasLt64_12.dll`); 2 GiB meşru derlemeyi geçirir, şişirilmiş
/// girdiyi reddeder. Arşiv zaten sha256 ile pinlidir — bu bir emniyet kemeridir.
const LLAMA_ARCHIVE_ENTRY_CAP_BYTES: u64 = 2 * 1024 * MIB;
const LLAMA_ENGINE_APPROX_MB: u32 = 242;

/// llama.cpp CUDA 12.4 Windows arşivinden çıkarılacak dosyalar.
///
/// Motor yalnızca ADI VERİLEN girdileri çıkarır (eşleşmeyen ad sessizce atlanır),
/// bu yüzden liste tam olmalıdır. `GGML_BACKEND_DL` açık: `ggml-*.dll` dosyaları
/// çalışma anında exe yanından yüklenir; bu yüzden CPU varyantlarının tamamı
/// listelenir (desteklenmeyen varyant yalnızca yüklenmez). `libomp.dll` OpenMP
/// çalışma zamanı; `llama.dll` ve `mtmd.dll` `llama-server.exe`'nin bağlı olduğu
/// kütüphanelerdir.
const LLAMA_ENGINE_WANTED: &[&str] = &[
    "llama-server.exe",
    "llama.dll",
    "mtmd.dll",
    "ggml.dll",
    "ggml-base.dll",
    "ggml-cpu.dll",
    "ggml-cuda.dll",
    "ggml-rpc.dll",
    "libomp.dll",
    "ggml-cpu-x64.dll",
    "ggml-cpu-sse42.dll",
    "ggml-cpu-sandybridge.dll",
    "ggml-cpu-ivybridge.dll",
    "ggml-cpu-piledriver.dll",
    "ggml-cpu-haswell.dll",
    "ggml-cpu-skylakex.dll",
    "ggml-cpu-cannonlake.dll",
    "ggml-cpu-cascadelake.dll",
    "ggml-cpu-icelake.dll",
    "ggml-cpu-cooperlake.dll",
    "ggml-cpu-zen4.dll",
    "ggml-cpu-alderlake.dll",
    "ggml-cpu-sapphirerapids.dll",
];

const LLAMA_CUDART_BUNDLE: &str = "llama-cudart";
const LLAMA_CUDART_URL: &str =
    "https://github.com/ggml-org/llama.cpp/releases/download/b10964/cudart-llama-bin-win-cuda-12.4-x64.zip";
const LLAMA_CUDART_SHA256: &str =
    "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6";
/// Kurulu mu? `ai.rs` bugün `binaries_dir()/cublas64_12.dll` varlığına bakıyor;
/// aynı işaret dosyası korunur ki "varsa atla" davranışı değişmesin.
const LLAMA_CUDART_FILE: &str = "cublas64_12.dll";
const LLAMA_CUDART_ARCHIVE_BYTES: u64 = 373 * MIB;
/// Tepe disk: arşiv ~373 MiB + açılan cublas/cublasLt (~1.1 GiB).
const LLAMA_CUDART_PEAK_BYTES: u64 = 1_500 * MIB;
const LLAMA_CUDART_APPROX_MB: u32 = 373;
/// CUDA çalışma zamanı arşivi: yalnızca üç DLL (workflow `cudart64_*`, `cublas64_*`
/// ve `cublasLt64_*` desenleriyle paketliyor). `ggml-cuda.dll` bunları exe yanında
/// arar.
const LLAMA_CUDART_WANTED: &[&str] = &["cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll"];

// --- AI modelleri (7c-3): VERİ dosyası, hedef `jointvault-models` ---

const AI_MODEL_LLM_BUNDLE: &str = "ai-model-llm";
const AI_MODEL_LLM_FILE: &str = "Qwen2.5-14B-Instruct-Q4_K_M.gguf";
const AI_MODEL_LLM_URL: &str =
    "https://huggingface.co/bartowski/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf";
const AI_MODEL_LLM_SHA256: &str =
    "e47ad95dad6ff848b431053b375adb5d39321290ea2c638682577dafca87c008";
/// Pin tablosu 8572 MiB diyor; aşağı yuvarlama YOK. ~8.5 GB'lik bir indirmede
/// dürüst `approx_mb`/`disk_required_bytes` olmadan disk kapısı işe yaramaz:
/// kullanıcı ya gereksiz engellenir ya da indirme sonunda "yer yok" görür.
const AI_MODEL_LLM_BYTES: u64 = 8572 * MIB;
const AI_MODEL_LLM_MB: u32 = 8572;

const AI_MODEL_EMBED_BUNDLE: &str = "ai-model-embed";
const AI_MODEL_EMBED_FILE: &str = "bge-m3-Q8_0.gguf";
const AI_MODEL_EMBED_URL: &str =
    "https://huggingface.co/gpustack/bge-m3-GGUF/resolve/main/bge-m3-Q8_0.gguf";
const AI_MODEL_EMBED_SHA256: &str =
    "950f4a8e5e19477a6d3c26d2f162233c20002c601f75e4b002e3239997821167";
const AI_MODEL_EMBED_BYTES: u64 = 605 * MIB;
const AI_MODEL_EMBED_MB: u32 = 605;

const SPECS: &[Spec] = &[
    Spec {
        id: "ffmpeg",
        label: "ffmpeg",
        approx_mb: FFMPEG_TOOLS_APPROX_MB,
        dest: Dest::Components,
        kind: Kind::Binary,
        downloaded_file: "ffmpeg.exe",
        sidecar: Some("ffmpeg"),
        version_arg: "-version",
        download: Some(DownloadSpec {
            bundle: FFMPEG_TOOLS_BUNDLE,
            url: FFMPEG_TOOLS_URL,
            sha256: FFMPEG_TOOLS_SHA256,
            expected_bytes: FFMPEG_TOOLS_ARCHIVE_BYTES,
            disk_required_bytes: FFMPEG_TOOLS_DISK_BYTES,
            payload: PayloadRule::Zip {
                wanted: FFMPEG_TOOLS_WANTED,
                max_entry_bytes: FFMPEG_ENTRY_CAP_BYTES,
            },
        }),
        post_install: None,
    },
    Spec {
        id: "ffprobe",
        label: "ffprobe",
        // ffprobe ayrı indirilmez: ffmpeg ile aynı arşivden gelir (bundle).
        approx_mb: FFMPEG_TOOLS_APPROX_MB,
        dest: Dest::Components,
        kind: Kind::Binary,
        downloaded_file: "ffprobe.exe",
        sidecar: Some("ffprobe"),
        version_arg: "-version",
        download: Some(DownloadSpec {
            bundle: FFMPEG_TOOLS_BUNDLE,
            url: FFMPEG_TOOLS_URL,
            sha256: FFMPEG_TOOLS_SHA256,
            expected_bytes: FFMPEG_TOOLS_ARCHIVE_BYTES,
            disk_required_bytes: FFMPEG_TOOLS_DISK_BYTES,
            payload: PayloadRule::Zip {
                wanted: FFMPEG_TOOLS_WANTED,
                max_entry_bytes: FFMPEG_ENTRY_CAP_BYTES,
            },
        }),
        post_install: None,
    },
    Spec {
        id: "yt-dlp",
        label: "yt-dlp",
        approx_mb: 17,
        dest: Dest::Components,
        kind: Kind::Binary,
        downloaded_file: "yt-dlp.exe",
        sidecar: Some("yt-dlp"),
        version_arg: "--version",
        // yt-dlp paketle GÖMÜLÜ kalır (roadmap §7): indirme kaynağı yok.
        download: None,
        post_install: None,
    },
    Spec {
        id: "whisper",
        label: "Whisper motoru",
        approx_mb: WHISPER_ENGINE_APPROX_MB,
        // Motor bir çalıştırılabilirdir; 7c-3'ten itibaren `components/` altında
        // aranır (whisper.rs eski exe-yanı yolundan buraya delege eder).
        dest: Dest::Components,
        kind: Kind::Binary,
        downloaded_file: WHISPER_ENGINE_FILE,
        sidecar: Some("whisper"),
        version_arg: "--help",
        download: Some(DownloadSpec {
            bundle: WHISPER_ENGINE_BUNDLE,
            url: WHISPER_ENGINE_URL,
            sha256: WHISPER_ENGINE_SHA256,
            expected_bytes: WHISPER_ENGINE_ARCHIVE_BYTES,
            disk_required_bytes: WHISPER_ENGINE_PEAK_BYTES,
            payload: PayloadRule::Zip {
                wanted: WHISPER_ENGINE_WANTED,
                max_entry_bytes: WHISPER_ENGINE_ENTRY_CAP_BYTES,
            },
        }),
        // Arşiv `whisper-cli.exe` getirir, çalışma-anı adı `whisper.exe` olmalıdır.
        // `to` alanı `downloaded_file` ile AYNI sabitten gelir (kayma olmaz).
        post_install: Some(PostInstall::Rename {
            from: WHISPER_ENGINE_ARCHIVE_EXE,
            to: WHISPER_ENGINE_FILE,
        }),
    },
    Spec {
        id: "whisper-model-tiny",
        label: "Whisper modeli (tiny)",
        approx_mb: WHISPER_MODEL_TINY_MB,
        dest: Dest::Models,
        kind: Kind::Asset,
        downloaded_file: WHISPER_MODEL_TINY_FILE,
        sidecar: None,
        version_arg: ASSET_VERSION_ARG,
        download: Some(DownloadSpec {
            bundle: "whisper-model-tiny",
            url: WHISPER_MODEL_TINY_URL,
            sha256: WHISPER_MODEL_TINY_SHA256,
            expected_bytes: WHISPER_MODEL_TINY_BYTES,
            disk_required_bytes: WHISPER_MODEL_TINY_BYTES,
            payload: PayloadRule::Raw {
                file_name: WHISPER_MODEL_TINY_FILE,
            },
        }),
        post_install: None,
    },
    Spec {
        id: "whisper-model-base",
        label: "Whisper modeli (base)",
        approx_mb: WHISPER_MODEL_BASE_MB,
        dest: Dest::Models,
        kind: Kind::Asset,
        downloaded_file: WHISPER_MODEL_BASE_FILE,
        sidecar: None,
        version_arg: ASSET_VERSION_ARG,
        download: Some(DownloadSpec {
            bundle: "whisper-model-base",
            url: WHISPER_MODEL_BASE_URL,
            sha256: WHISPER_MODEL_BASE_SHA256,
            expected_bytes: WHISPER_MODEL_BASE_BYTES,
            disk_required_bytes: WHISPER_MODEL_BASE_BYTES,
            payload: PayloadRule::Raw {
                file_name: WHISPER_MODEL_BASE_FILE,
            },
        }),
        post_install: None,
    },
    Spec {
        id: "whisper-model-small",
        label: "Whisper modeli (small)",
        approx_mb: WHISPER_MODEL_SMALL_MB,
        dest: Dest::Models,
        kind: Kind::Asset,
        downloaded_file: WHISPER_MODEL_SMALL_FILE,
        sidecar: None,
        version_arg: ASSET_VERSION_ARG,
        download: Some(DownloadSpec {
            bundle: "whisper-model-small",
            url: WHISPER_MODEL_SMALL_URL,
            sha256: WHISPER_MODEL_SMALL_SHA256,
            expected_bytes: WHISPER_MODEL_SMALL_BYTES,
            disk_required_bytes: WHISPER_MODEL_SMALL_BYTES,
            payload: PayloadRule::Raw {
                file_name: WHISPER_MODEL_SMALL_FILE,
            },
        }),
        post_install: None,
    },
    Spec {
        id: "llama-engine",
        label: "llama-server motoru",
        approx_mb: LLAMA_ENGINE_APPROX_MB,
        dest: Dest::Binaries,
        kind: Kind::Binary,
        downloaded_file: LLAMA_ENGINE_FILE,
        sidecar: None,
        // `llama-server --version` sürüm + derleme bilgisini basıp ÇIKAR (asıl
        // sunucu başlatılmaz): probe için güvenli, gerçek bir sürüm sorgusu.
        version_arg: "--version",
        download: Some(DownloadSpec {
            bundle: LLAMA_ENGINE_BUNDLE,
            url: LLAMA_ENGINE_URL,
            sha256: LLAMA_ENGINE_SHA256,
            expected_bytes: LLAMA_ENGINE_ARCHIVE_BYTES,
            disk_required_bytes: LLAMA_ENGINE_PEAK_BYTES,
            payload: PayloadRule::Zip {
                wanted: LLAMA_ENGINE_WANTED,
                max_entry_bytes: LLAMA_ARCHIVE_ENTRY_CAP_BYTES,
            },
        }),
        post_install: None,
    },
    Spec {
        id: "llama-cudart",
        label: "CUDA çalışma zamanı (llama)",
        approx_mb: LLAMA_CUDART_APPROX_MB,
        dest: Dest::Binaries,
        // DLL'ler ÇALIŞTIRILAMAZ: tür bilinçli olarak `Asset`tir ki kurulduğunda
        // "kullanılabilir" sayılsın (`is_usable`). `Binary` işaretlenseydi hiçbir
        // zaman koşamadığı için arayüz kalıcı "çalıştırılamıyor" der ve başarılı
        // kurulum başarısız sanılırdı.
        kind: Kind::Asset,
        downloaded_file: LLAMA_CUDART_FILE,
        sidecar: None,
        version_arg: ASSET_VERSION_ARG,
        download: Some(DownloadSpec {
            bundle: LLAMA_CUDART_BUNDLE,
            url: LLAMA_CUDART_URL,
            sha256: LLAMA_CUDART_SHA256,
            expected_bytes: LLAMA_CUDART_ARCHIVE_BYTES,
            disk_required_bytes: LLAMA_CUDART_PEAK_BYTES,
            payload: PayloadRule::Zip {
                wanted: LLAMA_CUDART_WANTED,
                max_entry_bytes: LLAMA_ARCHIVE_ENTRY_CAP_BYTES,
            },
        }),
        post_install: None,
    },
    Spec {
        id: "ai-model-llm",
        label: "Qwen 2.5 14B (sohbet)",
        approx_mb: AI_MODEL_LLM_MB,
        dest: Dest::Models,
        kind: Kind::Asset,
        downloaded_file: AI_MODEL_LLM_FILE,
        sidecar: None,
        version_arg: ASSET_VERSION_ARG,
        download: Some(DownloadSpec {
            bundle: AI_MODEL_LLM_BUNDLE,
            url: AI_MODEL_LLM_URL,
            sha256: AI_MODEL_LLM_SHA256,
            expected_bytes: AI_MODEL_LLM_BYTES,
            disk_required_bytes: AI_MODEL_LLM_BYTES,
            payload: PayloadRule::Raw {
                file_name: AI_MODEL_LLM_FILE,
            },
        }),
        post_install: None,
    },
    Spec {
        id: "ai-model-embed",
        label: "BGE-M3 (gömme)",
        approx_mb: AI_MODEL_EMBED_MB,
        dest: Dest::Models,
        kind: Kind::Asset,
        downloaded_file: AI_MODEL_EMBED_FILE,
        sidecar: None,
        version_arg: ASSET_VERSION_ARG,
        download: Some(DownloadSpec {
            bundle: AI_MODEL_EMBED_BUNDLE,
            url: AI_MODEL_EMBED_URL,
            sha256: AI_MODEL_EMBED_SHA256,
            expected_bytes: AI_MODEL_EMBED_BYTES,
            disk_required_bytes: AI_MODEL_EMBED_BYTES,
            payload: PayloadRule::Raw {
                file_name: AI_MODEL_EMBED_FILE,
            },
        }),
        post_install: None,
    },
];

/// Bileşenlerin indirildiği klasör (yoksa oluşturur).
pub fn components_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("components");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Hedefin tam yolu (yoksa oluşturur).
///
/// `Components` mevcut `components_dir()`'dir. `Models`/`Binaries` için klasör ADI
/// bugünkü adıyla korunur (bkz. `Dest` notu ve dosya başı): whisper/AI dosyaları
/// orada kurulu ve taşımak onları öksüz bırakırdı. Bugün `ai::models_dir`,
/// `whisper::models_dir` ve `health.rs` bu yolu kopyalıyor; subtask 03/04 onları
/// BURAYA delege edecek — böylece tek kaynak olur.
pub fn dest_dir(app: &AppHandle, dest: Dest) -> Result<PathBuf, String> {
    match dest {
        Dest::Components => components_dir(app),
        Dest::Models => app_data_subdir(app, MODELS_DIR_NAME, "Model klasörü açılamadı"),
        Dest::Binaries => app_data_subdir(app, BINARIES_DIR_NAME, "Binary klasörü açılamadı"),
    }
}

/// `app_data_dir()/<ad>` alt klasörü (yoksa oluşturur). Hata metni çağıranın
/// bağlamını taşır; teknik ayrıntı (`e`) kullanıcıya anlamlı gelen biçimde eklenir.
fn app_data_subdir(app: &AppHandle, name: &str, error: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(name);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{error}: {e}"))?;
    Ok(dir)
}

/// Uygulamanın yanındaki gömülü sidecar yolu.
///
/// İki ad biçimi de denenir, çünkü ikisi de gerçekte var:
///   - `<ad>.exe` — Tauri'nin hedef klasöre/bundle'a kopyaladığı biçim
///   - `<ad>-<hedef-üçlü>.exe` — kaynak `binaries/` klasöründeki biçim
/// Üçlüyü elle kurmak yerine klasör taranır: başka platformda da doğru dosya bulunur.
fn bundled_path(name: &str) -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let plain = format!("{name}.exe");
    let prefixed = format!("{name}-");

    std::fs::read_dir(&dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            if !path.is_file() {
                return false;
            }
            let file = path
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();
            file == plain || (file.starts_with(&prefixed) && file.ends_with(".exe"))
        })
}

/// Kayıttaki bir bileşeni id ile bul (saf; I/O yok).
///
/// Karşılaştırma BÜYÜK/KÜÇÜK HARF DUYARLIDIR: id'ler tel sözleşmesidir (`ffmpeg`),
/// "FFMPEG" diye bir bileşen yoktur — uydurma eşleşme yapmayız, `None` döneriz.
pub fn spec_for(id: &str) -> Option<&'static Spec> {
    SPECS.iter().find(|spec| spec.id == id)
}

/// Hedef dizinde beklenen dosya var mı? Yalnızca dosya VARLIĞINA bakar; hiçbir şey
/// çalıştırmaz (bkz. `probe_version`, o ayrı ve isteğe bağlı adımdır).
fn dir_path(app: &AppHandle, dest: Dest, file_name: &str) -> Option<PathBuf> {
    let path = dest_dir(app, dest).ok()?.join(file_name);
    path.is_file().then_some(path)
}

/// Bir bileşeni çöz: önce HEDEF dizin, sonra (yalnızca gömülü sidecar'ı olanlarda)
/// uygulamanın yanındaki kopya.
///
/// Gömülü arama yalnızca `sidecar` ilan edilmişse denenir; o alan yalnızca exe
/// yanında paketlenen bileşenlerde doludur. Böylece bir model dosyası asla "gömülü
/// araç" gibi çözülmez. `Components` hedefinde sıra bugünküyle AYNIDIR:
/// **indirilenler → gömülü**.
fn resolve(app: &AppHandle, spec: &Spec) -> Option<(PathBuf, ComponentSource)> {
    if let Some(path) = dir_path(app, spec.dest, spec.downloaded_file) {
        return Some((path, ComponentSource::Downloaded));
    }
    spec.sidecar
        .and_then(bundled_path)
        .map(|path| (path, ComponentSource::Bundled))
}

/// Hedef farkı gözetmeksizin "kurulu mu?" sorusunu cevaplayan çözümleme.
///
/// `resolve_tool` YALNIZCA çalıştırılabilirleri verir; bu fonksiyon Models dest'indeki
/// veri dosyasını da bulur. `is_installed` (indirmeyi atlama kapısı) bunu kullanır:
/// aksi hâlde kurulu bir `.gguf` her seferinde yeniden indirilirdi.
pub fn resolve_component(app: &AppHandle, id: &str) -> Option<(PathBuf, ComponentSource)> {
    resolve(app, spec_for(id)?)
}

/// Çözümlenmiş bir ARACIN yolunu ve nereden geldiğini ver.
///
/// `resolve`'un dışa açılan yüzü: arama sırasını birebir korur
/// (**indirilenler → gömülü**) ve **hiçbir şey çalıştırmaz** — yalnızca dosya
/// varlığına bakar. Medya komutları işe başlamadan önce bunu çağıracak; bu yüzden
/// ucuz olması tercih değil, tasarım gereği.
///
/// `Asset` türündeki hiçbir bileşen buradan GEÇMEZ: veri dosyası bir komuta yol
/// olarak verilmez (yanlışlıkla çalıştırma yolu kapanır).
pub fn resolve_tool(app: &AppHandle, id: &str) -> Option<(PathBuf, ComponentSource)> {
    let spec = spec_for(id)?;
    if spec.kind != Kind::Binary {
        return None;
    }
    resolve(app, spec)
}

/// Bileşen kurulu mu (hedef dizin → gömülü)? Kuruluysa indirme atlanır.
///
/// Tür ayrımı YAPMAZ: modeller de "kurulu" olabilir. İndirme kararı bunu kullanır;
/// çalıştırma kararı `resolve_tool` üzerinden yürür.
pub fn is_installed(app: &AppHandle, id: &str) -> bool {
    resolve_component(app, id).is_some()
}

// --- Eksik bileşen sinyali --------------------------------------------------
//
// Sözleşme: bir komut aracı çözemezse `Err` içinde **yapılandırılmış** bir sinyal
// döner. Arayüz öneki tanıyıp kurulum akışını açar; ham sinyal kullanıcıya
// GÖSTERİLMEZ — kullanıcı metni ayrı olarak `missing_message`'dan gelir.
//
// Neden önek, neden tek yerde? Bir Tauri komutu yalnızca `Err(String)` dönebilir;
// "bileşen eksik" ile "başka bir hata" ancak metinden ayırt edilebilir. Önek
// kopyalanırsa üretici ile ayrıştırıcı zamanla ayrışır ve arayüz sessizce kör
// kalır (kullanıcı ham makine metnini görür). Bu yüzden üretim tek noktada
// (`missing_signal`) ve sabit tek yerde (`MISSING_PREFIX`) tutulur.
//
// NOT: bu yüzey 7c'nin paralel çağrı yerleri (health/download/medya komutları)
// bağlanana kadar normal derlemede kullanılmaz; o ana kadar dead_code uyarısı
// burada bilinçli olarak bastırılır. Testler saf parçaları zaten kapsıyor.

/// Eksik bileşen sinyalinin öneki. Makine-okunur; kullanıcıya GÖSTERİLMEZ.
#[allow(dead_code)]
pub const MISSING_PREFIX: &str = "BILESEN_EKSIK:";

/// Sinyalde id'den sonra gelen kullanıcı metnini ayıran karakter.
const MISSING_DETAIL_SEP: char = '\n';

/// Sinyali üret (saf): `BILESEN_EKSIK:<id>` + satır sonu + kullanıcı metni.
///
/// Ayrıntı satırı neden gömülü? Arayüz öneki soymayı henüz bilmiyorsa (7c-2
/// gelmeden) kullanıcı en azından **okunabilir bir cümle** görür; çıplak makine
/// metni görmez. `parse_missing_signal` yalnızca ilk satırı (id'yi) okur.
///
/// `id` kırpılır. Boş id yalnızca öneki verir; `parse_missing_signal` bunu
/// reddeder — yani bozuk sinyal asla geçerli sayılmaz (fail closed). Üretim tek
/// yerde olduğundan önek kayamaz.
#[allow(dead_code)]
pub fn missing_signal(id: &str) -> String {
    let id = id.trim();
    format!(
        "{MISSING_PREFIX}{id}{MISSING_DETAIL_SEP}{}",
        missing_message(id)
    )
}

/// Sinyalin ikinci satırı: kullanıcıya gösterilecek metin (varsa).
#[allow(dead_code)]
pub fn parse_missing_detail(error: &str) -> Option<String> {
    error
        .trim()
        .strip_prefix(MISSING_PREFIX)?
        .split_once(MISSING_DETAIL_SEP)
        .map(|(_, detail)| detail.trim().to_string())
        .filter(|detail| !detail.is_empty())
}

/// Sinyali ayrıştır (saf): `BILESEN_EKSIK:ffmpeg` → `Some("ffmpeg")`.
///
/// Önek **başta** olmalı. Yalnızca **ilk satır** (id) okunur; ayrıntı satırı
/// yok sayılır. Hem metnin hem id'nin kenar boşlukları hoş görülür.
/// Eşleşmeyen ya da önekten sonrası boş kalan girdi `None` döner (panik yok).
#[allow(dead_code)]
pub fn parse_missing_signal(error: &str) -> Option<String> {
    let rest = error.trim().strip_prefix(MISSING_PREFIX)?;
    let id = rest.lines().next().unwrap_or("").trim();
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

/// `parse_missing_signal`'ın kısa adı (7c köprü/arayüz sözleşmesi).
#[allow(dead_code)]
pub fn parse_missing(error: &str) -> Option<String> {
    parse_missing_signal(error)
}

/// Çalıştırılabilir bir aracın yolunu ZORUNLU kıl.
///
/// Yoksa tam olarak `BILESEN_EKSIK:<id>` biçiminde sinyal döner. Metin
/// `missing_signal`'dan geldiği için çağrı yerleri öneki asla kendileri yazmaz ve
/// aynı id her zaman aynı hatayı verir. **Süreç başlatılmaz**: yalnızca varlık
/// kontrolü (`resolve_tool`), bu yüzden her medya komutunun başında çağrılabilir.
#[allow(dead_code)]
pub fn require_tool(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    resolve_tool(app, id)
        .map(|(path, _)| path)
        .ok_or_else(|| missing_signal(id))
}

/// Bir bileşeni GERÇEKTEN çalıştırıp sürümünü okur: kullanılabilirliğin ölçütü.
///
/// Neden tek yer? `health_check` ile `components_status` aynı soruya ("çalışıyor mu")
/// iki ayrı kod yolundan cevap verirse zamanla ayrışır — 7a'da tam olarak bu
/// yakalanmıştı (`whisper` için biri yalnızca dosyaya bakıyordu, diğeri `--help`
/// çalıştırıyordu). İkisi de bu fonksiyonu çağırır; ayrışma **inşa gereği** imkânsız.
#[allow(dead_code)]
pub async fn probe_component(app: &AppHandle, id: &str) -> (bool, Option<String>) {
    let Some(spec) = spec_for(id) else {
        return (false, None);
    };
    // Asset ASLA çalıştırılmaz: veri dosyasının "sürümü" yoktur. Bu yüzden prob
    // sessizce (false, None) döner — bu bir hata değil, türün doğasıdır.
    if spec.kind != Kind::Binary {
        return (false, None);
    }
    let Some((path, _)) = resolve(app, spec) else {
        return (false, None);
    };
    match probe_version(app, &path, spec.version_arg).await {
        Some(version) => (true, Some(version)),
        None => (false, None),
    }
}

/// Kurulu bir bileşen KULLANILABİLİR mi? Bu, arayüz sözleşmesinin birebir aynısıdır:
/// `isUsable = installed && (kind === 'asset' || runnable)`.
///
/// `Asset`'te `runnable` KASITLI olarak `false`'tur (veri dosyası çalıştırılmaz ve
/// `version` de `None`'dur — 7a sondası `runnable === Boolean(version)` bekler).
/// Bu yüzden tür kararı YALNIZCA `kind` ile verilir; `runnable`'a bakan bir kontrol
/// kurulu bir `.gguf`'u "eksik/çalıştırılamıyor" sanar. Bu fonksiyon o kuralın tek,
/// saf ve test edilebilir tanımıdır.
#[allow(dead_code)] // arayüz tarafı (subtask 05) ve testler kullanır
pub fn is_usable(kind: Kind, installed: bool, runnable: bool) -> bool {
    installed && (kind == Kind::Asset || runnable)
}

/// Kullanıcıya gösterilecek Türkçe mesaj — öneki İÇERMEZ.
///
/// Bilinen her id için somut bir sonraki adımı söyler. Bilinmeyen id'de ne
/// olduğunu uydurmaz; "kayıtlı değil ya da kurulu değil" diyerek dürüst kalır.
#[allow(dead_code)]
pub fn missing_message(id: &str) -> String {
    match id {
        "ffmpeg" => "ffmpeg kurulu değil. Dönüştürme, GIF, birleştirme, sessizlik, önizleme ve altyazı işlemleri bu aracı kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.".to_string(),
        "ffprobe" => "ffprobe kurulu değil. Medya süresi ve biçim bilgisi bu araçla okunur; ffmpeg ile aynı pakette gelir. Ayarlar → Bileşenler bölümünden indirebilirsin.".to_string(),
        "yt-dlp" => "yt-dlp kurulu değil. İndirme Yöneticisi bu araç olmadan çalışamaz; uygulamayla birlikte gelir, eksikse kurulumu onarman gerekir.".to_string(),
        // 7c-3: whisper artık Bileşenler'den kurulabilir; mesaj tek yöneticiyi
        // gösterir (Ayarlar → Konuşma bölümü de çalışmaya devam eder).
        "whisper" => "Whisper motoru kurulu değil. Altyazı işlemleri bu motoru kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.".to_string(),
        "whisper-model-tiny" => "Whisper 'tiny' modeli kurulu değil. Hızlı taslak transkriptler bu modeli kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.".to_string(),
        "whisper-model-base" => "Whisper 'base' modeli kurulu değil. Dengeli hız/doğruluk için kullanılan transkript modelidir; Ayarlar → Bileşenler bölümünden indirebilirsin.".to_string(),
        "whisper-model-small" => "Whisper 'small' modeli kurulu değil. Daha yüksek doğruluklu transkriptler bu modeli kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.".to_string(),
        "llama-engine" => "llama-server motoru kurulu değil. Yerel sohbet, özetleme ve etiketleme bu motoru kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.".to_string(),
        "llama-cudart" => "CUDA çalışma zamanı kütüphaneleri (cudart/cublas) kurulu değil. llama-server'ın GPU'da çalışması bunlara bağlıdır; Ayarlar → Bileşenler bölümünden indirebilirsin.".to_string(),
        "ai-model-llm" => "Qwen 2.5 14B sohbet modeli kurulu değil. Yerel sohbet ve özetleme bu modeli kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.".to_string(),
        "ai-model-embed" => "BGE-M3 gömme modeli kurulu değil. Anlamsal arama ve etiketleme bu modeli kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.".to_string(),
        _ => format!("'{id}' bileşeni kayıtlı değil ya da kurulu değil. Ayarlar → Bileşenler bölümünden bileşen durumunu denetleyebilirsin."),
    }
}

/// Bileşenin pinlenmiş indirme kaynağı. `None` → bu id bu komuttan indirilemez.
///
/// `downloadable` yalnızca buradan (`download.is_some()`) türer; başka hiçbir yerde
/// "indirilebilir" hükmü verilmez, böylece iki alan ayrışamaz.
pub fn download_spec(id: &str) -> Option<&'static DownloadSpec> {
    spec_for(id)?.download.as_ref()
}

/// Kaynağı olmayan bir id için dürüst hata metni. Uydurma yok: "bu komuttan
/// indirilemiyor" der. Bilinmeyen id de (spec yok) aynı yola düşer — "kayıtlı değil"
/// demek yerine dürüst biçimde reddeder.
#[allow(dead_code)] // yalnızca tek kurulum yolu (subtask 02) çağırır
fn not_downloadable(id: &str) -> String {
    format!("'{id}' bileşeni bu komuttan indirilemiyor.")
}

/// Kurulumun KAYITTAN çözülmüş tarifi: indirme pini + hedef dizin + kurulum-sonrası
/// kanca. `DownloadPlan`'ı MOTOR kurar (`component_download::plan_from_spec`); kayıt
/// motorun tiplerine bağımlı olmaz ve plan kurma TEK yerde kalır.
///
/// Tek yol (subtask 02): `component_download::install_component(app, id, job_id)`
/// bunu çağırır → plan → `run_download` → `apply_post_install`. whisper/AI eski
/// komutları da aynı yola delege edilerek kopya pin/plan kalmaz.
#[allow(dead_code)] // tek yol (subtask 02) bağlanana kadar
pub struct InstallRecipe {
    pub spec: &'static Spec,
    pub download: &'static DownloadSpec,
    pub dest_dir: PathBuf,
    pub post_install: Option<PostInstall>,
}

/// Bir id'yi kurulum tarifine çöz. Kaynağı olmayan ya da kayıtlı olmayan id'de
/// dürüst hata döner; geçerli id'de hedef dizini hazırlar. **İndirme YAPMAZ.**
#[allow(dead_code)] // tek yol (subtask 02) bağlanana kadar
pub fn install_recipe(app: &AppHandle, id: &str) -> Result<InstallRecipe, String> {
    let spec = spec_for(id).ok_or_else(|| not_downloadable(id))?;
    // Kaynağın var olup olmadığı kararı TEK yerde (`download_spec`) verilir; burada
    // `spec.download`'a doğrudan bakmak ikinci bir karar noktası olurdu.
    let download = download_spec(id).ok_or_else(|| not_downloadable(id))?;
    let dest_dir = dest_dir(app, spec.dest)?;
    Ok(InstallRecipe {
        spec,
        download,
        dest_dir,
        post_install: spec.post_install,
    })
}

/// Kurulum-sonrası kancayı uygula (dosya sistemi işlemi).
///
/// `None` → HİÇBİR ŞEY yapılmaz; davranış bugünküyle aynıdır. `Rename`: arşiv `from`
/// adını bırakır, çalışma-anı `to` adını bekler. Hedef varsa ÖNCE silinir çünkü
/// Windows'ta `rename` mevcut dosyanın üzerine yazmaz. `from` yoksa kurulum yarım
/// demektir: sessizce geçmek yerine hata döneriz (sessiz yutma yasak).
#[allow(dead_code)] // kurulum-sonrası kanca: yalnız whisper motoru kullanıyor
pub fn apply_post_install(dir: &Path, hook: Option<PostInstall>) -> Result<(), String> {
    let Some(PostInstall::Rename { from, to }) = hook else {
        return Ok(());
    };
    let source = dir.join(from);
    if !source.is_file() {
        return Err(format!("Kurulum tamamlanmadı: {from} bulunamadı."));
    }
    let target = dir.join(to);
    let _ = std::fs::remove_file(&target);
    std::fs::rename(&source, &target).map_err(|e| format!("Kurulum tamamlanamadı ({to}): {e}"))?;
    if !target.is_file() {
        return Err(format!("Kurulum tamamlanamadı: {to} oluşmadı."));
    }
    Ok(())
}

/// Çalıştırılabilir bir dosyaya `-version` benzeri bir argüman verip ilk satırı okur.
/// Çalışmazsa `None`: "kurulu" demek için dosyanın var olması yetmez.
async fn probe_version(app: &AppHandle, path: &Path, arg: &str) -> Option<String> {
    let command = app.shell().command(path.to_string_lossy().to_string());
    let (mut rx, _child) = command.args([arg]).spawn().ok()?;

    let mut first: Option<String> = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                if first.is_none() {
                    let text = String::from_utf8_lossy(&line);
                    let line = text.lines().next().unwrap_or("").trim();
                    if !line.is_empty() {
                        first = Some(line.to_string());
                    }
                }
            }
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }
    first
}

/// Status satırını kur (saf; `AppHandle` GEREKMEZ).
///
/// Tek eşleme: üretim (`components_status`) ile testler aynı fonksiyonu kullanır,
/// böylece JSON şekli ile testler ayrışamaz. `version` çağırandan gelir — Asset'te
/// her zaman `None`'dur, bu yüzden `runnable` de `false` olur.
fn build_status(
    spec: &Spec,
    resolved: Option<(&Path, ComponentSource)>,
    version: Option<String>,
) -> ComponentStatus {
    ComponentStatus {
        id: spec.id.to_string(),
        label: spec.label.to_string(),
        approx_mb: spec.approx_mb,
        kind: spec.kind,
        installed: resolved.is_some(),
        // Asset'te KASITLI false: veri dosyası çalıştırılmaz ve sürümü okunmaz.
        // Tür kararı arayüzde `kind` ile verilir (bkz. `is_usable`).
        runnable: spec.kind == Kind::Binary && version.is_some(),
        path: resolved.map(|(path, _)| path.to_string_lossy().to_string()),
        source: resolved.map(|(_, source)| source),
        version,
        // Kaynak yoksa indirilebilir de yoktur; iki alan asla ayrışmaz.
        downloadable: spec.download.is_some(),
        bundle: spec
            .download
            .as_ref()
            .map(|download| download.bundle.to_string()),
        framework: spec
            .download
            .as_ref()
            .map(|download| download.framework().to_string()),
    }
}

/// Tüm bileşenlerin GERÇEK durumu.
#[tauri::command]
pub async fn components_status(app: AppHandle) -> Result<Vec<ComponentStatus>, String> {
    let mut out = Vec::with_capacity(SPECS.len());
    for spec in SPECS {
        let resolved = resolve(&app, spec);
        // Sürüm YALNIZCA çalıştırılabilirlerde sorulur: veri dosyası asla başlatılmaz.
        let version = match (&resolved, spec.kind) {
            (Some((path, _)), Kind::Binary) => probe_version(&app, path, spec.version_arg).await,
            _ => None,
        };
        out.push(build_status(
            spec,
            resolved.as_ref().map(|(path, source)| (path.as_path(), *source)),
            version,
        ));
    }
    Ok(out)
}

/// Bileşen klasörünün yolu (arayüzden açılabilir).
#[tauri::command]
pub fn components_path(app: AppHandle) -> Result<String, String> {
    Ok(components_dir(&app)?.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kayıttaki TÜM id'ler: sinyal/mesaj/round-trip testleri bu listeyi gezer.
    const KNOWN_IDS: &[&str] = &[
        "ffmpeg",
        "ffprobe",
        "yt-dlp",
        "whisper",
        "whisper-model-tiny",
        "whisper-model-base",
        "whisper-model-small",
        "llama-engine",
        "llama-cudart",
        "ai-model-llm",
        "ai-model-embed",
    ];

    /// 7c-3 ÖNCESİ dört bileşen: hepsi `Components` hedefinde `Binary`'dir ve
    /// davranışları DEĞİŞMEZ (bu liste regresyon çivisidir).
    const LEGACY_BINARY_IDS: &[&str] = &["ffmpeg", "ffprobe", "yt-dlp", "whisper"];

    /// 7c-3'te kayda eklenen, Bileşenler ekranından indirilebilen id'ler.
    const NEW_IDS: &[&str] = &[
        "whisper-model-tiny",
        "whisper-model-base",
        "whisper-model-small",
        "llama-engine",
        "llama-cudart",
        "ai-model-llm",
        "ai-model-embed",
    ];

    /// Yeni id'lerden VERİ dosyası olanlar (`Asset`): çalıştırılamaz, sürümü yok.
    const NEW_ASSET_IDS: &[&str] = &[
        "whisper-model-tiny",
        "whisper-model-base",
        "whisper-model-small",
        "llama-cudart",
        "ai-model-llm",
        "ai-model-embed",
    ];

    // --- sinyal üretme/ayrıştırma (saf; AppHandle gerekmez) ---

    #[test]
    fn prefix_is_exactly_the_agreed_wire_marker() {
        // Tel formatı sabittir: arayüz bu öneki tanır, bu yüzden burada çivilenir.
        // (Üretimde tek tanım yeri `MISSING_PREFIX`; literal yalnızca testte.)
        assert_eq!(MISSING_PREFIX, "BILESEN_EKSIK:");
    }

    #[test]
    fn signal_round_trips_every_known_id() {
        for id in KNOWN_IDS {
            let signal = missing_signal(id);
            // Tel formatı: önek + id, ardından ayrıntı satırı (kullanıcı metni).
            assert!(signal.starts_with(&format!("{MISSING_PREFIX}{id}")));
            assert_eq!(parse_missing_signal(&signal).as_deref(), Some(*id));
            assert_eq!(parse_missing(&signal).as_deref(), Some(*id));
            // Ayrıntı satırı tam olarak kullanıcı mesajıdır ve önek İÇERMEZ.
            assert_eq!(parse_missing_detail(&signal), Some(missing_message(id)));
            assert!(!parse_missing_detail(&signal).unwrap_or_default().contains(MISSING_PREFIX));
        }
    }

    #[test]
    fn signal_stays_readable_even_if_nobody_strips_the_prefix() {
        // 7c-2 arayüzü öneki soymadan önce bile kullanıcı çıplak makine metni
        // görmez: ikinci satır okunabilir bir cümledir.
        let signal = missing_signal("ffmpeg");
        let detail = signal.lines().nth(1).unwrap_or("");
        assert!(!detail.is_empty(), "sinyal çıplak kalmamalı: {signal:?}");
        assert!(detail.contains("ffmpeg"));
    }

    #[test]
    fn parse_missing_detail_is_none_without_a_detail_line() {
        assert_eq!(parse_missing_detail("BILESEN_EKSIK:ffmpeg"), None);
        assert_eq!(parse_missing_detail("BILESEN_EKSIK:ffmpeg\n  "), None);
        assert_eq!(parse_missing_detail("bir şey"), None);
    }

    #[test]
    fn signal_trims_id_so_round_trip_stays_clean() {
        assert!(missing_signal("  ffmpeg  ").starts_with("BILESEN_EKSIK:ffmpeg"));
        assert_eq!(
            parse_missing_signal(&missing_signal("  ffmpeg ")).as_deref(),
            Some("ffmpeg")
        );
    }

    #[test]
    fn parse_tolerates_surrounding_whitespace() {
        assert_eq!(
            parse_missing("  BILESEN_EKSIK:  ffmpeg  ").as_deref(),
            Some("ffmpeg")
        );
        assert_eq!(
            parse_missing("\nBILESEN_EKSIK:ffprobe\n").as_deref(),
            Some("ffprobe")
        );
        assert_eq!(
            parse_missing("BILESEN_EKSIK: yt-dlp\nkurulu değil").as_deref(),
            Some("yt-dlp")
        );
    }

    #[test]
    fn parse_rejects_empty_id_after_prefix() {
        assert_eq!(parse_missing("BILESEN_EKSIK:"), None);
        assert_eq!(parse_missing("BILESEN_EKSIK:   "), None);
        assert_eq!(parse_missing_signal("  BILESEN_EKSIK: \t "), None);
    }

    #[test]
    fn parse_returns_none_for_non_matching_input() {
        // Önek başta olmalı; harf büyüklüğü duyarlı; önek olmadan eşleşme yok.
        for input in [
            "",
            "   ",
            "ffmpeg",
            "BILESEN_EKSIK",
            "bozuk BILESEN_EKSIK:ffmpeg",
            "bilesen_eksik:ffmpeg",
        ] {
            assert_eq!(parse_missing(input), None, "girdi: {input:?}");
        }
    }

    // --- kullanıcıya dönük mesaj ---

    #[test]
    fn missing_messages_are_non_empty_and_never_leak_prefix() {
        for id in KNOWN_IDS {
            let message = missing_message(id);
            assert!(!message.trim().is_empty(), "boş mesaj: {id}");
            assert!(!message.contains(MISSING_PREFIX), "önek sızdı: {message}");
        }
        // Bilinmeyen id de dürüst ve öneksiz olmalı (uydurma yok).
        let unknown = missing_message("bilinmeyen-bilesen");
        assert!(!unknown.trim().is_empty());
        assert!(!unknown.contains(MISSING_PREFIX));
    }

    #[test]
    fn known_messages_name_their_component_and_a_next_step() {
        assert!(missing_message("ffmpeg").contains("ffmpeg"));
        // Eylem çağrısı: kullanıcı nereye gideceğini bilmeli.
        assert!(missing_message("ffmpeg").contains("Bileşenler"));
        assert!(missing_message("ffprobe").contains("ffprobe"));
        assert!(missing_message("ffprobe").contains("Bileşenler"));
        assert!(missing_message("whisper").to_lowercase().contains("whisper"));
        assert!(missing_message("yt-dlp").contains("yt-dlp"));
        // 7c-3 mesajları da somut bir sonraki adımı (tek yönetici) gösterir.
        for id in NEW_IDS {
            let message = missing_message(id);
            assert!(message.contains("Bileşenler"), "{id}: {message}");
            assert!(!message.contains(MISSING_PREFIX), "{id}");
        }
    }

    // --- hedef/tür sınıflandırması ve kurulum-sonrası kanca (saf; AppHandle yok) ---

    /// Test için UYDURMA bir asset spec'i: gerçek model spec'leri artık kayıtta
    /// (7c-3), ama tür/hedef davranışını `AppHandle`/dosya olmadan sınamak için
    /// nötr bir örnek gerekir. id bilerek kayıtta OLMAYAN bir addır.
    fn sample_asset_spec() -> Spec {
        Spec {
            id: "test-asset",
            label: "Test asset",
            approx_mb: 74,
            dest: Dest::Models,
            kind: Kind::Asset,
            downloaded_file: "test-asset.bin",
            sidecar: None,
            version_arg: ASSET_VERSION_ARG,
            download: None,
            post_install: None,
        }
    }

    #[test]
    fn spec_ids_are_unique_so_lookup_is_unambiguous() {
        let mut ids: Vec<&str> = SPECS.iter().map(|spec| spec.id).collect();
        ids.sort_unstable();
        let mut deduped = ids.clone();
        deduped.dedup();
        assert_eq!(ids, deduped, "aynı id iki kez kayıtlı olamaz");
    }

    #[test]
    fn lookup_is_exact_and_unknown_ids_stay_unknown() {
        // 7c-3 ÖNCESİ dört bileşen Components hedefinde ve Binary türündedir:
        // davranış DEĞİŞMEDİ (bu liste regresyon çivisidir).
        for id in LEGACY_BINARY_IDS {
            let spec = spec_for(id).unwrap_or_else(|| panic!("{id} kayıtlı olmalı"));
            assert_eq!(spec.dest, Dest::Components, "{id}");
            assert_eq!(spec.kind, Kind::Binary, "{id}");
        }
        // 7c-3'ün yeni id'leri çözülebilir olmalı.
        for id in NEW_IDS {
            assert!(spec_for(id).is_some(), "{id} kayıtlı olmalı");
        }
        // Uydurma eşleşme yok: büyük/küçük harf, boşluk ve yakın-ama-yanlış id
        // tolere EDİLMEZ (fail closed).
        for unknown in [
            "",
            "FFMPEG",
            " ffmpeg",
            "bilinmeyen",
            "whisper-model-medium",
            "ai-model",
            "llama-cudart ",
            "LLAMA-ENGINE",
        ] {
            assert!(spec_for(unknown).is_none(), "girdi: {unknown:?}");
        }
    }

    #[test]
    fn downloadable_is_derived_only_from_having_a_source() {
        for spec in SPECS {
            assert_eq!(
                spec.download.is_some(),
                download_spec(spec.id).is_some(),
                "{}: downloadable kaynaktan türemeli",
                spec.id
            );
        }
        // Gömülü gelen yt-dlp bu komuttan İNMEZ (paketle gelir).
        assert!(download_spec("yt-dlp").is_none());
        assert!(download_spec("bilinmeyen").is_none());
        // ffmpeg/ffprobe pinli kaynağa sahiptir.
        assert!(download_spec("ffmpeg").is_some());
        assert!(download_spec("ffprobe").is_some());
        // 7c-3: whisper motoru artık Bileşenler'den iner.
        assert!(download_spec("whisper").is_some());
        for id in NEW_IDS {
            assert!(download_spec(id).is_some(), "{id} indirilebilir olmalı");
        }
    }

    #[test]
    fn refusing_a_sourceless_id_is_honest_and_prefix_free() {
        // yt-dlp paketle gömülü gelir; kaynağı yoktur → dürüst ret.
        for id in ["yt-dlp", "bilinmeyen"] {
            let message = not_downloadable(id);
            assert!(message.contains(id), "id görünmeli: {message}");
            assert!(message.contains("indirilemiyor"), "dürüst ret: {message}");
            assert!(!message.contains(MISSING_PREFIX), "önek sızdı: {message}");
        }
    }

    #[test]
    fn whisper_carries_the_archive_rename_hook_on_the_spec() {
        let whisper = spec_for("whisper").expect("whisper kayıtlı olmalı");
        assert_eq!(
            whisper.post_install,
            Some(PostInstall::Rename {
                from: "whisper-cli.exe",
                to: "whisper.exe",
            })
        );
        // Kancanın hedefi, spec'in beklediği dosya adıyla AYNI olmalı (kayma olmasın).
        match whisper.post_install {
            Some(PostInstall::Rename { to, .. }) => assert_eq!(to, whisper.downloaded_file),
            None => panic!("whisper kancası olmalı"),
        }
        // Kanca yalnızca whisper motorundadır; diğer TÜM bileşenlerde yoktur.
        for spec in SPECS {
            if spec.id == "whisper" {
                continue;
            }
            assert_eq!(spec.post_install, None, "{}: beklenmeyen kanca", spec.id);
        }
    }

    #[test]
    fn installed_asset_is_usable_even_though_it_never_runs() {
        let spec = sample_asset_spec();
        let path = Path::new("models/ggml-tiny.bin");
        let status = build_status(&spec, Some((path, ComponentSource::Downloaded)), None);

        assert!(status.installed, "dosya varsa asset kuruludur");
        // Veri dosyası çalıştırılmaz: runnable false, version None (7a sondası böyle bekler).
        assert!(!status.runnable);
        assert_eq!(status.version, None);
        assert_eq!(status.kind, Kind::Asset);
        // Arayüz kuralı: kurulu asset, çalıştırılamasa da KULLANILABİLİR sayılır.
        assert!(is_usable(status.kind, status.installed, status.runnable));
        // Asset, çalıştırılabilir gibi "indirilebilir" raporlanmaz (kaynağı olsa bile tür asset'tir).
        assert!(!status.downloadable);
    }

    #[test]
    fn missing_asset_is_not_usable_and_has_no_path() {
        let spec = sample_asset_spec();
        let status = build_status(&spec, None, None);
        assert!(!status.installed);
        assert!(!status.runnable);
        assert_eq!(status.path, None);
        assert!(!is_usable(status.kind, status.installed, status.runnable));
    }

    #[test]
    fn binary_requires_a_real_probe_to_be_usable() {
        let spec = spec_for("ffmpeg").expect("ffmpeg kayıtlı olmalı");
        let path = Path::new("components/ffmpeg.exe");

        let running = build_status(
            spec,
            Some((path, ComponentSource::Downloaded)),
            Some("ffmpeg version 7".to_string()),
        );
        assert_eq!(running.kind, Kind::Binary);
        assert!(running.runnable);
        assert!(is_usable(running.kind, running.installed, running.runnable));

        // Dosya var ama çalışmıyor (ör. eksik DLL): kurulu ama KULLANILAMAZ.
        let broken = build_status(spec, Some((path, ComponentSource::Downloaded)), None);
        assert!(broken.installed);
        assert!(!broken.runnable);
        assert!(!is_usable(broken.kind, broken.installed, broken.runnable));
    }

    #[test]
    fn runnable_always_matches_version_presence() {
        // 7a sözleşmesi (`verify-components.mjs`): her satırda runnable === Boolean(version).
        // Asset'te ikisi de false/None olduğu için kural bozulmaz — tür kararı `kind` ile.
        let binary = spec_for("ffprobe").expect("ffprobe kayıtlı olmalı");
        let asset = sample_asset_spec();
        let path = Path::new("x");
        let rows = [
            build_status(binary, Some((path, ComponentSource::Downloaded)), Some("v".into())),
            build_status(binary, Some((path, ComponentSource::Downloaded)), None),
            build_status(&asset, Some((path, ComponentSource::Downloaded)), None),
            build_status(&asset, None, None),
        ];
        for row in rows {
            assert_eq!(row.runnable, row.version.is_some(), "{}", row.id);
        }
    }

    // --- 7c-3 kayıt içeriği: hedef/tür/indirilebilirlik/boyut (saf; AppHandle yok) ---

    #[test]
    fn new_specs_are_reachable_with_the_expected_dest_and_kind() {
        // (id, hedef, tür) — 7c-3'te eklenen her satır id ile çözülebilir olmalı.
        let cases = [
            ("whisper-model-tiny", Dest::Models, Kind::Asset),
            ("whisper-model-base", Dest::Models, Kind::Asset),
            ("whisper-model-small", Dest::Models, Kind::Asset),
            ("llama-engine", Dest::Binaries, Kind::Binary),
            // cudart bir DLL kümesidir: çalıştırılamaz → Asset (bkz. spec yorumu).
            ("llama-cudart", Dest::Binaries, Kind::Asset),
            ("ai-model-llm", Dest::Models, Kind::Asset),
            ("ai-model-embed", Dest::Models, Kind::Asset),
        ];
        for (id, dest, kind) in cases {
            let spec = spec_for(id).unwrap_or_else(|| panic!("{id} kayıtlı olmalı"));
            assert_eq!(spec.dest, dest, "{id}: hedef");
            assert_eq!(spec.kind, kind, "{id}: tür");
            assert!(spec.download.is_some(), "{id}: indirilebilir olmalı");
        }
    }

    #[test]
    fn every_new_spec_has_an_honest_size_and_a_source() {
        for id in NEW_IDS {
            let spec = spec_for(id).unwrap_or_else(|| panic!("{id} kayıtlı olmalı"));
            let download = spec
                .download
                .as_ref()
                .unwrap_or_else(|| panic!("{id}: indirme kaynağı olmalı"));
            assert!(spec.approx_mb > 0, "{id}: approx_mb dürüst olmalı");
            assert!(download.expected_bytes > 0, "{id}: expected_bytes");
            assert!(
                download.disk_required_bytes >= download.expected_bytes,
                "{id}: tepe disk indirilenden küçük olamaz"
            );
            assert!(!download.bundle.is_empty(), "{id}: paket kimliği boş olamaz");
        }
        // Qwen ~8.5 GB'dir: aşağı yuvarlanmış bir sayı disk kapısını işe yaramaz
        // kılardı. approx_mb ve expected_bytes pin tablosunu yansıtmalı.
        let qwen = spec_for("ai-model-llm").expect("qwen kayıtlı olmalı");
        assert!(qwen.approx_mb >= 8000, "qwen approx_mb = {}", qwen.approx_mb);
        let qwen_bytes = qwen.download.as_ref().expect("qwen kaynağı").expected_bytes;
        assert!(qwen_bytes >= 8_000 * MIB, "qwen expected_bytes = {qwen_bytes}");
    }

    #[test]
    fn every_zip_spec_reserves_more_disk_than_it_downloads() {
        // Zip'te tepe kullanım = arşiv + açılan dosyalar; indirilenden KÜÇÜK
        // olamaz. Kural tüm zip spec'leri (ffmpeg dâhil) için geçerlidir.
        for spec in SPECS {
            let Some(download) = &spec.download else {
                continue;
            };
            if matches!(&download.payload, PayloadRule::Zip { .. }) {
                assert!(
                    download.disk_required_bytes >= download.expected_bytes,
                    "{}: tepe disk < indirilen",
                    spec.id
                );
            }
        }
    }

    #[test]
    fn new_assets_are_not_bundled_and_carry_no_version_probe() {
        for id in NEW_ASSET_IDS {
            let spec = spec_for(id).unwrap_or_else(|| panic!("{id} kayıtlı olmalı"));
            assert_eq!(spec.kind, Kind::Asset, "{id}");
            // Veri dosyası paketle gelmez: gömülü sidecar araması yapılmamalı.
            assert_eq!(spec.sidecar, None, "{id}: asset gömülü sidecar taşımaz");
            // Asset için sürüm argümanı nötrdür; `probe_component` zaten erken döner.
            assert_eq!(spec.version_arg, ASSET_VERSION_ARG, "{id}");
        }
    }

    #[test]
    fn installed_new_assets_report_usable_without_a_version() {
        // GERÇEK spec'ler üzerinde tür raporu: kurulu veri dosyası "kullanılabilir"
        // ama asla "çalıştırılabilir" değildir (7a sondası: runnable === Boolean(version)).
        for id in NEW_ASSET_IDS {
            let spec = spec_for(id).unwrap_or_else(|| panic!("{id} kayıtlı olmalı"));
            let path = Path::new("data/asset.bin");
            let status = build_status(spec, Some((path, ComponentSource::Downloaded)), None);
            assert!(status.installed, "{id}");
            assert_eq!(status.kind, Kind::Asset, "{id}");
            assert!(!status.runnable, "{id}: asset çalıştırılmaz");
            assert_eq!(status.version, None, "{id}: asset sürümü okunmaz");
            assert!(is_usable(status.kind, status.installed, status.runnable), "{id}");
            // Kaynağı olduğu için indirilebilir; tür ayrımı `kind` ile verilir.
            assert!(status.downloadable, "{id}");
        }
    }

    #[test]
    fn new_binary_specs_need_a_real_probe_to_be_usable() {
        // llama-engine bir ÇALIŞTIRILABİLİRDİR: dosya varlığı yetmez, prob gerekir.
        let spec = spec_for("llama-engine").expect("llama-engine kayıtlı olmalı");
        let path = Path::new("binaries/llama-server.exe");
        let running = build_status(
            spec,
            Some((path, ComponentSource::Downloaded)),
            Some("version: b10964".to_string()),
        );
        assert!(running.runnable);
        assert!(is_usable(running.kind, running.installed, running.runnable));
        assert_eq!(running.framework.as_deref(), Some("archive"));
        let broken = build_status(spec, Some((path, ComponentSource::Downloaded)), None);
        assert!(broken.installed);
        assert!(!is_usable(broken.kind, broken.installed, broken.runnable));
    }

    #[test]
    fn whisper_engine_zip_extracts_the_cli_exe_before_renaming() {
        let whisper = spec_for("whisper").expect("whisper kayıtlı olmalı");
        let download = whisper.download.as_ref().expect("whisper indirilebilir olmalı");
        assert_eq!(download.bundle, WHISPER_ENGINE_BUNDLE);
        match &download.payload {
            PayloadRule::Zip {
                wanted,
                max_entry_bytes,
            } => {
                assert!(
                    wanted.contains(&WHISPER_ENGINE_ARCHIVE_EXE),
                    "arşivden çıkarılmalı (sonra rename edilir)"
                );
                assert!(wanted.contains(&"whisper.dll"), "DLL listesi tam olmalı");
                assert!(!wanted.contains(&"SDL2.dll"), "SDL2 kasten dışarıda");
                assert!(
                    *max_entry_bytes >= 64 * MIB,
                    "gerçek girdiler için cap yeterli olmalı"
                );
            }
            PayloadRule::Raw { .. } => panic!("whisper motoru zip olmalı"),
        }
    }

    #[test]
    fn llama_specs_extract_their_pinned_entries_and_stay_separate() {
        let engine = spec_for("llama-engine").expect("llama-engine kayıtlı olmalı");
        let engine_download = engine.download.as_ref().expect("llama-engine kaynağı");
        match &engine_download.payload {
            PayloadRule::Zip { wanted, .. } => {
                assert!(wanted.contains(&"llama-server.exe"));
                assert!(wanted.contains(&"ggml-cuda.dll"), "CUDA backend gerekli");
            }
            PayloadRule::Raw { .. } => panic!("llama-engine zip olmalı"),
        }
        let cudart = spec_for("llama-cudart").expect("llama-cudart kayıtlı olmalı");
        let cudart_download = cudart.download.as_ref().expect("llama-cudart kaynağı");
        match &cudart_download.payload {
            PayloadRule::Zip { wanted, .. } => {
                assert!(wanted.contains(&"cublas64_12.dll"));
                assert!(wanted.contains(&"cudart64_12.dll"));
            }
            PayloadRule::Raw { .. } => panic!("llama-cudart zip olmalı"),
        }
        // İki AYRI arşiv: ortak bundle verilmez.
        assert_ne!(engine_download.bundle, cudart_download.bundle);
        // "Varsa atla" işaret dosyası ai.rs ile aynı kalmalı.
        assert_eq!(cudart.downloaded_file, LLAMA_CUDART_FILE);
        assert_eq!(cudart_download.framework(), "archive");
    }

    #[test]
    fn model_specs_download_the_pinned_file_names() {
        let cases = [
            ("whisper-model-tiny", WHISPER_MODEL_TINY_FILE),
            ("whisper-model-base", WHISPER_MODEL_BASE_FILE),
            ("whisper-model-small", WHISPER_MODEL_SMALL_FILE),
            ("ai-model-llm", AI_MODEL_LLM_FILE),
            ("ai-model-embed", AI_MODEL_EMBED_FILE),
        ];
        for (id, file) in cases {
            let spec = spec_for(id).unwrap_or_else(|| panic!("{id} kayıtlı olmalı"));
            assert_eq!(spec.downloaded_file, file, "{id}");
            let download = spec.download.as_ref().expect("kaynak");
            assert_eq!(download.framework(), "plain", "{id}");
            match &download.payload {
                PayloadRule::Raw { file_name } => assert_eq!(*file_name, file, "{id}"),
                PayloadRule::Zip { .. } => panic!("{id} düz dosya olmalı"),
            }
        }
    }

    #[test]
    fn single_archive_specs_carry_their_own_id_as_bundle() {
        // Paylaşılan arşiv YALNIZCA ffmpeg+ffprobe'dur (`ffmpeg-tools`). Diğer tüm
        // indirilebilir satırlar kendi id'lerini paket kimliği taşır: arayüz kurulum
        // başarısını bu değerle gruplar; iki farklı arşiv aynı pakete düşerse biri
        // diğerinin "kurulu" görünmesine yol açabilir.
        for spec in SPECS {
            let Some(download) = &spec.download else {
                continue;
            };
            if spec.id == "ffmpeg" || spec.id == "ffprobe" {
                assert_eq!(download.bundle, FFMPEG_TOOLS_BUNDLE, "{}", spec.id);
                continue;
            }
            assert_eq!(
                download.bundle, spec.id,
                "{}: paket kimliği kendi id'si olmalı",
                spec.id
            );
        }
        // Yeni id'lerin paket kimlikleri de benzersizdir (çakışma yok).
        let mut bundles: Vec<&str> = NEW_IDS
            .iter()
            .filter_map(|id| spec_for(id).and_then(|spec| spec.download.as_ref().map(|d| d.bundle)))
            .collect();
        let total = bundles.len();
        assert_eq!(total, NEW_IDS.len(), "her yeni spec indirilebilir olmalı");
        bundles.sort_unstable();
        bundles.dedup();
        assert_eq!(bundles.len(), total, "yeni paket kimlikleri benzersiz olmalı");
    }
}
