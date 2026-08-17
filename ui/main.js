// dsh-desktop splash UI.
// The kernel boots in Rust; once its URL is known, Rust navigates this
// window straight to the harness. This page only shows progress/errors.

const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
const title = $("title");
const sub = $("sub");
const spinner = $("spinner");
const retry = $("btn-retry");

function setState(text, subtext, showSpinner, showRetry) {
  title.textContent = text;
  sub.textContent = subtext ?? "";
  spinner.classList.toggle("hidden", !showSpinner);
  retry.hidden = !showRetry;
}

listen("update-status", (e) => {
  const p = String(e.payload);
  if (p === "installing") {
    setState("正在安装 DeepSeek Harness 内核…", "首次运行需要联网下载，可能需要几分钟", true, false);
  } else if (p === "done") {
    setState("内核已就绪", "正在启动…", true, false);
  } else if (p.startsWith("error:")) {
    setState("启动失败", p.slice(6), false, true);
  } else {
    setState("处理中…", p, true, false);
  }
});

listen("kernel-status", (e) => {
  const p = String(e.payload);
  if (p === "ready") {
    setState("已连接", "正在打开…", true, false);
  } else if (p === "exited") {
    setState("内核已退出", "点击重试重新启动", false, true);
  }
});

retry.addEventListener("click", () => {
  // Reloading the window re-runs Rust setup, which boots (or installs) the kernel again.
  window.location.reload();
});
