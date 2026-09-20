use std::path::Path;

use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(serde::Serialize)]
pub struct MediaProbeResult {
    duration_secs: f64,
    thumbs: Vec<String>,
    wave: String,
    #[serde(rename = "jobId")]
    job_id: String,
}

fn job_dir(app: &AppHandle, job_id: &str) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .cache_dir()
        .map_err(|e| e.to_string())?
        .join(job_id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

async fn run_ffmpeg(app: &AppHandle, ffmpeg: &Path, args: Vec<String>) -> Result<(), String> {
    // Yol kayıttan çözülmüş olarak gelir (indirilen → gömülü): `sidecar` yalnızca
    // exe yanına bakardı ve indirilen ffmpeg'i göremezdi. Doğrudan yol komutu
    // çalıştırıyoruz (`components::probe_version` ile aynı kanıtlanmış desen).
    let (mut rx, _child) = app
        .shell()
        .command(ffmpeg.to_string_lossy().to_string())
        .args(args)
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut last_err = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(line) => {
                crate::convert::push_capped(&mut last_err, &String::from_utf8_lossy(&line));
            }
            CommandEvent::Error(e) => crate::convert::push_capped(&mut last_err, &e),
            CommandEvent::Terminated(payload) => {
                if payload.code == Some(0) {
                    return Ok(());
                }
                if last_err.trim().is_empty() {
                    last_err = match payload.code {
                        Some(code) => format!("ffmpeg exited with code {code}"),
                        None => format!("ffmpeg terminated (signal {:?})", payload.signal),
                    };
                }
                return Err(last_err);
            }
            _ => {}
        }
    }
    Err("ffmpeg ended without an exit status".to_string())
}

#[tauri::command]
pub async fn media_probe(app: AppHandle, payload: Value) -> Result<MediaProbeResult, String> {
    // Kapı: işe başlamadan aracı çöz. Eksikse `BILESEN_EKSIK:ffmpeg` hemen döner;
    // böylece önbellek klasörü/yarım thumbnail oluşmaz. Eski `sidecar` indirileni göremiyordu.
    let ffmpeg = crate::components::require_tool(&app, "ffmpeg")?;
    let input = payload
        .get("input_path")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or("missing required key input_path")?
        .to_string();

    // Sequential discipline shared with downloads/converts: one ffmpeg at a time.
    let _guard = crate::download::QUEUE.lock().await;

    let ms = crate::convert::probe_duration_ms(&app, &input)
        .await
        .ok_or("could not read media duration")?;
    if ms == 0 {
        return Err("could not read media duration".to_string());
    }
    let duration_secs = ms as f64 / 1000.0;

    let job_id = uuid::Uuid::new_v4().to_string();
    let dir = job_dir(&app, &job_id)?;
    // Thumbs + wave write to plain OS paths; frontend maps them via convertFileSrc.
    let lossy = |p: &std::path::Path| p.to_string_lossy().to_string();

    // ~1 thumb per 12s of footage, hard-capped at 12 frames.
    let n = ((duration_secs / 12.0).round() as u64).max(1);
    let thumb_pattern = lossy(&dir.join("thumb_%03d.jpg"));
    run_ffmpeg(
        &app,
        &ffmpeg,
        vec![
            "-y".to_string(),
            "-i".to_string(),
            input.clone(),
            "-vf".to_string(),
            format!("fps=1/{n},scale=160:-1"),
            "-frames:v".to_string(),
            "12".to_string(),
            thumb_pattern,
        ],
    )
    .await
    .map_err(|e| format!("thumbs failed: {e}"))?;

    let mut thumbs: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("thumb_"))
        })
        .map(|p| lossy(&p))
        .collect();
    thumbs.sort();
    if thumbs.is_empty() {
        return Err("thumbs failed: no frames written".to_string());
    }

    // Waveform is best-effort: empty string on failure, thumbs still returned.
    let wave_path = dir.join("wave.png");
    let wave = match run_ffmpeg(
        &app,
        &ffmpeg,
        vec![
            "-y".to_string(),
            "-i".to_string(),
            input,
            "-filter_complex".to_string(),
            "showwavespic=s=640x80".to_string(),
            "-frames:v".to_string(),
            "1".to_string(),
            lossy(&wave_path),
        ],
    )
    .await
    {
        Ok(()) if wave_path.exists() => lossy(&wave_path),
        _ => String::new(),
    };

    Ok(MediaProbeResult {
        duration_secs,
        thumbs,
        wave,
        job_id,
    })
}

#[tauri::command]
pub async fn media_probe_cleanup(app: AppHandle, payload: Value) -> Result<String, String> {
    // ponytail: both casings accepted (client version drift), like download.rs.
    let job_id = payload
        .get("jobId")
        .or_else(|| payload.get("job_id"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or("missing required key jobId")?;
    if let Ok(dir) = app.path().cache_dir() {
        // ponytail: best-effort temp cleanup — errors ignored by design.
        let _ = std::fs::remove_dir_all(dir.join(job_id));
    }
    Ok("done".to_string())
}
