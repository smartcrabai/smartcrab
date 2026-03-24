#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(err) = smartcrab_app::run() {
        eprintln!("SmartCrab failed to start: {err}");
        std::process::exit(1);
    }
}
