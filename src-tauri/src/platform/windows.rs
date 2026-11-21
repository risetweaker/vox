use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
use winreg::RegKey;

const KEY_PATH: &str = "Control Panel\\Desktop\\WindowMetrics";
const VALUE_NAME: &str = "MinAnimate";

pub fn availability() -> Result<(), String> {
    Ok(())
}

pub fn read_reduce_ui_motion() -> Result<Option<String>, String> {
    let key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(KEY_PATH, KEY_READ) {
        Ok(key) => key,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not read the current-user animation setting: {error}")),
    };
    match key.get_value::<String, _>(VALUE_NAME) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not back up the animation setting: {error}")),
    }
}

pub fn set_reduce_ui_motion(enabled: bool) -> Result<(), String> {
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(KEY_PATH)
        .map_err(|error| format!("Could not open the current-user animation setting: {error}"))?;
    let value = if enabled { "0" } else { "1" };
    key.set_value(VALUE_NAME, &value)
        .map_err(|error| format!("Could not update the animation setting: {error}"))
}

pub fn restore_reduce_ui_motion(previous: Option<String>) -> Result<(), String> {
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(KEY_PATH, KEY_WRITE)
        .map_err(|error| format!("Could not open the animation setting for rollback: {error}"))?;
    match previous {
        Some(value) => key
            .set_value(VALUE_NAME, &value)
            .map_err(|error| format!("Could not restore the animation setting: {error}")),
        None => match key.delete_value(VALUE_NAME) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Could not restore the animation default: {error}")),
        },
    }
}
