use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProbeResult {
    pub url: String,
    pub filename: String,
    pub file_size: u64,
    pub accepts_ranges: bool,
    pub content_type: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ChunkMeta {
    pub index: usize,
    pub start: u64,
    pub end: u64,
    pub downloaded: u64,
    pub completed: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct DownloadMeta {
    pub job_id: String,
    pub url: String,
    pub filename: String,
    pub destination_path: String,
    pub file_size: u64,
    pub threads: usize,
    pub chunks: Vec<ChunkMeta>,
}

#[derive(Clone, Serialize, Debug)]
pub struct ChunkProgress {
    pub id: usize,
    pub percent: f64,
}

#[derive(Clone, Serialize, Debug)]
pub struct TurboProgressPayload {
    pub job_id: String,
    pub status: String,
    pub downloaded_size: u64,
    pub file_size: u64,
    pub percent: f64,
    pub speed_bps: u64,
    pub eta_secs: u64,
    pub chunks: Vec<ChunkProgress>,
    pub error: Option<String>,
}

struct JobController {
    paused: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
}

static CONTROLLERS: Mutex<Option<HashMap<String, Arc<JobController>>>> = Mutex::new(None);

fn get_controller_map() -> &'static Mutex<Option<HashMap<String, Arc<JobController>>>> {
    &CONTROLLERS
}

fn register_job(job_id: &str) -> Arc<JobController> {
    let mut lock = get_controller_map().lock().unwrap();
    let map = lock.get_or_insert_with(HashMap::new);
    let ctrl = Arc::new(JobController {
        paused: Arc::new(AtomicBool::new(false)),
        cancelled: Arc::new(AtomicBool::new(false)),
    });
    map.insert(job_id.to_string(), ctrl.clone());
    ctrl
}

fn get_job(job_id: &str) -> Option<Arc<JobController>> {
    let mut lock = get_controller_map().lock().unwrap();
    let map = lock.get_or_insert_with(HashMap::new);
    map.get(job_id).cloned()
}

fn unregister_job(job_id: &str) {
    let mut lock = get_controller_map().lock().unwrap();
    if let Some(ref mut map) = *lock {
        map.remove(job_id);
    }
}

fn sanitize_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect();
    if sanitized.trim().is_empty() {
        "downloaded_file".to_string()
    } else {
        sanitized.trim().to_string()
    }
}

fn extract_filename_from_url(url_str: &str) -> String {
    if let Ok(parsed) = reqwest::Url::parse(url_str) {
        if let Some(segments) = parsed.path_segments() {
            let last = segments.last().unwrap_or("");
            if !last.is_empty() {
                return sanitize_filename(last);
            }
        }
    }
    "downloaded_file".to_string()
}

#[tauri::command]
pub async fn turbo_probe_url(url: String) -> Result<ProbeResult, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    // Önce HEAD dene
    let head_resp = client.head(&url).send().await;
    let (status, headers) = match head_resp {
        Ok(resp) if resp.status().is_success() => (resp.status(), resp.headers().clone()),
        _ => {
            // HEAD başarısızsa GET Range 0-0 ile dene
            let get_resp = client
                .get(&url)
                .header(reqwest::header::RANGE, "bytes=0-0")
                .send()
                .await
                .map_err(|e| format!("Bağlantı kurulamadı: {e}"))?;
            (get_resp.status(), get_resp.headers().clone())
        }
    };

    let accepts_ranges = headers
        .get(reqwest::header::ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_lowercase().contains("bytes"))
        .unwrap_or(false)
        || status == reqwest::StatusCode::PARTIAL_CONTENT;

    let mut file_size: u64 = 0;
    if let Some(len) = headers.get(reqwest::header::CONTENT_LENGTH).and_then(|v| v.to_str().ok()) {
        file_size = len.parse::<u64>().unwrap_or(0);
    }
    if file_size == 0 {
        if let Some(cr) = headers.get(reqwest::header::CONTENT_RANGE).and_then(|v| v.to_str().ok()) {
            // Örn: "bytes 0-0/10485760"
            if let Some(slash_idx) = cr.find('/') {
                let total_str = &cr[slash_idx + 1..].trim();
                file_size = total_str.parse::<u64>().unwrap_or(0);
            }
        }
    }

    let mut filename = String::new();
    if let Some(cd) = headers.get(reqwest::header::CONTENT_DISPOSITION).and_then(|v| v.to_str().ok()) {
        if let Some(fn_idx) = cd.find("filename=") {
            let part = &cd[fn_idx + 9..];
            let clean = part.trim_matches(|c| c == '"' || c == '\'').split(';').next().unwrap_or("");
            if !clean.trim().is_empty() {
                filename = sanitize_filename(clean);
            }
        }
    }

    if filename.is_empty() {
        filename = extract_filename_from_url(&url);
    }

    let content_type = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    Ok(ProbeResult {
        url,
        filename,
        file_size,
        accepts_ranges,
        content_type,
    })
}

#[tauri::command]
pub async fn turbo_pause_download(job_id: String) -> Result<(), String> {
    if let Some(ctrl) = get_job(&job_id) {
        ctrl.paused.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
pub async fn turbo_cancel_download(job_id: String) -> Result<(), String> {
    if let Some(ctrl) = get_job(&job_id) {
        ctrl.cancelled.store(true, Ordering::SeqCst);
    }
    unregister_job(&job_id);
    Ok(())
}

#[tauri::command]
pub async fn turbo_start_download(app: AppHandle, payload: Value) -> Result<(), String> {
    let job_id = payload
        .get("job_id")
        .and_then(|v| v.as_str())
        .ok_or("Eksik job_id")?
        .to_string();
    let url = payload
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or("Eksik url")?
        .to_string();
    let filename = payload
        .get("filename")
        .and_then(|v| v.as_str())
        .unwrap_or("downloaded_file")
        .to_string();
    let destination_path = payload
        .get("destination_path")
        .and_then(|v| v.as_str())
        .ok_or("Eksik destination_path")?
        .to_string();
    let file_size = payload
        .get("file_size")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let threads = payload
        .get("threads")
        .and_then(|v| v.as_u64())
        .unwrap_or(8) as usize;

    let ctrl = register_job(&job_id);

    // Arka planda indirmeyi başlat
    let app_clone = app.clone();
    tokio::spawn(async move {
        if let Err(e) = run_turbo_download(app_clone.clone(), job_id.clone(), url, filename, destination_path, file_size, threads, ctrl).await {
            let _ = app_clone.emit("turbo-download-progress", TurboProgressPayload {
                job_id: job_id.clone(),
                status: "error".to_string(),
                downloaded_size: 0,
                file_size,
                percent: 0.0,
                speed_bps: 0,
                eta_secs: 0,
                chunks: vec![],
                error: Some(e),
            });
            unregister_job(&job_id);
        }
    });

    Ok(())
}

async fn run_turbo_download(
    app: AppHandle,
    job_id: String,
    url: String,
    filename: String,
    dest_path_str: String,
    mut file_size: u64,
    mut threads: usize,
    ctrl: Arc<JobController>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let dest_path = PathBuf::from(&dest_path_str);
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Boyut bilinmiyorsa probe et
    let mut accepts_ranges = true;
    if file_size == 0 {
        if let Ok(pr) = turbo_probe_url(url.clone()).await {
            file_size = pr.file_size;
            accepts_ranges = pr.accepts_ranges;
        }
    }

    if threads == 0 {
        threads = 8;
    }
    if !accepts_ranges || file_size < 500_000 {
        threads = 1;
    }

    let meta_path = PathBuf::from(format!("{dest_path_str}.meta"));

    // Mevcut meta var mı kontrol et (Resume)
    let mut chunks: Vec<ChunkMeta> = Vec::new();
    if meta_path.exists() {
        if let Ok(data) = std::fs::read_to_string(&meta_path) {
            if let Ok(saved) = serde_json::from_str::<DownloadMeta>(&data) {
                if saved.url == url && saved.file_size == file_size && saved.chunks.len() == threads {
                    chunks = saved.chunks;
                }
            }
        }
    }

    // Meta yoksa yeni chunk dilimleri oluştur
    if chunks.is_empty() {
        if threads == 1 || file_size == 0 {
            chunks.push(ChunkMeta {
                index: 0,
                start: 0,
                end: file_size.saturating_sub(1),
                downloaded: 0,
                completed: false,
            });
        } else {
            let chunk_size = file_size / (threads as u64);
            for i in 0..threads {
                let start = (i as u64) * chunk_size;
                let end = if i == threads - 1 {
                    file_size - 1
                } else {
                    ((i + 1) as u64) * chunk_size - 1
                };
                chunks.push(ChunkMeta {
                    index: i,
                    start,
                    end,
                    downloaded: 0,
                    completed: false,
                });
            }
        }
    }

    // Paylaşılan sayaçlar
    let chunks_state = Arc::new(Mutex::new(chunks));

    // Canlı İlerleme Yayını Döngüsü (Her 300ms)
    let app_progress = app.clone();
    let job_id_progress = job_id.clone();
    let chunks_progress = chunks_state.clone();
    let ctrl_progress = ctrl.clone();

    let progress_handle = tokio::spawn(async move {
        let mut last_instant = Instant::now();
        let mut last_downloaded: u64 = 0;

        loop {
            tokio::time::sleep(Duration::from_millis(300)).await;

            if ctrl_progress.cancelled.load(Ordering::Relaxed) {
                break;
            }

            let mut total_downloaded: u64 = 0;
            let mut chunk_progs: Vec<ChunkProgress> = Vec::new();
            let mut all_completed = true;

            {
                let lock = chunks_progress.lock().unwrap();
                for c in lock.iter() {
                    total_downloaded += c.downloaded;
                    let range_len = if c.end >= c.start {
                        c.end - c.start + 1
                    } else {
                        1
                    };
                    let pct = if c.completed {
                        100.0
                    } else {
                        (c.downloaded as f64 / range_len as f64 * 100.0).clamp(0.0, 100.0)
                    };
                    chunk_progs.push(ChunkProgress { id: c.index, percent: pct });
                    if !c.completed {
                        all_completed = false;
                    }
                }
            }

            let now = Instant::now();
            let elapsed = now.duration_since(last_instant).as_secs_f64();
            let speed_bps = if elapsed > 0.0 && total_downloaded >= last_downloaded {
                ((total_downloaded - last_downloaded) as f64 / elapsed) as u64
            } else {
                0
            };
            last_instant = now;
            last_downloaded = total_downloaded;

            let eta_secs = if speed_bps > 0 && file_size > total_downloaded {
                (file_size - total_downloaded) / speed_bps
            } else {
                0
            };

            let percent = if file_size > 0 {
                (total_downloaded as f64 / file_size as f64 * 100.0).clamp(0.0, 100.0)
            } else {
                0.0
            };

            let is_paused = ctrl_progress.paused.load(Ordering::Relaxed);
            let status = if all_completed {
                "completed"
            } else if is_paused {
                "paused"
            } else {
                "active"
            };

            let _ = app_progress.emit("turbo-download-progress", TurboProgressPayload {
                job_id: job_id_progress.clone(),
                status: status.to_string(),
                downloaded_size: total_downloaded,
                file_size,
                percent,
                speed_bps,
                eta_secs,
                chunks: chunk_progs,
                error: None,
            });

            if all_completed || is_paused {
                break;
            }
        }
    });

    // Her Chunk İçin Paralel Task Başlat
    let mut tasks = Vec::new();
    let num_chunks = {
        let lock = chunks_state.lock().unwrap();
        lock.len()
    };

    for idx in 0..num_chunks {
        let client_c = client.clone();
        let url_c = url.clone();
        let dest_base = dest_path_str.clone();
        let chunks_c = chunks_state.clone();
        let ctrl_c = ctrl.clone();

        let task = tokio::spawn(async move {
            let (start, end, mut downloaded, completed) = {
                let lock = chunks_c.lock().unwrap();
                let c = &lock[idx];
                (c.start, c.end, c.downloaded, c.completed)
            };

            if completed {
                return Ok(());
            }

            let part_file_path = format!("{dest_base}.part_{idx}");
            let mut file = OpenOptions::new()
                .create(true)
                .write(true)
                .append(true)
                .open(&part_file_path)
                .map_err(|e| format!("Part dosyası açılamadı: {e}"))?;

            // Dosya boyutunu kontrol et (resume için)
            if let Ok(meta) = file.metadata() {
                downloaded = meta.len();
                let mut lock = chunks_c.lock().unwrap();
                lock[idx].downloaded = downloaded;
            }

            let current_start = start + downloaded;
            if current_start > end && end >= start {
                let mut lock = chunks_c.lock().unwrap();
                lock[idx].completed = true;
                return Ok(());
            }

            let mut req = client_c.get(&url_c);
            if end >= current_start {
                req = req.header(reqwest::header::RANGE, format!("bytes={current_start}-{end}"));
            }

            let mut resp = req.send().await.map_err(|e| format!("Parça {idx} isteği başarısız: {e}"))?;
            if !resp.status().is_success() && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                return Err(format!("Parça {idx} HTTP hatası: {}", resp.status()));
            }

            while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Akış koptu ({idx}): {e}"))? {
                if ctrl_c.cancelled.load(Ordering::Relaxed) {
                    return Err("İptal edildi".to_string());
                }
                if ctrl_c.paused.load(Ordering::Relaxed) {
                    let _ = file.flush();
                    return Ok(());
                }

                file.write_all(&chunk).map_err(|e| format!("Diske yazılamadı: {e}"))?;
                downloaded += chunk.len() as u64;

                let mut lock = chunks_c.lock().unwrap();
                lock[idx].downloaded = downloaded;
            }

            let _ = file.flush();
            let mut lock = chunks_c.lock().unwrap();
            lock[idx].completed = true;
            Ok::<(), String>(())
        });

        tasks.push(task);
    }

    // Task'ların tamamlanmasını bekle
    let mut any_error: Option<String> = None;
    for t in tasks {
        match t.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                if any_error.is_none() && e != "İptal edildi" {
                    any_error = Some(e);
                }
            }
            Err(join_err) => {
                if any_error.is_none() {
                    any_error = Some(join_err.to_string());
                }
            }
        }
    }

    let _ = progress_handle.await;

    // Duraklatıldıysa meta kaydet ve çık
    if ctrl.paused.load(Ordering::Relaxed) {
        let meta_data = DownloadMeta {
            job_id: job_id.clone(),
            url: url.clone(),
            filename: filename.clone(),
            destination_path: dest_path_str.clone(),
            file_size,
            threads,
            chunks: chunks_state.lock().unwrap().clone(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&meta_data) {
            let _ = std::fs::write(&meta_path, json);
        }
        return Ok(());
    }

    // İptal edildiyse geçici dosyaları temizle
    if ctrl.cancelled.load(Ordering::Relaxed) {
        for idx in 0..num_chunks {
            let _ = std::fs::remove_file(format!("{dest_path_str}.part_{idx}"));
        }
        let _ = std::fs::remove_file(&meta_path);
        return Ok(());
    }

    if let Some(err) = any_error {
        return Err(err);
    }

    // Tüm parçalar bittiyse: Birleştir (Concatenate parts into final file)
    let mut final_file = File::create(&dest_path).map_err(|e| format!("Hedef dosya oluşturulamadı: {e}"))?;
    let mut buffer = [0u8; 64 * 1024]; // 64 KB okuma tamponu

    for idx in 0..num_chunks {
        let part_file_path = format!("{dest_path_str}.part_{idx}");
        if let Ok(mut part_file) = File::open(&part_file_path) {
            loop {
                let n = part_file.read(&mut buffer).map_err(|e| format!("Part okunamadı: {e}"))?;
                if n == 0 {
                    break;
                }
                final_file.write_all(&buffer[..n]).map_err(|e| format!("Son dosyaya yazılamadı: {e}"))?;
            }
        }
        let _ = std::fs::remove_file(&part_file_path);
    }
    final_file.flush().map_err(|e| format!("Son dosya kaydedilemedi: {e}"))?;
    let _ = std::fs::remove_file(&meta_path);

    // Tamamlandı bildirimi
    let chunk_progs = (0..num_chunks).map(|i| ChunkProgress { id: i, percent: 100.0 }).collect();
    let _ = app.emit("turbo-download-progress", TurboProgressPayload {
        job_id: job_id.clone(),
        status: "completed".to_string(),
        downloaded_size: file_size,
        file_size,
        percent: 100.0,
        speed_bps: 0,
        eta_secs: 0,
        chunks: chunk_progs,
        error: None,
    });

    unregister_job(&job_id);
    Ok(())
}
