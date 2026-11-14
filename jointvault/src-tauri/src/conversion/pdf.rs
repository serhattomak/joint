// PDF motoru: PDFium (metin + raster) ve lopdf (sayfa işlemleri).
//
// PDFium dinamik yüklenir (`components/pdfium.dll`); çalıştırılabilir değildir,
// bu yüzden `components::require_component` kullanılır. Tüm sayfa işlemleri tek
// tek yapılır: 500 sayfalık bir PDF belleğe tamamen alınmaz.
use super::ooxml::{self, SlideImage};
use super::{paths, JobCtx, CANCELLED};
use image::{GenericImageView, ImageFormat, RgbImage};
use lopdf::{dictionary, Document as LopdfDocument, Object, ObjectId, SaveOptions};
use pdfium_render::prelude::*;
use printpdf::{
    Mm, Op, PdfDocument, PdfPage as PrintPdfPage, PdfSaveOptions, Pt, RawImage, XObjectTransform,
};
use std::collections::{BTreeMap, HashSet};
use std::io::Cursor;
use std::path::Path;
use std::sync::OnceLock;

/// PDFium binding'i süreç genelinde TEK kez yüklenir. `pdfium-render` ikinci
/// `bind_to_library` çağrısında `PdfiumLibraryBindingsAlreadyInitialized` döner;
/// her dönüşümde yeniden bağlanmak yerine bu önbellek kullanılır.
static PDFIUM: OnceLock<Pdfium> = OnceLock::new();

fn pdfium(ctx: &JobCtx<'_>) -> Result<&'static Pdfium, String> {
    if let Some(pdfium) = PDFIUM.get() {
        return Ok(pdfium);
    }
    let dll = crate::components::require_component(ctx.app, "pdfium")?;
    let bindings = Pdfium::bind_to_library(&dll)
        .map_err(|e| format!("PDF motoru yüklenemedi ({}): {e}", dll.display()))?;
    let _ = PDFIUM.set(Pdfium::new(bindings));
    PDFIUM
        .get()
        .ok_or_else(|| "PDF motoru yüklenemedi.".to_string())
}

pub(crate) async fn convert_pdf(
    ctx: &JobCtx<'_>,
    input: &Path,
    output: &Path,
    target: &str,
    options: &serde_json::Value,
) -> Result<(Vec<String>, Vec<String>), String> {
    match target {
        "png" | "jpg" => {
            let outputs = render_pages(ctx, input, output, target, options)?;
            Ok((
                outputs,
                vec!["Her sayfa ayrı bir görüntü dosyasına yazıldı.".to_string()],
            ))
        }
        "pptx" => {
            render_to_pptx(ctx, input, output, options)?;
            Ok((
                vec![output.to_string_lossy().to_string()],
                vec!["Her sayfa 16:9 bir slayta görsel olarak yerleşti; metin düzenlenemez.".to_string()],
            ))
        }
        "docx" | "xlsx" | "txt" | "md" | "html" => {
            let pages = extract_pages(ctx, input)?;
            if !pages.iter().any(|page| !page.is_empty()) {
                return Err(
                    "Bu PDF'te metin katmanı yok (taranmış olabilir). PNG/JPG veya PPTX hedefini dene."
                        .to_string(),
                );
            }
            if let Err(error) = write_text_output(ctx, output, target, &pages) {
                let _ = std::fs::remove_file(output);
                return Err(error);
            }
            let warning = if target == "docx" || target == "xlsx" {
                "Metin tabanlı çıktı: görsel ve birebir sayfa düzeni korunmaz.".to_string()
            } else {
                "Metin PDF'ten düz metin olarak çıkarıldı.".to_string()
            };
            Ok((vec![output.to_string_lossy().to_string()], vec![warning]))
        }
        other => Err(format!("PDF bu hedefi desteklemiyor: {other}")),
    }
}

/// Sayfaları görsel satırlara çevir. PDFium metin segmentlerinin konumları
/// kullanılır; satırlar y'ye, kelimeler x'e göre yeniden kurulur.
fn extract_pages(ctx: &JobCtx<'_>, input: &Path) -> Result<Vec<Vec<String>>, String> {
    let pdfium = pdfium(ctx)?;
    let document = pdfium
        .load_pdf_from_file(input, None)
        .map_err(|e| format!("PDF açılamadı: {e}"))?;
    let count = document.pages().len() as usize;
    if count == 0 {
        return Err("PDF'te sayfa bulunamadı.".to_string());
    }
    let mut pages = Vec::with_capacity(count);
    for index in 0..count {
        if ctx.is_cancelled() {
            return Err(CANCELLED.to_string());
        }
        let page = document
            .pages()
            .get(index as PdfPageIndex)
            .map_err(|e| format!("PDF sayfası okunamadı: {e}"))?;
        let text = page.text().map_err(|e| format!("PDF metni okunamadı: {e}"))?;
        let mut spans: Vec<(f32, f32, String)> = Vec::new();
        for segment in text.segments().iter() {
            let bounds = segment.bounds();
            let value = segment.text();
            for line in value.split('\n') {
                let line = line.trim_end();
                if !line.trim().is_empty() {
                    spans.push((bounds.left().value, bounds.top().value, line.to_string()));
                }
            }
        }
        spans.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal))
        });
        let mut lines: Vec<Vec<(f32, String)>> = Vec::new();
        let mut line_top = f32::NAN;
        for (x, top, value) in spans {
            if lines.is_empty() || (line_top - top).abs() > 4.5 {
                lines.push(vec![(x, value)]);
                line_top = top;
            } else if let Some(line) = lines.last_mut() {
                line.push((x, value));
            }
        }
        let mut page_lines = Vec::with_capacity(lines.len());
        for mut line in lines {
            line.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
            let mut joined = String::new();
            let mut last_x = f32::NAN;
            for (x, value) in line {
                if !joined.is_empty() && x - last_x > 6.0 && !joined.ends_with(' ') {
                    joined.push(' ');
                }
                joined.push_str(value.trim());
                last_x = x;
            }
            if !joined.trim().is_empty() {
                page_lines.push(joined.trim().to_string());
            }
        }
        pages.push(page_lines);
        ctx.emit(
            5.0 + (index + 1) as f64 / count as f64 * 25.0,
            "metin çıkarılıyor",
        );
    }
    Ok(pages)
}

fn write_text_output(
    ctx: &JobCtx<'_>,
    output: &Path,
    target: &str,
    pages: &[Vec<String>],
) -> Result<(), String> {
    match target {
        "docx" => ooxml::write_docx(output, pages),
        "xlsx" => ooxml::write_xlsx(output, pages),
        "txt" => {
            let text = pages
                .iter()
                .map(|page| page.join("\n"))
                .collect::<Vec<_>>()
                .join("\n\n");
            std::fs::write(output, text).map_err(|e| format!("Çıktı yazılamadı: {e}"))
        }
        "md" => {
            let text = pages
                .iter()
                .map(|page| page.join("\n\n"))
                .collect::<Vec<_>>()
                .join("\n\n---\n\n");
            std::fs::write(output, text).map_err(|e| format!("Çıktı yazılamadı: {e}"))
        }
        "html" => {
            let mut html = String::from(
                "<!doctype html><html lang=\"tr\"><head><meta charset=\"utf-8\">\
<title>JointVault PDF aktarımı</title>\
<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.55}\
section{margin:0 0 2.5rem}section+section{border-top:1px solid #ddd;padding-top:2rem}</style>\
</head><body>",
            );
            for (index, page) in pages.iter().enumerate() {
                html.push_str(&format!("<section data-page=\"{}\">", index + 1));
                for line in page {
                    html.push_str(&format!("<p>{}</p>", html_escape(line)));
                }
                html.push_str("</section>");
            }
            html.push_str("</body></html>");
            std::fs::write(output, html).map_err(|e| format!("Çıktı yazılamadı: {e}"))
        }
        _ => Err(format!("Metin hedefi desteklenmiyor: {target}")),
    }?;
    ctx.emit(100.0, "yazıldı");
    Ok(())
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn image_width_px(dpi: u32, page: &PdfPage<'_>) -> i32 {
    let width_pt = page.page_size().width().value;
    let px = (width_pt / 72.0 * dpi as f32).round() as i32;
    // Aşırı büyük DPI'da bile bellek patlamasın.
    px.clamp(160, 4_000)
}

fn render_pages(
    ctx: &JobCtx<'_>,
    input: &Path,
    output: &Path,
    format: &str,
    options: &serde_json::Value,
) -> Result<Vec<String>, String> {
    let pdfium = pdfium(ctx)?;
    let document = pdfium
        .load_pdf_from_file(input, None)
        .map_err(|e| format!("PDF açılamadı: {e}"))?;
    let count = document.pages().len() as usize;
    if count == 0 {
        return Err("PDF'te sayfa bulunamadı.".to_string());
    }
    let range = paths::parse_page_range(
        super::opt_str(options, "page_range").unwrap_or(""),
        count,
    )?;
    let dpi = super::opt_u32(options, "dpi", 150).clamp(72, 600);
    let quality = super::opt_u32(options, "image_quality", 88).clamp(40, 100) as u8;
    let mut outputs = Vec::with_capacity(range.len());
    let result = (|| -> Result<(), String> {
        for (step, page_index) in range.iter().enumerate() {
            if ctx.is_cancelled() {
                return Err(CANCELLED.to_string());
            }
            let page = document
                .pages()
                .get(*page_index as PdfPageIndex)
                .map_err(|e| format!("PDF sayfası okunamadı: {e}"))?;
            let width = image_width_px(dpi, &page);
            let config = PdfRenderConfig::new()
                .set_target_width(width)
                .set_maximum_height(6_000);
            let image = page
                .render_with_config(&config)
                .map_err(|e| format!("PDF sayfası çizilemedi: {e}"))?
                .as_image()
                .map_err(|e| format!("PDF sayfası görüntüye çevrilemedi: {e}"))?;
            let mut path = paths::page_output(output, *page_index);
            path = paths::unique_output(&path);
            save_image(&image, &path, format, quality)?;
            outputs.push(path.to_string_lossy().to_string());
            ctx.emit(
                30.0 + (step + 1) as f64 / range.len() as f64 * 65.0,
                "sayfalar çiziliyor",
            );
        }
        Ok(())
    })();
    if let Err(error) = result {
        cleanup_files(&outputs);
        return Err(error);
    }
    Ok(outputs)
}

fn cleanup_files(paths: &[String]) {
    for path in paths {
        let _ = std::fs::remove_file(path);
    }
}

fn save_image(
    image: &image::DynamicImage,
    path: &Path,
    format: &str,
    quality: u8,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Çıktı klasörü açılamadı: {e}"))?;
    }
    match format {
        "jpg" => {
            let rgb: RgbImage = image.to_rgb8();
            let mut file =
                std::fs::File::create(path).map_err(|e| format!("Görüntü yazılamadı: {e}"))?;
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut file, quality)
                .encode_image(&rgb)
                .map_err(|e| format!("JPEG yazılamadı: {e}"))
        }
        "png" => image
            .save_with_format(path, ImageFormat::Png)
            .map_err(|e| format!("PNG yazılamadı: {e}")),
        other => Err(format!("PDF görüntü hedefi desteklenmiyor: {other}")),
    }
}

fn render_to_pptx(
    ctx: &JobCtx<'_>,
    input: &Path,
    output: &Path,
    options: &serde_json::Value,
) -> Result<(), String> {
    let pdfium = pdfium(ctx)?;
    let document = pdfium
        .load_pdf_from_file(input, None)
        .map_err(|e| format!("PDF açılamadı: {e}"))?;
    let count = document.pages().len() as usize;
    if count == 0 {
        return Err("PDF'te sayfa bulunamadı.".to_string());
    }
    let range = paths::parse_page_range(
        super::opt_str(options, "page_range").unwrap_or(""),
        count,
    )?;
    let mut slides = Vec::with_capacity(range.len());
    for (step, page_index) in range.iter().enumerate() {
        if ctx.is_cancelled() {
            return Err(CANCELLED.to_string());
        }
        let page = document
            .pages()
            .get(*page_index as PdfPageIndex)
            .map_err(|e| format!("PDF sayfası okunamadı: {e}"))?;
        let config = PdfRenderConfig::new()
            .set_target_width(1_600)
            .set_maximum_height(2_400);
        let image = page
            .render_with_config(&config)
            .map_err(|e| format!("PDF sayfası çizilemedi: {e}"))?
            .as_image()
            .map_err(|e| format!("PDF sayfası görüntüye çevrilemedi: {e}"))?;
        let rgb: RgbImage = image.to_rgb8();
        let (width, height) = rgb.dimensions();
        let mut bytes = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut Cursor::new(&mut bytes), 86)
            .encode_image(&rgb)
            .map_err(|e| format!("Slayt görseli sıkıştırılamadı: {e}"))?;
        slides.push(SlideImage {
            bytes,
            width,
            height,
        });
        ctx.emit(
            25.0 + (step + 1) as f64 / range.len() as f64 * 55.0,
            "slaytlar hazırlanıyor",
        );
    }
    if let Err(error) = ooxml::write_pptx(output, &slides) {
        let _ = std::fs::remove_file(output);
        return Err(error);
    }
    ctx.emit(100.0, "yazıldı");
    Ok(())
}

pub(crate) async fn compress_pdf(
    ctx: &JobCtx<'_>,
    input: &Path,
    output: &Path,
) -> Result<(Vec<String>, Vec<String>), String> {
    let before = std::fs::metadata(input).map(|m| m.len()).unwrap_or(0);
    let mut document =
        LopdfDocument::load(input).map_err(|e| format!("PDF açılamadı: {e}"))?;
    document.compress();
    document.prune_objects();
    document.renumber_objects();
    let options = SaveOptions::builder()
        .use_object_streams(true)
        .use_xref_streams(true)
        .compression_level(9)
        .build();
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Çıktı klasörü açılamadı: {e}"))?;
    }
    let mut file = std::fs::File::create(output).map_err(|e| format!("Çıktı yazılamadı: {e}"))?;
    if let Err(error) = document.save_with_options(&mut file, options) {
        drop(file);
        let _ = std::fs::remove_file(output);
        return Err(format!("PDF yazılamadı: {error}"));
    }
    let after = std::fs::metadata(output).map(|m| m.len()).unwrap_or(0);
    ctx.emit(100.0, "tamamlandı");
    let warning = if before > 0 && after >= before {
        vec![format!(
            "Sıkıştırma dosyayı küçültmedi ({} → {} bayt); içerik zaten sıkışık olabilir.",
            before, after
        )]
    } else {
        Vec::new()
    };
    Ok((vec![output.to_string_lossy().to_string()], warning))
}

// --- PDF araçları -----------------------------------------------------------

pub(crate) async fn pdf_tool(
    ctx: &JobCtx<'_>,
    tool: &str,
    inputs: &[String],
    output: &Path,
    options: &serde_json::Value,
) -> Result<(Vec<String>, Vec<String>), String> {
    match tool {
        "merge" => {
            if inputs.len() < 2 {
                return Err("Birleştirmek için en az iki PDF seç.".to_string());
            }
            merge_pdfs(ctx, inputs, output)?;
            Ok((vec![output.to_string_lossy().to_string()], Vec::new()))
        }
        "split" => split_pdf(ctx, inputs, output, options),
        "rotate" => rotate_pdf(ctx, inputs, output, options),
        "compress" => compress_pdf(ctx, Path::new(&inputs[0]), output).await,
        "images_to_pdf" => {
            images_to_pdf(ctx, inputs, output, options).await
        }
        other => Err(format!("Bilinmeyen PDF aracı: {other}")),
    }
}

fn merge_pdfs(ctx: &JobCtx<'_>, inputs: &[String], output: &Path) -> Result<(), String> {
    let mut max_id = 1u32;
    let mut pages: BTreeMap<ObjectId, Object> = BTreeMap::new();
    let mut objects = BTreeMap::new();
    let mut document = LopdfDocument::with_version("1.5");
    for (index, path) in inputs.iter().enumerate() {
        if ctx.is_cancelled() {
            return Err(CANCELLED.to_string());
        }
        let mut part = LopdfDocument::load(path).map_err(|e| format!("PDF açılamadı ({path}): {e}"))?;
        part.renumber_objects_with(max_id);
        max_id = part.max_id + 1;
        for (_, id) in part.get_pages() {
            if let Ok(object) = part.get_object(id) {
                pages.insert(id, object.clone());
            }
        }
        objects.extend(part.objects);
        ctx.emit(
            (index + 1) as f64 / inputs.len() as f64 * 80.0,
            "birleştiriliyor",
        );
    }
    let pages_id = document.new_object_id();
    document.objects.extend(objects);
    for (id, object) in &pages {
        if let Ok(dict) = object.as_dict() {
            let mut dict = dict.clone();
            dict.set("Parent", pages_id);
            document.objects.insert(*id, Object::Dictionary(dict));
        }
    }
    let kids: Vec<Object> = pages.keys().map(|id| Object::Reference(*id)).collect();
    document.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => kids,
            "Count" => pages.len() as i64,
        }),
    );
    let catalog_id = document.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    document
        .trailer
        .set("Root", catalog_id);
    document.compress();
    if let Err(error) = document.save(output) {
        let _ = std::fs::remove_file(output);
        return Err(format!("Birleştirilmiş PDF yazılamadı: {error}"));
    }
    ctx.emit(100.0, "tamamlandı");
    Ok(())
}

fn split_pdf(
    ctx: &JobCtx<'_>,
    inputs: &[String],
    output: &Path,
    options: &serde_json::Value,
) -> Result<(Vec<String>, Vec<String>), String> {
    let input = inputs
        .first()
        .ok_or_else(|| "Bölmek için bir PDF seç.".to_string())?;
    let document = LopdfDocument::load(input).map_err(|e| format!("PDF açılamadı: {e}"))?;
    let count = document.get_pages().len();
    let range = paths::parse_page_range(
        super::opt_str(options, "page_range").unwrap_or(""),
        count,
    )?;
    let split_each = super::opt_bool(options, "split_each");
    if split_each {
        let mut outputs = Vec::with_capacity(range.len());
        for (step, page_index) in range.iter().enumerate() {
            if ctx.is_cancelled() {
                return Err(CANCELLED.to_string());
            }
            let mut part =
                LopdfDocument::load(input).map_err(|e| format!("PDF açılamadı: {e}"))?;
            let page_number = (*page_index + 1) as u32;
            let all: Vec<u32> = part.get_pages().keys().copied().collect();
            let delete: Vec<u32> = all.into_iter().filter(|n| *n != page_number).collect();
            part.delete_pages(&delete);
            part.compress();
            let mut path = paths::page_output(output, *page_index);
            path = paths::unique_output(&path);
            if let Err(error) = part.save(&path) {
                cleanup_files(&outputs);
                return Err(format!("Sayfa yazılamadı: {error}"));
            }
            outputs.push(path.to_string_lossy().to_string());
            ctx.emit(
                10.0 + (step + 1) as f64 / range.len() as f64 * 85.0,
                "sayfalar ayrılıyor",
            );
        }
        Ok((
            outputs,
            vec!["Her seçili sayfa ayrı bir PDF dosyasına yazıldı.".to_string()],
        ))
    } else {
        let mut document = LopdfDocument::load(input).map_err(|e| format!("PDF açılamadı: {e}"))?;
        let all: Vec<u32> = document.get_pages().keys().copied().collect();
        let keep: HashSet<u32> = range.iter().map(|i| (*i + 1) as u32).collect();
        let delete: Vec<u32> = all.into_iter().filter(|n| !keep.contains(n)).collect();
        document.delete_pages(&delete);
        document.compress();
        if let Err(error) = document.save(output) {
            let _ = std::fs::remove_file(output);
            return Err(format!("Ayrılmış PDF yazılamadı: {error}"));
        }
        Ok((vec![output.to_string_lossy().to_string()], Vec::new()))
    }
}

fn rotate_pdf(
    ctx: &JobCtx<'_>,
    inputs: &[String],
    output: &Path,
    options: &serde_json::Value,
) -> Result<(Vec<String>, Vec<String>), String> {
    let input = inputs
        .first()
        .ok_or_else(|| "Döndürmek için bir PDF seç.".to_string())?;
    let angle = super::opt_u32(options, "angle", 90) as i64;
    let angle = ((angle % 360) + 360) % 360;
    let mut document = LopdfDocument::load(input).map_err(|e| format!("PDF açılamadı: {e}"))?;
    let page_count = document.get_pages().len();
    let range = paths::parse_page_range(
        super::opt_str(options, "page_range").unwrap_or(""),
        page_count,
    )?;
    let selected: HashSet<u32> = range.iter().map(|index| (*index + 1) as u32).collect();
    let page_ids: Vec<(u32, ObjectId)> = document
        .get_pages()
        .into_iter()
        .filter(|(number, _)| selected.contains(number))
        .collect();
    for (_, id) in page_ids {
        if let Ok(object) = document.get_object_mut(id) {
            if let Ok(dict) = object.as_dict_mut() {
                let current = dict.get(b"Rotate").and_then(|v| v.as_i64()).unwrap_or(0);
                dict.set("Rotate", (current + angle) % 360);
            }
        }
    }
    if let Err(error) = document.save(output) {
        let _ = std::fs::remove_file(output);
        return Err(format!("Döndürülmüş PDF yazılamadı: {error}"));
    }
    ctx.emit(100.0, "tamamlandı");
    Ok((vec![output.to_string_lossy().to_string()], Vec::new()))
}

pub(crate) async fn images_to_pdf(
    ctx: &JobCtx<'_>,
    inputs: &[String],
    output: &Path,
    options: &serde_json::Value,
) -> Result<(Vec<String>, Vec<String>), String> {
    if inputs.is_empty() {
        return Err("PDF'e dönüştürmek için en az bir görsel seç.".to_string());
    }
    let page_size = super::opt_str(options, "page_size").unwrap_or("a4");
    let mut document = PdfDocument::new("JointVault");
    let mut pages = Vec::with_capacity(inputs.len());
    for (index, path) in inputs.iter().enumerate() {
        if ctx.is_cancelled() {
            return Err(CANCELLED.to_string());
        }
        let image =
            image::open(path).map_err(|e| format!("Görsel açılamadı ({path}): {e}"))?;
        let (width, height) = image.dimensions();
        let mut png = Vec::new();
        image
            .write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
            .map_err(|e| format!("Görsel hazırlanamadı: {e}"))?;
        let raw = RawImage::decode_from_bytes(&png, &mut Vec::new())
            .map_err(|e| format!("Görsel çözülemedi: {e}"))?;
        let id = document.add_image(&raw);
        let (page_w_mm, page_h_mm) = page_dimensions(page_size, width, height);
        let natural_w_mm = width as f32 / 300.0 * 25.4;
        let natural_h_mm = height as f32 / 300.0 * 25.4;
        let scale = ((page_w_mm * 0.94) / natural_w_mm)
            .min((page_h_mm * 0.94) / natural_h_mm);
        let translate_x = (page_w_mm - natural_w_mm * scale) / 2.0 / 25.4 * 72.0;
        let translate_y = (page_h_mm - natural_h_mm * scale) / 2.0 / 25.4 * 72.0;
        let ops = vec![Op::UseXobject {
            id,
            transform: XObjectTransform {
                translate_x: Some(Pt(translate_x)),
                translate_y: Some(Pt(translate_y)),
                scale_x: Some(scale),
                scale_y: Some(scale),
                dpi: Some(300.0),
                ..Default::default()
            },
        }];
        pages.push(PrintPdfPage::new(Mm(page_w_mm), Mm(page_h_mm), ops));
        ctx.emit(
            (index + 1) as f64 / inputs.len() as f64 * 90.0,
            "görseller sayfalanıyor",
        );
    }
    let warnings = Vec::new();
    let pdf_bytes = document
        .with_pages(pages)
        .save(&PdfSaveOptions::default(), &mut Vec::new());
    if let Err(error) = std::fs::write(output, pdf_bytes) {
        let _ = std::fs::remove_file(output);
        return Err(format!("PDF yazılamadı: {error}"));
    }
    ctx.emit(100.0, "tamamlandı");
    Ok((vec![output.to_string_lossy().to_string()], warnings))
}

fn page_dimensions(preset: &str, width: u32, height: u32) -> (f32, f32) {
    match preset {
        "letter" => (215.9, 279.4),
        "auto" => {
            let w = (width as f32 / 96.0 * 25.4).clamp(50.0, 2000.0);
            let h = (height as f32 / 96.0 * 25.4).clamp(50.0, 2000.0);
            (w, h)
        }
        _ => (210.0, 297.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_dimensions_support_a4_letter_and_auto() {
        assert_eq!(page_dimensions("a4", 1000, 1000), (210.0, 297.0));
        assert_eq!(page_dimensions("letter", 1000, 1000), (215.9, 279.4));
        let (w, h) = page_dimensions("auto", 960, 540);
        assert!((w - 254.0).abs() < 1.0);
        assert!((h - 142.875).abs() < 1.0);
    }

    #[test]
    fn html_escape_covers_markup() {
        assert_eq!(html_escape("<a & \"b\">"), "&lt;a &amp; &quot;b&quot;&gt;");
    }

    /// Gerçek PDFium DLL'i ve bir PDF yalnızca ortam değişkenleriyle verildiğinde
    /// çalışır; varsayılan `cargo test` bileşen istemez. Doğrulama komutu:
    /// `JV_PDFIUM_DLL=... JV_TEST_PDF=... cargo test pdfium_renders -- --nocapture`
    #[test]
    fn pdfium_renders_when_test_env_is_set() {
        let Ok(dll) = std::env::var("JV_PDFIUM_DLL") else {
            return;
        };
        let Ok(pdf) = std::env::var("JV_TEST_PDF") else {
            return;
        };
        let pdfium = Pdfium::new(
            Pdfium::bind_to_library(&dll).expect("pdfium.dll yüklenebilmeli"),
        );
        let document = pdfium
            .load_pdf_from_file(Path::new(&pdf), None)
            .expect("test PDF açılmalı");
        assert!(document.pages().len() > 0);
        let page = document.pages().get(0).expect("ilk sayfa");
        let text = page.text().expect("metin katmanı");
        let _ = text.all();
        let image = page
            .render_with_config(&PdfRenderConfig::new().set_target_width(400))
            .expect("render")
            .as_image()
            .expect("görüntü");
        assert!(image.width() > 0 && image.height() > 0);
    }
}
