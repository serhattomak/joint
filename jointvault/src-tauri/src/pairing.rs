use tauri::Manager;

// Must match collect.rs: the bridge reads the token from this file on every request.
const TOKEN_FILE: &str = "bridge_token";

fn app_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn write_new_token(app: &tauri::AppHandle) -> Result<String, String> {
    let dir = app_data_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    std::fs::write(dir.join(TOKEN_FILE), format!("{token}\n")).map_err(|e| e.to_string())?;
    Ok(token)
}

#[tauri::command]
pub fn get_pairing_token(app: tauri::AppHandle) -> Result<String, String> {
    let path = app_data_dir(&app)?.join(TOKEN_FILE);
    let existing = std::fs::read_to_string(&path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    match existing {
        Some(t) => Ok(t),
        None => write_new_token(&app),
    }
}

#[tauri::command]
pub fn regenerate_pairing_token(app: tauri::AppHandle) -> Result<String, String> {
    write_new_token(&app)
}

// --- Bağlantı durumu ------------------------------------------------------
//
// "Eşleşme anahtarı girdim, çalıştı mı?" sorusunun dürüst cevabı: köprüye
// yetkili bir istek gelip gelmediği. `collect.rs` her onaylı istekte bu dosyayı
// tazeler; dosya diskte durur çünkü uygulama yeniden başladığında bellekteki
// damga kaybolur ve arayüz "hiç bağlanmadı" diye yalan söylerdi.
const LAST_SEEN_FILE: &str = "bridge_last_seen";

/// Yetkili köprü isteği geldi (bkz. `collect::authorize`). Hata yutulur: teşhis
/// bilgisi yazılamadı diye eklentiden gelen kayıt düşmez.
pub fn mark_last_seen(app: &tauri::AppHandle) {
    let Ok(dir) = app_data_dir(app) else { return };
    let _ = std::fs::create_dir_all(&dir);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let _ = std::fs::write(dir.join(LAST_SEEN_FILE), millis.to_string());
}

#[derive(serde::Serialize)]
pub struct ExtensionInfo {
    /// Kurulumdaki `extension/` klasörü (paket kaynağı, bkz. `bundle.resources`).
    dir: String,
    /// Klasör gerçekten var mı? Yoksa arayüz "kurulumda bulunamadı" der.
    installed: bool,
    /// Unix ms; eklenti bu kurulumda hiç bağlanmadıysa `None`.
    #[serde(rename = "lastSeen")]
    last_seen: Option<u64>,
}

#[tauri::command]
pub fn extension_info(app: tauri::AppHandle) -> Result<ExtensionInfo, String> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("extension");
    let last_seen = app_data_dir(&app)
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join(LAST_SEEN_FILE)).ok())
        .and_then(|s| s.trim().parse::<u64>().ok());
    Ok(ExtensionInfo {
        installed: dir.is_dir(),
        dir: dir.to_string_lossy().to_string(),
        last_seen,
    })
}
