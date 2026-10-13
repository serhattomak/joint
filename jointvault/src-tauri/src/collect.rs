use axum::{extract::{Query, State}, http::{HeaderMap, StatusCode}, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

#[derive(Deserialize, Serialize)]
struct Item {
    url: String,
    title: Option<String>,
    thumbnail: Option<String>,
    site: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct CollectBody {
    items: Vec<Item>,
    mode: Option<String>,
    kind: Option<String>,
    quality: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct CookiesBody {
    content: String,
}

/// Sabit zamanlı karşılaştırma: düz `==` ilk farklı baytta çıkar, yani yanıt
/// süresi token'ın kaç karakterinin doğru olduğunu sızdırabilir. Burada tüm
/// baytlar her zaman karşılaştırılır.
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Köprü isteğini yetkilendir — ÜÇ kapı birlikte.
///
/// 1. **Host yerel olmalı.** Yabancı bir alan adı bu adrese çözülürse (DNS
///    rebinding) istek reddedilir.
/// 2. **`Origin` varsa eklenti olmalı.** Bir WEB SAYFASI bu adrese istek atarsa
///    tarayıcı `Origin` başlığını ekler ve sayfa kaynaklı istekler reddedilir.
///    `Origin`'in YOKLUĞU reddedilmez: eklentiler bu başlığı göndermeyebilir,
///    yokluğu reddetmek eklentiyi kırardı.
/// 3. **Token sabit zamanlı** karşılaştırılır (bkz. `ct_eq`).
fn authorize(app: &tauri::AppHandle, headers: &HeaderMap) -> bool {
    let host_ok = headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .map(|h| {
            let h = h.to_ascii_lowercase();
            h.starts_with("127.0.0.1:") || h.starts_with("localhost:")
        })
        .unwrap_or(false);
    if !host_ok {
        return false;
    }

    if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
        let o = origin.to_ascii_lowercase();
        if !(o.starts_with("chrome-extension://") || o.starts_with("moz-extension://")) {
            return false;
        }
    }

    let expected = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join("bridge_token")).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let got = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim);
    let ok = match (expected, got) {
        (Some(e), Some(g)) => ct_eq(&e, g),
        _ => false,
    };
    if ok {
        // "Son temas" göstergesi (Ayarlar → Eklenti) tek burada tazelenir: üç
        // yolun (collect/formats/cookies) hepsi bu kapıdan geçer.
        crate::pairing::mark_last_seen(app);
    }
    ok
}

fn unauthorized() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({ "error": "unauthorized" })),
    )
}

pub async fn run_bridge(app: tauri::AppHandle) {
    let router = Router::new()
        .route("/collect", post(collect))
        .route("/formats", get(formats))
        .route("/cookies", post(receive_cookies))
        .with_state(app);
    let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:48120").await else {
        return;
    };
    let _ = axum::serve(listener, router).await;
}

// GET /formats?url=... — linkin gerçek video yükseklikleri (eklenti kalite menüsü).
// Aynı Bearer token kontrolü; yt-dlp -J çıktısından yükseklikleri ayıklar.
async fn formats(
    State(app): State<tauri::AppHandle>,
    headers: HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> (StatusCode, Json<serde_json::Value>) {
    if !authorize(&app, &headers) {
        return unauthorized();
    }
    let Some(url) = params.get("url").cloned() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "missing url" })),
        );
    };
    match crate::download::list_formats(app, serde_json::json!({ "url": url })).await {
        Ok(opts) => {
            let mut heights: Vec<u32> = opts
                .iter()
                .filter(|o| o.vcodec != "none")
                .filter_map(|o| o.height)
                .collect();
            heights.sort_unstable();
            heights.dedup();
            (StatusCode::OK, Json(serde_json::json!({ "heights": heights })))
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        ),
    }
}

async fn collect(
    State(app): State<tauri::AppHandle>,
    headers: HeaderMap,
    Json(body): Json<CollectBody>,
) -> (StatusCode, Json<serde_json::Value>) {
    if !authorize(&app, &headers) {
        return unauthorized();
    }
    let n = body.items.len();
    if body.mode.as_deref() == Some("download") {
        let _ = app.emit("x-sync-download", &body);
    } else {
        let _ = app.emit("x-sync-collect", &body);
    }
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "accepted": n })),
    )
}

async fn receive_cookies(
    State(app): State<tauri::AppHandle>,
    headers: HeaderMap,
    Json(body): Json<CookiesBody>,
) -> (StatusCode, Json<serde_json::Value>) {
    if !authorize(&app, &headers) {
        return unauthorized();
    }
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if std::fs::write(dir.join("cookies.txt"), &body.content).is_ok() {
            let _ = app.emit("cookies-updated", ());
            return (
                StatusCode::OK,
                Json(serde_json::json!({ "status": "ok", "message": "cookies saved" })),
            );
        }
    }
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": "could not write cookies.txt" })),
    )
}
