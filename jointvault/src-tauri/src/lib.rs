mod collect;
mod convert;
mod download;
mod dupes;
mod gif;
mod health;
mod merge;
mod pairing;
mod preview;
mod preview_media;
mod settings;
mod silence;
mod tray;
mod whisper;
mod ai;

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
    .invoke_handler(tauri::generate_handler![
      preview::fetch_preview,
      preview_media::media_probe,
      preview_media::media_probe_cleanup,
      pairing::get_pairing_token,
      pairing::regenerate_pairing_token,
      settings::get_download_dir,
      settings::set_download_dir,
      settings::write_text_file,
      settings::get_close_behavior,
      settings::set_close_behavior,
      download::download_media,
      download::list_formats,
      convert::convert_media,
      merge::merge_media,
      gif::make_gif,
      silence::trim_silence,
      whisper::whisper_status,
      whisper::download_model,
      whisper::download_whisper_engine,
      whisper::transcribe,
      whisper::embed_subtitle,
      whisper::extract_subtitle,
      health::health_check,
      dupes::scan_files,
      dupes::delete_file,
      dupes::scan_dir,
      ai::ai_status,
      ai::ai_save_config,
      ai::ai_stop_server,
      ai::ai_download_engine,
      ai::ai_download_model,
      ai::ai_embed,
      ai::ai_chat_stream,
      ai::ai_suggest_tags,
      ai::ai_summarize,
      ai::ai_warmup,
      ai::ai_categorize_and_tag
    ])
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
      ai::start_watchdog(app.handle().clone());
      ai::warmup_ai_on_startup(app.handle().clone());
      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::Destroyed = event {
        ai::cleanup_ai_servers();
      }
      tray::on_window_close(window.app_handle(), window, event)
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
