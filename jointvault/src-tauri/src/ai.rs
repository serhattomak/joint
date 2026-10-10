use crate::component_download::install_component;
use crate::hardware::{self, GpuInfo};
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

/// İstek-anı kapısı metni: AI kapalıyken sunucu BAŞLATILMAZ, çağırana bu döner.
///
/// Sabit TEK kaynak olması, tüm komutların (sohbet, gömme, etiket, özet,
/// kategorizasyon) aynı dürüst yönlendirmeyi vermesini sağlar. Kopyalansaydı
/// zamanla ayrışır ve kullanıcı hangi komutun ne dediğini bilemezdi.
const AI_DISABLED_MESSAGE: &str =
    "AI kapalı — Ayarlar → AI bölümünden açabilirsiniz.";

// NOT (7c-3 / ai-hardware-floor): llama.cpp motoru, CUDA çalışma zamanı, Qwen ve
// BGE pinleri artık kayıtta (`components.rs`) TEK yerde durur; burada URL/sha256/
// dosya kopyası YOKTUR. İndirmeler `component_download::install_component` üzerinden
// yürür. VARSAYILAN motor Vulkan'dır (`llama-engine`, ~30 MB, GPU'suz makinede
// CPU'ya düşer); CUDA (`llama-engine-cuda` + `llama-cudart`) OPSİYONELdir ve
// varsayılan indirme yolu onu ÇEKMEZ.

// --- Offload kararı (saf) ----------------------------------------------------
//
// SORUN: Spawn bugüne kadar `-ngl 99` SABİTİNİ kullanıyordu ("tüm katmanlar"). 6 GB'lık bir kartta 8,5 GB'lik model GPU'ya itilir ve çalışma
// anında VRAM taşmasıyla çöker; GPU'suz makinede ise bu argüman anlamsızdır.
//
// ÇÖZÜM: Karar, tespit edilen GERÇEK VRAM ile model dosya boyutunun
// karşılaştırmasına dayanır ve saf bir fonksiyonda verilir (G/Ç çağıranda kalır).
// Tespit yoksa ya da VRAM güvenilir değilse GÜVENLİ seçim CPU'dur (fail-closed).

/// 1 MiB = 1024×1024 bayt. `hardware.rs` VRAM'i MiB, `components.rs` model
/// boyutlarını MiB cinsinden tutar; karşılaştırma aynı birimde yapılmalıdır.
const BYTES_PER_MIB: u64 = 1024 * 1024;

/// `-ngl` için "tüm katmanlar" işareti.
///
/// llama.cpp `-ngl`'yi üst sınır olarak yorumlar; gerçek katman sayısından büyük
/// bir değer tüm katmanların GPU'ya yüklenmesi demektir. Sihirli sayıyı TEK
/// yerde adlandırırız: karar fonksiyonunun dışında çıplak `99` kalmaz.
const ALL_GPU_LAYERS: u32 = 99;

/// VRAM'de model DIŞINDA gereken pay (MiB).
///
/// NEDEN 2048 MiB? Qwen2.5 14B Q4 (sohbet) için iki kalem:
///   - KV önbelleği: 48 katman × 8 KV başlığı × 128 baş boyutu × 2 (K+V) ×
///     2 bayt (f16) ≈ 0,1875 MiB/token; `-c 8192` → ~1536 MiB.
///   - llama.cpp CUDA compute/scratch arabellekleri + CUDA bağlamı/sürücü
///     rezervi → ~512 MiB.
/// Toplam ≈ 2048 MiB. Bu pay olmadan "model sığar" görünen bir kurulum, bağlam
/// büyüyünce VRAM taşmasıyla çökerdi. Pay KASITLI olarak üst uçtadır: yanlış
/// "sığar" kararı (çökme) yanlış "sığmaz" kararından (daha yavaş ama çalışır)
/// çok daha pahalıdır.
pub const VRAM_RESERVE_MB: u64 = 2048;

/// Offload modu: tel/arayüzde küçük harf (`"gpu"` / `"cpu"`).
#[derive(Serialize, Deserialize, PartialEq, Eq, Clone, Copy, Debug)]
#[serde(rename_all = "lowercase")]
pub enum OffloadMode {
    /// Tüm katmanlar GPU'ya yüklenir.
    Gpu,
    /// Model CPU'da çalışır (VRAM yok/yetmez veya boyut bilinmiyor).
    Cpu,
}

/// Offload kararı: kaç katman GPU'ya, hangi modda ve NEDEN.
///
/// Sözleşme adı `OffloadDecision`'dır (subtask 04 backend-contract); kodda kısa
/// ad `Offload` kullanılır. `#[doc(alias)]` ikisini arama/dokümanda birleştirir.
#[doc(alias = "OffloadDecision")]
#[derive(Serialize, Deserialize, PartialEq, Eq, Clone, Debug)]
pub struct Offload {
    /// GPU'ya yüklenecek katman sayısı. `ALL_GPU_LAYERS` = hepsi.
    pub n_gpu_layers: u32,
    pub mode: OffloadMode,
    /// Kullanıcıya gösterilebilir Türkçe gerekçe; kararı doğuran sayıları içerir.
    pub reason: String,
    /// Kararda kullanılan model boyutu (MiB). `None` = okunamadı.
    pub model_mb: Option<u64>,
}

/// SAF karar: VRAM ile model boyutunu karşılaştırıp offload'u seçer.
///
/// Girdiler yalnızca tespit SONUÇLARIDIR; bu fonksiyon süreç başlatmaz, dosya
/// okumaz (G/Ç çağıranda). Bu yüzden tüm dallar birim testlenebilir.
///
/// Sıra (sabit; yeniden tartışılmaz):
/// 1. Güvenilir VRAM yoksa (`gpu` yok ya da `vram_mb` `None`) → CPU.
/// 2. Model boyutu bilinmiyorsa → CPU (uydurma YOK, temkinli davran).
/// 3. `vram_mb >= model_mb + reserve_mb` → tüm katmanlar; aksi hâlde → CPU.
pub fn decide_offload(gpu: Option<&GpuInfo>, model_bytes: Option<u64>, reserve_mb: u64) -> Offload {
    // 1) VRAM yok: tespit başarısız (hiç GPU yok) ya da yalnızca ad var (WMI).
    let vram_mb = match gpu.and_then(|g| g.vram_mb) {
        Some(vram) => vram,
        None => {
            // WMI yalnızca AD verir; VRAM'in neden yokluğunu kullanıcıya ayırt
            // ettiririz ki "GPU'm var, neden CPU?" kafa karışıklığı oluşmasın.
            let reason = match gpu {
                Some(info) if info.name.is_some() => format!(
                    "GPU adı tespit edildi ({}) ama güvenilir VRAM okunamadı; \
                     CPU'da çalıştırılır.",
                    info.name.as_deref().unwrap_or("bilinmiyor")
                ),
                _ => "Donanım tespit edilemedi (güvenilir GPU VRAM bilgisi yok); \
                      CPU'da çalıştırılır."
                    .to_string(),
            };
            return Offload {
                n_gpu_layers: 0,
                mode: OffloadMode::Cpu,
                reason,
                model_mb: model_bytes.map(|b| b / BYTES_PER_MIB),
            };
        }
    };

    // 2) VRAM var ama model boyutu okunamadı: sayı uydurmayız → CPU.
    let model_mb = match model_bytes.map(|b| b / BYTES_PER_MIB) {
        Some(mb) => mb,
        None => {
            return Offload {
                n_gpu_layers: 0,
                mode: OffloadMode::Cpu,
                reason: format!(
                    "Model dosya boyutu okunamadı; temkinli seçim: CPU'da çalıştırılır \
                     (VRAM {vram_mb} MB)."
                ),
                model_mb: None,
            };
        }
    };

    // 3) Sığdırma kararı: model + pay VRAM'e sığıyorsa hepsi GPU'ya.
    let needed_mb = model_mb.saturating_add(reserve_mb);
    if vram_mb >= needed_mb {
        Offload {
            n_gpu_layers: ALL_GPU_LAYERS,
            mode: OffloadMode::Gpu,
            reason: format!(
                "VRAM yeterli: {vram_mb} MB ≥ model {model_mb} MB + {reserve_mb} MB pay; \
                 tüm katmanlar GPU'ya yüklenir."
            ),
            model_mb: Some(model_mb),
        }
    } else {
        Offload {
            n_gpu_layers: 0,
            mode: OffloadMode::Cpu,
            reason: format!(
                "VRAM yetersiz: {vram_mb} MB < model {model_mb} MB + {reserve_mb} MB pay; \
                 CPU'da çalıştırılır."
            ),
            model_mb: Some(model_mb),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AiConfig {
    /// ANA anahtar: yerel AI açık mı?
    ///
    /// `Some` kullanıcının AÇIK seçimidir ve göç kuralı tarafından ASLA ezilmez
    /// (aksi hâlde "kapat" seçimi, modeller diskte kaldığı için bir sonraki
    /// açılışta sessizce "açık"a dönerdi). `None` yalnızca bu alanı hiç
    /// yazmamış ESKİ yapılandırmayı işaret eder ve `resolve_ai_enabled` ile
    /// göç ettirilir.
    ///
    /// `#[serde(default)]` ZORUNLU: eski kayıtlarda bu alan yoktur; eksik alan
    /// `None`'a düşmezse tüm config dosyası ayrıştırılamaz ve kullanıcının
    /// yolları/tercihleri sessizce varsayılana sıfırlanırdı.
    #[serde(default)]
    pub enabled: Option<bool>,
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
            // Temiz kurulum AÇIKÇA kapalı başlar: model indirilmeden AI etkin
            // sayılmaz ve açılışta hiçbir süreç başlamaz (fail-closed).
            enabled: Some(false),
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
    /// Bu slot için UYGULANAN offload kararı (spawn anında hesaplanır). `None` =
    /// henüz başlatılmadı. Karar+gerekçe `ai_status`'a buradan yansır; böylece
    /// arayüz "neden CPU?" sorusunu gerçek kararla yanıtlar.
    offload: Option<Offload>,
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

/// Model klasörü — kayıttaki `Dest::Models` hedefiyle AYNI yer.
///
/// Neden delege? Klasör ADI (`jointvault-models`) hem burada hem kayıtta yazılırsa
/// zamanla ayrışır ve `components_status` "kurulu" derken AI "bulunamadı" derdi.
/// Tek tanım `components::dest_dir`'dir; hata metni de oradan gelir.
pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::components::dest_dir(app, crate::components::Dest::Models)
}

/// AI ikili klasörü — kayıttaki `Dest::Binaries` hedefiyle AYNI yer.
/// Gerekçe `models_dir` ile aynıdır: yolun tek kaynağı kayıt olmalıdır.
pub fn binaries_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::components::dest_dir(app, crate::components::Dest::Binaries)
}

/// Kayıttaki bileşen dosya adını çöz (tek kaynak: `components::spec_for`).
///
/// Dosya adı burada da yazılırsa kayıtla ayrışabilir ve kurulu bir `.gguf`/exe
/// "bulunamadı" görünerek gereksiz yeniden indirmeye yol açabilir; ad kayıttan okunur.
fn component_file_name(id: &str) -> Option<&'static str> {
    crate::components::spec_for(id).map(|spec| spec.downloaded_file)
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

/// Yerel AI'nın açık mı kapalı mı olduğunu SAF olarak çözer.
///
/// Yan etkisi yoktur; `AppHandle`/dosya/disk erişimi YOKTUR — bu yüzden
/// doğrudan birim testlenebilir ve karar TEK bir yerde durur.
///
/// Karar sırası (sabit; yeniden tartışılmaz):
///
/// 1. `stored` (kullanıcının açık seçimi) `Some` ise O kazanır. Kullanıcı bir
///    kez seçim yaptıysa bu kalıcıdır: aksi hâlde "AI'yı kapat" seçimi,
///    modeller diskte kaldığı için bir sonraki açılışta sessizce "açık"a
///    dönerdi.
/// 2. `stored` `None` ise (bu alanı hiç yazmamış eski yapılandırma) göç kuralı
///    uygulanır: AI yalnızca motor VE sohbet modeli (LLM) varsa etkin sayılır.
///    BGE/gömme modeli OPSİYONELDİR — onsuz yalnızca anlamsal arama zayıflar,
///    sohbet çalışır. Bu yüzden temiz kurulum (indirilmiş model yok) KAPALI
///    gelir ve çalışan bir kurulum sessizce bozulmaz.
///
/// `auto_warmup` karara KASITLI olarak KATILMAZ: o, açılışta ön yüklemeyi
/// (ısıtmayı) kontrol eden AYRI bir tercihtir. Kullanıcı ısıtmayı kapatmış
/// olabilir ama asistanı kapatmamıştır; ikisini karıştırmak `auto_warmup:
/// false` olan eski bir kurulumu yanlışlıkla "kapalı" yapardı. Parametre
/// yalnızca sözleşmeyi ve testleri görünür kılmak için imzada durur.
pub fn resolve_ai_enabled(
    stored: Option<bool>,
    engine_present: bool,
    llm_present: bool,
    auto_warmup: Option<bool>,
) -> bool {
    // Isıtma tercihi bu kararın girdisi DEĞİLDİR (yukarıdaki gerekçe).
    let _ = auto_warmup;

    match stored {
        Some(explicit) => explicit,
        None => engine_present && llm_present,
    }
}

/// Çalışma anında "AI açık mı?" kararı — TEK yol.
///
/// `resolve_ai_enabled` saf kuraldır; göç kuralı diske (motor + LLM varlığına)
/// baktığı için varlık kontrolleri burada G/Ç sınırında yapılır ve saf karara
/// beslenir. Tüm kapılar (açılış ısıtması, istek-anı) bu fonksiyonu çağırır;
/// "AI açık mı" sorusu başka hiçbir yerde TEKRAR yazılmaz.
fn ai_enabled_now(app: &AppHandle, cfg: &AiConfig) -> bool {
    let engine = resolve_engine_path(app, cfg).is_some();
    let llm = resolve_llm_path(app, cfg).is_some();
    resolve_ai_enabled(cfg.enabled, engine, llm, cfg.auto_warmup)
}

fn resolve_engine_path(app: &AppHandle, cfg: &AiConfig) -> Option<PathBuf> {
    if let Some(ref p) = cfg.engine_path {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    // G5/H-3: CUDA motoru AYRI dizinde yaşar (`jointvault-binaries/llama-cuda`) ki
    // `llama-server.exe` adıyla Vulkan motorunu ezmesin. YALNIZCA NVIDIA tespit
    // edilirse tercih edilir (`nvidia-smi` VRAM verir): salt dosya varlığına bakmak,
    // AMD/Intel/GPU'suz makinede yanlışlıkla kurulmuş CUDA build'ini seçerdi ve o
    // build sürücüsüz makinede `ggml-cuda.dll` yükleyip çökebilir. NVIDIA yoksa
    // aşağıda Vulkan motoruna düşülür.
    if crate::hardware::detect().has_vram() {
        if let Ok(cuda_dir) = crate::components::dest_dir(app, crate::components::Dest::BinariesCuda) {
            if let Some(file) = component_file_name("llama-engine-cuda") {
                let p = cuda_dir.join(file);
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }
    if let Ok(bdir) = binaries_dir(app) {
        // Motorun çalıştırılabilir adı da kayıttan gelir (`llama-engine`); kopya YOK.
        if let Some(file) = component_file_name("llama-engine") {
            let p = bdir.join(file);
            if p.exists() {
                return Some(p);
            }
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
        // Kanonik adlar kayıttan gelir; kopya sabit YOK. Sıra 14B → 7B → 3B:
        // mevcut kullanıcı (yalnız 14B) aynı dosyayı çözmeye devam eder, seçim
        // yapılmamışsa ilk KURULU sohbet modeli tercih edilir.
        for id in crate::components::CHAT_MODEL_IDS {
            if let Some(file) = component_file_name(id) {
                let p = mdir.join(file);
                if p.exists() {
                    return Some(p);
                }
            }
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

/// SAF: verilen dosya adı kayıtlı (sha256 pinli) bir sohbet modeli mi?
///
/// I/O yoktur → doğrudan testlenir. `llm_is_verified` dizin kontrolünü ekler.
fn is_registered_chat_file(name: &str) -> bool {
    crate::components::CHAT_MODEL_IDS
        .iter()
        .any(|id| component_file_name(id) == Some(name))
}

/// Seçili sohbet modeli KAYITLI (sha256 pinli) mı, yoksa serbest bir `.gguf` mı?
///
/// Doğrulama YALNIZCA `models_dir` içindeki, kayıtlı bir sohbet modeli dosya adına
/// birebir uyan yol için `true`'dur. Başka dizinden seçilen (ör. İndirilenler'deki)
/// aynı adlı dosya "doğrulanmadı" sayılır: serbest GGUF'a hak etmediği bir güven
/// damgası gösterilmez (uydurma kaynak yok — security-patterns).
fn llm_is_verified(app: &AppHandle, path: &std::path::Path) -> bool {
    let Ok(mdir) = models_dir(app) else {
        return false;
    };
    if path.parent() != Some(mdir.as_path()) {
        return false;
    }
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    is_registered_chat_file(name)
}

/// Seçili sohbet modelinin kullanıcıya gösterilecek adı: kayıtlıysa registry
/// etiketi (ör. "Qwen 2.5 7B (sohbet)"), serbest GGUF'sa dosya adı. Uydurma
/// etiket üretilmez.
fn llm_display_label(app: &AppHandle, path: &std::path::Path) -> Option<String> {
    let name = path.file_name().and_then(|n| n.to_str())?;
    if llm_is_verified(app, path) {
        return crate::components::CHAT_MODEL_IDS.iter().find_map(|id| {
            let spec = crate::components::spec_for(id)?;
            (spec.downloaded_file == name).then(|| spec.label.to_string())
        });
    }
    Some(name.to_string())
}

fn resolve_embed_path(app: &AppHandle, cfg: &AiConfig) -> Option<PathBuf> {
    if let Some(ref p) = cfg.embed_path {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    if let Ok(mdir) = models_dir(app) {
        // Kanonik ad kayıttan gelir (`ai-model-embed`); kopya sabit YOK.
        if let Some(file) = component_file_name("ai-model-embed") {
            let p = mdir.join(file);
            if p.exists() {
                return Some(p);
            }
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
                offload: None,
            },
            embed: ProcessSlot {
                child: None,
                last_active: Instant::now(),
                port: EMBED_PORT,
                offload: None,
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

/// Isıtma kapısı (SAF): yalnızca AI ETKİN ve `auto_warmup` açıkken `true`.
///
/// Sıra kasıtlıdır: `ai_enabled` solda olduğundan kısa devre ÖNCE etkinliği
/// denetler ve `auto_warmup` onun ALTINDA kalır. Ters sıra (önce ısıtma), AI
/// kapalı ama ısınma tercihi açık bırakılmış eski bir kurulumda süreç
/// doğururdu; oysa kapalı bir özellik arka planda iş yapmamalıdır.
///
/// `AppHandle`/G/Ç yoktur → birim testlenebilir.
fn should_warmup(ai_enabled: bool, auto_warmup: bool) -> bool {
    ai_enabled && auto_warmup
}

pub async fn warmup_ai_async(app: AppHandle) -> Result<(), String> {
    init_manager_if_needed(&app);
    let (ai_enabled, auto_warmup, has_engine, has_llm, has_embed) = {
        let lock = MANAGER.lock().unwrap();
        if let Some(ref mgr) = *lock {
            let eng = resolve_engine_path(&app, &mgr.config).is_some();
            let llm = resolve_llm_path(&app, &mgr.config).is_some();
            let emb = resolve_embed_path(&app, &mgr.config).is_some();
            (
                // Tek karar noktası: aynı `resolve_ai_enabled` + varlık kontrolleri.
                resolve_ai_enabled(mgr.config.enabled, eng, llm, mgr.config.auto_warmup),
                mgr.config.auto_warmup.unwrap_or(true),
                eng,
                llm,
                emb,
            )
        } else {
            (false, false, false, false, false)
        }
    };

    // AÇILIŞ KAPISI: AI kapalıyken HİÇBİR süreç başlatılmaz — ne model
    // yüklemesi ne de "yükleniyor" durumu yayılır (yanıltıcı olay bile yok).
    // `auto_warmup` denetimi bu kapının ALTINDADIR (`should_warmup` soldan
    // kısa devre yapar). Fail-closed: kararsızlıkta çalıştırma, durdur.
    if !should_warmup(ai_enabled, auto_warmup) {
        return Ok(());
    }

    // Motor yoksa yapılacak iş yok; bu bir HATA değildir (henüz kurulmamış olabilir).
    if !has_engine {
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

    // Donanım metni SABİT değil: gerçek tespitten gelir; yoksa dürüstçe
    // "bilinmiyor". Sabit bir GPU adı başka makinede yalan olurdu.
    let gpu_label = hardware::detect()
        .name
        .unwrap_or_else(|| "bilinmiyor".to_string());
    let _ = app.emit("ai-warmup-status", serde_json::json!({
        "status": "ready",
        "message": format!("Yapay zekâ hazır ({gpu_label})")
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

        // İSTEK-ANI KAPISI: AI kapalıyken sunucu BAŞLATILMAZ. Kapı, slot
        // durumuna bakmadan ÖNCE çalışır; böylece kapalı bir özellik gizli bir
        // sürece hizmet edemez ve yeni süreç doğurmaz. Karar TEK yerden gelir
        // (`ai_enabled_now`), böylece "açık mı" kuralı kopyalanmaz.
        if !ai_enabled_now(app, &mgr.config) {
            return Err(AI_DISABLED_MESSAGE.to_string());
        }

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
            resolve_llm_path(app, &mgr.config).ok_or_else(|| "Seçili sohbet modeli bulunamadı.".to_string())?
        } else {
            resolve_embed_path(app, &mgr.config).ok_or_else(|| "BGE-M3 modeli bulunamadı.".to_string())?
        };

        let chosen_port = find_available_port(slot.port);
        slot.port = chosen_port;

        (engine, model, chosen_port)
    };

    // Offload KARARI (sabit "99" YOK): tespit edilen VRAM ile BU modelin gerçek
    // dosya boyutu karşılaştırılır. G/Ç burada (dosya boyutu + tespit), karar saf
    // `decide_offload`'da verilir. Tespit pahalı olabilir (süreç başlatır) ama
    // kilit ALTINDA değiliz; kilit yalnızca slot durumu için tutulur.
    let gpu = hardware::detect();
    let model_bytes = std::fs::metadata(&model).ok().map(|m| m.len());
    let offload = decide_offload(Some(&gpu), model_bytes, VRAM_RESERVE_MB);

    // Sunucu komutunu oluştur
    let mut cmd = std::process::Command::new(&engine);
    cmd.arg("-m")
        .arg(&model)
        .arg("--port")
        .arg(port.to_string())
        .arg("--host")
        .arg("127.0.0.1")
        .arg("-ngl")
        .arg(offload.n_gpu_layers.to_string())
        .arg("-c")
        .arg(if slot_type == "chat" { "8192" } else { "4096" });

    // `-b`/`-ub`: llama.cpp varsayılanı `-b 2048`; bundan UZUN prompt'lar
    // "input is too large to process" ile REDDEDİLİR ve o çağrının tüm kayıtları
    // kaybolur. Sohbet prompt'u (yönerge + taksonomi + etiket listesi + kayıtlar)
    // taksonomi/etiket büyüdükçe 2048'i aşıyor — logda 4160 token ile reddedilen
    // bir çağrı görüldü. `-ub` hesaplama arabelleğini belirlediği için ölçülü.
    let (batch, ubatch) = if slot_type == "chat" {
        ("4096", "1024")
    } else {
        ("2048", "2048")
    };
    cmd.arg("-b").arg(batch).arg("-ub").arg(ubatch);

    if slot_type == "embed" {
        cmd.arg("--embedding");
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
            // Uygulanan kararı sakla: `ai_status` bunu gerekçesiyle raporlar.
            slot.offload = Some(offload.clone());
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

/// Fail-closed kapısı: pahalı iş (whisper/çıkarım) BAŞLAMADAN önce çağrılır.
///
/// `ensure_server_running("chat")` zaten AI kapalıysa `AI_DISABLED_MESSAGE`,
/// motor/model eksikse ilgili Türkçe hatayı döner. Böylece "AI yok" durumu,
/// dakikalarca sürebilecek transkript/whisper adımından ÖNCE yakalanır. Aynı
/// çağrı sohbet sunucusunu da ısıtır; ilk `chat_completion` model yüklemesi
/// yüzünden beklenmedik şekilde gecikmez.
///
/// Kuyruk kilidi (`download::QUEUE`) BURADA ALINMAZ (çağıran komut katmanı alır).
pub(crate) async fn ensure_chat_ready(app: &AppHandle) -> Result<(), String> {
    ensure_server_running(app, "chat").await.map(|_| ())
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
    // Tespit pahalı olabilir (ilk çağrıda süreç başlatır); MANAGER kilidini
    // tutmadan ÖNCE yap ki diğer AI komutlarını gereksiz yere bekletmesin.
    let gpu = hardware::detect();
    // Toplam RAM (MiB) — sihirbazın donanıma göre model önerisi için. Ayrı tespit;
    // önbellekli olduğundan pahalı süreç yalnızca ilk çağrıda başlar.
    let ram_mb = hardware::detect_ram();
    let mut lock = MANAGER.lock().unwrap();
    let mgr = lock.as_mut().ok_or("Manager başlatılamadı")?;

    let engine = resolve_engine_path(&app, &mgr.config);
    let llm = resolve_llm_path(&app, &mgr.config);
    let embed = resolve_embed_path(&app, &mgr.config);

    // Etkinlik TEK yerden çözülür: kayıtlı seçim varsa o, yoksa göç kuralı.
    // (Süreç kapısı ayrı bir iştir; burada yalnızca durum raporlanır.)
    let ai_enabled = resolve_ai_enabled(
        mgr.config.enabled,
        engine.is_some(),
        llm.is_some(),
        mgr.config.auto_warmup,
    );

    let chat_running = mgr.chat.child.as_mut().map(|c| c.try_wait().map(|s| s.is_none()).unwrap_or(false)).unwrap_or(false);
    let embed_running = mgr.embed.child.as_mut().map(|c| c.try_wait().map(|s| s.is_none()).unwrap_or(false)).unwrap_or(false);

    // Offload raporu: çalışan slotun UYGULANAN kararı varsa o, yoksa bir sonraki
    // başlatma için şimdi hesaplanan karar. İkisi de AYNI saf fonksiyondan gelir,
    // bu yüzden ayrışamazlar. Birincil model sohbet LLM'idir (en büyük); yoksa
    // gömme modeli raporlanır.
    let primary_model = llm.as_ref().or(embed.as_ref());
    let model_bytes = primary_model
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| m.len());
    let offload = mgr
        .chat
        .offload
        .clone()
        .or_else(|| mgr.embed.offload.clone())
        .unwrap_or_else(|| decide_offload(Some(&gpu), model_bytes, VRAM_RESERVE_MB));
    let gpu_name = gpu.name.clone();

    // Seçili sohbet modeli: pinli (doğrulanmış) mı, serbest GGUF (doğrulanmadı) mı?
    // `llm` burada hâlâ ödünç; JSON'da tüketilmeden ÖNCE hesaplanır.
    let llm_verified = llm
        .as_deref()
        .map(|p| llm_is_verified(&app, p))
        .unwrap_or(false);
    let llm_label = llm.as_deref().and_then(|p| llm_display_label(&app, p));

    Ok(serde_json::json!({
        "engine_available": engine.is_some(),
        "engine_path": engine.map(|p| p.to_string_lossy().to_string()),
        "llm_ready": llm.is_some(),
        "llm_path": llm.map(|p| p.to_string_lossy().to_string()),
        // YALNIZCA EK alanlar: seçili sohbet modelinin etiketi ve doğrulama damgası.
        // Serbest `.gguf` (kayıt dışı) "doğrulanmadı" olarak raporlanır; eski
        // tüketiciler bu iki alanı yok sayar (mevcut anahtarlar değişmedi).
        "llm_verified": llm_verified,
        "llm_label": llm_label,
        "embed_ready": embed.is_some(),
        "embed_path": embed.map(|p| p.to_string_lossy().to_string()),
        "chat_server_running": chat_running,
        "embed_server_running": embed_running,
        "external_api_url": mgr.config.external_api_url,
        // YALNIZCA EK alan: mevcut anahtarların adı/şekli değişmez.
        "ai_enabled": ai_enabled,
        // YALNIZCA EK alanlar: donanım tespiti ve offload kararı/gerekçesi.
        // Arayüz bu sayede "neden GPU/CPU?" sorusunu dürüstçe yanıtlar.
        "gpu": {
            "name": gpu_name,
            "vram_mb": gpu.vram_mb,
            "source": gpu.source,
        },
        // YALNIZCA EK alan: toplam sistem RAM'i (MiB), opsiyonel. Tespit
        // başarısızsa `null` — uydurma sayı yok. Eski tüketiciler yok sayar.
        "ram_mb": ram_mb,
        "offload": {
            "mode": offload.mode,
            "n_gpu_layers": offload.n_gpu_layers,
            "reason": offload.reason,
            "gpu_name": gpu.name,
            "vram_mb": gpu.vram_mb,
            "model_mb": offload.model_mb,
        },
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

    // ANA anahtar önce: kullanıcının açık/kapalı seçimi kalıcı yazılır.
    if let Some(v) = payload.get("enabled").and_then(|v| v.as_bool()) {
        mgr.config.enabled = Some(v);
    }
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

// NOT (7c-3): Pin boyutları, arşiv girdi listeleri (`wanted`), zip-bomba sınırları
// ve indirme gövdesi artık burada DEĞİL. Hepsi kayıtta (`components.rs`) tanımlı ve
// `component_download::install_component` üzerinden uygulanır; aşağıdaki komutlar
// yalnızca delege eder. Böylece "ne iniyor" sorusunun tek kaynağı kalır.

#[tauri::command]
pub async fn ai_download_engine(app: AppHandle, payload: Value) -> Result<String, String> {
    let job_id = get_str(&payload, "job_id")?;

    // VARSAYILAN yol: yalnızca Vulkan motoru (~30 MB). CUDA ARTIK ÇEKİLMEZ —
    // ~615 MB'lık NVIDIA-özel indirme, varsayılan kuruluma girmemeli. GPU'suz
    // makinede Vulkan derlemesi CPU'ya düşer (llama.cpp PR #14099), yani bu yol
    // her makinede çalışır.
    //
    // OPSİYONEL CUDA: kullanıcı açıkça isterse `component_download` komutuyla
    // `llama-engine-cuda` + `llama-cudart` indirilir (kayıt: components.rs).
    //
    // "Varsa atla" davranışı `install_component`'ta korunur: kayıt hedef dosya
    // (`llama-server.exe`) varsa indirmeyi atlar ve %100 olayı yayar.
    //
    // ÖNEMLİ: kuyruk kilidi (`download::QUEUE`) `install_component` içinde alınır;
    // burada ayrıca ALINMAZ (alınsaydı iç çağrı kilitlenirdi).
    install_component(&app, "llama-engine", &job_id, None).await?;

    Ok("done".to_string())
}

#[tauri::command]
pub async fn ai_download_model(app: AppHandle, payload: Value) -> Result<String, String> {
    let model_type = get_str(&payload, "model_type")?; // "llm" veya "embed"
    let job_id = get_str(&payload, "job_id")?;

    // Tür → kayıt kimliği eşlemesi tek yerde. "llm" dışındaki değer, mevcut
    // davranışı koruyarak gömme modeline düşer (payload şekli ve "done" dönüşü sabit).
    let component_id = if model_type == "llm" {
        "ai-model-llm"
    } else {
        "ai-model-embed"
    };

    // Pin/URL/yol kopyası YOK: kuruluysa `install_component` atlar (ve %100 yayar),
    // değilse tek motordan iner; kuyruk disiplini de orada uygulanır.
    install_component(&app, component_id, &job_id, None).await?;
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

// Yeniden kullanılabilir sohbet tamamlama: sunucuyu (gerekirse) başlatır, tek
// system+user iletili istek atar ve `choices[0].message.content` döndürür.
//
// Kuyruk kilidi (`download::QUEUE`) BURADA ALINMAZ: yeniden-girilemez mutex
// çağıran komut katmanına aittir (aynı gerekçe `analyze::acquire_transcript`).
pub(crate) async fn chat_completion(
    app: &AppHandle,
    system: &str,
    user: &str,
    temperature: f32,
    max_tokens: u32,
) -> Result<String, String> {
    let port = ensure_server_running(app, "chat").await?;
    let url = format!("http://127.0.0.1:{port}/v1/chat/completions");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user }
            ],
            "temperature": temperature,
            "max_tokens": max_tokens
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
        .unwrap_or("")
        .trim();

    Ok(content.to_string())
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

    let existing_category_tree = payload
        .get("existing_category_tree")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let existing_tags: Vec<String> = serde_json::from_value(
        payload.get("existing_tags").cloned().unwrap_or(Value::Array(vec![])),
    )
    .unwrap_or_default();

    let cat_tree_str = if existing_category_tree.is_empty() {
        "Henüz kategori yok".to_string()
    } else {
        existing_category_tree
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
        "Aşağıdaki medya kaydını analiz et, en uygun KATEGORİYİ ve etiketleri belirle.\n\n\
        TAKSONOMİ (girinti = seviye; yalnız bu ağaçtaki adlar geçerlidir):\n\
        {cat_tree_str}\n\n\
        TAKSONOMİ KURALLARI:\n\
        1. Kayda uyan EN DERİN düğümü seç. \"Sütlaç\" tarifi geldiyse \"Sütlü Tatlı\" seç\n\
           (\"Tatlı\" değil; ikisi de uymuyorsa en derin uyanı).\n\
        2. Mevcut düğümlerin altına YENİ ara seviye kurma (\"Tatlı\" varken \"Sütlü Tatlı\"yı\n\
           yalnız kayıt gerçekten sütlü ise öner).\n\
        3. Hiçbiri uymuyorsa `yeni` alanını doldur: {{\"ust\":\"...\",\"alt\":\"...\"}} — `ust`\n\
           ağaçta VAR OLAN bir düğüm olmalı; yoksa düğüm önerilmez (uydurma dal yasak).\n\
        4. ETİKET — son tercih: önce mevcut listeden uygun olanı seç [{existing_tag_str}].\n\
           Hiçbiri kaydı gerçekten TANIMLAMIYORSA etiket üretme; en fazla 1 yeni etiket\n\
           üret ve `yeni_etiket_gerekce` alanına nedenini yaz. Başına '#' koyma, sade tut.\n\n\
        5. ÖZET: İçeriği tek cümleyle net bir şekilde özetle.\n\
        6. GÜVEN SKORU: Önerinin içeriğe uygunluğuna 0.0 ile 1.0 arasında bir confidence ver.\n\n\
        ÇIKTI FORMATI: Yanıt olarak SADECE geçerli bir JSON nesnesi döndür.\n\
        Örnek (mevcut kategori):\n\
        {{\"kategori\":\"Sütlü Tatlı\",\"ust\":null,\"yeni\":null,\"tags\":[\"süt\"],\"yeni_etiket\":null,\"yeni_etiket_gerekce\":null,\"summary\":\"Sütlaç tarifi.\",\"confidence\":0.95}}\n\
        Örnek (hiçbir şey uymuyor, yeni kategori):\n\
        {{\"kategori\":null,\"ust\":null,\"yeni\":{{\"ust\":\"Tatlı\",\"alt\":\"Muhallebi\"}},\"tags\":[],\"yeni_etiket\":null,\"yeni_etiket_gerekce\":null,\"summary\":\"Muhallebi tarifi.\",\"confidence\":0.8}}\n\n\
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
            "kategori": null,
            "ust": null,
            "yeni": null,
            "tags": [],
            "yeni_etiket": null,
            "yeni_etiket_gerekce": null,
            "summary": "",
            "confidence": 0.0
        }))
    } else {
        serde_json::json!({
            "kategori": null,
            "ust": null,
            "yeni": null,
            "tags": [],
            "yeni_etiket": null,
            "yeni_etiket_gerekce": null,
            "summary": "",
            "confidence": 0.0
        })
    };

    Ok(parsed)
}

/// Tek HTTP çağrısıyla birden çok kaydı kategorize eder.
///
/// Neden toplu: `llama-server` TEK slot ile çalışır (`-c 8192`, `--parallel`
/// yok), yani eşzamanlı HTTP istekleri sunucuda sıraya girer ve kazandırmaz.
/// Darboğaz çağrı SAYISIDIR: 100 kayıt = 100 tur yerine ~10 tur.
///
/// `--parallel N` EKLENMEZ: `-c` slot sayısına bölündüğü için her slot'a
/// `8192/N` düşer ve taksonomi listesiyle birlikte uzun prompt'lar
/// taşmaya başlar. Ölçülen kazanç, kaybedilen bağlamdan büyük değil.
///
/// Çıktı, `ai_categorize_and_tag` ile aynı şemada TEK kayıt listesi döner;
/// sıra girdiyle birebir korunur.
#[tauri::command]
pub async fn ai_categorize_batch(app: AppHandle, payload: Value) -> Result<Value, String> {
    let items: Vec<Value> = serde_json::from_value(
        payload.get("items").cloned().unwrap_or(Value::Array(vec![])),
    )
    .unwrap_or_default();

    if items.is_empty() {
        return Ok(serde_json::json!([]));
    }

    let existing_category_tree = payload
        .get("existing_category_tree")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let existing_tags: Vec<String> = serde_json::from_value(
        payload.get("existing_tags").cloned().unwrap_or(Value::Array(vec![])),
    )
    .unwrap_or_default();

    let cat_tree_str = if existing_category_tree.is_empty() {
        "Henüz kategori yok".to_string()
    } else {
        existing_category_tree
    };
    let existing_tag_str = if existing_tags.is_empty() {
        "Henüz etiket yok".to_string()
    } else {
        existing_tags.join(", ")
    };

    // Kayıt başına kısa özet: ham içerik 3000 karakteri aşınca toplam prompt
    // bağlamı taşar ve toplu çağrının kendisi yavaşlar.
    let mut blocks: Vec<String> = Vec::with_capacity(items.len());
    for (i, item) in items.iter().enumerate() {
        let title = item.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let text = item.get("text").and_then(|v| v.as_str()).unwrap_or("");
        let platform = item.get("platform").and_then(|v| v.as_str()).unwrap_or("");
        let snippet: String = if text.chars().count() > 700 {
            text.chars().take(700).collect::<String>() + "..."
        } else {
            text.to_string()
        };
        blocks.push(format!(
            "KAYIT {i}:\n- Başlık: {title}\n- Platform: {platform}\n- İçerik: {snippet}"
        ));
    }

    let prompt = format!(
        "Aşağıdaki {n} medya kaydını analiz et. Her kayıt için TAM OLARAK 1 kategori ve en fazla 4 etiket belirle.\n\n\
         TAKSONOMİ (girinti = seviye; yalnız bu ağaçtaki adlar geçerlidir):\n\
         {cat_tree_str}\n\n\
         KURALLAR (her kayıt için ayrı ayrı uygula):\n\
         1. Kayda uyan EN DERİN düğümü seç (\"Sütlaç\" için \"Sütlü Tatlı\", \"Tatlı\" değil).\n\
         2. Mevcut düğümlerin altına yeni ara seviye kurma; yalnız kayıt gerçekten gerektiriyorsa öner.\n\
         3. Hiçbiri uymuyorsa `e` alanını doldur: {{\"ust\":\"<ağaçta VAR OLAN üst>\",\"alt\":\"<yeni alt>\"}}; `k` null kalır.\n\
         4. ETİKET son tercih: önce mevcutlardan uygun olanı seç [{existing_tag_str}].\n\
            Hiçbiri kaydı gerçekten tanımlamıyorsa etiket ÜRETME; en fazla 1 yeni etiket `y` alanına, nedenini `g` alanına yaz.\n\n\
         ÇIKTI: SADECE {n} elemanlı geçerli JSON DİZİSİ döndür, markdown yok.\n\
         Eleman sırası KAYIT 0..{last} ile BİREBİR aynı olmalı.\n\
         Alanlar: i=sıra no, k=kategori adı, e={{\"ust\":\"<üst>\",\"alt\":\"<alt>\"}} yeni kategori, t=etiket dizisi, y=yeni etiket, g=yeni etiket gerekçesi, c=güven 0.0-1.0.\n\
         BOŞ ALANI HİÇ YAZMA — null değeri üretme, alanı satırdan çıkar. Yalnız dolu alanları yaz.\n\
         Örnekler:\n\
         {{\"i\":0,\"k\":\"Sütlü Tatlı\",\"t\":[\"süt\"],\"c\":0.95}}\n\
         {{\"i\":1,\"k\":\"Pizza\",\"c\":0.9}}\n\
         {{\"i\":2,\"e\":{{\"ust\":\"Tatlı\",\"alt\":\"Muhallebi\"}},\"c\":0.8}}\n\n\
         {records}",
        n = items.len(),
        last = items.len().saturating_sub(1),
        records = blocks.join("\n\n")
    );

    let port = ensure_server_running(&app, "chat").await?;
    let api_url = format!("http://127.0.0.1:{port}/v1/chat/completions");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    // Ölçüm: toplu işin darboğazı üretim (çıktı) tokenıdır. Süre + kullanım
    // sayıları çağırana döner; böylece hız kararları tahminle değil sayıyla
    // verilir (hangi kaldıraç işe yarıyor: bağlam, paralel slot, batch boyu).
    let t0 = std::time::Instant::now();
    let resp = client
        .post(&api_url)
        .json(&serde_json::json!({
            "messages": [
                {
                    "role": "system",
                    "content": "Sen JointVault kişisel medya kasası için çalışan uzman bir içerik taksonomi motorusun. Çıktıyı SADECE belirtilen JSON formatında üretirsin."
                },
                { "role": "user", "content": prompt }
            ],
            "temperature": 0.2,
            // Üretim tavanı: normalde kayıt başına ~30 token (8 kayıtta ~240).
            // Tavan olmadan sunucu varsayılanına (2048) kadar kaçabiliyor; logda
            // tek bir çağrının 26 sn sürdüğü görüldü. Tavan batch boyuyla
            // ölçeklenir; kayıt başına 80 token bolca pay bırakır.
            "max_tokens": (items.len() as u64) * 80 + 64
        }))
        .send()
        .await
        .map_err(|e| format!("Toplu kategorizasyon API çağrısı başarısız: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Toplu kategorizasyon API hatası: {e}"))?;

    let res_json: Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = res_json
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c0| c0.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|s| s.as_str())
        .unwrap_or("[]");

    let start = content.find('[');
    let end = content.rfind(']');
    let parsed: Vec<Value> = match (start, end) {
        (Some(s), Some(e)) if e > s => {
            serde_json::from_str(&content[s..=e]).unwrap_or_default()
        }
        _ => Vec::new(),
    };

    // Yanıt eksik/kısa olursa eksik kayıtlar boş sonuçla doldurulur; çağıran
    // taraf `index` ile eşleştirip sessizce kayıp bırakmaz.
    // Sıra anahtarı iki şemada da kabul edilir: kısa `i`, uzun `index`.
    let mut out: Vec<Value> = vec![Value::Null; items.len()];
    for entry in parsed {
        let Some(idx) = entry
            .get("i")
            .or_else(|| entry.get("index"))
            .and_then(|v| v.as_u64())
        else {
            continue;
        };
        if (idx as usize) < out.len() {
            out[idx as usize] = entry;
        }
    }

    let usage = res_json.get("usage");
    let stats = serde_json::json!({
        "prompt_tokens": usage
            .and_then(|u| u.get("prompt_tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        "completion_tokens": usage
            .and_then(|u| u.get("completion_tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        "elapsed_ms": t0.elapsed().as_millis() as u64,
    });

    Ok(serde_json::json!({ "entries": out, "stats": stats }))
}

#[cfg(test)]
mod tests {
    use super::{
        decide_offload, is_registered_chat_file, resolve_ai_enabled, should_warmup, OffloadMode,
        AI_DISABLED_MESSAGE, ALL_GPU_LAYERS, BYTES_PER_MIB, VRAM_RESERVE_MB,
    };
    use crate::hardware::{GpuInfo, GpuSource};

    // --- kullanıcı seçimi (`stored`) HER ZAMAN kazanır ---

    #[test]
    fn stored_true_wins_even_when_nothing_is_installed() {
        // Açık seçim göç tarafından EZİLMEZ; model sonradan silinse bile korunur.
        assert!(resolve_ai_enabled(Some(true), false, false, None));
        assert!(resolve_ai_enabled(Some(true), false, false, Some(false)));
    }

    #[test]
    fn stored_true_wins_when_models_are_present() {
        assert!(resolve_ai_enabled(Some(true), true, true, Some(false)));
    }

    #[test]
    fn stored_false_stays_off_even_with_everything_present() {
        // "Kapat" kalıcıdır: modeller diskte kaldığı için sessizce açılmaz.
        assert!(!resolve_ai_enabled(Some(false), true, true, Some(true)));
    }

    #[test]
    fn stored_false_stays_off_when_nothing_is_installed() {
        assert!(!resolve_ai_enabled(Some(false), false, false, None));
    }

    // --- göç kuralı: yalnızca `stored == None` iken uygulanır ---

    #[test]
    fn migration_enables_when_engine_and_llm_are_present() {
        // BGE/gömme OPSİYONEL: motor + sohbet modeli yeterlidir.
        assert!(resolve_ai_enabled(None, true, true, None));
    }

    #[test]
    fn migration_stays_off_when_only_engine_is_present() {
        assert!(!resolve_ai_enabled(None, true, false, None));
    }

    #[test]
    fn migration_stays_off_when_only_llm_is_present() {
        assert!(!resolve_ai_enabled(None, false, true, None));
    }

    #[test]
    fn migration_stays_off_on_clean_install() {
        // Temiz kurulum (model yok) → kapalı: güvenli varsayılan (fail-closed).
        assert!(!resolve_ai_enabled(None, false, false, None));
    }

    // --- `auto_warmup` karara KATILMAZ: ayrı bir tercihtir ---

    #[test]
    fn auto_warmup_false_does_not_disable_the_assistant() {
        // Kullanıcı yalnızca ISISMAYI kapatmıştır; modeller varsa asistan ETKİN kalır.
        assert!(resolve_ai_enabled(None, true, true, Some(false)));
    }

    #[test]
    fn auto_warmup_true_without_models_still_resolves_off() {
        // Isıtma açık olsa da indirilmiş model yoksa açılışta iş yok → kapalı.
        assert!(!resolve_ai_enabled(None, false, false, Some(true)));
    }

    // --- ısıtma kapısı (SAF): etkinlik > auto_warmup ---

    #[test]
    fn warmup_is_skipped_when_ai_is_disabled_even_if_auto_warmup_is_on() {
        // Eski yapılandırmada `auto_warmup: true` kalmış olabilir; AI kapalıysa
        // ısınma YİNE olmaz. Bu, kapıdaki sıranın (etkinlik önce) kanıtıdır.
        assert!(!should_warmup(false, true));
    }

    #[test]
    fn warmup_is_skipped_when_auto_warmup_is_off_even_if_ai_is_enabled() {
        // Kullanıcı yalnızca ısınmayı kapatmıştır: asistan ETKİN kalır ama
        // açılışta ön yükleme başlamaz.
        assert!(!should_warmup(true, false));
    }

    #[test]
    fn warmup_runs_only_when_ai_is_enabled_and_auto_warmup_is_on() {
        assert!(should_warmup(true, true));
    }

    #[test]
    fn warmup_is_skipped_when_both_are_off() {
        assert!(!should_warmup(false, false));
    }

    // --- reddetme metni sözleşmesi ---

    #[test]
    fn disabled_message_says_ai_is_off_and_points_to_settings() {
        // Kapı metni bir sözleşmedir: kullanıcı AI'nın KAPALI olduğunu ve nereden
        // açacağını (Ayarlar → AI) anlamalıdır. Metin değişirse bu test kırılır.
        assert!(
            AI_DISABLED_MESSAGE.contains("AI kapalı"),
            "metin: {AI_DISABLED_MESSAGE:?}"
        );
        assert!(
            AI_DISABLED_MESSAGE.contains("Ayarlar"),
            "metin: {AI_DISABLED_MESSAGE:?}"
        );
    }

    // --- offload kararı (SAF): VRAM ≥ model+pay → GPU, aksi/tespit yok → CPU ---

    fn gpu_with_vram(vram_mb: u64) -> GpuInfo {
        GpuInfo {
            name: Some("Test GPU".to_string()),
            vram_mb: Some(vram_mb),
            source: GpuSource::NvidiaSmi,
        }
    }

    #[test]
    fn plenty_of_vram_offloads_all_layers_to_gpu() {
        // Arrange: 16 GB VRAM, 8,5 GB model — rahat sığar.
        // Act
        let decision = decide_offload(
            Some(&gpu_with_vram(16384)),
            Some(8572 * BYTES_PER_MIB),
            VRAM_RESERVE_MB,
        );
        // Assert: tüm katmanlar GPU'da; gerekçe iki sayıyı da söyler.
        assert_eq!(decision.mode, OffloadMode::Gpu);
        assert_eq!(decision.n_gpu_layers, ALL_GPU_LAYERS);
        assert_eq!(decision.model_mb, Some(8572));
        assert!(!decision.reason.is_empty());
        assert!(decision.reason.contains("16384"), "gerekçe: {}", decision.reason);
        assert!(decision.reason.contains("8572"), "gerekçe: {}", decision.reason);
    }

    #[test]
    fn insufficient_vram_falls_back_to_cpu() {
        // Arrange: 6 GB VRAM, 8,5 GB model — sığmaz.
        // Act
        let decision = decide_offload(
            Some(&gpu_with_vram(6144)),
            Some(8572 * BYTES_PER_MIB),
            VRAM_RESERVE_MB,
        );
        // Assert: CPU; gerekçe "VRAM yetersiz" der ve iki sayıyı da verir.
        assert_eq!(decision.mode, OffloadMode::Cpu);
        assert_eq!(decision.n_gpu_layers, 0);
        assert!(decision.reason.contains("VRAM yetersiz"), "gerekçe: {}", decision.reason);
        assert!(decision.reason.contains("6144"), "gerekçe: {}", decision.reason);
        assert!(decision.reason.contains("8572"), "gerekçe: {}", decision.reason);
    }

    #[test]
    fn unknown_gpu_falls_back_to_cpu() {
        // Tespit yok: güvenli seçim CPU (fail-closed).
        let decision = decide_offload(None, Some(8572 * BYTES_PER_MIB), VRAM_RESERVE_MB);
        assert_eq!(decision.mode, OffloadMode::Cpu);
        assert_eq!(decision.n_gpu_layers, 0);
        assert!(!decision.reason.is_empty());
        assert!(decision.reason.contains("tespit edilemedi"), "gerekçe: {}", decision.reason);
    }

    #[test]
    fn wmi_name_without_vram_falls_back_to_cpu() {
        // WMI yalnızca AD verir; VRAM güvenilir değil → CPU (onaylanmış ödünç).
        // Gerekçe GPU adını anar ki kullanıcı "kartım var, neden CPU?" demesin.
        let wmi = GpuInfo {
            name: Some("AMD Radeon RX 7900 XTX".to_string()),
            vram_mb: None,
            source: GpuSource::Wmi,
        };
        let decision = decide_offload(Some(&wmi), Some(8572 * BYTES_PER_MIB), VRAM_RESERVE_MB);
        assert_eq!(decision.mode, OffloadMode::Cpu);
        assert_eq!(decision.n_gpu_layers, 0);
        assert!(decision.reason.contains("VRAM"), "gerekçe: {}", decision.reason);
        assert!(
            decision.reason.contains("AMD Radeon RX 7900 XTX"),
            "gerekçe: {}",
            decision.reason
        );
    }

    #[test]
    fn known_vram_but_unknown_model_size_falls_back_to_cpu() {
        // Boyut okunamadıysa uydurmayız: temkinli CPU ve bunu söyleriz.
        let decision = decide_offload(Some(&gpu_with_vram(16384)), None, VRAM_RESERVE_MB);
        assert_eq!(decision.mode, OffloadMode::Cpu);
        assert_eq!(decision.n_gpu_layers, 0);
        assert_eq!(decision.model_mb, None);
        assert!(decision.reason.contains("boyutu"), "gerekçe: {}", decision.reason);
    }

    #[test]
    fn boundary_exactly_at_model_plus_reserve_offloads_all() {
        // Tam sınır: vram == model + pay → sığar (>=) → GPU.
        let vram = 16384;
        let model_mb = vram - VRAM_RESERVE_MB;
        let decision = decide_offload(
            Some(&gpu_with_vram(vram)),
            Some(model_mb * BYTES_PER_MIB),
            VRAM_RESERVE_MB,
        );
        assert_eq!(decision.mode, OffloadMode::Gpu);
        assert_eq!(decision.n_gpu_layers, ALL_GPU_LAYERS);
    }

    #[test]
    fn one_mib_over_the_boundary_falls_back_to_cpu() {
        // Sınırın 1 MiB üstü artık sığmaz → CPU.
        let vram = 16384;
        let model_mb = vram - VRAM_RESERVE_MB + 1;
        let decision = decide_offload(
            Some(&gpu_with_vram(vram)),
            Some(model_mb * BYTES_PER_MIB),
            VRAM_RESERVE_MB,
        );
        assert_eq!(decision.mode, OffloadMode::Cpu);
        assert_eq!(decision.n_gpu_layers, 0);
    }

    #[test]
    fn offload_mode_serializes_to_lowercase_wire_names() {
        // Tel biçimi sözleşmesi: arayüz "gpu"/"cpu" bekler.
        assert_eq!(
            serde_json::to_string(&OffloadMode::Gpu).unwrap_or_default(),
            "\"gpu\""
        );
        assert_eq!(
            serde_json::to_string(&OffloadMode::Cpu).unwrap_or_default(),
            "\"cpu\""
        );
    }

    // --- sohbet modeli doğrulama (SAF): kayıtlı ad mı, serbest `.gguf` mu? ---

    #[test]
    fn registered_chat_file_names_are_recognized_and_free_ones_are_not() {
        // Kayıtlı (pinli) üç sohbet modeli dosya adı tanınır.
        assert!(is_registered_chat_file("Qwen2.5-14B-Instruct-Q4_K_M.gguf"));
        assert!(is_registered_chat_file("Qwen2.5-7B-Instruct-Q4_K_M.gguf"));
        assert!(is_registered_chat_file("Qwen2.5-3B-Instruct-Q4_K_M.gguf"));
        // Serbest/kayıt dışı dosya adları "doğrulanmış" sayılmaz (uydurma güven yok).
        assert!(!is_registered_chat_file("serbest-model.gguf"));
        assert!(!is_registered_chat_file("Qwen2.5-14B-Instruct-Q4_K_M.GGUF")); // harf duyarlı
        // Gömme modeli bir SOHBET modeli değildir: yanlışlıkla "doğrulanmış" olmamalı.
        assert!(!is_registered_chat_file("bge-m3-Q8_0.gguf"));
        assert!(!is_registered_chat_file(""));
    }
}
