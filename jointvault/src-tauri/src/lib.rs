mod collect;
mod convert;
mod download;
mod dupes;
mod pairing;
mod preview;
mod preview_media;
mod settings;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
      // İkinci çalıştırma: mevcut pencereyi öne getir, yeni süreç açılmasın.
      if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
      }
    }))
    .invoke_handler(tauri::generate_handler![preview::fetch_preview, preview_media::media_probe, preview_media::media_probe_cleanup, pairing::get_pairing_token, pairing::regenerate_pairing_token, settings::get_download_dir, settings::set_download_dir, settings::write_text_file, download::download_media, download::list_formats, convert::convert_media, dupes::scan_files, dupes::delete_file, dupes::scan_dir])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      tray::setup_tray(app.handle())?;
      tauri::async_runtime::spawn(collect::run_bridge(app.handle().clone()));
      Ok(())
    })
    .on_window_event(|window, event| tray::on_window_close(window, event))
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
