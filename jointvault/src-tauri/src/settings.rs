use tauri::Manager;

// Mirrors pairing.rs: setting persisted as a plain file in the app-data dir (no store crate).
const DIR_FILE: &str = "download_dir.txt";
const CLOSE_FILE: &str = "close_behavior.txt";

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
