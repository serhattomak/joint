use serde_json::Value;
use std::io::Read as _;
use std::io::Write as _;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(Clone, serde::Serialize)]
struct WhisperProgress {
    #[serde(rename = "jobId")]
    job_id: String,
    percent: f64,
}

fn emit_whisper_progress(app: &AppHandle, job_id: &str, percent: f64) {
    let _ = app.emit(
        "whisper-progress",
        WhisperProgress {
            job_id: job_id.to_string(),
            percent,
        },
    );
}

fn emit_model_progress(app: &AppHandle, job_id: &str, percent: f64) {
    let _ = app.emit(
        "whisper-model-progress",
        WhisperProgress {
            job_id: job_id.to_string(),
            percent,
        },
    );
}

fn emit_engine_progress(app: &AppHandle, job_id: &str, percent: f64) {
    let _ = app.emit(
        "whisper-engine-progress",
        WhisperProgress {
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

fn valid_model(model: &str) -> bool {
    model == "tiny" || model == "base" || model == "small"
}

fn model_file_name(model: &str) -> String {
    format!("ggml-{model}.bin")
}

fn model_url(model: &str) -> String {
    format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin")
}

fn models_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("jointvault-models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Model klasörü açılamadı: {e}"))?;
    Ok(dir)
}

fn model_path(app: &AppHandle, model: &str) -> Result<std::path::PathBuf, String> {
    if !valid_model(model) {
        return Err("model \"tiny\", \"base\" ya da \"small\" olmalı.".to_string());
    }
    Ok(models_dir(app)?.join(model_file_name(model)))
}

// Kaynağın yanına <stem>-transkript.srt (transkript çıktısı, arşive yazılmaz).
fn transcript_path(input: &str) -> String {
    let i = input.rfind(['/', '\\']);
    let (dir, base) = match i {
        Some(p) => (&input[..p], &input[p + 1..]),
        None => ("", input),
    };
    let stem = match base.rfind('.') {
        Some(d) if d > 0 => &base[..d],
        _ => base,
    };
    if dir.is_empty() {
        format!("{stem}-transkript.srt")
    } else {
        let sep = if input.contains('\\') { '\\' } else { '/' };
        format!("{dir}{sep}{stem}-transkript.srt")
    }
}

// whisper.cpp CLI `--help` probu: sidecar çözülemez ya da çalıştırılamazsa kurulu değil.
async fn sidecar_available(app: &AppHandle) -> bool {
    let cmd = match app.shell().sidecar("whisper") {
        Ok(c) => c,
        Err(_) => return false,
    };
    let (mut rx, _child) = match cmd.args(["--help"]).spawn() {
        Ok(pair) => pair,
        Err(_) => return false,
    };
    while let Some(event) = rx.recv().await {
        if matches!(event, CommandEvent::Terminated(_)) {
            return true;
        }
    }
    false
}

#[tauri::command]
pub async fn whisper_status(app: AppHandle) -> Result<String, String> {
    let available = sidecar_available(&app).await;
    let dir = models_dir(&app)?;
    let has = |m: &str| dir.join(model_file_name(m)).exists();
    Ok(serde_json::json!({
        "whisper_available": available,
        "models": { "tiny": has("tiny"), "base": has("base"), "small": has("small") },
        "models_dir": dir.to_string_lossy().to_string(),
    })
    .to_string())
}

#[tauri::command]
pub async fn download_model(app: AppHandle, payload: Value) -> Result<String, String> {
    let model = get_str(&payload, "model")?;
    let job_id = get_str(&payload, "job_id")?;
    if !valid_model(&model) {
        return Err("model \"tiny\", \"base\" ya da \"small\" olmalı.".to_string());
    }
    // Tekli kuyruk (A13): indirme + ffmpeg + whisper aynı anda koşmasın, CPU donmasın.
    let _guard = crate::download::QUEUE.lock().await;

    let target = model_path(&app, &model)?;
    if target.exists() {
        emit_model_progress(&app, &job_id, 100.0);
        return Ok("done".to_string());
    }
    let part = target.with_extension("bin.part");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client
        .get(model_url(&model))
        .header("User-Agent", "JointVault/1.0")
        .send()
        .await
        .map_err(|e| format!("Model indirilemedi: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Model indirilemedi: {e}"))?;
    let total = resp.content_length();
    let mut file =
        std::fs::File::create(&part).map_err(|e| format!("Model dosyası açılamadı: {e}"))?;
    emit_model_progress(&app, &job_id, 0.0);
    let mut downloaded: u64 = 0;
    let mut emitted_unknown = false;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Model indirilemedi: {e}"))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("Model yazılamadı: {e}"))?;
        downloaded += chunk.len() as u64;
        match total {
            Some(t) if t > 0 => emit_model_progress(
                &app,
                &job_id,
                (downloaded as f64 / t as f64 * 100.0).clamp(0.0, 100.0),
            ),
            _ => {
                if !emitted_unknown {
                    emit_model_progress(&app, &job_id, -1.0);
                    emitted_unknown = true;
                }
            }
        }
    }
    drop(file);
    std::fs::rename(&part, &target).map_err(|e| format!("Model taşınamadı: {e}"))?;
    emit_model_progress(&app, &job_id, 100.0);
    Ok("done".to_string())
}

// whisper.cpp CLI binary (v1.7.6 sabit — sonraki sürümlerde asset yok).
const WHISPER_ENGINE_URL: &str =
    "https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip";
const WHISPER_ENGINE_SHA256: &str =
    "0d2eca299c248f965bd0341bcb219db4b433c7f0c0ce2200d4df85765e8156a9";
// Zip-bomba koruması: tek girdinin makul üst sınırı.
const WHISPER_ENGINE_MAX_ENTRY_BYTES: u64 = 200 * 1024 * 1024;

// Sidecar hedefi: dev'de src-tauri/binaries/whisper-<triple>.exe, prod'da exe yanı/whisper.exe.
// Çalışma-anı hedefi: her zaman exe yanı/whisper.exe — sidecar() buraya bakar (plugin kaynağı).
fn engine_runtime_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "Çalıştırılabilir dizin bulunamadı.".to_string())?;
    Ok(dir.join("whisper.exe"))
}

// Derleme/paketleme kaynağı (sadece dev düzeni): src-tauri/binaries/whisper-<triple>.exe.
// Gelecek build'ler externalBin ile bunu exe yanına kopyalar.
fn engine_source_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let triple = option_env!("TAURI_ENV_TARGET_TRIPLE").unwrap_or("x86_64-pc-windows-msvc");
    for anc in exe.ancestors() {
        if let Some(name) = anc.file_name().and_then(|n| n.to_str()) {
            if name == "debug" || name == "release" {
                return anc.parent().and_then(|t| t.parent()).map(|src_tauri| {
                    src_tauri
                        .join("binaries")
                        .join(format!("whisper-{triple}.exe"))
                });
            }
        }
    }
    None
}

#[tauri::command]
pub async fn download_whisper_engine(app: AppHandle, payload: Value) -> Result<String, String> {
    let job_id = get_str(&payload, "job_id")?;
    // Tekli kuyruk (A13): indirme + ffmpeg + whisper aynı anda koşmasın.
    let _guard = crate::download::QUEUE.lock().await;

    // Zaten çalışıyorsa tekrar indirme.
    if sidecar_available(&app).await {
        emit_engine_progress(&app, &job_id, 100.0);
        return Ok("done".to_string());
    }

    let tmp = std::env::temp_dir();
    let part = tmp.join(format!("jv-whisper-engine-{job_id}.zip.part"));
    let zip_path = tmp.join(format!("jv-whisper-engine-{job_id}.zip"));
    let cleanup = || {
        let _ = std::fs::remove_file(&part);
        let _ = std::fs::remove_file(&zip_path);
    };
    cleanup();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client
        .get(WHISPER_ENGINE_URL)
        .header("User-Agent", "JointVault/1.0")
        .send()
        .await
        .map_err(|e| format!("Motor indirilemedi: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Motor indirilemedi: {e}"))?;
    let total = resp.content_length();
    let mut file = std::fs::File::create(&part).map_err(|e| {
        cleanup();
        format!("Motor dosyası açılamadı: {e}")
    })?;
    emit_engine_progress(&app, &job_id, 0.0);
    let mut downloaded: u64 = 0;
    let mut emitted_unknown = false;
    while let Some(chunk) = resp.chunk().await.map_err(|e| {
        cleanup();
        format!("Motor indirilemedi: {e}")
    })? {
        file.write_all(&chunk).map_err(|e| {
            cleanup();
            format!("Motor yazılamadı: {e}")
        })?;
        downloaded += chunk.len() as u64;
        match total {
            Some(t) if t > 0 => emit_engine_progress(
                &app,
                &job_id,
                (downloaded as f64 / t as f64 * 100.0).clamp(0.0, 100.0),
            ),
            _ => {
                if !emitted_unknown {
                    emit_engine_progress(&app, &job_id, -1.0);
                    emitted_unknown = true;
                }
            }
        }
    }
    drop(file);
    std::fs::rename(&part, &zip_path).map_err(|e| {
        cleanup();
        format!("Motor taşınamadı: {e}")
    })?;

    // sha256 doğrula (hex, küçük harf).
    let bytes = std::fs::read(&zip_path).map_err(|e| {
        cleanup();
        format!("Motor okunamadı: {e}")
    })?;
    {
        use sha2::Digest as _;
        let mut h = sha2::Sha256::new();
        h.update(&bytes);
        if format!("{:x}", h.finalize()) != WHISPER_ENGINE_SHA256 {
            cleanup();
            return Err("Motor doğrulaması başarısız (sha256 uyuşmadı). İndirme silindi, tekrar dene."
                .to_string());
        }
    }

    // whisper-cli.exe + DLL'leri hedefe yaz (exe tek başına çalışmaz).
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).map_err(|e| {
        cleanup();
        format!("Motor arşivi açılamadı: {e}")
    })?;
    let mut exe_bytes: Option<Vec<u8>> = None;
    // (dosya adı, içerik): exe'nin yanına yazılacak DLL'ler.
    let mut dlls: Vec<(String, Vec<u8>)> = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| {
            cleanup();
            format!("Motor arşivi okunamadı: {e}")
        })?;
        let lower = entry.name().to_lowercase();
        let is_exe = lower.ends_with("whisper-cli.exe");
        let base = lower.rsplit(['/', '\\']).next().unwrap_or("");
        // SDL2.dll sunucu tarafı için; transkript yolunda gereksiz.
        let is_needed_dll = lower.ends_with(".dll") && !base.starts_with("sdl2");
        if !is_exe && !is_needed_dll {
            continue;
        }
        if entry.size() > WHISPER_ENGINE_MAX_ENTRY_BYTES {
            cleanup();
            return Err("Motor arşivi beklenenden büyük, indirme iptal edildi.".to_string());
        }
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf).map_err(|e| {
            cleanup();
            format!("Motor çıkarılamadı: {e}")
        })?;
        if is_exe {
            exe_bytes = Some(buf);
        } else {
            dlls.push((base.to_string(), buf));
        }
    }
    drop(archive);
    let exe_bytes = match exe_bytes {
        Some(b) => b,
        None => {
            cleanup();
            return Err("Motor arşivinde whisper-cli.exe bulunamadı.".to_string());
        }
    };
    let runtime = engine_runtime_path()?;
    let dir = runtime
        .parent()
        .ok_or_else(|| {
            cleanup();
            "Motor klasörü bulunamadı.".to_string()
        })?
        .to_path_buf();
        std::fs::create_dir_all(&dir).map_err(|e| {
            cleanup();
            format!("Motor klasörü açılamadı: {e}")
        })?;
    std::fs::write(&runtime, &exe_bytes).map_err(|e| {
        cleanup();
        format!("Motor yazılamadı: {e}")
    })?;
    for (name, buf) in &dlls {
        std::fs::write(dir.join(name), buf).map_err(|e| {
            cleanup();
            format!("Motor parçası yazılamadı ({name}): {e}")
        })?;
    }
    // Gelecek build'ler pakete alsın diye kaynağa da koy (sessizce geç).
    if let Some(source) = engine_source_path() {
        if let Some(parent) = source.parent() {
            if std::fs::create_dir_all(parent).is_ok() {
                let _ = std::fs::write(&source, &exe_bytes);
                for (name, buf) in &dlls {
                    let _ = std::fs::write(parent.join(name), buf);
                }
            }
        }
    }
    cleanup();
    emit_engine_progress(&app, &job_id, 100.0);
    if sidecar_available(&app).await {
        Ok("done".to_string())
    } else {
        Err("Motor indirildi ama çalıştırılamadı. jointvault/docs/media-tools-deferred.md §1'deki manuel adımları dene.".to_string())
    }
}

// Kısa ffmpeg adımı: ilerleme yok, sadece çalıştır + stderr topla.
async fn run_ffmpeg_simple(app: &AppHandle, args: Vec<String>) -> Result<(), String> {
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
pub async fn transcribe(app: AppHandle, payload: Value) -> Result<String, String> {
    let input = get_str(&payload, "input_path")?;
    let job_id = get_str(&payload, "job_id")?;
    let model = get_str(&payload, "model")?;
    let language = get_str(&payload, "language")?;
    if !valid_model(&model) {
        return Err("model \"tiny\", \"base\" ya da \"small\" olmalı.".to_string());
    }
    let lang = match language.as_str() {
        "auto" => "auto",
        "tr" => "tr",
        "en" => "en",
        _ => return Err("dil \"auto\", \"tr\" ya da \"en\" olmalı.".to_string()),
    };
    let model_file = model_path(&app, &model)?;
    if !model_file.exists() {
        return Err(format!(
            "Whisper {model} modeli indirilmedi. Ayarlar → Konuşma bölümünden indir."
        ));
    }
    // Tekli kuyruk (A13): CPU donmasın.
    let _guard = crate::download::QUEUE.lock().await;
    emit_whisper_progress(&app, &job_id, 0.0);

    let tmp = std::env::temp_dir();
    let wav_path = tmp.join(format!("jv-whisper-{job_id}.wav"));
    let out_base = tmp.join(format!("jv-whisper-{job_id}-out"));
    let out_base_str = out_base.to_string_lossy().to_string();
    let tmp_srt = format!("{out_base_str}.srt");
    let final_srt = transcript_path(&input);

    // (1) whisper-cli 16-bit WAV ister: mp4 doğrudan verilmez.
    let wav_args = vec![
        "-y".to_string(),
        "-err_detect".to_string(),
        "ignore_err".to_string(),
        "-i".to_string(),
        input.clone(),
        "-ar".to_string(),
        "16000".to_string(),
        "-ac".to_string(),
        "1".to_string(),
        "-c:a".to_string(),
        "pcm_s16le".to_string(),
        wav_path.to_string_lossy().to_string(),
    ];
    if let Err(e) = run_ffmpeg_simple(&app, wav_args).await {
        let _ = std::fs::remove_file(&wav_path);
        return Err(format!("Ses hazırlanırken hata: {e}"));
    }
    emit_whisper_progress(&app, &job_id, 10.0);

    // (2) whisper.cpp CLI: `-of` uzantısız taban ad ister, çıktı <outbase>.srt olur.
    let wargs = vec![
        "-m".to_string(),
        model_file.to_string_lossy().to_string(),
        "-f".to_string(),
        wav_path.to_string_lossy().to_string(),
        "-l".to_string(),
        lang.to_string(),
        "-t".to_string(),
        "4".to_string(),
        "-osrt".to_string(),
        "-of".to_string(),
        out_base_str,
    ];
    let cmd = app
        .shell()
        .sidecar("whisper")
        .map_err(|_| "whisper motoru kurulu değil. Ayarlar → Konuşma bölümünden motoru indir.".to_string())?;
    let (mut rx, _child) = cmd.args(wargs).spawn().map_err(|_| {
        "whisper motoru kurulu değil. Ayarlar → Konuşma bölümünden motoru indir.".to_string()
    })?;
    let mut last_err = String::new();
    let mut ok = false;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(line) => {
                crate::convert::push_capped(&mut last_err, &String::from_utf8_lossy(&line));
            }
            CommandEvent::Error(e) => crate::convert::push_capped(&mut last_err, &e),
            CommandEvent::Terminated(payload) => {
                if payload.code == Some(0) {
                    ok = true;
                } else if last_err.trim().is_empty() {
                    last_err = match payload.code {
                        Some(code) => format!("whisper exited with code {code}"),
                        None => format!("whisper terminated (signal {:?})", payload.signal),
                    };
                }
                break;
            }
            _ => {}
        }
    }
    let _ = std::fs::remove_file(&wav_path);
    if !ok {
        let _ = std::fs::remove_file(&tmp_srt);
        return Err(format!(
            "Transkript üretilemedi: {}",
            crate::convert::short_ffmpeg_error(&last_err)
        ));
    }
    // Farklı sürücüde rename düşebilir — kopyala + sil.
    std::fs::copy(&tmp_srt, &final_srt).map_err(|e| format!("Altyazı dosyası yazılamadı: {e}"))?;
    let _ = std::fs::remove_file(&tmp_srt);
    let content =
        std::fs::read_to_string(&final_srt).map_err(|e| format!("Altyazı okunamadı: {e}"))?;
    let preview: String = content.lines().take(40).collect::<Vec<_>>().join("\n");
    emit_whisper_progress(&app, &job_id, 100.0);
    Ok(serde_json::json!({"srt_path": final_srt, "preview": preview, "language": language}).to_string())
}

#[tauri::command]
pub async fn embed_subtitle(app: AppHandle, payload: Value) -> Result<String, String> {
    let video = get_str(&payload, "video_path")?;
    let srt = get_str(&payload, "srt_path")?;
    let output = get_str(&payload, "output_path")?;
    let job_id = get_str(&payload, "job_id")?;

    // Soft subs: `-c copy` + `-c:s mov_text` — libass bağımlılığı yok.
    // -y first: never block on an overwrite prompt.
    let args: Vec<String> = [
        "-y",
        "-err_detect",
        "ignore_err",
        "-i",
        video.as_str(),
        "-i",
        srt.as_str(),
        "-c",
        "copy",
        "-c:s",
        "mov_text",
        output.as_str(),
        "-progress",
        "pipe:1",
        "-nostats",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    // Tekli kuyruk: indirme/dönüştürme/whisper ile aynı disiplin.
    let _guard = crate::download::QUEUE.lock().await;
    let total_ms = crate::convert::probe_duration_ms(&app, &video).await;
    emit_whisper_progress(&app, &job_id, 0.0);

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
                        if let (Some(total), Ok(ms)) = (total_ms, ms_str.trim().parse::<u64>()) {
                            let pct = (ms as f64 / total as f64 * 100.0).clamp(0.0, 100.0);
                            emit_whisper_progress(&app, &job_id, pct);
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
                    emit_whisper_progress(&app, &job_id, 100.0);
                    return Ok("done".to_string());
                }
                if last_err.trim().is_empty() {
                    last_err = match payload.code {
                        Some(code) => format!("ffmpeg exited with code {code}"),
                        None => format!("ffmpeg terminated (signal {:?})", payload.signal),
                    };
                }
                return Err(format!(
                    "Altyazı gömülemedi: {}",
                    crate::convert::short_ffmpeg_error(&last_err)
                ));
            }
            _ => {}
        }
    }
    Err("ffmpeg ended without an exit status".to_string())
}

#[tauri::command]
pub async fn extract_subtitle(app: AppHandle, payload: Value) -> Result<String, String> {
    let video = get_str(&payload, "video_path")?;
    let output = get_str(&payload, "output_srt")?;
    let job_id = get_str(&payload, "job_id")?;
    let stream_index = payload
        .get("stream_index")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let map = format!("0:s:{stream_index}");

    // -y first: never block on an overwrite prompt.
    let args: Vec<String> = [
        "-y",
        "-err_detect",
        "ignore_err",
        "-i",
        video.as_str(),
        "-map",
        map.as_str(),
        output.as_str(),
        "-progress",
        "pipe:1",
        "-nostats",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let _guard = crate::download::QUEUE.lock().await;
    let total_ms = crate::convert::probe_duration_ms(&app, &video).await;
    emit_whisper_progress(&app, &job_id, 0.0);

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
                        if let (Some(total), Ok(ms)) = (total_ms, ms_str.trim().parse::<u64>()) {
                            let pct = (ms as f64 / total as f64 * 100.0).clamp(0.0, 100.0);
                            emit_whisper_progress(&app, &job_id, pct);
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
                    emit_whisper_progress(&app, &job_id, 100.0);
                    return Ok("done".to_string());
                }
                if last_err.contains("matches no streams")
                    || last_err.contains("Stream map")
                    || last_err.contains("does not contain any stream")
                {
                    return Err("Videoda altyazı akışı bulunamadı.".to_string());
                }
                if last_err.trim().is_empty() {
                    last_err = match payload.code {
                        Some(code) => format!("ffmpeg exited with code {code}"),
                        None => format!("ffmpeg terminated (signal {:?})", payload.signal),
                    };
                }
                return Err(format!(
                    "Altyazı çıkarılamadı: {}",
                    crate::convert::short_ffmpeg_error(&last_err)
                ));
            }
            _ => {}
        }
    }
    Err("ffmpeg ended without an exit status".to_string())
}
