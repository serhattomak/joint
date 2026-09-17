use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrapedMedia {
    pub url: String,
    pub alt: Option<String>,
    pub media_type: String, // "image" | "video"
    pub caption: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrapedArticle {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub published_at: Option<String>,
    pub content_text: String,
    pub content_markdown: String,
    pub reading_time_mins: u32,
    pub lead_image: Option<String>,
    pub images: Vec<ScrapedMedia>,
    pub videos: Vec<ScrapedMedia>,
    pub site_name: Option<String>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 JointVault/1.0")
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scrape_item_content(url: String) -> Result<ScrapedArticle, String> {
    let raw_url = url.trim();
    if raw_url.is_empty() {
        return Err("Boş URL belirtildi.".to_string());
    }

    // Platform router
    if raw_url.contains("x.com") || raw_url.contains("twitter.com") {
        if let Some(article) = scrape_x_tweet(raw_url).await {
            return Ok(article);
        }
    } else if raw_url.contains("youtube.com") || raw_url.contains("youtu.be") {
        if let Some(article) = scrape_youtube_video(raw_url).await {
            return Ok(article);
        }
    }

    // General Web Scraper
    scrape_general_web(raw_url).await
}

// ---------------------------------------------------------------------------
// 1. X (Twitter) Scraper
// ---------------------------------------------------------------------------
async fn scrape_x_tweet(url: &str) -> Option<ScrapedArticle> {
    // Extract status ID
    let id_match = url.split("/status/").nth(1)?;
    let status_id = id_match.split(['?', '/', '#']).next()?;
    if status_id.is_empty() || !status_id.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }

    let c = client().ok()?;

    // First try fxtwitter API (public, no auth required, returns full media)
    let api_url = format!("https://api.fxtwitter.com/i/status/{}", status_id);
    if let Ok(res) = c.get(&api_url).send().await {
        if let Ok(data) = res.json::<serde_json::Value>().await {
            if let Some(tweet) = data.get("tweet") {
                let text = tweet.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let author_name = tweet.get("author").and_then(|a| a.get("name")).and_then(|v| v.as_str()).unwrap_or("X Kullanıcısı");
                let screen_name = tweet.get("author").and_then(|a| a.get("screen_name")).and_then(|v| v.as_str()).unwrap_or("");
                let author_full = format!("{} (@{})", author_name, screen_name);
                let created_at = tweet.get("created_at").and_then(|v| v.as_str()).map(|s| s.to_string());

                let mut images: Vec<ScrapedMedia> = Vec::new();
                let mut videos: Vec<ScrapedMedia> = Vec::new();
                let mut lead_image: Option<String> = None;

                if let Some(media_list) = tweet.get("media").and_then(|m| m.get("photos")).and_then(|v| v.as_array()) {
                    for m in media_list {
                        if let Some(src) = m.get("url").and_then(|v| v.as_str()) {
                            if lead_image.is_none() {
                                lead_image = Some(src.to_string());
                            }
                            images.push(ScrapedMedia {
                                url: src.to_string(),
                                alt: Some("Tweet Görseli".to_string()),
                                media_type: "image".to_string(),
                                caption: None,
                            });
                        }
                    }
                }

                if let Some(vid_list) = tweet.get("media").and_then(|m| m.get("videos")).and_then(|v| v.as_array()) {
                    for v in vid_list {
                        if let Some(src) = v.get("url").and_then(|v| v.as_str()) {
                            videos.push(ScrapedMedia {
                                url: src.to_string(),
                                alt: Some("Tweet Videosu".to_string()),
                                media_type: "video".to_string(),
                                caption: None,
                            });
                        }
                    }
                }

                let mut md = format!("### {}\n\n{}\n\n", author_full, text);
                for img in &images {
                    md.push_str(&format!("![Tweet Görseli]({})\n\n", img.url));
                }
                for vid in &videos {
                    md.push_str(&format!("[▶ Videoyu Aç]({})\n\n", vid.url));
                }

                return Some(ScrapedArticle {
                    url: url.to_string(),
                    title: Some(format!("Tweet - {}", author_name)),
                    description: Some(text.chars().take(200).collect()),
                    author: Some(author_full),
                    published_at: created_at,
                    content_text: format!("{}: {}", author_name, text),
                    content_markdown: md,
                    reading_time_mins: 1,
                    lead_image,
                    images,
                    videos,
                    site_name: Some("X (Twitter)".to_string()),
                });
            }
        }
    }

    // Fallback: Twitter oEmbed
    let oembed_url = format!("https://publish.twitter.com/oembed?url={}", url);
    if let Ok(res) = c.get(&oembed_url).send().await {
        if let Ok(data) = res.json::<serde_json::Value>().await {
            let author_name = data.get("author_name").and_then(|v| v.as_str()).unwrap_or("X Kullanıcısı");
            let html = data.get("html").and_then(|v| v.as_str()).unwrap_or("");
            let clean_text = clean_html_to_text(html);

            return Some(ScrapedArticle {
                url: url.to_string(),
                title: Some(format!("Tweet - {}", author_name)),
                description: Some(clean_text.chars().take(200).collect()),
                author: Some(author_name.to_string()),
                published_at: None,
                content_text: clean_text.clone(),
                content_markdown: format!("### {}\n\n{}", author_name, clean_text),
                reading_time_mins: 1,
                lead_image: None,
                images: Vec::new(),
                videos: Vec::new(),
                site_name: Some("X (Twitter)".to_string()),
            });
        }
    }

    None
}

// ---------------------------------------------------------------------------
// 2. YouTube Scraper
// ---------------------------------------------------------------------------
async fn scrape_youtube_video(url: &str) -> Option<ScrapedArticle> {
    let c = client().ok()?;
    let oembed_url = format!("https://www.youtube.com/oembed?url={}&format=json", url);
    let mut title: Option<String> = None;
    let mut author: Option<String> = None;
    let mut thumbnail: Option<String> = None;

    if let Ok(res) = c.get(&oembed_url).send().await {
        if let Ok(data) = res.json::<serde_json::Value>().await {
            title = data.get("title").and_then(|v| v.as_str()).map(|s| s.to_string());
            author = data.get("author_name").and_then(|v| v.as_str()).map(|s| s.to_string());
            thumbnail = data.get("thumbnail_url").and_then(|v| v.as_str()).map(|s| s.to_string());
        }
    }

    let t = title.unwrap_or_else(|| "YouTube Videosu".to_string());
    let a = author.unwrap_or_else(|| "YouTube Kanalı".to_string());

    let md = format!(
        "# {}\n\n**Yayıncı:** {}\n\n{}\n\n[▶ YouTube'da İzle]({})\n",
        t,
        a,
        thumbnail.as_ref().map(|th| format!("![Kapak Resmi]({})\n", th)).unwrap_or_default(),
        url
    );

    let mut images = Vec::new();
    if let Some(ref thumb) = thumbnail {
        images.push(ScrapedMedia {
            url: thumb.clone(),
            alt: Some(t.clone()),
            media_type: "image".to_string(),
            caption: Some("Video Önizleme Görseli".to_string()),
        });
    }

    let mut videos = Vec::new();
    videos.push(ScrapedMedia {
        url: url.to_string(),
        alt: Some(t.clone()),
        media_type: "video".to_string(),
        caption: Some(t.clone()),
    });

    Some(ScrapedArticle {
        url: url.to_string(),
        title: Some(t.clone()),
        description: Some(format!("{} tarafından yayınlanan YouTube videosu.", a)),
        author: Some(a),
        published_at: None,
        content_text: format!("{}: {}", t, url),
        content_markdown: md,
        reading_time_mins: 1,
        lead_image: thumbnail,
        images,
        videos,
        site_name: Some("YouTube".to_string()),
    })
}

// ---------------------------------------------------------------------------
// 3. General Web Article & Content Scraper
// ---------------------------------------------------------------------------
async fn scrape_general_web(url: &str) -> Result<ScrapedArticle, String> {
    let c = client()?;
    let res = c.get(url).send().await.map_err(|e| format!("Sayfa getirilemedi: {e}"))?;
    let final_url = res.url().to_string();
    let html = res.text().await.map_err(|e| format!("HTML okunamadı: {e}"))?;

    let parsed = parse_html_article(&html, &final_url);
    Ok(parsed)
}

fn parse_html_article(html: &str, page_url: &str) -> ScrapedArticle {
    // 1. Meta bilgileri çıkar
    let head = extract_tag_slice(html, "head").unwrap_or_else(|| &html[..html.len().min(4000)]);
    
    let mut title = meta_prop(head, "og:title")
        .or_else(|| meta_prop(head, "twitter:title"))
        .or_else(|| extract_tag_content(head, "title"));

    let description = meta_prop(head, "og:description")
        .or_else(|| meta_prop(head, "twitter:description"))
        .or_else(|| meta_prop(head, "description"));

    let author = meta_prop(head, "author")
        .or_else(|| meta_prop(head, "article:author"))
        .or_else(|| meta_prop(head, "twitter:creator"));

    let published_at = meta_prop(head, "article:published_time")
        .or_else(|| meta_prop(head, "og:pubdate"))
        .or_else(|| meta_prop(head, "date"));

    let mut lead_image = meta_prop(head, "og:image")
        .or_else(|| meta_prop(head, "twitter:image"))
        .map(|src| resolve_url(page_url, &src));

    let site_name = meta_prop(head, "og:site_name");

    // 2. Sayfa gövdesi içindeki ana içeriği (<article>, <main> veya <body>) bul
    let body_html = extract_tag_slice(html, "body").unwrap_or(html);
    let content_zone = extract_tag_slice(body_html, "article")
        .or_else(|| extract_tag_slice(body_html, "main"))
        .unwrap_or(body_html);

    // 3. İçerikten gürültüleri filtreleyip paragrafları, başlıkları ve görselleri topla
    let (content_text, content_markdown, images, videos) = extract_readable_blocks(content_zone, page_url);

    if lead_image.is_none() && !images.is_empty() {
        lead_image = Some(images[0].url.clone());
    }

    if title.is_none() {
        // İlk h1 başlığını dene
        title = extract_tag_content(body_html, "h1");
    }

    let word_count = content_text.split_whitespace().count();
    let reading_time_mins = (word_count / 200).max(1) as u32;

    ScrapedArticle {
        url: page_url.to_string(),
        title,
        description,
        author,
        published_at,
        content_text,
        content_markdown,
        reading_time_mins,
        lead_image,
        images,
        videos,
        site_name,
    }
}

// ---------------------------------------------------------------------------
// HTML Ayrıştırma & Temizleme Yardımcıları
// ---------------------------------------------------------------------------
fn extract_tag_slice<'a>(html: &'a str, tag: &str) -> Option<&'a str> {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);

    let start_idx = lower.find(&open)?;
    let start_tag_end = lower[start_idx..].find('>')? + start_idx + 1;
    let end_idx = lower[start_tag_end..].find(&close).map(|i| start_tag_end + i).unwrap_or(html.len());

    Some(&html[start_tag_end..end_idx])
}

fn extract_tag_content(html: &str, tag: &str) -> Option<String> {
    let slice = extract_tag_slice(html, tag)?;
    let cleaned = clean_html_to_text(slice);
    if cleaned.trim().is_empty() {
        None
    } else {
        Some(cleaned.trim().to_string())
    }
}

fn meta_prop(head: &str, prop: &str) -> Option<String> {
    let lower = head.to_ascii_lowercase();
    let prop_lower = prop.to_ascii_lowercase();
    let mut rest = lower.as_str();

    while let Some(i) = rest.find("<meta") {
        let abs = lower.len() - rest.len() + i;
        let tag_end = rest[i..].find('>').map(|j| abs + j + 1).unwrap_or(head.len());
        let tag_str = &head[abs..tag_end.min(head.len())];
        let tag_str_lower = &lower[abs..tag_end.min(head.len())];

        if tag_str_lower.contains(&prop_lower) {
            // Find content attribute value
            if let Some(val) = extract_attribute_value(tag_str, "content") {
                if !val.trim().is_empty() {
                    return Some(decode_html_entities(val.trim()));
                }
            }
        }
        rest = &rest[i + 5..];
    }
    None
}

fn extract_attribute_value(tag: &str, attr_name: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let attr_key = format!("{}=", attr_name.to_ascii_lowercase());
    let pos = lower.find(&attr_key)?;
    let after = tag[pos + attr_key.len()..].trim_start();

    let mut chars = after.chars();
    let quote = chars.next()?;
    if quote == '"' || quote == '\'' {
        let end = after[1..].find(quote)?;
        Some(after[1..1 + end].to_string())
    } else {
        let end = after.find(|c: char| c.is_whitespace() || c == '>').unwrap_or(after.len());
        Some(after[..end].to_string())
    }
}

fn extract_readable_blocks(html: &str, base_url: &str) -> (String, String, Vec<ScrapedMedia>, Vec<ScrapedMedia>) {
    let mut text_buf = String::new();
    let mut md_buf = String::new();
    let mut images: Vec<ScrapedMedia> = Vec::new();
    let mut videos: Vec<ScrapedMedia> = Vec::new();

    // Remove noise scripts, styles, navigations, footers, headers
    let cleaned_html = strip_tags_and_content(html, &[
        "script", "style", "svg", "nav", "footer", "header", "noscript", "form", "aside", "dialog", "iframe"
    ]);

    // Also look for video/iframe embeds in original html
    extract_embedded_videos(html, base_url, &mut videos);

    // Extract images with attributes
    extract_images_from_html(html, base_url, &mut images);

    // Block-level extraction: paragraphs, headings, list items
    let mut pos = 0;
    let lower = cleaned_html.to_ascii_lowercase();

    while pos < cleaned_html.len() {
        if let Some(open_rel) = lower[pos..].find('<') {
            let open = pos + open_rel;
            let close = match lower[open..].find('>') {
                Some(c) => open + c,
                None => break,
            };

            let tag_str = &lower[open + 1..close];
            let tag_name = tag_str.split_whitespace().next().unwrap_or("").trim_start_matches('/');

            let is_heading = tag_name.starts_with('h') && tag_name.len() == 2 && tag_name.chars().nth(1).unwrap_or(' ').is_ascii_digit();
            let is_block = matches!(tag_name, "p" | "blockquote" | "pre" | "li" | "div") || is_heading;

            if is_block && !tag_str.starts_with('/') {
                let end_tag = format!("</{}>", tag_name);
                if let Some(end_rel) = lower[close + 1..].find(&end_tag) {
                    let block_end = close + 1 + end_rel;
                    let inner_html = &cleaned_html[close + 1..block_end];
                    let text = clean_html_to_text(inner_html);

                    if !text.trim().is_empty() && text.trim().len() > 3 {
                        let t = text.trim();
                        text_buf.push_str(t);
                        text_buf.push_str("\n\n");

                        if is_heading {
                            let level = tag_name.chars().nth(1).unwrap_or('2');
                            let hashes = match level {
                                '1' => "#",
                                '2' => "##",
                                '3' => "###",
                                _ => "####",
                            };
                            md_buf.push_str(&format!("{} {}\n\n", hashes, t));
                        } else if tag_name == "blockquote" {
                            md_buf.push_str(&format!("> {}\n\n", t));
                        } else if tag_name == "li" {
                            md_buf.push_str(&format!("- {}\n", t));
                        } else {
                            md_buf.push_str(&format!("{}\n\n", t));
                        }
                    }
                    pos = block_end + end_tag.len();
                    continue;
                }
            }
            pos = close + 1;
        } else {
            break;
        }
    }

    if text_buf.trim().is_empty() {
        // Fallback: clean all text from the zone
        let all_text = clean_html_to_text(&cleaned_html);
        text_buf = all_text.clone();
        md_buf = all_text;
    }

    (text_buf.trim().to_string(), md_buf.trim().to_string(), images, videos)
}

fn extract_images_from_html(html: &str, base_url: &str, out: &mut Vec<ScrapedMedia>) {
    let lower = html.to_ascii_lowercase();
    let mut pos = 0;
    let mut seen = std::collections::HashSet::new();

    while let Some(rel) = lower[pos..].find("<img") {
        let open = pos + rel;
        let close = match lower[open..].find('>') {
            Some(c) => open + c,
            None => break,
        };
        let tag = &html[open..=close];

        let src = extract_attribute_value(tag, "src")
            .or_else(|| extract_attribute_value(tag, "data-src"))
            .or_else(|| extract_attribute_value(tag, "data-original"));

        if let Some(raw_src) = src {
            if !raw_src.is_empty() && !raw_src.starts_with("data:image/svg") {
                let resolved = resolve_url(base_url, &raw_src);
                // Filter out tiny tracker images or spacers
                if !resolved.contains("spacer") && !resolved.contains("1x1") && !seen.contains(&resolved) {
                    seen.insert(resolved.clone());
                    let alt = extract_attribute_value(tag, "alt");
                    let mut caption = extract_attribute_value(tag, "title");
                    
                    // Also check for surrounding/following <figcaption>
                    if caption.is_none() {
                        let check_window = &html[close + 1..html.len().min(close + 400)];
                        let lower_win = check_window.to_ascii_lowercase();
                        if let Some(fig_rel) = lower_win.find("<figcaption") {
                            if let Some(fig_open_end) = lower_win[fig_rel..].find('>') {
                                let content_start = fig_rel + fig_open_end + 1;
                                if let Some(fig_close_rel) = lower_win[content_start..].find("</figcaption>") {
                                    let inner = &check_window[content_start..content_start + fig_close_rel];
                                    let cleaned = clean_html_to_text(inner);
                                    if !cleaned.trim().is_empty() {
                                        caption = Some(cleaned.trim().to_string());
                                    }
                                }
                            }
                        }
                    }

                    out.push(ScrapedMedia {
                        url: resolved,
                        alt,
                        media_type: "image".to_string(),
                        caption,
                    });
                }
            }
        }
        pos = close + 1;
    }
}

fn extract_embedded_videos(html: &str, base_url: &str, out: &mut Vec<ScrapedMedia>) {
    let lower = html.to_ascii_lowercase();
    let mut pos = 0;
    let mut seen = std::collections::HashSet::new();

    // Check <video src="...">
    while let Some(rel) = lower[pos..].find("<video") {
        let open = pos + rel;
        let close = match lower[open..].find('>') {
            Some(c) => open + c,
            None => break,
        };
        let tag = &html[open..=close];
        if let Some(src) = extract_attribute_value(tag, "src") {
            let resolved = resolve_url(base_url, &src);
            if !seen.contains(&resolved) {
                seen.insert(resolved.clone());
                out.push(ScrapedMedia {
                    url: resolved,
                    alt: Some("Video".to_string()),
                    media_type: "video".to_string(),
                    caption: None,
                });
            }
        }
        pos = close + 1;
    }

    // Check <iframe src="..."> for youtube / vimeo
    pos = 0;
    while let Some(rel) = lower[pos..].find("<iframe") {
        let open = pos + rel;
        let close = match lower[open..].find('>') {
            Some(c) => open + c,
            None => break,
        };
        let tag = &html[open..=close];
        if let Some(src) = extract_attribute_value(tag, "src") {
            if src.contains("youtube.com") || src.contains("youtu.be") || src.contains("vimeo.com") {
                let resolved = resolve_url(base_url, &src);
                if !seen.contains(&resolved) {
                    seen.insert(resolved.clone());
                    out.push(ScrapedMedia {
                        url: resolved,
                        alt: Some("Gömülü Video".to_string()),
                        media_type: "video".to_string(),
                        caption: extract_attribute_value(tag, "title"),
                    });
                }
            }
        }
        pos = close + 1;
    }
}

fn strip_tags_and_content(html: &str, tags_to_strip: &[&str]) -> String {
    let mut result = html.to_string();
    for tag in tags_to_strip {
        let open_pat = format!("<{}", tag);
        let close_pat = format!("</{}>", tag);

        loop {
            let lower = result.to_ascii_lowercase();
            if let Some(start) = lower.find(&open_pat) {
                let end = match lower[start..].find(&close_pat) {
                    Some(c) => start + c + close_pat.len(),
                    None => {
                        // Tag doesn't have closing tag, find next '>'
                        match lower[start..].find('>') {
                            Some(g) => start + g + 1,
                            None => result.len(),
                        }
                    }
                };
                result.replace_range(start..end.min(result.len()), " ");
            } else {
                break;
            }
        }
    }
    result
}

fn clean_html_to_text(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;

    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' {
            in_tag = false;
            out.push(' ');
        } else if !in_tag {
            out.push(ch);
        }
    }

    let decoded = decode_html_entities(&out);
    let mut collapsed = String::new();
    let mut prev_space = false;

    for ch in decoded.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                collapsed.push(' ');
                prev_space = true;
            }
        } else {
            collapsed.push(ch);
            prev_space = false;
        }
    }

    collapsed.trim().to_string()
}

fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .replace("&#x27;", "'")
        .replace("&#x2F;", "/")
}

fn resolve_url(page: &str, src: &str) -> String {
    let s = src.trim();
    if s.starts_with("http://") || s.starts_with("https://") || s.starts_with("data:") {
        return s.to_string();
    }
    if s.starts_with("//") {
        let scheme = if page.starts_with("https") { "https:" } else { "http:" };
        return format!("{}{}", scheme, s);
    }
    let base = page.split('?').next().unwrap_or(page);
    let origin_end = base
        .find("://")
        .map(|i| base[i + 3..].find('/').map(|j| i + 3 + j).unwrap_or(base.len()))
        .unwrap_or(0);
    let origin = &base[..origin_end];

    if s.starts_with('/') {
        return format!("{}{}", origin, s);
    }
    let dir = base.rfind('/').map(|i| &base[..i + 1]).unwrap_or(base);
    format!("{}{}", dir, s)
}

// ---------------------------------------------------------------------------
// 4. Offline Görsel İndirme Komutu
// ---------------------------------------------------------------------------
#[tauri::command]
pub async fn cache_article_images(
    app: AppHandle,
    item_id: String,
    urls: Vec<String>,
) -> Result<Vec<String>, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("article_cache")
        .join(&item_id);

    std::fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;
    let c = client()?;
    let mut saved_paths = Vec::new();

    for (idx, u) in urls.iter().enumerate() {
        if u.starts_with("data:") {
            continue;
        }
        let ext = if u.contains(".png") {
            "png"
        } else if u.contains(".webp") {
            "webp"
        } else if u.contains(".gif") {
            "gif"
        } else {
            "jpg"
        };
        let filename = format!("img_{:03}.{}", idx + 1, ext);
        let dest = base_dir.join(&filename);

        if dest.exists() {
            saved_paths.push(dest.to_string_lossy().to_string());
            continue;
        }

        if let Ok(res) = c.get(u).send().await {
            if let Ok(bytes) = res.bytes().await {
                if std::fs::write(&dest, bytes).is_ok() {
                    saved_paths.push(dest.to_string_lossy().to_string());
                }
            }
        }
    }

    Ok(saved_paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_html_article() {
        let sample_html = r#"
            <!DOCTYPE html>
            <html lang="tr">
            <head>
                <meta charset="utf-8">
                <title>Yapay Zeka ve Gelecek - TechBlog</title>
                <meta property="og:title" content="Yapay Zeka ve Geleceğin Teknolojileri">
                <meta property="og:description" content="Yapay zeka modellerinin gelecekteki etkilerini inceliyoruz.">
                <meta property="og:image" content="https://example.com/lead.jpg">
                <meta property="og:site_name" content="TechBlog">
                <meta name="author" content="Ahmet Yılmaz">
                <meta property="article:published_time" content="2026-09-17T12:00:00Z">
            </head>
            <body>
                <header>
                    <nav><a href="/">Ana Sayfa</a></nav>
                </header>
                <main>
                    <article>
                        <h1>Yapay Zeka Devrimi</h1>
                        <p>Yapay zeka sistemleri gün geçtikçe daha da güçleniyor ve günlük hayatımızın bir parçası haline geliyor.</p>
                        <figure>
                            <img src="/images/ai-chips.png" alt="Yapay Zeka Çipleri">
                            <figcaption>Yeni nesil AI donanımları</figcaption>
                        </figure>
                        <h2>Gelişmiş Dil Modelleri</h2>
                        <p>Büyük dil modelleri metin üretimi, kod yazımı ve muhakeme yetenekleriyle dikkat çekmektedir.</p>
                        <blockquote>"Gelecek, yapay zekayı anlayan ve onunla iş birliği yapanların olacaktır."</blockquote>
                    </article>
                </main>
                <footer>
                    <p>&copy; 2026 TechBlog</p>
                </footer>
            </body>
            </html>
        "#;

        let article = parse_html_article(sample_html, "https://example.com/posts/ai-future");

        assert_eq!(article.title.as_deref(), Some("Yapay Zeka ve Geleceğin Teknolojileri"));
        assert_eq!(article.site_name.as_deref(), Some("TechBlog"));
        assert_eq!(article.author.as_deref(), Some("Ahmet Yılmaz"));
        assert_eq!(article.lead_image.as_deref(), Some("https://example.com/lead.jpg"));
        assert!(article.content_text.contains("Yapay zeka sistemleri gün geçtikçe"));
        assert!(article.content_text.contains("Büyük dil modelleri"));
        assert!(article.content_markdown.contains("# Yapay Zeka Devrimi"));
        assert!(article.content_markdown.contains("## Gelişmiş Dil Modelleri"));
        assert!(article.content_markdown.contains("> \"Gelecek, yapay zekayı anlayan"));
        
        // Görsel doğru çözümlendi mi? (relatif path /images/ai-chips.png -> https://example.com/images/ai-chips.png)
        assert_eq!(article.images.len(), 1);
        assert_eq!(article.images[0].url, "https://example.com/images/ai-chips.png");
        assert_eq!(article.images[0].alt.as_deref(), Some("Yapay Zeka Çipleri"));
        assert_eq!(article.images[0].caption.as_deref(), Some("Yeni nesil AI donanımları"));
    }

    #[test]
    fn test_decode_entities_and_clean() {
        let dirty = "&quot;Merhaba &amp; D&uuml;nya&#39;ya ho&#x15f; geldiniz!&quot;";
        let clean = decode_html_entities(dirty);
        assert!(clean.contains("\"Merhaba & D&uuml;nya'ya ho&#x15f; geldiniz!\""));
    }

    #[test]
    fn test_clean_html_to_text() {
        let html_snippet = "<p>Bu bir <strong>kalın</strong> ve <em>italik</em> metindir.</p>";
        let stripped = clean_html_to_text(html_snippet);
        assert_eq!(stripped, "Bu bir kalın ve italik metindir.");
    }

    #[tokio::test]
    async fn test_live_scrape_youtube() {
        let res = scrape_youtube_video("https://www.youtube.com/watch?v=dQw4w9WgXcQ").await;
        if let Some(art) = res {
            println!("YouTube title: {:?}", art.title);
            assert!(art.title.is_some());
            assert_eq!(art.site_name.as_deref(), Some("YouTube"));
            assert!(!art.content_markdown.is_empty());
        }
    }

    #[tokio::test]
    async fn test_live_scrape_tweet() {
        let res = scrape_x_tweet("https://x.com/rustlang/status/1783857321528627341").await;
        if let Some(art) = res {
            println!("Tweet text: {}", art.content_text);
            assert!(!art.content_text.is_empty());
            assert_eq!(art.site_name.as_deref(), Some("X (Twitter)"));
        }
    }
}


