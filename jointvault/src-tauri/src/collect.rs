use axum::{extract::State, http::{HeaderMap, StatusCode}, routing::post, Json, Router};
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
}

pub async fn run_bridge(app: tauri::AppHandle) {
    let router = Router::new()
        .route("/collect", post(collect))
        .with_state(app);
    let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:48120").await else {
        return;
    };
    let _ = axum::serve(listener, router).await;
}

async fn collect(
    State(app): State<tauri::AppHandle>,
    headers: HeaderMap,
    Json(body): Json<CollectBody>,
) -> (StatusCode, Json<serde_json::Value>) {
    // ponytail: token file read per request so regen needs no restart; tiny file, negligible cost.
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
    match (expected, got) {
        (Some(e), Some(g)) if e == g => {
            let n = body.items.len();
            let _ = app.emit("x-sync-collect", &body);
            (
                StatusCode::ACCEPTED,
                Json(serde_json::json!({ "accepted": n })),
            )
        }
        _ => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "unauthorized" })),
        ),
    }
}
