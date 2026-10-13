use tauri::Manager;

// Mirrors pairing.rs: setting persisted as a plain file in the app-data dir (no store crate).
const DIR_FILE: &str = "download_dir.txt";
const CLOSE_FILE: &str = "close_behavior.txt";
const DOWNLOAD_FILE: &str = "download_settings.json";

fn app_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn default_download_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    Ok(downloads.join("JointVault"))
}

fn read_saved_dir(app: &tauri::AppHandle) -> Option<String> {
    let path = app_data_dir(app).ok()?.join(DIR_FILE);
    std::fs::read_to_string(&path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Veri klasörünün yolu (veritabanı, ayarlar, yedekler).
/// Hata ekranı ve Ayarlar → Hakkında bunu açar; kullanıcı kendi dosyalarına erişebilsin.
#[tauri::command]
pub fn app_data_path(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app_data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_download_dir(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(saved) = read_saved_dir(&app) {
        std::fs::create_dir_all(&saved).map_err(|e| e.to_string())?;
        return Ok(saved);
    }
    let dir = app_data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let default = default_download_dir(&app)?;
    std::fs::create_dir_all(&default).map_err(|e| e.to_string())?;
    let s = default.to_string_lossy().to_string();
    std::fs::write(dir.join(DIR_FILE), format!("{s}\n")).map_err(|e| e.to_string())?;
    Ok(s)
}

#[tauri::command]
pub fn set_download_dir(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let trimmed = path.trim().to_string();
    if trimmed.is_empty() {
        return Err("Klasör yolu boş olamaz.".to_string());
    }
    std::fs::create_dir_all(&trimmed).map_err(|e| e.to_string())?;
    let dir = app_data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(DIR_FILE), format!("{trimmed}\n")).map_err(|e| e.to_string())?;
    // Yeni klasörü varlık protokolüne de bildir: aksi hâlde bu klasördeki medya
    // önizlemesi sessizce kırılır (statik kapsam kullanıcı seçimini bilemez).
    let _ = app.asset_protocol_scope().allow_directory(&trimmed, true);
    Ok(trimmed)
}

// ponytail: kapatma kararı Rust'ta verilir (pencere olayı frontend'e sormaz);
// dosya okuma kapatma anında yapılır, restart gerekmez.
#[tauri::command]
pub fn get_close_behavior(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app_data_dir(&app)?;
    let v = std::fs::read_to_string(dir.join(CLOSE_FILE))
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    Ok(if v == "quit" { "quit".to_string() } else { "tray".to_string() })
}

// Kapatma anında okunur (tauri komutu değil, tray modülü kullanır).
pub(crate) fn close_is_quit(app: &tauri::AppHandle) -> bool {
    app_data_dir(app)
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join(CLOSE_FILE)).ok())
        .map(|s| s.trim() == "quit")
        .unwrap_or(false)
}

#[tauri::command]
pub fn set_close_behavior(app: tauri::AppHandle, mode: String) -> Result<String, String> {    let mode = mode.trim().to_string();
    if mode != "quit" && mode != "tray" {
        return Err("mode quit ya da tray olmalı.".to_string());
    }
    let dir = app_data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(CLOSE_FILE), format!("{mode}\n")).map_err(|e| e.to_string())?;
    Ok(mode)
}
/// İndirme motorunun ayarları. IDM'deki "Connection" sekmesinin karşılığı.
/// `download_dir.txt` ile aynı desen: app-data dizininde düz JSON dosyası.
///
/// `#[serde(default)]` **kapsayıcıda** duruyor: sonradan eklenen alan, eski
/// ayar dosyasında bulunmadığında `DownloadSettings::default()`'undan gelir.
/// (Alan bazında type-default kullanılsaydı `false`/`0` gelir ve kullanıcının
/// ayarları sessizce sıfırlanırdı.)
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(default)]
pub struct DownloadSettings {
    /// Toplam hız sınırı, bayt/sn. 0 = sınırsız (IDM'deki "speed limiter").
    pub speed_limit_bps: u64,
    /// Aynı anda indirilecek en fazla iş; fazlası kuyrukta bekler.
    pub max_concurrent: usize,
    /// Yeni indirmelerde varsayılan kanal (parça) sayısı.
    pub default_connections: usize,
    /// Hedefi kategoriye göre alt klasöre ayır (`Video`, `Ses`, `Program`…).
    pub category_folders: bool,
    /// İndirme tamamlanınca ne yapılsın: `none` · `open` · `reveal`.
    pub after_complete: String,
    /// Hata sonrası kendiliğinden yeniden deneme sayısı (0 = kapalı).
    pub retry_count: usize,
    /// Tarayıcıdan devralınan indirmede pencere öne gelsin mi. IDM'in indirme
    /// penceresi gibi: iş burada koşuyor, görünmesi gerekir.
    pub raise_on_capture: bool,
    /// Format seçildikten sonra format ekranı kendiliğinden kapansın mı.
    /// Kapalıyken ekran açık kalır ve elle kapatılır (varsayılan kapalı).
    pub close_format_after_pick: bool,
}

impl Default for DownloadSettings {
    fn default() -> Self {
        Self {
            speed_limit_bps: 0,
            max_concurrent: 3,
            default_connections: 8,
            category_folders: true,
            after_complete: "none".to_string(),
            retry_count: 2,
            raise_on_capture: true,
            close_format_after_pick: false,
        }
    }
}

fn clamp_download_settings(mut s: DownloadSettings) -> DownloadSettings {
    s.max_concurrent = s.max_concurrent.clamp(1, 16);
    s.default_connections = s.default_connections.clamp(1, 32);
    // 0 = sınırsız. Sıfırdan büyük ama anlamsız küçük değer indirmeyi
    // kilitler; taban 8 KB/s.
    if s.speed_limit_bps > 0 && s.speed_limit_bps < 8192 {
        s.speed_limit_bps = 8192;
    }
    if !matches!(s.after_complete.as_str(), "none" | "open" | "reveal") {
        s.after_complete = "none".to_string();
    }
    s.retry_count = s.retry_count.min(5);
    s
}

pub(crate) fn download_settings(app: &tauri::AppHandle) -> DownloadSettings {
    let Ok(dir) = app_data_dir(app) else {
        return DownloadSettings::default();
    };
    std::fs::read_to_string(dir.join(DOWNLOAD_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str::<DownloadSettings>(&raw).ok())
        .map(clamp_download_settings)
        .unwrap_or_default()
}

/// Ayarları motora uygular. Açılışta ve her kayıtta çağrılır; motor yeniden
/// başlatma istemez (sınırlar `AtomicU64`/`AtomicUsize`).
pub(crate) fn apply_download_settings(app: &tauri::AppHandle) {
    let s = download_settings(app);
    crate::turbo_download::set_runtime_limits(s.speed_limit_bps, s.max_concurrent);
}

#[tauri::command]
pub fn get_download_settings(app: tauri::AppHandle) -> Result<DownloadSettings, String> {
    Ok(download_settings(&app))
}

#[tauri::command]
pub fn set_download_settings(
    app: tauri::AppHandle,
    settings: DownloadSettings,
) -> Result<DownloadSettings, String> {
    let s = clamp_download_settings(settings);
    let dir = app_data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&s).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(DOWNLOAD_FILE), json).map_err(|e| e.to_string())?;
    crate::turbo_download::set_runtime_limits(s.speed_limit_bps, s.max_concurrent);
    Ok(s)
}

/// Bu yol bir indirme tarafından tutuluyor mu?
///
/// Hedef dosya henüz oluşmamış olabilir: indirme sürerken yalnızca
/// `<hedef>.part_N` dosyaları vardır, `.meta` ise duraklatmada yazılır. Yalnız
/// `exists()` bakmak, aynı adı hedefleyen ikinci indirmeye aynı yolu verir ve
/// birleştirme anında iki iş birbirinin üzerine yazar (veri kaybı).
fn is_claimed(target: &std::path::Path) -> bool {
    if target.exists() {
        return true;
    }
    let (Some(dir), Some(name)) = (target.parent(), target.file_name()) else {
        return false;
    };
    let name = name.to_string_lossy().to_string();
    let part_prefix = format!("{name}.part_");
    let meta = format!("{name}.meta");
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|e| {
        let n = e.file_name().to_string_lossy().to_string();
        n.starts_with(&part_prefix) || n == meta
    })
}

/// Aynı ada sahip bir dosya varsa **üzerine yazmaz**: `ad (2).uzantı` gibi ilk
/// boş adı döner. IDM de yakaladığı indirmelerde bunu yapar; sessizce üzerine
/// yazmak veri kaybıdır.
///
/// Var olan dosya için bu komut yalnızca *okuma* (varlık kontrolü) yapar ve
/// izinli köklerin dışındaki yolları reddeder (`paths::ensure_allowed`).
#[tauri::command]
pub fn unique_path(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Dosya yolu boş olamaz.".to_string());
    }
    let target = std::path::PathBuf::from(trimmed);
    crate::paths::ensure_allowed(&app, &target)?;
    if !is_claimed(&target) {
        return Ok(trimmed.to_string());
    }

    let dir = target.parent().unwrap_or(std::path::Path::new("."));
    let stem = target
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "dosya".to_string());
    let ext = target.extension().map(|e| e.to_string_lossy().to_string());
    for n in 2..10_000u32 {
        let name = match &ext {
            Some(e) => format!("{stem} ({n}).{e}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = dir.join(name);
        if !is_claimed(&candidate) {
            return Ok(candidate.to_string_lossy().to_string());
        }
    }
    Err("Boş dosya adı bulunamadı.".to_string())
}

#[cfg(test)]
mod tests {
    use super::{is_claimed, DownloadSettings};

    /// Ayar dosyasına sonradan alan eklendiğinde **eski dosya hâlâ okunmalı** ve
    /// kullanıcının ayarları sıfırlanmamalı. Kapsayıcıdaki `#[serde(default)]`
    /// olmadan deserializasyon tümden başarısız olur, `download_settings()` de
    /// sessizce `Default`'a düşerdi — yani ayarlar kaybolurdu.
    #[test]
    fn missing_fields_fall_back_to_defaults_not_type_defaults() {
        let old = r#"{"speed_limit_bps": 1048576}"#;
        let parsed: DownloadSettings = serde_json::from_str(old).expect("eski dosya okunmalı");
        assert_eq!(parsed.speed_limit_bps, 1_048_576, "yazılı alan korunmalı");
        assert!(parsed.category_folders, "varsayılan true olmalı, type-default false değil");
        assert_eq!(parsed.retry_count, 2, "varsayılan 2 olmalı, 0 değil");
        assert!(parsed.raise_on_capture);
    }

    #[test]
    fn a_path_is_claimed_by_a_running_or_paused_download() {
        let dir = std::env::temp_dir().join(format!("jv-unique-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("dosya.zip");

        assert!(!is_claimed(&target), "hiçbir şey yokken sahipsiz olmalı");

        // Süren indirme: hedef yok, part dosyası var.
        std::fs::write(dir.join("dosya.zip.part_3"), b"x").unwrap();
        assert!(is_claimed(&target), "part dosyası işarettir");
        std::fs::remove_file(dir.join("dosya.zip.part_3")).unwrap();

        // Duraklatılmış indirme: meta dosyası var.
        std::fs::write(dir.join("dosya.zip.meta"), b"{}").unwrap();
        assert!(is_claimed(&target), "meta dosyası işarettir");

        // Benzer ad (başka dosya) sahiplenmez.
        assert!(!is_claimed(&dir.join("dosya.zipx")));

        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Metni dosyaya yazar — **yalnızca izinli köklerin altına** (app_data, indirme kökü).
///
/// Neden kısıtlandı: bu komut renderer'a açıktır; sınırsız olsaydı bir renderer
/// açığı diskteki herhangi bir dosyaya yazmaya dönüşürdü. Kullanıcının seçtiği
/// dışa aktarma yolu buradan GEÇMEZ (bkz. `export_backup`).
#[tauri::command]
pub fn write_text_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Dosya yolu boş olamaz.".to_string());
    }
    let target = std::path::PathBuf::from(path.trim());
    crate::paths::ensure_allowed(&app, &target)?;
    std::fs::write(&target, content).map_err(|e| e.to_string())
}

/// Yedeği dışa aktarır: **dosya seçimini Rust yapar**, renderer yalnızca içeriği verir.
///
/// Neden böyle? Yol renderer'dan gelseydi, "kullanıcı seçti" iddiası doğrulanamazdı;
/// renderer istediği yolu gönderebilirdi. Burada seçimi işletim sistemi diyaloğu
/// yapar ve yol renderer'a hiç uğramaz — yetkilendirme sınırı gerçekten diyalogdur.
/// Dönen değer: yazılan yol (kullanıcı iptal ederse `None`).
#[tauri::command]
pub async fn export_backup(
    app: tauri::AppHandle,
    content: String,
    suggested_name: String,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let safe_name = suggested_name.trim();
    let file_name = if safe_name.is_empty() {
        "jointvault-backup.json".to_string()
    } else {
        safe_name.to_string()
    };

    // Filtre/uzantı verilmezse JSON varsayılır — mevcut yedek çağrıları değişmez.
    let filter_name = filter_name.unwrap_or_else(|| "JSON".to_string());
    let extensions = extensions.unwrap_or_else(|| vec!["json".to_string()]);
    let ext_refs: Vec<&str> = extensions.iter().map(String::as_str).collect();

    let chosen = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter(&filter_name, &ext_refs)
        .blocking_save_file();

    let Some(file_path) = chosen else {
        return Ok(None); // kullanıcı iptal etti
    };
    let path = file_path
        .into_path()
        .map_err(|e| format!("Seçilen yol kullanılamadı: {e}"))?;
    std::fs::write(&path, content).map_err(|e| format!("Yedek yazılamadı: {e}"))?;
    Ok(Some(path.to_string_lossy().to_string()))
}
