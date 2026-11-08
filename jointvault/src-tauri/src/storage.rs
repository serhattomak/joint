use serde::Serialize;
use tauri::{AppHandle, Manager};

/// İndirme köklerindeki dosya. Yalnızca raporlama içindir; silme kararı
/// arayüzde verilir ve `delete_file` yine izinli kök kapısından geçer.
#[derive(Serialize)]
pub struct StorageFile {
    pub path: String,
    pub size: u64,
}

#[tauri::command]
pub async fn scan_storage(app: AppHandle) -> Result<Vec<StorageFile>, String> {
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(dir) = crate::settings::get_download_dir(app.clone()) {
        roots.push(std::path::PathBuf::from(dir));
    }
    if let Ok(downloads) = app.path().download_dir() {
        roots.push(downloads.join("JointVault"));
    }
    roots.sort();
    roots.dedup();

    let mut out = Vec::new();
    for root in roots {
        if root.is_dir() {
            walk(&root, 0, &mut out);
        }
    }
    Ok(out)
}

fn walk(dir: &std::path::Path, depth: usize, out: &mut Vec<StorageFile>) {
    // Kategori klasörleri sığdır; derin ağaçlarda taramayı sınırla.
    if depth > 6 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if file_type.is_dir() {
            // Gizli/araç klasörlerini tara.
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            walk(&path, depth + 1, out);
        } else if file_type.is_file() {
            let name = entry.file_name().to_string_lossy().to_string();
            // Yarım parçalar ve motor meta dosyaları yetim değildir (süren indirme).
            if name.contains(".part_")
                || name.ends_with(".part")
                || name.ends_with(".ytdl")
                || name.ends_with(".tmp")
                || name.ends_with(".download")
                || name.ends_with(".meta")
                || name.ends_with(".jvmeta")
            {
                continue;
            }
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(StorageFile {
                path: path.to_string_lossy().to_string(),
                size,
            });
        }
    }
}
