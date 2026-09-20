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
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Bileşen nereden geldi: kullanıcı indirdi mi, paketle mi geldi.
#[derive(serde::Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ComponentSource {
    Downloaded,
    Bundled,
}

#[derive(serde::Serialize)]
pub struct ComponentStatus {
    id: String,
    label: String,
    /// Kabaca indirme boyutu (kullanıcı ne indireceğini bilsin).
    approx_mb: u32,
    installed: bool,
    /// Dosya var VE çalıştırılabiliyor mu (sürüm okunabildi mi).
    /// "Dosya var" tek başına yetmez: `whisper.exe` DLL'leri olmadan durur.
    runnable: bool,
    /// Bileşenin bulunduğu tam yol (kuruluysa).
    path: Option<String>,
    source: Option<ComponentSource>,
    /// `-version` çıktısının ilk satırı (kuruluysa).
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

struct Spec {
    id: &'static str,
    label: &'static str,
    approx_mb: u32,
    /// İndirildiğinde kullanılacak dosya adı.
    downloaded_file: &'static str,
    /// Paketle gelen sidecar adı (varsa).
    sidecar: Option<&'static str>,
    /// Sürüm sorgusunda kullanılacak argüman.
    version_arg: &'static str,
    /// Pinlenmiş indirme kaynağı. `None` → bu bileşen bu komuttan inmez:
    /// yt-dlp paketle gömülü gelir; whisper/AI kendi komutlarından iner (Faz 7b/04).
    /// `downloadable` bu alandan TÜRETİLİR — kaynağı olmayan "indirilebilir" sayılmaz.
    download: Option<DownloadSpec>,
}

/// Arşivden ne çıkarılacak ve tek girdi güvenlik sınırı.
pub enum PayloadRule {
    /// Tek düz dosya: `<hedef>/<file_name>`. Şu an yalnızca ffmpeg/ffprobe (zip)
    /// kayıtlı olduğu için bu varyant inşa edilmiyor; Faz 7b/04 model indirmelerini
    /// (`.bin`/`.gguf`) buraya bağlayınca kullanılacak. Motor tarafı hazır
    /// (`Payload::Raw`) ve sonda komutu bu yolu zaten çalıştırıyor.
    #[allow(dead_code)]
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
/// URL/sha256 değerleri `context.md` pin tablosundan **birebir** kopyalanır; burada
/// uydurma kaynak yoktur (`docs/product-roadmap.md` §7 riski: kaynak sabitlenmeli,
/// dış kaynak kaybolsa bile ne indirildiği bilinmeli).
pub struct DownloadSpec {
    /// Aynı arşivi paylaşan bileşenlerin ortak kimliği (ilerleme olayında görünür).
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

const SPECS: &[Spec] = &[
    Spec {
        id: "ffmpeg",
        label: "ffmpeg",
        approx_mb: FFMPEG_TOOLS_APPROX_MB,
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
    },
    Spec {
        id: "ffprobe",
        label: "ffprobe",
        // ffprobe ayrı indirilmez: ffmpeg ile aynı arşivden gelir (bundle).
        approx_mb: FFMPEG_TOOLS_APPROX_MB,
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
    },
    Spec {
        id: "yt-dlp",
        label: "yt-dlp",
        approx_mb: 17,
        downloaded_file: "yt-dlp.exe",
        sidecar: Some("yt-dlp"),
        version_arg: "--version",
        // yt-dlp paketle GÖMÜLÜ kalır (roadmap §7): indirme kaynağı yok.
        download: None,
    },
    Spec {
        id: "whisper",
        label: "Whisper motoru",
        approx_mb: 4,
        downloaded_file: "whisper.exe",
        sidecar: Some("whisper"),
        version_arg: "--help",
        // Whisper motoru kendi komutundan iner (`whisper::download_whisper_engine`);
        // Faz 7b/04 aynı motora bağlayınca kaynak buraya taşınır.
        download: None,
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

/// Bir bileşeni çöz: önce indirilenler, sonra gömülü.
fn resolve(app: &AppHandle, spec: &Spec) -> Option<(PathBuf, ComponentSource)> {
    let downloaded = components_dir(app).ok()?.join(spec.downloaded_file);
    if downloaded.is_file() {
        return Some((downloaded, ComponentSource::Downloaded));
    }
    spec.sidecar
        .and_then(bundled_path)
        .map(|path| (path, ComponentSource::Bundled))
}

/// Bileşen kurulu mu (indirilenler → gömülü)? Kuruluysa indirme atlanır.
pub fn is_installed(app: &AppHandle, id: &str) -> bool {
    SPECS
        .iter()
        .find(|spec| spec.id == id)
        .and_then(|spec| resolve(app, spec))
        .is_some()
}

/// Bileşenin pinlenmiş indirme kaynağı. `None` → bu id bu komuttan indirilemez.
pub fn download_spec(id: &str) -> Option<&'static DownloadSpec> {
    SPECS.iter().find(|spec| spec.id == id)?.download.as_ref()
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

/// Tüm bileşenlerin GERÇEK durumu.
#[tauri::command]
pub async fn components_status(app: AppHandle) -> Result<Vec<ComponentStatus>, String> {
    let mut out = Vec::with_capacity(SPECS.len());
    for spec in SPECS {
        let resolved = resolve(&app, spec);
        let version = match &resolved {
            Some((path, _)) => probe_version(&app, path, spec.version_arg).await,
            None => None,
        };
        out.push(ComponentStatus {
            id: spec.id.to_string(),
            label: spec.label.to_string(),
            approx_mb: spec.approx_mb,
            installed: resolved.is_some(),
            runnable: version.is_some(),
            path: resolved.as_ref().map(|(p, _)| p.to_string_lossy().to_string()),
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
        });
    }
    Ok(out)
}

/// Bileşen klasörünün yolu (arayüzden açılabilir).
#[tauri::command]
pub fn components_path(app: AppHandle) -> Result<String, String> {
    Ok(components_dir(&app)?.to_string_lossy().to_string())
}
