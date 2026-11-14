// PDF metninden/görüntüsünden DOCX, XLSX ve PPTX üretimi.
//
// Neden kendi yazıcı? PDF→ofis için LibreOffice'i PDF içe aktarmada kullanmak
// güvenilir değil (26.8.3'te asılı kaldı). OOXML paketleri sadece zip + XML'dir;
// ihtiyacımız olan alt küme küçük ve test edilebilir. Üretilen dosyalar
// LibreOffice ile tekrar PDF'e çevrilerek doğrulanır (bkz. docs/conversion-suite.md).
use std::fs::File;
use std::io::Write;
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

pub(crate) struct SlideImage {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

struct Package {
    zip: ZipWriter<File>,
}

impl Package {
    fn create(path: &Path) -> Result<Self, String> {
        let file = File::create(path).map_err(|e| format!("Çıktı oluşturulamadı: {e}"))?;
        Ok(Self {
            zip: ZipWriter::new(file),
        })
    }

    fn add(&mut self, name: &str, data: &str) -> Result<(), String> {
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);
        self.zip
            .start_file(name, options)
            .map_err(|e| format!("Paket yazılamadı ({name}): {e}"))?;
        self.zip
            .write_all(data.as_bytes())
            .map_err(|e| format!("Paket yazılamadı ({name}): {e}"))
    }

    fn add_bytes(&mut self, name: &str, data: &[u8]) -> Result<(), String> {
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .unix_permissions(0o644);
        self.zip
            .start_file(name, options)
            .map_err(|e| format!("Paket yazılamadı ({name}): {e}"))?;
        self.zip
            .write_all(data)
            .map_err(|e| format!("Paket yazılamadı ({name}): {e}"))
    }

    fn finish(self) -> Result<(), String> {
        self.zip
            .finish()
            .map_err(|e| format!("Paket kapatılamadı: {e}"))?;
        Ok(())
    }
}

fn xml_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c if c.is_control() && c != '\t' && c != '\n' && c != '\r' => {}
            c => out.push(c),
        }
    }
    out
}

// --- DOCX ------------------------------------------------------------------

/// Her sayfa bir bölümdür; sayfalar arasında sayfa sonu bulunur.
pub(crate) fn write_docx(path: &Path, pages: &[Vec<String>]) -> Result<(), String> {
    let mut body = String::new();
    if pages.is_empty() {
        body.push_str("<w:p/>");
    }
    for (page_index, page) in pages.iter().enumerate() {
        if page_index > 0 {
            body.push_str("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>");
        }
        if page.is_empty() {
            body.push_str("<w:p/>");
        }
        for line in page {
            let text = xml_escape(line);
            if text.trim().is_empty() {
                body.push_str("<w:p/>");
            } else {
                body.push_str(&format!(
                    "<w:p><w:pPr><w:spacing w:after=\"100\"/></w:pPr><w:r><w:t xml:space=\"preserve\">{text}</w:t></w:r></w:p>"
                ));
            }
        }
    }

    let document = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" \
xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\
<w:body>{body}<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/>\
<w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" \
w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/></w:sectPr></w:body></w:document>"
    );

    let content_types = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
<Default Extension=\"xml\" ContentType=\"application/xml\"/>\
<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>\
</Types>";
    let rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>\
</Relationships>";

    let mut package = Package::create(path)?;
    package.add("[Content_Types].xml", content_types)?;
    package.add("_rels/.rels", rels)?;
    package.add("word/document.xml", &document)?;
    package.finish()
}

// --- XLSX ------------------------------------------------------------------

/// Her PDF sayfası ayrı çalışma sayfasıdır. Satırlar, çift boşluk/tab ile
/// kolonlara ayrılır; birebir tablo yapısı iddiası yoktur.
pub(crate) fn write_xlsx(path: &Path, pages: &[Vec<String>]) -> Result<(), String> {
    let pages: Vec<Vec<String>> = if pages.is_empty() {
        vec![Vec::new()]
    } else {
        pages.to_vec()
    };
    let sheet_count = pages.len();

    let mut overrides = String::new();
    let mut workbook_sheets = String::new();
    let mut workbook_rels = String::new();
    let mut package = Package::create(path)?;

    for (index, rows) in pages.iter().enumerate() {
        let sheet_no = index + 1;
        let sheet_name = sanitize_sheet_name(&format!("Sayfa {sheet_no}"), index);
        overrides.push_str(&format!(
            "<Override PartName=\"/xl/worksheets/sheet{sheet_no}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
        ));
        workbook_sheets.push_str(&format!(
            "<sheet name=\"{}\" sheetId=\"{sheet_no}\" r:id=\"rId{sheet_no}\"/>",
            xml_escape(&sheet_name)
        ));
        workbook_rels.push_str(&format!(
            "<Relationship Id=\"rId{sheet_no}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{sheet_no}.xml\"/>"
        ));
        package.add(
            &format!("xl/worksheets/sheet{sheet_no}.xml"),
            &sheet_xml(rows),
        )?;
    }

    let styles_rel = sheet_count + 1;
    workbook_rels.push_str(&format!(
        "<Relationship Id=\"rId{styles_rel}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>"
    ));
    overrides.push_str(
        "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>",
    );

    let content_types = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
<Default Extension=\"xml\" ContentType=\"application/xml\"/>\
<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>\
{overrides}</Types>"
    );
    let rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>\
</Relationships>";
    let workbook = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" \
xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\
<sheets>{workbook_sheets}</sheets></workbook>"
    );
    let workbook_rels = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{workbook_rels}</Relationships>"
    );
    let styles = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\
<fonts count=\"1\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>\
<fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills>\
<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>\
<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>\
<cellXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/></cellXfs>\
<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>\
</styleSheet>";

    package.add("[Content_Types].xml", &content_types)?;
    package.add("_rels/.rels", rels)?;
    package.add("xl/workbook.xml", &workbook)?;
    package.add("xl/_rels/workbook.xml.rels", &workbook_rels)?;
    package.add("xl/styles.xml", styles)?;
    package.finish()
}

fn sheet_xml(rows: &[String]) -> String {
    let mut out = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\
<cols><col min=\"1\" max=\"24\" width=\"26\" customWidth=\"1\"/></cols><sheetData>",
    );
    for (row_index, line) in rows.iter().take(10_000).enumerate() {
        let cells = split_cells(line);
        out.push_str(&format!("<row r=\"{}\">", row_index + 1));
        for (col_index, cell) in cells.iter().take(64).enumerate() {
            let reference = format!("{}{}", column_name(col_index), row_index + 1);
            if cell.is_empty() {
                out.push_str(&format!("<c r=\"{reference}\"/>"));
            } else {
                out.push_str(&format!(
                    "<c r=\"{reference}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
                    xml_escape(cell)
                ));
            }
        }
        out.push_str("</row>");
    }
    out.push_str("</sheetData></worksheet>");
    out
}

/// Tab veya 2+ boşluk kolon ayırıcıdır; tek boşluk metnin parçasıdır.
fn split_cells(line: &str) -> Vec<String> {
    let mut cells = Vec::new();
    let mut current = String::new();
    let mut spaces = 0usize;
    for ch in line.chars() {
        if ch == '\t' {
            cells.push(current.trim_end().to_string());
            current.clear();
            spaces = 0;
            continue;
        }
        if ch == ' ' {
            spaces += 1;
            current.push(ch);
            continue;
        }
        if spaces >= 2 {
            cells.push(current.trim_end().to_string());
            current.clear();
        }
        spaces = 0;
        current.push(ch);
    }
    cells.push(current.trim_end().to_string());
    cells
}

fn column_name(mut index: usize) -> String {
    let mut out = String::new();
    loop {
        out.push((b'A' + (index % 26) as u8) as char);
        if index < 26 {
            break;
        }
        index = index / 26 - 1;
    }
    out.chars().rev().collect()
}

fn sanitize_sheet_name(raw: &str, index: usize) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| !matches!(c, '[' | ']' | ':' | '*' | '?' | '/' | '\\'))
        .take(31)
        .collect();
    if cleaned.trim().is_empty() {
        format!("Sayfa {}", index + 1)
    } else {
        cleaned
    }
}

// --- PPTX ------------------------------------------------------------------

/// Her PDF sayfası 16:9 bir slayta tam sayfa görsel olarak yerleşir.
pub(crate) fn write_pptx(path: &Path, images: &[SlideImage]) -> Result<(), String> {
    let images: Vec<&SlideImage> = images.iter().collect();
    let count = images.len().max(1);
    let mut overrides = String::new();
    let mut presentation_rels = String::from(
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"slideMasters/slideMaster1.xml\"/>",
    );
    let mut slide_ids = String::new();
    let mut package = Package::create(path)?;

    for index in 0..count {
        let slide_no = index + 1;
        overrides.push_str(&format!(
            "<Override PartName=\"/ppt/slides/slide{slide_no}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>"
        ));
        presentation_rels.push_str(&format!(
            "<Relationship Id=\"rId{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide{slide_no}.xml\"/>",
            slide_no + 1
        ));
        slide_ids.push_str(&format!(
            "<p:sldId id=\"{}\" r:id=\"rId{}\"/>",
            255 + slide_no,
            slide_no + 1
        ));
        let slide = match images.get(index) {
            Some(image) => {
                let slide_rels = format!(
                    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/image{slide_no}.jpeg\"/>\
</Relationships>"
                );
                package.add(
                    &format!("ppt/slides/_rels/slide{slide_no}.xml.rels"),
                    &slide_rels,
                )?;
                package.add_bytes(&format!("ppt/media/image{slide_no}.jpeg"), &image.bytes)?;
                slide_xml(image, slide_no)
            }
            None => empty_slide_xml(),
        };
        package.add(&format!("ppt/slides/slide{slide_no}.xml"), &slide)?;
    }

    overrides.push_str(
        "<Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/>\
<Override PartName=\"/ppt/slideMasters/slideMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml\"/>\
<Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml\"/>\
<Override PartName=\"/ppt/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>",
    );

    let content_types = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
<Default Extension=\"xml\" ContentType=\"application/xml\"/>\
<Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/>\
{overrides}</Types>"
    );
    let rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"ppt/presentation.xml\"/>\
</Relationships>";
    let presentation = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<p:presentation xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" \
xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" \
xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">\
<p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst>\
<p:sldIdLst>{slide_ids}</p:sldIdLst>\
<p:sldSz cx=\"12192000\" cy=\"6858000\" type=\"screen16x9\"/>\
<p:notesSz cx=\"6858000\" cy=\"9144000\"/></p:presentation>"
    );
    let presentation_rels = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{presentation_rels}</Relationships>"
    );
    let master = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<p:sldMaster xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" \
xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" \
xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">\
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>\
<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>\
</p:spTree></p:cSld>\
<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" \
accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>\
<p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rId1\"/></p:sldLayoutIdLst></p:sldMaster>";
    let master_rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/>\
<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"../theme/theme1.xml\"/>\
</Relationships>";
    let layout = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<p:sldLayout xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" \
xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" \
xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" type=\"blank\" preserve=\"1\">\
<p:cSld name=\"Blank\"><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>\
<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>\
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>";
    let layout_rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"../slideMasters/slideMaster1.xml\"/>\
</Relationships>";

    package.add("[Content_Types].xml", &content_types)?;
    package.add("_rels/.rels", rels)?;
    package.add("ppt/presentation.xml", &presentation)?;
    package.add("ppt/_rels/presentation.xml.rels", &presentation_rels)?;
    package.add("ppt/slideMasters/slideMaster1.xml", master)?;
    package.add(
        "ppt/slideMasters/_rels/slideMaster1.xml.rels",
        master_rels,
    )?;
    package.add("ppt/slideLayouts/slideLayout1.xml", layout)?;
    package.add(
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
        layout_rels,
    )?;
    package.add("ppt/theme/theme1.xml", THEME)?;
    package.finish()
}

/// Görselleri bir kez yaz. (Her slayt aynı görseli kullanmaz; sıra korunur.)
fn slide_xml(image: &SlideImage, slide_no: usize) -> String {
    let (cx, cy, x, y) = fit_image(image.width, image.height);
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<p:sld xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" \
xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" \
xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">\
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>\
<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>\
<p:pic><p:nvPicPr><p:cNvPr id=\"2\" name=\"Sayfa {slide_no}\"/><p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>\
<p:blipFill><a:blip r:embed=\"rId1\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>\
<p:spPr><a:xfrm><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm>\
<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld>\
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
    )
}

fn empty_slide_xml() -> String {
    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<p:sld xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" \
xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" \
xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">\
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>\
<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>\
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
        .to_string()
}

/// Görseli 16:9 slayta ortala; %94 güvenli alan.
fn fit_image(width: u32, height: u32) -> (u64, u64, u64, u64) {
    let slide_w: f64 = 12_192_000.0;
    let slide_h: f64 = 6_858_000.0;
    let max_w = slide_w * 0.94;
    let max_h = slide_h * 0.94;
    let (w, h) = if width == 0 || height == 0 {
        (max_w, max_h)
    } else {
        let scale = (max_w / width as f64).min(max_h / height as f64);
        (width as f64 * scale, height as f64 * scale)
    };
    let x = ((slide_w - w) / 2.0).round() as u64;
    let y = ((slide_h - h) / 2.0).round() as u64;
    (w.round() as u64, h.round() as u64, x, y)
}

const THEME: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"JointVault\">\
<a:themeElements>\
<a:clrScheme name=\"JointVault\">\
<a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1>\
<a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1>\
<a:dk2><a:srgbClr val=\"1C1C1E\"/></a:dk2><a:lt2><a:srgbClr val=\"F2F2F7\"/></a:lt2>\
<a:accent1><a:srgbClr val=\"0A84FF\"/></a:accent1><a:accent2><a:srgbClr val=\"30D158\"/></a:accent2>\
<a:accent3><a:srgbClr val=\"FF9F0A\"/></a:accent3><a:accent4><a:srgbClr val=\"FF453A\"/></a:accent4>\
<a:accent5><a:srgbClr val=\"BF5AF2\"/></a:accent5><a:accent6><a:srgbClr val=\"64D2FF\"/></a:accent6>\
<a:hlink><a:srgbClr val=\"0A84FF\"/></a:hlink><a:folHlink><a:srgbClr val=\"BF5AF2\"/></a:folHlink>\
</a:clrScheme>\
<a:fontScheme name=\"JointVault\"><a:majorFont><a:latin typeface=\"Inter\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:majorFont>\
<a:minorFont><a:latin typeface=\"Inter\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:minorFont></a:fontScheme>\
<a:fmtScheme name=\"JointVault\">\
<a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:fillStyleLst>\
<a:lnStyleLst><a:ln w=\"6350\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln><a:ln w=\"12700\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln><a:ln w=\"19050\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln></a:lnStyleLst>\
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>\
<a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:bgFillStyleLst>\
</a:fmtScheme></a:themeElements></a:theme>";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn column_names_roll_over_after_z() {
        assert_eq!(column_name(0), "A");
        assert_eq!(column_name(25), "Z");
        assert_eq!(column_name(26), "AA");
        assert_eq!(column_name(27), "AB");
    }

    #[test]
    fn cells_split_on_two_spaces_not_one() {
        assert_eq!(split_cells("ad soyad  şehir"), vec!["ad soyad", "şehir"]);
        assert_eq!(split_cells("a\tb\tc"), vec!["a", "b", "c"]);
    }

    #[test]
    fn xml_escape_removes_control_chars() {
        assert_eq!(xml_escape("a<&>\"'\u{0007}"), "a&lt;&amp;&gt;&quot;&apos;");
    }

    #[test]
    fn packages_are_valid_zip_archives() {
        let dir = std::env::temp_dir().join(format!(
            "jv-ooxml-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("test klasörü");

        let docx = dir.join("test.docx");
        write_docx(&docx, &[vec!["Birinci sayfa".into()], vec!["İkinci".into()]])
            .expect("docx");
        let xlsx = dir.join("test.xlsx");
        write_xlsx(&xlsx, &[vec!["a  b".into()], vec!["c\td".into()]]).expect("xlsx");

        let mut rgb = image::RgbImage::new(4, 3);
        for pixel in rgb.pixels_mut() {
            *pixel = image::Rgb([10, 20, 30]);
        }
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .encode_image(&rgb)
            .expect("jpeg");
        let pptx = dir.join("test.pptx");
        write_pptx(
            &pptx,
            &[SlideImage {
                bytes: jpeg,
                width: 4,
                height: 3,
            }],
        )
        .expect("pptx");

        for path in [&docx, &xlsx, &pptx] {
            let file = std::fs::File::open(path).expect("paket dosyası");
            let archive = zip::ZipArchive::new(file).expect("geçerli zip");
            assert!(archive.len() > 2, "{}: paket boş", path.display());
        }
        let file = std::fs::File::open(&docx).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        assert!(archive.by_name("word/document.xml").is_ok());
        let file = std::fs::File::open(&xlsx).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        assert!(archive.by_name("xl/worksheets/sheet1.xml").is_ok());
        let file = std::fs::File::open(&pptx).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        assert!(archive.by_name("ppt/slides/slide1.xml").is_ok());
        assert!(archive.by_name("ppt/media/image1.jpeg").is_ok());
        assert!(archive.by_name("ppt/theme/theme1.xml").is_ok());
        if std::env::var("JV_KEEP_OOXML").is_ok() {
            println!("OOXML fixtures: {}", dir.display());
        } else {
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}
