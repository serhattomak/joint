use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Clone, serde::Serialize)]
struct ConvertProgress {
    #[serde(rename = "jobId")]
    job_id: String,
    percent: f64,
}

pub(crate) fn push_capped(buf: &mut String, chunk: &str) {
    buf.push_str(chunk);
    if buf.len() > 2000 {
        let mut cut = buf.len() - 2000;
        while !buf.is_char_boundary(cut) {
            cut += 1;
        }
        buf.drain(..cut);
    }
}

// Ham ffmpeg log'unu kullanıcı-dostu kısa mesaja indirger: bilinen kalıba TR ipucu + son ~300 karakter.
// ponytail: kalıp listesi kısa tutuldu — yeni desen gerekirse buraya tek dal eklenir.
pub(crate) fn short_ffmpeg_error(raw: &str) -> String {
    let raw = raw.trim();
    let hint = if raw.contains("Decode error rate")
        || raw.contains("corrupt")
        || raw.contains("Invalid data found when processing input")
    {
        "kaynak dosya bozuk görünüyor"
    } else if raw.contains("No such file or directory") {
        "dosya bulunamadı, yolu kontrol et"
    } else if raw.contains("No space left on device") {
        "diskte yer kalmadı"
    } else if raw.contains("Permission denied") {
        "dosya izni engellendi"
    } else if raw.contains("matches no streams")
        || raw.contains("Stream map")
        || raw.contains("does not contain any stream")
    {
        "uygun akış bulunamadı"
    } else {
        "teknik ayrıntı"
    };
    let tail = if raw.len() > 300 {
        let mut cut = raw.len() - 300;
        while !raw.is_char_boundary(cut) {
            cut += 1;
        }
        &raw[cut..]
    } else {
        raw
    };
    format!("({hint}). …{tail}")
}

fn emit_convert_progress(app: &AppHandle, job_id: &str, percent: f64) {
    let _ = app.emit(
        "convert-progress",
        ConvertProgress {
            job_id: job_id.to_string(),
            percent,
        },
    );
}

// ponytail: no regex crate — scan "Duration: HH:MM:SS.xx" out of `ffmpeg -i` stderr.
pub(crate) fn parse_duration_ms(stderr: &str) -> Option<u64> {
    let idx = stderr.find("Duration: ")?;
    let rest = &stderr[idx + "Duration: ".len()..];
    let token = rest.split_whitespace().next()?;
    let mut parts = token.trim_end_matches(',').split(':');
    let h: u64 = parts.next()?.parse().ok()?;
    let m: u64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    Some(h * 3_600_000 + m * 60_000 + (s * 1000.0) as u64)
}

pub(crate) async fn probe_duration_ms(app: &AppHandle, input: &str) -> Option<u64> {
    // Yol kayıttan çözülür (indirilen → gömülü): `sidecar` yalnızca exe yanına
    // bakardı ve bileşen yöneticisinin `components/`e indirdiği ffmpeg'i görmezdi.
    // İmza `Option` kalır: süre ölçümü best-effort'tur, çağıranlar zaten komut
    // kapısından (`require_tool`) geçtiği için buradaki `None` yalnızca yarış durumudur.
    let (ffmpeg, _) = crate::components::resolve_tool(app, "ffmpeg")?;
    let (mut rx, _child) = app
        .shell()
        .command(ffmpeg.to_string_lossy().to_string())
        .args(["-i", input])
        .spawn()
        .ok()?;
    let mut stderr = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(line) => {
                push_capped(&mut stderr, &String::from_utf8_lossy(&line));
                stderr.push('\n');
            }
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }
    parse_duration_ms(&stderr).filter(|ms| *ms > 0)
}

#[tauri::command]
pub async fn convert_media(app: AppHandle, payload: Value) -> Result<String, String> {
    // Kapı: işe başlamadan aracı çöz. Eksikse `BILESEN_EKSIK:ffmpeg` hemen döner;
    // böylece yarım çıktı ya da yarım iş durumu oluşmaz. Eski sidecar çözümlemesi
    // yalnızca exe yanına bakıyordu ve indirilen bileşeni göremiyordu.
    let ffmpeg = crate::components::require_tool(&app, "ffmpeg")?;
    let get = |key: &str| -> Result<String, String> {
        payload
            .get(key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("missing required key {key}"))
    };
    let input = get("input_path")?;
    let output = get("output_path")?;
    let job_id = get("job_id")?;
    let op = payload.get("op").ok_or("missing required key op")?;
    let kind = op
        .get("kind")
        .and_then(|v| v.as_str())
        .ok_or("missing required key op.kind")?;
    // Optional trim bounds, seconds strings passed through to ffmpeg.
    let from = op
        .get("from")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let to = op
        .get("to")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    // Frame-accurate trim: seek after -i forces re-encode (slow). Default false = fast -c copy path.
    let accurate = op
        .get("accurate")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // -y first: never block on an overwrite prompt.
    // Bozuk kaynaklarda decoder iptal etmesin (input opsiyonu: tüm -i'lerden önce gelir).
    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-err_detect".to_string(),
        "ignore_err".to_string(),
    ];
    match kind {
        "mp4" => {
            if let Some(f) = from {
                args.push("-ss".to_string());
                args.push(f.to_string());
            }
            if let Some(t) = to {
                args.push("-to".to_string());
                args.push(t.to_string());
            }
            args.extend(
                [
                    "-i",
                    input.as_str(),
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "23",
                    "-c:a",
                    "aac",
                    output.as_str(),
                ]
                .iter()
                .map(|s| s.to_string()),
            );
        }
        "mp3" => {
            args.extend(
                [
                    "-i",
                    input.as_str(),
                    "-vn",
                    "-c:a",
                    "libmp3lame",
                    "-b:a",
                    "192k",
                    output.as_str(),
                ]
                .iter()
                .map(|s| s.to_string()),
            );
        }
        "m4a" => {
            args.extend(
                [
                    "-i",
                    input.as_str(),
                    "-vn",
                    "-c:a",
                    "aac",
                    output.as_str(),
                ]
                .iter()
                .map(|s| s.to_string()),
            );
        }
        "trim" => {
            let (Some(f), Some(t)) = (from, to) else {
                return Err("trim requires op.from and op.to".to_string());
            };
            if accurate {
                // -ss/-to AFTER -i: frame-accurate, forces re-encode (slow, editor path).
                args.extend(
                    [
                        "-i",
                        input.as_str(),
                        "-ss",
                        f,
                        "-to",
                        t,
                        "-c:v",
                        "libx264",
                        "-preset",
                        "veryfast",
                        "-crf",
                        "23",
                        "-c:a",
                        "aac",
                        output.as_str(),
                    ]
                    .iter()
                    .map(|s| s.to_string()),
                );
            } else {
                // Fast path, byte-identical to before: seek before -i + stream copy.
                args.extend(
                    [
                        "-ss",
                        f,
                        "-to",
                        t,
                        "-i",
                        input.as_str(),
                        "-c",
                        "copy",
                        output.as_str(),
                    ]
                    .iter()
                    .map(|s| s.to_string()),
                );
            }
        }
        _ => return Err("op.kind must be \"mp4\", \"mp3\", \"m4a\" or \"trim\"".to_string()),
    }
    args.push("-progress".to_string());
    args.push("pipe:1".to_string());
    args.push("-nostats".to_string());

    // Sequential discipline shared with downloads: one ffmpeg/yt-dlp at a time.
    let _guard = crate::download::QUEUE.lock().await;

    let total_ms = probe_duration_ms(&app, &input).await;
    emit_convert_progress(&app, &job_id, 0.0);

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
                            emit_convert_progress(&app, &job_id, pct);
                        }
                    }
                }
            }
            CommandEvent::Stderr(line) => {
                push_capped(&mut last_err, &String::from_utf8_lossy(&line));
            }
            CommandEvent::Error(e) => push_capped(&mut last_err, &e),
            CommandEvent::Terminated(payload) => {
                if payload.code == Some(0) {
                    emit_convert_progress(&app, &job_id, 100.0);
                    return Ok("done".to_string());
                }
                if last_err.trim().is_empty() {
                    last_err = match payload.code {
                        Some(code) => format!("ffmpeg exited with code {code}"),
                        None => format!("ffmpeg terminated (signal {:?})", payload.signal),
                    };
                }
                return Err(format!("Dönüştürme başarısız: {}", short_ffmpeg_error(&last_err)));
            }
            _ => {}
        }
    }
    Err("ffmpeg ended without an exit status".to_string())
}
