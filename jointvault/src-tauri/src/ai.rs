use crate::component_download::{self, DownloadPlan, Payload};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
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

// Pinlenmiş sha256 (context.md kaynak tablosuyla birebir; yayıncı beyanı).
// İndirme sırasında paylaşılan motorda yeniden doğrulanır — eskiden AI
// indirmelerinde hiç bütünlük kontrolü yoktu, artık bozuk/kısmi arşiv kuruluma giremez.
const LLAMA_ENGINE_SHA256: &str = "264f20d7ee3860aecca9ec12418357a9f3e80349a2b186f66c63859ded1a9593";
const LLAMA_CUDART_SHA256: &str = "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6";
const QWEN_14B_SHA256: &str = "e47ad95dad6ff848b431053b375adb5d39321290ea2c638682577dafca87c008";
const BGE_M3_SHA256: &str = "950f4a8e5e19477a6d3c26d2f162233c20002c601f75e4b002e3239997821167";

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

// Pin tablosundaki indirme boyutları (MiB). Sunucu `Content-Length` vermezse
// ilerleme çubuğunun toplamı bunlar olur; motor yalnızca yedek olarak kullanır.
const MIB: u64 = 1024 * 1024;
const LLAMA_ENGINE_MIB: u64 = 242;
const LLAMA_CUDART_MIB: u64 = 373;
const QWEN_14B_MIB: u64 = 8572;
const BGE_M3_MIB: u64 = 605;

// Disk kapısı için TEPE kullanım tahminleri.
//
// Neden indirilenden büyük: motor arşivi `.part` olarak HEDEF klasörde tutar ve
// çıkarmayı da aynı klasöre yapar; doğrulama bitene kadar ikisi bir arada durur.
// llama.cpp arşivi açıldığında CUDA backend DLL'i (ggml-cuda.dll) tek başına
// arşivi katlar; CPU backend varyantları ve `libomp.dll` de eklenir. Doğru sayı
// gelmezse kullanıcı gereksiz yere engellenir ya da indirme sonunda "yer yok"
// görür — kesin koruma akış sırasındaki `WriteFailed`'dır. Bu yüzden cömert bir
// üst sınır veriyoruz, dar bir kapı değil.
const LLAMA_ENGINE_PEAK_BYTES: u64 = 1_200 * MIB; // ~242 MiB arşiv + ~900 MiB açılan
const LLAMA_CUDART_PEAK_BYTES: u64 = 1_500 * MIB; // ~373 MiB arşiv + ~1.1 GiB açılan (cublas/cublasLt)
// Zip-bomba koruması (tek arşiv girdisi). Arşiv zaten sha256 ile pinli olduğundan bu
// bir emniyet kemeridir; ama gerçek girdiler yüzlerce MB olduğu için cömert olmalı —
// aksi hâlde meşru `ggml-cuda.dll` reddedilir.
const AI_ENGINE_MAX_ENTRY_BYTES: u64 = 2 * 1024 * MIB;

/// llama.cpp CUDA 12.4 Windows arşivinden çıkarılacak dosyalar.
///
/// Motor yalnızca ADI VERİLEN girdileri çıkarır (eşleşmeyen ad sessizce atlanır),
/// bu yüzden liste tam olmalı. Kaynak tarihli tag + sha256 ile pinlendiği için
/// dosya adları da sabittir. `GGML_BACKEND_DL` açık: `ggml-*.dll` dosyaları çalışma
/// anında exe yanından yüklenir; bu yüzden CPU varyantlarının tamamı listelenir
/// (makinede desteklenmeyen varyant yalnızca yüklenmez). `libomp.dll` OpenMP çalışma
/// zamanı; `llama.dll` ve `mtmd.dll` ise `llama-server.exe`'nin bağlı olduğu
/// kütüphanelerdir. Yayın paketi = Windows CPU paketi + `ggml-cuda.dll`.
const LLAMA_ENGINE_ENTRIES: &[&str] = &[
    "llama-server.exe",
    "llama.dll",
    "mtmd.dll",
    "ggml.dll",
    "ggml-base.dll",
    "ggml-cpu.dll",
    "ggml-cuda.dll",
    "ggml-rpc.dll",
    "libomp.dll",
    "ggml-cpu-x64.dll",
    "ggml-cpu-sse42.dll",
    "ggml-cpu-sandybridge.dll",
    "ggml-cpu-ivybridge.dll",
    "ggml-cpu-piledriver.dll",
    "ggml-cpu-haswell.dll",
    "ggml-cpu-skylakex.dll",
    "ggml-cpu-cannonlake.dll",
    "ggml-cpu-cascadelake.dll",
    "ggml-cpu-icelake.dll",
    "ggml-cpu-cooperlake.dll",
    "ggml-cpu-zen4.dll",
    "ggml-cpu-alderlake.dll",
    "ggml-cpu-sapphirerapids.dll",
];

/// CUDA çalışma zamanı arşivi: yalnızca üç DLL (workflow `cudart64_*`, `cublas64_*`
/// ve `cublasLt64_*` desenleriyle paketliyor). `ggml-cuda.dll` bunları exe yanında arar.
const LLAMA_CUDART_ENTRIES: &[&str] = &["cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll"];

/// `&[&str]` listesini motorun beklediği sahiplenilmiş `Vec<String>`'e çevir.
fn wanted_entries(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_string()).collect()
}

/// Ortak indirme gövdesi: işi kaydet, tek motordan indir. Hata kullanıcıya Türkçe
/// gider (`user_message`); teknik ayrıntı arayüze sızdırılmaz.
async fn run_component_download(
    app: &AppHandle,
    plan: DownloadPlan,
    job_id: &str,
) -> Result<(), String> {
    let cancel = component_download::register_job(job_id);
    component_download::run_download(app, plan, job_id, cancel)
        .await
        .map_err(|e| e.user_message())
}

#[tauri::command]
pub async fn ai_download_engine(app: AppHandle, payload: Value) -> Result<String, String> {
    let job_id = get_str(&payload, "job_id")?;
    let bdir = binaries_dir(&app)?;
    let target_exe = bdir.join("llama-server.exe");

    // Tekli kuyruk: tüm indirmeler (medya/ffmpeg/whisper/AI) aynı disiplini paylaşır.
    let _guard = crate::download::QUEUE.lock().await;

    // 1. Ana llama-server + kütüphaneler — tek çubukta 0-50 (bugünkü aralık korunur).
    //    `llama-server.exe` varsa indirme atlanır (bugünkü davranış korunur).
    if !target_exe.exists() {
        let plan = DownloadPlan {
            component_id: "llama-engine".to_string(),
            url: LLAMA_ENGINE_URL.to_string(),
            sha256: LLAMA_ENGINE_SHA256.to_string(),
            expected_bytes: Some(LLAMA_ENGINE_MIB * MIB),
            disk_required_bytes: Some(LLAMA_ENGINE_PEAK_BYTES),
            progress_span: Some((0.0, 50.0)),
            payload: Payload::Zip {
                dest_dir: bdir.clone(),
                wanted: wanted_entries(LLAMA_ENGINE_ENTRIES),
                max_entry_bytes: AI_ENGINE_MAX_ENTRY_BYTES,
            },
        };
        run_component_download(&app, plan, &job_id).await?;
    }

    // 2. CUDA 12.4 Runtime kütüphaneleri (cublas64_12.dll, cudart64_12.dll) — 50-100.
    //    İki arşiv aynı ilerleme göstergesini paylaşır: 0-50 / 50-100 (bugünkü gibi).
    let cublas_dll = bdir.join("cublas64_12.dll");
    if !cublas_dll.exists() {
        let plan = DownloadPlan {
            component_id: "llama-cudart".to_string(),
            url: LLAMA_CUDART_URL.to_string(),
            sha256: LLAMA_CUDART_SHA256.to_string(),
            expected_bytes: Some(LLAMA_CUDART_MIB * MIB),
            disk_required_bytes: Some(LLAMA_CUDART_PEAK_BYTES),
            progress_span: Some((50.0, 100.0)),
            payload: Payload::Zip {
                dest_dir: bdir.clone(),
                wanted: wanted_entries(LLAMA_CUDART_ENTRIES),
                max_entry_bytes: AI_ENGINE_MAX_ENTRY_BYTES,
            },
        };
        run_component_download(&app, plan, &job_id).await?;
    }

    Ok("done".to_string())
}

#[tauri::command]
pub async fn ai_download_model(app: AppHandle, payload: Value) -> Result<String, String> {
    let model_type = get_str(&payload, "model_type")?; // "llm" veya "embed"
    let job_id = get_str(&payload, "job_id")?;
    let mdir = models_dir(&app)?;

    let (url, sha256, mib, filename) = if model_type == "llm" {
        (QWEN_14B_URL, QWEN_14B_SHA256, QWEN_14B_MIB, QWEN_14B_FILE)
    } else {
        (BGE_M3_URL, BGE_M3_SHA256, BGE_M3_MIB, BGE_M3_FILE)
    };

    // Tekli kuyruk: indirmeler seri (medya/ffmpeg/whisper/AI).
    let _guard = crate::download::QUEUE.lock().await;

    let target = mdir.join(filename);
    // Mevcut dosya varsa indirme atlanır (bugünkü davranış): sha256 yalnızca yeni
    // indirilen dosyaya uygulanır, kullanıcının elindeki `.gguf` yeniden doğrulanmaz.
    if target.exists() {
        return Ok("done".to_string());
    }

    let plan = DownloadPlan {
        component_id: if model_type == "llm" {
            "ai-model-llm".to_string()
        } else {
            "ai-model-embed".to_string()
        },
        url: url.to_string(),
        sha256: sha256.to_string(),
        expected_bytes: Some(mib * MIB),
        // Raw yük: tepe kullanım indirilen dosyanın kendisidir — `.part` hedef
        // klasörde kalır, doğrulamadan sonra aynı birimde atomik taşınır.
        disk_required_bytes: Some(mib * MIB),
        progress_span: None,
        payload: Payload::Raw {
            dest_dir: mdir.clone(),
            file_name: filename.to_string(),
        },
    };
    run_component_download(&app, plan, &job_id).await?;
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
