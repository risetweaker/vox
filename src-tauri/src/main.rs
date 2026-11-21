#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod platform;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

const ACTION_IDS: &[&str] = &[
    "reduce-ui-motion",
    "disable-transparency",
    "enable-dark-mode",
    "show-file-extensions",
    "show-hidden-files",
    "explorer-this-pc",
    "disable-quick-access-recent",
    "disable-quick-access-frequent",
];

#[derive(Default)]
struct ActionLock(Mutex<()>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    platform: &'static str,
    action_supported: bool,
    action_unavailable_reason: Option<String>,
    action_applied: bool,
    applied_actions: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionOutcome {
    action_id: String,
    applied: bool,
    message: String,
}

#[derive(Serialize, Deserialize)]
struct Backup {
    action_id: String,
    previous_value: serde_json::Value,
}

fn backup_file_name(action_id: &str) -> Option<&'static str> {
    match action_id {
        "reduce-ui-motion" => Some("reduce-ui-motion-backup.json"),
        "disable-transparency" => Some("disable-transparency-backup.json"),
        "enable-dark-mode" => Some("enable-dark-mode-backup.json"),
        "show-file-extensions" => Some("show-file-extensions-backup.json"),
        "show-hidden-files" => Some("show-hidden-files-backup.json"),
        "explorer-this-pc" => Some("explorer-this-pc-backup.json"),
        "disable-quick-access-recent" => Some("disable-quick-access-recent-backup.json"),
        "disable-quick-access-frequent" => Some("disable-quick-access-frequent-backup.json"),
        _ => None,
    }
}

fn backup_path(app: &tauri::AppHandle, action_id: &str) -> Result<PathBuf, String> {
    let file_name = backup_file_name(action_id)
        .ok_or_else(|| "This action is not on VOX's allowlist.".to_string())?;
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(file_name))
}

fn read_backup(path: &PathBuf, action_id: &str) -> Result<Backup, String> {
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let backup: Backup = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    if backup.action_id != action_id {
        return Err("The saved rollback record is not recognized.".to_string());
    }
    Ok(backup)
}

fn write_backup(path: &PathBuf, backup: &Backup) -> Result<(), String> {
    let temporary = path.with_extension("json.tmp");
    let content = serde_json::to_vec(backup).map_err(|error| error.to_string())?;
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

#[tauri::command]
fn runtime_info(app: tauri::AppHandle) -> Result<RuntimeInfo, String> {
    let mut applied_actions = Vec::new();
    for action_id in ACTION_IDS {
        if backup_path(&app, action_id)?.exists() {
            applied_actions.push((*action_id).to_string());
        }
    }
    let (platform, support) = platform::availability();
    Ok(RuntimeInfo {
        platform,
        action_supported: support.is_ok(),
        action_unavailable_reason: support.err(),
        action_applied: applied_actions.iter().any(|id| id == "reduce-ui-motion"),
        applied_actions,
    })
}

#[tauri::command]
fn apply_action(
    app: tauri::AppHandle,
    state: tauri::State<'_, ActionLock>,
    action_id: String,
) -> Result<ActionOutcome, String> {
    if backup_file_name(&action_id).is_none() || !platform::supports_action(&action_id) {
        return Err("This action is not supported on this platform.".to_string());
    }
    let _guard = state.0.lock().map_err(|_| "Action lock is unavailable.".to_string())?;
    let path = backup_path(&app, &action_id)?;
    if path.exists() {
        return Err("This action is already applied; undo it before applying again.".to_string());
    }

    let previous_value = platform::read_action(&action_id)?;
    let backup = Backup {
        action_id: action_id.clone(),
        previous_value,
    };
    write_backup(&path, &backup)?;
    if let Err(error) = platform::apply_action(&action_id) {
        return Err(format!(
            "{error}. The rollback record was retained; use Undo to restore the previous preference."
        ));
    }

    Ok(ActionOutcome {
        action_id,
        applied: true,
        message: "The current-user preference was updated; a rollback record was saved.".to_string(),
    })
}

#[tauri::command]
fn undo_action(
    app: tauri::AppHandle,
    state: tauri::State<'_, ActionLock>,
    action_id: String,
) -> Result<ActionOutcome, String> {
    if backup_file_name(&action_id).is_none() || !platform::supports_action(&action_id) {
        return Err("This action is not supported on this platform.".to_string());
    }
    let _guard = state.0.lock().map_err(|_| "Action lock is unavailable.".to_string())?;
    let path = backup_path(&app, &action_id)?;
    let backup = read_backup(&path, &action_id)?;
    platform::restore_action(&action_id, backup.previous_value)?;
    fs::remove_file(&path).map_err(|error| error.to_string())?;
    Ok(ActionOutcome {
        action_id,
        applied: false,
        message: "The previous current-user preference was restored.".to_string(),
    })
}

fn main() {
    tauri::Builder::default()
        .manage(ActionLock::default())
        .invoke_handler(tauri::generate_handler![runtime_info, apply_action, undo_action])
        .run(tauri::generate_context!())
        .expect("error while running VOX");
}
