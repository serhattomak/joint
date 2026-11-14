// Dönüşüm Merkezi — tek giriş noktası.
//
// Sorumluluk dağılımı:
//   - `paths`  : biçim algılama, hedef matrisi, sayfa aralığı, çıktı adı.
//   - `office` : LibreOffice (ofis ↔ ofis/PDF).
//   - `pdf`    : PDFium (metin/görüntü) + lopdf (birleştir/ayır/döndür/sıkıştır).
//   - `ooxml`  : PDF metninden DOCX/XLSX/PPTX üretimi.
//   - `media`  : ffmpeg (ses/video/GIF) + image (görsel biçimleri).
//
// Tüm işler tek bir kilit (`CONVERSION_LOCK`) altında sıralıdır: ağır motorlar
// (LibreOffice/ffmpeg) aynı anda iki kez çalıştırılmaz. İndirme kuyruğundan
// ayrıdır; indirme ile dönüşüm paralel yaşayabilir.
mod media;
mod office;
mod ooxml;
mod paths;
mod pdf;

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::process::CommandChild;

/// İptal işareti: kullanıcı iptal etti, hata değil. Arayüz bunu `iptal` durumuna çevirir.
pub(crate) const CANCELLED: &str = "IPTAL";

/// Dönüşüm işlerinin çalışan çocuk süreçleri + iptal bayrakları.
#[derive(Default)]
pub struct ConversionState {
    jobs: Mutex<HashMap<String, JobHandle>>,
}

struct JobHandle {
    cancel: Arc<AtomicBool>,
    child: Option<CommandChild>,
}

/// Tek bir işin bağlamı. Modüller ilerleme yaymak, iptal sormak ve süreç
/// kaydetmek için bunu kullanır; iş kimliği hiçbir yerde kopyalanmaz.
pub(crate) struct JobCtx<'a> {
    pub app: &'a AppHandle,
    state: &'a ConversionState,
    job_id: String,
    cancel: Arc<AtomicBool>,
}

impl<'a> JobCtx<'a> {
    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    /// Çocuk süreci kaydet. İptal bu arada geldiyse süreci hemen öldür.
    pub(crate) fn register_child(&self, child: CommandChild) {
        let mut jobs = self.state.jobs.lock().expect("conversion jobs poisoned");
        match jobs.get_mut(&self.job_id) {
            Some(handle) if !handle.cancel.load(Ordering::SeqCst) => {
                handle.child = Some(child);
            }
            _ => {
                let _ = child.kill();
            }
        }
    }

    pub(crate) fn emit(&self, percent: f64, phase: &str) {
        emit_progress(self.app, &self.job_id, percent, phase, None);
    }
}

#[derive(Clone, Serialize)]
struct ConversionProgress {
    #[serde(rename = "jobId")]
    job_id: String,
    percent: f64,
    phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

pub(crate) fn emit_progress(
    app: &AppHandle,
    job_id: &str,
    percent: f64,
    phase: &str,
    message: Option<String>,
) {
    let _ = app.emit(
        "convert-progress",
        ConversionProgress {
            job_id: job_id.to_string(),
            percent: percent.clamp(0.0, 100.0),
            phase: phase.to_string(),
            message,
        },
    );
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionOutcome {
    pub job_id: String,
    pub outputs: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionFileInfo {
    pub path: String,
    pub name: String,
    pub ext: String,
    pub kind: String,
    pub size: u64,
}

/// Tüm dönüşümler tek sırada. `tokio::sync::Mutex` seçildi: iş async, kilit
/// beklerken iş parçacığı bloklanmaz.
static CONVERSION_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Biçim dönüştürme giriş noktası.
#[tauri::command]
pub async fn convert_file(
    app: AppHandle,
    state: State<'_, ConversionState>,
    payload: Value,
) -> Result<ConversionOutcome, String> {
    let job_id = req_str(&payload, &["job_id", "jobId"])?;
    let input = req_str(&payload, &["input_path", "inputPath"])?;
    let output = req_str(&payload, &["output_path", "outputPath"])?;
    let target = req_str(&payload, &["target"])?.to_ascii_lowercase();
    let target = paths::normalize_target(&target)
        .ok_or_else(|| format!("Desteklenmeyen hedef biçim: {target}"))?;
    let options = payload
        .get("options")
        .cloned()
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));

    let input_path = PathBuf::from(&input);
    let mut output_path = PathBuf::from(&output);
    if !input_path.is_file() {
        return Err(format!("Kaynak dosya bulunamadı: {input}"));
    }
    let source = paths::source_kind(&input_path)
        .ok_or_else(|| format!("Desteklenmeyen kaynak biçimi: {}", paths::ext_of(&input_path)))?;
    if !paths::target_allowed(source, &input_path, &target) {
        return Err(format!(
            "{} kaynağı {} biçimine dönüştürülemez.",
            source.label(),
            target
        ));
    }
    paths::validate_output(&input_path, &output_path, &target)?;
    output_path = paths::unique_output(&output_path);
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Çıktı klasörü açılamadı: {e}"))?;
    }

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = state.jobs.lock().map_err(|_| "Dönüşüm kaydı kilitli.".to_string())?;
        if jobs.contains_key(&job_id) {
            return Err("Aynı iş kimliğiyle ikinci dönüşüm başlatılamaz.".to_string());
        }
        jobs.insert(
            job_id.clone(),
            JobHandle {
                cancel: cancel.clone(),
                child: None,
            },
        );
    }

    // İş kaydı kilitten ÖNCE alınır: sırada beklerken gelen iptal de işaretlenir.
    let _guard = CONVERSION_LOCK.lock().await;
    if cancel.load(Ordering::SeqCst) {
        let _ = state.jobs.lock().map(|mut jobs| jobs.remove(&job_id));
        return Err(CANCELLED.to_string());
    }

    let ctx = JobCtx {
        app: &app,
        state: state.inner(),
        job_id: job_id.clone(),
        cancel: cancel.clone(),
    };
    emit_progress(&app, &job_id, 0.0, "hazırlanıyor", None);

    let result = match (source, target.as_str()) {
        // PDF → ofis/metin/görüntü (PDFium + kendi OOXML yazıcıları)
        (paths::SourceKind::Pdf, "docx" | "xlsx" | "pptx" | "txt" | "md" | "html" | "png" | "jpg") => {
            pdf::convert_pdf(&ctx, &input_path, &output_path, &target, &options).await
        }
        // PDF → PDF: sıkıştırma
        (paths::SourceKind::Pdf, "pdf") => {
            pdf::compress_pdf(&ctx, &input_path, &output_path).await
        }
        // Görsellerden PDF (tek görsel; çoklu görsel PDF araçlarındadır)
        (paths::SourceKind::Image, "pdf") => {
            pdf::images_to_pdf(
                &ctx,
                &[input_path.to_string_lossy().to_string()],
                &output_path,
                &options,
            )
            .await
        }
        // Ofis belgeleri: LibreOffice
        (paths::SourceKind::Document, _)
        | (paths::SourceKind::Spreadsheet, _)
        | (paths::SourceKind::Presentation, _) => {
            office::convert_office(&ctx, &input_path, &output_path, source, &target, &options).await
        }
        // Görsel biçimleri (PDF dışı)
        (paths::SourceKind::Image, _) => {
            media::convert_image(&ctx, &input_path, &output_path, &target, &options)
                .map(|p| (vec![p], Vec::new()))
        }
        // Ses/video
        (paths::SourceKind::Audio, _) | (paths::SourceKind::Video, _) => {
            media::convert_media(&ctx, &input_path, &output_path, &target, &options).await
        }
        _ => Err("Bu kaynak/hedef birleşimi desteklenmiyor.".to_string()),
    };

    // İş kaydı her durumda temizlenir (iptal kaydı zaten kaldırmış olabilir).
    if let Ok(mut jobs) = state.jobs.lock() {
        jobs.remove(&job_id);
    }

    if result.is_err() {
        // Yarım kalan hedef dosya bırakma. Sayfa başına çoklu çıktılar kendi
        // modüllerinde temizlenir; burada tek hedef yol kapatılır.
        let _ = std::fs::remove_file(&output_path);
    }

    match result {
        Ok((outputs, warnings)) => {
            if cancel.load(Ordering::SeqCst) {
                return Err(CANCELLED.to_string());
            }
            emit_progress(&app, &job_id, 100.0, "tamamlandı", None);
            Ok(ConversionOutcome {
                job_id,
                outputs,
                warnings,
            })
        }
        Err(error) => Err(error),
    }
}

/// Çalışan/kuyruktaki dönüşümü iptal et.
#[tauri::command]
pub fn convert_cancel(state: State<'_, ConversionState>, job_id: String) -> bool {
    let Ok(mut jobs) = state.jobs.lock() else {
        return false;
    };
    let Some(mut handle) = jobs.remove(&job_id) else {
        return false;
    };
    handle.cancel.store(true, Ordering::SeqCst);
    if let Some(child) = handle.child.take() {
        let _ = child.kill();
    }
    true
}

/// PDF araçları: birleştir / ayır / döndür / sıkıştır / görsellerden PDF.
#[tauri::command]
pub async fn conversion_pdf_tool(
    app: AppHandle,
    state: State<'_, ConversionState>,
    payload: Value,
) -> Result<ConversionOutcome, String> {
    let job_id = req_str(&payload, &["job_id", "jobId"])?;
    let tool = req_str(&payload, &["tool"])?.to_ascii_lowercase();
    let output = req_str(&payload, &["output_path", "outputPath"])?;
    let inputs: Vec<String> = payload
        .get("inputs")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let options = payload
        .get("options")
        .cloned()
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));

    if !matches!(
        tool.as_str(),
        "merge" | "split" | "rotate" | "compress" | "images_to_pdf"
    ) {
        return Err(format!("Bilinmeyen PDF aracı: {tool}"));
    }
    if inputs.is_empty() {
        return Err("İşlem için en az bir dosya seç.".to_string());
    }
    if tool == "merge" && inputs.len() < 2 {
        return Err("Birleştirmek için en az iki PDF seç.".to_string());
    }
    if matches!(tool.as_str(), "split" | "rotate" | "compress") && inputs.len() != 1 {
        return Err(format!("{tool} tek dosya ile çalışır."));
    }
    for input in &inputs {
        let path = Path::new(input);
        if !path.is_file() {
            return Err(format!("Dosya bulunamadı: {input}"));
        }
        let kind = paths::source_kind(path)
            .ok_or_else(|| format!("Desteklenmeyen dosya: {input}"))?;
        let ok = match tool.as_str() {
            "images_to_pdf" => kind == paths::SourceKind::Image,
            _ => kind == paths::SourceKind::Pdf,
        };
        if !ok {
            return Err(format!("{tool} için uygun olmayan dosya: {input}"));
        }
    }
    let mut output_path = PathBuf::from(&output);
    if paths::ext_of(&output_path) != "pdf" {
        return Err("Çıktı .pdf olmalı.".to_string());
    }
    if output_path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("Çıktı yolu '..' içeremez.".to_string());
    }
    output_path = paths::unique_output(&output_path);
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Çıktı klasörü açılamadı: {e}"))?;
    }

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = state.jobs.lock().map_err(|_| "Dönüşüm kaydı kilitli.".to_string())?;
        if jobs.contains_key(&job_id) {
            return Err("Aynı iş kimliğiyle ikinci dönüşüm başlatılamaz.".to_string());
        }
        jobs.insert(
            job_id.clone(),
            JobHandle {
                cancel: cancel.clone(),
                child: None,
            },
        );
    }
    let _guard = CONVERSION_LOCK.lock().await;
    if cancel.load(Ordering::SeqCst) {
        let _ = state.jobs.lock().map(|mut jobs| jobs.remove(&job_id));
        return Err(CANCELLED.to_string());
    }
    let ctx = JobCtx {
        app: &app,
        state: state.inner(),
        job_id: job_id.clone(),
        cancel: cancel.clone(),
    };
    emit_progress(&app, &job_id, 0.0, "hazırlanıyor", None);
    let result = pdf::pdf_tool(&ctx, &tool, &inputs, &output_path, &options).await;
    if let Ok(mut jobs) = state.jobs.lock() {
        jobs.remove(&job_id);
    }
    if result.is_err() {
        let _ = std::fs::remove_file(&output_path);
    }
    match result {
        Ok((outputs, warnings)) => {
            if cancel.load(Ordering::SeqCst) {
                return Err(CANCELLED.to_string());
            }
            emit_progress(&app, &job_id, 100.0, "tamamlandı", None);
            Ok(ConversionOutcome {
                job_id,
                outputs,
                warnings,
            })
        }
        Err(error) => Err(error),
    }
}

/// Verilen yolların tür/boyut bilgisini döndür (kaynak listesi için).
#[tauri::command]
pub fn conversion_inspect(paths: Vec<String>) -> Vec<ConversionFileInfo> {
    paths
        .into_iter()
        .filter_map(|path| file_info(Path::new(&path)))
        .collect()
}

/// Bir klasördeki desteklenen dosyaları (en fazla 3 seviye) listele.
#[tauri::command]
pub fn conversion_scan_dir(path: String) -> Result<Vec<ConversionFileInfo>, String> {
    let root = PathBuf::from(path);
    if !root.is_dir() {
        return Err("Klasör bulunamadı.".to_string());
    }
    let mut out = Vec::new();
    collect_dir(&root, 0, &mut out);
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out.truncate(1000);
    Ok(out)
}

fn collect_dir(dir: &Path, depth: usize, out: &mut Vec<ConversionFileInfo>) {
    if depth > 3 || out.len() >= 1000 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= 1000 {
            return;
        }
        let path = entry.path();
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_dir() {
            // Sembolik bağlantı döngüsüne girme.
            if !ft.is_symlink() {
                collect_dir(&path, depth + 1, out);
            }
        } else if ft.is_file() {
            if let Some(info) = file_info(&path) {
                out.push(info);
            }
        }
    }
}

fn file_info(path: &Path) -> Option<ConversionFileInfo> {
    let kind = paths::source_kind(path)?;
    let meta = std::fs::metadata(path).ok()?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Some(ConversionFileInfo {
        path: path.to_string_lossy().to_string(),
        name,
        ext: paths::ext_of(path),
        kind: kind.as_str().to_string(),
        size: meta.len(),
    })
}

// --- payload yardımcıları ---------------------------------------------------

pub(crate) fn req_str(payload: &Value, keys: &[&str]) -> Result<String, String> {
    keys.iter()
        .filter_map(|key| payload.get(*key))
        .find_map(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("Eksik alan: {}", keys[0]))
}

pub(crate) fn opt_str<'a>(options: &'a Value, key: &str) -> Option<&'a str> {
    options
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub(crate) fn opt_bool(options: &Value, key: &str) -> bool {
    options.get(key).and_then(|value| value.as_bool()).unwrap_or(false)
}

pub(crate) fn opt_u32(options: &Value, key: &str, fallback: u32) -> u32 {
    options
        .get(key)
        .and_then(|value| value.as_u64())
        .map(|value| value.min(u32::MAX as u64) as u32)
        .unwrap_or(fallback)
}
