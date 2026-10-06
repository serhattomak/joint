use crate::component_download;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
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

const VALID_MODEL_MSG: &str =
    "model \"tiny\", \"base\", \"small\", \"large-v3\" ya da \"large-v3-q5_0\" olmalı.";

fn valid_model(model: &str) -> bool {
    matches!(model, "tiny" | "base" | "small" | "large-v3" | "large-v3-q5_0")
}

fn model_file_name(model: &str) -> String {
    format!("ggml-{model}.bin")
}

// Model pinleri (URL/sha256/boyut) burada TUTULMAZ: kaynak seçimi ürünün değişmez
// kararıdır ve `components.rs`'te TEK yerde yaşar
// (`whisper-model-{tiny|base|small|large-v3|large-v3-q5_0}`).
// Burada ikinci bir kopya tutmak, kayıtla zamanla ayrışan bir pin tablosu üretirdi.
// İndirme de tek yoldan (`component_download::install_component`) yürür.

/// Model klasörü: kayıttaki `Dest::Models` hedefinin TA KENDİSİ (tek kaynak).
///
/// Neden delege? Burada ikinci bir `jointvault-models` tanımı tutmak, kayıtla
/// ayrışabilecek bir yol kopyası olurdu: kurulum `components::dest_dir`'e yazar,
/// durum sorgusu başka bir yola bakarsa iki gerçek doğar. Yol artık TEK yerde
/// tanımlı; hata metni de kayıttan gelir (`Model klasörü açılamadı: ...`).
fn models_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    crate::components::dest_dir(app, crate::components::Dest::Models)
}

fn model_path(app: &AppHandle, model: &str) -> Result<std::path::PathBuf, String> {
    if !valid_model(model) {
        return Err(VALID_MODEL_MSG.to_string());
    }
    Ok(models_dir(app)?.join(model_file_name(model)))
}

/// Whisper modelleri öncelik sırası: en doğru/kaliteli önce. `analyze.rs` bu sıraya
/// göre kurulu ilk modeli seçer; arayüz (`lib/analysis.ts::pickWhisperModel`) aynı
/// sırayı yansıtır. Yeni model eklenirse burası tek yerdir.
#[allow(dead_code)] // T5 (`analyze_media`) bağlayana kadar
pub(crate) const WHISPER_MODEL_PRIORITY: &[&str] =
    &["large-v3-q5_0", "large-v3", "small", "base", "tiny"];

/// Kurulu en iyi whisper modelini seç (yoksa None). Kayıt sorgusu `components`'ten
/// gelir (`is_installed`); dosya yolunu burada yeniden hesaplamayız (tek kaynak).
#[allow(dead_code)] // T5 (`analyze_media`) bağlayana kadar
pub(crate) fn pick_whisper_model(app: &AppHandle) -> Option<&'static str> {
    WHISPER_MODEL_PRIORITY
        .iter()
        .copied()
        .find(|m| crate::components::is_installed(app, &format!("whisper-model-{m}")))
}

/// Transkript üretiminin ortak çıktısı. `run_transcribe` bunu döner; `transcribe`
/// komutu JSON'a `preview` ekleyerek çevirir, `analyze::acquire_transcript` ise
/// SRT yolunu doğrudan kullanır. Böylece iki tüketici aynı çekirdeği paylaşır.
#[derive(Clone, Debug)]
pub(crate) struct TranscriptOut {
    pub srt_path: String,
    pub language: String,
}

// Kaynağın yanına <stem>-transkript.srt (transkript çıktısı, arşive yazılmaz).
pub(crate) fn transcript_path(input: &str) -> String {
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
        "models": {
            "tiny": has("tiny"),
            "base": has("base"),
            "small": has("small"),
            "large-v3": has("large-v3"),
            "large-v3-q5_0": has("large-v3-q5_0"),
        },
        "models_dir": dir.to_string_lossy().to_string(),
    })
    .to_string())
}

#[tauri::command]
pub async fn download_model(app: AppHandle, payload: Value) -> Result<String, String> {
    let model = get_str(&payload, "model")?;
    let job_id = get_str(&payload, "job_id")?;
    if !valid_model(&model) {
        return Err(VALID_MODEL_MSG.to_string());
    }
    // Tek yol: kayıttaki `whisper-model-{model}` bileşeni. "Hedef dosya varsa atla"
    // kapısı, pin (URL/sha256/boyut), hedef klasör, atomik `.part` yerleştirme,
    // ilerleme olayı ve iptal kaydı motorda TEK yerde yaşar; burada kopyası tutulmaz.
    //
    // Kuyruk kilidi (`download::QUEUE`) BİLİNÇLİ olarak burada ALINMAZ: tokio mutex
    // yeniden-girilemez olduğundan `install_component` içinde ikinci kez alınırsa
    // kilitlenirdi. Kilit `install_component`'in sorumluluğundadır.
    component_download::install_component(&app, &format!("whisper-model-{model}"), &job_id, None)
        .await?;
    Ok("done".to_string())
}

// Whisper MOTORU pinleri (URL/sha256/boyut/çıkarılacak dosya listesi) ve arşivden
// `whisper-cli.exe` → `whisper.exe` adlandırması burada TUTULMAZ: hepsi kayıtta
// (`components.rs`) `whisper` bileşeni olarak TEK yerde yaşar ve paylaşılan kurulum
// yolunda uygulanır. Böylece motorun nereye indiği (`components/`) ve nasıl
// adlandığı sorusunun tek cevabı olur.
//
// 7d kararı: eski `stage_engine_source_copy` — kurulu motoru repodaki
// `src-tauri/binaries/` dizinine kopyalayan *gelecekteki paketleme* kolaylığı —
// KALDIRILDI. Motor artık çalışma anında `components/` altına iner ve
// `resolve_tool` oradan çözer; repoya ikili kopyalamak, 7d'nin boşaltacağı dizini
// yeniden şişirirdi. Yani kopya, hedeflenen davranışın tam tersiydi.

/// Whisper motorunu kur. Pin, hedef dizin (`components/`), zip-slip/zip-bomba
/// korumalı çıkarma, adlandırma kancası ve "kuruluysa atla" kapısı
/// `component_download::install_component` içinde TEK yoldan yürür.
///
/// Kurulum-sonrası ÇALIŞTIRMA probu burada korunur: indirmek "çalışıyor" demek
/// değildir (DLL'ler eksik olabilir). Motor koşmuyorsa hata yüksek sesle döner,
/// sessizce yutulmaz.
#[tauri::command]
pub async fn download_whisper_engine(app: AppHandle, payload: Value) -> Result<String, String> {
    let job_id = get_str(&payload, "job_id")?;
    // Kuyruk kilidi (`download::QUEUE`) BİLİNÇLİ olarak burada ALINMAZ: tokio mutex
    // yeniden-girilemez olduğundan `install_component` içinde ikinci kez alınırsa
    // kilitlenirdi. Kilit o fonksiyonun sorumluluğundadır.
    component_download::install_component(&app, "whisper", &job_id, None).await?;

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

/// Transkript çekirdeği: doğrulama + ffmpeg→WAV + whisper-cli→SRT + hedefe kopya.
///
/// Kuyruk kilidi (`download::QUEUE`) BURADA ALINMAZ: tokio mutex yeniden-girilemez
/// olduğundan `transcribe` komutu kilidi alıp buraya girer, `analyze_media` de aynı
/// disiplini uygular. İçeride kilit alınsaydı ikinci komut kilitlenirdi.
pub(crate) async fn run_transcribe(
    app: &AppHandle,
    input: &str,
    model: &str,
    language: &str,
    job_id: &str,
) -> Result<TranscriptOut, String> {
    if !valid_model(model) {
        return Err(VALID_MODEL_MSG.to_string());
    }
    let lang = match language {
        "auto" => "auto",
        "tr" => "tr",
        "en" => "en",
        _ => return Err("dil \"auto\", \"tr\" ya da \"en\" olmalı.".to_string()),
    };
    let model_file = model_path(app, model)?;
    if !model_file.exists() {
        return Err(format!(
            "Whisper {model} modeli indirilmedi. Ayarlar → Konuşma bölümünden indir."
        ));
    }
    // Araçlar işe BAŞLAMADAN kayıttan çözülür: eksikse ham OS hatası yerine
    // BILESEN_EKSIK:<id> sinyali döner. Sinyalin ikinci satırı okunabilir Türkçe
    // cümleyi taşır; arayüz (7c-2) öneki soyar. whisper önce sorulur ki transkript
    // yolu eksik motorda net sinyal versin.
    let whisper = crate::components::require_tool(app, "whisper")?;
    crate::components::require_tool(app, "ffmpeg")?;
    emit_whisper_progress(app, job_id, 0.0);

    let tmp = std::env::temp_dir();
    let wav_path = tmp.join(format!("jv-whisper-{job_id}.wav"));
    let out_base = tmp.join(format!("jv-whisper-{job_id}-out"));
    let out_base_str = out_base.to_string_lossy().to_string();
    let tmp_srt = format!("{out_base_str}.srt");
    let final_srt = transcript_path(input);

    // (1) whisper-cli 16-bit WAV ister: mp4 doğrudan verilmez.
    let wav_args = vec![
        "-y".to_string(),
        "-err_detect".to_string(),
        "ignore_err".to_string(),
        "-i".to_string(),
        input.to_string(),
        "-ar".to_string(),
        "16000".to_string(),
        "-ac".to_string(),
        "1".to_string(),
        "-c:a".to_string(),
        "pcm_s16le".to_string(),
        wav_path.to_string_lossy().to_string(),
    ];
    if let Err(e) = run_ffmpeg_simple(app, wav_args).await {
        let _ = std::fs::remove_file(&wav_path);
        return Err(format!("Ses hazırlanırken hata: {e}"));
    }
    emit_whisper_progress(app, job_id, 10.0);

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
    emit_whisper_progress(app, job_id, 100.0);
    Ok(TranscriptOut {
        srt_path: final_srt,
        language: language.to_string(),
    })
}

/// SRT'nin ilk 40 satırı (arayüz önizlemesi). `transcribe` komutu kullanır.
pub(crate) fn srt_preview(srt_path: &str) -> Result<String, String> {
    let content =
        std::fs::read_to_string(srt_path).map_err(|e| format!("Altyazı okunamadı: {e}"))?;
    Ok(content.lines().take(40).collect::<Vec<_>>().join("\n"))
}

#[tauri::command]
pub async fn transcribe(app: AppHandle, payload: Value) -> Result<String, String> {
    let input = get_str(&payload, "input_path")?;
    let job_id = get_str(&payload, "job_id")?;
    let model = get_str(&payload, "model")?;
    let language = get_str(&payload, "language")?;
    // Tekli kuyruk (A13): CPU donmasın. Kilit YALNIZCA komut katmanında alınır;
    // `run_transcribe` yeniden almaz (yeniden-girilemez mutex → kilitlenme).
    let _guard = crate::download::QUEUE.lock().await;
    let out = run_transcribe(&app, &input, &model, &language, &job_id).await?;
    // Dönüş şekli AYNEN korunur: {"srt_path","preview","language"} (frontend
    // `lib/whisper.ts::isTranscriptData` bunu bekler).
    let preview = srt_preview(&out.srt_path)?;
    Ok(serde_json::json!({
        "srt_path": out.srt_path,
        "preview": preview,
        "language": out.language,
    })
    .to_string())
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

/// Gömülü altyazı akışını SRT'ye çıkar (çekirdek).
///
/// `extract_subtitle` komutu ile `analyze::acquire_transcript` bu çekirdeği paylaşır.
/// Kuyruk kilidi BURADA ALINMAZ (yeniden-girilemez mutex); komut katmanı alır.
pub(crate) async fn run_extract_subtitle(
    app: &AppHandle,
    video: &str,
    output: &str,
    stream_index: u64,
    job_id: &str,
) -> Result<(), String> {
    let map = format!("0:s:{stream_index}");

    // ffmpeg işe başlamadan kayıttan çözülür (indirilenler → gömülü): eksikse ham OS
    // hatası yerine BILESEN_EKSIK:ffmpeg sinyali döner; arayüz kurulum akışını açar.
    let ffmpeg = crate::components::require_tool(app, "ffmpeg")?;

    // -y first: never block on an overwrite prompt.
    let args: Vec<String> = [
        "-y",
        "-err_detect",
        "ignore_err",
        "-i",
        video,
        "-map",
        map.as_str(),
        output,
        "-progress",
        "pipe:1",
        "-nostats",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let total_ms = crate::convert::probe_duration_ms(app, video).await;
    emit_whisper_progress(app, job_id, 0.0);

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
                            emit_whisper_progress(app, job_id, pct);
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
                    emit_whisper_progress(app, job_id, 100.0);
                    return Ok(());
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

#[tauri::command]
pub async fn extract_subtitle(app: AppHandle, payload: Value) -> Result<String, String> {
    let video = get_str(&payload, "video_path")?;
    let output = get_str(&payload, "output_srt")?;
    let job_id = get_str(&payload, "job_id")?;
    let stream_index = payload
        .get("stream_index")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let _guard = crate::download::QUEUE.lock().await;
    run_extract_subtitle(&app, &video, &output, stream_index, &job_id).await?;
    Ok("done".to_string())
}
