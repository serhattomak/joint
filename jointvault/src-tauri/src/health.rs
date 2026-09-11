use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

// `-version` probu: sidecar çözülemez ya da çalıştırılamazsa kurulu değil.
// Eksik parça hata değildir (wizard asla engellemez) — sadece bayrak döner.
async fn probe_version(app: &AppHandle, name: &str) -> (bool, Option<String>) {
    let cmd = match app.shell().sidecar(name) {
        Ok(c) => c,
        Err(_) => return (false, None),
    };
    let (mut rx, _child) = match cmd.args(["-version"]).spawn() {
        Ok(pair) => pair,
        Err(_) => return (false, None),
    };
    let mut first: Option<String> = None;
    let mut ran = false;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                if first.is_none() {
                    let text = String::from_utf8_lossy(&line).trim().to_string();
                    // ponytail: ilk satır yeterli ("ffmpeg version 7.x ..." gibi).
                    if let Some(l) = text.lines().next().map(|l| l.trim().to_string()) {
                        if !l.is_empty() {
                            first = Some(l);
                        }
                    }
                }
            }
            CommandEvent::Terminated(_) => {
                ran = true;
                break;
            }
            _ => {}
        }
    }
    (ran, first)
}

// whisper.rs'teki 5 satırlık path join'in kopyası (whisper.rs'a dokunmadan).
fn model_present(app: &AppHandle, model: &str) -> bool {
    match app.path().app_data_dir() {
        Ok(dir) => dir
            .join("jointvault-models")
            .join(format!("ggml-{model}.bin"))
            .exists(),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn health_check(app: AppHandle) -> Result<String, String> {
    let (ffmpeg_available, ffmpeg_version) = probe_version(&app, "ffmpeg").await;
    let (ffprobe_available, ffprobe_version) = probe_version(&app, "ffprobe").await;
    // Binary yoksa hata değil: kullanılabilirlik bayrağı yeterli.
    let whisper_available = app.shell().sidecar("whisper").is_ok();
    let download_dir = crate::settings::get_download_dir(app.clone()).ok();
    Ok(serde_json::json!({
        "ffmpeg": { "available": ffmpeg_available, "version": ffmpeg_version },
        "ffprobe": { "available": ffprobe_available, "version": ffprobe_version },
        "whisper": { "available": whisper_available },
        "models": {
            "tiny": model_present(&app, "tiny"),
            "base": model_present(&app, "base"),
            "small": model_present(&app, "small"),
        },
        "download_dir": download_dir,
    })
    .to_string())
}
