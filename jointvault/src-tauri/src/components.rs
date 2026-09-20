// Bileşen kaydı (component registry).
//
// Sorun: "hangi araç kurulu, nerede duruyor" bilgisi bugün üç yere dağılmıştı —
// `health.rs` sidecar'a bakıyor, `whisper.rs` kendi yolunu hesaplıyor,
// `download.rs` ffmpeg'i `<indirme>/.tools` altına kopyalıyor. Aynı bilginin
// kopyaları zamanla ayrışır (bu, `docs/media-tools-deferred.md:59-60`'ta
// kayıtlı bir borç).
//
// Burada tek kaynak: her bileşen için id, etiket, beklenen dosya adı, gömülü
// sidecar adı ve sürüm komutu. Durum UYDURULMAZ — dosya ve çalıştırma kontrolü
// gerçekten yapılır.
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
    downloadable: bool,
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
    downloadable: bool,
}

const SPECS: &[Spec] = &[
    Spec {
        id: "ffmpeg",
        label: "ffmpeg",
        approx_mb: 80,
        downloaded_file: "ffmpeg.exe",
        sidecar: Some("ffmpeg"),
        version_arg: "-version",
        downloadable: true,
    },
    Spec {
        id: "ffprobe",
        label: "ffprobe",
        approx_mb: 80,
        downloaded_file: "ffprobe.exe",
        sidecar: Some("ffprobe"),
        version_arg: "-version",
        downloadable: true,
    },
    Spec {
        id: "yt-dlp",
        label: "yt-dlp",
        approx_mb: 17,
        downloaded_file: "yt-dlp.exe",
        sidecar: Some("yt-dlp"),
        version_arg: "--version",
        downloadable: true,
    },
    Spec {
        id: "whisper",
        label: "Whisper motoru",
        approx_mb: 4,
        downloaded_file: "whisper.exe",
        sidecar: Some("whisper"),
        version_arg: "--help",
        downloadable: true,
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
            downloadable: spec.downloadable,
        });
    }
    Ok(out)
}

/// Bileşen klasörünün yolu (arayüzden açılabilir).
#[tauri::command]
pub fn components_path(app: AppHandle) -> Result<String, String> {
    Ok(components_dir(&app)?.to_string_lossy().to_string())
}
