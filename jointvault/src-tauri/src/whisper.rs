use crate::component_download::{self, DownloadPlan, Payload};
use serde_json::Value;
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

// NOT: whisper-transcode/embed/extract ilerlemesi hâlâ `whisper-progress` yayar.
// İNDİRMELER artık bu olayı kullanmaz: hepsi paylaşılan motora bağlandı ve
// `component-download-progress` üzerinden ilerliyor (tek sözleşme, jobId ile filtre).
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

/// Pinlenmiş model kaynağı: URL + sha256 + indirme boyutu (`context.md` kaynak
/// tablosuyla birebir). SHA-256 HuggingFace LFS `oid` beyanıdır ve indirme
/// sırasında motorda yeniden doğrulanır — eskiden model indirmesinde hiç sha256
/// yoktu, artık bozuk/yarım dosya kuruluma giremez.
struct ModelSpec {
    url: &'static str,
    sha256: &'static str,
    bytes: u64,
}

fn model_spec(model: &str) -> ModelSpec {
    match model {
        "tiny" => ModelSpec {
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
            sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
            bytes: 74 * 1024 * 1024,
        },
        "small" => ModelSpec {
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
            sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
            bytes: 465 * 1024 * 1024,
        },
        // Çağıran `valid_model` ile doğrular; buraya yalnızca "base" düşer.
        _ => ModelSpec {
            url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
            sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
            bytes: 141 * 1024 * 1024,
        },
    }
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

// whisper.cpp CLI `--help` probu: bileşen KAYITTAN çözülür (indirilenler → gömülü) ve
// ÇÖZÜLEN yol çalıştırılır.
//
// Ad tarihsel kalıntı: artık sidecar'a değil kayıt çözümleyicisine bakar. Neden? Eskiden
// `health_check` dosya varlığına, `whisper_status` ise exe yanı `--help` çalıştırmaya
// bakıyordu; ikisi çelişebiliyordu. Tek çözümleme kaynağına bağlanınca kayıt ile durum
// aynı gerçeği söyler. `--help` semantiği ve `bool` dönüşü korunur.
async fn sidecar_available(app: &AppHandle) -> bool {
    let Some((path, _)) = crate::components::resolve_tool(app, "whisper") else {
        return false;
    };
    let cmd = app.shell().command(path.to_string_lossy().to_string());
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
    // Mevcut dosya varsa indirme atlanır (bugünkü davranış): sha256 yalnızca yeni
    // indirilen dosyaya uygulanır, kullanıcının elindeki dosya yeniden doğrulanmaz.
    if target.exists() {
        return Ok("done".to_string());
    }
    let spec = model_spec(&model);
    let dest_dir = target
        .parent()
        .ok_or_else(|| "Model klasörü bulunamadı.".to_string())?
        .to_path_buf();
    let plan = DownloadPlan {
        component_id: format!("whisper-model-{model}"),
        url: spec.url.to_string(),
        sha256: spec.sha256.to_string(),
        expected_bytes: Some(spec.bytes),
        // Raw yük: tepe kullanım indirilen dosyanın kendisidir — `.part` hedef
        // klasörde kalır ve doğrulamadan sonra aynı birimde atomik taşınır; açılan
        // ikinci bir kopya yoktur.
        disk_required_bytes: Some(spec.bytes),
        progress_span: None,
        payload: Payload::Raw {
            dest_dir,
            file_name: model_file_name(&model),
        },
    };
    // İş kaydı: iptal bayrağını motorda akış döngüsü yoklar; `run_download` bitince
    // (hata/iptal dâhil) kaydı kendisi temizler.
    let cancel = component_download::register_job(&job_id);
    component_download::run_download(&app, plan, &job_id, cancel)
        .await
        .map_err(|e| e.user_message())?;
    Ok("done".to_string())
}

// whisper.cpp CLI binary (v1.7.6 sabit — sonraki sürümlerde asset yok).
const WHISPER_ENGINE_URL: &str =
    "https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip";
const WHISPER_ENGINE_SHA256: &str =
    "0d2eca299c248f965bd0341bcb219db4b433c7f0c0ce2200d4df85765e8156a9";
// Zip-bomba koruması: tek girdinin makul üst sınırı.
const WHISPER_ENGINE_MAX_ENTRY_BYTES: u64 = 200 * 1024 * 1024;
// Pin tablosundaki indirme boyutu (~4 MB). Sunucu `Content-Length` vermezse
// ilerleme çubuğunun toplamı bu olur; motor yalnızca yedek olarak kullanır.
const WHISPER_ENGINE_BYTES: u64 = 4 * 1024 * 1024;
// Disk kapısı için TEPE kullanım: `.part` arşiv doğrulanana kadar exe yanında durur
// ve çıkarma da AYNI klasöre yapılır — yani arşiv + açılan exe/DLL'ler bir an
// birlikte yer kaplar. Arşiv ~4 MB, açılan içerik ~8 MB; 32 MiB güvenli üst sınır.
const WHISPER_ENGINE_PEAK_BYTES: u64 = 32 * 1024 * 1024;

// Arşivden çıkarılacak dosyalar: `whisper-cli.exe` + çalışması için gereken
// DLL'ler. Motor, yalnızca ADI VERİLEN girdileri çıkarır (bilinmeyen adlar sessizce
// atlanır), bu yüzden liste tam olmalı. Kaynak tarihli tag + sha256 ile pinli:
// aynı arşiv asla değişmez. SDL2.dll dışarıda — sunucu tarafı için, transkript
// yolunda gereksiz (bugünkü paketli dosya kümesiyle aynı).
const WHISPER_ENGINE_ENTRIES: &[&str] = &[
    "whisper-cli.exe",
    "whisper.dll",
    "ggml.dll",
    "ggml-base.dll",
    "ggml-cpu.dll",
];

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

/// Arşivden çıkan `whisper-cli.exe`'yi çalışma-anı adı `whisper.exe` yap.
///
/// `sidecar("whisper")` her zaman `whisper.exe` arar; arşiv ise `whisper-cli.exe`
/// getirir. Var olan (ör. DLL'leri eksik, çalışmayan) bir `whisper.exe` varsa
/// `rename` Windows'ta "already exists" ile düşer — bu yüzden önce kaldırılır.
fn install_engine_binary(runtime: &Path, dir: &Path) -> Result<(), String> {
    let archive_exe = dir.join("whisper-cli.exe");
    if !archive_exe.is_file() {
        return Err("Motor arşivinde whisper-cli.exe bulunamadı.".to_string());
    }
    let _ = std::fs::remove_file(runtime);
    std::fs::rename(&archive_exe, runtime)
        .map_err(|e| format!("Motor adlandırılamadı (whisper.exe): {e}"))?;
    if !runtime.is_file() {
        return Err("Motor kurulamadı: whisper.exe oluşmadı.".to_string());
    }
    Ok(())
}

/// Gelecek build'ler `externalBin` ile paketleyebilsin diye kurulu exe + DLL'leri
/// `src-tauri/binaries/`'e (dev düzeni) kopyala. Opsiyonel bir kolaylıktır:
/// başarısız olursa sessizce geçer, kurulumu bozmaz.
fn stage_engine_source_copy(runtime_dir: &Path, runtime: &Path) {
    let Some(source) = engine_source_path() else {
        return;
    };
    let Some(parent) = source.parent() else {
        return;
    };
    if std::fs::create_dir_all(parent).is_err() {
        return;
    }
    let _ = std::fs::copy(runtime, &source);
    for entry in WHISPER_ENGINE_ENTRIES {
        let name = *entry;
        if name == "whisper-cli.exe" {
            continue;
        }
        let _ = std::fs::copy(runtime_dir.join(name), parent.join(name));
    }
}

#[tauri::command]
pub async fn download_whisper_engine(app: AppHandle, payload: Value) -> Result<String, String> {
    let job_id = get_str(&payload, "job_id")?;
    // Tekli kuyruk (A13): indirme + ffmpeg + whisper aynı anda koşmasın.
    let _guard = crate::download::QUEUE.lock().await;

    // Zaten çalışıyorsa tekrar indirme (bugünkü "kuruluysa atla" probu korunur).
    if sidecar_available(&app).await {
        return Ok("done".to_string());
    }

    let runtime = engine_runtime_path()?;
    let dir = runtime
        .parent()
        .ok_or_else(|| "Motor klasörü bulunamadı.".to_string())?
        .to_path_buf();

    let plan = DownloadPlan {
        component_id: "whisper-engine".to_string(),
        url: WHISPER_ENGINE_URL.to_string(),
        sha256: WHISPER_ENGINE_SHA256.to_string(),
        expected_bytes: Some(WHISPER_ENGINE_BYTES),
        // Zip yükü: tepe kullanım = arşiv + açılan içerik (ikisi bir an birlikte).
        disk_required_bytes: Some(WHISPER_ENGINE_PEAK_BYTES),
        // Tek çubuk 0-100: bugünkü ilerleme davranışı korunur.
        progress_span: None,
        payload: Payload::Zip {
            dest_dir: dir.clone(),
            wanted: WHISPER_ENGINE_ENTRIES
                .iter()
                .map(|s| (*s).to_string())
                .collect(),
            max_entry_bytes: WHISPER_ENGINE_MAX_ENTRY_BYTES,
        },
    };
    // Tek yol: akış → `.part` → sha256 → zip-slip/zip-bomba korumalı çıkarma. İptal
    // bayrağı hem akışta hem çıkarmada yoklanır; hata/iptalde `.part` silinir.
    let cancel = component_download::register_job(&job_id);
    component_download::run_download(&app, plan, &job_id, cancel)
        .await
        .map_err(|e| e.user_message())?;

    // Arşiv `whisper-cli.exe` getirir; çalışma-anı adı `whisper.exe` olmalı.
    install_engine_binary(&runtime, &dir)?;
    // Paketleme kopyası (dev düzeni) — opsiyonel, sessizce geç.
    stage_engine_source_copy(&dir, &runtime);

    // Kurulumu KANITLA: DLL'ler eksikse ya da exe çalışmıyorsa yüksek sesle hata ver.
    if sidecar_available(&app).await {
        Ok("done".to_string())
    } else {
        Err("Motor indirildi ama çalıştırılamadı. jointvault/docs/media-tools-deferred.md §1'deki manuel adımları dene.".to_string())
    }
}

// Kısa ffmpeg adımı: ilerleme yok, sadece çalıştır + stderr topla.
async fn run_ffmpeg_simple(app: &AppHandle, args: Vec<String>) -> Result<(), String> {
    // ffmpeg sidecar yerine kayıttan çözülür (indirilenler → gömülü); böylece
    // bileşen yöneticisinin indirdiği kopya da görünür. Eksikse ham OS hatası yerine
    // BILESEN_EKSIK:ffmpeg sinyali döner (çağıran transcribe daha işe başlamadan kapıyı
    // zaten çalar; buradaki çağrı yardımcıyı tek başına da doğru kılar).
    let ffmpeg = crate::components::require_tool(app, "ffmpeg")?;
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
    // Araçlar işe BAŞLAMADAN kayıttan çözülür: eksikse ham OS hatası yerine
    // BILESEN_EKSIK:<id> sinyali döner. Sinyalin ikinci satırı okunabilir Türkçe
    // cümleyi taşır; arayüz (7c-2) öneki soyar. whisper önce sorulur ki transkript
    // yolu eksik motorda net sinyal versin.
    let whisper = crate::components::require_tool(&app, "whisper")?;
    crate::components::require_tool(&app, "ffmpeg")?;
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
    // Çözülen yol doğrudan çalıştırılır (sidecar yalnızca exe yanına bakar). Eksik
    // motor durumu yukarıdaki require_tool kapısında zaten BILESEN_EKSIK sinyaliyle
    // karşılanır; burada yinelenen Türkçe mesaj tutulmaz (tek kaynak: components).
    let (mut rx, _child) = app
        .shell()
        .command(whisper.to_string_lossy().to_string())
        .args(wargs)
        .spawn()
        .map_err(|e| e.to_string())?;
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

    // ffmpeg işe başlamadan kayıttan çözülür (indirilenler → gömülü): eksikse ham OS
    // hatası yerine BILESEN_EKSIK:ffmpeg sinyali döner; arayüz kurulum akışını açar.
    let ffmpeg = crate::components::require_tool(&app, "ffmpeg")?;

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

    // ffmpeg işe başlamadan kayıttan çözülür (indirilenler → gömülü): eksikse ham OS
    // hatası yerine BILESEN_EKSIK:ffmpeg sinyali döner; arayüz kurulum akışını açar.
    let ffmpeg = crate::components::require_tool(&app, "ffmpeg")?;

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
