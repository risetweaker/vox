#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "windows")]
pub use windows::{read_reduce_ui_motion, restore_reduce_ui_motion, set_reduce_ui_motion};
#[cfg(target_os = "macos")]
pub use macos::{read_reduce_ui_motion, restore_reduce_ui_motion, set_reduce_ui_motion};
#[cfg(target_os = "linux")]
pub use linux::{read_reduce_ui_motion, restore_reduce_ui_motion, set_reduce_ui_motion};

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
pub fn read_reduce_ui_motion() -> Result<Option<String>, String> {
    Err("This operating system is not supported.".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn set_reduce_ui_motion(_: bool) -> Result<(), String> {
    Err("This operating system is not supported.".to_string())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn restore_reduce_ui_motion(_: Option<String>) -> Result<(), String> {
    Err("This operating system is not supported.".to_string())
}
