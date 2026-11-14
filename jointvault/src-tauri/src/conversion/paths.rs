// Biçim algılama, hedef matrisi, sayfa aralığı ve çıktı adı.
//
// Arayüzdeki `lib/conversion.ts` matrisi ile BURADAKİ matris aynı olmak zorunda;
// backend tek başına güven sınırıdır, bu yüzden hedef yeniden doğrulanır.
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum SourceKind {
    Document,
    Spreadsheet,
    Presentation,
    Pdf,
    Image,
    Audio,
    Video,
}

impl SourceKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            SourceKind::Document => "document",
            SourceKind::Spreadsheet => "spreadsheet",
            SourceKind::Presentation => "presentation",
            SourceKind::Pdf => "pdf",
            SourceKind::Image => "image",
            SourceKind::Audio => "audio",
            SourceKind::Video => "video",
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            SourceKind::Document => "Belge",
            SourceKind::Spreadsheet => "Tablo",
            SourceKind::Presentation => "Sunum",
            SourceKind::Pdf => "PDF",
            SourceKind::Image => "Görsel",
            SourceKind::Audio => "Ses",
            SourceKind::Video => "Video",
        }
    }
}

const DOCUMENT_EXT: &[&str] = &[
    "docx", "doc", "odt", "rtf", "txt", "html", "htm", "md", "markdown",
];
const SPREADSHEET_EXT: &[&str] = &["xlsx", "xls", "ods", "csv"];
const PRESENTATION_EXT: &[&str] = &["pptx", "ppt", "odp"];
const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "gif"];
const AUDIO_EXT: &[&str] = &[
    "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "wma", "aiff", "aif", "amr",
];
const VIDEO_EXT: &[&str] = &[
    "mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv", "flv", "ts", "mts", "mpg", "mpeg", "3gp",
];

pub(crate) fn ext_of(path: &Path) -> String {
    path.extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

pub(crate) fn source_kind(path: &Path) -> Option<SourceKind> {
    let ext = ext_of(path);
    if DOCUMENT_EXT.contains(&ext.as_str()) {
        Some(SourceKind::Document)
    } else if SPREADSHEET_EXT.contains(&ext.as_str()) {
        Some(SourceKind::Spreadsheet)
    } else if PRESENTATION_EXT.contains(&ext.as_str()) {
        Some(SourceKind::Presentation)
    } else if ext == "pdf" {
        Some(SourceKind::Pdf)
    } else if IMAGE_EXT.contains(&ext.as_str()) {
        Some(SourceKind::Image)
    } else if AUDIO_EXT.contains(&ext.as_str()) {
        Some(SourceKind::Audio)
    } else if VIDEO_EXT.contains(&ext.as_str()) {
        Some(SourceKind::Video)
    } else {
        None
    }
}

/// Kullanıcı/istemci `jpeg`, `tif` gibi eşanlamlıları yazabilir; kanonik ada indir.
pub(crate) fn normalize_target(raw: &str) -> Option<String> {
    let value = raw.trim().trim_start_matches('.').to_ascii_lowercase();
    let canonical = match value.as_str() {
        "jpeg" => "jpg",
        "tif" => "tiff",
        "htm" => "html",
        "oga" => "ogg",
        other => other,
    };
    matches!(
        canonical,
        "pdf"
            | "docx"
            | "odt"
            | "rtf"
            | "txt"
            | "html"
            | "md"
            | "xlsx"
            | "ods"
            | "csv"
            | "pptx"
            | "odp"
            | "png"
            | "jpg"
            | "webp"
            | "bmp"
            | "tiff"
            | "gif"
            | "mp3"
            | "m4a"
            | "aac"
            | "wav"
            | "flac"
            | "ogg"
            | "opus"
            | "mp4"
            | "mkv"
            | "webm"
            | "mov"
            | "avi"
    )
    .then(|| canonical.to_string())
}

/// Kaynak türüne göre hedef izinli mi? `path` yalnızca uzantı için gerekli.
pub(crate) fn target_allowed(kind: SourceKind, path: &Path, target: &str) -> bool {
    let ext = ext_of(path);
    let target = match target {
        "jpeg" => "jpg",
        "tif" => "tiff",
        other => other,
    };
    match kind {
        SourceKind::Document => matches!(
            target,
            "pdf" | "docx" | "odt" | "rtf" | "txt" | "html" | "md"
        ),
        SourceKind::Spreadsheet => {
            matches!(target, "pdf" | "xlsx" | "ods" | "csv" | "html")
        }
        SourceKind::Presentation => matches!(target, "pdf" | "pptx" | "odp"),
        SourceKind::Pdf => matches!(
            target,
            "pdf" | "docx" | "xlsx" | "pptx" | "txt" | "md" | "html" | "png" | "jpg"
        ),
        SourceKind::Image => {
            matches!(target, "png" | "jpg" | "webp" | "bmp" | "tiff" | "gif" | "pdf")
        }
        SourceKind::Audio => {
            matches!(target, "mp3" | "m4a" | "aac" | "wav" | "flac" | "ogg" | "opus")
        }
        SourceKind::Video => matches!(
            target,
            "mp4" | "mkv" | "webm" | "mov" | "avi" | "gif" | "mp3" | "m4a" | "wav"
        ),
    }
    .then_some(())
    .map(|_| !ext.is_empty())
    .unwrap_or(false)
}

/// Çıktı yolunu doğrula: uzantı hedefle uyumlu, kaynakla aynı değil, `..` yok.
pub(crate) fn validate_output(input: &Path, output: &Path, target: &str) -> Result<(), String> {
    if output
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("Çıktı yolu '..' içeremez.".to_string());
    }
    let ext = ext_of(output);
    let expected = match target {
        "jpeg" => "jpg",
        "tif" => "tiff",
        other => other,
    };
    let ext_ok = ext == expected || (expected == "jpg" && ext == "jpeg");
    if !ext_ok {
        return Err(format!(
            "Çıktı uzantısı hedefle uyuşmuyor: .{ext} (beklenen .{expected})"
        ));
    }
    if same_file(input, output) {
        return Err("Kaynak dosyanın üzerine yazılamaz; farklı bir çıktı adı seç."
            .to_string());
    }
    Ok(())
}

fn same_file(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Aynı ada sahip dosya varsa ` (2)`, ` (3)`… ekle. Kaynak asla ezilmez.
pub(crate) fn unique_output(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "cikti".to_string());
    let ext = path.extension().map(|e| e.to_string_lossy().to_string());
    for n in 2..10_000u32 {
        let name = match &ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    path.to_path_buf()
}

/// Çok sayfalı çıktı adı: `<stem>-sayfa-001.<ext>`.
pub(crate) fn page_output(base: &Path, page: usize) -> PathBuf {
    let parent = base.parent().unwrap_or_else(|| Path::new("."));
    let stem = base
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "sayfa".to_string());
    let ext = base
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_else(|| "png".to_string());
    parent.join(format!("{stem}-sayfa-{:03}.{ext}", page + 1))
}

/// "1-3,5" / "all" / boş → sıfır tabanlı sayfa indeksleri.
pub(crate) fn parse_page_range(spec: &str, count: usize) -> Result<Vec<usize>, String> {
    let trimmed = spec.trim().to_ascii_lowercase();
    if trimmed.is_empty() || trimmed == "all" || trimmed == "tümü" || trimmed == "tumu" {
        return Ok((0..count).collect());
    }
    let mut out: Vec<usize> = Vec::new();
    for part in trimmed.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let (start, end) = match part.split_once('-') {
            Some((a, b)) => (a.trim(), b.trim()),
            None => (part, part),
        };
        let start: usize = start
            .parse()
            .map_err(|_| format!("Sayfa aralığı anlaşılamadı: {part}"))?;
        let end: usize = end
            .parse()
            .map_err(|_| format!("Sayfa aralığı anlaşılamadı: {part}"))?;
        if start == 0 || end == 0 || start > end {
            return Err(format!("Geçersiz sayfa aralığı: {part}"));
        }
        if end > count {
            return Err(format!(
                "Sayfa aralığı belgeyi aşıyor: {part} (belge {count} sayfa)"
            ));
        }
        for page in start..=end {
            let index = page - 1;
            if !out.contains(&index) {
                out.push(index);
            }
        }
    }
    if out.is_empty() {
        return Err("Sayfa aralığı boş.".to_string());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_matrix_is_symmetric_with_frontend() {
        assert!(target_allowed(
            SourceKind::Document,
            Path::new("a.docx"),
            "pdf"
        ));
        assert!(target_allowed(
            SourceKind::Spreadsheet,
            Path::new("a.xlsx"),
            "csv"
        ));
        assert!(target_allowed(
            SourceKind::Presentation,
            Path::new("a.pptx"),
            "pdf"
        ));
        assert!(target_allowed(SourceKind::Pdf, Path::new("a.pdf"), "docx"));
        assert!(target_allowed(SourceKind::Image, Path::new("a.png"), "pdf"));
        assert!(target_allowed(SourceKind::Audio, Path::new("a.mp3"), "flac"));
        assert!(target_allowed(SourceKind::Video, Path::new("a.mp4"), "gif"));
        assert!(!target_allowed(
            SourceKind::Audio,
            Path::new("a.mp3"),
            "mp4"
        ));
        assert!(!target_allowed(
            SourceKind::Image,
            Path::new("a.png"),
            "docx"
        ));
    }

    #[test]
    fn page_range_parses_and_clamps() {
        assert_eq!(parse_page_range("", 3).unwrap(), vec![0, 1, 2]);
        assert_eq!(parse_page_range("1-2,2,3", 3).unwrap(), vec![0, 1, 2]);
        assert!(parse_page_range("0-1", 3).is_err());
        assert!(parse_page_range("3-4", 3).is_err());
        assert!(parse_page_range("4", 3).is_err());
    }

    #[test]
    fn page_output_keeps_directory_and_numbers_pages() {
        let out = page_output(Path::new("C:\\v\\rapor.png"), 0);
        assert_eq!(out, PathBuf::from("C:\\v\\rapor-sayfa-001.png"));
        let out = page_output(Path::new("rapor.jpg"), 11);
        assert_eq!(out, PathBuf::from("rapor-sayfa-012.jpg"));
    }

    #[test]
    fn normalize_target_accepts_aliases() {
        assert_eq!(normalize_target(".JPEG").as_deref(), Some("jpg"));
        assert_eq!(normalize_target("tif").as_deref(), Some("tiff"));
        assert_eq!(normalize_target("exe"), None);
    }
}
