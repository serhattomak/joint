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
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Dosya yolu boş olamaz.".to_string());
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}
