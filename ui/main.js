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

listen("update-status", (e) => {
  const p = String(e.payload);
  if (p === "installing") {
    pendingUpdateVersion = null;
    setState("正在安装 DeepSeek Harness 内核…", "首次运行需要联网下载，可能需要几分钟（2-4分钟）", true, false);
  } else if (p === "done") {
    pendingUpdateVersion = null;
    setState("内核已就绪", "正在启动…", true, false);
  } else if (p.startsWith("error:")) {
    pendingUpdateVersion = null;
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
  // Reloading the window re-runs Rust setup, which boots (or installs) the kernel again.
  window.location.reload();
});
