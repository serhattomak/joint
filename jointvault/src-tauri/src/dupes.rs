use sha2::{Digest, Sha256};
use std::io::Read;

#[derive(Clone, serde::Serialize)]
pub struct DupGroup {
    pub hash: String,
    pub size: u64,
    pub paths: Vec<String>,
}

// ponytail: boyut-önce-hash-sonra — tek bayt okumadan önce grupla,
// aynı boyutluların tamamı okunur (parça hash yok, basitlik kazanır).
#[tauri::command]
pub async fn scan_files(paths: Vec<String>) -> Result<Vec<DupGroup>, String> {
    let mut by_size: std::collections::HashMap<u64, Vec<String>> = std::collections::HashMap::new();
    for p in &paths {
        match std::fs::metadata(p) {
            Ok(m) if m.is_file() => by_size.entry(m.len()).or_default().push(p.clone()),
            _ => {}
        }
    }
    let mut groups = Vec::new();
    for (size, candidates) in by_size {
        if candidates.len() < 2 {
            continue;
        }
        let mut by_hash: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
        for p in candidates {
            match hash_file(&p) {
                Ok(h) => by_hash.entry(h).or_default().push(p),
                Err(_) => {}
            }
        }
        for (hash, dupes) in by_hash {
            if dupes.len() > 1 {
                groups.push(DupGroup { hash, size, paths: dupes });
            }
        }
    }
    groups.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(groups)
}

fn hash_file(path: &str) -> Result<String, String> {
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 1024 * 1024];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

/// Dosyayı siler — **yalnızca izinli köklerin altından** (app_data, indirme kökü).
///
/// Neden kısıtlandı: bu komut renderer'a açıktır ve geri döndürülemez. Sınırsız
/// olsaydı bir renderer açığı "diskteki herhangi bir dosyayı sil" yetkisine
/// dönüşürdü. Kapsam dışı bir yol artık anlaşılır bir hatayla reddedilir.
#[tauri::command]
pub async fn delete_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let target = std::path::PathBuf::from(path.trim());
    if path.trim().is_empty() {
        return Err("Silinecek dosya yolu boş olamaz.".to_string());
    }
    crate::paths::ensure_allowed(&app, &target)?;
    std::fs::remove_file(&target).map_err(|e| e.to_string())
}

#[derive(Clone, serde::Serialize)]
pub struct DirEntry {
    pub path: String,
    pub size: u64,
}

// ponytail: üst seviye dosyalar + nokta-dizinler (.tools) hariç, recursive yok.
#[tauri::command]
pub async fn scan_dir(dir: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    let rd = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in rd {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with('.') {
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        out.push(DirEntry {
            path: path.to_string_lossy().to_string(),
            size,
        });
    }
    out.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(out)
}
