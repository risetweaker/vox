use serde_json::Value;
use std::process::{Command, Output};

const DOMAIN: &str = "com.apple.universalaccess";
const KEY: &str = "reduceMotion";

pub fn availability() -> Result<(), String> {
    Ok(())
}

pub fn supports_action(action_id: &str) -> bool {
    action_id == "reduce-ui-motion"
}

fn run(args: &[&str]) -> Result<Output, String> {
    Command::new("/usr/bin/defaults")
        .args(args)
        .output()
        .map_err(|error| format!("Could not run the macOS preferences utility: {error}"))
}

pub fn read_reduce_ui_motion() -> Result<Option<String>, String> {
    let output = run(&["read", DOMAIN, KEY])?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("does not exist") || stderr.contains("doesn't exist") {
            return Ok(None);
        }
        return Err(format!("Could not read the macOS reduced-motion preference: {stderr}"));
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_lowercase();
    match value.as_str() {
        "1" | "true" | "yes" => Ok(Some("true".to_string())),
        "0" | "false" | "no" => Ok(Some("false".to_string())),
        _ => Err("The saved macOS reduced-motion value was not recognized.".to_string()),
    }
}

pub fn set_reduce_ui_motion(enabled: bool) -> Result<(), String> {
    let value = if enabled { "true" } else { "false" };
    let output = run(&["write", DOMAIN, KEY, "-bool", value])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Could not update the macOS reduced-motion preference: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

pub fn restore_reduce_ui_motion(previous: Option<String>) -> Result<(), String> {
    match previous {
        Some(value) if value == "true" || value == "false" => set_reduce_ui_motion(value == "true"),
        Some(_) => Err("The saved macOS setting is invalid; rollback was not attempted.".to_string()),
        None => {
            let output = run(&["delete", DOMAIN, KEY])?;
            if output.status.success()
                || String::from_utf8_lossy(&output.stderr).contains("does not exist")
            {
                Ok(())
            } else {
                Err(format!(
                    "Could not restore the macOS default preference: {}",
                    String::from_utf8_lossy(&output.stderr)
                ))
            }
        }
    }
}

pub fn read_action(action_id: &str) -> Result<Value, String> {
    if !supports_action(action_id) {
        return Err("This action is not supported on macOS.".to_string());
    }
    serde_json::to_value(read_reduce_ui_motion()?).map_err(|error| error.to_string())
}

pub fn apply_action(action_id: &str) -> Result<(), String> {
    if !supports_action(action_id) {
        return Err("This action is not supported on macOS.".to_string());
    }
    set_reduce_ui_motion(true)
}

pub fn restore_action(action_id: &str, previous: Value) -> Result<(), String> {
    if !supports_action(action_id) {
        return Err("This action is not supported on macOS.".to_string());
    }
    let previous = serde_json::from_value(previous)
        .map_err(|error| format!("The saved macOS rollback record is invalid: {error}"))?;
    restore_reduce_ui_motion(previous)
}
