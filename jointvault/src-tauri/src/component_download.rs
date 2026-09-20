// Bileşen indirme motoru: saf muhafızlar + akış hattı + Tauri komut köprüsü.
//
// Güvenlik kararları (zip-slip, zip-bomba, sha256, disk alanı) bilinçli olarak SAF
// yardımcılarda tutulur: ağ/akış kodundan ayrıldığında gerçek indirme olmadan, sınır
// durumlarıyla test edilebilirler. Aynı modülde akış motoru (subtask 02) ve Tauri
// komutları (subtask 03) bu saf kararları kullanır; komutlar hatayı `user_message()`
// ile kullanıcıya taşır.
//
// NOT: Tauri komutları (subtask 03) bağlandıktan sonra iki yardımcı hâlâ normal
// derlemede kullanılmıyor: `sha256_hex` yalnızca testlerden çağrılır ve
// `DownloadError::technical_detail` yalnızca loglama için hazır durur (Faz 7c).
// Bu yüzden dead_code uyarısı burada bastırılmaya devam eder.
#![allow(dead_code)]

use fs4::available_space;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// İndirme hattındaki hata türleri. Her varyant kullanıcıya Türkçe bir mesaj üretir;
/// `detail` alanları yalnızca log içindir, arayüze sızdırılmaz (bkz. security-patterns).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DownloadError {
    /// Kullanıcı iptal etti.
    Cancelled,
    /// Bağlantı kurulamadı ya da koptu (çevrimdışı, DNS, TLS, zaman aşımı).
    Offline { detail: String },
    /// Sunucu başarı (2xx) dışında yanıt verdi (404/403/5xx).
    HttpStatus { status: u16 },
    /// Hesaplanan özet beklenenle uyuşmadı ya da beklenen özet bozuk/boştu.
    Sha256Mismatch { expected: String, actual: String },
    /// Arşiv girdisi hedef klasörün dışına çıkmaya çalışıyor (zip-slip).
    ZipSlip { entry: String },
    /// Tek arşiv girdisi boyut sınırını aştı (zip-bomba).
    ZipBomb { entry: String, size: u64, limit: u64 },
    /// Arşiv açılamadı/bozuk ya da beklenen girdi yok: genel arşiv reddi.
    Archive { detail: String },
    /// İndirme başlamadan disk alanının yetmediği görüldü.
    DiskFull { required: u64, available: u64 },
    /// Geçici ya da hedef dosyaya yazma başarısız.
    WriteFailed { detail: String },
}

impl DownloadError {
    /// Kullanıcıya gösterilecek Türkçe mesaj. Teknik ayrıntı bilinçli olarak dışarıda
    /// tutulur; arayüz yalnızca anlaşılır ve dürüst bir eylem metni gösterir.
    pub fn user_message(&self) -> String {
        match self {
            DownloadError::Cancelled => "İndirme iptal edildi.".to_string(),
            DownloadError::Offline { .. } => {
                "Sunucuya ulaşılamadı (çevrimdışı olabilir). İnternet bağlantını kontrol edip tekrar dene."
                    .to_string()
            }
            DownloadError::HttpStatus { status } => format!(
                "Sunucu indirmeyi reddetti (HTTP {status}). Kaynak güncellenmiş olabilir; tekrar dene."
            ),
            DownloadError::Sha256Mismatch { .. } => {
                "İndirilen dosya doğrulanamadı (sha256 uyuşmadı). Yarım dosya silindi, tekrar dene."
                    .to_string()
            }
            DownloadError::ZipSlip { .. } => {
                "Arşiv güvenli değil: dosya hedef klasörün dışına çıkmaya çalışıyor. Çıkarma reddedildi."
                    .to_string()
            }
            DownloadError::ZipBomb { size, limit, .. } => format!(
                "Arşiv beklenenden büyük: tek dosya {size} bayt (sınır {limit} bayt). Çıkarma reddedildi."
            ),
            DownloadError::Archive { detail } => format!("Arşiv açılamadı: {detail}"),
            DownloadError::DiskFull { required, available } => format!(
                "Disk alanı yetersiz: {required} bayt gerekiyor, {available} bayt boş. Yer açıp tekrar dene."
            ),
            DownloadError::WriteFailed { detail } => format!("Dosya diske yazılamadı: {detail}"),
        }
    }

    /// Log için teknik ayrıntı; kullanıcıya gösterilmez.
    pub fn technical_detail(&self) -> String {
        match self {
            DownloadError::Offline { detail }
            | DownloadError::Archive { detail }
            | DownloadError::WriteFailed { detail } => detail.clone(),
            other => other.user_message(),
        }
    }
}

impl std::fmt::Display for DownloadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.user_message())
    }
}

impl std::error::Error for DownloadError {}

/// Bir sha256 beklenen özeti geçerli mi: kırpılmış, tam 64 onaltılık karakter.
/// Boş ya da bozuk beklenti asla "geçti" sayılmaz — fail closed.
fn is_valid_sha256_hex(expected: &str) -> bool {
    let trimmed = expected.trim();
    trimmed.len() == 64 && trimmed.chars().all(|c| c.is_ascii_hexdigit())
}

/// Baytların sha256 özetini küçük harfli hex olarak döndürür (saf; I/O yok).
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Hesaplanan özet beklenenle eşleşiyor mu?
///
/// Büyük/küçük harf ve kenar boşluğu farkları tolere edilir (yayıncılar karışık
/// biçim veriyor). Beklenen özet boş/bozuksa ya da farklıysa `Sha256Mismatch` döner:
/// doğrulama asla "belirsizse geç" davranışı göstermez.
pub fn verify_sha256(actual_hex: &str, expected_hex: &str) -> Result<(), DownloadError> {
    let actual = actual_hex.trim().to_ascii_lowercase();
    let expected = expected_hex.trim().to_ascii_lowercase();
    if !is_valid_sha256_hex(&expected) || actual != expected {
        return Err(DownloadError::Sha256Mismatch {
            expected: expected_hex.trim().to_string(),
            actual,
        });
    }
    Ok(())
}

/// Arşivdeki tek bir girdi: ad + açılmış boyut. Zip taramasında bu saf veri
/// toplanır; seçim kararı dosya sistemine hiç dokunmadan verilir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveEntry {
    pub name: String,
    pub size: u64,
}

/// Çıkarılacak dosya: kaynak ad (log için), hedef dosya adı (güvenli basename), boyut.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectedEntry {
    pub source_name: String,
    pub file_name: String,
    pub size: u64,
}

/// Arşiv adını güvenli bir dosya basename'ine indir.
///
/// Yalnızca son bileşen kullanılır; böylece `../../evil.exe` ya da `bin/../../evil.dll`
/// gibi kaçışlar hedef dizine hapsolur (hedef her zaman `hedef/<basename>` olur).
/// `..` bileşeni, boş/`.` basename, Windows sürücü ya da ADS belirteci (`:`) ve NUL
/// içeren adlar `ZipSlip` ile reddedilir; meşru `bin/ffmpeg.exe` gibi derin yollar
/// basename'e indirilerek kabul edilir (gerçek arşivler böyle paketleniyor).
pub fn safe_basename(name: &str) -> Result<String, DownloadError> {
    // Windows'ta üretilen arşivler ters eğik çizgi kullanabilir; tek biçime indir.
    let normalized = name.replace('\\', "/");
    if normalized.split('/').any(|segment| segment == "..") {
        return Err(DownloadError::ZipSlip { entry: name.to_string() });
    }
    let base = normalized.rsplit('/').next().unwrap_or("").trim();
    if base.is_empty() || base == "." || base == ".." {
        return Err(DownloadError::ZipSlip { entry: name.to_string() });
    }
    if base.contains(':') || base.contains('\0') {
        return Err(DownloadError::ZipSlip { entry: name.to_string() });
    }
    Ok(base.to_string())
}

/// Girdi bir dizin mi (sonda ayraç)? Dizinler seçilmez ve bu bir hata değildir.
fn is_directory_entry(name: &str) -> bool {
    name.ends_with('/') || name.ends_with('\\')
}

/// Arşivden hangi girdiler çıkarılacak?
///
/// - Seçim **yalnızca basename** üzerinden ve büyük/küçük harf duyarsız yapılır; arşivdeki
///   klasör yapısı hedefe taşınmaz, dönen ad istenen kanonik yazımdır.
/// - Herhangi bir ad `..` bileşeni içeriyorsa tüm seçim reddedilir (fail closed, zip-slip).
/// - İstenen bir girdi `max_entry_bytes`'ı aşarsa `ZipBomb` döner (tek dosya sınırı);
///   tam sınırdaki girdi kabul edilir.
///
/// Aynı basename'e birden çok girdi düşerse ilk eşleşme kazanır (deterministik).
pub fn select_archive_entries(
    entries: &[ArchiveEntry],
    wanted: &[&str],
    max_entry_bytes: u64,
) -> Result<Vec<SelectedEntry>, DownloadError> {
    let mut selected: Vec<SelectedEntry> = Vec::new();
    for entry in entries {
        if is_directory_entry(&entry.name) {
            continue;
        }
        let base = safe_basename(&entry.name)?;
        let canonical = match wanted.iter().find(|w| w.eq_ignore_ascii_case(&base)) {
            Some(w) => (*w).to_string(),
            None => continue,
        };
        // Boyut sınırı, dedup'tan önce: eşleşen büyük bir girdi asla sessizce atlanmasın.
        if entry.size > max_entry_bytes {
            return Err(DownloadError::ZipBomb {
                entry: entry.name.clone(),
                size: entry.size,
                limit: max_entry_bytes,
            });
        }
        if selected
            .iter()
            .any(|s| s.file_name.eq_ignore_ascii_case(&canonical))
        {
            continue;
        }
        selected.push(SelectedEntry {
            source_name: entry.name.clone(),
            file_name: canonical,
            size: entry.size,
        });
    }
    Ok(selected)
}

/// Arşiv girdisinin güvenli hedef yolu: her zaman `target_dir/<güvenli basename>`.
/// Kaçış denemesinde hata döner; dönen yol asla `target_dir` dışına çıkmaz.
pub fn extraction_target_path(
    target_dir: &Path,
    entry_name: &str,
) -> Result<PathBuf, DownloadError> {
    Ok(target_dir.join(safe_basename(entry_name)?))
}

/// İndirme için gereken disk baytı: içerik + emniyet marjı. Doygun toplama sayesinde
/// düşmanca büyük değerlerde taşma ya da panic olmaz.
pub fn disk_requirement(download_bytes: u64, safety_margin: u64) -> u64 {
    download_bytes.saturating_add(safety_margin)
}

/// Yeterli disk alanı var mı? Gerekli = indirilecek bayt + marj. Yoksa `DiskFull`
/// döner. Kontrol saftır (syscall yok), böylece karar ağ kodundan bağımsız test edilir.
pub fn ensure_disk_space(
    download_bytes: u64,
    available_bytes: u64,
    safety_margin: u64,
) -> Result<(), DownloadError> {
    let required = disk_requirement(download_bytes, safety_margin);
    if required <= available_bytes {
        Ok(())
    } else {
        Err(DownloadError::DiskFull {
            required,
            available: available_bytes,
        })
    }
}

// ---------------------------------------------------------------------------
// İndirme motoru (subtask 02)
// ---------------------------------------------------------------------------
//
// Tek indirme yolu: akış → `.part` → sha256 → (Raw) atomik taşıma | (Zip) güvenli
// çıkarma. Kuyruk kilidi (`download::QUEUE`) **çağıran** tarafından alınır; bu
// modül kuyruk disiplinini dayatmaz. `run_download` sonunda iş kaydını temizler
// (`finish_job`) — böylece erken hata/iptal yollarında da kayıt sızmaz.
//
// İlerleme `component-download-progress` olayıyla yayılır ve şu sözleşmeyi taşır:
// { jobId, componentId, percent, downloadedBytes, totalBytes, phase }.
// `percent = -1` → toplam uzunluk bilinmiyor (mevcut whisper deseniyle uyumlu).

/// İlerleme olayının adı (subtask 05 arayüzü buna abone).
pub const PROGRESS_EVENT: &str = "component-download-progress";

/// Bazı CDN'ler UA'sız isteği reddeder; kimliğimizi açıkça bildiririz.
const USER_AGENT: &str = "JointVault/1.0";

/// Disk ön kontrolündeki emniyet marjı. `expected_bytes` indirilecek (arşiv)
/// boyuttur; Zip çıkarma sırasında açılan dosyalar için de yer gerekir. Kaba bir
/// kapıdır: kesin koruma, indirme sırasında oluşan `WriteFailed` hatasıdır.
const DISK_SAFETY_MARGIN_BYTES: u64 = 64 * 1024 * 1024;

/// İlerleme olayı en fazla bu sıklıkta yayılır (bilinmeyen toplamda kalp atışı).
const PROGRESS_MIN_INTERVAL_MS: u128 = 250;

/// Çıkarma/hash tamponu: sabit bellek; dosya boyutundan bağımsız.
const IO_BUFFER_BYTES: usize = 64 * 1024;

/// Tek indirmenin tarifi. Çağıran (subtask 03) bunu kayıttan üretir.
pub struct DownloadPlan {
    pub component_id: String,
    pub url: String,
    pub sha256: String,
    /// İlerleme yüzdesi için toplam (sunucu `Content-Length` vermezse yedek).
    pub expected_bytes: Option<u64>,
    /// Disk ön kontrolü için gereken bayt. Arşivde **tepe kullanım indirilenden
    /// büyüktür** (arşiv + açılan dosyalar), o yüzden ayrı verilebilir; verilmezse
    /// indirilen boyut esas alınır. Doğru sayı buraya gelmezse kullanıcı, indirme
    /// bittikten sonra "yer yok" hatasıyla karşılaşır — kapı işe yaramaz.
    pub disk_required_bytes: Option<u64>,
    /// İlerleme yüzdesinin gösterileceği aralık (ör. iki arşivi tek çubukta
    /// göstermek için 0–50 / 50–100). `None` ise 0–100. Bilinmeyen toplam
    /// (`percent = -1`) ölçeklenmez — "bilinmiyor" bilgi kaybına uğramaz.
    pub progress_span: Option<(f64, f64)>,
    pub payload: Payload,
}

/// İndirilen içeriğin hedefe nasıl yerleşeceği.
pub enum Payload {
    /// Düz dosya: `<dir>/<file_name>` (doğrulamadan sonra atomik rename).
    Raw { dest_dir: PathBuf, file_name: String },
    /// Zip arşivi: yalnızca seçilen girdiler basename ile `<dest_dir>` altına çıkar.
    Zip {
        dest_dir: PathBuf,
        wanted: Vec<String>,
        max_entry_bytes: u64,
    },
}

impl Payload {
    /// İndirme/çıkarma hedef klasörü.
    pub fn dest_dir(&self) -> &Path {
        match self {
            Payload::Raw { dest_dir, .. } | Payload::Zip { dest_dir, .. } => dest_dir.as_path(),
        }
    }
}

/// Frontend'e giden ilerleme olayı gövdesi. `emit` için `Serialize + Clone` şarttır.
#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    #[serde(rename = "jobId")]
    job_id: String,
    #[serde(rename = "componentId")]
    component_id: String,
    percent: f64,
    #[serde(rename = "downloadedBytes")]
    downloaded_bytes: u64,
    #[serde(rename = "totalBytes")]
    total_bytes: Option<u64>,
    phase: String,
}

/// İptal kaydı: job_id → bayrak. `std::sync::Mutex` yeterlidir çünkü kilit yalnızca
/// haritaya erişirken tutulur ve **asla** `.await` boyunca taşınmaz; kilitliyken
/// yalnızca bir `AtomicBool` okunur/yazılır (IO yok, deadlock riski yok).
static JOBS: Mutex<Option<HashMap<String, Arc<AtomicBool>>>> = Mutex::new(None);

// Kilit zehirlenmesi (panik) indirmeyi durdurmamalı: iç veriyi kurtarıp devam ederiz.
fn jobs_guard() -> MutexGuard<'static, Option<HashMap<String, Arc<AtomicBool>>>> {
    JOBS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Yeni iş kaydı; çağıran bayrağı `run_download`'a verir ve akış döngüsü onu yoklar.
pub fn register_job(job_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    jobs_guard()
        .get_or_insert_with(HashMap::new)
        .insert(job_id.to_string(), flag.clone());
    flag
}

/// İşi iptal et. Kayıt bulunduysa `true`.
pub fn cancel_job(job_id: &str) -> bool {
    match jobs_guard().as_ref().and_then(|map| map.get(job_id)) {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

/// Kaydı temizle (indirme bitti/başarısız oldu). Idempotent.
pub fn finish_job(job_id: &str) {
    if let Some(map) = jobs_guard().as_mut() {
        map.remove(job_id);
    }
}

// --- saf yardımcılar (I/O yok; birim testli) ---

/// İndirme yüzdesi: toplam biliniyorsa 0..=100, bilinmiyorsa -1.0.
/// Sıfır toplam da "bilinmiyor" sayılır (sıfıra bölme yok).
fn progress_percent(downloaded: u64, total: Option<u64>) -> f64 {
    match total {
        Some(t) if t > 0 => (downloaded as f64 / t as f64 * 100.0).clamp(0.0, 100.0),
        _ => -1.0,
    }
}

/// Yüzdeyi tam sayı kovasına indir; yayın kısıtı bu kovaya göre karar verir.
fn progress_bucket(percent: f64) -> i32 {
    if percent < 0.0 {
        -1
    } else {
        percent.floor() as i32
    }
}

/// Bu parça için olay yayılsın mı? Yüzde kovası değiştiyse ya da en az
/// `min_interval_ms` geçtiyse. Böylece 100k olay yerine en çok ~4 olay/sn gider;
/// bilinmeyen toplamda kova hep -1 kalır ve kalp atışı çalışır.
fn should_emit(bucket: i32, last_bucket: i32, elapsed_ms: u128, min_interval_ms: u128) -> bool {
    bucket != last_bucket || elapsed_ms >= min_interval_ms
}

/// Geçici dosya adı belirtecini güvenli hale getir: yol ayıracı ya da denetim
/// karakteri taşıyan geçici adlar hedef klasörün dışına çıkamaz. Boş sonuç
/// "download" olur.
pub fn sanitize_token(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.trim_matches('.').is_empty() {
        "download".to_string()
    } else {
        cleaned
    }
}

/// Düz dosya için `.part` yolu: hedef dosyanın yanında, aynı birimde (atomik rename
/// farklı birimde çalışmaz — bu yüzden hedef klasörün içinde tutulur).
pub fn part_path_for_file(dest_dir: &Path, file_name: &str) -> PathBuf {
    dest_dir.join(format!("{file_name}.part"))
}

/// Arşiv indirmesi için `.part` yolu: bileşen+job belirtecinden türetilir; hedef
/// klasörün içinde kalır ve çıkarılan dosyalarla adı çakışmaz.
pub fn part_path_for_archive(dest_dir: &Path, component_id: &str, job_id: &str) -> PathBuf {
    dest_dir.join(format!(
        "{}.part",
        sanitize_token(&format!("{component_id}.{job_id}"))
    ))
}

/// Okunan baytı sayaca ekle ve tek girdi sınırını aşarsa `ZipBomb` döndür.
/// `entry.size()` saldırgan denetiminde olabildiğinden karar **gerçekten okunan**
/// bayta dayanır; tam sınırdaki değer kabul edilir.
fn account_bytes(entry: &str, already: u64, chunk_len: u64, limit: u64) -> Result<u64, DownloadError> {
    let total = already.saturating_add(chunk_len);
    if total > limit {
        Err(DownloadError::ZipBomb {
            entry: entry.to_string(),
            size: total,
            limit,
        })
    } else {
        Ok(total)
    }
}

// --- I/O yardımcıları ---

/// `.part` ve yarım kalan hedefleri her hata yolunda silen temizlik bekçisi.
/// `temp`: başarıda da silinir (`.part` arşivi/geçici dosya).
/// `partial`: yalnızca başarısızlıkta silinir (yarım çıkarılmış hedefler).
struct Cleanup {
    temp: Vec<PathBuf>,
    partial: Vec<PathBuf>,
    succeeded: bool,
}

impl Cleanup {
    fn new(temp: PathBuf) -> Self {
        Self {
            temp: vec![temp],
            partial: Vec::new(),
            succeeded: false,
        }
    }

    fn track_partial(&mut self, path: PathBuf) {
        self.partial.push(path);
    }

    fn succeed(&mut self) {
        self.succeeded = true;
    }
}

impl Drop for Cleanup {
    fn drop(&mut self) {
        for path in &self.temp {
            let _ = std::fs::remove_file(path);
        }
        if !self.succeeded {
            for path in &self.partial {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

/// İndirme istemcisi: toplam `timeout()` **bilinçli olarak yok** — o, bağlanmadan
/// gövdenin bitişine kadar geçen süreyi ölçer ve çok GB'lık indirmeyi öldürür.
/// Bunun yerine yalnızca bağlanma ve her okuma için ayrı zaman aşımı verilir:
/// akış durursa `read_timeout` devreye girer, uzun indirme kesilmez.
fn build_client() -> Result<reqwest::Client, DownloadError> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(map_transport_error)
}

/// `reqwest::Error`'ı anlaşılır `DownloadError`'a çevir: bağlantı/DNS/zaman aşımı
/// ve gövde kopması kullanıcı için "çevrimdışı"dır. `is_dns()` reqwest 0.12'de
/// yoktur; DNS hatası `is_connect()` üzerinden gelir.
fn map_transport_error(err: reqwest::Error) -> DownloadError {
    let detail = if err.is_timeout() {
        format!("zaman aşımı: {err}")
    } else if err.is_body() {
        format!("akış koptu: {err}")
    } else if err.is_connect() {
        format!("bağlantı kurulamadı: {err}")
    } else {
        err.to_string()
    };
    DownloadError::Offline { detail }
}

/// Disk kapısının hangi bayta göre kurulacağı: kayıt tepe kullanımı ayrı verdiyse o,
/// vermediyse indirilen boyut. Saf ve testli — I/O kararın kendisinde değil, ölçümde.
fn disk_gate_bytes(
    expected_bytes: Option<u64>,
    disk_required_bytes: Option<u64>,
) -> Option<u64> {
    disk_required_bytes.or(expected_bytes)
}

/// Beklenen boyut biliniyorsa indirmeden önce disk alanını doğrula. `available_space`
/// ölçülemezse kontrol atlanır: ölçemediğimiz için kullanıcıyı yanlışlıkla
/// engellemeyiz. Karar saf `ensure_disk_space`'te verilir.
fn precheck_disk(
    dest_dir: &Path,
    expected_bytes: Option<u64>,
    disk_required_bytes: Option<u64>,
) -> Result<(), DownloadError> {
    let Some(bytes) = disk_gate_bytes(expected_bytes, disk_required_bytes) else {
        return Ok(());
    };
    match available_space(dest_dir) {
        Ok(available) => ensure_disk_space(bytes, available, DISK_SAFETY_MARGIN_BYTES),
        Err(_) => Ok(()),
    }
}

/// Dosyanın sha256'sını sabit bellekli parçalarla hesapla — çok GB'lık dosya asla
/// belleğe alınmaz (whisper'daki `std::fs::read` deseninin aksine).
fn sha256_file(path: &Path) -> Result<String, DownloadError> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| DownloadError::WriteFailed { detail: e.to_string() })?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; IO_BUFFER_BYTES];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| DownloadError::WriteFailed { detail: e.to_string() })?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Yüzdeyi çağıranın istediği aralığa ölçekle. Bilinmeyen toplam (`percent < 0`)
/// ölçeklenmez: "bilinmiyor" bilgisi korunur, uydurma bir yüzdeye dönüşmez.
fn scale_percent(percent: f64, span: Option<(f64, f64)>) -> f64 {
    match span {
        Some((start, end)) if percent >= 0.0 => {
            (start + percent / 100.0 * (end - start)).clamp(0.0, 100.0)
        }
        _ => percent,
    }
}

fn emit_progress(
    app: &AppHandle,
    plan: &DownloadPlan,
    job_id: &str,
    percent: f64,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    phase: &str,
) {
    let _ = app.emit(
        PROGRESS_EVENT,
        DownloadProgress {
            job_id: job_id.to_string(),
            component_id: plan.component_id.clone(),
            percent: scale_percent(percent, plan.progress_span),
            downloaded_bytes,
            total_bytes,
            phase: phase.to_string(),
        },
    );
}

/// Payload'a göre `.part` yolunu türet. Raw'da dosya adı önce `safe_basename` ile
/// doğrulanır (hedef klasörün dışına çıkmaz); Zip'te belirteç sanitize edilir.
fn part_path(plan: &DownloadPlan, job_id: &str) -> Result<PathBuf, DownloadError> {
    let dest_dir = plan.payload.dest_dir();
    Ok(match &plan.payload {
        Payload::Raw { file_name, .. } => {
            part_path_for_file(dest_dir, &safe_basename(file_name)?)
        }
        Payload::Zip { .. } => part_path_for_archive(dest_dir, &plan.component_id, job_id),
    })
}

/// Gövdeyi `.part` dosyasına akıt; iptal bayrağını her parçada yokla. İlerleme
/// kısıtlı yayılır (tam yüzde değişimi ya da ~250 ms'de bir kalp atışı).
async fn stream_body_to_file(
    app: &AppHandle,
    plan: &DownloadPlan,
    job_id: &str,
    part: &Path,
    resp: &mut reqwest::Response,
    total: Option<u64>,
    cancel: &AtomicBool,
) -> Result<u64, DownloadError> {
    let mut file = std::fs::File::create(part)
        .map_err(|e| DownloadError::WriteFailed { detail: e.to_string() })?;
    let mut downloaded: u64 = 0;
    let mut last_bucket = i32::MIN;
    let mut last_emit = Instant::now();

    while let Some(chunk) = resp.chunk().await.map_err(map_transport_error)? {
        if cancel.load(Ordering::SeqCst) {
            return Err(DownloadError::Cancelled);
        }
        file.write_all(&chunk)
            .map_err(|e| DownloadError::WriteFailed { detail: e.to_string() })?;
        downloaded += chunk.len() as u64;
        let percent = progress_percent(downloaded, total);
        let bucket = progress_bucket(percent);
        if should_emit(
            bucket,
            last_bucket,
            last_emit.elapsed().as_millis(),
            PROGRESS_MIN_INTERVAL_MS,
        ) {
            last_bucket = bucket;
            last_emit = Instant::now();
            emit_progress(
                app,
                plan,
                job_id,
                percent,
                downloaded,
                total,
                "downloading",
            );
        }
    }
    // Akış bitti: tamponu boşalt ve kapat — Windows'ta rename açık dosyada düşer.
    file.flush()
        .map_err(|e| DownloadError::WriteFailed { detail: e.to_string() })?;
    drop(file);
    Ok(downloaded)
}

/// Arşivdeki girdilerin ad+boyut listesini topla (dosya sistemi yok).
fn read_archive_entries(
    archive: &mut zip::ZipArchive<std::fs::File>,
) -> Result<Vec<ArchiveEntry>, DownloadError> {
    let mut entries = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| DownloadError::Archive { detail: e.to_string() })?;
        entries.push(ArchiveEntry {
            name: entry.name().to_string(),
            size: entry.size(),
        });
    }
    Ok(entries)
}

/// Tek seçili girdiyi `dest_dir/<güvenli basename>` altına akıt. Beyan edilen boyut
/// yalan olabileceğinden gerçekten okunan bayt sayılır; sınır aşılırsa `ZipBomb`.
/// Hedef dosya önceden yoksa temizlik bekçisine kaydedilir (hata hâlinde silinir).
fn write_archive_entry(
    archive: &mut zip::ZipArchive<std::fs::File>,
    index: usize,
    dest_dir: &Path,
    selected: &SelectedEntry,
    max_entry_bytes: u64,
    cancel: &AtomicBool,
    cleanup: &mut Cleanup,
) -> Result<(), DownloadError> {
    let mut entry = archive
        .by_index(index)
        .map_err(|e| DownloadError::Archive { detail: e.to_string() })?;
    let target = extraction_target_path(dest_dir, entry.name())?;
    if !target.exists() {
        cleanup.track_partial(target.clone());
    }
    let mut out = std::fs::File::create(&target)
        .map_err(|e| DownloadError::WriteFailed { detail: e.to_string() })?;
    let mut buf = vec![0u8; IO_BUFFER_BYTES];
    let mut written: u64 = 0;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(DownloadError::Cancelled);
        }
        let n = entry
            .read(&mut buf)
            .map_err(|e| DownloadError::Archive { detail: e.to_string() })?;
        if n == 0 {
            break;
        }
        written = account_bytes(&selected.file_name, written, n as u64, max_entry_bytes)?;
        out.write_all(&buf[..n])
            .map_err(|e| DownloadError::WriteFailed { detail: e.to_string() })?;
    }
    out.flush()
        .map_err(|e| DownloadError::WriteFailed { detail: e.to_string() })?;
    Ok(())
}

/// Doğrulanmış arşivden yalnızca `wanted` girdilerini güvenli biçimde çıkar.
/// Girdi seçimi saf `select_archive_entries` ile yapılır (zip-slip + beyan edilen
/// boyut sınırı); çıkarma sırasında okunan bayt ayrıca sayılır.
fn extract_selected_zip(
    part: &Path,
    dest_dir: &Path,
    wanted: &[String],
    max_entry_bytes: u64,
    cancel: &AtomicBool,
    cleanup: &mut Cleanup,
) -> Result<(), DownloadError> {
    let file = std::fs::File::open(part)
        .map_err(|e| DownloadError::Archive { detail: e.to_string() })?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| DownloadError::Archive { detail: e.to_string() })?;
    let entries = read_archive_entries(&mut archive)?;
    let wanted_refs: Vec<&str> = wanted.iter().map(String::as_str).collect();
    let selected = select_archive_entries(&entries, &wanted_refs, max_entry_bytes)?;
    if selected.is_empty() {
        return Err(DownloadError::Archive {
            detail: "arşivde istenen dosyalar bulunamadı".to_string(),
        });
    }
    std::fs::create_dir_all(dest_dir)
        .map_err(|e| DownloadError::WriteFailed { detail: e.to_string() })?;
    for item in &selected {
        if cancel.load(Ordering::SeqCst) {
            return Err(DownloadError::Cancelled);
        }
        let index = entries
            .iter()
            .position(|e| e.name == item.source_name)
            .ok_or_else(|| DownloadError::Archive {
                detail: format!("arşiv girdisi bulunamadı: {}", item.source_name),
            })?;
        write_archive_entry(
            &mut archive,
            index,
            dest_dir,
            item,
            max_entry_bytes,
            cancel,
            cleanup,
        )?;
    }
    Ok(())
}

/// Doğrulanmış `.part`'ı hedefe yerleştir: Raw'da atomik rename, Zip'te güvenli
/// çıkarma. Başarıda temizlik bekçisini "succeeded" yapar (çıkarılan dosyalar kalır,
/// `.part` yine silinir).
fn place_payload(
    app: &AppHandle,
    plan: &DownloadPlan,
    job_id: &str,
    part: &Path,
    dest_dir: &Path,
    downloaded: u64,
    total: Option<u64>,
    cancel: &AtomicBool,
    cleanup: &mut Cleanup,
) -> Result<(), DownloadError> {
    match &plan.payload {
        Payload::Raw { file_name, .. } => {
            let safe = safe_basename(file_name)?;
            let dest = dest_dir.join(&safe);
            std::fs::rename(part, &dest)
                .map_err(|e| DownloadError::WriteFailed { detail: e.to_string() })?;
        }
        Payload::Zip {
            wanted,
            max_entry_bytes,
            ..
        } => {
            emit_progress(
                app,
                plan,
                job_id,
                progress_percent(downloaded, total),
                downloaded,
                total,
                "extracting",
            );
            extract_selected_zip(part, dest_dir, wanted, *max_entry_bytes, cancel, cleanup)?;
        }
    }
    cleanup.succeed();
    Ok(())
}

/// Tek indirme yolu. Kuyruk kilidi (`download::QUEUE`) ve `register_job` çağıranın
/// sorumluluğundadır; bu fonksiyon akış→doğrula→yerleştir işini yapar ve dönerken
/// iş kaydını temizler. Hata/iptal hâlinde `.part` ve yarım çıktılar silinir.
pub async fn run_download(
    app: &AppHandle,
    plan: DownloadPlan,
    job_id: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), DownloadError> {
    let result = run_download_inner(app, &plan, job_id, cancel).await;
    // Erken dönüşlerde de kayıt sızmasın: temizlik burada, tek noktada.
    finish_job(job_id);
    result
}

async fn run_download_inner(
    app: &AppHandle,
    plan: &DownloadPlan,
    job_id: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), DownloadError> {
    let dest_dir = plan.payload.dest_dir().to_path_buf();
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| DownloadError::WriteFailed { detail: e.to_string() })?;
    if cancel.load(Ordering::SeqCst) {
        return Err(DownloadError::Cancelled);
    }
    precheck_disk(&dest_dir, plan.expected_bytes, plan.disk_required_bytes)?;

    let part = part_path(plan, job_id)?;
    let client = build_client()?;
    let mut resp = client
        .get(plan.url.as_str())
        .header("User-Agent", USER_AGENT)
        .send()
        .await
        .map_err(map_transport_error)?;
    let status = resp.status();
    if !status.is_success() {
        return Err(DownloadError::HttpStatus {
            status: status.as_u16(),
        });
    }
    // Toplam: önce sunucunun beyanı, yoksa planın beklenen boyutu (ilerleme için).
    let total = resp.content_length().or(plan.expected_bytes);
    emit_progress(
        app,
        plan,
        job_id,
        progress_percent(0, total),
        0,
        total,
        "downloading",
    );

    // `.part` buradan itibaren her hata/iptal yolunda silinir.
    let mut cleanup = Cleanup::new(part.clone());
    let downloaded = stream_body_to_file(app, plan, job_id, &part, &mut resp, total, &cancel).await?;

    // Doğrulama: içerik henüz hedefte değil, yalnızca `.part` var. Uyuşmazlıkta
    // `?` döner ve bekçi `.part`'ı siler; hedef dosya asla oluşmaz.
    emit_progress(
        app,
        plan,
        job_id,
        progress_percent(downloaded, total),
        downloaded,
        total,
        "verifying",
    );
    let actual = sha256_file(&part)?;
    verify_sha256(&actual, &plan.sha256)?;

    place_payload(
        app,
        plan,
        job_id,
        &part,
        &dest_dir,
        downloaded,
        total,
        &cancel,
        &mut cleanup,
    )?;
    emit_progress(
        app,
        plan,
        job_id,
        progress_percent(downloaded, total),
        downloaded,
        total,
        "done",
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri komut köprüsü (subtask 03)
// ---------------------------------------------------------------------------
//
// Kayıt (`components.rs`) "ne iniyor"u bilir; burası yalnızca onu bir `DownloadPlan`'a
// çevirip motora verir. Arayüz sözleşmesi: `invoke(cmd, { payload: {...} })`.

/// `payload` içinden zorunlu bir metin alanı oku. camelCase ve snake_case anahtarlar
/// birlikte kabul edilir (istemci sürüm kaymalarına karşı, `download.rs` deseni).
fn payload_string(payload: &Value, keys: &[&str]) -> Result<String, String> {
    keys.iter()
        .filter_map(|key| payload.get(*key))
        .find_map(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("Eksik alan: {}", keys[0]))
}

/// Kayıttaki `DownloadSpec`'i motora verilecek `DownloadPlan`'a çevir.
/// `dest_dir` çalışma anında çözülür (bileşenler klasörü).
fn plan_from_spec(spec: &crate::components::DownloadSpec, dest_dir: PathBuf) -> DownloadPlan {
    let payload = match &spec.payload {
        crate::components::PayloadRule::Raw { file_name } => Payload::Raw {
            dest_dir,
            file_name: (*file_name).to_string(),
        },
        crate::components::PayloadRule::Zip {
            wanted,
            max_entry_bytes,
        } => Payload::Zip {
            dest_dir,
            wanted: wanted.iter().map(|name| (*name).to_string()).collect(),
            max_entry_bytes: *max_entry_bytes,
        },
    };
    DownloadPlan {
        // Olaylarda PAKET kimliği yayılır: tek arşivi paylaşan satırlar (ffmpeg +
        // ffprobe) aynı ilerlemeyi görsün; arayüz `bundle` alanıyla gruplar.
        component_id: spec.bundle.to_string(),
        url: spec.url.to_string(),
        sha256: spec.sha256.to_string(),
        expected_bytes: Some(spec.expected_bytes),
        disk_required_bytes: Some(spec.disk_required_bytes),
        progress_span: None,
        payload,
    }
}

/// Kurulu/atlanan indirme için son %100 olayı. Plan gerekmez; arayüz `jobId` ile eşler.
fn emit_done(app: &AppHandle, component_id: &str, job_id: &str) {
    let _ = app.emit(
        PROGRESS_EVENT,
        DownloadProgress {
            job_id: job_id.to_string(),
            component_id: component_id.to_string(),
            percent: 100.0,
            downloaded_bytes: 0,
            total_bytes: None,
            phase: "done".to_string(),
        },
    );
}

/// Kurulum tarifini indirme motoruna bağla: plan → indir → kurulum-sonrası kanca.
///
/// Neden tek yol? Hedef klasör (Components / Models / Binaries), pin ve kurulum-sonrası
/// adım (ör. arşivdeki `whisper-cli.exe` → `whisper.exe`) **kayıtta tek yerde** durur;
/// komutlar bunları kendileri kurmaz. Hedefi burada `components_dir()`'e sabitlemek
/// modelleri (`.bin`/`.gguf`) bileşen klasörüne indirirdi — sessiz bir yanlış-yer hatası.
pub async fn install_component(
    app: &AppHandle,
    component_id: &str,
    job_id: &str,
    span: Option<(f64, f64)>,
) -> Result<(), String> {
    // Kuruluysa indirme YOK (bugünkü davranış) ama arayüz satırı "bitti"ye geçsin diye
    // yine de %100 olayı yayılır.
    if crate::components::is_installed(app, component_id) {
        emit_done(app, component_id, job_id);
        return Ok(());
    }

    let recipe = crate::components::install_recipe(app, component_id)?;
    // `span`: iki arşivi tek çubukta göstermek isteyen çağıran (AI motoru) için;
    // `None` ise 0–100.
    let mut plan = plan_from_spec(recipe.download, recipe.dest_dir.clone());
    plan.progress_span = span;

    // Kayıt kuyruktan ÖNCE alınır: henüz sırada beklerken gelen iptal isteği de
    // işaretlenebilsin. `run_download` iş kaydını sonunda temizler.
    let cancel = register_job(job_id);
    let _queue = crate::download::QUEUE.lock().await;
    run_download(app, plan, job_id, cancel)
        .await
        .map_err(|err| err.user_message())?;

    // Kurulum-sonrası kanca indirme BAŞARILI olduktan sonra çalışır; hata verirse
    // sessizce yutulmaz (dosya yerinde ama kullanılamıyor olabilir — kullanıcı bilmeli).
    crate::components::apply_post_install(&recipe.dest_dir, recipe.post_install)
}

/// Bileşen indirme komutu. `payload` = `{ componentId|component_id, jobId|job_id }`.
///
/// Tek kuyruktan (`download::QUEUE`) çalışır; bitince işin `jobId`'sini döner.
#[tauri::command]
pub async fn component_download(app: AppHandle, payload: Value) -> Result<String, String> {
    let component_id = payload_string(&payload, &["componentId", "component_id"])?;
    let job_id = payload_string(&payload, &["jobId", "job_id"])?;
    install_component(&app, &component_id, &job_id, None).await?;
    Ok(job_id)
}

/// Çalışan ya da kuyrukta bekleyen bileşen indirmesini iptal et.
///
/// ÖNEMLİ: burada `download::QUEUE` ALINMAZ. Çalışan indirme kilidi tutuyor; kilidi
/// burada beklemek iptalin asla ulaşamaması (kilitlenme) demek olurdu. İptal,
/// `JOBS` kaydındaki `AtomicBool`'u çevirir; akış döngüsü onu her parçada yoklar.
#[tauri::command]
pub fn component_cancel(job_id: String) -> Result<bool, String> {
    Ok(cancel_job(&job_id))
}

/// Debug-only kanıt sondası: açıkça verilen URL/sha256/hedefi motordan geçirir.
///
/// NEDEN var? Kanıt koşucusu (`dev/verify-component-download.mjs`) çevrimdışı ve
/// sha256-uyuşmazlığı yollarını KONTROLLÜ tetiklemeli; gerçek pinli kaynağa
/// dokunmadan. Bu yüzden URL/sha256/hedef dışarıdan verilir.
///
/// RELEASE KAPISI (kasıtlı): release derlemesinde bu komut HER ZAMAN hata döner.
/// Aksi hâlde keyfi URL'den indirme yeteneği üretim uygulamasına sızardı; bu komut
/// yalnızca `debug_assertions` altında anlamlıdır.
#[tauri::command]
pub async fn component_download_probe(app: AppHandle, payload: Value) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Err("Sonda komutu yalnızca debug derlemede çalışır.".to_string());
    }

    let url = payload_string(&payload, &["url"])?;
    let sha256 = payload_string(&payload, &["sha256"])?;
    let dest_dir = PathBuf::from(payload_string(&payload, &["destDir", "dest_dir"])?);
    let file_name = payload_string(&payload, &["fileName", "file_name"])?;
    let job_id = payload
        .get("jobId")
        .or_else(|| payload.get("job_id"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("probe")
        .to_string();
    let expected_bytes = payload
        .get("expectedBytes")
        .or_else(|| payload.get("expected_bytes"))
        .and_then(|value| value.as_u64());

    let plan = DownloadPlan {
        component_id: "probe".to_string(),
        url,
        sha256,
        expected_bytes,
        disk_required_bytes: None,
        progress_span: None,
        payload: Payload::Raw { dest_dir, file_name },
    };

    // Kuyruk ALINMAZ: sonda kendi geçici klasörüne yazar; gerçek bir indirmenin
    // arkasında bloke olmaması kanıtın deterministliğini korur.
    let cancel = register_job(&job_id);
    run_download(&app, plan, &job_id, cancel)
        .await
        .map_err(|err| err.user_message())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(pairs: &[(&str, u64)]) -> Vec<ArchiveEntry> {
        pairs
            .iter()
            .map(|(name, size)| ArchiveEntry {
                name: (*name).to_string(),
                size: *size,
            })
            .collect()
    }

    // --- sha256 ---

    #[test]
    fn sha256_hex_matches_known_digests() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn verify_sha256_accepts_case_and_whitespace_variants() {
        let expected = "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD";
        assert!(verify_sha256(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            expected
        )
        .is_ok());
        assert!(verify_sha256("  ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  ", "\tBA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD\n").is_ok());
    }

    #[test]
    fn verify_sha256_rejects_mismatch() {
        let err = verify_sha256("00", &"a".repeat(64)).unwrap_err();
        assert!(matches!(err, DownloadError::Sha256Mismatch { .. }));
    }

    #[test]
    fn verify_sha256_rejects_empty_or_malformed_expected() {
        assert!(matches!(
            verify_sha256("abc", ""),
            Err(DownloadError::Sha256Mismatch { .. })
        ));
        assert!(matches!(
            verify_sha256("abc", "abc"),
            Err(DownloadError::Sha256Mismatch { .. })
        ));
        assert!(matches!(
            verify_sha256("abc", &"g".repeat(64)),
            Err(DownloadError::Sha256Mismatch { .. })
        ));
    }

    // --- arşiv girdi seçimi (zip-slip + zip-bomba) ---

    #[test]
    fn selection_uses_basename_from_nested_paths() {
        let list = entries(&[
            ("ffmpeg-N/bin/ffmpeg.exe", 1_000),
            ("ffmpeg-N/bin/ffprobe.exe", 2_000),
            ("ffmpeg-N/README.txt", 10),
        ]);
        let picked = select_archive_entries(&list, &["ffmpeg.exe", "ffprobe.exe"], 10_000).unwrap();
        assert_eq!(picked.len(), 2);
        assert_eq!(picked[0].file_name, "ffmpeg.exe");
        assert_eq!(picked[1].file_name, "ffprobe.exe");
    }

    #[test]
    fn selection_is_case_insensitive_and_returns_canonical_name() {
        let list = entries(&[("BIN/FFMPEG.EXE", 5)]);
        let picked = select_archive_entries(&list, &["ffmpeg.exe"], 100).unwrap();
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].file_name, "ffmpeg.exe");
    }

    #[test]
    fn selection_rejects_zip_bomb_entry() {
        let list = entries(&[("big.dll", 500)]);
        let err = select_archive_entries(&list, &["big.dll"], 100).unwrap_err();
        assert!(matches!(
            err,
            DownloadError::ZipBomb {
                size: 500,
                limit: 100,
                ..
            }
        ));
    }

    #[test]
    fn selection_allows_entry_exactly_at_cap() {
        let list = entries(&[("exact.dll", 100)]);
        assert!(select_archive_entries(&list, &["exact.dll"], 100).is_ok());
    }

    #[test]
    fn selection_rejects_parent_traversal() {
        let list = entries(&[("../../evil.exe", 1)]);
        let err = select_archive_entries(&list, &["evil.exe"], 100).unwrap_err();
        assert!(matches!(err, DownloadError::ZipSlip { .. }));
    }

    #[test]
    fn selection_rejects_nested_traversal() {
        let list = entries(&[("bin/../../evil.dll", 1)]);
        let err = select_archive_entries(&list, &["evil.dll"], 100).unwrap_err();
        assert!(matches!(err, DownloadError::ZipSlip { .. }));
    }

    #[test]
    fn selection_skips_directory_entries() {
        let list = entries(&[("bin/", 0), ("bin/ffmpeg.exe", 5)]);
        let picked = select_archive_entries(&list, &["ffmpeg.exe"], 100).unwrap();
        assert_eq!(picked.len(), 1);
    }

    #[test]
    fn selection_keeps_first_duplicate() {
        let list = entries(&[("a/ffmpeg.exe", 5), ("b/ffmpeg.exe", 7)]);
        let picked = select_archive_entries(&list, &["ffmpeg.exe"], 100).unwrap();
        assert_eq!(picked.len(), 1);
        assert_eq!(picked[0].size, 5);
    }

    // --- çıkarma hedef yolu (zip-slip) ---

    #[test]
    fn target_path_joins_basename_inside_target() {
        let target = Path::new("safe-target-dir");
        let out = extraction_target_path(target, "bin/ffmpeg.exe").unwrap();
        assert_eq!(out, target.join("ffmpeg.exe"));
        assert!(out.starts_with(target));
    }

    #[test]
    fn target_path_neutralises_absolute_and_drive_paths() {
        let target = Path::new("safe-target-dir");
        let abs = extraction_target_path(target, "/etc/passwd").unwrap();
        let drive = extraction_target_path(target, "C:\\Windows\\evil.dll").unwrap();
        assert_eq!(abs, target.join("passwd"));
        assert_eq!(drive, target.join("evil.dll"));
        assert!(abs.starts_with(target) && drive.starts_with(target));
    }

    #[test]
    fn target_path_rejects_traversal_everywhere() {
        let target = Path::new("safe-target-dir");
        for hostile in [
            "../escape.exe",
            "..\\escape.exe",
            "a/../../escape.exe",
            "..",
            "C:evil.dll",
        ] {
            let err = extraction_target_path(target, hostile).unwrap_err();
            assert!(matches!(err, DownloadError::ZipSlip { .. }), "hostile: {hostile}");
        }
    }

    // --- disk alanı ---

    #[test]
    fn disk_space_allows_when_margin_fits() {
        assert!(ensure_disk_space(1_000, 2_000, 500).is_ok());
    }

    #[test]
    fn disk_space_allows_exact_fit() {
        assert!(ensure_disk_space(1_000, 1_500, 500).is_ok());
    }

    #[test]
    fn disk_space_reports_shortfall_including_margin() {
        let err = ensure_disk_space(1_000, 1_200, 500).unwrap_err();
        assert!(matches!(
            err,
            DownloadError::DiskFull {
                required: 1_500,
                available: 1_200
            }
        ));
    }

    #[test]
    fn disk_requirement_saturates_instead_of_panicking() {
        assert_eq!(disk_requirement(u64::MAX, 1), u64::MAX);
        assert!(matches!(
            ensure_disk_space(u64::MAX, 1, 1),
            Err(DownloadError::DiskFull { .. })
        ));
    }

    #[test]
    fn disk_gate_prefers_peak_requirement_over_download_size() {
        // Arşivde tepe kullanım indirilenden büyük: kayıt bunu ayrı verirse o kazanır.
        assert_eq!(disk_gate_bytes(Some(186), Some(516)), Some(516));
        // Verilmezse indirilen boyuta düşülür.
        assert_eq!(disk_gate_bytes(Some(186), None), Some(186));
        // İkisi de yoksa kapı kurulmaz (ölçemiyorsak engellemeyiz).
        assert_eq!(disk_gate_bytes(None, None), None);
    }

    #[test]
    fn progress_span_scales_into_caller_range() {
        // İki arşivi tek çubukta gösterme: 0–50 / 50–100.
        assert_eq!(scale_percent(0.0, Some((0.0, 50.0))), 0.0);
        assert_eq!(scale_percent(100.0, Some((0.0, 50.0))), 50.0);
        assert_eq!(scale_percent(50.0, Some((50.0, 100.0))), 75.0);
        // Aralık yoksa yüzde olduğu gibi kalır.
        assert_eq!(scale_percent(42.0, None), 42.0);
        // Bilinmeyen toplam ölçeklenmez: uydurma yüzde üretilmez.
        assert_eq!(scale_percent(-1.0, Some((0.0, 50.0))), -1.0);
    }

    // --- hata mesajları ---

    #[test]
    fn user_messages_are_turkish_and_specific() {
        let cases: Vec<(DownloadError, &str)> = vec![
            (DownloadError::Cancelled, "iptal"),
            (
                DownloadError::Offline {
                    detail: "dns".into(),
                },
                "ulaşılamadı",
            ),
            (DownloadError::HttpStatus { status: 404 }, "404"),
            (
                DownloadError::Sha256Mismatch {
                    expected: "a".into(),
                    actual: "b".into(),
                },
                "sha256",
            ),
            (
                DownloadError::ZipSlip {
                    entry: "x".into(),
                },
                "güvenli değil",
            ),
            (
                DownloadError::ZipBomb {
                    entry: "x".into(),
                    size: 9,
                    limit: 1,
                },
                "beklenenden büyük",
            ),
            (
                DownloadError::Archive {
                    detail: "bozuk".into(),
                },
                "Arşiv açılamadı",
            ),
            (
                DownloadError::DiskFull {
                    required: 10,
                    available: 1,
                },
                "Disk alanı yetersiz",
            ),
            (
                DownloadError::WriteFailed {
                    detail: "izin".into(),
                },
                "yazılamadı",
            ),
        ];
        for (err, needle) in cases {
            let msg = err.user_message();
            assert!(!msg.is_empty());
            assert!(msg.contains(needle), "beklenen '{needle}' yok: {msg}");
        }
    }

    #[test]
    fn display_matches_user_message() {
        let err = DownloadError::Cancelled;
        assert_eq!(err.to_string(), err.user_message());
    }

    // --- motorun saf yardımcıları (subtask 02) ---

    #[test]
    fn progress_percent_known_total_scales_and_clamps() {
        assert_eq!(progress_percent(50, Some(100)), 50.0);
        assert_eq!(progress_percent(0, Some(100)), 0.0);
        assert_eq!(progress_percent(100, Some(100)), 100.0);
        // Sunucu beyanından fazla bayt gelirse üst sınırı aşma.
        assert_eq!(progress_percent(250, Some(100)), 100.0);
    }

    #[test]
    fn progress_percent_unknown_total_is_minus_one() {
        assert_eq!(progress_percent(0, None), -1.0);
        assert_eq!(progress_percent(9_999_999, None), -1.0);
        // Sıfır toplam da "bilinmiyor" sayılır: sıfıra bölme yok.
        assert_eq!(progress_percent(5, Some(0)), -1.0);
    }

    #[test]
    fn progress_bucket_floors_and_marks_unknown() {
        assert_eq!(progress_bucket(-1.0), -1);
        assert_eq!(progress_bucket(0.0), 0);
        assert_eq!(progress_bucket(45.9), 45);
        assert_eq!(progress_bucket(100.0), 100);
    }

    #[test]
    fn should_emit_on_bucket_change_or_heartbeat() {
        // Kova değişti: hemen yay.
        assert!(should_emit(5, 4, 0, 250));
        // Kova aynı ve süre dolmadı: yayma.
        assert!(!should_emit(5, 5, 100, 250));
        // Kova aynı ama kalp atışı süresi doldu: yay.
        assert!(should_emit(5, 5, 250, 250));
        // Bilinmeyen yüzde (-1) sabit kova: yalnızca kalp atışıyla yayılır.
        assert!(!should_emit(-1, -1, 249, 250));
        assert!(should_emit(-1, -1, 250, 250));
    }

    #[test]
    fn sanitize_token_keeps_safe_chars_and_replaces_the_rest() {
        assert_eq!(sanitize_token("ffmpeg"), "ffmpeg");
        assert_eq!(sanitize_token("qwen-14b_Q4.K_M"), "qwen-14b_Q4.K_M");
        assert_eq!(sanitize_token("a/b:c*?\\d"), "a_b_c___d");
        assert_eq!(sanitize_token(""), "download");
        assert_eq!(sanitize_token("..."), "download");
    }

    #[test]
    fn part_paths_stay_inside_destination() {
        let dir = Path::new("components");
        assert_eq!(
            part_path_for_file(dir, "ffmpeg.exe"),
            dir.join("ffmpeg.exe.part")
        );
        let archive = part_path_for_archive(dir, "ffmpeg", "job-1");
        assert_eq!(archive, dir.join("ffmpeg.job-1.part"));
        assert!(archive.starts_with(dir));
    }

    #[test]
    fn account_bytes_allows_up_to_cap_and_reports_overflow() {
        // Tam sınırdaki değer kabul edilir.
        assert_eq!(account_bytes("a.exe", 90, 10, 100).unwrap(), 100);
        // Kümülatif aşım, gerçek okunan bayt toplamıyla bildirilir.
        let err = account_bytes("a.exe", 95, 10, 100).unwrap_err();
        assert!(matches!(
            err,
            DownloadError::ZipBomb {
                size: 105,
                limit: 100,
                ..
            }
        ));
    }

    #[test]
    fn account_bytes_saturates_instead_of_overflowing() {
        let err = account_bytes("a.exe", u64::MAX, 1, u64::MAX - 10).unwrap_err();
        assert!(matches!(
            err,
            DownloadError::ZipBomb {
                size: u64::MAX,
                ..
            }
        ));
    }

    // --- Tauri komut köprüsü (subtask 03) ---

    #[test]
    fn payload_string_accepts_camel_and_snake_keys() {
        let payload = serde_json::json!({ "componentId": "ffmpeg", "job_id": "job-1" });
        assert_eq!(
            payload_string(&payload, &["componentId", "component_id"]).unwrap(),
            "ffmpeg"
        );
        assert_eq!(
            payload_string(&payload, &["jobId", "job_id"]).unwrap(),
            "job-1"
        );
    }

    #[test]
    fn payload_string_rejects_missing_or_blank() {
        let payload = serde_json::json!({ "componentId": "   " });
        assert!(payload_string(&payload, &["componentId"]).is_err());
        assert!(payload_string(&payload, &["jobId"]).is_err());
    }

    #[test]
    fn plan_from_spec_carries_pin_and_bundle() {
        let spec = crate::components::download_spec("ffmpeg").expect("ffmpeg kaynağı olmalı");
        let plan = plan_from_spec(spec, PathBuf::from("components-dir"));
        // Tek arşivi paylaşan satırlar paket kimliğiyle yayılır.
        assert_eq!(plan.component_id, "ffmpeg-tools");
        assert_eq!(plan.sha256, spec.sha256);
        assert_eq!(plan.expected_bytes, Some(spec.expected_bytes));
        assert_eq!(plan.disk_required_bytes, Some(spec.disk_required_bytes));
        match plan.payload {
            Payload::Zip {
                dest_dir,
                wanted,
                max_entry_bytes,
            } => {
                assert_eq!(dest_dir, PathBuf::from("components-dir"));
                assert_eq!(
                    wanted,
                    vec!["ffmpeg.exe".to_string(), "ffprobe.exe".to_string()]
                );
                // Kap gerçek ikiliyi geçmeli, yoksa meşru çıkarma reddedilirdi.
                assert!(max_entry_bytes > 164_232_192);
            }
            Payload::Raw { .. } => panic!("ffmpeg zip arşivi olmalı"),
        }
    }

    #[test]
    fn registry_has_no_source_for_bundled_components() {
        // yt-dlp paketle GÖMÜLÜ gelir (yol haritası kararı): indirme kaynağı yok.
        assert!(crate::components::download_spec("yt-dlp").is_none());
        assert!(crate::components::download_spec("bilinmeyen").is_none());
        // whisper artık 7c-3 ile kayıttan iner (motor DLL'leriyle birlikte geldiği için
        // indirilen kopya ÇALIŞIR — gömülü kopyadaki DLL kusuru bu yolda yok).
        assert!(crate::components::download_spec("whisper").is_some());
    }
}
