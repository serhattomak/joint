mod collect;
mod pairing;
mod preview;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .invoke_handler(tauri::generate_handler![preview::fetch_preview, pairing::get_pairing_token, pairing::regenerate_pairing_token])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      tauri::async_runtime::spawn(collect::run_bridge(app.handle().clone()));
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
