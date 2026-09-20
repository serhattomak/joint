// İzinli kökler — dosya YAZMA ve SİLME için tek kapı.
//
// Sorun: `write_text_file` ve `delete_file` herhangi bir yolu kabul ediyordu. Bu
// komutlar renderer'a açıktır; renderer'da bir açık (XSS, kötü niyetli içerik)
// oluşursa **diskteki herhangi bir dosya** yazılabilir/silinirdi. Uygulamanın
// gerçekten dokunması gereken yerler bellidir; gerisi reddedilir.
//
// Kapsam bilinçli olarak DAR: app_data (db, ayarlar, yedekler, cookies) ve
// indirme kökü (indirilenler + dönüştürülenler + kullanıcı alt klasörleri).
// Kullanıcının seçtiği DIŞA AKTARMA yolu buraya girmez: o yol renderer'dan
// gelmemeli (bkz. `settings::export_backup` — dosya seçimi Rust tarafında yapılır).
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn app_data(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok()
}

/// İndirme kökü: kayıtlı ayar, yoksa varsayılan. İkisi de denenir çünkü ayar
/// okunamazsa uygulama varsayılana düşer ve silme oradaki dosyaları da kapsamalı.
fn download_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(saved) = crate::settings::get_download_dir(app.clone()) {
        roots.push(PathBuf::from(saved));
    }
    if let Ok(downloads) = app.path().download_dir() {
        roots.push(downloads.join("JointVault"));
    }
    roots
}

/// İzinli köklerin tamamı (var olanlar).
pub fn allowed_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(data) = app_data(app) {
        roots.push(data);
    }
    roots.extend(download_roots(app));
    roots
}

/// Bir yolun gerçek (çözümlenmiş) hâlini bulur. Hedef henüz yoksa **ebeveynini**
/// çözümler: yazma yolu çoğu zaman henüz oluşmamış bir dosyadır.
fn real(path: &Path) -> Option<PathBuf> {
    if let Ok(c) = path.canonicalize() {
        return Some(c);
    }
    let parent = path.parent()?;
    let canon_parent = parent.canonicalize().ok()?;
    let name = path.file_name()?;
    Some(canon_parent.join(name))
}

/// Yol izinli köklerden birinin ALTINDA mı?
///
/// `starts_with` yol bileşeni bazlıdır (string öneki değil), yani
/// `C:\data-evil` içindeki bir dosya `C:\data` köküne girmez. Ayrıca her iki taraf
/// da canonicalize edilir; böylece `..` içeren bir yol kapsamdan kaçamaz.
pub fn is_allowed(app: &AppHandle, path: &Path) -> bool {
    let Some(target) = real(path) else {
        return false;
    };
    allowed_roots(app)
        .iter()
        .filter_map(|root| real(root))
        .any(|root| target.starts_with(&root))
}

/// Kapı: izinli değilse anlaşılır Türkçe hatayla reddet.
pub fn ensure_allowed(app: &AppHandle, path: &Path) -> Result<(), String> {
    if is_allowed(app, path) {
        Ok(())
    } else {
        Err(format!(
            "Güvenlik: bu konuma erişim izni yok — {} (yalnızca uygulama veri klasörü ve indirme klasörü)",
            path.display()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::real;
    use std::path::Path;

    /// `starts_with` yol bileşeni bazlıdır: benzer önekli kardeş dizin kapsama GİRMEZ.
    /// (Güvenlik kararı buna dayandığı için burada çivileniyor.)
    #[test]
    fn starts_with_is_component_wise_not_string_prefix() {
        let root = Path::new("C:\\data");
        assert!(Path::new("C:\\data\\file.txt").starts_with(root));
        assert!(!Path::new("C:\\data-evil\\file.txt").starts_with(root));
    }

    /// Var olmayan hedef: ebeveyni üzerinden çözümlenir (yazma yolu henüz yok).
    #[test]
    fn real_resolves_missing_target_via_parent() {
        let missing = Path::new("C:\\definitely\\not\\here\\file.txt");
        // Ebeveyn de yoksa `None` döner: uydurma bir yol üretilmez.
        assert!(real(missing).is_none());
    }
}
