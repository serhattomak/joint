use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Clone, serde::Serialize)]
struct SilenceProgress {
    #[serde(rename = "jobId")]
    job_id: String,
    percent: f64,
}

fn emit_silence_progress(app: &AppHandle, job_id: &str, percent: f64) {
    let _ = app.emit(
        "silence-progress",
        SilenceProgress {
            job_id: job_id.to_string(),
            percent,
        },
    );
}

// Preset → silencedetect eşiği (dB) ve minimum sessizlik süresi (sn).
// strict = agresif (yüksek eşik, kısa süre — daha çok kırpar),
// normal = dengeli, loose = muhafazakâr (düşük eşik, uzun süre — sadece bariz sessizlikler).
fn preset_detect_params(preset: &str) -> Option<(i32, f64)> {
    match preset {
        "strict" => Some((-40, 0.3)),
        "normal" => Some((-45, 0.5)),
        "loose" => Some((-50, 1.0)),
        _ => None,
    }
}

// 1. pass: silencedetect çıktısından (başlangıç, bitiş) aralıklarını topla.
// Tespit başarısız olursa boş liste döner — çağıran kopyaya düşer, hata vermez.
async fn detect_silences(
    app: &AppHandle,
    input: &str,
    thr_db: i32,
    min_d: f64,
    preview: bool,
) -> Vec<(f64, f64)> {
    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-err_detect".to_string(),
        "ignore_err".to_string(),
    ];
    if preview {
        args.push("-t".to_string());
        args.push("30".to_string());
    }
    args.push("-i".to_string());
    args.push(input.to_string());
    args.push("-af".to_string());
    args.push(format!("silencedetect=n={thr_db}dB:d={min_d}"));
    args.push("-vn".to_string());
    args.push("-sn".to_string());
    args.push("-dn".to_string());
    args.push("-f".to_string());
    args.push("null".to_string());
    args.push("-".to_string());
    let sidecar = match app.shell().sidecar("ffmpeg") {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let (mut rx, _child) = match sidecar.args(args).spawn() {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    let mut out = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(line) => {
                out.push_str(&String::from_utf8_lossy(&line));
                out.push('\n');
            }
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }
    let mut starts: Vec<f64> = Vec::new();
    let mut ends: Vec<f64> = Vec::new();
    for line in out.lines() {
        if let Some(v) = line.split("silence_start:").nth(1) {
            if let Ok(x) = v.trim().parse::<f64>() {
                starts.push(x);
            }
        } else if let Some(v) = line.split("silence_end:").nth(1) {
            let v = v.split('|').next().unwrap_or(v);
            if let Ok(x) = v.trim().parse::<f64>() {
                ends.push(x);
            }
        }
    }
    starts.into_iter().zip(ends).collect()
}

#[tauri::command]
pub async fn trim_silence(app: AppHandle, payload: Value) -> Result<String, String> {
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
    let preset = get("preset")?;
    let (thr_db, min_d) = preset_detect_params(&preset)
        .ok_or("preset \"strict\", \"normal\" ya da \"loose\" olmalı.".to_string())?;
    let preview = payload
        .get("preview")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // Sequential discipline shared with downloads/converts/merges: one ffmpeg at a time (iki pass da kilit altında).
    let _guard = crate::download::QUEUE.lock().await;

    // 1. pass: sessizlik aralıklarını tespit et (eşik + minimum süre preset'ten gelir).
    let silences = detect_silences(&app, &input, thr_db, min_d, preview).await;

    let total_ms: Option<u64> = if preview {
        Some(30_000)
    } else {
        crate::convert::probe_duration_ms(&app, &input).await
    };
    // Süre bilinemezse kesim yapılamaz — ham hata yerine anlaşılır mesaj.
    let total_s = match total_ms {
        Some(ms) if ms > 0 => ms as f64 / 1000.0,
        _ => return Err("Medya süresi okunamadı, dosya bozuk olabilir.".to_string()),
    };

    // 2. pass hazırlığı: keep listesi = sessizliklerin tümleyeni.
    // Ses VE görüntü birlikte kesilir (senkron korunur).
    let mut keeps: Vec<(f64, f64)> = Vec::new();
    let mut cur = 0.0;
    for (s, e) in &silences {
        let s = s.clamp(0.0, total_s);
        let e = e.clamp(0.0, total_s);
        if s > cur {
            keeps.push((cur, s));
        }
        if e > cur {
            cur = e;
        }
    }
    if cur < total_s {
        keeps.push((cur, total_s));
    }
    keeps.retain(|(a, b)| b - a > 0.02);

    // -y first: never block on an overwrite prompt.
    // Bozuk kaynaklarda decoder iptal etmesin (tüm -i'lerden önce gelir).
    // Önizlemede ilk 30sn: -t 30 girdiden ÖNCE gelir (hızlı, sadece başı okur).
    let mut args: Vec<String> = vec![
        "-y".to_string(),
        "-err_detect".to_string(),
        "ignore_err".to_string(),
    ];
    if preview {
        args.push("-t".to_string());
        args.push("30".to_string());
    }
    // İlerleme paydası: tutulan toplam süre (kopya durumunda dosya süresi).
    let mut progress_total_ms = total_ms;
    // Kırpılacak bir şey yoksa hızlı kopya; yoksa select/aselect ile A/V kesimi.
    let nothing_to_cut =
        keeps.is_empty() || (keeps.len() == 1 && (keeps[0].1 - keeps[0].0) >= total_s - 0.05);
    if nothing_to_cut {
        args.push("-i".to_string());
        args.push(input.clone());
        args.push("-c".to_string());
        args.push("copy".to_string());
        args.push(output.clone());
    } else {
        let expr = keeps
            .iter()
            .map(|(a, b)| format!("between(t,{a:.3},{b:.3})"))
            .collect::<Vec<_>>()
            .join("+");
        let kept_s: f64 = keeps.iter().map(|(a, b)| b - a).sum();
        progress_total_ms = Some((kept_s * 1000.0).round() as u64);
        args.push("-i".to_string());
        args.push(input.clone());
        args.push("-vf".to_string());
        args.push(format!("select='{expr}',setpts=N/FRAME_RATE/TB"));
        args.push("-af".to_string());
        args.push(format!("aselect='{expr}',asetpts=N/SR/TB"));
        args.push("-c:v".to_string());
        args.push("libx264".to_string());
        args.push("-preset".to_string());
        args.push("veryfast".to_string());
        args.push("-crf".to_string());
        args.push("23".to_string());
        args.push("-c:a".to_string());
        args.push("aac".to_string());
        args.push(output.clone());
    }
    args.push("-progress".to_string());
    args.push("pipe:1".to_string());
    args.push("-nostats".to_string());

    emit_silence_progress(&app, &job_id, 0.0);

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
                        if let (Some(total), Ok(ms)) =
                            (progress_total_ms, ms_str.trim().parse::<u64>())
                        {
                            let pct = (ms as f64 / total as f64 * 100.0).clamp(0.0, 100.0);
                            emit_silence_progress(&app, &job_id, pct);
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
                    emit_silence_progress(&app, &job_id, 100.0);
                    return Ok("done".to_string());
                }
                if last_err.trim().is_empty() {
                    last_err = match payload.code {
                        Some(code) => format!("ffmpeg exited with code {code}"),
                        None => format!("ffmpeg terminated (signal {:?})", payload.signal),
                    };
                }
                return Err(format!(
                    "Sessizlik kırpma başarısız: {}",
                    crate::convert::short_ffmpeg_error(&last_err)
                ));
            }
            _ => {}
        }
    }
    Err("ffmpeg ended without an exit status".to_string())
}
