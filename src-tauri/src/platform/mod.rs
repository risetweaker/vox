#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "windows")]
pub use windows::{apply_action, read_action, restore_action, supports_action};
#[cfg(target_os = "macos")]
pub use macos::{apply_action, read_action, restore_action, supports_action};
#[cfg(target_os = "linux")]
pub use linux::{apply_action, read_action, restore_action, supports_action};

#[cfg(target_os = "windows")]
pub fn availability() -> (&'static str, Result<(), String>) {
    ("Windows", windows::availability())
}

#[cfg(target_os = "macos")]
pub fn availability() -> (&'static str, Result<(), String>) {
    ("macOS", macos::availability())
}

#[cfg(target_os = "linux")]
pub fn availability() -> (&'static str, Result<(), String>) {
    ("Linux", linux::availability())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn availability() -> (&'static str, Result<(), String>) {
    ("Unknown", Err("This operating system is not supported.".to_string()))
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn supports_action(_: &str) -> bool {
    false
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn read_action(_: &str) -> Result<serde_json::Value, String> {
    Err("This operating system is not supported.".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn apply_action(_: &str) -> Result<(), String> {
    Err("This operating system is not supported.".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn restore_action(_: &str, _: serde_json::Value) -> Result<(), String> {
    Err("This operating system is not supported.".to_string())
}
