use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

// ponytail: sistem tepsisi + kapatınca gizle — arka plan servisi bu ikisi.
// Çıkış sadece tray menüsünden (çift çalışmayı önler, single-instance yok).
pub fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "JointVault'u Göster", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("pencere ikonu yok");
    TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Ana pencereyi öne getirir. Tepsi tıklaması, tek örnek kilidi ve **tarayıcıdan
/// devralınan indirme** buradan geçer.
///
/// Neden `set_focus` tek başına yetmez: Windows ön planı kısıtlar — son girdiyi
/// almayan bir süreç `SetForegroundWindow` ile öne geçemez, yalnız görev
/// çubuğunda yanar. Tarayıcıdan gelen istekte girdi Chrome'da olduğu için tam
/// olarak o durumdayız. Pencere kısa süreliğine "her zaman üstte" yapılıp geri
/// alınır; bu kısıtı aşar ve kalıcı bir davranış değişikliği bırakmaz.
pub(crate) fn raise_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(700)).await;
        if let Some(w) = handle.get_webview_window("main") {
            let _ = w.set_always_on_top(false);
        }
    });
}

fn show_main(app: &tauri::AppHandle) {
    raise_main_window(app);
}

pub fn on_window_close(app: &tauri::AppHandle, window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if crate::settings::close_is_quit(app) {
            return; // kapatmaya izin ver — uygulama tamamen çıkar
        }
        let _ = window.hide();
        api.prevent_close();
    }
}
