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
