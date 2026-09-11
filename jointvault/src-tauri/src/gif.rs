use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Clone, serde::Serialize)]
struct GifProgress {
    #[serde(rename = "jobId")]
    job_id: String,
    percent: f64,
}

fn emit_gif_progress(app: &AppHandle, job_id: &str, percent: f64) {
    let _ = app.emit(
        "gif-progress",
        GifProgress {
            job_id: job_id.to_string(),
            percent,
        },
    );
}

fn get_str(payload: &Value, key: &str) -> Result<String, String> {
    payload
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("missing required key {key}"))
}

// from/to hem string ("12.5") hem sayı gelebilir — ikisini de saniyeye çevirir.
fn get_secs(payload: &Value, key: &str) -> Result<f64, String> {
    match payload.get(key) {
        Some(v) if v.is_number() => v
            .as_f64()
            .filter(|n| n.is_finite() && *n >= 0.0)
            .ok_or_else(|| format!("{key} geçersiz sayı.")),
        Some(v) if v.is_string() => v
            .as_str()
            .unwrap_or("")
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|n| n.is_finite() && *n >= 0.0)
            .ok_or_else(|| format!("{key} geçersiz sayı.")),
        _ => Err(format!("missing required key {key}")),
    }
}

fn get_num(payload: &Value, key: &str) -> Result<f64, String> {
    match payload.get(key) {
        Some(v) if v.is_number() => v
            .as_f64()
            .filter(|n| n.is_finite())
            .ok_or_else(|| format!("{key} geçersiz sayı.")),
        Some(v) if v.is_string() => v
            .as_str()
            .unwrap_or("")
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|n| n.is_finite())
            .ok_or_else(|| format!("{key} geçersiz sayı.")),
        _ => Err(format!("missing required key {key}")),
    }
}

async fn run_ffmpeg(
    app: &AppHandle,
    job_id: &str,
    args: Vec<String>,
    total_ms: u64,
    base: f64,
    span: f64,
) -> Result<(), String> {
    let (mut rx, _child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args(args)
        .spawn()
        .map_err(|e| e.to_string())?;

    let mut last_err = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let text = String::from_utf8_lossy(&line);
                for part in text.split(['\n', '\r']) {
                    if let Some(ms_str) = part.strip_prefix("out_time_ms=") {
                        if let Ok(ms) = ms_str.trim().parse::<u64>() {
                            let pct = if total_ms > 0 {
                                (ms as f64 / total_ms as f64 * 100.0).clamp(0.0, 100.0)
                            } else {
                                0.0
                            };
                            emit_gif_progress(app, job_id, base + pct * span / 100.0);
                        }
                    }
                }
            }
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
                return Err(crate::convert::short_ffmpeg_error(&last_err));
            }
            _ => {}
        }
    }
    Err("ffmpeg ended without an exit status".to_string())
}

#[tauri::command]
pub async fn make_gif(app: AppHandle, payload: Value) -> Result<String, String> {
    let input = get_str(&payload, "input_path")?;
    let output = get_str(&payload, "output_path")?;
    let job_id = get_str(&payload, "job_id")?;
    let format = get_str(&payload, "format")?;
    let is_gif = match format.as_str() {
        "gif" => true,
        "webm" => false,
        _ => return Err("format \"gif\" ya da \"webm\" olmalı.".to_string()),
    };
    let from = get_secs(&payload, "from")?;
    let to = get_secs(&payload, "to")?;
    if !(to > from) {
        return Err("Bitiş, başlangıçtan büyük olmalı.".to_string());
    }
    let seg_secs = to - from;
    let max_secs = if is_gif { 15.0 } else { 30.0 };
    if seg_secs > max_secs {
        let label = if is_gif { "GIF" } else { "WebM" };
        return Err(format!(
            "{label} en fazla {max_secs} saniyelik bölümden üretilebilir (seçili: {seg_secs:.1} sn)."
        ));
    }
    let width = (get_num(&payload, "width")? as i64).clamp(160, 640);
    let fps = (get_num(&payload, "fps")? as i64).clamp(5, 20);

    // Sequential discipline shared with downloads/converts/merges/silence: one ffmpeg at a time.
    let _guard = crate::download::QUEUE.lock().await;

    let total_ms = (seg_secs * 1000.0).round() as u64;
    let from_s = from.to_string();
    let to_s = to.to_string();
    let vf_base = format!("fps={fps},scale={width}:-1");
    emit_gif_progress(&app, &job_id, 0.0);

    if is_gif {
        // 2-pass paletli GIF: pass1 paleti üretir (0..50), pass2 uygular (50..100).
        let palette_path = std::env::temp_dir().join(format!("jv-gif-{job_id}.png"));
        let palette_str = palette_path.to_string_lossy().to_string();
        let pass1 = vec![
            "-y".to_string(),
            "-err_detect".to_string(),
            "ignore_err".to_string(),
            "-ss".to_string(),
            from_s.clone(),
            "-to".to_string(),
            to_s.clone(),
            "-i".to_string(),
            input.clone(),
            "-vf".to_string(),
            format!("{vf_base}:flags=lanczos,palettegen"),
            palette_str.clone(),
            "-progress".to_string(),
            "pipe:1".to_string(),
            "-nostats".to_string(),
        ];
        if let Err(e) = run_ffmpeg(&app, &job_id, pass1, total_ms, 0.0, 50.0).await {
            let _ = std::fs::remove_file(&palette_path);
            return Err(format!("GIF paleti üretilemedi: {e}"));
        }
        emit_gif_progress(&app, &job_id, 50.0);
        let pass2 = vec![
            "-y".to_string(),
            "-err_detect".to_string(),
            "ignore_err".to_string(),
            "-ss".to_string(),
            from_s,
            "-to".to_string(),
            to_s,
            "-i".to_string(),
            input,
            "-i".to_string(),
            palette_str,
            "-lavfi".to_string(),
            format!("{vf_base}:flags=lanczos[x];[x][1:v]paletteuse"),
            output,
            "-progress".to_string(),
            "pipe:1".to_string(),
            "-nostats".to_string(),
        ];
        let res = run_ffmpeg(&app, &job_id, pass2, total_ms, 50.0, 50.0).await;
        let _ = std::fs::remove_file(&palette_path);
        res.map_err(|e| format!("GIF üretilemedi: {e}"))?;
    } else {
        let args = vec![
            "-y".to_string(),
            "-err_detect".to_string(),
            "ignore_err".to_string(),
            "-ss".to_string(),
            from_s,
            "-to".to_string(),
            to_s,
            "-i".to_string(),
            input,
            "-vf".to_string(),
            vf_base,
            "-c:v".to_string(),
            "libvpx-vp9".to_string(),
            "-b:v".to_string(),
            "0".to_string(),
            "-crf".to_string(),
            "30".to_string(),
            "-an".to_string(),
            output,
            "-progress".to_string(),
            "pipe:1".to_string(),
            "-nostats".to_string(),
        ];
        run_ffmpeg(&app, &job_id, args, total_ms, 0.0, 100.0)
            .await
            .map_err(|e| format!("WebM üretilemedi: {e}"))?;
    }
    emit_gif_progress(&app, &job_id, 100.0);
    Ok("done".to_string())
}
