#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod platform;

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

const ACTION_ID: &str = "reduce-ui-motion";

#[derive(Default)]
struct ActionLock(Mutex<()>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    platform: &'static str,
    action_supported: bool,
    action_unavailable_reason: Option<String>,
    action_applied: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionOutcome {
    action_id: &'static str,
    applied: bool,
    message: String,
}

#[derive(Serialize, Deserialize)]
struct Backup {
    action_id: String,
    previous_value: Option<String>,
}

fn backup_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("reduce-ui-motion-backup.json"))
}

fn read_backup(path: &PathBuf) -> Result<Backup, String> {
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let backup: Backup = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    if backup.action_id != ACTION_ID {
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
    let path = backup_path(&app)?;
    let action_applied = path.exists();
    let (platform, support) = platform::availability();
    Ok(RuntimeInfo {
        platform,
        action_supported: support.is_ok(),
        action_unavailable_reason: support.err(),
        action_applied,
    })
}

#[tauri::command]
fn apply_action(
    app: tauri::AppHandle,
    state: tauri::State<'_, ActionLock>,
    action_id: String,
) -> Result<ActionOutcome, String> {
    if action_id != ACTION_ID {
        return Err("This action is not on VOX's verified allowlist.".to_string());
    }
    let _guard = state.0.lock().map_err(|_| "Action lock is unavailable.".to_string())?;
    let path = backup_path(&app)?;
    if path.exists() {
        return Err("This action is already applied; undo it before applying again.".to_string());
    }

    let previous_value = platform::read_reduce_ui_motion()?;
    let backup = Backup {
        action_id: ACTION_ID.to_string(),
        previous_value,
    };
    write_backup(&path, &backup)?;
    if let Err(error) = platform::set_reduce_ui_motion(true) {
        return Err(format!(
            "{error}. The rollback record was retained; use Undo to restore the previous preference."
        ));
    }

    Ok(ActionOutcome {
        action_id: ACTION_ID,
        applied: true,
        message: "Reduced-motion preference enabled for this user.".to_string(),
    })
}

#[tauri::command]
fn undo_action(
    app: tauri::AppHandle,
    state: tauri::State<'_, ActionLock>,
    action_id: String,
) -> Result<ActionOutcome, String> {
    if action_id != ACTION_ID {
        return Err("This action is not on VOX's verified allowlist.".to_string());
    }
    let _guard = state.0.lock().map_err(|_| "Action lock is unavailable.".to_string())?;
    let path = backup_path(&app)?;
    let backup = read_backup(&path)?;
    platform::restore_reduce_ui_motion(backup.previous_value)?;
    fs::remove_file(&path).map_err(|error| error.to_string())?;
    Ok(ActionOutcome {
        action_id: ACTION_ID,
        applied: false,
        message: "The previous reduced-motion preference was restored.".to_string(),
    })
}

fn main() {
    tauri::Builder::default()
        .manage(ActionLock::default())
        .invoke_handler(tauri::generate_handler![runtime_info, apply_action, undo_action])
        .run(tauri::generate_context!())
        .expect("error while running VOX");
}
