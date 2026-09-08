// dsh-desktop splash UI.
// The kernel boots in Rust; once its URL is known, Rust navigates this
// window straight to the harness. This page only shows progress/errors.

const { listen } = window.__TAURI__.event;
const { invoke } = window.__TAURI__.core;

const $ = (id) => document.getElementById(id);
const title = $("title");
const sub = $("sub");
const spinner = $("spinner");
const retry = $("btn-retry");

let pendingUpdateVersion = null;

function setState(text, subtext, showSpinner, showRetry, retryLabel) {
  title.textContent = text;
  sub.textContent = subtext ?? "";
  spinner.classList.toggle("hidden", !showSpinner);
  retry.hidden = !showRetry;
  if (retryLabel) retry.textContent = retryLabel;
  else retry.textContent = "重试";
}

let installing = false;
let lastProgress = "";
let startupDeadline = Date.now() + 60000;

listen("update-status", (e) => {
  const p = String(e.payload);
  if (p === "installing") {
    pendingUpdateVersion = null;
    installing = true;
    lastProgress = "";
    setState("正在安装 DeepSeek Harness 内核…", "首次运行需要联网下载，可能需要几分钟（2-4分钟）", true, false);
  } else if (p === "done") {
    pendingUpdateVersion = null;
    installing = false;
    startupDeadline = Date.now() + 60000;
    setState("内核已就绪", "正在启动…", true, false);
  } else if (p.startsWith("error:")) {
    pendingUpdateVersion = null;
    installing = false;
    setState("启动失败", p.slice(6), false, true, "重试");
  } else if (p.startsWith("update available:")) {
    // e.g. "update available: 0.1.0-rc.7 -> 0.1.0-rc.8"
    const m = p.match(/->\s*(.+?)\s*$/);
    pendingUpdateVersion = m ? m[1].trim() : null;
    // Don't block boot — let harness load. This banner just offers to upgrade.
    // If kernel is already running, the window will soon navigate away; this
    // message will be visible for ~3s before navigation. Tray menu also has Apply Update.
    setState("发现新版本", `${p}  ·  点击按钮立即更新，或稍后在托盘菜单选择 Apply Update`, false, true, pendingUpdateVersion ? `更新到 ${pendingUpdateVersion}` : "立即更新");
  } else if (p.startsWith("update available")) {
    pendingUpdateVersion = null;
    setState("发现新版本", p, false, true, "查看更新");
  } else {
    setState("处理中…", p, true, false);
  }
});

// Real-time progress from Rust's install_kernel streaming (npm http fetch, reify, etc.)
listen("install-progress", (e) => {
  if (!installing) return;
  const p = String(e.payload).trim();
  if (!p) return;
  lastProgress = p;
  // keep title, update subtext with latest npm line
  sub.textContent = p.length > 120 ? p.slice(0, 120) + "…" : p;
});

listen("kernel-log", (e) => {
  if (!installing) return;
  const p = String(e.payload).trim();
  // prefer install-progress but fallback to kernel-log for fetch-dsh lines
  if (p.includes("fetch-dsh") || p.includes("kernel") || p.includes("http fetch")) {
    sub.textContent = p.length > 120 ? p.slice(0, 120) + "…" : p;
  }
});

listen("kernel-status", (e) => {
  const p = String(e.payload);
  if (p === "ready") {
    setState("已连接", "正在打开…", true, false);
  } else if (p === "exited") {
    setState("内核已退出", "点击重试重新启动", false, true, "重试");
  }
});

retry.addEventListener("click", async () => {
  if (pendingUpdateVersion) {
    const ver = pendingUpdateVersion;
    pendingUpdateVersion = null;
    setState(`正在更新到 ${ver}…`, "请保持联网，2-4分钟内完成", true, false);
    try {
      await invoke("apply_update", { version: ver });
      // Rust will emit "installing" -> "done" via update-status; no reload needed
    } catch (err) {
      setState("更新失败", String(err), false, true, "重试");
    }
    return;
  }
  retry.disabled = true;
  startupDeadline = Date.now() + 60000;
  setState("正在重新启动内核…", "请稍候", true, false);
  try {
    const status = await invoke("get_status");
    if (status.kernelInstalled) {
      await invoke("restart_kernel");
    } else {
      await invoke("apply_update", { version: null });
    }
  } catch (err) {
    setState("启动失败", String(err), false, true, "重试");
  } finally {
    retry.disabled = false;
  }
});

// Events emitted during Rust setup can precede listener registration. Recover
// from the backend snapshot instead of relying solely on transient events.
async function pollStatus() {
  try {
    const status = await invoke("get_status");
    if (!installing && !retry.disabled) {
      if (status.error) {
        setState("启动失败", status.error, false, true, "重试");
      } else if (status.url) {
        window.location.replace(status.url);
        return;
      } else if (Date.now() > startupDeadline && !pendingUpdateVersion) {
        setState("内核启动超时", "60 秒内未连接到内核，请点击重试", false, true, "重试");
      }
    }
  } catch (err) {
    setState("无法获取启动状态", String(err), false, true, "重试");
  }
  setTimeout(pollStatus, 1000);
}
pollStatus();
