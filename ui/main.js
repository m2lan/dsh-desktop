// dsh-desktop control UI.
// Uses the global Tauri API (withGlobalTauri: true) — no bundler needed.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);

const els = {
  pill: $("status-pill"),
  kernelDir: $("kernel-dir"),
  dshHome: $("dsh-home"),
  kernelVersion: $("kernel-version"),
  latestVersion: $("latest-version"),
  kernelUrl: $("kernel-url"),
  btnOpen: $("btn-open"),
  btnStart: $("btn-start"),
  btnStop: $("btn-stop"),
  btnRestart: $("btn-restart"),
  btnCheck: $("btn-check"),
  btnUpdate: $("btn-update"),
  log: $("log"),
};

function setStatus(state, label) {
  els.pill.dataset.state = state;
  els.pill.textContent = label;
}

function log(line) {
  const t = new Date().toLocaleTimeString();
  const prev = els.log.textContent;
  els.log.textContent = prev === "—" ? `[${t}] ${line}` : `${prev}\n[${t}] ${line}`;
  els.log.scrollTop = els.log.scrollHeight;
}

function setBusy(flag) {
  for (const btn of Object.values(els)) {
    if (btn instanceof HTMLButtonElement) btn.disabled = flag;
  }
}

async function refresh() {
  try {
    const s = await invoke("get_status");
    els.kernelDir.textContent = s.kernelDir;
    els.dshHome.textContent = s.dshHome;
    els.kernelVersion.textContent = s.version ?? "未安装";
    els.kernelUrl.textContent = s.url ?? "—";

    const canStart = s.kernelInstalled && s.nodeAvailable;
    els.btnStart.disabled = canStart && s.running;
    els.btnStop.disabled = !s.running;
    els.btnRestart.disabled = !canStart;
    els.btnOpen.disabled = !s.running || !s.url;
    els.btnCheck.disabled = !s.nodeAvailable;

    if (s.running) {
      setStatus("ready", "运行中");
    } else if (!s.kernelInstalled) {
      setStatus("no-kernel", "内核未安装");
    } else {
      setStatus("error", "已停止");
    }
    return s;
  } catch (e) {
    setStatus("error", "状态获取失败");
    log(`get_status error: ${e}`);
    return null;
  }
}

async function checkUpdate() {
  try {
    const u = await invoke("check_update");
    els.latestVersion.textContent = u.latest;
    if (u.hasUpdate) {
      log(`发现新内核 ${u.latest}（当前 ${u.current ?? "未安装"}）`);
      els.btnUpdate.disabled = false;
      setStatus("starting", "有可用更新");
    } else {
      log(`已是最新版本 ${u.latest}`);
      els.btnUpdate.disabled = true;
    }
  } catch (e) {
    log(`检查更新失败: ${e}`);
  }
}

async function applyUpdate() {
  setBusy(true);
  log("开始安装内核，请稍候…（需要网络下载）");
  try {
    await invoke("apply_update", { version: null });
  } catch (e) {
    log(`应用更新失败: ${e}`);
    setBusy(false);
  }
}

function wire() {
  els.btnOpen.addEventListener("click", () => invoke("open_kernel_window"));
  els.btnStart.addEventListener("click", async () => {
    setStatus("starting", "启动中…");
    try {
      await invoke("start_kernel_cmd");
    } catch (e) {
      setStatus("error", "启动失败");
      log(`start_kernel error: ${e}`);
      setBusy(false);
    }
  });
  els.btnStop.addEventListener("click", async () => {
    try {
      await invoke("stop_kernel_cmd");
      setStatus("error", "已停止");
      await refresh();
    } catch (e) {
      log(`stop_kernel error: ${e}`);
    }
  });
  els.btnRestart.addEventListener("click", async () => {
    setStatus("starting", "重启中…");
    try {
      await invoke("restart_kernel");
    } catch (e) {
      setStatus("error", "重启失败");
      log(`restart_kernel error: ${e}`);
    }
  });
  els.btnCheck.addEventListener("click", checkUpdate);
  els.btnUpdate.addEventListener("click", applyUpdate);
}

async function boot() {
  wire();

  // Events from Rust
  listen("kernel-url", (e) => {
    els.kernelUrl.textContent = e.payload;
    setStatus("ready", "运行中");
    // Auto-open the harness window once ready.
    invoke("open_kernel_window").catch((err) => log(`open window: ${err}`));
    refresh();
  });
  listen("kernel-status", (e) => {
    if (e.payload === "ready") setStatus("ready", "运行中");
    else if (e.payload === "exited") setStatus("error", "已退出");
    else if (e.payload === "no-kernel") setStatus("no-kernel", "内核未安装");
  });
  listen("kernel-log", (e) => log(e.payload));
  listen("update-status", async (e) => {
    if (e.payload === "installing") {
      setStatus("starting", "安装内核中…");
    } else if (e.payload === "done") {
      log("内核安装完成");
      setStatus("ready", "安装完成");
      setBusy(false);
      await refresh();
    } else {
      log(String(e.payload));
      setStatus("error", "更新失败");
      setBusy(false);
    }
  });

  await refresh();
  if (els.btnCheck.disabled === false) checkUpdate();
}

boot();
