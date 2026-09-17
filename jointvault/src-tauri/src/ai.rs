use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const DEFAULT_IDLE_TIMEOUT_SECS: u64 = 600; // 10 dakika
const CHAT_PORT: u16 = 28080;
const EMBED_PORT: u16 = 28081;

// Kararlı llama.cpp CUDA 12.4 sürümü (Windows x64)
const LLAMA_ENGINE_URL: &str =
    "https://github.com/ggml-org/llama.cpp/releases/download/b10964/llama-b10964-bin-win-cuda-12.4-x64.zip";
const LLAMA_CUDART_URL: &str =
    "https://github.com/ggml-org/llama.cpp/releases/download/b10964/cudart-llama-bin-win-cuda-12.4-x64.zip";

// Varsayılan Model URL'leri (Hugging Face)
const QWEN_14B_URL: &str =
    "https://huggingface.co/bartowski/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf";
const QWEN_14B_FILE: &str = "Qwen2.5-14B-Instruct-Q4_K_M.gguf";

const BGE_M3_URL: &str =
    "https://huggingface.co/gpustack/bge-m3-GGUF/resolve/main/bge-m3-Q8_0.gguf";
const BGE_M3_FILE: &str = "bge-m3-Q8_0.gguf";

#[derive(Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub llm_path: Option<String>,
    pub embed_path: Option<String>,
    pub engine_path: Option<String>,
    pub external_api_url: Option<String>,
    pub idle_timeout_secs: Option<u64>,
    pub auto_warmup: Option<bool>,
    pub temperature: Option<f32>,
    pub auto_apply_tags: Option<bool>,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            llm_path: None,
            embed_path: None,
            engine_path: None,
            external_api_url: None,
            idle_timeout_secs: Some(DEFAULT_IDLE_TIMEOUT_SECS),
            auto_warmup: Some(true),
            temperature: Some(0.7),
            auto_apply_tags: Some(false),
        }
    }
}

struct ProcessSlot {
    child: Option<std::process::Child>,
    last_active: Instant,
    port: u16,
}

struct AiProcessManager {
    chat: ProcessSlot,
    embed: ProcessSlot,
    config: AiConfig,
}

static MANAGER: Mutex<Option<AiProcessManager>> = Mutex::new(None);

fn get_str(payload: &Value, key: &str) -> Result<String, String> {
    payload
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Eksik zorunlu parametre: {key}"))
}

pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("jointvault-models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Model klasörü açılamadı: {e}"))?;
    Ok(dir)
}

pub fn binaries_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("jointvault-binaries");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Binary klasörü açılamadı: {e}"))?;
    Ok(dir)
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("jointvault-ai-config.json"))
}

pub fn load_config(app: &AppHandle) -> AiConfig {
    if let Ok(p) = config_path(app) {
        if p.exists() {
            if let Ok(data) = std::fs::read_to_string(&p) {
                if let Ok(cfg) = serde_json::from_str::<AiConfig>(&data) {
                    return cfg;
                }
            }
        }
    }
    AiConfig::default()
}

pub fn save_config(app: &AppHandle, cfg: &AiConfig) -> Result<(), String> {
    let p = config_path(app)?;
    let data = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(p, data).map_err(|e| e.to_string())?;
    Ok(())
}

fn resolve_engine_path(app: &AppHandle, cfg: &AiConfig) -> Option<PathBuf> {
    if let Some(ref p) = cfg.engine_path {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    if let Ok(bdir) = binaries_dir(app) {
        let p = bdir.join("llama-server.exe");
        if p.exists() {
            return Some(p);
        }
        let p2 = bdir.join("llama-server");
        if p2.exists() {
            return Some(p2);
        }
    }
    None
}

fn resolve_llm_path(app: &AppHandle, cfg: &AiConfig) -> Option<PathBuf> {
    if let Some(ref p) = cfg.llm_path {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    if let Ok(mdir) = models_dir(app) {
        let p = mdir.join(QWEN_14B_FILE);
        if p.exists() {
            return Some(p);
        }
        // Geriye dönük veya farklı adlandırılmış Qwen modelleri için tarama
        if let Ok(entries) = std::fs::read_dir(&mdir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.contains("qwen") && (name.contains("14b") || name.contains("instruct")) && name.ends_with(".gguf") {
                    return Some(entry.path());
                }
            }
        }
    }
    None
}

fn resolve_embed_path(app: &AppHandle, cfg: &AiConfig) -> Option<PathBuf> {
    if let Some(ref p) = cfg.embed_path {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    if let Ok(mdir) = models_dir(app) {
        let p = mdir.join(BGE_M3_FILE);
        if p.exists() {
            return Some(p);
        }
        // Geriye dönük veya farklı adlandırılmış BGE-M3 modelleri için tarama
        if let Ok(entries) = std::fs::read_dir(&mdir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.contains("bge-m3") && name.ends_with(".gguf") {
                    return Some(entry.path());
                }
            }
        }
    }
    None
}

fn init_manager_if_needed(app: &AppHandle) {
    let mut lock = MANAGER.lock().unwrap();
    if lock.is_none() {
        let cfg = load_config(app);
        *lock = Some(AiProcessManager {
            chat: ProcessSlot {
                child: None,
                last_active: Instant::now(),
                port: CHAT_PORT,
            },
            embed: ProcessSlot {
                child: None,
                last_active: Instant::now(),
                port: EMBED_PORT,
            },
            config: cfg,
        });
    }
}

// Boşta kalan sunucuları uyutan bekçi (watchdog)
pub fn start_watchdog(app: AppHandle) {
    init_manager_if_needed(&app);
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            let mut lock = MANAGER.lock().unwrap();
            if let Some(ref mut mgr) = *lock {
                let idle_secs = mgr
                    .config
                    .idle_timeout_secs
                    .unwrap_or(DEFAULT_IDLE_TIMEOUT_SECS);

                if idle_secs == 0 {
                    // Daima hazır modu: Süreçleri uyutma
                    continue;
                }

                let timeout = Duration::from_secs(idle_secs);
                let now = Instant::now();

                // Chat server idle kontrolü
                if let Some(ref mut child) = mgr.chat.child {
                    if now.duration_since(mgr.chat.last_active) > timeout {
                        log::info!("AI Chat sunucusu boşta kaldığı için VRAM serbest bırakılıyor.");
                        let _ = child.kill();
                        mgr.chat.child = None;
                    }
                }

                // Embed server idle kontrolü
                if let Some(ref mut child) = mgr.embed.child {
                    if now.duration_since(mgr.embed.last_active) > timeout {
                        log::info!("AI Embed sunucusu boşta kaldığı için VRAM serbest bırakılıyor.");
                        let _ = child.kill();
                        mgr.embed.child = None;
                    }
                }
            }
        }
    });
}

// Uygulama açılışında modelleri arka planda VRAM'e sessizce yükle (Cold Start önleme)
pub fn warmup_ai_on_startup(app: AppHandle) {
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        // UI'ın hızlıca açılması için 1.5 sn bekle, ardından modelleri VRAM'e yükle
        tokio::time::sleep(Duration::from_millis(1500)).await;
        let _ = warmup_ai_async(app_clone).await;
    });
}

pub async fn warmup_ai_async(app: AppHandle) -> Result<(), String> {
    init_manager_if_needed(&app);
    let (auto_warmup, has_engine, has_llm, has_embed) = {
        let lock = MANAGER.lock().unwrap();
        if let Some(ref mgr) = *lock {
            let auto = mgr.config.auto_warmup.unwrap_or(true);
            let eng = resolve_engine_path(&app, &mgr.config).is_some();
            let llm = resolve_llm_path(&app, &mgr.config).is_some();
            let emb = resolve_embed_path(&app, &mgr.config).is_some();
            (auto, eng, llm, emb)
        } else {
            (false, false, false, false)
        }
    };

    if !auto_warmup || !has_engine {
        return Ok(());
    }

    let _ = app.emit("ai-warmup-status", serde_json::json!({
        "status": "loading",
        "message": "Modeller VRAM'e yükleniyor..."
    }));

    if has_embed {
        let _ = ensure_server_running(&app, "embed").await;
    }
    if has_llm {
        let _ = ensure_server_running(&app, "chat").await;
    }

    let _ = app.emit("ai-warmup-status", serde_json::json!({
        "status": "ready",
        "message": "Yapay zekâ hazır (RTX 5070 Ti)"
    }));

    Ok(())
}

// Boş bir port bul
fn find_available_port(preferred: u16) -> u16 {
    // Önce tercih edilen portu dene
    if let Ok(listener) = std::net::TcpListener::bind(("127.0.0.1", preferred)) {
        drop(listener);
        return preferred;
    }
    // Doluysa (örn. 8080'de NVIDIA Broadcast varsa) sonraki portları tara
    for p in (preferred + 1)..=(preferred + 100) {
        if let Ok(listener) = std::net::TcpListener::bind(("127.0.0.1", p)) {
            drop(listener);
            return p;
        }
    }
    // Son çare: İşletim sisteminden rastgele boş port iste
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(preferred)
}

// Sunucunun ayakta olup olmadığını HTTP ile kontrol et
async fn wait_for_server(port: u16, max_wait_secs: u64) -> bool {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(800))
        .build()
        .unwrap_or_default();
    let url = format!("http://127.0.0.1:{port}/health");
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(max_wait_secs) {
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                return true;
            }
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    false
}

// Gerekirse sunucuyu başlat (On-demand)
async fn ensure_server_running(
    app: &AppHandle,
    slot_type: &str, // "chat" veya "embed"
) -> Result<u16, String> {
    init_manager_if_needed(app);
    let (engine, model, port) = {
        let mut lock = MANAGER.lock().unwrap();
        let mgr = lock.as_mut().ok_or("Manager başlatılamadı")?;

        let slot = if slot_type == "chat" {
            &mut mgr.chat
        } else {
            &mut mgr.embed
        };

        slot.last_active = Instant::now();

        // Çalışıyorsa kontrol et
        if let Some(ref mut child) = slot.child {
            match child.try_wait() {
                Ok(None) => return Ok(slot.port), // Çalışmaya devam ediyor
                _ => {
                    slot.child = None;
                }
            }
        }

        let engine = resolve_engine_path(app, &mgr.config)
            .ok_or_else(|| "llama-server motoru bulunamadı. Lütfen Ayarlar panelinden kur veya yolunu göster.".to_string())?;

        let model = if slot_type == "chat" {
            resolve_llm_path(app, &mgr.config).ok_or_else(|| "Qwen 2.5 14B modeli bulunamadı.".to_string())?
        } else {
            resolve_embed_path(app, &mgr.config).ok_or_else(|| "BGE-M3 modeli bulunamadı.".to_string())?
        };

        let chosen_port = find_available_port(slot.port);
        slot.port = chosen_port;

        (engine, model, chosen_port)
    };

    // Sunucu komutunu oluştur
    let mut cmd = std::process::Command::new(&engine);
    cmd.arg("-m")
        .arg(&model)
        .arg("--port")
        .arg(port.to_string())
        .arg("--host")
        .arg("127.0.0.1")
        .arg("-ngl")
        .arg("99") // 5070 Ti: Tüm katmanları GPU'ya offload et
        .arg("-c")
        .arg(if slot_type == "chat" { "8192" } else { "4096" });

    if slot_type == "embed" {
        cmd.arg("--embedding")
            .arg("-b")
            .arg("2048")
            .arg("-ub")
            .arg("2048");
    }

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let child = cmd
        .spawn()
        .map_err(|e| format!("llama-server başlatılamadı: {e}"))?;

    {
        let mut lock = MANAGER.lock().unwrap();
        if let Some(ref mut mgr) = *lock {
            let slot = if slot_type == "chat" {
                &mut mgr.chat
            } else {
                &mut mgr.embed
            };
            slot.child = Some(child);
            slot.last_active = Instant::now();
        }
    }

    // Sunucunun hazır olmasını bekle (ilk model yüklemesi 2-6 sn sürebilir)
    if !wait_for_server(port, 60).await {
        return Err(format!(
            "llama-server (port {port}) zaman aşımına uğradı veya başlatılamadı."
        ));
    }

    Ok(port)
}

// Uygulama kapanırken süreçleri temizle
pub fn cleanup_ai_servers() {
    let mut lock = MANAGER.lock().unwrap();
    if let Some(ref mut mgr) = *lock {
        if let Some(ref mut ch) = mgr.chat.child {
            let _ = ch.kill();
        }
        mgr.chat.child = None;
        if let Some(ref mut em) = mgr.embed.child {
            let _ = em.kill();
        }
        mgr.embed.child = None;
    }
}

// --- Tauri Commands ---

#[tauri::command]
pub async fn ai_status(app: AppHandle) -> Result<Value, String> {
    init_manager_if_needed(&app);
    let mut lock = MANAGER.lock().unwrap();
    let mgr = lock.as_mut().ok_or("Manager başlatılamadı")?;

    let engine = resolve_engine_path(&app, &mgr.config);
    let llm = resolve_llm_path(&app, &mgr.config);
    let embed = resolve_embed_path(&app, &mgr.config);

    let chat_running = mgr.chat.child.as_mut().map(|c| c.try_wait().map(|s| s.is_none()).unwrap_or(false)).unwrap_or(false);
    let embed_running = mgr.embed.child.as_mut().map(|c| c.try_wait().map(|s| s.is_none()).unwrap_or(false)).unwrap_or(false);

    Ok(serde_json::json!({
        "engine_available": engine.is_some(),
        "engine_path": engine.map(|p| p.to_string_lossy().to_string()),
        "llm_ready": llm.is_some(),
        "llm_path": llm.map(|p| p.to_string_lossy().to_string()),
        "embed_ready": embed.is_some(),
        "embed_path": embed.map(|p| p.to_string_lossy().to_string()),
        "chat_server_running": chat_running,
        "embed_server_running": embed_running,
        "external_api_url": mgr.config.external_api_url,
        "auto_warmup": mgr.config.auto_warmup.unwrap_or(true),
        "idle_timeout_secs": mgr.config.idle_timeout_secs.unwrap_or(DEFAULT_IDLE_TIMEOUT_SECS),
        "temperature": mgr.config.temperature.unwrap_or(0.7),
        "auto_apply_tags": mgr.config.auto_apply_tags.unwrap_or(false),
    }))
}

#[tauri::command]
pub async fn ai_warmup(app: AppHandle) -> Result<(), String> {
    warmup_ai_async(app).await
}

#[tauri::command]
pub async fn ai_save_config(app: AppHandle, payload: Value) -> Result<(), String> {
    init_manager_if_needed(&app);
    let mut lock = MANAGER.lock().unwrap();
    let mgr = lock.as_mut().ok_or("Manager başlatılamadı")?;

    if let Some(v) = payload.get("llm_path") {
        mgr.config.llm_path = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = payload.get("embed_path") {
        mgr.config.embed_path = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = payload.get("engine_path") {
        mgr.config.engine_path = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = payload.get("external_api_url") {
        mgr.config.external_api_url = v.as_str().map(|s| s.to_string());
    }
    if let Some(v) = payload.get("idle_timeout_secs").and_then(|v| v.as_u64()) {
        mgr.config.idle_timeout_secs = Some(v);
    }
    if let Some(v) = payload.get("auto_warmup").and_then(|v| v.as_bool()) {
        mgr.config.auto_warmup = Some(v);
    }
    if let Some(v) = payload.get("temperature").and_then(|v| v.as_f64()) {
        mgr.config.temperature = Some(v as f32);
    }
    if let Some(v) = payload.get("auto_apply_tags").and_then(|v| v.as_bool()) {
        mgr.config.auto_apply_tags = Some(v);
    }

    save_config(&app, &mgr.config)?;
    Ok(())
}

#[tauri::command]
pub async fn ai_stop_server() -> Result<(), String> {
    cleanup_ai_servers();
    Ok(())
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    job_id: String,
    percent: f64,
}

async fn download_and_extract_zip(
    client: &reqwest::Client,
    url: &str,
    bdir: &Path,
    app: &AppHandle,
    job_id: &str,
    start_pct: f64,
    pct_span: f64,
) -> Result<(), String> {
    let tmp = std::env::temp_dir();
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let zip_part = tmp.join(format!("jv-zip-{job_id}-{nonce}.part"));
    let zip_file = tmp.join(format!("jv-zip-{job_id}-{nonce}.zip"));

    let mut resp = client
        .get(url)
        .header("User-Agent", "JointVault/1.0")
        .send()
        .await
        .map_err(|e| format!("İndirme başlatılamadı ({url}): {e}"))?
        .error_for_status()
        .map_err(|e| format!("İndirme hatası ({url}): {e}"))?;

    let total = resp.content_length();
    let mut file = std::fs::File::create(&zip_part).map_err(|e| format!("Geçici dosya açılamadı: {e}"))?;
    let mut downloaded: u64 = 0;

    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("İndirme koptu: {e}"))? {
        file.write_all(&chunk).map_err(|e| format!("Diske yazılamadı: {e}"))?;
        downloaded += chunk.len() as u64;
        if let Some(t) = total {
            if t > 0 {
                let fraction = downloaded as f64 / t as f64;
                let pct = (start_pct + fraction * pct_span).clamp(0.0, 100.0);
                let _ = app.emit("ai-engine-progress", DownloadProgress { job_id: job_id.to_string(), percent: pct });
            }
        }
    }
    drop(file);

    let _ = std::fs::rename(&zip_part, &zip_file);

    let file_zip = std::fs::File::open(&zip_file).map_err(|e| format!("Zip açılamadı: {e}"))?;
    let mut archive = zip::ZipArchive::new(file_zip).map_err(|e| format!("Zip okunamadı: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let ename = entry.name().to_string();
        let fname = Path::new(&ename).file_name().and_then(|n| n.to_str()).unwrap_or("");
        if fname.ends_with(".exe") || fname.ends_with(".dll") {
            let outpath = bdir.join(fname);
            let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;
        }
    }

    let _ = std::fs::remove_file(&zip_file);
    Ok(())
}

#[tauri::command]
pub async fn ai_download_engine(app: AppHandle, payload: Value) -> Result<String, String> {
    let job_id = get_str(&payload, "job_id")?;
    let bdir = binaries_dir(&app)?;
    let target_exe = bdir.join("llama-server.exe");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;

    let _ = app.emit("ai-engine-progress", DownloadProgress { job_id: job_id.clone(), percent: 0.0 });

    // 1. Ana llama-server ve temel kütüphaneler (0% - 50%)
    if !target_exe.exists() {
        download_and_extract_zip(&client, LLAMA_ENGINE_URL, &bdir, &app, &job_id, 0.0, 50.0).await?;
    } else {
        let _ = app.emit("ai-engine-progress", DownloadProgress { job_id: job_id.clone(), percent: 50.0 });
    }

    // 2. CUDA 12.4 Runtime kütüphaneleri (cublas64_12.dll, cudart64_12.dll) (50% - 100%)
    let cublas_dll = bdir.join("cublas64_12.dll");
    if !cublas_dll.exists() {
        download_and_extract_zip(&client, LLAMA_CUDART_URL, &bdir, &app, &job_id, 50.0, 50.0).await?;
    }

    let _ = app.emit("ai-engine-progress", DownloadProgress { job_id, percent: 100.0 });
    Ok("done".to_string())
}

#[tauri::command]
pub async fn ai_download_model(app: AppHandle, payload: Value) -> Result<String, String> {
    let model_type = get_str(&payload, "model_type")?; // "llm" veya "embed"
    let job_id = get_str(&payload, "job_id")?;
    let mdir = models_dir(&app)?;

    let (url, filename) = if model_type == "llm" {
        (QWEN_14B_URL, QWEN_14B_FILE)
    } else {
        (BGE_M3_URL, BGE_M3_FILE)
    };

    let target = mdir.join(filename);
    if target.exists() {
        let _ = app.emit("ai-model-progress", DownloadProgress { job_id, percent: 100.0 });
        return Ok("done".to_string());
    }

    let part = target.with_extension("gguf.part");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(7200))
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client
        .get(url)
        .header("User-Agent", "JointVault/1.0")
        .send()
        .await
        .map_err(|e| format!("Model indirilemedi: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Model indirilemedi: {e}"))?;

    let total = resp.content_length();
    let mut file = std::fs::File::create(&part).map_err(|e| format!("Dosya açılamadı: {e}"))?;
    let mut downloaded: u64 = 0;

    let _ = app.emit("ai-model-progress", DownloadProgress { job_id: job_id.clone(), percent: 0.0 });

    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("İndirme hatası: {e}"))? {
        file.write_all(&chunk).map_err(|e| format!("Yazılamadı: {e}"))?;
        downloaded += chunk.len() as u64;
        if let Some(t) = total {
            if t > 0 {
                let pct = (downloaded as f64 / t as f64 * 100.0).clamp(0.0, 100.0);
                let _ = app.emit("ai-model-progress", DownloadProgress { job_id: job_id.clone(), percent: pct });
            }
        }
    }
    drop(file);

    std::fs::rename(&part, &target).map_err(|e| format!("Dosya taşınamadı: {e}"))?;
    let _ = app.emit("ai-model-progress", DownloadProgress { job_id, percent: 100.0 });
    Ok("done".to_string())
}

// BGE-M3 Vektör Üretimi (Tekil veya Toplu)
#[tauri::command]
pub async fn ai_embed(app: AppHandle, payload: Value) -> Result<Vec<Vec<f32>>, String> {
    let texts: Vec<String> = serde_json::from_value(
        payload.get("texts").cloned().unwrap_or(Value::Array(vec![])),
    )
    .map_err(|e| format!("Geçersiz metin dizisi: {e}"))?;

    if texts.is_empty() {
        return Ok(vec![]);
    }

    let port = ensure_server_running(&app, "embed").await?;
    let url = format!("http://127.0.0.1:{port}/v1/embeddings");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let req_body = serde_json::json!({
        "input": texts,
        "model": "bge-m3"
    });

    let resp = client
        .post(&url)
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Embed API isteği başarısız: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Embed API hata döndü: {e}"))?;

    let res_json: Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut embeddings: Vec<Vec<f32>> = Vec::new();

    if let Some(arr) = res_json.get("data").and_then(|d| d.as_array()) {
        for item in arr {
            if let Some(vec_vals) = item.get("embedding").and_then(|v| v.as_array()) {
                let fvec: Vec<f32> = vec_vals
                    .iter()
                    .filter_map(|x| x.as_f64().map(|f| f as f32))
                    .collect();
                embeddings.push(fvec);
            }
        }
    }

    Ok(embeddings)
}

// Qwen 2.5 Sohbet Üretimi (Streaming destekli)
#[tauri::command]
pub async fn ai_chat_stream(app: AppHandle, payload: Value) -> Result<String, String> {
    let job_id = get_str(&payload, "job_id")?;
    let messages: Value = payload
        .get("messages")
        .cloned()
        .ok_or_else(|| "Eksik messages".to_string())?;
    let system_prompt = payload
        .get("system_prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("Sen JointVault kişisel medya kasasının zeki asistanısın. Türkçe konuşur, transkript ve notlara sadık kalarak doğru ve net yanıt verirsin.");

    let port = ensure_server_running(&app, "chat").await?;
    let url = format!("http://127.0.0.1:{port}/v1/chat/completions");

    let mut full_messages = vec![serde_json::json!({
        "role": "system",
        "content": system_prompt
    })];

    if let Some(arr) = messages.as_array() {
        for m in arr {
            full_messages.push(m.clone());
        }
    }

    let cfg = load_config(&app);
    let temp = payload
        .get("temperature")
        .and_then(|v| v.as_f64())
        .map(|f| f as f32)
        .or(cfg.temperature)
        .unwrap_or(0.7);

    let req_body = serde_json::json!({
        "messages": full_messages,
        "temperature": temp,
        "max_tokens": 2048,
        "stream": true
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client
        .post(&url)
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Chat API çağrılamadı: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Chat API hata verdi: {e}"))?;

    let mut full_text = String::new();
    let mut buffer = String::new();

    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Stream koptu: {e}"))? {
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.starts_with("data: ") {
                let data_part = &line[6..];
                if data_part == "[DONE]" {
                    break;
                }
                if let Ok(val) = serde_json::from_str::<Value>(data_part) {
                    if let Some(content) = val
                        .get("choices")
                        .and_then(|c| c.get(0))
                        .and_then(|c0| c0.get("delta"))
                        .and_then(|d| d.get("content"))
                        .and_then(|s| s.as_str())
                    {
                        full_text.push_str(content);
                        let _ = app.emit(
                            "ai-chat-token",
                            serde_json::json!({
                                "job_id": &job_id,
                                "token": content
                            }),
                        );
                    }
                }
            }
        }
    }

    let _ = app.emit(
        "ai-chat-done",
        serde_json::json!({
            "job_id": &job_id,
            "full_text": &full_text
        }),
    );

    Ok(full_text)
}

// Etiket Önerisi (JSON olarak)
#[tauri::command]
pub async fn ai_suggest_tags(app: AppHandle, payload: Value) -> Result<Vec<String>, String> {
    let item_text = get_str(&payload, "item_text")?;
    let existing_tags: Vec<String> = serde_json::from_value(
        payload.get("existing_tags").cloned().unwrap_or(Value::Array(vec![])),
    )
    .unwrap_or_default();

    let existing_str = if existing_tags.is_empty() {
        "Henüz hiç etiket yok.".to_string()
    } else {
        existing_tags.join(", ")
    };

    let prompt = format!(
        "Aşağıdaki medya kaydını incele ve en uygun 2 ila 5 adet etiket öner.\n\
        ÖNCELİK KURALI: Eğer içerikle uyumluysa öncelikle kasadaki mevcut etiketlerden seç: [{existing_str}].\n\
        Gerekirse yeni etiket de ekleyebilirsin.\n\
        ÇIKTI FORMATI: Yanıt olarak SADECE JSON formatında bir dize dizisi ver. Örnek: [\"Yazılım\", \"Teknoloji\"]\n\n\
        KAYIT İÇERİĞİ:\n{item_text}"
    );

    let port = ensure_server_running(&app, "chat").await?;
    let url = format!("http://127.0.0.1:{port}/v1/chat/completions");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "messages": [
                { "role": "system", "content": "Sen yalnızca JSON üreten uzman bir etiketleme asistanısın." },
                { "role": "user", "content": prompt }
            ],
            "temperature": 0.2
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;

    let res_json: Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = res_json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c0| c0.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|s| s.as_str())
        .unwrap_or("[]");

    // JSON dizisini ayıkla
    let start = content.find('[').unwrap_or(0);
    let end = content.rfind(']').map(|i| i + 1).unwrap_or(content.len());
    let json_slice = &content[start..end];

    let tags: Vec<String> = serde_json::from_str(json_slice).unwrap_or_default();
    Ok(tags)
}

// Özet Çıkarma
#[tauri::command]
pub async fn ai_summarize(app: AppHandle, payload: Value) -> Result<String, String> {
    let content_text = get_str(&payload, "text")?;

    let prompt = format!(
        "Aşağıdaki içeriği Türkçe olarak 2-3 vurucu cümleyle özetle. Ana fikri, önemli detayları ve varsa temel çıkarımları aktar:\n\n{content_text}"
    );

    let port = ensure_server_running(&app, "chat").await?;
    let url = format!("http://127.0.0.1:{port}/v1/chat/completions");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "messages": [
                { "role": "system", "content": "Sen net, doğrudan ve profesyonel Türkçe özetler yazan bir asistansın." },
                { "role": "user", "content": prompt }
            ],
            "temperature": 0.3
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let res_json: Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = res_json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c0| c0.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .trim();

    Ok(content.to_string())
}

// Akıllı Kategorizasyon ve Etiketleme (Mevcut Taksonomi Öncelikli)
#[tauri::command]
pub async fn ai_categorize_and_tag(app: AppHandle, payload: Value) -> Result<Value, String> {
    let title = payload.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let item_text = payload.get("text").and_then(|v| v.as_str()).unwrap_or("");
    let platform = payload.get("platform").and_then(|v| v.as_str()).unwrap_or("");
    let url = payload.get("url").and_then(|v| v.as_str()).unwrap_or("");

    let existing_categories: Vec<String> = serde_json::from_value(
        payload.get("existing_categories").cloned().unwrap_or(Value::Array(vec![])),
    )
    .unwrap_or_default();

    let existing_tags: Vec<String> = serde_json::from_value(
        payload.get("existing_tags").cloned().unwrap_or(Value::Array(vec![])),
    )
    .unwrap_or_default();

    let existing_cat_str = if existing_categories.is_empty() {
        "Henüz kategori yok".to_string()
    } else {
        existing_categories.join(", ")
    };

    let existing_tag_str = if existing_tags.is_empty() {
        "Henüz etiket yok".to_string()
    } else {
        existing_tags.join(", ")
    };

    let content_snippet: String = if item_text.chars().count() > 3000 {
        item_text.chars().take(3000).collect::<String>() + "..."
    } else {
        item_text.to_string()
    };

    let prompt = format!(
        "Aşağıdaki medya kaydını analiz et, en uygun kategori ve etiketleri belirle.\n\n\
        TAKSONOMİ VE EŞLEŞTİRME KURALLARI:\n\
        1. KATEGORİLER: Öncelikle kasadaki mevcut kategorilerden EN UYGUN 1 veya en fazla 2 tanesini seç: [{existing_cat_str}].\n\
           Eğer içerik bu kategorilerden hiçbirine uymuyorsa, yeni ve genel geçer 1 kategori öner (Örn: Yazılım, Tasarım, Müzik, Bilim, Finans vb.).\n\
        2. ETİKETLER: Öncelikle kasadaki mevcut etiketlerden EN UYGUN 2 ila 4 tanesini seç: [{existing_tag_str}].\n\
           Eğer içerikteki önemli kavramlar mevcut listede yoksa, 1 ila 3 yeni etiket türet. Etiketlerin başına '#' koyma, küçük harf ve sade tut.\n\
        3. ÖZET: İçeriği tek cümleyle net bir şekilde özetle.\n\
        4. GÜVEN SKORU: Önerilerin içeriğe uygunluğuna 0.0 ile 1.0 arasında bir confidence değeri ver.\n\n\
        ÇIKTI FORMATI: Yanıt olarak SADECE geçerli bir JSON nesnesi döndür. Başka hiçbir markdown, karşılama veya açıklama yazma.\n\
        Örnek format:\n\
        {{\"categories\": [\"Teknoloji\"], \"tags\": [\"yapay-zeka\", \"python\"], \"summary\": \"Yapay zeka modellerinin yerel çalıştırılması üzerine rehber.\", \"confidence\": 0.95}}\n\n\
        KAYIT DETAYLARI:\n\
        - Başlık: {title}\n\
        - Platform / Kaynak: {platform}\n\
        - URL: {url}\n\
        - İçerik / Not / Transkript:\n{content_snippet}"
    );

    let port = ensure_server_running(&app, "chat").await?;
    let api_url = format!("http://127.0.0.1:{port}/v1/chat/completions");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&api_url)
        .json(&serde_json::json!({
            "messages": [
                {
                    "role": "system",
                    "content": "Sen JointVault kişisel medya kasası için çalışan uzman bir içerik taksonomi, kategorizasyon ve etiketleme motorusun. Çıktıyı SADECE belirtilen JSON formatında üretirsin."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "temperature": 0.2
        }))
        .send()
        .await
        .map_err(|e| format!("Kategorizasyon API çağrısı başarısız: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Kategorizasyon API hatası: {e}"))?;

    let res_json: Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = res_json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c0| c0.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|s| s.as_str())
        .unwrap_or("{}");

    // JSON bloğunu ayıkla ({ ... })
    let parsed: Value = if let (Some(start), Some(end)) = (content.find('{'), content.rfind('}')) {
        let json_slice = &content[start..=end];
        serde_json::from_str(json_slice).unwrap_or(serde_json::json!({
            "categories": [],
            "tags": [],
            "summary": "",
            "confidence": 0.0
        }))
    } else {
        serde_json::json!({
            "categories": [],
            "tags": [],
            "summary": "",
            "confidence": 0.0
        })
    };

    Ok(parsed)
}
