use serde_json::Value;
use std::io::ErrorKind;
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
use winreg::RegKey;

const MOTION_KEY: &str = "Control Panel\\Desktop\\WindowMetrics";
const MOTION_VALUE: &str = "MinAnimate";
const PERSONALIZE_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
const EXPLORER_ADVANCED_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";
const BINARY_VALUES: &[u32] = &[0, 1];
const HIDDEN_FILE_VALUES: &[u32] = &[1, 2];
const EXPLORER_START_VALUES: &[u32] = &[1, 2];

#[derive(Clone, Copy)]
struct DwordSetting {
    key: &'static str,
    name: &'static str,
    target: u32,
    allowed_previous: &'static [u32],
}

const TRANSPARENCY: &[DwordSetting] = &[DwordSetting {
    key: PERSONALIZE_KEY,
    name: "EnableTransparency",
    target: 0,
    allowed_previous: BINARY_VALUES,
}];
const DARK_MODE: &[DwordSetting] = &[
    DwordSetting {
        key: PERSONALIZE_KEY,
        name: "AppsUseLightTheme",
        target: 0,
        allowed_previous: BINARY_VALUES,
    },
    DwordSetting {
        key: PERSONALIZE_KEY,
        name: "SystemUsesLightTheme",
        target: 0,
        allowed_previous: BINARY_VALUES,
    },
];
const FILE_EXTENSIONS: &[DwordSetting] = &[DwordSetting {
    key: EXPLORER_ADVANCED_KEY,
    name: "HideFileExt",
    target: 0,
    allowed_previous: BINARY_VALUES,
}];
const HIDDEN_FILES: &[DwordSetting] = &[DwordSetting {
    key: EXPLORER_ADVANCED_KEY,
    name: "Hidden",
    target: 1,
    allowed_previous: HIDDEN_FILE_VALUES,
}];
const EXPLORER_THIS_PC: &[DwordSetting] = &[DwordSetting {
    key: EXPLORER_ADVANCED_KEY,
    name: "LaunchTo",
    target: 1,
    allowed_previous: EXPLORER_START_VALUES,
}];
const QUICK_ACCESS_RECENT: &[DwordSetting] = &[DwordSetting {
    key: EXPLORER_ADVANCED_KEY,
    name: "ShowRecent",
    target: 0,
    allowed_previous: BINARY_VALUES,
}];
const QUICK_ACCESS_FREQUENT: &[DwordSetting] = &[DwordSetting {
    key: EXPLORER_ADVANCED_KEY,
    name: "ShowFrequent",
    target: 0,
    allowed_previous: BINARY_VALUES,
}];

pub fn availability() -> Result<(), String> {
    Ok(())
}

fn dword_settings(action_id: &str) -> Option<&'static [DwordSetting]> {
    match action_id {
        "disable-transparency" => Some(TRANSPARENCY),
        "enable-dark-mode" => Some(DARK_MODE),
        "show-file-extensions" => Some(FILE_EXTENSIONS),
        "show-hidden-files" => Some(HIDDEN_FILES),
        "explorer-this-pc" => Some(EXPLORER_THIS_PC),
        "disable-quick-access-recent" => Some(QUICK_ACCESS_RECENT),
        "disable-quick-access-frequent" => Some(QUICK_ACCESS_FREQUENT),
        _ => None,
    }
}

pub fn supports_action(action_id: &str) -> bool {
    action_id == "reduce-ui-motion" || dword_settings(action_id).is_some()
}

fn read_reduce_ui_motion() -> Result<Option<String>, String> {
    let key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(MOTION_KEY, KEY_READ) {
        Ok(key) => key,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read the current-user animation setting: {error}")),
    };
    match key.get_value::<String, _>(MOTION_VALUE) {
        Ok(value) if value == "0" || value == "1" => Ok(Some(value)),
        Ok(_) => Err("The current-user animation setting has an unknown value.".to_string()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not back up the animation setting: {error}")),
    }
}

fn set_reduce_ui_motion(enabled: bool) -> Result<(), String> {
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(MOTION_KEY)
        .map_err(|error| format!("Could not open the current-user animation setting: {error}"))?;
    let value = if enabled { "0" } else { "1" };
    key.set_value(MOTION_VALUE, &value)
        .map_err(|error| format!("Could not update the animation setting: {error}"))
}

fn restore_reduce_ui_motion(previous: Option<String>) -> Result<(), String> {
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(MOTION_KEY, KEY_WRITE)
        .map_err(|error| format!("Could not open the animation setting for rollback: {error}"))?;
    match previous {
        Some(value) if value == "0" || value == "1" => key
            .set_value(MOTION_VALUE, &value)
            .map_err(|error| format!("Could not restore the animation setting: {error}")),
        Some(_) => Err("The saved animation setting is invalid; rollback was not attempted.".to_string()),
        None => match key.delete_value(MOTION_VALUE) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Could not restore the animation default: {error}")),
        },
    }
}

fn read_dword(spec: DwordSetting) -> Result<Option<u32>, String> {
    let key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(spec.key, KEY_READ) {
        Ok(key) => key,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read {}: {error}", spec.name)),
    };
    match key.get_value::<u32, _>(spec.name) {
        Ok(value) if spec.allowed_previous.contains(&value) => Ok(Some(value)),
        Ok(_) => Err(format!("The saved value for {} is outside the expected range.", spec.name)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not back up {}: {error}", spec.name)),
    }
}

fn read_dword_settings(settings: &[DwordSetting]) -> Result<Value, String> {
    let previous = settings
        .iter()
        .copied()
        .map(read_dword)
        .collect::<Result<Vec<_>, _>>()?;
    serde_json::to_value(previous).map_err(|error| error.to_string())
}

fn apply_dword_settings(settings: &[DwordSetting]) -> Result<(), String> {
    for spec in settings {
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(spec.key)
            .map_err(|error| format!("Could not open the current-user setting {}: {error}", spec.name))?;
        key.set_value(spec.name, &spec.target)
            .map_err(|error| format!("Could not update {}: {error}", spec.name))?;
    }
    Ok(())
}

fn restore_dword_settings(settings: &[DwordSetting], previous: Value) -> Result<(), String> {
    let previous: Vec<Option<u32>> = serde_json::from_value(previous)
        .map_err(|error| format!("The saved Explorer rollback record is invalid: {error}"))?;
    if previous.len() != settings.len()
        || previous.iter().zip(settings).any(|(value, spec)| {
            value.is_some_and(|number| !spec.allowed_previous.contains(&number))
        })
    {
        return Err("The saved Windows rollback values are invalid; rollback was not attempted.".to_string());
    }

    for (spec, value) in settings.iter().zip(previous) {
        match value {
            Some(number) => {
                let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
                    .create_subkey(spec.key)
                    .map_err(|error| format!("Could not open {} for rollback: {error}", spec.name))?;
                key.set_value(spec.name, &number)
                    .map_err(|error| format!("Could not restore {}: {error}", spec.name))?;
            }
            None => match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(spec.key, KEY_WRITE) {
                Ok(key) => match key.delete_value(spec.name) {
                    Ok(()) => {}
                    Err(error) if error.kind() == ErrorKind::NotFound => {}
                    Err(error) => return Err(format!("Could not restore the default for {}: {error}", spec.name)),
                },
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => return Err(format!("Could not open {} for rollback: {error}", spec.name)),
            },
        }
    }
    Ok(())
}

pub fn read_action(action_id: &str) -> Result<Value, String> {
    if action_id == "reduce-ui-motion" {
        return serde_json::to_value(read_reduce_ui_motion()?).map_err(|error| error.to_string());
    }
    let settings = dword_settings(action_id)
        .ok_or_else(|| "This action is not on VOX's Windows allowlist.".to_string())?;
    read_dword_settings(settings)
}

pub fn apply_action(action_id: &str) -> Result<(), String> {
    if action_id == "reduce-ui-motion" {
        return set_reduce_ui_motion(true);
    }
    let settings = dword_settings(action_id)
        .ok_or_else(|| "This action is not on VOX's Windows allowlist.".to_string())?;
    apply_dword_settings(settings)
}

pub fn restore_action(action_id: &str, previous: Value) -> Result<(), String> {
    if action_id == "reduce-ui-motion" {
        let previous = serde_json::from_value(previous)
            .map_err(|error| format!("The saved animation rollback record is invalid: {error}"))?;
        return restore_reduce_ui_motion(previous);
    }
    let settings = dword_settings(action_id)
        .ok_or_else(|| "This action is not on VOX's Windows allowlist.".to_string())?;
    restore_dword_settings(settings, previous)
}
