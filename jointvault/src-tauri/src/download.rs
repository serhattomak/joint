use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

// Sequential queue: one active download. A second call blocks on `lock()`
// until the running one finishes; the frontend marks that item `queued` at
// invoke time and flips it to `active` on the first progress event below.
// ponytail: tauri re-exports tokio's Mutex, so no extra tokio features needed.
pub(crate) static QUEUE: tauri::async_runtime::Mutex<()> = tauri::async_runtime::Mutex::const_new(());

#[derive(Clone, serde::Serialize)]
struct ProgressPayload {
    #[serde(rename = "itemId")]
    item_id: String,
    percent: f64,
    speed: Option<String>,
    eta: Option<String>,
}

// "[download] 12.3% of 45MiB at 1.2MiB/s ETA 00:30" — yüzde+hız+süre,
// hepsi char-scan (regex yok). Hız/ETA yoksa None.
fn parse_progress(line: &str) -> Option<(f64, Option<String>, Option<String>)> {
    let pct = line.find('%')?;
    let digits: String = line[..pct]
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if digits.is_empty() {
        return None;
    }
    let percent: f64 = digits.parse().ok()?;
    let rest = &line[pct + 1..];
    let speed = rest.find("at ").map(|i| {
        let s = rest[i + 3..].trim();
        let end = s.find("ETA").map(|j| j).unwrap_or(s.len());
        s[..end].trim().to_string()
    }).filter(|s| !s.is_empty() && *s != "Unknown");
    let eta = rest.find("ETA").map(|i| rest[i + 3..].trim().to_string()).filter(|s| !s.is_empty());
    Some((percent, speed, eta))
}

// yt-dlp, --ffmpeg-location dizininde DÜZ adlı ffmpeg.exe/ffprobe.exe arar;
// triple-suffixed sidecar adını GÖRMEZ. Bu yüzden ilk indirmede <indirme>/.tools
// altına düz adlarla kopyalanır (tek seferlik; sonraki çağrılar hızlı yolu kullanır).
//
// Kaynak artık kayıttan gelir (`components::require_tool`): **indirilenler
// (components/) → gömülü sidecar**. Böylece Ayarlar'dan indirilen ffmpeg de
// yt-dlp'ye görünür hâle gelir. Eski "exe yanı → CARGO_MANIFEST_DIR/binaries"
// varsayımı ve triple ad bilgisi burada TUTULMAZ: gömülü yol artıklarını
// `bundled_path` zaten hem `<ad>.exe` hem `<ad>-*.exe` biçiminde tarar.
fn ensure_ffmpeg_tools(
    app: &AppHandle,
    download_dir: &std::path::Path,
) -> Result<std::path::PathBuf, String> {
    let tools = download_dir.join(".tools");
    // İdempotent hızlı yol: iki düz ad da duruyorsa yeniden kopyalama.
    if tools.join("ffmpeg.exe").exists() && tools.join("ffprobe.exe").exists() {
        return Ok(tools);
    }
    // Eksik araç yapılandırılmış sinyal üretir (BILESEN_EKSIK:<id>); ham OS
    // hatası ya da teknik bir "sidecar yok" metni kullanıcıya çıkmaz.
    let ffmpeg = crate::components::require_tool(app, "ffmpeg")?;
    let ffprobe = crate::components::require_tool(app, "ffprobe")?;
    std::fs::create_dir_all(&tools).map_err(|e| e.to_string())?;
    std::fs::copy(ffmpeg, tools.join("ffmpeg.exe")).map_err(|e| e.to_string())?;
    std::fs::copy(ffprobe, tools.join("ffprobe.exe")).map_err(|e| e.to_string())?;
    Ok(tools)
}
fn push_capped(buf: &mut String, chunk: &str) {
    buf.push_str(chunk);
    if buf.len() > 500 {
        let mut cut = buf.len() - 500;
        while !buf.is_char_boundary(cut) {
            cut += 1;
        }
        buf.drain(..cut);
    }
}

fn emit_progress(app: &AppHandle, item_id: &str, percent: f64, speed: Option<String>, eta: Option<String>) {
    let _ = app.emit(
        "download-progress",
        ProgressPayload {
            item_id: item_id.to_string(),
            percent,
            speed,
            eta,
        },
    );
}

#[tauri::command]
pub async fn download_media(app: AppHandle, payload: serde_json::Value) -> Result<String, String> {
    // Kapı: işe başlamadan yt-dlp'yi kayıttan çöz (indirilen → gömülü). Eksikse
    // `BILESEN_EKSIK:yt-dlp` hemen döner; kuyruk kilidi, progress olayı ya da
    // yarım klasör gibi kısmi yan etki oluşmaz. NOT: yt-dlp PAKETLE gömülü gelir
    // (kayıtta `download: None` → `downloadable=false`). Buradaki değişiklik
    // yalnızca ÇÖZÜMLEME biçimidir; yt-dlp'ye indirme kaynağı EKLEMEYİN.
    let yt_dlp = crate::components::require_tool(&app, "yt-dlp")?;
    // ponytail: iki anahtar da kabul edilir (istemci sürüm kaymalarına karşı).
    let get = |keys: &[&str]| -> Result<String, String> {
        keys.iter()
            .filter_map(|k| payload.get(k))
            .filter_map(|v| v.as_str())
            .next()
            .map(|s| s.to_string())
            .ok_or_else(|| format!("missing required key {}", keys[0]))
    };
    let item_id = get(&["item_id", "itemId"])?;
    let url = get(&["url"])?;
    let kind = get(&["kind"])?;
    // Yoksa 720p: eski istemciler quality göndermez.
    let quality = payload
        .get("quality")
        .and_then(|v| v.as_str())
        .unwrap_or("720");
    let height: u32 = match quality {
        "360" | "480" | "720" | "1080" | "1440" | "2160" => quality.parse().unwrap_or(720),
        _ => 720,
    };
    // format_id varsa preset'i ezer (FormatDialog gerçek seçenek sunar).
    let format_id = payload.get("format_id").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let format = match kind.as_str() {
        "video" => match format_id {
            Some(id) => format!("{id}+ba/b"),
            None => format!("bv*[height<={height}]+ba/b[height<={height}]/b"),
        },
        "audio" => match format_id {
            Some(id) => id.to_string(),
            None => "ba[ext=m4a]/ba".to_string(),
        },
        _ => return Err("kind must be \"video\" or \"audio\"".to_string()),
    };
    /* Klasörün TEK kaynağı Ayarlar'dır (download_dir.txt). Buradaki eski yerel
       kopya {Downloads}/JointVault'a sabitlenmişti ve kullanıcının seçimini yok
       sayıyordu — yani ayar ekranda görünüyor ama indirmeyi etkilemiyordu. */
    let dir = std::path::PathBuf::from(crate::settings::get_download_dir(app.clone())?);
    let subfolder = payload
        .get("subfolder")
        .or_else(|| payload.get("platform"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let target_dir = match subfolder {
        Some(sub) => {
            let p = dir.join(sub);
            let _ = std::fs::create_dir_all(&p);
            p
        }
        None => dir.clone(),
    };
    // Forward slashes: yt-dlp output templates treat backslash as escape.
    let template = format!(
        "{}/%(title).100s [%(id)s].%(ext)s",
        target_dir.to_string_lossy().replace('\\', "/")
    );

    let _guard = QUEUE.lock().await;
    emit_progress(&app, &item_id, 0.0, None, None);

    let mut args: Vec<String> = vec![
        "--newline".to_string(),
        "--progress".to_string(),
        "--no-playlist".to_string(),
        "--print".to_string(),
        "after_move:filepath".to_string(),
        "-f".to_string(),
        format,
        "-o".to_string(),
        template,
    ];
    let cookies_txt = app.path().app_data_dir().ok().map(|d| d.join("cookies.txt")).filter(|p| p.exists());
    if let Some(cookie_file) = cookies_txt {
        args.push("--cookies".to_string());
        args.push(cookie_file.to_string_lossy().to_string());
    } else if let Some(browser) = payload
        .get("cookies_from_browser")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        args.push("--cookies-from-browser".to_string());
        args.push(browser.to_string());
    }
    if kind == "video" {
        args.push("--merge-output-format".to_string());
        args.push("mp4".to_string());
    }
    // Birleştirme HARİÇ indirme yok: araçlar hazır değilse dürüst hata ver.
    let tools = ensure_ffmpeg_tools(&app, &dir)?;
    args.push("--ffmpeg-location".to_string());
    args.push(tools.to_string_lossy().replace('\\', "/"));
    args.push(url);
    run_sidecar(&app, &item_id, &yt_dlp, args).await
}

// `yt_dlp` çağrı yerinde `components::require_tool` ile çözülür (bkz.
// `download_media` başındaki kapı). Buraya hazır YOL gelir; eski sidecar
// çözümlemesi yalnızca exe yanına bakabildiği için indirilen/gömülü ayrımını
// göremezdi. yt-dlp gömülü kaldığından `downloadable` hâlâ false'tur: yalnızca
// çözümleme yolu değişti.
async fn run_sidecar(
    app: &AppHandle,
    item_id: &str,
    yt_dlp: &std::path::Path,
    args: Vec<String>,
) -> Result<String, String> {
    let (mut rx, _child) = app
        .shell()
        .command(yt_dlp.to_string_lossy().to_string())
        .args(args)
        .spawn()
        .map_err(|e| e.to_string())?;

    let mut last_err = String::new();
    let mut candidate: Option<String> = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                let text = String::from_utf8_lossy(&line);
                for part in text.split(['\n', '\r']) {
                    let t = part.trim();
                    // Final yol satırı: '%' yok, mutlak yol gibi başlar; SONuncusu tutulur.
                    if !t.is_empty()
                        && !t.contains('%')
                        && (t.starts_with('/')
                            || (t.len() >= 3
                                && t.as_bytes()[0].is_ascii_alphabetic()
                                && t.as_bytes()[1] == b':'
                                && (t.as_bytes()[2] == b'\\' || t.as_bytes()[2] == b'/')))
                    {
                        candidate = Some(t.to_string());
                    }
                    if let Some((p, s, e)) = parse_progress(part) {
                        emit_progress(&app, &item_id, p, s, e);
                    }
                }
            }
            CommandEvent::Stderr(line) => {
                push_capped(&mut last_err, &String::from_utf8_lossy(&line));
            }
            CommandEvent::Error(e) => push_capped(&mut last_err, &e),
            CommandEvent::Terminated(payload) => {
                if payload.code == Some(0) {
                    if let Some(path) = candidate {
                        if std::path::Path::new(&path).exists() {
                            return Ok(path);
                        }
                    }
                    // fallback: final yol yakalanamadıysa eski davranış
                    return Ok("done".to_string());
                }
                if last_err.trim().is_empty() {
                    last_err = match payload.code {
                        Some(code) => format!("yt-dlp exited with code {code}"),
                        None => format!("yt-dlp terminated (signal {:?})", payload.signal),
                    };
                }
                return Err(last_err);
            }
            _ => {}
        }
    }
    Err("yt-dlp ended without an exit status".to_string())
}

#[derive(Clone, serde::Serialize)]
pub struct FormatOption {
    pub id: String,
    pub height: Option<u32>,
    pub ext: String,
    pub vcodec: String,
    pub acodec: String,
    pub filesize: Option<u64>,
    pub fps: Option<f64>,
}

// ponytail: -J tek videonun tüm formatlarını döner; kuyruk kilidi YOK
// (hızlı metadata, paralel okuma serbest).
#[tauri::command]
pub async fn list_formats(app: AppHandle, payload: serde_json::Value) -> Result<Vec<FormatOption>, String> {
    // Kapı: işe başlamadan yt-dlp'yi kayıttan çöz (indirilen → gömülü). Gömülü
    // kalır — kayıtta indirme kaynağı YOK (`downloadable=false`); yalnızca
    // `sidecar` yerine çözümlenmiş yolu çalıştırıyoruz, indirilebilir yapmıyoruz.
    let yt_dlp = crate::components::require_tool(&app, "yt-dlp")?;
    let url = payload
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or("missing required key url")?
        .to_string();
    let (mut rx, _child) = app
        .shell()
        .command(yt_dlp.to_string_lossy().to_string())
        .args(["-J", "--no-playlist", "--no-warnings", &url])
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut out = String::new();
    let mut err = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => out.push_str(&String::from_utf8_lossy(&line)),
            CommandEvent::Stderr(line) => push_capped(&mut err, &String::from_utf8_lossy(&line)),
            CommandEvent::Error(e) => return Err(e),
            CommandEvent::Terminated(p) => {
                if p.code != Some(0) {
                    return Err(if err.trim().is_empty() {
                        "yt-dlp format okuması başarısız".to_string()
                    } else {
                        err
                    });
                }
            }
            _ => {}
        }
    }
    let v: serde_json::Value = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    let formats = v
        .get("formats")
        .and_then(|f| f.as_array())
        .ok_or("format listesi yok")?;
    let mut opts = Vec::new();
    for f in formats {
        let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
        let acodec = f.get("acodec").and_then(|v| v.as_str()).unwrap_or("none");
        if vcodec == "none" && acodec == "none" {
            continue;
        }
        opts.push(FormatOption {
            id: f.get("format_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            height: f.get("height").and_then(|v| v.as_u64()).map(|h| h as u32),
            ext: f.get("ext").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            vcodec: vcodec.to_string(),
            acodec: acodec.to_string(),
            filesize: f
                .get("filesize")
                .or_else(|| f.get("filesize_approx"))
                .and_then(|v| v.as_u64()),
            fps: f.get("fps").and_then(|v| v.as_f64()),
        });
    }
    Ok(opts)
}
