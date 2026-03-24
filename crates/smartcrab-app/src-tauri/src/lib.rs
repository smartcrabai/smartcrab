pub mod engine;
pub mod error;

pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .ok();
}
