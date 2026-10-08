// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(windows)]
    configure_bundled_webview2();
    douyin_review_scraper_lib::run()
}

#[cfg(windows)]
fn configure_bundled_webview2() {
    use std::path::PathBuf;
    use std::process::Command;

    let Some(runtime) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("runtime/webview2")))
    else {
        return;
    };
    if !runtime.join("msedgewebview2.exe").is_file() {
        return;
    }

    let marker: PathBuf = runtime.join(".app-container-access-ready");
    if !marker.is_file() {
        let grants = ["*S-1-15-2-2:(OI)(CI)(RX)", "*S-1-15-2-1:(OI)(CI)(RX)"];
        let granted = grants.iter().all(|grant| {
            Command::new("icacls")
                .arg(&runtime)
                .arg("/grant")
                .arg(grant)
                .arg("/T")
                .arg("/C")
                .output()
                .is_ok_and(|output| output.status.success())
        });
        if granted {
            let _ = std::fs::write(marker, b"WebView2 App Container read access configured\n");
        }
    }
    std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", runtime);
}
