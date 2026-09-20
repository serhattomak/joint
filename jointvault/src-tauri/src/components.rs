// Bileşen kaydı (component registry).
//
// Sorun: "hangi araç kurulu, nerede duruyor" bilgisi bugün üç yere dağılmıştı —
// `health.rs` sidecar'a bakıyor, `whisper.rs` kendi yolunu hesaplıyor,
// `download.rs` ffmpeg'i `<indirme>/.tools` altına kopyalıyor. Aynı bilginin
// kopyaları zamanla ayrışır (bu, `docs/media-tools-deferred.md:59-60`'ta
// kayıtlı bir borç).
//
// Burada tek kaynak: her bileşen için id, etiket, beklenen dosya adı, gömülü
// sidecar adı, sürüm komutu ve (varsa) **pinlenmiş indirme kaynağı**. Durum
// UYDURULMAZ — dosya ve çalıştırma kontrolü gerçekten yapılır.
//
// İndirme kaynağı neden burada? Kaynak seçimi (URL/sha256/hangi arşiv) ürünün
// değişmez bir kararıdır; indirme MOTORU (`component_download.rs`) bu kararı
// bilmez, yalnızca uygular. Böylece "ne iniyor" sorusunun tek cevabı olur.
//
// Arama sırası: **indirilenler klasörü → uygulamanın yanındaki gömülü sidecar**.
// İndirilenler kullanıcı verisine yazılır (yönetici izni gerekmez); gömülü olan
// paketle birlikte gelir ve son çare olarak kalır.
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Bileşen nereden geldi: kullanıcı indirdi mi, paketle mi geldi.
///
/// `Clone + Copy`: çözümlenen yolu alan çağrı yerleri kaynağı da yanında taşır ve
/// gerektiğinde yeniden kullanır (ör. `download.rs` hem ffmpeg hem ffprobe kaynağını
/// aynı anda bildirmek ister). Küçük, düz bir değer; kopyalamak ucuz.
#[derive(serde::Serialize, PartialEq, Clone, Copy, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ComponentSource {
    Downloaded,
    Bundled,
}

#[derive(serde::Serialize)]
pub struct ComponentStatus {
    id: String,
    label: String,
    /// Kabaca indirme boyutu (kullanıcı ne indireceğini bilsin).
    approx_mb: u32,
    installed: bool,
    /// Dosya var VE çalıştırılabiliyor mu (sürüm okunabildi mi).
    /// "Dosya var" tek başına yetmez: `whisper.exe` DLL'leri olmadan durur.
    runnable: bool,
    /// Bileşenin bulunduğu tam yol (kuruluysa).
    path: Option<String>,
    source: Option<ComponentSource>,
    /// `-version` çıktısının ilk satırı (kuruluysa).
    version: Option<String>,
    /// Bu bileşen indirilebilir mi (paketle gelenler için false).
    /// Pinlenmiş kaynağı olmayan bileşen indirilebilir SAYILMAZ (bkz. `Spec::download`).
    downloadable: bool,
    /// Aynı indirme arşivini paylaşan bileşenlerin paket kimliği (ör. `ffmpeg-tools`).
    /// Arayüz bununla satırları gruplar: ffmpeg + ffprobe TEK arşivden kurulur.
    bundle: Option<String>,
    /// İçerik biçimi: `"archive"` (zip) ya da `"plain"` (düz dosya).
    /// İndirilemeyen bileşenlerde `None`. Arayüz etiketlemek için kullanır.
    framework: Option<String>,
}

struct Spec {
    id: &'static str,
    label: &'static str,
    approx_mb: u32,
    /// İndirildiğinde kullanılacak dosya adı.
    downloaded_file: &'static str,
    /// Paketle gelen sidecar adı (varsa).
    sidecar: Option<&'static str>,
    /// Sürüm sorgusunda kullanılacak argüman.
    version_arg: &'static str,
    /// Pinlenmiş indirme kaynağı. `None` → bu bileşen bu komuttan inmez:
    /// yt-dlp paketle gömülü gelir; whisper/AI kendi komutlarından iner (Faz 7b/04).
    /// `downloadable` bu alandan TÜRETİLİR — kaynağı olmayan "indirilebilir" sayılmaz.
    download: Option<DownloadSpec>,
}

/// Arşivden ne çıkarılacak ve tek girdi güvenlik sınırı.
pub enum PayloadRule {
    /// Tek düz dosya: `<hedef>/<file_name>`. Şu an yalnızca ffmpeg/ffprobe (zip)
    /// kayıtlı olduğu için bu varyant inşa edilmiyor; Faz 7b/04 model indirmelerini
    /// (`.bin`/`.gguf`) buraya bağlayınca kullanılacak. Motor tarafı hazır
    /// (`Payload::Raw`) ve sonda komutu bu yolu zaten çalıştırıyor.
    #[allow(dead_code)]
    Raw { file_name: &'static str },
    /// Zip: yalnızca `wanted` basename'leri hedefe çıkarılır; her girdi
    /// `max_entry_bytes`'ı aşarsa kurulum reddedilir (zip-bomba).
    Zip {
        wanted: &'static [&'static str],
        max_entry_bytes: u64,
    },
}

/// Pinlenmiş indirme kaynağı.
///
/// URL/sha256 değerleri `context.md` pin tablosundan **birebir** kopyalanır; burada
/// uydurma kaynak yoktur (`docs/product-roadmap.md` §7 riski: kaynak sabitlenmeli,
/// dış kaynak kaybolsa bile ne indirildiği bilinmeli).
pub struct DownloadSpec {
    /// Aynı arşivi paylaşan bileşenlerin ortak kimliği (ilerleme olayında görünür).
    pub bundle: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    /// İndirilen arşiv boyutu (yayıncının beyanı). İlerleme toplamı için yedek.
    pub expected_bytes: u64,
    /// Tepe disk ihtiyacı: arşiv + çıkarılan dosyalar. Disk kapısı bunu kullanır.
    pub disk_required_bytes: u64,
    pub payload: PayloadRule,
}

impl DownloadSpec {
    /// İçerik biçiminin tek kelimelik özeti: arşiv mi, düz dosya mı?
    /// `PayloadRule`'dan TÜRETİLİR; ayrı bir alan tutmak ayrışma riski olurdu.
    pub fn framework(&self) -> &'static str {
        match &self.payload {
            PayloadRule::Zip { .. } => "archive",
            PayloadRule::Raw { .. } => "plain",
        }
    }
}

// --- ffmpeg + ffprobe: TEK arşiv (BtbN tarihli, değişmez tag) ---
//
// Tarihli tag neden? `latest`/master akışı zamanla değişir ve kayıtlı sha256 bir gün
// sessizce yanlış olur; tarihli tag'de indirilen şey önceden bilinir.

const FFMPEG_TOOLS_BUNDLE: &str = "ffmpeg-tools";

const FFMPEG_TOOLS_URL: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-20-13-11/ffmpeg-N-126716-g3faf57342f-win64-gpl.zip";

/// Yayıncının `checksums.sha256` dosyasından; GitHub asset `digest` alanıyla doğrulandı.
const FFMPEG_TOOLS_SHA256: &str =
    "1e41954de78ce3ebdee55bbe6beb74aa89878b9fdf57b196a9e7e656a03f0a3b";

/// Arşiv boyutu: 194_564_474 bayt = 185.55 MiB (≈185.6 MB). Değer, GitHub asset
/// `size` alanından ve context.md pin tablosundaki 185.6 MB gösteriminden doğrulandı.
const FFMPEG_TOOLS_ARCHIVE_BYTES: u64 = 194_564_474;

/// Arşiv içindeki `ffmpeg.exe` boyutu: 156.62 MiB (164.23 MB).
const FFMPEG_EXE_BYTES: u64 = 164_232_192;
/// Arşiv içindeki `ffprobe.exe` boyutu: 156.42 MiB (164.02 MB).
const FFPROBE_EXE_BYTES: u64 = 164_022_784;

/// Tek arşiv girdisi için üst sınır: 400 MiB. Gerçek ikililer ~156 MiB olduğundan
/// meşru derleme geçer; şişirilmiş (zip-bomba) bir girdi burada reddedilir.
const FFMPEG_ENTRY_CAP_BYTES: u64 = 400 * 1024 * 1024;

/// Tepe disk ihtiyacı: indirilen arşiv + çıkarılan İKİ ikili. Çıkarma bitene kadar
/// arşiv de diskte durur; bu sayı verilmezse kullanıcı indirme ORTASINDA "yer yok"
/// hatası alır — kapının amacı tam olarak bunu önlemek.
const FFMPEG_TOOLS_DISK_BYTES: u64 =
    FFMPEG_TOOLS_ARCHIVE_BYTES + FFMPEG_EXE_BYTES + FFPROBE_EXE_BYTES;

/// Arşivde `bin/` altında dururlar; motor basename ile seçtiği için düz adlar verilir.
const FFMPEG_TOOLS_WANTED: &[&str] = &["ffmpeg.exe", "ffprobe.exe"];

/// Paylaşılan arşivin MB cinsinden gösterimi (iki satır da bu sayıyı taşır:
/// 80+80 değil, TEK ~186 MB indirme).
const FFMPEG_TOOLS_APPROX_MB: u32 = 186;

const SPECS: &[Spec] = &[
    Spec {
        id: "ffmpeg",
        label: "ffmpeg",
        approx_mb: FFMPEG_TOOLS_APPROX_MB,
        downloaded_file: "ffmpeg.exe",
        sidecar: Some("ffmpeg"),
        version_arg: "-version",
        download: Some(DownloadSpec {
            bundle: FFMPEG_TOOLS_BUNDLE,
            url: FFMPEG_TOOLS_URL,
            sha256: FFMPEG_TOOLS_SHA256,
            expected_bytes: FFMPEG_TOOLS_ARCHIVE_BYTES,
            disk_required_bytes: FFMPEG_TOOLS_DISK_BYTES,
            payload: PayloadRule::Zip {
                wanted: FFMPEG_TOOLS_WANTED,
                max_entry_bytes: FFMPEG_ENTRY_CAP_BYTES,
            },
        }),
    },
    Spec {
        id: "ffprobe",
        label: "ffprobe",
        // ffprobe ayrı indirilmez: ffmpeg ile aynı arşivden gelir (bundle).
        approx_mb: FFMPEG_TOOLS_APPROX_MB,
        downloaded_file: "ffprobe.exe",
        sidecar: Some("ffprobe"),
        version_arg: "-version",
        download: Some(DownloadSpec {
            bundle: FFMPEG_TOOLS_BUNDLE,
            url: FFMPEG_TOOLS_URL,
            sha256: FFMPEG_TOOLS_SHA256,
            expected_bytes: FFMPEG_TOOLS_ARCHIVE_BYTES,
            disk_required_bytes: FFMPEG_TOOLS_DISK_BYTES,
            payload: PayloadRule::Zip {
                wanted: FFMPEG_TOOLS_WANTED,
                max_entry_bytes: FFMPEG_ENTRY_CAP_BYTES,
            },
        }),
    },
    Spec {
        id: "yt-dlp",
        label: "yt-dlp",
        approx_mb: 17,
        downloaded_file: "yt-dlp.exe",
        sidecar: Some("yt-dlp"),
        version_arg: "--version",
        // yt-dlp paketle GÖMÜLÜ kalır (roadmap §7): indirme kaynağı yok.
        download: None,
    },
    Spec {
        id: "whisper",
        label: "Whisper motoru",
        approx_mb: 4,
        downloaded_file: "whisper.exe",
        sidecar: Some("whisper"),
        version_arg: "--help",
        // Whisper motoru kendi komutundan iner (`whisper::download_whisper_engine`);
        // Faz 7b/04 aynı motora bağlayınca kaynak buraya taşınır.
        download: None,
    },
];

/// Bileşenlerin indirildiği klasör (yoksa oluşturur).
pub fn components_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("components");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Uygulamanın yanındaki gömülü sidecar yolu.
///
/// İki ad biçimi de denenir, çünkü ikisi de gerçekte var:
///   - `<ad>.exe` — Tauri'nin hedef klasöre/bundle'a kopyaladığı biçim
///   - `<ad>-<hedef-üçlü>.exe` — kaynak `binaries/` klasöründeki biçim
/// Üçlüyü elle kurmak yerine klasör taranır: başka platformda da doğru dosya bulunur.
fn bundled_path(name: &str) -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let plain = format!("{name}.exe");
    let prefixed = format!("{name}-");

    std::fs::read_dir(&dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            if !path.is_file() {
                return false;
            }
            let file = path
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();
            file == plain || (file.starts_with(&prefixed) && file.ends_with(".exe"))
        })
}

/// Bir bileşeni çöz: önce indirilenler, sonra gömülü.
fn resolve(app: &AppHandle, spec: &Spec) -> Option<(PathBuf, ComponentSource)> {
    let downloaded = components_dir(app).ok()?.join(spec.downloaded_file);
    if downloaded.is_file() {
        return Some((downloaded, ComponentSource::Downloaded));
    }
    spec.sidecar
        .and_then(bundled_path)
        .map(|path| (path, ComponentSource::Bundled))
}

/// Çözümlenmiş bir aracın yolunu ve nereden geldiğini ver.
///
/// `resolve`'un dışa açılan yüzü: arama sırasını birebir korur
/// (**indirilenler → gömülü**) ve **hiçbir şey çalıştırmaz** — yalnızca dosya
/// varlığına bakar. Medya komutları işe başlamadan önce bunu çağıracak; bu yüzden
/// ucuz olması tercih değil, tasarım gereği.
pub fn resolve_tool(app: &AppHandle, id: &str) -> Option<(PathBuf, ComponentSource)> {
    SPECS
        .iter()
        .find(|spec| spec.id == id)
        .and_then(|spec| resolve(app, spec))
}

/// Bileşen kurulu mu (indirilenler → gömülü)? Kuruluysa indirme atlanır.
pub fn is_installed(app: &AppHandle, id: &str) -> bool {
    resolve_tool(app, id).is_some()
}

// --- Eksik bileşen sinyali --------------------------------------------------
//
// Sözleşme: bir komut aracı çözemezse `Err` içinde **yapılandırılmış** bir sinyal
// döner. Arayüz öneki tanıyıp kurulum akışını açar; ham sinyal kullanıcıya
// GÖSTERİLMEZ — kullanıcı metni ayrı olarak `missing_message`'dan gelir.
//
// Neden önek, neden tek yerde? Bir Tauri komutu yalnızca `Err(String)` dönebilir;
// "bileşen eksik" ile "başka bir hata" ancak metinden ayırt edilebilir. Önek
// kopyalanırsa üretici ile ayrıştırıcı zamanla ayrışır ve arayüz sessizce kör
// kalır (kullanıcı ham makine metnini görür). Bu yüzden üretim tek noktada
// (`missing_signal`) ve sabit tek yerde (`MISSING_PREFIX`) tutulur.
//
// NOT: bu yüzey 7c'nin paralel çağrı yerleri (health/download/medya komutları)
// bağlanana kadar normal derlemede kullanılmaz; o ana kadar dead_code uyarısı
// burada bilinçli olarak bastırılır. Testler saf parçaları zaten kapsıyor.

/// Eksik bileşen sinyalinin öneki. Makine-okunur; kullanıcıya GÖSTERİLMEZ.
#[allow(dead_code)]
pub const MISSING_PREFIX: &str = "BILESEN_EKSIK:";

/// Sinyalde id'den sonra gelen kullanıcı metnini ayıran karakter.
const MISSING_DETAIL_SEP: char = '\n';

/// Sinyali üret (saf): `BILESEN_EKSIK:<id>` + satır sonu + kullanıcı metni.
///
/// Ayrıntı satırı neden gömülü? Arayüz öneki soymayı henüz bilmiyorsa (7c-2
/// gelmeden) kullanıcı en azından **okunabilir bir cümle** görür; çıplak makine
/// metni görmez. `parse_missing_signal` yalnızca ilk satırı (id'yi) okur.
///
/// `id` kırpılır. Boş id yalnızca öneki verir; `parse_missing_signal` bunu
/// reddeder — yani bozuk sinyal asla geçerli sayılmaz (fail closed). Üretim tek
/// yerde olduğundan önek kayamaz.
#[allow(dead_code)]
pub fn missing_signal(id: &str) -> String {
    let id = id.trim();
    format!(
        "{MISSING_PREFIX}{id}{MISSING_DETAIL_SEP}{}",
        missing_message(id)
    )
}

/// Sinyalin ikinci satırı: kullanıcıya gösterilecek metin (varsa).
#[allow(dead_code)]
pub fn parse_missing_detail(error: &str) -> Option<String> {
    error
        .trim()
        .strip_prefix(MISSING_PREFIX)?
        .split_once(MISSING_DETAIL_SEP)
        .map(|(_, detail)| detail.trim().to_string())
        .filter(|detail| !detail.is_empty())
}

/// Sinyali ayrıştır (saf): `BILESEN_EKSIK:ffmpeg` → `Some("ffmpeg")`.
///
/// Önek **başta** olmalı. Yalnızca **ilk satır** (id) okunur; ayrıntı satırı
/// yok sayılır. Hem metnin hem id'nin kenar boşlukları hoş görülür.
/// Eşleşmeyen ya da önekten sonrası boş kalan girdi `None` döner (panik yok).
#[allow(dead_code)]
pub fn parse_missing_signal(error: &str) -> Option<String> {
    let rest = error.trim().strip_prefix(MISSING_PREFIX)?;
    let id = rest.lines().next().unwrap_or("").trim();
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

/// `parse_missing_signal`'ın kısa adı (7c köprü/arayüz sözleşmesi).
#[allow(dead_code)]
pub fn parse_missing(error: &str) -> Option<String> {
    parse_missing_signal(error)
}

/// Çalıştırılabilir bir aracın yolunu ZORUNLU kıl.
///
/// Yoksa tam olarak `BILESEN_EKSIK:<id>` biçiminde sinyal döner. Metin
/// `missing_signal`'dan geldiği için çağrı yerleri öneki asla kendileri yazmaz ve
/// aynı id her zaman aynı hatayı verir. **Süreç başlatılmaz**: yalnızca varlık
/// kontrolü (`resolve_tool`), bu yüzden her medya komutunun başında çağrılabilir.
#[allow(dead_code)]
pub fn require_tool(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    resolve_tool(app, id)
        .map(|(path, _)| path)
        .ok_or_else(|| missing_signal(id))
}

/// Bir bileşeni GERÇEKTEN çalıştırıp sürümünü okur: kullanılabilirliğin ölçütü.
///
/// Neden tek yer? `health_check` ile `components_status` aynı soruya ("çalışıyor mu")
/// iki ayrı kod yolundan cevap verirse zamanla ayrışır — 7a'da tam olarak bu
/// yakalanmıştı (`whisper` için biri yalnızca dosyaya bakıyordu, diğeri `--help`
/// çalıştırıyordu). İkisi de bu fonksiyonu çağırır; ayrışma **inşa gereği** imkânsız.
#[allow(dead_code)]
pub async fn probe_component(app: &AppHandle, id: &str) -> (bool, Option<String>) {
    let Some((path, _)) = resolve_tool(app, id) else {
        return (false, None);
    };
    let arg = SPECS
        .iter()
        .find(|spec| spec.id == id)
        .map(|spec| spec.version_arg)
        .unwrap_or("-version");
    match probe_version(app, &path, arg).await {
        Some(version) => (true, Some(version)),
        None => (false, None),
    }
}

/// Kullanıcıya gösterilecek Türkçe mesaj — öneki İÇERMEZ.
///
/// Bilinen her id için somut bir sonraki adımı söyler. Bilinmeyen id'de ne
/// olduğunu uydurmaz; "kayıtlı değil ya da kurulu değil" diyerek dürüst kalır.
#[allow(dead_code)]
pub fn missing_message(id: &str) -> String {
    match id {
        "ffmpeg" => "ffmpeg kurulu değil. Dönüştürme, GIF, birleştirme, sessizlik, önizleme ve altyazı işlemleri bu aracı kullanır; Ayarlar → Bileşenler bölümünden indirebilirsin.".to_string(),
        "ffprobe" => "ffprobe kurulu değil. Medya süresi ve biçim bilgisi bu araçla okunur; ffmpeg ile aynı pakette gelir. Ayarlar → Bileşenler bölümünden indirebilirsin.".to_string(),
        "yt-dlp" => "yt-dlp kurulu değil. İndirme Yöneticisi bu araç olmadan çalışamaz; uygulamayla birlikte gelir, eksikse kurulumu onarman gerekir.".to_string(),
        "whisper" => "Whisper motoru kurulu değil. Altyazı işlemleri bu motoru kullanır; Ayarlar → Konuşma bölümünden indirebilirsin.".to_string(),
        _ => format!("'{id}' bileşeni kayıtlı değil ya da kurulu değil. Ayarlar → Bileşenler bölümünden bileşen durumunu denetleyebilirsin."),
    }
}

/// Bileşenin pinlenmiş indirme kaynağı. `None` → bu id bu komuttan indirilemez.
pub fn download_spec(id: &str) -> Option<&'static DownloadSpec> {
    SPECS.iter().find(|spec| spec.id == id)?.download.as_ref()
}

/// Çalıştırılabilir bir dosyaya `-version` benzeri bir argüman verip ilk satırı okur.
/// Çalışmazsa `None`: "kurulu" demek için dosyanın var olması yetmez.
async fn probe_version(app: &AppHandle, path: &Path, arg: &str) -> Option<String> {
    let command = app.shell().command(path.to_string_lossy().to_string());
    let (mut rx, _child) = command.args([arg]).spawn().ok()?;

    let mut first: Option<String> = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                if first.is_none() {
                    let text = String::from_utf8_lossy(&line);
                    let line = text.lines().next().unwrap_or("").trim();
                    if !line.is_empty() {
                        first = Some(line.to_string());
                    }
                }
            }
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }
    first
}

/// Tüm bileşenlerin GERÇEK durumu.
#[tauri::command]
pub async fn components_status(app: AppHandle) -> Result<Vec<ComponentStatus>, String> {
    let mut out = Vec::with_capacity(SPECS.len());
    for spec in SPECS {
        let resolved = resolve(&app, spec);
        let version = match &resolved {
            Some((path, _)) => probe_version(&app, path, spec.version_arg).await,
            None => None,
        };
        out.push(ComponentStatus {
            id: spec.id.to_string(),
            label: spec.label.to_string(),
            approx_mb: spec.approx_mb,
            installed: resolved.is_some(),
            runnable: version.is_some(),
            path: resolved.as_ref().map(|(p, _)| p.to_string_lossy().to_string()),
            source: resolved.map(|(_, source)| source),
            version,
            // Kaynak yoksa indirilebilir de yoktur; iki alan asla ayrışmaz.
            downloadable: spec.download.is_some(),
            bundle: spec
                .download
                .as_ref()
                .map(|download| download.bundle.to_string()),
            framework: spec
                .download
                .as_ref()
                .map(|download| download.framework().to_string()),
        });
    }
    Ok(out)
}

/// Bileşen klasörünün yolu (arayüzden açılabilir).
#[tauri::command]
pub fn components_path(app: AppHandle) -> Result<String, String> {
    Ok(components_dir(&app)?.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kayıttaki tüm id'ler: mesaj/round-trip testleri bu listeyi gezer.
    const KNOWN_IDS: &[&str] = &["ffmpeg", "ffprobe", "yt-dlp", "whisper"];

    // --- sinyal üretme/ayrıştırma (saf; AppHandle gerekmez) ---

    #[test]
    fn prefix_is_exactly_the_agreed_wire_marker() {
        // Tel formatı sabittir: arayüz bu öneki tanır, bu yüzden burada çivilenir.
        // (Üretimde tek tanım yeri `MISSING_PREFIX`; literal yalnızca testte.)
        assert_eq!(MISSING_PREFIX, "BILESEN_EKSIK:");
    }

    #[test]
    fn signal_round_trips_every_known_id() {
        for id in KNOWN_IDS {
            let signal = missing_signal(id);
            // Tel formatı: önek + id, ardından ayrıntı satırı (kullanıcı metni).
            assert!(signal.starts_with(&format!("{MISSING_PREFIX}{id}")));
            assert_eq!(parse_missing_signal(&signal).as_deref(), Some(*id));
            assert_eq!(parse_missing(&signal).as_deref(), Some(*id));
            // Ayrıntı satırı tam olarak kullanıcı mesajıdır ve önek İÇERMEZ.
            assert_eq!(parse_missing_detail(&signal), Some(missing_message(id)));
            assert!(!parse_missing_detail(&signal).unwrap_or_default().contains(MISSING_PREFIX));
        }
    }

    #[test]
    fn signal_stays_readable_even_if_nobody_strips_the_prefix() {
        // 7c-2 arayüzü öneki soymadan önce bile kullanıcı çıplak makine metni
        // görmez: ikinci satır okunabilir bir cümledir.
        let signal = missing_signal("ffmpeg");
        let detail = signal.lines().nth(1).unwrap_or("");
        assert!(!detail.is_empty(), "sinyal çıplak kalmamalı: {signal:?}");
        assert!(detail.contains("ffmpeg"));
    }

    #[test]
    fn parse_missing_detail_is_none_without_a_detail_line() {
        assert_eq!(parse_missing_detail("BILESEN_EKSIK:ffmpeg"), None);
        assert_eq!(parse_missing_detail("BILESEN_EKSIK:ffmpeg\n  "), None);
        assert_eq!(parse_missing_detail("bir şey"), None);
    }

    #[test]
    fn signal_trims_id_so_round_trip_stays_clean() {
        assert!(missing_signal("  ffmpeg  ").starts_with("BILESEN_EKSIK:ffmpeg"));
        assert_eq!(
            parse_missing_signal(&missing_signal("  ffmpeg ")).as_deref(),
            Some("ffmpeg")
        );
    }

    #[test]
    fn parse_tolerates_surrounding_whitespace() {
        assert_eq!(
            parse_missing("  BILESEN_EKSIK:  ffmpeg  ").as_deref(),
            Some("ffmpeg")
        );
        assert_eq!(
            parse_missing("\nBILESEN_EKSIK:ffprobe\n").as_deref(),
            Some("ffprobe")
        );
        assert_eq!(
            parse_missing("BILESEN_EKSIK: yt-dlp\nkurulu değil").as_deref(),
            Some("yt-dlp")
        );
    }

    #[test]
    fn parse_rejects_empty_id_after_prefix() {
        assert_eq!(parse_missing("BILESEN_EKSIK:"), None);
        assert_eq!(parse_missing("BILESEN_EKSIK:   "), None);
        assert_eq!(parse_missing_signal("  BILESEN_EKSIK: \t "), None);
    }

    #[test]
    fn parse_returns_none_for_non_matching_input() {
        // Önek başta olmalı; harf büyüklüğü duyarlı; önek olmadan eşleşme yok.
        for input in [
            "",
            "   ",
            "ffmpeg",
            "BILESEN_EKSIK",
            "bozuk BILESEN_EKSIK:ffmpeg",
            "bilesen_eksik:ffmpeg",
        ] {
            assert_eq!(parse_missing(input), None, "girdi: {input:?}");
        }
    }

    // --- kullanıcıya dönük mesaj ---

    #[test]
    fn missing_messages_are_non_empty_and_never_leak_prefix() {
        for id in KNOWN_IDS {
            let message = missing_message(id);
            assert!(!message.trim().is_empty(), "boş mesaj: {id}");
            assert!(!message.contains(MISSING_PREFIX), "önek sızdı: {message}");
        }
        // Bilinmeyen id de dürüst ve öneksiz olmalı (uydurma yok).
        let unknown = missing_message("bilinmeyen-bilesen");
        assert!(!unknown.trim().is_empty());
        assert!(!unknown.contains(MISSING_PREFIX));
    }

    #[test]
    fn known_messages_name_their_component_and_a_next_step() {
        assert!(missing_message("ffmpeg").contains("ffmpeg"));
        // Eylem çağrısı: kullanıcı nereye gideceğini bilmeli.
        assert!(missing_message("ffmpeg").contains("Bileşenler"));
        assert!(missing_message("ffprobe").contains("ffprobe"));
        assert!(missing_message("ffprobe").contains("Bileşenler"));
        assert!(missing_message("whisper").to_lowercase().contains("whisper"));
        assert!(missing_message("yt-dlp").contains("yt-dlp"));
    }
}
