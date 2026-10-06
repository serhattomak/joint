use tauri::{AppHandle, Manager};

// Modeller klasörünün yolu burada whisper.rs'teki yardımcıdan KOPYALANIYOR.
// Bu, `docs/media-tools-deferred.md`'te kayıtlı bilinen bir borçtur; 7c-1 kapsamı
// yalnızca kullanılabilirlik ölçümünü kayda bağlamaktı, bu yüzden kopya burada
// bırakıldı (düzeltmek whisper.rs'e dokunmayı gerektirirdi — paralel ajanın dosyası).
fn model_present(app: &AppHandle, model: &str) -> bool {
    match app.path().app_data_dir() {
        Ok(dir) => dir
            .join("jointvault-models")
            .join(format!("ggml-{model}.bin"))
            .exists(),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn health_check(app: AppHandle) -> Result<String, String> {
    // Kullanılabilirliğin TEK ölçütü bileşen kaydıdır (`components::probe_component`).
    //
    // Neden? Eskiden burada özel bir `probe_version` vardı ve `app.shell().sidecar(name)`
    // kullanıyordu: sidecar yalnızca **exe yanına** bakar, yani bileşenler klasörüne
    // indirilmiş bir ikiliyi göremez. Dahası whisper yalnızca "çözülebildi mi" diye
    // ölçülüyordu; `whisper.rs` ise gerçekten `--help` çalıştırıyordu. İki kod yolu
    // çelişebiliyordu — 7a'nın yakaladığı "kurulu ama çalıştırılamıyor" sınıfı tam
    // buydu. Artık ffmpeg, ffprobe ve whisper aynı çözümleyiciyi ve aynı çalıştırma
    // probunu kullanır; `components_status` ile `health_check` **inşa gereği** ayrışamaz.
    let (ffmpeg_available, ffmpeg_version) =
        crate::components::probe_component(&app, "ffmpeg").await;
    let (ffprobe_available, ffprobe_version) =
        crate::components::probe_component(&app, "ffprobe").await;
    // Whisper'ın "dürüst" tanımı: dosya çözülüyor VE `--help` gerçekten çalışıyor.
    // Yalnızca dosya varlığı yetmez: DLL'leri eksik bir `whisper.exe` burada `false`
    // döner. Kayıt o anda `installed: true, runnable: false` der — bu bilinçli bir
    // farktır, çelişki değil: kırık bir motoru "çalışıyor" saymayız.
    let (whisper_available, _) = crate::components::probe_component(&app, "whisper").await;
    let download_dir = crate::settings::get_download_dir(app.clone()).ok();
    // Eksik parça hata değildir: araç yoksa `available: false` döneriz, `Err` değil.
    // Sihirbaz/tanılama asla engellenmez; JSON şekli 7a'dan beri sabittir.
    Ok(serde_json::json!({
        "ffmpeg": { "available": ffmpeg_available, "version": ffmpeg_version },
        "ffprobe": { "available": ffprobe_available, "version": ffprobe_version },
        "whisper": { "available": whisper_available },
        "models": {
            "tiny": model_present(&app, "tiny"),
            "base": model_present(&app, "base"),
            "small": model_present(&app, "small"),
            "large-v3": model_present(&app, "large-v3"),
            "large-v3-q5_0": model_present(&app, "large-v3-q5_0"),
        },
        "download_dir": download_dir,
    })
    .to_string())
}
