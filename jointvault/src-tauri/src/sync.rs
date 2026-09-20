use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

const SYNC_CONFIG_FILE: &str = "sync_config.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    pub default_browser: String,
    pub x_enabled: bool,
    pub x_browser: Option<String>,
    pub instagram_enabled: bool,
    pub instagram_browser: Option<String>,
    pub instagram_url: Option<String>,
    pub youtube_enabled: bool,
    pub youtube_browser: Option<String>,
    pub youtube_source: String, // "WL", "LL", or playlist URL
    pub batch_limit: u32,
    pub auto_sync_interval_hours: u32,
    pub auto_ai_pipeline: bool,
    pub last_sync_x: Option<String>,
    pub last_sync_instagram: Option<String>,
    pub last_sync_youtube: Option<String>,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            default_browser: "chrome".to_string(),
            x_enabled: true,
            x_browser: None,
            instagram_enabled: true,
            instagram_browser: None,
            instagram_url: None,
            youtube_enabled: true,
            youtube_browser: None,
            youtube_source: "WL".to_string(),
            batch_limit: 50,
            auto_sync_interval_hours: 0,
            auto_ai_pipeline: true,
            last_sync_x: None,
            last_sync_instagram: None,
            last_sync_youtube: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncScannedItem {
    pub id: String,
    pub url: String,
    pub title: Option<String>,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub uploader: Option<String>,
    pub platform: String,
    pub timestamp: Option<i64>,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sync_get_config(app: AppHandle) -> Result<SyncConfig, String> {
    let dir = app_data_dir(&app)?;
    let file_path = dir.join(SYNC_CONFIG_FILE);
    if !file_path.exists() {
        return Ok(SyncConfig::default());
    }
    let content = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let config: SyncConfig = serde_json::from_str(&content).unwrap_or_default();
    Ok(config)
}

#[tauri::command]
pub fn sync_save_config(app: AppHandle, config: SyncConfig) -> Result<SyncConfig, String> {
    let dir = app_data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file_path = dir.join(SYNC_CONFIG_FILE);
    let serialized = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&file_path, serialized).map_err(|e| e.to_string())?;
    Ok(config)
}

#[tauri::command]
pub fn sync_check_browser(browser: String) -> Result<bool, String> {
    let b = browser.to_lowercase();
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let app_data = std::env::var("APPDATA").unwrap_or_default();

    let exists = match b.as_str() {
        "chrome" => PathBuf::from(&local_app_data).join("Google/Chrome/User Data").exists(),
        "brave" => PathBuf::from(&local_app_data).join("BraveSoftware/Brave-Browser/User Data").exists(),
        "edge" => PathBuf::from(&local_app_data).join("Microsoft/Edge/User Data").exists(),
        "firefox" => PathBuf::from(&app_data).join("Mozilla/Firefox/Profiles").exists(),
        "opera" => PathBuf::from(&app_data).join("Opera Software/Opera Stable").exists(),
        "vivaldi" => PathBuf::from(&local_app_data).join("Vivaldi/User Data").exists(),
        _ => false,
    };
    Ok(exists)
}

#[tauri::command]
pub async fn sync_scan_platform(app: AppHandle, payload: serde_json::Value) -> Result<Vec<SyncScannedItem>, String> {
    // Kapı: işe başlamadan yt-dlp'yi kayıttan çöz (indirilen → gömülü). Eksikse
    // ham OS hatası yerine `BILESEN_EKSIK:yt-dlp` + okunabilir ikinci satır döner.
    // yt-dlp paketle GÖMÜLÜ kalır (kayıtta indirme kaynağı yok, `downloadable=false`);
    // yalnızca çözümleme biçimi değişti — buraya indirme kaynağı EKLEMEYİN.
    let yt_dlp = crate::components::require_tool(&app, "yt-dlp")?;
    let platform = payload
        .get("platform")
        .and_then(|v| v.as_str())
        .ok_or("missing platform")?
        .to_lowercase();

    let limit = payload
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(50) as u32;

    let browser = payload
        .get("browser")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("chrome");

    let custom_url = payload
        .get("custom_url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    // X and Instagram bookmarks live behind dynamic SPAs and are collected via the JointVault extension.
    // yt-dlp only supports single tweets/posts or YouTube playlists.
    if platform == "x" {
        return Err("X (Twitter) yer imleri doğrudan yt-dlp ile taranamamaktadır. Lütfen tarayıcınızda x.com/i/bookmarks sayfasını açıp JointVault Collector eklentisindeki 'Topla' butonunu kullanın.".to_string());
    }
    if platform == "instagram" {
        return Err("Instagram kaydedilenler doğrudan yt-dlp ile taranamamaktadır. Lütfen tarayıcınızda kaydedilenler sayfasını açıp JointVault Collector eklentisindeki 'Topla' butonunu kullanın.".to_string());
    }

    let target_url = match platform.as_str() {
        "youtube" => match custom_url {
            Some("LL") => "https://www.youtube.com/playlist?list=LL".to_string(),
            Some(u) if u.starts_with("http") => u.to_string(),
            _ => "https://www.youtube.com/playlist?list=WL".to_string(),
        },
        _ => return Err(format!("Desteklenmeyen platform: {platform}")),
    };

    let mut args: Vec<String> = vec![
        "-J".to_string(),
        "--flat-playlist".to_string(),
        "--no-warnings".to_string(),
        "--playlist-end".to_string(),
        limit.to_string(),
        "--sleep-requests".to_string(),
        "1.5".to_string(),
        "--min-sleep-interval".to_string(),
        "1".to_string(),
        "--max-sleep-interval".to_string(),
        "3".to_string(),
    ];

    let cookies_txt = app_data_dir(&app).ok().map(|d| d.join("cookies.txt")).filter(|p| p.exists());
    if let Some(cookie_file) = cookies_txt {
        args.push("--cookies".to_string());
        args.push(cookie_file.to_string_lossy().to_string());
    } else if !browser.is_empty() && browser != "none" {
        args.push("--cookies-from-browser".to_string());
        args.push(browser.to_string());
    }

    args.push(target_url);

    let (mut rx, _child) = app
        .shell()
        .command(yt_dlp.to_string_lossy().to_string())
        .args(args)
        .spawn()
        .map_err(|e| e.to_string())?;

    let mut stdout_buf = String::new();
    let mut stderr_buf = String::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                stdout_buf.push_str(&String::from_utf8_lossy(&line));
            }
            CommandEvent::Stderr(line) => {
                let err_str = String::from_utf8_lossy(&line);
                if stderr_buf.len() < 1000 {
                    stderr_buf.push_str(&err_str);
                }
            }
            CommandEvent::Error(err) => return Err(err),
            CommandEvent::Terminated(status) => {
                if status.code != Some(0) {
                    let msg = if !stderr_buf.trim().is_empty() {
                        let raw = stderr_buf.trim().to_string();
                        if raw.contains("Could not copy Chrome cookie database") || raw.contains("database locked") || raw.contains("WinError 32") {
                            "Chrome çalışırken çerez veritabanını kilitler. Çözüm: JointVault tarayıcı eklentisindeki 'Çerezleri Aktar' butonuna tıklayarak çerezleri tek tıkla aktarabilir veya 'cookies.txt Yükle' butonu ile bir çerez dosyası seçebilirsiniz.".to_string()
                        } else {
                            raw
                        }
                    } else {
                        format!("yt-dlp exited with code {:?}", status.code)
                    };
                    return Err(msg);
                }
            }
            _ => {}
        }
    }

    let parsed: serde_json::Value = serde_json::from_str(&stdout_buf)
        .map_err(|e| format!("JSON parsing failed: {e}. Output was: {}", stdout_buf.chars().take(200).collect::<String>()))?;

    let mut results: Vec<SyncScannedItem> = Vec::new();

    let entries = if let Some(arr) = parsed.get("entries").and_then(|v| v.as_array()) {
        arr.iter().collect::<Vec<_>>()
    } else {
        vec![&parsed]
    };

    for entry in entries {
        let raw_id = entry.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if raw_id.is_empty() {
            continue;
        }

        let title = entry.get("title").and_then(|v| v.as_str()).map(|s| s.to_string());
        let raw_url = entry.get("url").and_then(|v| v.as_str());

        let url = match raw_url {
            Some(u) if u.starts_with("http") => u.to_string(),
            Some(u) if platform == "youtube" => format!("https://www.youtube.com/watch?v={u}"),
            _ => match platform.as_str() {
                "youtube" => format!("https://www.youtube.com/watch?v={raw_id}"),
                "x" => format!("https://x.com/i/status/{raw_id}"),
                "instagram" => format!("https://www.instagram.com/p/{raw_id}/"),
                _ => raw_id.to_string(),
            },
        };

        let thumbnail = entry
            .get("thumbnail")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                entry
                    .get("thumbnails")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.last())
                    .and_then(|t| t.get("url"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            });

        let duration = entry.get("duration").and_then(|v| v.as_f64());
        let uploader = entry
            .get("uploader")
            .or_else(|| entry.get("channel"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let timestamp = entry.get("timestamp").and_then(|v| v.as_i64());

        results.push(SyncScannedItem {
            id: raw_id.to_string(),
            url,
            title,
            thumbnail,
            duration,
            uploader,
            platform: platform.clone(),
            timestamp,
        });
    }

    Ok(results)
}

#[tauri::command]
pub fn sync_has_cookies_file(app: AppHandle) -> Result<bool, String> {
    let exists = app_data_dir(&app).map(|d| d.join("cookies.txt").exists()).unwrap_or(false);
    Ok(exists)
}

#[tauri::command]
pub fn sync_upload_cookies(app: AppHandle, content: String) -> Result<bool, String> {
    let dir = app_data_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("cookies.txt"), content.trim()).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Çerez dosyasını siler ve **gerçekten silinip silinmediğini raporlar**.
///
/// Eskiden koşulsuz `Ok(true)` dönüyordu: silme başarısız olsa (izin, kilit) bile
/// arayüz "temizlendi" diyordu — sessiz yalan. Artık sonuç dosyanın varlığına
/// bakılarak bildirilir.
#[tauri::command]
pub fn sync_clear_cookies_file(app: AppHandle) -> Result<bool, String> {
    let dir = app_data_dir(&app)?;
    let path = dir.join("cookies.txt");
    if !path.exists() {
        return Ok(true); // zaten yok: istenen sonuç sağlanmış
    }
    std::fs::remove_file(&path).map_err(|e| format!("Çerez dosyası silinemedi: {e}"))?;
    Ok(!path.exists())
}
