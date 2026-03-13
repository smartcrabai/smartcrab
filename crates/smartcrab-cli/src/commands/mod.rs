pub mod new;
pub mod run;
pub mod viz;

use std::io;
use std::path::PathBuf;

/// Walk up from the current directory to find a `SmartCrab` project root.
/// A project root is identified by the presence of a `Cargo.toml` that
/// contains `[package]` (i.e. not just a workspace manifest without members).
pub fn ensure_smartcrab_project() -> io::Result<PathBuf> {
    let mut dir = std::env::current_dir()?;
    loop {
        let cargo_toml = dir.join("Cargo.toml");
        match std::fs::read_to_string(&cargo_toml) {
            Ok(content) => {
                if content.lines().any(|l| l.trim() == "[package]") {
                    return Ok(dir);
                }
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    "Not a SmartCrab project (no Cargo.toml with [package] found)",
                ));
            }
        }
    }
}
