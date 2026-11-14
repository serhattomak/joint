// LibreOffice headless köprüsü.
//
// Neden LibreOffice? DOCX/XLSX/PPTX'i gerçek düzen motoruyla açan tek yerel,
// ücretsiz araç. Çıktı adını LibreOffice belirler (`<stem>.<ext>`); bu yüzden
// her iş geçici bir klasörde çalışır ve üretilen tek dosya hedefe taşınır.
use super::{paths, JobCtx, CANCELLED};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

pub(crate) async fn convert_office(
    ctx: &JobCtx<'_>,
    input: &Path,
    output: &Path,
    source: paths::SourceKind,
    target: &str,
    options: &Value,
) -> Result<(Vec<String>, Vec<String>), String> {
    let soffice = crate::components::require_tool(ctx.app, "libreoffice")?;
    let filter = filter_for(source, target, options)?;
    let temp = temp_dir(ctx)?;
    let args = vec![
        "--headless".to_string(),
        "--norestore".to_string(),
        "--nofirststartwizard".to_string(),
        "--nolockcheck".to_string(),
        "--nologo".to_string(),
        "--convert-to".to_string(),
        filter,
        "--outdir".to_string(),
        temp.to_string_lossy().to_string(),
        input.to_string_lossy().to_string(),
    ];

    let (mut rx, child) = ctx
        .app
        .shell()
        .command(soffice.to_string_lossy().to_string())
        .args(args)
        .spawn()
        .map_err(|e| format!("LibreOffice başlatılamadı: {e}"))?;
    ctx.register_child(child);
    ctx.emit(10.0, "dönüştürülüyor");

    let mut stderr = String::new();
    let mut exit_code: Option<i32> = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(line) | CommandEvent::Stdout(line) => {
                crate::convert::push_capped(&mut stderr, &String::from_utf8_lossy(&line));
                stderr.push('\n');
            }
            CommandEvent::Error(error) => crate::convert::push_capped(&mut stderr, &error),
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
                break;
            }
            _ => {}
        }
    }

    if ctx.is_cancelled() {
        let _ = std::fs::remove_dir_all(&temp);
        return Err(CANCELLED.to_string());
    }
    ctx.emit(85.0, "yazılıyor");

    let produced = find_output(&temp, target);
    let result = match produced {
        Some(path) if exit_code.unwrap_or(0) == 0 => {
            let output_parent = output
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from("."));
            move_file(&path, output)?;
            let warnings = move_sidecars(&temp, &output_parent);
            ctx.emit(100.0, "tamamlandı");
            Ok((vec![output.to_string_lossy().to_string()], warnings))
        }
        _ => {
            let detail = short_office_error(&stderr);
            Err(format!("LibreOffice dönüştüremedi: {detail}"))
        }
    };
    let _ = std::fs::remove_dir_all(&temp);
    result
}

/// HTML/Web çıktısında LibreOffice ana dosyanın yanına görsel/klasör bırakabilir.
/// Bunları hedef klasöre taşımazsak HTML'deki bağlantılar kırılır. Var olan ada
/// dokunulmaz; çakışma uyarı olarak döner.
fn move_sidecars(temp: &Path, dest_parent: &Path) -> Vec<String> {
    let mut warnings = Vec::new();
    let Ok(entries) = std::fs::read_dir(temp) else {
        return warnings;
    };
    for entry in entries.flatten() {
        let from = entry.path();
        let name = entry.file_name();
        let name_text = name.to_string_lossy().to_lowercase();
        if name_text.starts_with('.') || name_text.contains(".lock") {
            continue;
        }
        let to = dest_parent.join(&name);
        if to.exists() {
            warnings.push(format!(
                "Yan dosya zaten vardı, taşınmadı: {}",
                name.to_string_lossy()
            ));
            continue;
        }
        if let Err(error) = move_path(&from, &to) {
            warnings.push(format!(
                "Yan dosya taşınamadı ({}): {error}",
                name.to_string_lossy()
            ));
        }
    }
    warnings
}

fn move_path(from: &Path, to: &Path) -> std::io::Result<()> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    if from.is_dir() {
        std::fs::create_dir_all(to)?;
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            move_path(&entry.path(), &to.join(entry.file_name()))?;
        }
        std::fs::remove_dir_all(from)
    } else {
        std::fs::copy(from, to)?;
        std::fs::remove_file(from)
    }
}

/// Hedef uzantıya uyan tek çıktıyı bul. LibreOffice çıktıyı kendi adlandırır.
fn find_output(dir: &Path, target: &str) -> Option<PathBuf> {
    let expected = match target {
        "jpg" | "jpeg" => vec!["jpg", "jpeg"],
        "tiff" | "tif" => vec!["tiff", "tif"],
        "html" | "htm" => vec!["html", "htm"],
        other => vec![other],
    };
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if name.starts_with('.') || name.contains(".lock") {
            continue;
        }
        let ext = paths::ext_of(&path);
        if expected.contains(&ext.as_str()) {
            return Some(path);
        }
    }
    None
}

fn temp_dir(ctx: &JobCtx<'_>) -> Result<PathBuf, String> {
    let base = ctx
        .app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Geçici klasör açılamadı: {e}"))?
        .join("conversions")
        .join(&ctx.job_id);
    std::fs::create_dir_all(&base).map_err(|e| format!("Geçici klasör açılamadı: {e}"))?;
    Ok(base)
}

fn filter_for(
    source: paths::SourceKind,
    target: &str,
    options: &Value,
) -> Result<String, String> {
    let writer = matches!(source, paths::SourceKind::Document);
    let calc = matches!(source, paths::SourceKind::Spreadsheet);
    let impress = matches!(source, paths::SourceKind::Presentation);
    match target {
        "pdf" => {
            let family = if calc {
                "calc"
            } else if impress {
                "impress"
            } else {
                "writer"
            };
            let mut opts = Map::new();
            if let Some(range) = super::opt_str(options, "page_range") {
                opts.insert("PageRange".into(), json!({"type": "string", "value": range}));
            }
            if super::opt_bool(options, "pdfa") {
                let version = super::opt_u32(options, "pdfa_version", 2).clamp(1, 3);
                opts.insert(
                    "SelectPdfVersion".into(),
                    json!({"type": "long", "value": version}),
                );
            }
            if let Some(quality) = super::opt_str(options, "pdf_quality") {
                let value = match quality {
                    "screen" => 60,
                    "ebook" => 75,
                    _ => 90,
                };
                opts.insert("Quality".into(), json!({"type": "long", "value": value}));
            }
            if calc && super::opt_bool(options, "single_page_sheets") {
                opts.insert(
                    "SinglePageSheets".into(),
                    json!({"type": "boolean", "value": "true"}),
                );
            }
            let suffix = if opts.is_empty() {
                String::new()
            } else {
                format!(":{}", Value::Object(opts))
            };
            Ok(format!("pdf:{family}_pdf_Export{suffix}"))
        }
        "docx" => Ok("docx:MS Word 2007 XML".to_string()),
        "odt" => Ok("odt:writer8".to_string()),
        "rtf" => Ok("rtf:Rich Text Format".to_string()),
        "txt" => Ok("txt:Text (encoded):UTF8".to_string()),
        "md" if writer => Ok("md:Markdown".to_string()),
        "md" => Err("Markdown yalnız belgelerden üretilebilir.".to_string()),
        "html" if calc => Ok("html:HTML (StarCalc)".to_string()),
        "html" if impress => Ok("html:HTML (StarImpress)".to_string()),
        "html" => Ok("html:HTML (StarWriter)".to_string()),
        "xlsx" => Ok("xlsx:Calc Office Open XML".to_string()),
        "ods" => Ok("ods:calc8".to_string()),
        "pptx" => Ok("pptx:Impress MS PowerPoint 2007 XML".to_string()),
        "odp" => Ok("odp:impress8".to_string()),
        "csv" => {
            let delimiter = match super::opt_str(options, "csv_delimiter").unwrap_or(",") {
                ";" => 59,
                "\\t" | "tab" => 9,
                _ => 44,
            };
            Ok(format!(
                "csv:Text - txt - csv (StarCalc):{delimiter},34,76,1"
            ))
        }
        other => Err(format!("LibreOffice bu hedefi desteklemiyor: {other}")),
    }
}

/// Ham LibreOffice stderr'ini kısa, dürüst Türkçe mesaja indirger.
fn short_office_error(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("no export filter") {
        return "Bu dosya için dışa aktarma filtresi bulunamadı; kaynak biçimi hedefle uyumlu değil."
            .to_string();
    }
    if lower.contains("source file could not be loaded") {
        return "Kaynak dosya açılamadı; bozuk, şifreli veya desteklenmeyen bir dosya olabilir."
            .to_string();
    }
    if lower.contains("password") || lower.contains("şifre") {
        return "Dosya parola korumalı; parola istemi desteklenmiyor.".to_string();
    }
    if lower.contains("no space left") || lower.contains("disk full") {
        return "Diskte yer kalmadı.".to_string();
    }
    if lower.contains("please verify input parameters") {
        return "Dönüşüm parametreleri reddedildi; sayfa aralığı veya hedef biçimi geçersiz."
            .to_string();
    }
    let tail: String = raw
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("bilinmeyen hata")
        .chars()
        .take(300)
        .collect();
    tail.trim().to_string()
}

fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Çıktı klasörü açılamadı: {e}"))?;
    }
    let _ = std::fs::remove_file(to);
    // Geçici klasör app_cache'te (C:), çıktı başka sürücüde olabilir: rename
    // başarısız olursa kopyala + sil.
    if std::fs::rename(from, to).is_err() {
        std::fs::copy(from, to).map_err(|e| format!("Çıktı yazılamadı: {e}"))?;
        let _ = std::fs::remove_file(from);
    }
    Ok(())
}

/// LibreOffice ilerleme bildirmez; işin başında/sonunda yüzde yayınlanır.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pdf_filter_carries_page_range_and_pdfa() {
        let options = json!({"page_range": "2-5", "pdfa": true, "pdf_quality": "print"});
        let filter = filter_for(paths::SourceKind::Document, "pdf", &options).unwrap();
        assert!(filter.starts_with("pdf:writer_pdf_Export:{"));
        assert!(filter.contains("\"PageRange\""));
        assert!(filter.contains("\"SelectPdfVersion\""));
    }

    #[test]
    fn calc_pdf_can_use_single_page_sheets() {
        let options = json!({"single_page_sheets": true});
        let filter = filter_for(paths::SourceKind::Spreadsheet, "pdf", &options).unwrap();
        assert!(filter.starts_with("pdf:calc_pdf_Export:{"));
        assert!(filter.contains("SinglePageSheets"));
    }

    #[test]
    fn csv_delimiter_is_encoded() {
        let options = json!({"csv_delimiter": ";"});
        let filter = filter_for(paths::SourceKind::Spreadsheet, "csv", &options).unwrap();
        assert!(filter.contains(":59,34,76,1"));
    }

    #[test]
    fn markdown_is_only_for_documents() {
        assert!(
            filter_for(paths::SourceKind::Spreadsheet, "md", &json!({})).is_err()
        );
    }
}
