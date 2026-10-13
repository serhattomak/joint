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

/// Yol `..` bileşeni taşıyor mu?
///
/// Neden reddedilir: `canonicalize` edilmemiş bir yolda `starts_with` **bileşen
/// bazlıdır**, yani `C:\kök\alt\..\..\gizli` yolu `C:\kök` ile başlıyor
/// *görünür* — kaçış yakalanmaz. Uygulamanın ürettiği yollar `..` içermez;
/// içeren bir yol ya hatadır ya da kaçış denemesidir.
fn has_parent_dir(path: &Path) -> bool {
    path.components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
}

/// Bir yolun gerçek (çözümlenmiş) hâlini bulur.
///
/// Hedef henüz yoksa **ilk var olan atası** çözümlenir ve kalan bileşenler ona
/// eklenir. Yalnızca bir üst seviyeye bakmak yetmez: `<kök>/Video/dosya.zip`
/// gibi henüz oluşmamış ara klasörler (kategori klasörleri) aksi hâlde "izinli
/// değil" sayılırdı.
fn real(path: &Path) -> Option<PathBuf> {
    if let Ok(canonical) = path.canonicalize() {
        return Some(canonical);
    }
    if has_parent_dir(path) {
        return None;
    }
    let mut current = path;
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        let parent = current.parent()?;
        if let Some(name) = current.file_name() {
            tail.push(name.to_os_string());
        }
        if let Ok(canonical_parent) = parent.canonicalize() {
            let mut out = canonical_parent;
            for part in tail.iter().rev() {
                out.push(part);
            }
            return Some(out);
        }
        current = parent;
    }
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
    use super::{has_parent_dir, real};
    use std::path::Path;

    /// `starts_with` yol bileşeni bazlıdır: benzer önekli kardeş dizin kapsama GİRMEZ.
    /// (Güvenlik kararı buna dayandığı için burada çivileniyor.)
    #[test]
    fn starts_with_is_component_wise_not_string_prefix() {
        let root = Path::new("C:\\data");
        assert!(Path::new("C:\\data\\file.txt").starts_with(root));
        assert!(!Path::new("C:\\data-evil\\file.txt").starts_with(root));
    }

    /// Var olmayan hedef: ilk var olan ata çözümlenir ve kalan bileşenler eklenir.
    /// (Kategori klasörleri henüz oluşmamışken de yol kökün altında kalmalı.)
    ///
    /// Not: Windows'ta `canonicalize` sonucu `\\?\` uzun-yol öneki taşır. Bu önek
    /// hem hedefe hem köklere aynı biçimde uygulandığı için `starts_with`
    /// karşılaştırması bozulmaz ve önek kullanıcıya gösterilen bir yol değildir;
    /// burada ölçülen şey **kökten sonraki bileşenlerin korunması**dır.
    #[test]
    fn real_walks_up_to_first_existing_ancestor() {
        let tail = Path::new("definitely").join("not").join("here").join("file.txt");
        let resolved = real(Path::new("C:\\definitely\\not\\here\\file.txt"))
            .expect("kök var olduğu için çözümlenmeli");
        assert!(
            resolved.ends_with(&tail),
            "kökten sonraki bileşenler korunmalı: {resolved:?}"
        );
    }

    /// `..` içeren yol hiç çözümlenmez: bileşen bazlı `starts_with` bunu
    /// yakalayamaz, o yüzden kapı burada kapanır.
    #[test]
    fn real_rejects_parent_dir_components() {
        assert!(has_parent_dir(Path::new("C:\\data\\..\\evil.exe")));
        assert!(real(Path::new("C:\\data\\..\\evil.exe")).is_none());
    }
}
