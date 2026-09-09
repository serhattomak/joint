use serde::Serialize;

#[derive(Serialize)]
pub struct Preview {
    title: Option<String>,
    thumbnail: Option<String>,
    site: Option<String>,
}

#[tauri::command]
pub async fn fetch_preview(url: String) -> Result<Preview, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let html = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) JointVault/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let head = head_slice(&html);
    let mut title = meta_content(head, "og:title");
    if title.is_none() {
        title = tag_content(head, "title");
    }
    let mut thumbnail = meta_content(head, "og:image");
    if let Some(src) = thumbnail.take() {
        thumbnail = Some(resolve_url(&url, &src));
    }
    let site = meta_content(head, "og:site_name");
    Ok(Preview { title, thumbnail, site })
}

// ponytail: naive string scan, no HTML parser crate; breaks on malformed markup — add a parser if misparses appear.
fn head_slice(html: &str) -> &str {
    let lower = html.to_ascii_lowercase();
    let end = lower.find("</head>").map(|i| i + 7).unwrap_or(html.len());
    &html[..end.min(html.len())]
}

fn meta_content(head: &str, prop: &str) -> Option<String> {
    let lower = head.to_ascii_lowercase();
    let mut rest = lower.as_str();
    let head_bytes = head.as_bytes();
    while let Some(i) = rest.find("<meta") {
        let abs = lower.len() - rest.len() + i;
        let tag_end = rest[i..].find('>').map(|j| abs + j + 1).unwrap_or(head.len());
        let tag = &lower[abs..tag_end.min(head.len())];
        if tag.contains(prop) && (tag.contains("property") || tag.contains("name")) {
            if let Some(v) = attr_value(&head_bytes[abs..tag_end.min(head.len())]) {
                return Some(v);
            }
        }
        rest = &rest[i + 5..];
    }
    None
}

fn attr_value(tag: &[u8]) -> Option<String> {
    let tag = std::str::from_utf8(tag).ok()?;
    let lower = tag.to_ascii_lowercase();
    let mut rest = lower.as_str();
    while let Some(i) = rest.find("content") {
        let abs = lower.len() - rest.len() + i + 7;
        let after = tag[abs..].trim_start_matches(|c: char| c == '=' || c.is_whitespace());
        let mut chars = after.chars();
        let quote = chars.next()?;
        if quote != '"' && quote != '\'' {
            rest = &rest[i + 7..];
            continue;
        }
        let end = after[1..].find(quote)?;
        let value = after[1..1 + end].trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
        rest = &rest[i + 7..];
    }
    None
}

fn tag_content(head: &str, tag: &str) -> Option<String> {
    let lower = head.to_ascii_lowercase();
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start = lower.find(&open)? + open.len();
    let content_start = lower[start..].find('>')? + start + 1;
    let end = lower[content_start..].find(&close)? + content_start;
    let value = head[content_start..end].trim();
    if value.is_empty() { None } else { Some(value.to_string()) }
}

fn resolve_url(page: &str, src: &str) -> String {
    if src.starts_with("http://") || src.starts_with("https://") || src.starts_with("data:") {
        return src.to_string();
    }
    let base = page.split('?').next().unwrap_or(page);
    let origin_end = base.find("://").map(|i| base[i + 3..].find('/').map(|j| i + 3 + j).unwrap_or(base.len())).unwrap_or(0);
    let origin = &base[..origin_end];
    if src.starts_with("//") {
        let scheme = if base.starts_with("https") { "https:" } else { "http:" };
        return format!("{}{}", scheme, src);
    }
    if src.starts_with('/') {
        return format!("{}{}", origin, src);
    }
    let dir = base.rfind('/').map(|i| &base[..i + 1]).unwrap_or(base);
    format!("{}{}", dir, src)
}
