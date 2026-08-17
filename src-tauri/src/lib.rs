//! dsh-desktop — Tauri shell for DeepSeek Harness.
//!
//! Shell/kernel separation:
//! - The **shell** is this Tauri app (Rust + a small control UI). It rarely updates.
//! - The **kernel** is `@deepseek-ai/dsh` + a portable Node runtime living in the
//!   app-data directory (`kernel/`, `runtime/`), installed and upgraded via the
//!   `scripts/fetch-dsh.mjs` npm install (atomic swap). User profiles and plugins
//!   stay under `DSH_HOME` inside the same data dir and are never touched by
//!   kernel upgrades.
//!
//! Lifecycle: on launch the shell spawns
//! `node <kernel>/node_modules/@deepseek-ai/dsh/lib/bin.js web --port 0`,
//! parses the `dsh web: http://127.0.0.1:<port>` line from stdout, then opens a
//! native WebView window pointing at that URL. Closing the windows or quitting
//! from the tray kills the kernel process tree.

use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// Windows: run a spawned process without popping up a console window
/// (CREATE_NO_WINDOW). Without this, every `node`/`npm` spawn flashes a
/// black cmd box — the opposite of a native desktop app.
fn no_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd;
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

struct KernelState(Mutex<KernelInner>);

#[derive(Default)]
struct KernelInner {
    child: Option<Child>,
    url: Option<String>,
}

impl Default for KernelState {
    fn default() -> Self {
        Self(Mutex::new(KernelInner::default()))
    }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/// node executable: bundled portable runtime first, then PATH fallback.
/// The portable runtime is packaged into `resource_dir/runtime` (see
/// `scripts/fetch-node.mjs` + tauri.conf.json resources). In dev it may also
/// live under `app_data_dir/runtime` if the developer fetched it manually.
fn node_bin(app: &AppHandle) -> PathBuf {
    let exe = if cfg!(windows) { "node.exe" } else { "bin/node" };
    let candidates = [
        app.path()
            .resource_dir()
            .map(|r| r.join("runtime").join(exe))
            .unwrap_or_default(),
        app.path()
            .app_data_dir()
            .map(|d| d.join("runtime").join(exe))
            .unwrap_or_default(),
    ];
    for c in candidates {
        if c.exists() {
            return c;
        }
    }
    // dev fallback: resolve `node` from PATH so `.exists()` checks below work
    std::env::var_os("PATH")
        .and_then(|paths| {
            std::env::split_paths(&paths)
                .map(|p| p.join(if cfg!(windows) { "node.exe" } else { "node" }))
                .find(|p| p.exists())
        })
        .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" }))
}

/// Path to the dsh kernel entry script inside the app-data kernel dir.
fn kernel_entry(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|d| {
            d.join("kernel")
                .join("node_modules/@deepseek-ai/dsh/lib/bin.js")
        })
        .unwrap_or_default()
}

fn kernel_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|d| d.join("kernel"))
        .unwrap_or_default()
}

fn dsh_home(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|d| d.join("dsh-home"))
        .unwrap_or_default()
}

/// scripts dir: bundled resources in production, repo `scripts/` in dev.
fn scripts_dir(app: &AppHandle) -> PathBuf {
    let bundled = app
        .path()
        .resource_dir()
        .map(|r| r.join("scripts"))
        .unwrap_or_default();
    if bundled.join("fetch-dsh.mjs").exists() {
        bundled
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts")
    }
}

fn installed_version(app: &AppHandle) -> Option<String> {
    let vf = kernel_dir(app).join(".dsh-kernel-version");
    std::fs::read_to_string(vf).ok().map(|s| s.trim().to_string())
}

// ---------------------------------------------------------------------------
// Kernel process management
// ---------------------------------------------------------------------------

/// Kill a process tree. On Windows use taskkill /T so children (bash, tools)
/// die too; elsewhere kill the process group.
fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        if let Some(pid) = child.try_wait().ok().flatten() {
            let _ = pid; // already exited
            return;
        }
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .status();
        let _ = child.kill();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

fn stop_kernel(state: &KernelState) {
    if let Some(mut child) = state.0.lock().unwrap().child.take() {
        kill_tree(&mut child);
    }
    state.0.lock().unwrap().url = None;
}

/// Spawn the dsh kernel and return immediately. The URL is emitted on the
/// `kernel-url` event once the server announces it on stdout.
fn start_kernel(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<KernelState>();
    {
        let guard = state.0.lock().unwrap();
        if guard.child.is_some() {
            return Ok(()); // already running
        }
    }

    let node = node_bin(app);
    let entry = kernel_entry(app);
    if !entry.exists() {
        return Err("kernel not installed — run install/update first".to_string());
    }
    if !node.exists() {
        return Err(format!("node runtime missing at {}", node.display()));
    }
    std::fs::create_dir_all(dsh_home(app)).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&node);
    cmd.arg(&entry)
        .arg("web")
        .arg("--port")
        .arg("0") // let the OS pick a free port
        .env("DSH_HOME", dsh_home(app))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_console(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn dsh: {e}"))?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    *state.0.lock().unwrap() = KernelInner {
        child: Some(child),
        url: None,
    };

    // Reader thread: watch stdout for the "dsh web: http://…" line.
    let app2 = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            if let Some(rest) = line.split("dsh web: ").nth(1) {
                let url = rest.split_whitespace().next().unwrap_or("").to_string();
                if !url.is_empty() {
                    {
                        let st = app2.state::<KernelState>();
                        st.0.lock().unwrap().url = Some(url.clone());
                    }
                    let _ = app2.emit("kernel-url", url.clone());
                    let _ = app2.emit("kernel-status", "ready");
                    // Navigate the main window straight to the harness.
                    if let Some(win) = app2.get_webview_window("main") {
                        if let Ok(parsed) = url.parse::<tauri::Url>() {
                            let _ = win.navigate(parsed);
                        }
                    }
                    return;
                }
            }
            let _ = app2.emit("kernel-log", format!("[dsh] {line}"));
        }
        // stdout closed without a URL: kernel exited
        let _ = app2.emit("kernel-status", "exited");
    });

    // Stderr thread: forward logs.
    let app3 = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let _ = app3.emit("kernel-log", format!("[dsh] {line}"));
        }
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Commands exposed to the control UI
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusInfo {
    kernel_installed: bool,
    node_available: bool,
    version: Option<String>,
    running: bool,
    url: Option<String>,
    kernel_dir: String,
    dsh_home: String,
}

#[tauri::command]
fn get_status(app: AppHandle, state: State<'_, KernelState>) -> StatusInfo {
    let guard = state.0.lock().unwrap();
    StatusInfo {
        kernel_installed: kernel_entry(&app).exists(),
        node_available: node_bin(&app).exists(),
        version: installed_version(&app),
        running: guard.child.is_some(),
        url: guard.url.clone(),
        kernel_dir: kernel_dir(&app).display().to_string(),
        dsh_home: dsh_home(&app).display().to_string(),
    }
}

#[tauri::command]
fn start_kernel_cmd(app: AppHandle) -> Result<(), String> {
    start_kernel(&app)
}

#[tauri::command]
fn stop_kernel_cmd(state: State<'_, KernelState>) -> Result<(), String> {
    stop_kernel(&state);
    Ok(())
}

/// Restart the kernel: stop, wait, start again.
#[tauri::command]
fn restart_kernel(app: AppHandle, state: State<'_, KernelState>) -> Result<(), String> {
    stop_kernel(&state);
    thread::sleep(Duration::from_millis(400));
    start_kernel(&app)
}

// ---------------------------------------------------------------------------
// Kernel update
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    current: Option<String>,
    latest: String,
    has_update: bool,
}

/// Check the npm registry for the latest @deepseek-ai/dsh version.
#[tauri::command]
fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let script = scripts_dir(&app).join("check-upstream.mjs");
    if !script.exists() {
        return Err(format!("check-upstream.mjs not found at {}", script.display()));
    }
    let node = node_bin(&app);
    let mut cmd = Command::new(&node);
    cmd.arg(&script);
    no_console(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("failed to run check-upstream: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "check-upstream failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value =
        serde_json::from_str(text.trim()).map_err(|e| format!("bad check-upstream output: {e}"))?;
    let latest = json
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if latest.is_empty() {
        return Err("check-upstream returned no version".to_string());
    }
    let current = installed_version(&app);
    let has_update = current.as_deref() != Some(latest.as_str());
    Ok(UpdateInfo {
        current,
        latest,
        has_update,
    })
}

/// Install (or upgrade) the dsh kernel to `version` (or "latest") using
/// `scripts/fetch-dsh.mjs`, which performs an atomic directory swap, then
/// start the kernel. Reports progress via the `update-status` event.
fn install_kernel(app: &AppHandle, version: &str) -> Result<(), String> {
    let script = scripts_dir(app).join("fetch-dsh.mjs");
    if !script.exists() {
        return Err(format!("fetch-dsh.mjs not found at {}", script.display()));
    }
    let node = node_bin(app);

    // Stop kernel before swapping files.
    {
        let st = app.state::<KernelState>();
        let mut guard = st.0.lock().unwrap();
        if let Some(mut child) = guard.child.take() {
            kill_tree(&mut child);
        }
        guard.url = None;
    }

    let mut cmd = Command::new(&node);
    cmd.arg(&script)
        .arg("--dir")
        .arg(kernel_dir(app))
        .arg("--version")
        .arg(version);
    no_console(&mut cmd);
    let output = cmd
        .output()
        .map_err(|e| format!("failed to run fetch-dsh: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "install failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    start_kernel(app)
}

/// Install (or upgrade) the kernel in the background, emitting `update-status`.
#[tauri::command]
fn apply_update(app: AppHandle, version: Option<String>) -> Result<(), String> {
    let version = version.unwrap_or_else(|| "latest".to_string());
    let app2 = app.clone();
    thread::spawn(move || {
        let _ = app2.emit("update-status", "installing");
        match install_kernel(&app2, &version) {
            Ok(()) => {
                let _ = app2.emit("update-status", "done");
            }
            Err(e) => {
                let _ = app2.emit("update-status", format!("error: {e}"));
            }
        }
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};

    let show = MenuItem::with_id(app, "show", "Show dsh-desktop", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let _tray = tauri::tray::TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("dsh-desktop — DeepSeek Harness")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// App entry
// ---------------------------------------------------------------------------

pub fn run() {
    // NOTE: the Tauri updater plugin (shell updates) is intentionally NOT
    // registered by default: it requires a valid minisign pubkey in
    // tauri.conf.json, and a placeholder key would panic at startup. Kernel
    // updates (the primary mechanism) go through check_update/apply_update,
    // which never touch the Tauri updater. To enable shell updates, uncomment
    // the plugin line below and configure plugins.updater in tauri.conf.json
    // (see README "外壳更新").
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second instance: focus the existing main window instead of forking.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .manage(KernelState::default())
        .setup(|app| {
            build_tray(&app.handle())?;

            // Boot the kernel. If it isn't installed yet, install it first
            // (background, with progress via `update-status` events).
            if kernel_entry(&app.handle()).exists() {
                let _ = start_kernel(&app.handle());
            } else {
                let handle = app.handle().clone();
                thread::spawn(move || {
                    let _ = handle.emit("update-status", "installing");
                    match install_kernel(&handle, "latest") {
                        Ok(()) => {
                            let _ = handle.emit("update-status", "done");
                        }
                        Err(e) => {
                            let _ = handle.emit("update-status", format!("error: {e}"));
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_status,
            start_kernel_cmd,
            stop_kernel_cmd,
            restart_kernel,
            check_update,
            apply_update
        ])
        .on_window_event(|window, event| {
            // Closing any window shuts the kernel down with the app.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.try_state::<KernelState>() {
                    stop_kernel(&state);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building dsh-desktop")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = _app.try_state::<KernelState>() {
                    stop_kernel(&state);
                }
            }
        });
}
