use std::process::{Command, Output};

const SCHEMA: &str = "org.gnome.desktop.interface";
const KEY: &str = "enable-animations";

pub fn availability() -> Result<(), String> {
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    if !desktop.to_ascii_lowercase().contains("gnome") {
        return Err("This verified action currently supports GNOME desktops only.".to_string());
    }
    let output = run(&["get", SCHEMA, KEY])?;
    if output.status.success() {
        Ok(())
    } else {
        Err("The GNOME animation preference is unavailable; gsettings could not read it.".to_string())
    }
}

fn run(args: &[&str]) -> Result<Output, String> {
    Command::new("/usr/bin/gsettings")
        .args(args)
        .output()
        .map_err(|error| format!("Could not run gsettings: {error}"))
}

fn read_value() -> Result<bool, String> {
    let output = run(&["get", SCHEMA, KEY])?;
    if !output.status.success() {
        return Err(format!(
            "Could not read the GNOME animation preference: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    match String::from_utf8_lossy(&output.stdout).trim() {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err("The GNOME animation preference returned an unknown value.".to_string()),
    }
}

pub fn read_reduce_ui_motion() -> Result<Option<String>, String> {
    Ok(Some(read_value()?.to_string()))
}

pub fn set_reduce_ui_motion(enabled: bool) -> Result<(), String> {
    let value = if enabled { "false" } else { "true" };
    let output = run(&["set", SCHEMA, KEY, value])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Could not update the GNOME animation preference: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

pub fn restore_reduce_ui_motion(previous: Option<String>) -> Result<(), String> {
    let value = match previous.as_deref() {
        Some("true") => "true",
        Some("false") => "false",
        _ => return Err("The saved GNOME setting is invalid; rollback was not attempted.".to_string()),
    };
    let output = run(&["set", SCHEMA, KEY, value])?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Could not restore the GNOME animation preference: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}
