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

fn bundled_kernel_version(app: &AppHandle) -> Option<String> {
    // scripts/kernel-version.json is bundled as resource `scripts/kernel-version.json`
    let p = scripts_dir(app).join("kernel-version.json");
    let txt = std::fs::read_to_string(p).ok()?;
    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
    v.get("version").and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn bundled_kernel_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .resource_dir()
        .map(|r| r.join("kernel"))
        .unwrap_or_default()
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dst_path)?;
        } else {
            std::fs::copy(entry.path(), dst_path)?;
        }
    }
    Ok(())
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
        .arg("--no-open")
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
///
/// `check-upstream.mjs` now returns `{version, latest, next}` where
/// `version` is the highest available (so rc.8 on `next` is visible
/// even when `latest` is still rc.7). We expose `latest` as that
/// picked version for the UI, and keep `current` for comparison.
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
    // stdout is one JSON line; stderr may contain the "latest=… next=…" hint
    let last_line = text.lines().last().unwrap_or("").trim();
    let json: serde_json::Value =
        serde_json::from_str(last_line).map_err(|e| format!("bad check-upstream output: {e} — raw: {last_line}"))?;
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

    // Stream fetch-dsh output line-by-line so the splash UI can show real progress
    // (npm http fetch GET 200 ..., reify, etc.) instead of a single spinner for minutes.
    let mut cmd = Command::new(&node);
    cmd.arg(&script)
        .arg("--dir")
        .arg(kernel_dir(app))
        .arg("--version")
        .arg(version)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // force http-level logs so the user sees downloads; fetch-dsh.mjs respects this env
        .env("npm_config_loglevel", "http");
    no_console(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to run fetch-dsh: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // forward stdout
    let app_stdout = app.clone();
    let t_out = thread::spawn(move || {
        if let Some(out) = stdout {
            let reader = BufReader::new(out);
            for line in reader.lines() {
                if let Ok(l) = line {
                    let _ = app_stdout.emit("kernel-log", l.clone());
                    // also surface npm progress as subtext via update-status
                    if l.contains("http fetch") || l.contains("fetch-dsh") || l.contains("reify") {
                        let short = if l.len() > 120 { format!("{}…", &l[..120]) } else { l };
                        let _ = app_stdout.emit("install-progress", short);
                    }
                }
            }
        }
    });
    // forward stderr (npm http logs go to stderr)
    let app_stderr = app.clone();
    let mut stderr_buf = std::sync::Arc::new(Mutex::new(String::new()));
    let stderr_buf_clone = stderr_buf.clone();
    let t_err = thread::spawn(move || {
        if let Some(err) = stderr {
            let reader = BufReader::new(err);
            for line in reader.lines() {
                if let Ok(l) = line {
                    {
                        let mut b = stderr_buf_clone.lock().unwrap();
                        b.push_str(&l);
                        b.push('\n');
                        if b.len() > 8000 {
                            let drain = b.len() - 8000;
                            b.drain(..drain);
                        }
                    }
                    let _ = app_stderr.emit("kernel-log", l.clone());
                    if l.contains("http fetch") || l.contains("WARN") || l.contains("ERR") || l.contains("error") {
                        let short = if l.len() > 140 { format!("{}…", &l[..140]) } else { l };
                        let _ = app_stderr.emit("install-progress", short);
                    }
                }
            }
        }
    });

    let status = child.wait().map_err(|e| format!("failed to wait fetch-dsh: {e}"))?;
    let _ = t_out.join();
    let _ = t_err.join();

    if !status.success() {
        let tail = stderr_buf.lock().unwrap().clone();
        let tail_short = tail.lines().last().unwrap_or("unknown error").to_string();
        // Try to bring the old kernel back so history/model fetches don't stay dead
        let _ = start_kernel(app);
        return Err(format!("install failed (exit {}): {} -- {}", status, tail_short, tail.lines().rev().take(5).collect::<Vec<_>>().join(" | ")));
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
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};

    let show = MenuItem::with_id(app, "show", "Show dsh-desktop", true, None::<&str>)?;
    let status = MenuItem::with_id(app, "status", "Kernel Status…", true, None::<&str>)?;
    let check = MenuItem::with_id(app, "check", "Check for Updates…", true, None::<&str>)?;
    let apply = MenuItem::with_id(app, "apply", "Apply Update (latest)…", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &status, &check, &apply, &sep, &quit])?;

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
            "status" => {
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move {
                    let st = {
                        let s = app2.state::<KernelState>();
                        let g = s.0.lock().unwrap();
                        (g.child.is_some(), g.url.clone())
                    };
                    let ver = installed_version(&app2).unwrap_or_else(|| "(not installed)".to_string());
                    let kdir = kernel_dir(&app2).display().to_string();
                    let home = dsh_home(&app2).display().to_string();
                    let msg = format!(
                        "Kernel: {}\nInstalled: {}\nRunning: {}\nURL: {}\nKernel dir: {}\nDSH_HOME: {}",
                        ver,
                        kernel_entry(&app2).exists(),
                        st.0,
                        st.1.unwrap_or_else(|| "(not running)".to_string()),
                        kdir,
                        home
                    );
                    use tauri_plugin_dialog::DialogExt;
                    app2.dialog().message(msg).title("dsh-desktop — Kernel Status").show(|_| {});
                });
            }
            "check" => {
                let app2 = app.clone();
                std::thread::spawn(move || {
                    let app3 = app2.clone();
                    match check_update(app2) {
                        Ok(info) => {
                            let msg = if info.has_update {
                                format!("Update available: {} → {}", info.current.unwrap_or_else(|| "(none)".to_string()), info.latest)
                            } else {
                                format!("Already up-to-date: {}", info.current.unwrap_or_else(|| info.latest.clone()))
                            };
                            let _ = app3.emit("update-status", msg.clone());
                            let _ = app3.emit("kernel-log", format!("[dsh-desktop] {}", msg));
                            use tauri_plugin_dialog::DialogExt;
                            app3.dialog().message(msg).title("Check for Updates").show(|_| {});
                        }
                        Err(e) => {
                            use tauri_plugin_dialog::DialogExt;
                            app3.dialog().message(format!("Check failed: {e}")).title("Check for Updates").show(|_| {});
                        }
                    }
                });
            }
            "apply" => {
                let app2 = app.clone();
                // Ask registry for best version first, then install
                std::thread::spawn(move || {
                    let best = {
                        let script = scripts_dir(&app2).join("check-upstream.mjs");
                        let node = node_bin(&app2);
                        let mut cmd = std::process::Command::new(&node);
                        cmd.arg(&script);
                        no_console(&mut cmd);
                        cmd.output().ok().and_then(|o| {
                            if !o.status.success() { return None; }
                            let txt = String::from_utf8_lossy(&o.stdout);
                            let last = txt.lines().last()?.trim().to_string();
                            let v: serde_json::Value = serde_json::from_str(&last).ok()?;
                            v.get("version")?.as_str().map(|s| s.to_string())
                        }).unwrap_or_else(|| "latest".to_string())
                    };
                    let app3 = app2.clone();
                    let best2 = best.clone();
                    use tauri_plugin_dialog::DialogExt;
                    app3.dialog().message(format!("Will install @deepseek-ai/dsh@{best} — kernel will restart. Continue?")).title("Apply Update").show(move |ok| {
                        if !ok { return; }
                        let _ = app2.emit("update-status", format!("installing {best2}…"));
                        let app4 = app2.clone();
                        std::thread::spawn(move || {
                            match install_kernel(&app4, &best2) {
                                Ok(()) => {
                                    let _ = app4.emit("update-status", "done");
                                    app4.dialog().message(format!("Kernel updated to {best2} and restarted.")).title("Update done").show(|_| {});
                                }
                                Err(e) => {
                                    let _ = app4.emit("update-status", format!("error: {e}"));
                                    app4.dialog().message(format!("Install failed: {e}\nOld kernel was restarted if possible.")).title("Update failed").show(|_| {});
                                }
                            }
                        });
                    });
                });
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
        .plugin(tauri_plugin_dialog::init())
        .manage(KernelState::default())
        .setup(|app| {
            build_tray(&app.handle())?;

            // Pinned mode: dsh-desktop version is locked to the bundled harness version.
            // No network check on startup — the kernel that ships with the installer is the
            // only version used. First launch copies/bundles or installs that exact version.
            // Existing installs with a different version are also migrated offline via copy.
            if kernel_entry(&app.handle()).exists() {
                let installed = installed_version(&app.handle());
                let pinned = bundled_kernel_version(&app.handle());
                if let Some(pinned_ver) = pinned.clone() {
                    if installed.as_deref() != Some(pinned_ver.as_str()) {
                        let handle = app.handle().clone();
                        let _ = handle.emit("update-status", "installing");
                        let _ = handle.emit("kernel-log", format!("[dsh-desktop] migrating kernel {} -> {} (offline)", installed.unwrap_or_else(|| "(none)".to_string()), pinned_ver));
                        let bundled = bundled_kernel_dir(&handle);
                        let bundled_entry = bundled.join("node_modules/@deepseek-ai/dsh/lib/bin.js");
                        if bundled_entry.exists() {
                            let dest = kernel_dir(&handle);
                            let res = (|| -> Result<(), String> {
                                // ensure kernel not running while swapping
                                if let Some(state) = handle.try_state::<KernelState>() {
                                    stop_kernel(&state);
                                }
                                // remove old, copy bundled
                                let _ = std::fs::remove_dir_all(&dest);
                                copy_dir_recursive(&bundled, &dest).map_err(|e| e.to_string())?;
                                let _ = std::fs::write(dest.join(".dsh-kernel-version"), format!("{pinned_ver}\n"));
                                Ok(())
                            })();
                            if res.is_ok() {
                                let _ = handle.emit("kernel-log", "[dsh-desktop] kernel migrated from bundled resources".to_string());
                                let _ = handle.emit("update-status", "done");
                            } else {
                                let _ = handle.emit("kernel-log", format!("[dsh-desktop] migrate copy failed: {}, will continue with existing", res.unwrap_err()));
                            }
                        } else {
                            let _ = handle.emit("kernel-log", "[dsh-desktop] bundled kernel not found, keeping existing kernel".to_string());
                        }
                    }
                }
                let _ = start_kernel(&app.handle());
            } else {
                let handle = app.handle().clone();
                thread::spawn(move || {
                    let _ = handle.emit("update-status", "installing");
                    // 1) Prefer a pre-bundled kernel shipped as resource `kernel/` (offline install)
                    let bundled = bundled_kernel_dir(&handle);
                    let bundled_entry = bundled.join("node_modules/@deepseek-ai/dsh/lib/bin.js");
                    if bundled_entry.exists() {
                        let dest = kernel_dir(&handle);
                        // copy dir recursively (simple, best-effort)
                        let _ = std::fs::create_dir_all(&dest);
                        let res = (|| -> Result<(), String> {
                            copy_dir_recursive(&bundled, &dest).map_err(|e| e.to_string())?;
                            // ensure version file matches bundled version
                            if let Some(v) = bundled_kernel_version(&handle) {
                                let _ = std::fs::write(dest.join(".dsh-kernel-version"), format!("{v}\n"));
                            }
                            Ok(())
                        })();
                        if res.is_ok() {
                            let _ = handle.emit("kernel-log", "[dsh-desktop] kernel restored from bundled resources".to_string());
                            match start_kernel(&handle) {
                                Ok(()) => { let _ = handle.emit("update-status", "done"); return; }
                                Err(e) => { let _ = handle.emit("kernel-log", format!("[dsh-desktop] bundled kernel start failed: {e}, falling back to npm")); }
                            }
                        } else {
                            let _ = handle.emit("kernel-log", format!("[dsh-desktop] bundled copy failed: {}, falling back to npm", res.unwrap_err()));
                        }
                    }
                    // 2) Fallback: npm install the pinned version from scripts/kernel-version.json (no registry query)
                    let target = bundled_kernel_version(&handle).unwrap_or_else(|| "latest".to_string());
                    let _ = handle.emit("kernel-log", format!("[dsh-desktop] installing pinned kernel {} …", target));
                    match install_kernel(&handle, &target) {
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
