// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    io::Cursor,
    net::TcpListener,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};

use axum::{
    body::Body,
    extract::{Multipart, Path as AxumPath, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose, Engine as _};
use chrono::Utc;
use image::{DynamicImage, ImageFormat, Luma};
use local_ip_address::local_ip;
use qrcode::QrCode;
use serde::{Deserialize, Serialize};
use tauri::{WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

const DEFAULT_PORT: u16 = 8787;
const MAX_ITEMS: usize = 300;

#[derive(Clone)]
struct ServerState {
    admin_token: String,
    drop_token: Arc<Mutex<String>>,
    port: u16,
    received_dir: PathBuf,
    manifest_path: PathBuf,
    outgoing_manifest_path: PathBuf,
    items: Arc<Mutex<Vec<Item>>>,
    outgoing_items: Arc<Mutex<Vec<Item>>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    id: String,
    created_at: String,
    kind: String,
    text: Option<String>,
    original_name: Option<String>,
    stored_name: Option<String>,
    relative_path: Option<String>,
    size: Option<u64>,
    mime_type: Option<String>,
    source: String,
}

#[derive(Deserialize)]
struct AuthQuery {
    admin: Option<String>,
}

#[derive(Deserialize)]
struct TextRequest {
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunInfo {
    dashboard_url: String,
    iphone_url: String,
    received_dir: String,
    started_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardBoot {
    admin_token: String,
    items: Vec<Item>,
    outbox: Vec<Item>,
    received_dir: String,
}

#[derive(Serialize)]
struct ItemsResponse {
    items: Vec<Item>,
}

#[derive(Serialize)]
struct UploadResponse {
    ok: bool,
    items: Vec<Item>,
}

#[derive(Serialize)]
struct TextResponse {
    ok: bool,
    item: Item,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RegenerateResponse {
    drop_url: String,
    qr: String,
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let (listener, port) = bind_port(DEFAULT_PORT).expect("unable to bind local server");
            let state = ServerState::new(port).expect("unable to create app state");
            state.write_run_info();

            let dashboard_url = state.dashboard_url();
            let router = build_router(state.clone());
            listener
                .set_nonblocking(true)
                .expect("unable to configure listener");

            tauri::async_runtime::spawn(async move {
                let listener = tokio::net::TcpListener::from_std(listener)
                    .expect("unable to create async listener");
                if let Err(error) = axum::serve(listener, router).await {
                    eprintln!("WiFi Drop server stopped: {error}");
                }
            });

            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(dashboard_url.parse().expect("valid dashboard url")),
            )
            .title("WiFi Drop")
            .inner_size(1000.0, 664.0)
            .min_inner_size(860.0, 560.0)
            .resizable(true)
            .build()?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running WiFi Drop");
}

fn bind_port(start: u16) -> std::io::Result<(TcpListener, u16)> {
    for port in start..start + 20 {
        match TcpListener::bind(("0.0.0.0", port)) {
            Ok(listener) => return Ok((listener, port)),
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => continue,
            Err(error) => return Err(error),
        }
    }

    TcpListener::bind(("0.0.0.0", start)).map(|listener| (listener, start))
}

impl ServerState {
    fn new(port: u16) -> std::io::Result<Self> {
        let received_dir = dirs::document_dir()
            .unwrap_or(std::env::current_dir()?)
            .join("WiFi Drop");
        fs::create_dir_all(&received_dir)?;
        fs::create_dir_all(received_dir.join("To iPhone"))?;
        let manifest_path = received_dir.join("items.json");
        let outgoing_manifest_path = received_dir.join("outbox.json");
        let items = load_items(&manifest_path);
        let outgoing_items = load_items(&outgoing_manifest_path);

        Ok(Self {
            admin_token: make_token(),
            drop_token: Arc::new(Mutex::new(make_token())),
            port,
            received_dir,
            manifest_path,
            outgoing_manifest_path,
            items: Arc::new(Mutex::new(items)),
            outgoing_items: Arc::new(Mutex::new(outgoing_items)),
        })
    }

    fn lan_base_url(&self) -> String {
        let ip = local_ip()
            .map(|ip| ip.to_string())
            .unwrap_or_else(|_| "127.0.0.1".to_string());
        format!("http://{ip}:{}", self.port)
    }

    fn dashboard_url(&self) -> String {
        format!("http://localhost:{}/?admin={}", self.port, self.admin_token)
    }

    fn drop_url(&self) -> String {
        let token = self.drop_token.lock().unwrap().clone();
        format!("{}/drop/{token}", self.lan_base_url())
    }

    fn write_run_info(&self) {
        let info = RunInfo {
            dashboard_url: self.dashboard_url(),
            iphone_url: self.drop_url(),
            received_dir: self.received_dir.to_string_lossy().to_string(),
            started_at: Utc::now().to_rfc3339(),
        };

        if let Ok(json) = serde_json::to_string_pretty(&info) {
            let _ = fs::write(self.received_dir.join("run-info.json"), json);
        }
    }

    fn is_admin(&self, query: &AuthQuery) -> bool {
        query.admin.as_deref() == Some(self.admin_token.as_str())
    }

    fn is_drop_token(&self, token: &str) -> bool {
        self.drop_token.lock().unwrap().as_str() == token
    }

    fn add_item(&self, item: Item) -> Item {
        let mut items = self.items.lock().unwrap();
        items.insert(0, item.clone());
        items.truncate(MAX_ITEMS);
        save_items(&self.manifest_path, &items);
        item
    }

    fn add_outgoing_item(&self, item: Item) -> Item {
        let mut items = self.outgoing_items.lock().unwrap();
        items.insert(0, item.clone());
        items.truncate(MAX_ITEMS);
        save_items(&self.outgoing_manifest_path, &items);
        item
    }

    fn outgoing_dir(&self) -> PathBuf {
        self.received_dir.join("To iPhone")
    }
}

fn build_router(state: ServerState) -> Router {
    Router::new()
        .route("/", get(dashboard))
        .route("/drop/{token}", get(drop_page))
        .route("/api/items", get(api_items))
        .route("/api/outbox", get(api_outbox))
        .route("/api/outbox/text", post(send_text_to_phone))
        .route("/api/outbox/upload", post(upload_files_to_phone))
        .route("/api/phone-outbox/{token}", get(api_outbox_for_phone))
        .route("/api/regenerate", post(regenerate))
        .route("/api/open-folder", post(open_folder))
        .route("/api/text/{token}", post(receive_text))
        .route("/api/upload/{token}", post(upload_files))
        .route("/files/{id}", get(download_file))
        .route("/outbox-files/{token}/{id}", get(download_outgoing_file))
        .route("/public/{*asset}", get(asset))
        .with_state(state)
}

async fn dashboard(Query(query): Query<AuthQuery>, State(state): State<ServerState>) -> Response {
    if !state.is_admin(&query) {
        return Html(page("WiFi Drop", locked_page())).into_response();
    }

    let drop_url = state.drop_url();
    let qr = qr_data_url(&drop_url).unwrap_or_default();
    let items = state.items.lock().unwrap().clone();
    let outbox = state.outgoing_items.lock().unwrap().clone();
    let boot = DashboardBoot {
        admin_token: state.admin_token.clone(),
        items,
        outbox,
        received_dir: state.received_dir.to_string_lossy().to_string(),
    };
    let boot_json = serde_json::to_string(&boot).unwrap_or_else(|_| "{}".to_string());

    Html(page(
        "WiFi Drop",
        &format!(
            r#"
    <main class="design-page">
      <section class="app-surface">
        <header class="app-header">
          <div class="app-brand">
            <span class="brand-icon" aria-hidden="true"></span>
            <div>
              <strong>WiFi Drop</strong>
              <p data-i18n="appSubtitle">Trasferimento locale</p>
            </div>
          </div>
          <div class="app-tools">
            <select id="language-select" class="language-select" aria-label="Lingua"></select>
            <span class="privacy-chip" data-i18n="cloudBadge">Niente cloud</span>
          </div>
        </header>

        <div class="desktop-layout">
          <section class="pairing-pane">
            <div id="status" class="listen-pill">
              <span class="pulse-dot" aria-hidden="true"></span>
              <span data-i18n="statusListening">In ascolto</span>
            </div>

            <div class="qr-title">
              <h1 data-i18n="scanTitle">Scansiona con l'iPhone</h1>
              <p data-i18n="scanInstructions">Fotocamera -> inquadra il codice -> apri il link</p>
            </div>

            <div class="qr-frame">
              <img id="qr" src="{qr}" alt="QR code per aprire WiFi Drop su iPhone" data-i18n-alt="qrAlt">
              <span id="qr-badge" class="qr-badge" hidden data-i18n="qrRegenerated">QR rigenerato</span>
            </div>

            <div class="link-box">
              <code id="drop-url">{drop_url}</code>
              <button id="copy-link" class="small-button" type="button" data-i18n="copy">Copia</button>
            </div>

            <div class="qr-actions">
              <button id="regenerate" class="secondary small-button" type="button" data-i18n="regenerateQr">Rigenera QR</button>
              <span data-i18n="validWhileOpen">Valido finche WiFi Drop resta aperto</span>
            </div>

            <div class="local-note">
              <strong data-i18n="localOnlyTitle">Solo rete locale</strong>
              <p data-i18n="localOnlyBody">Il trasferimento avviene tra iPhone e PC sulla stessa Wi-Fi. Nessun server esterno, nessun account.</p>
            </div>
          </section>

          <div class="activity-pane">
            <section class="send-pane">
              <header class="received-header">
                <div>
                  <h2 data-i18n="sendToPhoneTitle">Invia all'iPhone</h2>
                  <p id="outbox-count" data-i18n="noOutboxItems">Niente pronto</p>
                </div>
              </header>

              <div class="send-controls">
                <form id="pc-text-form" class="desktop-send-box">
                  <label for="pc-text" data-i18n="pcTextLabel">Testo per iPhone</label>
                  <textarea id="pc-text" class="desktop-textarea" rows="4" placeholder="Scrivi o incolla testo da leggere sul telefono" data-i18n-placeholder="pcTextPlaceholder"></textarea>
                  <button id="pc-send-text" class="primary small-button" type="submit" data-i18n="sendToIphoneText">Invia testo</button>
                </form>

                <form id="pc-file-form" class="desktop-send-box">
                  <label for="pc-files" class="desktop-file-button">
                    <span class="row-icon file-icon" aria-hidden="true"></span>
                    <span data-i18n="choosePcFiles">Scegli file dal PC</span>
                  </label>
                  <input id="pc-files" class="visually-hidden" type="file" multiple>
                  <div id="pc-selected-files" class="selected-files" hidden></div>
                  <button id="pc-send-files" class="primary small-button" type="submit" data-i18n="sendToIphoneFile">Invia file</button>
                </form>
              </div>

              <section id="outbox-feed" class="outbox-feed" aria-live="polite"></section>
            </section>

            <section class="received-pane">
              <header class="received-header">
                <div>
                  <h2 data-i18n="receivedTitle">Ricevuti</h2>
                  <p id="item-count" data-i18n="noItems">Nessun elemento</p>
                </div>
                <button id="open-folder" class="small-button" type="button" data-i18n="openFolder">Apri cartella</button>
              </header>

              <p class="path-line">Documenti\\WiFi Drop</p>
              <section id="feed" class="feed" aria-live="polite"></section>
            </section>
          </div>
        </div>
      </section>
    </main>
    <script>window.WIFI_DROP = {boot_json};</script>
    <script src="/public/i18n.js"></script>
    <script src="/public/dashboard.js"></script>
"#,
            qr = qr,
            drop_url = escape_html(&drop_url),
            boot_json = boot_json
        ),
    ))
    .into_response()
}

async fn drop_page(
    AxumPath(token): AxumPath<String>,
    State(state): State<ServerState>,
) -> Response {
    if !state.is_drop_token(&token) {
        return Html(page("QR scaduto", expired_page())).into_response();
    }

    Html(page(
        "Invia a Windows",
        &format!(
            r#"
    <main class="phone-shell">
      <section class="phone-card">
        <header class="safari-bar">
          <div class="address-pill">
            <span class="lock-dot" aria-hidden="true"></span>
            <span data-i18n="safariLabel">WiFi Drop locale</span>
          </div>
        </header>

        <header class="phone-title">
          <div>
            <p class="caption">WiFi Drop</p>
            <h1 data-i18n="sendTitle">Invia al PC</h1>
          </div>
          <div class="phone-title-actions">
            <select id="language-select" class="language-select compact" aria-label="Lingua"></select>
            <span class="online-pill"><span class="pulse-dot" aria-hidden="true"></span><span data-i18n="connected">Connesso</span></span>
          </div>
        </header>

        <div class="segmented" role="tablist" aria-label="Tipo di invio" data-i18n-aria-label="sendType">
          <button class="segment active" type="button" data-mode="text" role="tab" aria-selected="true" data-i18n="tabText">Testo</button>
          <button class="segment" type="button" data-mode="files" role="tab" aria-selected="false" data-i18n="tabFile">File</button>
        </div>

        <form id="text-form" class="mode-panel" data-panel="text">
          <label for="text" data-i18n="textLabel">Testo</label>
          <textarea id="text" name="text" rows="8" placeholder="Incolla qui il testo" data-i18n-placeholder="textPlaceholder"></textarea>
          <p class="helper" data-i18n="textHelper">Appare sul PC, pronto da copiare.</p>
          <button id="send-text" class="phone-cta" type="submit" data-i18n="sendText">Invia testo</button>
        </form>

        <form id="file-form" class="mode-panel" data-panel="files" hidden>
          <div class="ios-list">
            <label for="files" class="ios-row">
              <span class="row-icon photo-icon" aria-hidden="true"></span>
              <span data-i18n="chooseFiles">Scegli foto o file</span>
              <span class="chevron" aria-hidden="true">></span>
            </label>
          </div>
          <input id="files" name="files" class="visually-hidden file-source" type="file" multiple>
          <div id="selected-files" class="selected-files" hidden></div>
          <p class="warning-note" data-i18n="fileWarning">Invii solo i file selezionati. Il testo scritto in Testo resta sul telefono.</p>
          <button id="send-files" class="phone-cta" type="submit" data-i18n="sendFile">Invia file</button>
        </form>

        <section class="phone-inbox">
          <header class="phone-inbox-header">
            <div>
              <h2 data-i18n="phoneInboxTitle">Dal PC</h2>
              <p id="phone-outbox-count" data-i18n="phoneInboxEmpty">Niente da scaricare</p>
            </div>
          </header>
          <div id="phone-outbox" class="phone-outbox-list" aria-live="polite"></div>
        </section>

        <p id="mobile-status" class="toast-pill" hidden>Pronto</p>
      </section>
    </main>
    <script>window.DROP_TOKEN = "{token}";</script>
    <script src="/public/i18n.js"></script>
    <script src="/public/drop.js"></script>
"#,
            token = escape_html(&token)
        ),
    ))
    .into_response()
}

async fn api_items(Query(query): Query<AuthQuery>, State(state): State<ServerState>) -> Response {
    if !state.is_admin(&query) {
        return StatusCode::FORBIDDEN.into_response();
    }

    Json(ItemsResponse {
        items: state.items.lock().unwrap().clone(),
    })
    .into_response()
}

async fn api_outbox(Query(query): Query<AuthQuery>, State(state): State<ServerState>) -> Response {
    if !state.is_admin(&query) {
        return StatusCode::FORBIDDEN.into_response();
    }

    Json(ItemsResponse {
        items: state.outgoing_items.lock().unwrap().clone(),
    })
    .into_response()
}

async fn api_outbox_for_phone(
    AxumPath(token): AxumPath<String>,
    State(state): State<ServerState>,
) -> Response {
    if !state.is_drop_token(&token) {
        return StatusCode::FORBIDDEN.into_response();
    }

    Json(ItemsResponse {
        items: state.outgoing_items.lock().unwrap().clone(),
    })
    .into_response()
}

async fn regenerate(Query(query): Query<AuthQuery>, State(state): State<ServerState>) -> Response {
    if !state.is_admin(&query) {
        return StatusCode::FORBIDDEN.into_response();
    }

    {
        let mut token = state.drop_token.lock().unwrap();
        *token = make_token();
    }

    state.write_run_info();
    let drop_url = state.drop_url();
    let qr = qr_data_url(&drop_url).unwrap_or_default();

    Json(RegenerateResponse { drop_url, qr }).into_response()
}

async fn open_folder(Query(query): Query<AuthQuery>, State(state): State<ServerState>) -> Response {
    if !state.is_admin(&query) {
        return StatusCode::FORBIDDEN.into_response();
    }

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("explorer.exe")
            .arg(&state.received_dir)
            .spawn();
    }

    Json(serde_json::json!({ "ok": true })).into_response()
}

async fn send_text_to_phone(
    Query(query): Query<AuthQuery>,
    State(state): State<ServerState>,
    Json(payload): Json<TextRequest>,
) -> Response {
    if !state.is_admin(&query) {
        return StatusCode::FORBIDDEN.into_response();
    }

    let text = payload.text.trim().to_string();
    if text.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Il testo e vuoto." })),
        )
            .into_response();
    }

    let item = state.add_outgoing_item(Item {
        id: Uuid::new_v4().to_string(),
        created_at: Utc::now().to_rfc3339(),
        kind: "text".to_string(),
        text: Some(text),
        original_name: None,
        stored_name: None,
        relative_path: None,
        size: None,
        mime_type: None,
        source: "PC".to_string(),
    });

    Json(TextResponse { ok: true, item }).into_response()
}

async fn upload_files_to_phone(
    Query(query): Query<AuthQuery>,
    State(state): State<ServerState>,
    mut multipart: Multipart,
) -> Response {
    if !state.is_admin(&query) {
        return StatusCode::FORBIDDEN.into_response();
    }

    let mut created = Vec::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() != Some("files") {
            continue;
        }

        let original_name = field
            .file_name()
            .map(ToString::to_string)
            .unwrap_or_else(|| "file".to_string());
        let mime_type = field
            .content_type()
            .map(ToString::to_string)
            .unwrap_or_else(|| "application/octet-stream".to_string());
        let bytes = match field.bytes().await {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };

        let day = Utc::now().format("%Y-%m-%d").to_string();
        let outbox_dir = state.outgoing_dir();
        let day_dir = outbox_dir.join(&day);
        let _ = fs::create_dir_all(&day_dir);
        let stored_name = make_stored_name(&original_name);
        let file_path = day_dir.join(&stored_name);

        if fs::write(&file_path, &bytes).is_err() {
            continue;
        }

        let relative_path = file_path
            .strip_prefix(&state.received_dir)
            .unwrap_or(&file_path)
            .to_string_lossy()
            .to_string();

        let item = state.add_outgoing_item(Item {
            id: Uuid::new_v4().to_string(),
            created_at: Utc::now().to_rfc3339(),
            kind: "file".to_string(),
            text: None,
            original_name: Some(original_name),
            stored_name: Some(stored_name),
            relative_path: Some(relative_path),
            size: Some(bytes.len() as u64),
            mime_type: Some(mime_type),
            source: "PC".to_string(),
        });
        created.push(item);
    }

    if created.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Scegli almeno un file." })),
        )
            .into_response();
    }

    Json(UploadResponse {
        ok: true,
        items: created,
    })
    .into_response()
}

async fn receive_text(
    AxumPath(token): AxumPath<String>,
    State(state): State<ServerState>,
    Json(payload): Json<TextRequest>,
) -> Response {
    if !state.is_drop_token(&token) {
        return StatusCode::FORBIDDEN.into_response();
    }

    let text = payload.text.trim().to_string();
    if text.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Il testo e vuoto." })),
        )
            .into_response();
    }

    let item = state.add_item(Item {
        id: Uuid::new_v4().to_string(),
        created_at: Utc::now().to_rfc3339(),
        kind: "text".to_string(),
        text: Some(text),
        original_name: None,
        stored_name: None,
        relative_path: None,
        size: None,
        mime_type: None,
        source: "iPhone".to_string(),
    });

    Json(TextResponse { ok: true, item }).into_response()
}

async fn upload_files(
    AxumPath(token): AxumPath<String>,
    State(state): State<ServerState>,
    mut multipart: Multipart,
) -> Response {
    if !state.is_drop_token(&token) {
        return StatusCode::FORBIDDEN.into_response();
    }

    let mut created = Vec::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() != Some("files") {
            continue;
        }

        let original_name = field
            .file_name()
            .map(ToString::to_string)
            .unwrap_or_else(|| "file".to_string());
        let mime_type = field
            .content_type()
            .map(ToString::to_string)
            .unwrap_or_else(|| "application/octet-stream".to_string());
        let bytes = match field.bytes().await {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };

        let day = Utc::now().format("%Y-%m-%d").to_string();
        let day_dir = state.received_dir.join(&day);
        let _ = fs::create_dir_all(&day_dir);
        let stored_name = make_stored_name(&original_name);
        let file_path = day_dir.join(&stored_name);

        if fs::write(&file_path, &bytes).is_err() {
            continue;
        }

        let relative_path = file_path
            .strip_prefix(&state.received_dir)
            .unwrap_or(&file_path)
            .to_string_lossy()
            .to_string();

        let item = state.add_item(Item {
            id: Uuid::new_v4().to_string(),
            created_at: Utc::now().to_rfc3339(),
            kind: "file".to_string(),
            text: None,
            original_name: Some(original_name),
            stored_name: Some(stored_name),
            relative_path: Some(relative_path),
            size: Some(bytes.len() as u64),
            mime_type: Some(mime_type),
            source: "iPhone".to_string(),
        });
        created.push(item);
    }

    if created.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Scegli almeno un file." })),
        )
            .into_response();
    }

    Json(UploadResponse {
        ok: true,
        items: created,
    })
    .into_response()
}

async fn download_file(
    AxumPath(id): AxumPath<String>,
    Query(query): Query<AuthQuery>,
    State(state): State<ServerState>,
) -> Response {
    if !state.is_admin(&query) {
        return StatusCode::FORBIDDEN.into_response();
    }

    let item = {
        let items = state.items.lock().unwrap();
        items
            .iter()
            .find(|item| item.id == id && item.kind == "file")
            .cloned()
    };
    let Some(item) = item else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let Some(relative_path) = item.relative_path else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let file_path = state.received_dir.join(relative_path);
    if !is_inside(&file_path, &state.received_dir) {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let Ok(bytes) = fs::read(&file_path) else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let original_name = item.original_name.unwrap_or_else(|| "file".to_string());
    let mime = item.mime_type.unwrap_or_else(|| {
        mime_guess::from_path(&file_path)
            .first_or_octet_stream()
            .to_string()
    });
    let disposition = format!(
        "attachment; filename=\"{}\"",
        original_name.replace('"', "")
    );

    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition).unwrap_or(HeaderValue::from_static("attachment")),
    );
    response
}

async fn download_outgoing_file(
    AxumPath((token, id)): AxumPath<(String, String)>,
    State(state): State<ServerState>,
) -> Response {
    if !state.is_drop_token(&token) {
        return StatusCode::FORBIDDEN.into_response();
    }

    let item = {
        let items = state.outgoing_items.lock().unwrap();
        items
            .iter()
            .find(|item| item.id == id && item.kind == "file")
            .cloned()
    };
    let Some(item) = item else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let Some(relative_path) = item.relative_path else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let file_path = state.received_dir.join(relative_path);
    if !is_inside(&file_path, &state.received_dir) {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let Ok(bytes) = fs::read(&file_path) else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let original_name = item.original_name.unwrap_or_else(|| "file".to_string());
    let mime = item.mime_type.unwrap_or_else(|| {
        mime_guess::from_path(&file_path)
            .first_or_octet_stream()
            .to_string()
    });
    let disposition = format!(
        "attachment; filename=\"{}\"",
        original_name.replace('"', "")
    );

    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition).unwrap_or(HeaderValue::from_static("attachment")),
    );
    response
}

async fn asset(AxumPath(asset): AxumPath<String>) -> Response {
    match asset.as_str() {
        "styles.css" => (
            [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
            include_str!("../../public/styles.css"),
        )
            .into_response(),
        "i18n.js" => (
            [(
                header::CONTENT_TYPE,
                "application/javascript; charset=utf-8",
            )],
            include_str!("../../public/i18n.js"),
        )
            .into_response(),
        "dashboard.js" => (
            [(
                header::CONTENT_TYPE,
                "application/javascript; charset=utf-8",
            )],
            include_str!("../../public/dashboard.js"),
        )
            .into_response(),
        "drop.js" => (
            [(
                header::CONTENT_TYPE,
                "application/javascript; charset=utf-8",
            )],
            include_str!("../../public/drop.js"),
        )
            .into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

fn page(title: &str, body: &str) -> String {
    format!(
        r#"<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{}</title>
    <link rel="stylesheet" href="/public/styles.css">
  </head>
  <body>{}</body>
</html>"#,
        escape_html(title),
        body
    )
}

fn locked_page() -> &'static str {
    r#"
    <main class="phone-shell">
      <section class="phone-card">
        <header class="phone-title">
          <div>
            <p class="caption">WiFi Drop</p>
            <h1 data-i18n="privateLink">Link privato</h1>
          </div>
        </header>
      </section>
    </main>
    <script src="/public/i18n.js"></script>
"#
}

fn expired_page() -> &'static str {
    r#"
    <main class="phone-shell">
      <section class="phone-card">
        <header class="phone-title">
          <div>
            <p class="caption">WiFi Drop</p>
            <h1 data-i18n="expiredTitle">QR non valido</h1>
          </div>
        </header>
        <div class="mode-panel">
          <p class="helper" data-i18n="expiredBody">Questo link e scaduto. Rigenera il QR dalla dashboard sul PC.</p>
        </div>
      </section>
    </main>
    <script src="/public/i18n.js"></script>
"#
}

fn qr_data_url(value: &str) -> Option<String> {
    let code = QrCode::new(value.as_bytes()).ok()?;
    let image = code
        .render::<Luma<u8>>()
        .min_dimensions(480, 480)
        .quiet_zone(true)
        .build();
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageLuma8(image)
        .write_to(&mut bytes, ImageFormat::Png)
        .ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(bytes.into_inner())
    ))
}

fn make_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn make_stored_name(original_name: &str) -> String {
    let path = Path::new(original_name);
    let ext = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("file");
    let safe_stem = sanitize_filename::sanitize(stem);
    let stamp = Utc::now().format("%Y-%m-%dT%H-%M-%S-%3fZ");

    if ext.is_empty() {
        format!("{stamp}-{}-{safe_stem}", Uuid::new_v4().simple())
    } else {
        format!("{stamp}-{}-{safe_stem}.{ext}", Uuid::new_v4().simple())
    }
}

fn load_items(path: &Path) -> Vec<Item> {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<Item>>(&text).ok())
        .unwrap_or_default()
}

fn save_items(path: &Path, items: &[Item]) {
    if let Ok(json) = serde_json::to_string_pretty(items) {
        let _ = fs::write(path, json);
    }
}

fn is_inside(path: &Path, root: &Path) -> bool {
    let Ok(path) = path.canonicalize() else {
        return false;
    };
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    path.starts_with(root)
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
