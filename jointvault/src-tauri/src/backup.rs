// Yedekleme ve kurtarma.
//
// Neden Rust tarafında: yedek dosyalarını listelemek/silmek/geri döndürmek
// dosya sistemi işidir; geri dönme sırasında canlı veritabanı dosyasının
// ÜZERİNE yazılır ve bu iş yalnızca güvenli bir adla yapılabilir.
//
// Yedek ÜRETİMİ burada değil: `VACUUM INTO` ile SQLite'ın kendisi yapar
// (tutarlı anlık görüntü, WAL dahil). Düz dosya kopyası WAL'de bekleyen
// commit'leri kaçırabilir.
//
// Yol kaynağı: tauri-plugin-sql `sqlite:<relative>` yolunu **app_config_dir**
// altında çözer (app_data_dir DEĞİL; Windows'ta ikisi aynı, macOS/Linux'ta
// ayrı). Bu yüzden burada da aynı çözüm kullanılır.
use std::path::{Path, PathBuf};
use tauri::Manager;

const DB_FILE: &str = "jointvault.db";
const BACKUP_DIR: &str = "backups";

#[derive(serde::Serialize)]
pub struct BackupInfo {
    name: String,
    size_bytes: u64,
    modified_ms: u64,
}

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

/// Canlı veritabanı dosyası.
///
/// `JV_DB_FILE` yalnızca bir TEST DİKİŞİDİR (arayüzdeki `VITE_JV_DB` ile eş
/// çalışır): geri dönme ve sıfırlama gibi YIKICI yolların gerçek kasaya
/// dokunmadan sınanabilmesi için. Tanımsızsa üretim yolu kullanılır.
fn db_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(override_path) = std::env::var("JV_DB_FILE") {
        let trimmed = override_path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    Ok(config_dir(app)?.join(DB_FILE))
}

/// Yedekler canlı dosyanın YANINDA durur; böylece kasa neredeyse yedekleri de
/// oradadır (test dikişinde de kendi kendine yeter).
fn backups_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let db = db_file(app)?;
    let parent = db
        .parent()
        .ok_or_else(|| "Veritabanı yolunun klasörü bulunamadı.".to_string())?;
    let dir = parent.join(BACKUP_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Yedek adı doğrulaması: yol ayırıcı, `..` ve `.db` dışı uzantı reddedilir.
/// Aksi hâlde bir isim, kasayı ya da başka bir dosyayı hedef alabilirdi.
fn safe_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let invalid = trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || !trimmed.ends_with(".db");
    if invalid {
        return Err("Geçersiz yedek adı.".to_string());
    }
    Ok(trimmed.to_string())
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn timestamp() -> String {
    /* Yerel saat bağımlılığı eklemeden okunur damga: epoch ms. */
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{ms}")
}

/// Canlı veritabanı dosyasının tam yolu.
#[tauri::command]
pub fn database_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(db_file(&app)?.to_string_lossy().to_string())
}

/// Yedek klasörünün yolu (yoksa oluşturur).
#[tauri::command]
pub fn backups_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(backups_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_backups(app: tauri::AppHandle) -> Result<Vec<BackupInfo>, String> {
    let dir = backups_dir(&app)?;
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;

    let mut backups: Vec<BackupInfo> = entries
        .flatten()
        .filter(|e| e.path().is_file())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".db") {
                return None;
            }
            Some(BackupInfo {
                size_bytes: e.metadata().map(|m| m.len()).unwrap_or(0),
                modified_ms: modified_ms(&e.path()),
                name,
            })
        })
        .collect();

    /* En yeni önce; kırpma kararı bu sıraya dayanır. */
    backups.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(backups)
}

#[tauri::command]
pub fn delete_backup(app: tauri::AppHandle, name: String) -> Result<bool, String> {
    let target = backups_dir(&app)?.join(safe_name(&name)?);
    if target.exists() {
        std::fs::remove_file(&target).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

/// Yedekten geri döner.
///
/// Sıra önemli: (1) mevcut kasa `pre-restore-<damga>.db` olarak saklanır —
/// yanlış yedeği seçen kullanıcı geri dönebilsin; (2) `-wal`/`-shm` silinir,
/// yoksa eski WAL yeni dosyaya karışır; (3) yedek kopyalanır.
///
/// Çağıran, bu komuttan ÖNCE bağlantı havuzunu kapatmalıdır (açık SQLite
/// dosyası kilitlidir; Windows'ta üzerine yazma başarısız olur).
#[tauri::command]
pub fn restore_backup(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let dir = backups_dir(&app)?;
    let source = dir.join(safe_name(&name)?);
    if !source.exists() {
        return Err(format!("Yedek bulunamadı: {name}"));
    }

    let db = db_file(&app)?;
    let safety = format!("pre-restore-{}.db", timestamp());
    if db.exists() {
        std::fs::copy(&db, dir.join(&safety)).map_err(|e| e.to_string())?;
    }

    for suffix in ["-wal", "-shm"] {
        let side = PathBuf::from(format!("{}{}", db.to_string_lossy(), suffix));
        if side.exists() {
            std::fs::remove_file(&side).map_err(|e| e.to_string())?;
        }
    }

    std::fs::copy(&source, &db).map_err(|e| e.to_string())?;
    Ok(safety)
}

/// Veritabanını siler (çağıran önce yedek almalı). `-wal`/`-shm` de gider.
#[tauri::command]
pub fn reset_database(app: tauri::AppHandle) -> Result<bool, String> {
    let db = db_file(&app)?;
    for path in [
        db.clone(),
        PathBuf::from(format!("{}-wal", db.to_string_lossy())),
        PathBuf::from(format!("{}-shm", db.to_string_lossy())),
    ] {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(true)
}
