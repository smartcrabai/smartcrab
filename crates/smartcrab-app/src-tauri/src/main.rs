#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    smartcrab_app::run().unwrap_or_else(|e| {
        eprintln!("Fatal error: {e}");
        std::process::exit(1);
    });
}
