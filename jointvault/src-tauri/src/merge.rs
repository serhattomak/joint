use std::path::Path;

use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Clone, serde::Serialize)]
struct MergeProgress {
    #[serde(rename = "jobId")]
    job_id: String,
    percent: f64,
}

fn emit_merge_progress(app: &AppHandle, job_id: &str, percent: f64) {
    let _ = app.emit(
        "merge-progress",
        MergeProgress {
            job_id: job_id.to_string(),
            percent,
        },
    );
}

// concat demuxer list format: file '<path>' — tek tırnaklar '\'' olarak kaçırılır.
fn escape_concat_path(p: &str) -> String {
    p.replace('\'', "'\\''")
}

async fn run_ffmpeg_concat(
    app: &AppHandle,
    ffmpeg: &Path,
    job_id: &str,
    list_path: &str,
    output: &str,
    total_ms: Option<u64>,
    reencode: bool,
) -> Result<(), String> {
    // -y first: never block on an overwrite prompt.
    // Bozuk kaynaklarda decoder iptal etmesin (concat list -i'sinden önce gelir).
    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-err_detect".to_string(),
        "ignore_err".to_string(),
        "-f".to_string(),
        "concat".to_string(),
        "-safe".to_string(),
        "0".to_string(),
        "-i".to_string(),
        list_path.to_string(),
    ];
    if reencode {
        args.extend(
            [
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-c:a",
                "aac",
                output,
            ]
            .iter()
            .map(|s| s.to_string()),
        );
    } else {
        args.extend(
            ["-c", "copy", output]
                .iter()
                .map(|s| s.to_string()),
        );
    }
    args.push("-progress".to_string());
    args.push("pipe:1".to_string());
    args.push("-nostats".to_string());

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
            CommandEvent::Stdout(line) => {
                let text = String::from_utf8_lossy(&line);
                for part in text.split(['\n', '\r']) {
                    if let Some(ms_str) = part.strip_prefix("out_time_ms=") {
                        if let (Some(total), Ok(ms)) =
                            (total_ms, ms_str.trim().parse::<u64>())
                        {
                            let pct = (ms as f64 / total as f64 * 100.0).clamp(0.0, 100.0);
                            emit_merge_progress(app, job_id, pct);
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
                return Err(format!(
                    "Birleştirme başarısız: {}",
                    crate::convert::short_ffmpeg_error(&last_err)
                ));
            }
            _ => {}
        }
    }
    Err("ffmpeg ended without an exit status".to_string())
}

#[tauri::command]
pub async fn merge_media(app: AppHandle, payload: Value) -> Result<String, String> {
    // Kapı: işe başlamadan aracı çöz. Eksikse `BILESEN_EKSIK:ffmpeg` hemen döner;
    // böylece geçici concat listesi yazılmaz. Eski `sidecar` indirileni göremiyordu.
    let ffmpeg = crate::components::require_tool(&app, "ffmpeg")?;
    let inputs: Vec<String> = payload
        .get("input_paths")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect()
        })
        .ok_or("missing required key input_paths")?;
    if inputs.len() < 2 {
        return Err("Birleştirmek için en az 2 dosya gerekli.".to_string());
    }
    let output = payload
        .get("output_path")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or("missing required key output_path")?
        .to_string();
    let job_id = payload
        .get("job_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or("missing required key job_id")?
        .to_string();

    // Sequential discipline shared with downloads/converts: one ffmpeg at a time.
    let _guard = crate::download::QUEUE.lock().await;

    let mut total_ms: u64 = 0;
    for input in &inputs {
        if let Some(ms) = crate::convert::probe_duration_ms(&app, input).await {
            total_ms += ms;
        }
    }
    let total_opt = if total_ms > 0 { Some(total_ms) } else { None };

    let list_path = std::env::temp_dir().join(format!("jv-merge-{job_id}.txt"));
    let mut list_txt = String::new();
    for input in &inputs {
        list_txt.push_str(&format!("file '{}'\n", escape_concat_path(input)));
    }
    std::fs::write(&list_path, list_txt).map_err(|e| format!("Liste dosyası yazılamadı: {e}"))?;
    let list_str = list_path.to_string_lossy().to_string();

    emit_merge_progress(&app, &job_id, 0.0);
    // Önce stream-copy dene (A11); olmazsa re-encode fallback.
    match run_ffmpeg_concat(&app, &ffmpeg, &job_id, &list_str, &output, total_opt, false).await {
        Ok(()) => {
            let _ = std::fs::remove_file(&list_path);
            emit_merge_progress(&app, &job_id, 100.0);
            return Ok("done".to_string());
        }
        Err(copy_err) => {
            match run_ffmpeg_concat(&app, &ffmpeg, &job_id, &list_str, &output, total_opt, true).await {
                Ok(()) => {
                    let _ = std::fs::remove_file(&list_path);
                    emit_merge_progress(&app, &job_id, 100.0);
                    Ok("done".to_string())
                }
                Err(e) => {
                    let _ = std::fs::remove_file(&list_path);
                    Err(format!(
                        "Hızlı birleştirme başarısız ({copy_err}) — yeniden kodlama da başarısız: {e}"
                    ))
                }
            }
        }
    }
}
