use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::secrets;

const APP_DIR_NAME: &str = "com.apiclient.dev";

pub fn app_data_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir()
        .ok_or_else(|| "Failed to get data directory".to_string())?;
    Ok(base.join(APP_DIR_NAME))
}

fn collections_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("collections");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create collections dir: {}", e))?;
    Ok(dir)
}

fn environments_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("environments");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create environments dir: {}", e))?;
    Ok(dir)
}

fn workspace_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("workspaces");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create workspaces dir: {}", e))?;
    Ok(dir)
}

// === Collection Types ===

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CollectionKeyValue {
    pub id: String,
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CollectionRequest {
    pub id: String,
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<CollectionKeyValue>,
    pub params: Vec<CollectionKeyValue>,
    pub body: String,
    pub body_type: String,
    pub auth: Option<AuthConfig>,
    /// Pre-request script source. Runs in the frontend Web Worker sandbox.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_script: Option<String>,
    /// Post-response test script source. Runs in the frontend Web Worker sandbox.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_script: Option<String>,
    /// User-defined free-form labels used for filtering & color-coding in the
    /// sidebar. Empty / missing == no tags. Pure metadata — not sent with the
    /// request.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CollectionFolder {
    pub id: String,
    pub name: String,
    /// Folder-level auth. Requests under this folder with auth_type=inherit
    /// fall back to this before walking up to the collection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<AuthConfig>,
    /// Folder-scoped variables. Override collection / global vars but are
    /// overridden by environment / transient vars during substitution.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variables: Vec<EnvVariable>,
    pub requests: Vec<CollectionRequest>,
    pub folders: Vec<CollectionFolder>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CollectionFile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub auth: Option<AuthConfig>,
    /// Collection-scoped variables. Sit above global vars and below folder /
    /// environment / transient vars in the substitution precedence chain.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variables: Vec<EnvVariable>,
    pub requests: Vec<CollectionRequest>,
    pub folders: Vec<CollectionFolder>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Workspace this collection belongs to. `None` on legacy files; the
    /// app assigns the default workspace on first load via `migrate_legacy_to_workspace`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthConfig {
    pub auth_type: String, // "none" | "bearer" | "basic" | "api_key" | "oauth2" | "sigv4"
    pub bearer_token: Option<String>,
    pub basic_username: Option<String>,
    pub basic_password: Option<String>,
    pub api_key_key: Option<String>,
    pub api_key_value: Option<String>,
    pub api_key_in: Option<String>, // "header" | "query"

    // OAuth2 fields. Populated only when auth_type == "oauth2".
    /// "client_credentials" | "password"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth2_grant_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth2_token_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth2_client_id: Option<String>,
    /// Stored in keychain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth2_client_secret: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth2_scope: Option<String>,
    /// "basic" (send creds in HTTP Basic header) | "body" (in request body).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth2_client_auth: Option<String>,
    /// Required for grant_type=password.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth2_username: Option<String>,
    /// Required for grant_type=password. Stored in keychain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth2_password: Option<String>,
    /// Cached access token from the most recent fetch. Stored in keychain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth2_access_token: Option<String>,
    /// Unix millis when the cached token stops being valid.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth2_token_expires_at: Option<i64>,

    // AWS SigV4 — populated only when auth_type == "sigv4".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aws_access_key_id: Option<String>,
    /// Stored in keychain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aws_secret_access_key: Option<String>,
    /// Optional STS session token. Stored in keychain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aws_session_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aws_region: Option<String>,
    /// AWS service name (e.g. "s3", "execute-api", "dynamodb").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aws_service: Option<String>,

    // HTTP Digest — populated only when auth_type == "digest".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest_username: Option<String>,
    /// Stored in keychain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest_password: Option<String>,

    // OAuth 1.0a — populated only when auth_type == "oauth1".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth1_consumer_key: Option<String>,
    /// Stored in keychain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth1_consumer_secret: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth1_token: Option<String>,
    /// Stored in keychain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth1_token_secret: Option<String>,
    /// "HMAC-SHA1" | "HMAC-SHA256" | "PLAINTEXT"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth1_signature_method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth1_realm: Option<String>,
    /// "header" | "query"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth1_add_to: Option<String>,

    // JWT signer — populated only when auth_type == "jwt".
    /// "HS256" | "HS384" | "HS512"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jwt_algorithm: Option<String>,
    /// Stored in keychain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jwt_secret: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jwt_secret_is_base64: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jwt_payload: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jwt_request_header: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jwt_header_prefix: Option<String>,
}

// === Environment Types ===

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EnvVariable {
    pub key: String,
    pub value: String,
    pub enabled: bool,
    pub is_secret: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EnvironmentFile {
    pub id: String,
    pub name: String,
    pub variables: Vec<EnvVariable>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Workspace this environment belongs to. `None` on legacy files; the
    /// app assigns the default workspace on first load via `migrate_legacy_to_workspace`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

// === Workspace Types ===

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceFile {
    pub id: String,
    pub name: String,
    pub active_environment_id: Option<String>,
    pub active_collection_id: Option<String>,
    pub active_request_id: Option<String>,
    pub window_state: Option<WindowState>,
    /// Workspace-global variables. Sit at the bottom of the substitution
    /// precedence chain — overridden by every other scope.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variables: Vec<EnvVariable>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowState {
    pub sidebar_width: Option<f64>,
    pub request_panel_height: Option<f64>,
    pub sidebar_tab: Option<String>,
    /// Snapshot of open tabs (`RequestItem` shape on the frontend). Kept as
    /// opaque JSON because the frontend `RequestItem` carries fields that
    /// have no Rust counterpart (`formData`, `protocol`, `verifyTls`, …).
    /// We never read its contents on the backend — just round-trip it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open_tabs: Option<serde_json::Value>,
    /// Active tab id from the most recent save. The frontend rehydrates this
    /// on initialize / workspace switch so users land on the same tab they
    /// left from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_tab_id: Option<String>,
}

// === Secret redaction / hydration helpers ===
//
// Auth credentials and environment variables flagged `is_secret` are stored on disk
// with their value blanked out, and the real value lives in the OS keychain. This
// keeps collection/environment JSON files safe to sync or back up while still
// allowing the request to actually authenticate at send time.

const AUTH_BEARER: &str = "bearer_token";
const AUTH_BASIC_PWD: &str = "basic_password";
const AUTH_API_KEY_VALUE: &str = "api_key_value";
const AUTH_OAUTH2_CLIENT_SECRET: &str = "oauth2_client_secret";
const AUTH_OAUTH2_PASSWORD: &str = "oauth2_password";
const AUTH_OAUTH2_ACCESS_TOKEN: &str = "oauth2_access_token";
const AUTH_AWS_SECRET_KEY: &str = "aws_secret_access_key";
const AUTH_AWS_SESSION_TOKEN: &str = "aws_session_token";
const AUTH_DIGEST_PASSWORD: &str = "digest_password";
const AUTH_OAUTH1_CONSUMER_SECRET: &str = "oauth1_consumer_secret";
const AUTH_OAUTH1_TOKEN_SECRET: &str = "oauth1_token_secret";
const AUTH_JWT_SECRET: &str = "jwt_secret";

fn sanitize_auth(auth: &mut Option<AuthConfig>, scope_id: &str) {
    let Some(a) = auth.as_mut() else { return };
    // For each secret field: if the user provided a value, persist it to the
    // keychain; if they cleared the field, delete the keychain entry so the
    // clear actually takes effect. Without the delete branch, hydrate_auth
    // would silently restore the old value on the next load.
    if let Some(t) = a.bearer_token.as_deref() {
        if !t.is_empty() {
            let _ = secrets::store_auth_secret(scope_id, AUTH_BEARER, t);
        } else {
            let _ = secrets::delete_auth_secret(scope_id, AUTH_BEARER);
        }
        a.bearer_token = Some(String::new());
    }
    if let Some(p) = a.basic_password.as_deref() {
        if !p.is_empty() {
            let _ = secrets::store_auth_secret(scope_id, AUTH_BASIC_PWD, p);
        } else {
            let _ = secrets::delete_auth_secret(scope_id, AUTH_BASIC_PWD);
        }
        a.basic_password = Some(String::new());
    }
    if let Some(v) = a.api_key_value.as_deref() {
        if !v.is_empty() {
            let _ = secrets::store_auth_secret(scope_id, AUTH_API_KEY_VALUE, v);
        } else {
            let _ = secrets::delete_auth_secret(scope_id, AUTH_API_KEY_VALUE);
        }
        a.api_key_value = Some(String::new());
    }
    if let Some(v) = a.oauth2_client_secret.as_deref() {
        if !v.is_empty() {
            let _ = secrets::store_auth_secret(scope_id, AUTH_OAUTH2_CLIENT_SECRET, v);
        } else {
            let _ = secrets::delete_auth_secret(scope_id, AUTH_OAUTH2_CLIENT_SECRET);
        }
        a.oauth2_client_secret = Some(String::new());
    }
    if let Some(v) = a.oauth2_password.as_deref() {
        if !v.is_empty() {
            let _ = secrets::store_auth_secret(scope_id, AUTH_OAUTH2_PASSWORD, v);
        } else {
            let _ = secrets::delete_auth_secret(scope_id, AUTH_OAUTH2_PASSWORD);
        }
        a.oauth2_password = Some(String::new());
    }
    if let Some(v) = a.oauth2_access_token.as_deref() {
        if !v.is_empty() {
            let _ = secrets::store_auth_secret(scope_id, AUTH_OAUTH2_ACCESS_TOKEN, v);
        } else {
            let _ = secrets::delete_auth_secret(scope_id, AUTH_OAUTH2_ACCESS_TOKEN);
        }
        a.oauth2_access_token = Some(String::new());
    }
    if let Some(v) = a.aws_secret_access_key.as_deref() {
        if !v.is_empty() {
            let _ = secrets::store_auth_secret(scope_id, AUTH_AWS_SECRET_KEY, v);
        } else {
            let _ = secrets::delete_auth_secret(scope_id, AUTH_AWS_SECRET_KEY);
        }
        a.aws_secret_access_key = Some(String::new());
    }
    if let Some(v) = a.aws_session_token.as_deref() {
        if !v.is_empty() {
            let _ = secrets::store_auth_secret(scope_id, AUTH_AWS_SESSION_TOKEN, v);
        } else {
            let _ = secrets::delete_auth_secret(scope_id, AUTH_AWS_SESSION_TOKEN);
        }
        a.aws_session_token = Some(String::new());
    }
    if let Some(v) = a.digest_password.as_deref() {
        if !v.is_empty() {
            let _ = secrets::store_auth_secret(scope_id, AUTH_DIGEST_PASSWORD, v);
        } else {
            let _ = secrets::delete_auth_secret(scope_id, AUTH_DIGEST_PASSWORD);
        }
        a.digest_password = Some(String::new());
    }
    if let Some(v) = a.oauth1_consumer_secret.as_deref() {
        if !v.is_empty() {
            let _ = secrets::store_auth_secret(scope_id, AUTH_OAUTH1_CONSUMER_SECRET, v);
        } else {
            let _ = secrets::delete_auth_secret(scope_id, AUTH_OAUTH1_CONSUMER_SECRET);
        }
        a.oauth1_consumer_secret = Some(String::new());
    }
    if let Some(v) = a.oauth1_token_secret.as_deref() {
        if !v.is_empty() {
            let _ = secrets::store_auth_secret(scope_id, AUTH_OAUTH1_TOKEN_SECRET, v);
        } else {
            let _ = secrets::delete_auth_secret(scope_id, AUTH_OAUTH1_TOKEN_SECRET);
        }
        a.oauth1_token_secret = Some(String::new());
    }
    if let Some(v) = a.jwt_secret.as_deref() {
        if !v.is_empty() {
            let _ = secrets::store_auth_secret(scope_id, AUTH_JWT_SECRET, v);
        } else {
            let _ = secrets::delete_auth_secret(scope_id, AUTH_JWT_SECRET);
        }
        a.jwt_secret = Some(String::new());
    }
}

fn hydrate_auth(auth: &mut Option<AuthConfig>, scope_id: &str) {
    let Some(a) = auth.as_mut() else { return };
    if a.bearer_token.as_deref().is_none_or(str::is_empty) {
        if let Ok(Some(v)) = secrets::get_auth_secret(scope_id, AUTH_BEARER) {
            a.bearer_token = Some(v);
        }
    }
    if a.basic_password.as_deref().is_none_or(str::is_empty) {
        if let Ok(Some(v)) = secrets::get_auth_secret(scope_id, AUTH_BASIC_PWD) {
            a.basic_password = Some(v);
        }
    }
    if a.api_key_value.as_deref().is_none_or(str::is_empty) {
        if let Ok(Some(v)) = secrets::get_auth_secret(scope_id, AUTH_API_KEY_VALUE) {
            a.api_key_value = Some(v);
        }
    }
    if a.oauth2_client_secret.as_deref().is_none_or(str::is_empty) {
        if let Ok(Some(v)) = secrets::get_auth_secret(scope_id, AUTH_OAUTH2_CLIENT_SECRET) {
            a.oauth2_client_secret = Some(v);
        }
    }
    if a.oauth2_password.as_deref().is_none_or(str::is_empty) {
        if let Ok(Some(v)) = secrets::get_auth_secret(scope_id, AUTH_OAUTH2_PASSWORD) {
            a.oauth2_password = Some(v);
        }
    }
    if a.oauth2_access_token.as_deref().is_none_or(str::is_empty) {
        if let Ok(Some(v)) = secrets::get_auth_secret(scope_id, AUTH_OAUTH2_ACCESS_TOKEN) {
            a.oauth2_access_token = Some(v);
        }
    }
    if a.aws_secret_access_key.as_deref().is_none_or(str::is_empty) {
        if let Ok(Some(v)) = secrets::get_auth_secret(scope_id, AUTH_AWS_SECRET_KEY) {
            a.aws_secret_access_key = Some(v);
        }
    }
    if a.aws_session_token.as_deref().is_none_or(str::is_empty) {
        if let Ok(Some(v)) = secrets::get_auth_secret(scope_id, AUTH_AWS_SESSION_TOKEN) {
            a.aws_session_token = Some(v);
        }
    }
    if a.digest_password.as_deref().is_none_or(str::is_empty) {
        if let Ok(Some(v)) = secrets::get_auth_secret(scope_id, AUTH_DIGEST_PASSWORD) {
            a.digest_password = Some(v);
        }
    }
    if a.oauth1_consumer_secret.as_deref().is_none_or(str::is_empty) {
        if let Ok(Some(v)) = secrets::get_auth_secret(scope_id, AUTH_OAUTH1_CONSUMER_SECRET) {
            a.oauth1_consumer_secret = Some(v);
        }
    }
    if a.oauth1_token_secret.as_deref().is_none_or(str::is_empty) {
        if let Ok(Some(v)) = secrets::get_auth_secret(scope_id, AUTH_OAUTH1_TOKEN_SECRET) {
            a.oauth1_token_secret = Some(v);
        }
    }
    if a.jwt_secret.as_deref().is_none_or(str::is_empty) {
        if let Ok(Some(v)) = secrets::get_auth_secret(scope_id, AUTH_JWT_SECRET) {
            a.jwt_secret = Some(v);
        }
    }
}

fn purge_auth(auth: &Option<AuthConfig>, scope_id: &str) {
    if auth.is_some() {
        let _ = secrets::delete_auth_secret(scope_id, AUTH_BEARER);
        let _ = secrets::delete_auth_secret(scope_id, AUTH_BASIC_PWD);
        let _ = secrets::delete_auth_secret(scope_id, AUTH_API_KEY_VALUE);
        let _ = secrets::delete_auth_secret(scope_id, AUTH_OAUTH2_CLIENT_SECRET);
        let _ = secrets::delete_auth_secret(scope_id, AUTH_OAUTH2_PASSWORD);
        let _ = secrets::delete_auth_secret(scope_id, AUTH_OAUTH2_ACCESS_TOKEN);
        let _ = secrets::delete_auth_secret(scope_id, AUTH_AWS_SECRET_KEY);
        let _ = secrets::delete_auth_secret(scope_id, AUTH_AWS_SESSION_TOKEN);
        let _ = secrets::delete_auth_secret(scope_id, AUTH_DIGEST_PASSWORD);
        let _ = secrets::delete_auth_secret(scope_id, AUTH_OAUTH1_CONSUMER_SECRET);
        let _ = secrets::delete_auth_secret(scope_id, AUTH_OAUTH1_TOKEN_SECRET);
        let _ = secrets::delete_auth_secret(scope_id, AUTH_JWT_SECRET);
    }
}

fn visit_collection_auths<F: FnMut(&mut Option<AuthConfig>, &str)>(
    collection: &mut CollectionFile,
    f: &mut F,
) {
    let col_id = collection.id.clone();
    f(&mut collection.auth, &col_id);
    for req in &mut collection.requests {
        let req_id = req.id.clone();
        f(&mut req.auth, &req_id);
    }
    for folder in &mut collection.folders {
        visit_folder_auths(folder, f);
    }
}

fn visit_folder_auths<F: FnMut(&mut Option<AuthConfig>, &str)>(
    folder: &mut CollectionFolder,
    f: &mut F,
) {
    let folder_scope = folder.id.clone();
    f(&mut folder.auth, &folder_scope);
    for req in &mut folder.requests {
        let req_id = req.id.clone();
        f(&mut req.auth, &req_id);
    }
    for sub in &mut folder.folders {
        visit_folder_auths(sub, f);
    }
}

fn read_collection_auths<F: FnMut(&Option<AuthConfig>, &str)>(
    collection: &CollectionFile,
    f: &mut F,
) {
    f(&collection.auth, &collection.id);
    for req in &collection.requests {
        f(&req.auth, &req.id);
    }
    for folder in &collection.folders {
        read_folder_auths(folder, f);
    }
}

fn read_folder_auths<F: FnMut(&Option<AuthConfig>, &str)>(
    folder: &CollectionFolder,
    f: &mut F,
) {
    f(&folder.auth, &folder.id);
    for req in &folder.requests {
        f(&req.auth, &req.id);
    }
    for sub in &folder.folders {
        read_folder_auths(sub, f);
    }
}

fn sanitize_environment(env: &mut EnvironmentFile) {
    for var in &mut env.variables {
        if var.is_secret {
            // Mirror sanitize_auth: a non-empty value means "store/update",
            // an empty value means "the user cleared this, drop it from the
            // keychain so hydrate_environment doesn't resurrect it".
            if !var.value.is_empty() {
                let _ = secrets::store_env_secret(&env.id, &var.key, &var.value);
            } else {
                let _ = secrets::delete_env_secret(&env.id, &var.key);
            }
            var.value = String::new();
        }
    }
}

fn hydrate_environment(env: &mut EnvironmentFile) {
    for var in &mut env.variables {
        if var.is_secret && var.value.is_empty() {
            if let Ok(Some(v)) = secrets::get_env_secret(&env.id, &var.key) {
                var.value = v;
            }
        }
    }
}

/// Generic sanitize/hydrate/purge for any scope-bound `Vec<EnvVariable>`
/// (global / collection / folder). Mirrors `sanitize_environment` semantics:
/// a non-empty secret value means "store/update", empty means "drop from
/// keychain so hydrate doesn't resurrect it".
fn sanitize_scope_vars(scope: &str, scope_id: &str, vars: &mut [EnvVariable]) {
    for var in vars.iter_mut() {
        if var.is_secret {
            if !var.value.is_empty() {
                let _ = secrets::store_scope_var_secret(scope, scope_id, &var.key, &var.value);
            } else {
                let _ = secrets::delete_scope_var_secret(scope, scope_id, &var.key);
            }
            var.value = String::new();
        }
    }
}

fn hydrate_scope_vars(scope: &str, scope_id: &str, vars: &mut [EnvVariable]) {
    for var in vars.iter_mut() {
        if var.is_secret && var.value.is_empty() {
            if let Ok(Some(v)) = secrets::get_scope_var_secret(scope, scope_id, &var.key) {
                var.value = v;
            }
        }
    }
}

fn purge_scope_vars(scope: &str, scope_id: &str, vars: &[EnvVariable]) {
    for var in vars.iter() {
        if var.is_secret {
            let _ = secrets::delete_scope_var_secret(scope, scope_id, &var.key);
        }
    }
}

// === Collection CRUD ===

pub fn save_collection(collection: &CollectionFile) -> Result<(), String> {
    let dir = collections_dir()?;
    let file_path = dir.join(format!("{}.json", collection.id));
    let mut to_save = collection.clone();
    visit_collection_auths(&mut to_save, &mut sanitize_auth);
    sanitize_scope_vars("collection", &to_save.id, &mut to_save.variables);
    sanitize_folder_vars(&mut to_save.folders);
    let json = serde_json::to_string_pretty(&to_save)
        .map_err(|e| format!("Failed to serialize collection: {}", e))?;
    fs::write(&file_path, json)
        .map_err(|e| format!("Failed to write collection file: {}", e))?;
    Ok(())
}

fn sanitize_folder_vars(folders: &mut [CollectionFolder]) {
    for folder in folders.iter_mut() {
        sanitize_scope_vars("folder", &folder.id, &mut folder.variables);
        sanitize_folder_vars(&mut folder.folders);
    }
}

fn hydrate_folder_vars(folders: &mut [CollectionFolder]) {
    for folder in folders.iter_mut() {
        hydrate_scope_vars("folder", &folder.id, &mut folder.variables);
        hydrate_folder_vars(&mut folder.folders);
    }
}

fn purge_folder_vars(folders: &[CollectionFolder]) {
    for folder in folders.iter() {
        purge_scope_vars("folder", &folder.id, &folder.variables);
        purge_folder_vars(&folder.folders);
    }
}

pub fn load_collection(id: &str) -> Result<CollectionFile, String> {
    let dir = collections_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read collection file: {}", e))?;
    let mut collection: CollectionFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse collection: {}", e))?;
    visit_collection_auths(&mut collection, &mut hydrate_auth);
    hydrate_scope_vars("collection", &collection.id, &mut collection.variables);
    hydrate_folder_vars(&mut collection.folders);
    Ok(collection)
}

/// List collections, optionally filtered by workspace.
///
/// When `workspace_id` is `Some`, returns only collections whose
/// `workspace_id` matches AND collections with `workspace_id == None`
/// (legacy files predating multi-workspace; they're treated as "unassigned"
/// and shown in every workspace until migration assigns them). Callers should
/// run `migrate_legacy_to_workspace` once at startup to assign them to the
/// default workspace.
///
/// When `workspace_id` is `None`, returns all collections (used by import /
/// admin paths).
pub fn list_collections(workspace_id: Option<&str>) -> Result<Vec<CollectionFile>, String> {
    let dir = collections_dir()?;
    let mut collections = Vec::new();

    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read collections dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            if let Ok(mut collection) = serde_json::from_str::<CollectionFile>(&content) {
                if let Some(ws) = workspace_id {
                    match collection.workspace_id.as_deref() {
                        Some(c_ws) if c_ws == ws => {}
                        None => {} // unassigned legacy — show in every workspace
                        _ => continue,
                    }
                }
                visit_collection_auths(&mut collection, &mut hydrate_auth);
                hydrate_scope_vars("collection", &collection.id, &mut collection.variables);
                hydrate_folder_vars(&mut collection.folders);
                collections.push(collection);
            }
        }
    }

    collections.sort_by_key(|c| std::cmp::Reverse(c.updated_at));
    Ok(collections)
}

pub fn delete_collection(id: &str) -> Result<(), String> {
    let dir = collections_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    // Best-effort: purge any secrets that belonged to this collection before deleting.
    if let Ok(collection) = load_collection(id) {
        read_collection_auths(&collection, &mut purge_auth);
        purge_scope_vars("collection", &collection.id, &collection.variables);
        purge_folder_vars(&collection.folders);
    }
    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete collection: {}", e))?;
    }
    Ok(())
}

// === Environment CRUD ===

pub fn save_environment(env: &EnvironmentFile) -> Result<(), String> {
    let dir = environments_dir()?;
    let file_path = dir.join(format!("{}.json", env.id));
    let mut to_save = env.clone();
    sanitize_environment(&mut to_save);
    let json = serde_json::to_string_pretty(&to_save)
        .map_err(|e| format!("Failed to serialize environment: {}", e))?;
    fs::write(&file_path, json)
        .map_err(|e| format!("Failed to write environment file: {}", e))?;
    Ok(())
}

pub fn load_environment(id: &str) -> Result<EnvironmentFile, String> {
    let dir = environments_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read environment file: {}", e))?;
    let mut env: EnvironmentFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse environment: {}", e))?;
    hydrate_environment(&mut env);
    Ok(env)
}

/// List environments, optionally filtered by workspace. Filtering semantics
/// mirror `list_collections`.
pub fn list_environments(workspace_id: Option<&str>) -> Result<Vec<EnvironmentFile>, String> {
    let dir = environments_dir()?;
    let mut environments = Vec::new();

    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read environments dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            if let Ok(mut env) = serde_json::from_str::<EnvironmentFile>(&content) {
                if let Some(ws) = workspace_id {
                    match env.workspace_id.as_deref() {
                        Some(e_ws) if e_ws == ws => {}
                        None => {}
                        _ => continue,
                    }
                }
                hydrate_environment(&mut env);
                environments.push(env);
            }
        }
    }

    environments.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(environments)
}

pub fn delete_environment(id: &str) -> Result<(), String> {
    let dir = environments_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    // Best-effort: purge any keychain entries belonging to this environment.
    if let Ok(env) = load_environment(id) {
        for var in &env.variables {
            if var.is_secret {
                let _ = secrets::delete_env_secret(&env.id, &var.key);
            }
        }
    }
    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete environment: {}", e))?;
    }
    Ok(())
}

// === Workspace CRUD ===

pub fn save_workspace(workspace: &WorkspaceFile) -> Result<(), String> {
    let dir = workspace_dir()?;
    let file_path = dir.join(format!("{}.json", workspace.id));
    let mut to_save = workspace.clone();
    sanitize_scope_vars("workspace", &to_save.id, &mut to_save.variables);
    let json = serde_json::to_string_pretty(&to_save)
        .map_err(|e| format!("Failed to serialize workspace: {}", e))?;
    fs::write(&file_path, json)
        .map_err(|e| format!("Failed to write workspace file: {}", e))?;
    Ok(())
}

pub fn load_workspace(id: &str) -> Result<WorkspaceFile, String> {
    let dir = workspace_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read workspace file: {}", e))?;
    let mut workspace: WorkspaceFile = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse workspace: {}", e))?;
    hydrate_scope_vars("workspace", &workspace.id, &mut workspace.variables);
    Ok(workspace)
}

pub fn load_default_workspace() -> Result<WorkspaceFile, String> {
    let dir = workspace_dir()?;

    // Try to find existing workspace
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                let content = fs::read_to_string(&path).ok();
                if let Some(content) = content {
                    if let Ok(mut ws) = serde_json::from_str::<WorkspaceFile>(&content) {
                        hydrate_scope_vars("workspace", &ws.id, &mut ws.variables);
                        return Ok(ws);
                    }
                }
            }
        }
    }

    // Create default workspace
    let now = chrono::Utc::now().timestamp_millis();
    let workspace = WorkspaceFile {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Default Workspace".to_string(),
        active_environment_id: None,
        active_collection_id: None,
        active_request_id: None,
        window_state: None,
        variables: Vec::new(),
        created_at: now,
        updated_at: now,
    };
    save_workspace(&workspace)?;
    Ok(workspace)
}

/// List every workspace file on disk, sorted by created_at ascending so the
/// first-created workspace is consistently the "default" in the UI.
pub fn list_workspaces() -> Result<Vec<WorkspaceFile>, String> {
    let dir = workspace_dir()?;
    let mut workspaces = Vec::new();

    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(workspaces),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(ws) = serde_json::from_str::<WorkspaceFile>(&content) {
                workspaces.push(ws);
            }
        }
    }
    workspaces.sort_by_key(|a| a.created_at);
    Ok(workspaces)
}

/// Create a new empty workspace and return it.
pub fn create_workspace(name: &str) -> Result<WorkspaceFile, String> {
    let now = chrono::Utc::now().timestamp_millis();
    let workspace = WorkspaceFile {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        active_environment_id: None,
        active_collection_id: None,
        active_request_id: None,
        window_state: None,
        variables: Vec::new(),
        created_at: now,
        updated_at: now,
    };
    save_workspace(&workspace)?;
    Ok(workspace)
}

/// Delete a workspace and cascade-delete all collections and environments
/// that belong to it. Returns the list of deleted collection IDs and
/// environment IDs so the caller can also drop history rows tied to them.
pub fn delete_workspace(id: &str) -> Result<DeletedWorkspaceArtifacts, String> {
    // Refuse to delete the last workspace — there must always be at least one.
    let all = list_workspaces()?;
    if all.len() <= 1 {
        return Err("Cannot delete the last remaining workspace.".to_string());
    }

    let mut deleted = DeletedWorkspaceArtifacts::default();

    // Cascade collections.
    for col in list_collections(Some(id))? {
        if col.workspace_id.as_deref() == Some(id) {
            delete_collection(&col.id)?;
            deleted.collection_ids.push(col.id);
        }
    }
    // Cascade environments.
    for env in list_environments(Some(id))? {
        if env.workspace_id.as_deref() == Some(id) {
            delete_environment(&env.id)?;
            deleted.environment_ids.push(env.id);
        }
    }

    // Drop any workspace-global secrets from keychain before deleting the file.
    if let Ok(ws) = load_workspace(id) {
        purge_scope_vars("workspace", &ws.id, &ws.variables);
    }

    // Delete the workspace file itself.
    let dir = workspace_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete workspace: {}", e))?;
    }
    Ok(deleted)
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct DeletedWorkspaceArtifacts {
    pub collection_ids: Vec<String>,
    pub environment_ids: Vec<String>,
}

/// One-shot migration: stamp every legacy collection / environment that has
/// `workspace_id == None` with the given workspace id, re-saving the file.
/// Idempotent — re-running is a no-op once everything is stamped.
pub fn migrate_legacy_to_workspace(workspace_id: &str) -> Result<usize, String> {
    let mut migrated = 0usize;

    for mut col in list_collections(None)? {
        if col.workspace_id.is_none() {
            col.workspace_id = Some(workspace_id.to_string());
            save_collection(&col)?;
            migrated += 1;
        }
    }
    for mut env in list_environments(None)? {
        if env.workspace_id.is_none() {
            env.workspace_id = Some(workspace_id.to_string());
            save_environment(&env)?;
            migrated += 1;
        }
    }
    Ok(migrated)
}
