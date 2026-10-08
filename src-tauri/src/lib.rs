use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CollectionResult {
    stats: Value,
    report: Value,
    output_dir: String,
}

fn report_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?
        .join("reports"))
}

fn bundled_resource_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(resources) = app.path().resource_dir() {
        if resources.join("scripts/phase1-probe.mjs").is_file() {
            return Some(resources);
        }
    }
    std::env::current_exe()
        .ok()?
        .parent()
        .map(Path::to_path_buf)
}

fn script_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let development = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("无法定位项目目录")?
        .join("scripts")
        .join("phase1-probe.mjs");
    if cfg!(debug_assertions) && development.is_file() {
        return Ok(development);
    }
    if let Some(resources) = bundled_resource_dir(app) {
        let bundled = resources.join("scripts").join("phase1-probe.mjs");
        if bundled.is_file() {
            return Ok(bundled);
        }
    }
    if development.is_file() {
        Ok(development)
    } else {
        Err("找不到评论采集脚本，请检查应用安装文件。".into())
    }
}

fn collector_command(app: &tauri::AppHandle) -> Command {
    let resources = bundled_resource_dir(app);
    let bundled_node = resources.as_ref().map(|dir| dir.join("runtime/node.exe"));
    let mut command = match bundled_node.filter(|path| path.is_file()) {
        Some(path) => Command::new(path),
        None => Command::new("node"),
    };
    if let Some(browser_dir) = resources.map(|dir| dir.join("runtime/browsers")) {
        if browser_dir.is_dir() {
            command.env("PLAYWRIGHT_BROWSERS_PATH", browser_dir);
            command.env("DOUYIN_BUNDLED_CHROMIUM", "1");
        }
    }
    command
}

fn read_result(output_dir: &Path) -> Result<CollectionResult, String> {
    let stats = fs::read_to_string(output_dir.join("number-stats.json"))
        .map_err(|error| format!("读取号码统计失败：{error}"))?;
    let report = fs::read_to_string(output_dir.join("last-report.json"))
        .map_err(|error| format!("读取采集记录失败：{error}"))?;
    Ok(CollectionResult {
        stats: serde_json::from_str(&stats).map_err(|error| format!("号码统计格式错误：{error}"))?,
        report: serde_json::from_str(&report).map_err(|error| format!("采集记录格式错误：{error}"))?,
        output_dir: output_dir.to_string_lossy().into_owned(),
    })
}

fn add_filter_args(
    process: &mut Command,
    from_time: &Option<String>,
    to_time: &Option<String>,
    min_occurrences: u32,
) {
    if let Some(from) = from_time {
        process.arg("--from").arg(from);
    }
    if let Some(to) = to_time {
        process.arg("--to").arg(to);
    }
    process.arg("--min-occurrences").arg(min_occurrences.to_string());
}

#[tauri::command]
fn load_last_result(app: tauri::AppHandle) -> Result<Option<CollectionResult>, String> {
    let output_dir = report_dir(&app)?;
    if output_dir.join("number-stats.json").is_file() {
        return read_result(&output_dir).map(Some);
    }
    let development = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("无法定位项目目录")?
        .join(".phase1");
    if development.join("number-stats.json").is_file() {
        return read_result(&development).map(Some);
    }
    Ok(None)
}

#[tauri::command]
async fn collect_comments(
    app: tauri::AppHandle,
    share_text: String,
    from_time: Option<String>,
    to_time: Option<String>,
    min_occurrences: u32,
) -> Result<CollectionResult, String> {
    if share_text.trim().is_empty() {
        return Err("请粘贴抖音视频分享文案或链接。".into());
    }
    if share_text.len() > 10_000 {
        return Err("分享文案过长，请只粘贴一个视频的分享内容。".into());
    }
    if min_occurrences < 2 {
        return Err("最小出现次数不能低于 2。".into());
    }
    let script = script_path(&app)?;
    let node = collector_command(&app);
    let output_dir = report_dir(&app)?;
    let staging_dir = output_dir.with_file_name("reports-pending");
    fs::create_dir_all(&staging_dir).map_err(|error| format!("创建临时报告目录失败：{error}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut process = node;
        process
            .arg(script)
            .arg("--stats")
            .arg("--headless")
            .arg("--until-end")
            .arg("--output-dir")
            .arg(&staging_dir);
        add_filter_args(&mut process, &from_time, &to_time, min_occurrences);
        let output = process
            .arg(share_text)
            .output()
            .map_err(|error| format!("无法启动 Node.js：{error}。请确认已安装 Node.js 并加入 PATH。"))?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(format!("采集失败：{}", error.trim()));
        }
        let result = read_result(&staging_dir)?;
        if result.report["loginPromptVisible"] == true {
            return Err("当前登录状态已失效，请重新扫码登录后再采集。".into());
        }
        fs::create_dir_all(&output_dir).map_err(|error| format!("创建报告目录失败：{error}"))?;
        for name in [
            "captured-comments.json",
            "last-report.json",
            "number-stats.json",
            "number-stats.txt",
            "number-stats.csv",
            "matched-comments.json",
        ] {
            fs::copy(staging_dir.join(name), output_dir.join(name))
                .map_err(|error| format!("保存报告 {name} 失败：{error}"))?;
        }
        read_result(&output_dir)
    })
    .await
    .map_err(|error| format!("采集任务中断：{error}"))?
}

#[tauri::command]
async fn filter_saved_comments(
    app: tauri::AppHandle,
    from_time: Option<String>,
    to_time: Option<String>,
    min_occurrences: u32,
) -> Result<CollectionResult, String> {
    if min_occurrences < 2 {
        return Err("最小出现次数不能低于 2。".into());
    }
    let mut output_dir = report_dir(&app)?;
    if !output_dir.join("captured-comments.json").is_file() {
        output_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("无法定位项目目录")?
            .join(".phase1");
    }
    if !output_dir.join("captured-comments.json").is_file() {
        return Err("没有已保存的评论，请先采集视频。".into());
    }
    let script = script_path(&app)?.with_file_name("reprocess-numbers.mjs");
    let node = collector_command(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let mut process = node;
        process.arg(script).arg("--output-dir").arg(&output_dir);
        add_filter_args(&mut process, &from_time, &to_time, min_occurrences);
        let output = process
            .output()
            .map_err(|error| format!("无法启动 Node.js：{error}"))?;
        if !output.status.success() {
            return Err(format!("筛选失败：{}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        read_result(&output_dir)
    })
    .await
    .map_err(|error| format!("筛选任务中断：{error}"))?
}

#[tauri::command]
async fn login_to_douyin(app: tauri::AppHandle, share_text: String) -> Result<(), String> {
    if share_text.trim().is_empty() {
        return Err("请先粘贴抖音视频的分享文案或链接，再打开扫码窗口。".into());
    }
    let script = script_path(&app)?;
    let mut node = collector_command(&app);
    let output_dir = report_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let output = node
            .arg(script)
            .arg("--gui-login")
            .arg("--output-dir")
            .arg(&output_dir)
            .arg(share_text)
            .output()
            .map_err(|error| format!("无法启动 Node.js：{error}"))?;
        if !output.status.success() {
            return Err(format!("登录未完成：{}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        let report = fs::read_to_string(output_dir.join("login-report.json"))
            .map_err(|error| format!("读取登录状态失败：{error}"))?;
        let report: Value = serde_json::from_str(&report)
            .map_err(|error| format!("登录状态格式错误：{error}"))?;
        if report["loginPromptVisible"] == true {
            return Err("页面仍显示登录提示，请再次扫码。".into());
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("登录任务中断：{error}"))?
}

#[tauri::command]
fn open_report_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    let allowed = report_dir(&app)?;
    let development = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("无法定位项目目录")?
        .join(".phase1");
    if target != allowed && target != development {
        return Err("只能打开本应用的报告目录。".into());
    }
    if !target.is_dir() || !target.join("number-stats.json").is_file() {
        return Err("报告目录不存在，请先完成一次采集。".into());
    }
    #[cfg(target_os = "windows")]
    let command = "explorer";
    #[cfg(target_os = "macos")]
    let command = "open";
    #[cfg(target_os = "linux")]
    let command = "xdg-open";
    Command::new(command)
        .arg(target)
        .spawn()
        .map_err(|error| format!("打开报告目录失败：{error}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_last_result,
            collect_comments,
            filter_saved_comments,
            login_to_douyin,
            open_report_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
