//! IDM tarzı çok kanallı, **dinamik parçalı** indirme motoru.
//!
//! IDM'nin mekanizması (araştırma notları:
//! `.tmp/sessions/2026-10-14-idm-download-engine/context.md`):
//!
//! 1. `HEAD` ile `Accept-Ranges`/`Content-Length` yoklanır.
//! 2. Dosya `Range` ile N parçaya bölünür; her parça ayrı bağlantı.
//! 3. **Dinamik parçalama**: bir işçi boşa çıkınca *en büyük kalan parçayı ikiye
//!    böler* ve ikinci yarısını alır — hiçbir bağlantı boş beklemez.
//! 4. Durum ≈2 sn'de bir `.meta`ya yazılır → elektrik kesilse bile kaldığı
//!    yerden devam eder.
//! 5. `Accept-Ranges` yoksa tek doğrusal bağlantı; duraklatma anlamsızdır.
//!
//! **Gerçeğin kaynağı parça dosyasıdır** (`<hedef>.part_<id>`): uzunluğu o
//! parçanın indirilmiş bayt sayısıdır. Havuzdaki `downloaded` yazma anında
//! *kilit altında* güncellenir; böylece "ikiye böl" kararı ile diskteki veri
//! asla çelişemez (çelişirse dosya bozulur).

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

// ---------------------------------------------------------------- sabitler

/// Bir parça ikiye bölünmeden önce kalan kısmı en az bu kadar olmalı.
/// IDM de "bu bağlantı tipi için fazla küçükse bölmez".
const MIN_SPLIT_BYTES: u64 = 2 * 1024 * 1024;
/// Parça sayısı üst sınırı: part dosyası ve kilit çekişmesini sınırlar.
const MAX_SEGMENTS: usize = 128;
/// İlerleme olayı aralığı.
const PROGRESS_MS: u64 = 300;
/// `.meta` yazma aralığı (IDM: dakikada birkaç kez).
const META_MS: u64 = 2000;
/// Kuyruk kapısının yeniden denetleme aralığı.
const GATE_POLL_MS: u64 = 400;
/// Bir parça için üst üste en fazla kaç kez yeniden denenir (erken kapanan akış).
const SEG_ATTEMPTS: u32 = 3;
/// Çerez başlığı üst sınırı (bayt değil karakter).
const MAX_COOKIE_CHARS: usize = 16 * 1024;
const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                          (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// ------------------------------------------------------------- çalışma sınırı

/// Hız sınırı (bayt/sn). 0 = sınırsız. Globaldir: tüm işler paylaşır.
static LIMIT_BPS: AtomicU64 = AtomicU64::new(0);
/// Aynı anda indirilebilecek en fazla iş sayısı (IDM kuyruğu).
static MAX_CONCURRENT: AtomicUsize = AtomicUsize::new(3);

/// Ayarlardan gelen sınırları çalışma anına uygular (yeniden başlatma gerekmez).
pub(crate) fn set_runtime_limits(speed_limit_bps: u64, max_concurrent: usize) {
    LIMIT_BPS.store(speed_limit_bps, Ordering::Relaxed);
    MAX_CONCURRENT.store(max_concurrent.clamp(1, 16), Ordering::Relaxed);
    // Bekleyen işler yeni sınırı hemen görsün.
    gate().1.notify_waiters();
}

// -------------------------------------------------------------- hız sınırı

struct Pacer {
    last: Instant,
    /// Bayt cinsinden kredi; negatifse borç var (bekleme gerekir).
    credit: f64,
}

static PACER: OnceLock<Mutex<Pacer>> = OnceLock::new();

fn pacer() -> &'static Mutex<Pacer> {
    PACER.get_or_init(|| {
        Mutex::new(Pacer {
            last: Instant::now(),
            credit: 0.0,
        })
    })
}

/// `bytes` bayt okuyup diske yazdığımız için ne kadar beklememiz gerektiği.
///
/// Global ve paylaşımlıdır (IDM'in hız sınırı gibi tüm indirmelere uygular).
/// Sınır kapalıyken hiç dokunmaz.
///
/// ponytail: kredi kovalı kaba bir pacer; kova 250 ms ile sınırlı, böylece tek
/// bir patlama sınırı aşamaz ve aylaklıktan sonra birikir. Ölçülen hız sınırın
/// ±%10 bandında kalır; daha katı bir bant gerekirse kova payı küçültülür.
fn pace(bytes: u64) -> Option<Duration> {
    let limit = LIMIT_BPS.load(Ordering::Relaxed) as f64;
    if limit <= 0.0 {
        return None;
    }
    let mut p = pacer().lock().unwrap();
    let now = Instant::now();
    let dt = now.duration_since(p.last).as_secs_f64();
    p.last = now;
    p.credit = (p.credit + limit * dt).min(limit * 0.25);
    p.credit -= bytes as f64;
    if p.credit < 0.0 {
        Some(Duration::from_secs_f64(-p.credit / limit))
    } else {
        None
    }
}

// ------------------------------------------------------- eşzamanlılık kapısı

struct Gate {
    active: usize,
}

static GATE: OnceLock<(Mutex<Gate>, tokio::sync::Notify)> = OnceLock::new();

fn gate() -> &'static (Mutex<Gate>, tokio::sync::Notify) {
    GATE.get_or_init(|| (Mutex::new(Gate { active: 0 }), tokio::sync::Notify::new()))
}

/// Kapıyı tutan işçi sayısını düşürür. `Drop` ile bağlanır ki hata/iptal
/// yollarında da sızmasın.
struct SlotGuard;

impl Drop for SlotGuard {
    fn drop(&mut self) {
        let g = gate();
        if let Ok(mut m) = g.0.lock() {
            m.active = m.active.saturating_sub(1);
        }
        g.1.notify_waiters();
    }
}

enum SlotDenied {
    Cancelled,
    Paused,
}

/// Aynı anda en fazla `MAX_CONCURRENT` iş indirir; fazlası burada bekler ve
/// "queued" durumu yayınlanır (IDM kuyruğu). Sınır çalışma anında değişebilir.
async fn acquire_slot(
    rep: &Reporter,
    job_id: &str,
    file_size: u64,
    ctrl: &JobController,
) -> Result<SlotGuard, SlotDenied> {
    let mut announced = false;
    loop {
        // Bildirimi kapıyı denetlemeden ÖNCE kur: aradaki boşluğa denk gelen
        // bir serbest bırakma böylece kaçmaz (yoksa GATE_POLL_MS kadar bekleriz).
        let notified = gate().1.notified();
        {
            let mut m = gate().0.lock().unwrap();
            if m.active < MAX_CONCURRENT.load(Ordering::Relaxed) {
                m.active += 1;
                return Ok(SlotGuard);
            }
        }
        if ctrl.cancelled.load(Ordering::Relaxed) {
            return Err(SlotDenied::Cancelled);
        }
        if ctrl.paused.load(Ordering::Relaxed) {
            return Err(SlotDenied::Paused);
        }
        if !announced {
            announced = true;
            emit(rep, job_id, "queued", 0, file_size, 0.0, 0, 0, Vec::new(), None);
        }
        tokio::select! {
            _ = notified => {}
            _ = tokio::time::sleep(Duration::from_millis(GATE_POLL_MS)) => {}
        }
    }
}

// -------------------------------------------------------------------- tipler

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProbeResult {
    pub url: String,
    pub filename: String,
    pub file_size: u64,
    pub accepts_ranges: bool,
    pub content_type: Option<String>,
}

/// İndirme parçası. `[start, end]` hedef dosyadaki **dâhil** aralıktır.
/// Boyut bilinmiyorsa (`Content-Length` yok) `end == u64::MAX` ve tek parça olur.
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Segment {
    pub index: usize,
    pub start: u64,
    pub end: u64,
    #[serde(default)]
    pub downloaded: u64,
    #[serde(default)]
    pub done: bool,
    /// Yalnızca çalışma anı: sahiplenilmiş mi. Meta'ya yazılır ama okunurken
    /// sıfırlanır (yeniden başlatmada hiçbir parça sahipli değildir).
    #[serde(default)]
    pub claimed: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct DownloadMeta {
    pub job_id: String,
    pub url: String,
    pub filename: String,
    pub destination_path: String,
    pub file_size: u64,
    pub threads: usize,
    #[serde(default)]
    pub accepts_ranges: bool,
    pub segments: Vec<Segment>,
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
    /// Hata kalıcı mı (yeniden denemek düzeltmez mi)? Başarı/hareket hâllerinde
    /// her zaman `true`.
    pub retryable: bool,
}

/// Tarayıcıdan gelen istek başlıkları. Korunan/anti-hotlink sunucularda
/// indirme bunlar olmadan 403 döner (IDM bunları eklentiden alır).
#[derive(Clone, Debug, Default, Deserialize)]
pub struct RequestHeaders {
    pub referer: Option<String>,
    pub cookie: Option<String>,
    pub user_agent: Option<String>,
}

impl RequestHeaders {
    fn from_value(v: Option<&Value>) -> Self {
        let mut h: RequestHeaders = v
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        h.referer = h.referer.as_deref().map(sanitize_header_value);
        h.cookie = h.cookie.as_deref().map(sanitize_header_value);
        h.user_agent = h.user_agent.as_deref().map(sanitize_header_value);
        h
    }
}

/// Başlık değerinden CR/LF'i atar. Eklenti yerel ve token'lı olsa da başlık
/// enjeksiyonunu burada kesmek doğru yer: değer ağa buradan çıkıyor.
fn sanitize_header_value(v: &str) -> String {
    let mut out: String = v.chars().filter(|c| *c != '\r' && *c != '\n').collect();
    if out.len() > MAX_COOKIE_CHARS * 4 {
        let cut = out
            .char_indices()
            .nth(MAX_COOKIE_CHARS * 4)
            .map(|(i, _)| i)
            .unwrap_or(out.len());
        out.truncate(cut);
    }
    out
}

fn headerize(req: reqwest::RequestBuilder, h: &RequestHeaders) -> reqwest::RequestBuilder {
    let mut req = req;
    let ua = h.user_agent.as_deref().unwrap_or(DEFAULT_UA);
    if let Ok(v) = reqwest::header::HeaderValue::from_str(ua) {
        req = req.header(reqwest::header::USER_AGENT, v);
    }
    if let Some(r) = h.referer.as_deref().filter(|s| !s.is_empty()) {
        if let Ok(v) = reqwest::header::HeaderValue::from_str(r) {
            req = req.header(reqwest::header::REFERER, v);
        }
    }
    if let Some(c) = h.cookie.as_deref().filter(|s| !s.is_empty()) {
        let capped = c
            .char_indices()
            .nth(MAX_COOKIE_CHARS)
            .map(|(i, _)| &c[..i])
            .unwrap_or(c);
        if let Ok(v) = reqwest::header::HeaderValue::from_str(capped) {
            req = req.header(reqwest::header::COOKIE, v);
        }
    }
    req
}

fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().connect_timeout(Duration::from_secs(20))
}

// ------------------------------------------------------------- iş denetimi

struct JobController {
    paused: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
}

static CONTROLLERS: Mutex<Option<std::collections::HashMap<String, Arc<JobController>>>> =
    Mutex::new(None);

fn get_controller_map() -> &'static Mutex<Option<std::collections::HashMap<String, Arc<JobController>>>> {
    &CONTROLLERS
}

/// İşi yalnızca **çalışmıyorsa** kaydeder. Zaten çalışan bir iş için `None`
/// döner; çağıran bunu yok sayar.
///
/// Neden şart: aynı `job_id` için ikinci bir motor çalışırsa iki görev aynı
/// `.part_N` dosyalarına yazar ve indirilen dosya bozulur. (Arayüz aynı işi
/// yeniden gönderebilir: görünüm yeniden bağlanır, kuyruk uzlaştırması çalışır.)
fn register_job_if_idle(job_id: &str) -> Option<Arc<JobController>> {
    let mut lock = get_controller_map().lock().unwrap();
    let map = lock.get_or_insert_with(std::collections::HashMap::new);
    if let Some(existing) = map.get(job_id) {
        let running = !existing.paused.load(Ordering::SeqCst)
            && !existing.cancelled.load(Ordering::SeqCst);
        if running {
            return None;
        }
    }
    let ctrl = Arc::new(JobController {
        paused: Arc::new(AtomicBool::new(false)),
        cancelled: Arc::new(AtomicBool::new(false)),
    });
    map.insert(job_id.to_string(), ctrl.clone());
    Some(ctrl)
}

fn get_job(job_id: &str) -> Option<Arc<JobController>> {
    let lock = get_controller_map().lock().unwrap();
    lock.as_ref().and_then(|m| m.get(job_id).cloned())
}

fn unregister_job(job_id: &str) {
    let mut lock = get_controller_map().lock().unwrap();
    if let Some(map) = lock.as_mut() {
        map.remove(job_id);
    }
}

/// Uygulama açılışında kapıyı temizler: önceki oturumdan sızan yarıda kalmış
/// kayıtlar yeni indirmeleri bloklamasın.
pub(crate) fn reset_runtime_state() {
    let g = gate();
    if let Ok(mut m) = g.0.lock() {
        m.active = 0;
    }
    if let Ok(mut map) = get_controller_map().lock() {
        *map = Some(std::collections::HashMap::new());
    }
}

// ------------------------------------------------------------------ yardımcı

/// `Content-Disposition`dan dosya adı.
///
/// Neden bu kadar dikkatli: sunucular sık sık
/// `attachment; filename="a.zip"; filename*=UTF-8''a.zip` gönderir. Değeri
/// tırnakları soymadan `;` ile bölmek `a.zip"` üretir; sanitize de sondaki
/// tırnağı `_`ye çevirir → kullanıcı indirdiği dosyayı `a.zip_` olarak görür.
///
/// Bu yüzden: parametreler `;` ile ayrılır, değer **kendi** tırnaklarından
/// soyulur ve RFC 5987 (`filename*=`) biçimi düz biçimden önce gelir.
fn filename_from_disposition(cd: &str) -> Option<String> {
    let mut plain: Option<String> = None;
    let mut extended: Option<String> = None;

    for param in cd.split(';').skip(1) {
        let Some((key, value)) = param.split_once('=') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim();
        if key == "filename" {
            let trimmed = value.trim_matches(|c| c == '"' || c == '\'');
            if !trimmed.is_empty() {
                plain = Some(trimmed.to_string());
            }
        } else if key == "filename*" {
            // `UTF-8''dosya%20adi.zip` ya da `UTF-8'en'dosya.zip`
            let encoded = match value.match_indices('\'').nth(1) {
                Some((idx, _)) => &value[idx + 1..],
                None => value,
            };
            let decoded = percent_decode(encoded);
            if !decoded.trim().is_empty() {
                extended = Some(decoded);
            }
        }
    }
    extended.or(plain)
}

/// `%XX` çözümü (RFC 5987 değerleri). Geçersiz diziler olduğu gibi bırakılır.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn sanitize_filename(name: &str) -> String {    let sanitized: String = name
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

/// Kalıcı (yeniden denemenin düzeltemeyeceği) hataların makine işareti.
///
/// Neden işaret: arayüz "kendiliğinden yeniden dene" kararını hatanın
/// *metnini ayrıştırarak* vermemeli. Motor hatayı işaretler, `emit` işareti
/// soyar ve `retryable` alanını üretir — kullanıcı işareti asla görmez.
/// (Aynı desen: `BILESEN_EKSIK:<id>`, bkz. `src/lib/downloads.ts`.)
const PERMANENT_MARK: &str = "KALICI:";

/// İlerleme olaylarının tek çıkışı. Motor `AppHandle` bilmez; böylece Tauri
/// olmadan da (testte) çalıştırılabilir. Ayrıca tüm yayın biçimi tek yerde kalır.
#[derive(Clone)]
pub struct Reporter(Arc<dyn Fn(TurboProgressPayload) + Send + Sync>);

impl Reporter {
    fn to_app(app: AppHandle) -> Self {
        Reporter(Arc::new(move |p| {
            let _ = app.emit("turbo-download-progress", p);
        }))
    }

    #[cfg(test)]
    fn silent() -> Self {
        Reporter(Arc::new(|_| {}))
    }

    fn send(&self, p: TurboProgressPayload) {
        (self.0)(p);
    }
}

#[allow(clippy::too_many_arguments)]
fn emit(
    rep: &Reporter,
    job_id: &str,
    status: &str,
    downloaded_size: u64,
    file_size: u64,
    percent: f64,
    speed_bps: u64,
    eta_secs: u64,
    chunks: Vec<ChunkProgress>,
    error: Option<String>,
) {
    // Kalıcı hata işaretini burada soy ve `retryable`ı üret: arayüz kararı
    // metne bakarak vermez, işaret de kullanıcıya çıkmaz.
    let (error, retryable) = match error {
        Some(e) => match e.strip_prefix(PERMANENT_MARK) {
            Some(rest) => (Some(rest.to_string()), false),
            None => (Some(e), true),
        },
        None => (None, true),
    };
    rep.send(TurboProgressPayload {
        job_id: job_id.to_string(),
        status: status.to_string(),
        downloaded_size,
        file_size,
        percent,
        speed_bps,
        eta_secs,
        chunks,
        error,
        retryable,
    });
}

// ------------------------------------------------------- parça havuzu (saf)

/// Parçanın toplam aralık uzunluğu; boyut bilinmiyorsa `u64::MAX`.
fn total_range(s: &Segment) -> u64 {
    if s.end == u64::MAX {
        u64::MAX
    } else {
        s.end.saturating_sub(s.start) + 1
    }
}

/// Parçada kalan (henüz indirilmemiş) bayt sayısı.
fn remaining(s: &Segment) -> u64 {
    if s.done {
        return 0;
    }
    if s.end == u64::MAX {
        // Boyut bilinmiyor: akış bitene kadar okunur.
        return u64::MAX;
    }
    let next = s.start.saturating_add(s.downloaded);
    if next > s.end {
        0
    } else {
        s.end - next + 1
    }
}

/// Dosyayı eşit parçalara böler. `file_size == 0` ise tek, ucu açık parça döner.
fn initial_segments(file_size: u64, threads: usize) -> Vec<Segment> {
    let single = |end: u64| {
        vec![Segment {
            index: 0,
            start: 0,
            end,
            downloaded: 0,
            done: false,
            claimed: false,
        }]
    };
    if file_size == 0 {
        return single(u64::MAX);
    }
    // Parça başına en az 64 KB düşmeli; yoksa kanal sayısını düşür.
    let usable = (threads as u64).min(file_size / 65536).max(1) as usize;
    if usable <= 1 {
        return single(file_size - 1);
    }
    let chunk = file_size / usable as u64;
    (0..usable)
        .map(|i| {
            let start = i as u64 * chunk;
            let end = if i == usable - 1 {
                file_size - 1
            } else {
                (i + 1) as u64 * chunk - 1
            };
            Segment {
                index: i,
                start,
                end,
                downloaded: 0,
                done: false,
                claimed: false,
            }
        })
        .collect()
}

/// Sıradaki işi sahiplenir.
///
/// 1. Sahipsiz ve bitmemiş parçalardan **kalanı en büyük** olanı alır.
/// 2. Hiç sahipsiz yoksa **en büyük çalışan parçayı ikiye böler** ve ikinci
///    yarısını verir (IDM'nin dinamik parçalaması).
///
/// İş yoksa `None` — bu işçinin işi bitmiştir.
fn claim_work(segs: &mut Vec<Segment>, can_split: bool) -> Option<usize> {
    let unclaimed = segs
        .iter()
        .filter(|s| !s.claimed && !s.done && remaining(s) > 0)
        .map(|s| (s.index, remaining(s)))
        .max_by_key(|(_, r)| *r)
        .map(|(i, _)| i);
    if let Some(idx) = unclaimed {
        if let Some(s) = segs.iter_mut().find(|s| s.index == idx) {
            s.claimed = true;
        }
        return Some(idx);
    }
    if !can_split || segs.len() >= MAX_SEGMENTS {
        return None;
    }
    let best = segs
        .iter()
        .filter(|s| !s.done)
        .map(|s| (s.index, remaining(s)))
        .max_by_key(|(_, r)| *r);
    let (best_idx, best_rem) = best?;
    let half = best_rem / 2;
    if half < MIN_SPLIT_BYTES {
        return None;
    }
    let new_index = segs.iter().map(|s| s.index).max().unwrap_or(0) + 1;
    let (new_start, old_end) = {
        let s = segs.iter_mut().find(|s| s.index == best_idx)?;
        // Yalnızca *kalan* kısım bölünür: sahibi şimdiye kadar yazdıklarını
        // korur, yeni parça kalanın ikinci yarısından başlar.
        let split_at = s.start.saturating_add(s.downloaded).saturating_add(half);
        let old_end = s.end;
        if split_at > old_end {
            return None;
        }
        s.end = split_at - 1;
        (split_at, old_end)
    };
    segs.push(Segment {
        index: new_index,
        start: new_start,
        end: old_end,
        downloaded: 0,
        done: false,
        claimed: true,
    });
    Some(new_index)
}

// --------------------------------------------------------------- yoklama

async fn probe(url: &str, headers: &RequestHeaders) -> Result<ProbeResult, String> {
    let client = client_builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    // Önce HEAD; olmuyorsa `Range: bytes=0-0` ile GET.
    let head = headerize(client.head(url), headers).send().await;
    let (status, hdrs) = match head {
        Ok(resp) if resp.status().is_success() => (resp.status(), resp.headers().clone()),
        _ => {
            let resp = headerize(client.get(url), headers)
                .header(reqwest::header::RANGE, "bytes=0-0")
                .send()
                .await
                .map_err(|e| format!("Bağlantı kurulamadı: {e}"))?;
            (resp.status(), resp.headers().clone())
        }
    };

    let accepts_ranges = hdrs
        .get(reqwest::header::ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_lowercase().contains("bytes"))
        .unwrap_or(false)
        || status == reqwest::StatusCode::PARTIAL_CONTENT;

    let mut file_size: u64 = 0;
    if let Some(len) = hdrs
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
    {
        file_size = len.parse::<u64>().unwrap_or(0);
    }
    if file_size == 0 {
        if let Some(cr) = hdrs
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
        {
            // "bytes 0-0/10485760"
            if let Some(slash) = cr.find('/') {
                file_size = cr[slash + 1..].trim().parse::<u64>().unwrap_or(0);
            }
        }
    }

    let mut filename = String::new();
    if let Some(cd) = hdrs
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
    {
        if let Some(name) = filename_from_disposition(cd) {
            filename = sanitize_filename(&name);
        }
    }
    if filename.is_empty() {
        filename = extract_filename_from_url(url);
    }

    Ok(ProbeResult {
        url: url.to_string(),
        filename,
        file_size,
        accepts_ranges,
        content_type: hdrs
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string),
    })
}

// -------------------------------------------------------------- komutlar

#[tauri::command]
pub async fn turbo_probe_url(url: String, headers: Option<Value>) -> Result<ProbeResult, String> {
    let h = RequestHeaders::from_value(headers.as_ref());
    probe(&url, &h).await
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
        .unwrap_or(8)
        .clamp(1, 32) as usize;
    let headers = RequestHeaders::from_value(payload.get("headers"));

    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("Geçersiz bağlantı: yalnızca http:// veya https:// kabul edilir.".to_string());
    }
    let url = trimmed.to_string();

    let Some(ctrl) = register_job_if_idle(&job_id) else {
        // Zaten çalışıyor: ikinci bir motor başlatmak dosyayı bozar.
        return Ok(());
    };
    let rep = Reporter::to_app(app.clone());
    tokio::spawn(async move {
        if let Err(e) = run_turbo_download(
            rep.clone(),
            job_id.clone(),
            url,
            filename,
            destination_path,
            file_size,
            threads,
            headers,
            ctrl,
        )
        .await
        {
            emit(
                &rep,
                &job_id,
                "error",
                0,
                file_size,
                0.0,
                0,
                0,
                Vec::new(),
                Some(e),
            );
            unregister_job(&job_id);
        }
    });

    Ok(())
}

// ------------------------------------------------------------------ motor

enum Stop {
    Paused,
    Cancelled,
}

struct SegCtx {
    client: reqwest::Client,
    url: String,
    dest_base: String,
    headers: RequestHeaders,
    segments: Arc<Mutex<Vec<Segment>>>,
    ctrl: Arc<JobController>,
    can_split: bool,
    /// İlk hata buraya yazılır; `run` sonunda okunur. Global DEĞİL: her iş
    /// kendi hatasını taşır, aksi hâlde eşzamanlı indirmeler birbirinin
    /// hatasını okur.
    error: Mutex<Option<String>>,
}

impl SegCtx {
    fn set_error(&self, msg: &str) {
        let mut e = self.error.lock().unwrap();
        if e.is_none() {
            *e = Some(msg.to_string());
        }
    }

    fn take_error(&self) -> Option<String> {
        self.error.lock().unwrap().take()
    }
}

enum SegErr {
    /// Geçici hata (koptu, erken kapandı) — yeniden denenebilir.
    Retry(String),
    Fatal(String),
    Stop(Stop),
}

fn part_path(dest_base: &str, index: usize) -> String {
    format!("{dest_base}.part_{index}")
}

/// Bir parçayı sonuna kadar indirir. Dönerken parça ya `done`dur ya da bir
/// bölünme sırasında kardeşine devredilmiştir (o da `done` sayılır).
async fn download_one_segment(ctx: &SegCtx, seg_idx: usize) -> Result<(), SegErr> {
    let (start, end) = {
        let pool = ctx.segments.lock().unwrap();
        let Some(s) = pool.iter().find(|s| s.index == seg_idx) else {
            return Ok(());
        };
        (s.start, s.end)
    };

    let path = part_path(&ctx.dest_base, seg_idx);
    let existing = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let cap = if end == u64::MAX {
        u64::MAX
    } else {
        end.saturating_sub(start) + 1
    };

    // Düzen değişmişse (parça küçülmüş) artık baytlar çöptür: baştan başla.
    let truncated = existing > cap;
    let mut written = if truncated { 0 } else { existing.min(cap) };

    if written == cap && cap != u64::MAX {
        let mut pool = ctx.segments.lock().unwrap();
        if let Some(s) = pool.iter_mut().find(|s| s.index == seg_idx) {
            s.downloaded = written;
            s.done = true;
        }
        return Ok(());
    }

    let mut file = if truncated {
        OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)
            .map_err(|e| SegErr::Fatal(format!("Part dosyası açılamadı: {e}")))?
    } else {
        OpenOptions::new()
            .create(true)
            .write(true)
            .append(true)
            .open(&path)
            .map_err(|e| SegErr::Fatal(format!("{PERMANENT_MARK}Part dosyası açılamadı: {e}")))?
    };
    {
        let mut pool = ctx.segments.lock().unwrap();
        if let Some(s) = pool.iter_mut().find(|s| s.index == seg_idx) {
            s.downloaded = written;
        }
    }

    let mut request = headerize(ctx.client.get(&ctx.url), &ctx.headers);
    let fetch_from = start + written;
    if end != u64::MAX {
        if fetch_from > end {
            return Ok(());
        }
        request = request.header(
            reqwest::header::RANGE,
            format!("bytes={fetch_from}-{end}"),
        );
    } else if fetch_from > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={fetch_from}-"));
    }

    let mut resp = request
        .send()
        .await
        .map_err(|e| SegErr::Retry(format!("Parça {seg_idx} isteği başarısız: {e}")))?;
    let status = resp.status();
    if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
        // 4xx kalıcıdır (404 = dosya yok, 403 = yetki): yeniden denemek
        // düzeltmez. 408/429 ve tüm 5xx geçicidir → yeniden denenir.
        let permanent = status.is_client_error()
            && status != reqwest::StatusCode::REQUEST_TIMEOUT
            && status != reqwest::StatusCode::TOO_MANY_REQUESTS;
        let msg = format!("Parça {seg_idx} HTTP hatası: {status}");
        return Err(if permanent {
            SegErr::Fatal(format!("{PERMANENT_MARK}{msg}"))
        } else {
            SegErr::Retry(msg)
        });
    }
    if status == reqwest::StatusCode::OK && fetch_from > 0 {
        // Sunucu Range'i yok saydı ve tüm gövdeyi gönderiyor.
        let count = ctx.segments.lock().unwrap().len();
        if count > 1 {
            return Err(SegErr::Fatal(format!(
                "{PERMANENT_MARK}Sunucu parça indirmeyi (Range) desteklemiyor."
            )));
        }
        file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)
            .map_err(|e| SegErr::Fatal(format!("{PERMANENT_MARK}Part dosyası açılamadı: {e}")))?;
        written = 0;
    }

    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| SegErr::Retry(format!("Akış koptu ({seg_idx}): {e}")))?
    {
        if ctx.ctrl.cancelled.load(Ordering::Relaxed) {
            let _ = file.flush();
            return Err(SegErr::Stop(Stop::Cancelled));
        }
        if ctx.ctrl.paused.load(Ordering::Relaxed) {
            let _ = file.flush();
            return Err(SegErr::Stop(Stop::Paused));
        }

        let mut take = chunk.len() as u64;
        {
            // Kilit, diske yazma boyunca tutulur. Böylece "ikiye böl" kararı
            // havuzdaki `downloaded`ı okuduğunda diskteki baytla birebir
            // aynıdır; aksi hâlde yeni parça çakışır ve dosya bozulur.
            let mut pool = ctx.segments.lock().unwrap();
            let Some(s) = pool.iter_mut().find(|s| s.index == seg_idx) else {
                return Ok(());
            };
            if s.end != u64::MAX {
                let absolute_next = start + written;
                let room = if absolute_next > s.end {
                    0
                } else {
                    s.end - absolute_next + 1
                };
                if room == 0 {
                    // Bu aralık bizden alınmış: kalan baytlar kardeşe ait.
                    s.downloaded = written;
                    s.done = true;
                    let _ = file.flush();
                    return Ok(());
                }
                take = take.min(room);
            }
            file.write_all(&chunk[..take as usize])
                .map_err(|e| SegErr::Fatal(format!("{PERMANENT_MARK}Diske yazılamadı: {e}")))?;
            written += take;
            s.downloaded = written;
        }

        if let Some(d) = pace(take) {
            tokio::time::sleep(d).await;
        }

        if take < chunk.len() as u64 {
            // Parçamız bölündü; artan baytlar kardeş parçaya ait.
            let mut pool = ctx.segments.lock().unwrap();
            if let Some(s) = pool.iter_mut().find(|s| s.index == seg_idx) {
                s.downloaded = written;
                s.done = true;
            }
            let _ = file.flush();
            return Ok(());
        }
    }

    let _ = file.flush();
    let finished = {
        let mut pool = ctx.segments.lock().unwrap();
        match pool.iter_mut().find(|s| s.index == seg_idx) {
            Some(s) => {
                s.downloaded = written;
                if s.end == u64::MAX || start + written > s.end {
                    s.done = true;
                    true
                } else {
                    false
                }
            }
            None => true,
        }
    };
    if finished {
        Ok(())
    } else {
        // Sunucu akışı erken kapattı: kalanı yeniden dene.
        Err(SegErr::Retry(format!(
            "Parça {seg_idx} erken tamamlandı"
        )))
    }
}

fn write_meta(path: &Path, meta: &DownloadMeta) {
    if let Ok(json) = serde_json::to_string(meta) {
        let _ = std::fs::write(path, json);
    }
}

fn snapshot_meta(
    job_id: &str,
    url: &str,
    filename: &str,
    dest: &str,
    file_size: u64,
    threads: usize,
    accepts_ranges: bool,
    segs: &[Segment],
) -> DownloadMeta {
    let mut cleared = segs.to_vec();
    for s in cleared.iter_mut() {
        s.claimed = false;
    }
    DownloadMeta {
        job_id: job_id.to_string(),
        url: url.to_string(),
        filename: filename.to_string(),
        destination_path: dest.to_string(),
        file_size,
        threads,
        accepts_ranges,
        segments: cleared,
    }
}

fn cleanup_parts(dest_base: &str, segs: &[Segment]) {
    for s in segs {
        let _ = std::fs::remove_file(part_path(dest_base, s.index));
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_turbo_download(
    rep: Reporter,
    job_id: String,
    url: String,
    filename: String,
    dest_path_str: String,
    requested_size: u64,
    mut threads: usize,
    headers: RequestHeaders,
    ctrl: Arc<JobController>,
) -> Result<(), String> {
    let dest_path = PathBuf::from(&dest_path_str);
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let meta_path = PathBuf::from(format!("{dest_path_str}.meta"));

    // Önceki oturumdan kalan meta varsa (aynı URL) parça düzeni buradan gelir.
    let saved: Option<DownloadMeta> = std::fs::read_to_string(&meta_path)
        .ok()
        .and_then(|d| serde_json::from_str::<DownloadMeta>(&d).ok())
        .filter(|m| m.url == url);

    // Yoklama: boyut + Range desteği. Meta varsa yalnızca boyut teyidi için
    // yapılır; başarısız olursa kayıtlı düzenle devam edilir.
    let probed = probe(&url, &headers).await.ok();
    let mut file_size = probed
        .as_ref()
        .map(|p| p.file_size)
        .filter(|s| *s > 0)
        .or(saved.as_ref().map(|m| m.file_size).filter(|s| *s > 0))
        .unwrap_or(requested_size);
    let accepts_ranges = probed
        .as_ref()
        .map(|p| p.accepts_ranges)
        .or(saved.as_ref().map(|m| m.accepts_ranges))
        .unwrap_or(threads > 1);
    // Boyutu bilmiyorsak ama kayıtlı meta varsa onu kullan.
    if file_size == 0 {
        if let Some(m) = saved.as_ref() {
            file_size = m.file_size;
        }
    }

    if !accepts_ranges {
        // IDM kuralı: Range yoksa tek doğrusal bağlantı, duraklatma anlamsız.
        threads = 1;
    }
    let can_split = accepts_ranges && file_size > 0;

    let mut segments = match saved {
        Some(m) if !m.segments.is_empty() && m.file_size == file_size => {
            let mut segs = m.segments;
            for s in segs.iter_mut() {
                s.claimed = false;
            }
            segs
        }
        _ => initial_segments(file_size, threads),
    };
    for s in segments.iter_mut() {
        s.claimed = false;
    }
    // İşçi sayısı mevcut parçadan fazlaysa dosyayı daha ince böl.
    if can_split && segments.len() < threads {
        segments = initial_segments(file_size, threads);
        for s in segments.iter_mut() {
            s.claimed = false;
        }
    }
    let worker_count = if can_split { threads } else { 1 };

    let segments_state = Arc::new(Mutex::new(segments));

    // Kuyruk kapısı: aynı anda en fazla N iş. Beklerken "queued" yayınlanır.
    let _slot = match acquire_slot(&rep, &job_id, file_size, &ctrl).await {
        Ok(slot) => slot,
        Err(SlotDenied::Paused) => {
            let segs = segments_state.lock().unwrap().clone();
            write_meta(
                &meta_path,
                &snapshot_meta(
                    &job_id,
                    &url,
                    &filename,
                    &dest_path_str,
                    file_size,
                    threads,
                    accepts_ranges,
                    &segs,
                ),
            );
            emit(&rep, &job_id, "paused", 0, file_size, 0.0, 0, 0, Vec::new(), None);
            return Ok(());
        }
        Err(SlotDenied::Cancelled) => {
            let segs = segments_state.lock().unwrap().clone();
            cleanup_parts(&dest_path_str, &segs);
            let _ = std::fs::remove_file(&meta_path);
            return Ok(());
        }
    };

    // İlerleme döngüsü.
    let rep_progress = rep.clone();
    let job_progress = job_id.clone();
    let pool_progress = segments_state.clone();
    let ctrl_progress = ctrl.clone();
    let meta_progress = meta_path.clone();
    let url_progress = url.clone();
    let filename_progress = filename.clone();
    let dest_progress = dest_path_str.clone();

    let progress_handle = tokio::spawn(async move {
        let mut last = Instant::now();
        let mut last_total = 0u64;
        let mut last_meta = Instant::now() - Duration::from_millis(META_MS);
        loop {
            tokio::time::sleep(Duration::from_millis(PROGRESS_MS)).await;
            if ctrl_progress.cancelled.load(Ordering::Relaxed) {
                break;
            }

            let meta_due = last_meta.elapsed() >= Duration::from_millis(META_MS);
            if meta_due {
                last_meta = Instant::now();
            }
            let (total, progs, all_done, snap) = {
                let pool = pool_progress.lock().unwrap();
                let mut total = 0u64;
                let mut progs = Vec::with_capacity(pool.len());
                let mut all_done = true;
                for s in pool.iter() {
                    total += s.downloaded;
                    let tr = total_range(s);
                    let pct = if s.done {
                        100.0
                    } else if tr == 0 || tr == u64::MAX {
                        0.0
                    } else {
                        (s.downloaded as f64 / tr as f64 * 100.0).clamp(0.0, 100.0)
                    };
                    progs.push(ChunkProgress {
                        id: s.index,
                        percent: pct,
                    });
                    if !s.done {
                        all_done = false;
                    }
                }
                let snap = if meta_due {
                    Some(snapshot_meta(
                        &job_progress,
                        &url_progress,
                        &filename_progress,
                        &dest_progress,
                        file_size,
                        threads,
                        accepts_ranges,
                        &pool,
                    ))
                } else {
                    None
                };
                (total, progs, all_done, snap)
            };

            let now = Instant::now();
            let elapsed = now.duration_since(last).as_secs_f64();
            let speed = if elapsed > 0.0 && total >= last_total {
                ((total - last_total) as f64 / elapsed) as u64
            } else {
                0
            };
            last = now;
            last_total = total;
            let eta = if speed > 0 && file_size > total {
                (file_size - total) / speed
            } else {
                0
            };
            let percent = if file_size > 0 {
                (total as f64 / file_size as f64 * 100.0).clamp(0.0, 100.0)
            } else {
                0.0
            };
            let is_paused = ctrl_progress.paused.load(Ordering::Relaxed);
            let status = if all_done {
                "completed"
            } else if is_paused {
                "paused"
            } else {
                "active"
            };

            emit(
                &rep_progress,
                &job_progress,
                status,
                total,
                file_size,
                percent,
                speed,
                eta,
                progs,
                None,
            );

            if let Some(snap) = snap {
                if !all_done {
                    write_meta(&meta_progress, &snap);
                }
            }

            if all_done || is_paused {
                break;
            }
        }
    });

    // İşçiler: her biri bitince havuzdan yeni iş alır; iş yoksa en büyük
    // parçayı ikiye böler (dinamik parçalama).
    let ctx = Arc::new(SegCtx {
        client: client_builder()
            .pool_max_idle_per_host(0)
            .build()
            .map_err(|e| e.to_string())?,
        url: url.clone(),
        dest_base: dest_path_str.clone(),
        headers,
        segments: segments_state.clone(),
        ctrl: ctrl.clone(),
        can_split,
        error: Mutex::new(None),
    });

    let mut tasks = Vec::with_capacity(worker_count);
    for _ in 0..worker_count {
        let ctx_w = ctx.clone();
        tasks.push(tokio::spawn(async move {
            loop {
                if ctx_w.ctrl.cancelled.load(Ordering::Relaxed) {
                    return;
                }
                if ctx_w.ctrl.paused.load(Ordering::Relaxed) {
                    return;
                }
                let next = {
                    let mut pool = ctx_w.segments.lock().unwrap();
                    claim_work(&mut pool, ctx_w.can_split)
                };
                let Some(seg_idx) = next else {
                    return;
                };

                let mut attempt = 0u32;
                loop {
                    attempt += 1;
                    match download_one_segment(&ctx_w, seg_idx).await {
                        Ok(()) => break,
                        Err(SegErr::Retry(_)) if attempt < SEG_ATTEMPTS => {
                            tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
                        }
                        Err(SegErr::Retry(msg)) => {
                            ctx_w.set_error(&msg);
                            return;
                        }
                        Err(SegErr::Fatal(msg)) => {
                            ctx_w.set_error(&msg);
                            return;
                        }
                        Err(SegErr::Stop(Stop::Cancelled)) | Err(SegErr::Stop(Stop::Paused)) => {
                            return;
                        }
                    }
                }
            }
        }));
    }

    for t in tasks {
        let _ = t.await;
    }
    let _ = progress_handle.await;

    let segs_now = segments_state.lock().unwrap().clone();

    // 1) Duraklatıldı → meta yaz, part dosyaları yerinde kalsın.
    if ctrl.paused.load(Ordering::Relaxed) {
        write_meta(
            &meta_path,
            &snapshot_meta(
                &job_id,
                &url,
                &filename,
                &dest_path_str,
                file_size,
                threads,
                accepts_ranges,
                &segs_now,
            ),
        );
        let total: u64 = segs_now.iter().map(|s| s.downloaded).sum();
        let percent = if file_size > 0 {
            (total as f64 / file_size as f64 * 100.0).clamp(0.0, 100.0)
        } else {
            0.0
        };
        emit(&rep, &job_id, "paused", total, file_size, percent, 0, 0, Vec::new(), None);
        return Ok(());
    }

    // 2) İptal edildi → geçici dosyaları temizle.
    if ctrl.cancelled.load(Ordering::Relaxed) {
        cleanup_parts(&dest_path_str, &segs_now);
        let _ = std::fs::remove_file(&meta_path);
        return Ok(());
    }

    // 3) Hata varsa bildir (mesaj işçide `error_state`ye yazıldı).
    if let Some(msg) = ctx.take_error() {
        write_meta(
            &meta_path,
            &snapshot_meta(
                &job_id,
                &url,
                &filename,
                &dest_path_str,
                file_size,
                threads,
                accepts_ranges,
                &segs_now,
            ),
        );
        return Err(msg);
    }

    if !segs_now.iter().all(|s| s.done) {
        return Err("İndirme tamamlanamadı: bazı parçalar eksik kaldı.".to_string());
    }

    // 4) Birleştir: parçalar HEDEF DOSYADAKİ sıraya göre yazılır (index sırası
    //    dinamik bölünmeyle karışabilir).
    let mut ordered = segs_now.clone();
    ordered.sort_by_key(|s| (s.start, s.end));
    let mut final_file =
        File::create(&dest_path).map_err(|e| format!("Hedef dosya oluşturulamadı: {e}"))?;
    let mut buf = vec![0u8; 256 * 1024];
    let mut merged: u64 = 0;
    for s in &ordered {
        let p = part_path(&dest_path_str, s.index);
        let mut part = File::open(&p)
            .map_err(|e| format!("Parça {} okunamadı: {e}", s.index))?;
        loop {
            let n = part
                .read(&mut buf)
                .map_err(|e| format!("Parça {} okunamadı: {e}", s.index))?;
            if n == 0 {
                break;
            }
            final_file
                .write_all(&buf[..n])
                .map_err(|e| format!("Hedef dosyaya yazılamadı: {e}"))?;
            merged += n as u64;
        }
        let _ = std::fs::remove_file(&p);
    }
    final_file
        .flush()
        .map_err(|e| format!("Hedef dosya kaydedilemedi: {e}"))?;
    drop(final_file);

    if file_size > 0 && merged != file_size {
        let _ = std::fs::remove_file(&dest_path);
        return Err(format!(
            "{PERMANENT_MARK}Birleştirme sonrası boyut uyuşmuyor (beklenen {file_size}, gelen {merged})."
        ));
    }
    let _ = std::fs::remove_file(&meta_path);

    let chunks = ordered
        .iter()
        .map(|s| ChunkProgress {
            id: s.index,
            percent: 100.0,
        })
        .collect();
    emit(
        &rep,
        &job_id,
        "completed",
        merged,
        file_size,
        if file_size > 0 { 100.0 } else { 0.0 },
        0,
        0,
        chunks,
        None,
    );

    unregister_job(&job_id);
    Ok(())
}

// ------------------------------------------------------------------ testler

#[cfg(test)]
mod tests {
    use super::*;

    const MIB: u64 = 1024 * 1024;

    fn seg(index: usize, start: u64, end: u64) -> Segment {
        Segment {
            index,
            start,
            end,
            downloaded: 0,
            done: false,
            claimed: false,
        }
    }

    #[test]
    fn initial_split_covers_file_exactly() {
        let segs = initial_segments(16 * MIB, 4);
        assert_eq!(segs.len(), 4);
        assert_eq!(segs[0].start, 0);
        assert_eq!(segs[3].end, 16 * MIB - 1);
        // Aralıklar bitişik ve boşluksuz olmalı.
        for w in segs.windows(2) {
            assert_eq!(w[0].end + 1, w[1].start);
        }
    }

    #[test]
    fn unknown_size_is_single_open_segment() {
        let segs = initial_segments(0, 8);
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].end, u64::MAX);
    }

    #[test]
    fn tiny_file_never_multi_segment() {
        assert_eq!(initial_segments(1000, 8).len(), 1);
    }

    #[test]
    fn claim_prefers_largest_unclaimed() {
        let mut segs = vec![seg(0, 0, MIB - 1), seg(1, MIB, 6 * MIB - 1)];
        let idx = claim_work(&mut segs, true).expect("iş var");
        assert_eq!(idx, 1, "kalanı büyük olan sahiplenilmeli");
        assert!(segs[1].claimed);
    }

    #[test]
    fn claim_returns_none_when_everything_done() {
        let mut segs = vec![seg(0, 0, MIB - 1)];
        segs[0].done = true;
        assert!(claim_work(&mut segs, true).is_none());
    }

    #[test]
    fn splits_largest_segment_in_half_when_none_free() {
        // Her parça 4 MiB kaldı → yarısı 2 MiB = MIN_SPLIT_BYTES, bölünebilir.
        let mut segs = initial_segments(16 * MIB, 4);
        for s in segs.iter_mut() {
            s.claimed = true;
        }
        let new_idx = claim_work(&mut segs, true).expect("bölünmeli");
        assert_eq!(segs.len(), 5);
        let new = segs.iter().find(|s| s.index == new_idx).unwrap();
        // En büyük parça (index 3) ikiye bölünür: kalanın ikinci yarısı yeni parça.
        assert_eq!(new.start, 14 * MIB);
        assert_eq!(new.end, 16 * MIB - 1);
        assert!(new.claimed);
        let parent = segs.iter().find(|s| s.index == 3).unwrap();
        assert_eq!(parent.end, new.start - 1, "üst parça kısaltılmalı");
    }

    #[test]
    fn split_respects_min_size() {
        // Her parça 3 MiB kaldı → yarısı 1.5 MiB < 2 MiB, bölünmez.
        let mut segs = initial_segments(12 * MIB, 4);
        for s in segs.iter_mut() {
            s.claimed = true;
        }
        assert!(claim_work(&mut segs, true).is_none());
        assert_eq!(segs.len(), 4);
    }

    #[test]
    fn split_uses_remaining_not_whole_range() {
        // 0-7 MiB aralığı, 6 MiB indirilmiş → kalan 2 MiB, yarısı 1 MiB < eşik.
        let mut segs = vec![Segment {
            index: 0,
            start: 0,
            end: 8 * MIB - 1,
            downloaded: 6 * MIB,
            done: false,
            claimed: true,
        }];
        assert!(claim_work(&mut segs, true).is_none());
    }

    #[test]
    fn no_split_when_size_unknown() {
        let mut segs = vec![seg(0, 0, u64::MAX)];
        segs[0].claimed = true;
        assert!(claim_work(&mut segs, false).is_none());
    }

    #[test]
    fn remaining_accounts_for_downloaded() {
        let mut s = seg(0, 0, 999);
        assert_eq!(remaining(&s), 1000);
        s.downloaded = 400;
        assert_eq!(remaining(&s), 600);
        s.downloaded = 1000;
        assert_eq!(remaining(&s), 0);
        s.done = true;
        assert_eq!(remaining(&s), 0);
    }

    #[test]
    fn sanitizes_windows_illegal_chars() {
        assert_eq!(sanitize_filename("a/b:c*d?e"), "a_b_c_d_e");
        assert_eq!(sanitize_filename("   "), "downloaded_file");
    }

    #[test]
    fn header_sanitizer_strips_crlf() {
        assert_eq!(sanitize_header_value("a\r\nb"), "ab");
    }

    /// Kullanıcı raporu: indirilen zip'in adının sonuna `_` eklendi.
    ///
    /// Kök neden: eski ayrıştırma tırnakları **önce** soyuyor, **sonra** `;` ile
    /// bölüyordu. Sunucular sık sık `filename="a.zip"; filename*=UTF-8''a.zip`
    /// gönderir; o sırada ad `a.zip"` olur ve sanitize sondaki tırnağı `_`ye
    /// çevirir → `a.zip_`.
    #[test]
    fn content_disposition_with_filename_star_must_not_gain_trailing_underscore() {
        let cd = r#"attachment; filename="dosya.zip"; filename*=UTF-8''dosya.zip"#;

        // Eski davranışın ürettiği ara değer ve sonuç — hata burada doğuyor.
        let part = &cd[cd.find("filename=").expect("filename= var") + 9..];
        let naive = part
            .trim_matches(|c| c == '"' || c == '\'')
            .split(';')
            .next()
            .unwrap_or("");
        assert_eq!(naive, "dosya.zip\"");
        assert_eq!(sanitize_filename(naive), "dosya.zip_");

        // Yeni ayrıştırma tırnağı dışarıda bırakır.
        assert_eq!(filename_from_disposition(cd).as_deref(), Some("dosya.zip"));
    }

    #[test]
    fn content_disposition_parses_common_forms() {
        assert_eq!(
            filename_from_disposition(r#"attachment; filename="rapor.pdf""#).as_deref(),
            Some("rapor.pdf")
        );
        assert_eq!(
            filename_from_disposition("attachment; filename=veri.csv").as_deref(),
            Some("veri.csv")
        );
        // RFC 5987: yüzde kodlu ve tırnaksız.
        assert_eq!(
            filename_from_disposition("attachment; filename*=UTF-8''T%C3%BCrk%C3%A7e%20ad.zip")
                .as_deref(),
            Some("Türkçe ad.zip")
        );
        // Dil etiketi taşıyan biçim.
        assert_eq!(
            filename_from_disposition("attachment; filename*=UTF-8'en'ad.zip").as_deref(),
            Some("ad.zip")
        );
        // Genişletilmiş biçim düz biçimden önce gelir.
        assert_eq!(
            filename_from_disposition("attachment; filename=eski.zip; filename*=UTF-8''yeni.zip")
                .as_deref(),
            Some("yeni.zip")
        );
        // Yol ayıracı taşıyan ad sanitize ile temizlenir.
        assert_eq!(
            sanitize_filename(&filename_from_disposition(r#"attachment; filename="..\kotu.exe""#).unwrap()),
            ".._kotu.exe"
        );
        // Ne `filename` ne `filename*` varsa `None`.
        assert_eq!(filename_from_disposition("attachment"), None);
    }

    #[test]
    fn percent_decode_leaves_invalid_sequences_alone() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%ZZ"), "%ZZ");
        assert_eq!(percent_decode("%C3%BC"), "ü");
    }
    /// Arayüz "yeniden dene" kararını hatanın metnine bakarak vermez: motor
    /// kalıcı hatayı işaretler, `emit` işareti soyar ve bayrağı üretir.
    #[test]
    fn permanent_marker_is_stripped_and_sets_retryable_false() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_rep = seen.clone();
        let rep = Reporter(Arc::new(move |p: TurboProgressPayload| {
            seen_rep.lock().unwrap().push((p.error.clone(), p.retryable));
        }));

        emit(
            &rep,
            "j",
            "error",
            0,
            0,
            0.0,
            0,
            0,
            Vec::new(),
            Some(format!("{PERMANENT_MARK}Parça 0 HTTP hatası: 403 Forbidden")),
        );
        emit(
            &rep,
            "j",
            "error",
            0,
            0,
            0.0,
            0,
            0,
            Vec::new(),
            Some("Akış koptu".to_string()),
        );
        emit(&rep, "j", "active", 0, 0, 0.0, 0, 0, Vec::new(), None);

        let got = seen.lock().unwrap().clone();
        assert_eq!(
            got[0],
            (Some("Parça 0 HTTP hatası: 403 Forbidden".to_string()), false),
            "işaret soyulmalı, kalıcı hata yeniden denenmemeli"
        );
        assert_eq!(got[1], (Some("Akış koptu".to_string()), true));
        assert_eq!(got[2], (None, true), "hatasız olayda bayrak true");
    }

    // ---------------------------------------------------------------------
    // Uçtan uca: gerçek bir yerel HTTP (Range) sunucusuna karşı. Bu testler
    // parça aralıklarının, dinamik bölünmenin, devam etmenin ve birleştirmenin
    // ortak doğruluğunu ölçer — bozulursa dosya birebir eşleşmez.
    // ---------------------------------------------------------------------

    fn body_of(size: usize) -> Vec<u8> {
        (0..size)
            .map(|i| (i.wrapping_mul(31) ^ (i >> 8)) as u8)
            .collect()
    }

    fn parse_range(v: &str) -> Option<(usize, usize)> {
        let rest = v.trim().strip_prefix("bytes=")?;
        let (a, b) = rest.split_once('-')?;
        let start: usize = a.trim().parse().ok()?;
        let end: usize = if b.trim().is_empty() {
            usize::MAX
        } else {
            b.trim().parse().ok()?
        };
        Some((start, end))
    }

    struct TestServer {
        url: String,
        served: Arc<AtomicUsize>,
    }

    /// `Range` destekleyen minik sunucu. `tail_delay_ms > 0` ise dosyanın son
    /// çeyreği yavaş servis edilir: bir bağlantının boşa çıkıp *en büyük parçayı
    /// ikiye bölmesi* (IDM'nin dinamik parçalaması) tam olarak bu durumda olur.
    fn spawn_range_server(body: Vec<u8>, tail_delay_ms: u64) -> TestServer {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let total = body.len();
        let body = Arc::new(body);
        let served = Arc::new(AtomicUsize::new(0));
        let served_srv = served.clone();

        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { break };
                let body = body.clone();
                let served = served_srv.clone();
                std::thread::spawn(move || handle_conn(stream, &body, total, tail_delay_ms, &served));
            }
        });

        TestServer {
            url: format!("http://{addr}/file.bin"),
            served,
        }
    }

    fn handle_conn(
        mut stream: std::net::TcpStream,
        body: &[u8],
        total: usize,
        tail_delay_ms: u64,
        served: &AtomicUsize,
    ) {
        let mut buf = [0u8; 16 * 1024];
        let n = match stream.read(&mut buf) {
            Ok(n) => n,
            Err(_) => return,
        };
        let head = String::from_utf8_lossy(&buf[..n]).to_string();
        let request = head.lines().next().unwrap_or("");
        let method = request.split_whitespace().next().unwrap_or("");
        let range = head.lines().find_map(|l| {
            let (k, v) = l.split_once(':')?;
            if k.trim().eq_ignore_ascii_case("range") {
                Some(v.trim().to_string())
            } else {
                None
            }
        });

        let has_range = range.is_some();
        let (start, end) = match range.as_deref().and_then(parse_range) {
            Some((s, e)) => (s.min(total), e.min(total.saturating_sub(1))),
            None => (0, total.saturating_sub(1)),
        };
        let len = end.saturating_sub(start) + 1;

        let head_out = if has_range {
            format!(
                "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {start}-{end}/{total}\r\nContent-Length: {len}\r\nAccept-Ranges: bytes\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n"
            )
        } else {
            format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {len}\r\nAccept-Ranges: bytes\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n"
            )
        };
        if stream.write_all(head_out.as_bytes()).is_err() {
            return;
        }
        if method.eq_ignore_ascii_case("HEAD") {
            let _ = stream.flush();
            return;
        }

        let slow = tail_delay_ms > 0 && start >= total * 3 / 4;
        let mut pos = start;
        while pos <= end {
            let chunk_end = (pos + 64 * 1024).min(end + 1);
            if stream.write_all(&body[pos..chunk_end]).is_err() {
                return;
            }
            served.fetch_add(chunk_end - pos, Ordering::Relaxed);
            pos = chunk_end;
            if slow {
                std::thread::sleep(Duration::from_millis(tail_delay_ms));
            }
        }
        let _ = stream.flush();
    }

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("jv-turbo-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn block_on<T>(f: impl std::future::Future<Output = T>) -> T {
        // Bağımlılık eklememek için `rt` yeterli: işçiler zaten ağ üzerinde
        // bekliyor, tek iş parçacığı doğruluğu ölçmeye yeter.
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(f)
    }

    fn new_ctrl() -> Arc<JobController> {
        Arc::new(JobController {
            paused: Arc::new(AtomicBool::new(false)),
            cancelled: Arc::new(AtomicBool::new(false)),
        })
    }

    #[test]
    fn end_to_end_download_is_byte_exact_and_splits_dynamically() {
        reset_runtime_state();
        set_runtime_limits(0, 8);
        // 32 MB / 4 kanal = 8 MB parça. Kritik: parçalar, "kalanın yarısı
        // MIN_SPLIT_BYTES'in üstünde" koşulunu sağlayacak kadar büyük olmalı —
        // aksi hâlde motor (doğru şekilde, IDM gibi) bölmeyi reddeder.
        let body = body_of((32 * MIB) as usize);
        let server = spawn_range_server(body.clone(), 5);
        let dir = tmp_dir("e2e");
        let dest = dir.join("file.bin").to_string_lossy().to_string();

        let max_chunks = Arc::new(AtomicUsize::new(0));
        let max_chunks_rep = max_chunks.clone();
        let rep = Reporter(Arc::new(move |p: TurboProgressPayload| {
            // Durumdan bağımsız say: indirme ilk 300 ms'lik tikten önce bitebilir,
            // o zaman parça listesi yalnız "completed" olayında görünür.
            if !p.chunks.is_empty() {
                max_chunks_rep.fetch_max(p.chunks.len(), Ordering::SeqCst);
            }
        }));

        block_on(run_turbo_download(
            rep,
            "e2e".into(),
            server.url.clone(),
            "file.bin".into(),
            dest.clone(),
            0,
            4,
            RequestHeaders::default(),
            new_ctrl(),
        ))
        .expect("indirme tamamlanmalı");

        let got = std::fs::read(&dest).expect("hedef dosya yazılmalı");
        assert_eq!(got.len(), body.len(), "boyut birebir olmalı");
        assert!(got == body, "içerik birebir olmalı");
        assert!(
            !Path::new(&format!("{dest}.meta")).exists(),
            "tamamlanınca meta silinmeli"
        );
        assert!(
            max_chunks.load(Ordering::SeqCst) > 4,
            "dinamik parçalama gözlenmeli (4 bağlantıdan fazla parça): {}",
            max_chunks.load(Ordering::SeqCst)
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pause_then_resume_finishes_without_re_downloading_everything() {
        reset_runtime_state();
        set_runtime_limits(0, 8);
        let body = body_of((8 * MIB) as usize);
        let server = spawn_range_server(body.clone(), 20);
        let dir = tmp_dir("resume");
        let dest = dir.join("file.bin").to_string_lossy().to_string();

        let ctrl = new_ctrl();
        let pauser = ctrl.clone();
        let url_first = server.url.clone();
        let dest_first = dest.clone();
        block_on(async move {
            let stopper = tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(200)).await;
                pauser.paused.store(true, Ordering::SeqCst);
            });
            let r = run_turbo_download(
                Reporter::silent(),
                "resume".into(),
                url_first,
                "file.bin".into(),
                dest_first,
                0,
                4,
                RequestHeaders::default(),
                ctrl,
            )
            .await;
            let _ = stopper.await;
            r
        })
        .expect("duraklatma hata değil");

        assert!(
            !Path::new(&dest).exists(),
            "duraklatılan indirme hedef dosyayı yazmamalı"
        );
        let first = server.served.swap(0, Ordering::SeqCst);
        assert!(first > 0, "ilk turda veri inmeli");
        assert!(first < body.len(), "ilk turda her şey inmemiş olmalı");

        block_on(run_turbo_download(
            Reporter::silent(),
            "resume".into(),
            server.url.clone(),
            "file.bin".into(),
            dest.clone(),
            0,
            4,
            RequestHeaders::default(),
            new_ctrl(),
        ))
        .expect("devam tamamlanmalı");

        let got = std::fs::read(&dest).expect("hedef dosya yazılmalı");
        assert!(got == body, "devam sonrası içerik birebir olmalı");
        let resumed = server.served.load(Ordering::SeqCst);
        assert!(
            resumed < body.len(),
            "devam ederken baştan indirmemeli (inen {resumed}, toplam {})",
            body.len()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
