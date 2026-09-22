# DSH Desktop — DeepSeek Harness Desktop Client for Windows, macOS & Linux

[![Latest release](https://img.shields.io/github/v/release/m2lan/dsh-desktop?label=download&sort=semver)](https://github.com/m2lan/dsh-desktop/releases/latest)
[![Total downloads](https://img.shields.io/github/downloads/m2lan/dsh-desktop/total)](https://github.com/m2lan/dsh-desktop/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#download)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://v2.tauri.app/)

**English** | [简体中文](README.zh-CN.md)

**DSH Desktop** is a free, open-source **desktop client for DeepSeek Harness (`dsh`)**. It runs DeepSeek Harness as an ordinary desktop application — double-click an icon and you get a native window running the harness, on **Windows, macOS and Linux**. No terminal, no `dsh web` command to remember, and **no Node.js or npm to install**.

Every installer ships a **portable Node.js runtime plus a pinned dsh kernel**, so the app works **offline on first launch**. The kernel lives in your user data directory and upgrades on its own — **your `DSH_HOME` profiles, sessions and plugins are never touched**.

> **Not affiliated with DeepSeek.** This is a community shell around the open-source `@deepseek-ai/dsh` kernel published by DeepSeek.

**Also searched as:** DeepSeek Desktop · DeepSeek Harness Desktop · DeepSeek Harness GUI · DeepSeek Harness desktop app · DeepSeek desktop client · DeepSeek 桌面版 · DeepSeek Harness 桌面客户端 · dsh desktop · dsh-desktop · run DeepSeek Harness on Windows / macOS / Linux.

---

## Download

**[→ Latest release](https://github.com/m2lan/dsh-desktop/releases/latest)** — pick the file that matches your system:

| System | File | Notes |
| --- | --- | --- |
| **Windows 10/11 (x64)** | `dsh-desktop_<version>_x64-setup.exe` | Recommended. Per-user install, **no admin rights required**. |
| **Windows 10/11 (x64)** | `dsh-desktop_<version>_x64_en-US.msi` | For managed / enterprise deployment. |
| **macOS 11+ (Apple Silicon)** | `dsh-desktop_<version>_aarch64.dmg` | Intel Macs: build from source — see [Local development](#local-development). |
| **Linux x64 (Debian / Ubuntu)** | `dsh-desktop_<version>_amd64.deb` | No `.rpm` / AppImage is published yet; build from source if you need one. |

Each release notes the exact `@deepseek-ai/dsh` kernel version it pins.

### First run

1. Install the package for your OS (see [Install notes](#install-notes) for the Windows SmartScreen and macOS Gatekeeper prompts — both are expected for unsigned community builds).
2. Launch **DSH Desktop**. A splash window shows startup progress and then hands off to the harness.
3. That's it. The kernel and its Node runtime are already inside the installer, so **first launch needs no network access and no `npm install`**.

On Windows, the WebView2 runtime is installed automatically if it is missing (that step alone needs internet).

## Features

- **Native desktop window** — the harness runs in a WebView-backed window (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux), not a browser tab you have to keep track of.
- **Zero prerequisites for users** — a portable Node.js runtime and the dsh kernel are baked into the installer. End users never install Node, npm, or the dsh CLI.
- **Works offline on first launch** — no registry round-trip on startup. The kernel that ships with the installer is the kernel you get.
- **Shell / kernel separation** — the shell only manages processes and native windows. The kernel can be upgraded independently, **without breaking the dsh plugin ecosystem**.
- **`DSH_HOME` is sacred** — kernel installs and upgrades never overwrite your profiles, sessions or plugins.
- **Atomic kernel upgrades with rollback** — a failed upgrade restores the previous kernel automatically.
- **Tray control** — `Show dsh-desktop`, `Kernel Status…`, `Check for Updates…`, `Apply Update (latest)…`, `Quit`.
- **Single instance** — launching it again focuses the existing window instead of forking a second kernel.
- **Clean shutdown** — closing the window stops the kernel process tree; no orphaned `node` processes.
- **Local by default** — the kernel binds `127.0.0.1` on an OS-assigned free port (`--port 0`), so it never collides with another service and is not exposed to your network.
- **One codebase, three platforms** — built with [Tauri 2](https://v2.tauri.app/) (Rust + system WebView), so installers stay small and the memory footprint stays low.

## Install notes

### Windows

- The `.exe` is an NSIS installer that installs **per user** (`%LOCALAPPDATA%`), so it does not need administrator rights.
- **SmartScreen will warn you** ("Windows protected your PC") because the binaries are not code-signed. Click **More info → Run anyway**.
- WebView2 is present on Windows 11 and most updated Windows 10 machines; if it is missing the installer downloads it.

### macOS

- The `.dmg` is currently **Apple Silicon (arm64) only**, and requires macOS 11 or newer.
- The app is not notarized, so Gatekeeper will refuse the first launch. Either right-click the app → **Open**, or clear the quarantine flag:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/dsh-desktop.app"
  ```

### Linux

```bash
sudo apt install ./dsh-desktop_<version>_amd64.deb
```

The build targets Debian/Ubuntu with `webkit2gtk-4.1`. AppImage and `.rpm` are not published yet (the bundled kernel makes AppImage packaging impractical) — build from source if you need them.

## Why a desktop client instead of `dsh web`?

| | Running `dsh web` yourself | DSH Desktop |
| --- | --- | --- |
| Node.js runtime | You install and maintain it | Bundled, portable, invisible |
| dsh kernel | You run `npm install` / `npx` | Baked into the installer |
| Launching | Terminal command, remember the port | Double-click an icon |
| First run | Needs network + npm | Works offline |
| Kernel upgrades | You re-run npm by hand | Tray → **Apply Update**, atomic with rollback |
| Shutting down | Find and kill the process | Close the window |
| Plugin / profile data | `DSH_HOME` | Same `DSH_HOME`, untouched by upgrades |

If you are happy on the command line, the upstream CLI is all you need. DSH Desktop exists for people who want the harness to behave like a normal app.

## Architecture

```
┌───────────────────────────────────────────────────────┐
│ Tauri shell (Rust + WebView2 / WKWebView / WebKitGTK) │
│ · spawns: node <kernel>/…/dsh lib/bin.js              │
│   web --no-open --port 0 (OS-assigned free port)      │
│ · parses "dsh web: http://127.0.0.1:PORT" from stdout │
│ · opens a native WebView window at that URL           │
│ · kills the kernel process tree on window close       │
│ · tray: Show / Kernel Status / Check & Apply Update / Quit │
└───────────────┬───────────────────────────────────────┘
                │ user data dir (app_data_dir)
                ▼
┌───────────────────────────────────────────────────────┐
│ runtime/  portable Node (fetched by CI, bundled)      │
│ kernel/   @deepseek-ai/dsh + deps (npm install)       │
│ dsh-home/ DSH_HOME: user profiles & plugins (never overwritten) │
└───────────────────────────────────────────────────────┘
```

In development the shell falls back to `node` from `PATH`; packaged builds always use the bundled runtime.

## Update mechanism (two independent layers)

### 1. Kernel updates — `@deepseek-ai/dsh` itself

The shell is **pinned** by design: startup performs **no network check**, and the kernel baked into your installer is the kernel that runs. Upgrading is explicit:

- **Tray → Check for Updates…** runs `scripts/check-upstream.mjs`, which queries the npm registry and reports the highest available version across all dist-tags (so a newer `next` beats an older `latest`). The result is shown in a native dialog.
- **Tray → Apply Update (latest)…**, or the banner button in the splash window, runs `scripts/fetch-dsh.mjs`. For a **pinned** version it installs from the committed lockfile (`npm ci --prefix <staging>`, see `scripts/kernel-lock/`) so the resolved dependency tree is reproducible; for `latest`, or when the lock does not match, it falls back to `npm install --prefix <staging> @deepseek-ai/dsh@<version>`. Either way the staged kernel then **atomically swaps** into `kernel/`. The previous kernel is kept as `.old`, and the old kernel is brought back automatically if the install fails.
- The kernel restarts after the update. **`DSH_HOME` (profiles, plugins) is unaffected.**
- When you install a newer **shell**, the kernel is re-synced to that shell's pinned version **offline**, by copying the bundled kernel.

### 2. Shell updates — the Tauri app itself

The shell does **not** register the Tauri updater plugin by default: it requires a valid minisign public key in `tauri.conf.json`, and a placeholder key would crash the app at startup. Shell releases are infrequent (only when Rust-side logic changes). To enable in-app shell updates:

1. Generate a signing key: `npx @tauri-apps/cli signer generate -w ~/.tauri/dsh-desktop.key`;
2. Paste the public key into `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, and point `endpoints` at your GitHub Releases;
3. Uncomment `tauri-plugin-updater` in `src-tauri/Cargo.toml` and restore `.plugin(tauri_plugin_updater::Builder::new().build())` in `run()` in `src-tauri/src/lib.rs`;
4. Sign the artifacts with `tauri signer sign` and upload `updater.json` when releasing.

Until then, updating the shell means installing a newer release over the old one.

## Keeping in sync with upstream deepseek-harness

- Upstream publishes the npm package `@deepseek-ai/dsh` (current pinned baseline: `scripts/kernel-version.json`);
- `.github/workflows/sync-upstream.yml` **checks the npm registry daily** and opens a PR to bump `scripts/kernel-version.json` when a new version is found;
- **Regenerate the kernel lockfile** with `npm run kernel:lock` and commit `scripts/kernel-lock/` alongside the version bump (see below);
- After merging, push a `v*` tag to trigger `.github/workflows/release.yml`, which rebuilds the installers.

### Why the kernel lockfile exists

`@deepseek-ai/dsh` declares its own dependencies with floating `^` ranges and ships no lockfile, so two builds of the **same** kernel version days apart can resolve different transitive trees. That is not theoretical: `@deepseek-ai/dsh-office-to-pdf@0.1.6-alpha.2` added a dependency on `@deepseek-ai/libreoffice-kit`, which pulls `@deepseek-ai/libreoffice-kit-wasm` — **185 MiB** of WebAssembly — and it silently appeared in every installer from v0.1.19 onwards (v0.1.18: 54 MB exe → v0.1.19: 129 MB).

`scripts/kernel-lock/` pins the entire tree for the version in `scripts/kernel-version.json`, and `scripts/fetch-dsh.mjs` consumes it with `npm ci`. `npm run kernel:lock` regenerates it (resolution only — no packages are downloaded). If the lock is missing or pins a different version, `fetch-dsh.mjs` logs that and falls back to `npm install`, so a stale lock can never break a build.

## Local development

Prerequisites: Node 22+, stable Rust, and the platform Tauri dependencies
(Windows: MSVC Build Tools + WebView2; macOS: Xcode; Linux: `webkit2gtk-4.1`, `libappindicator3`, `librsvg2`, `patchelf`).

```bash
# 1. Generate icons (pure Node, no external deps)
node scripts/gen-icons.mjs

# 2. Install dev dependencies
npm install

# 3. Fetch the portable Node runtime (dev works with system node; packaging needs it)
node scripts/fetch-node.mjs --out src-tauri/node-runtime --version $(node -e "console.log(require('./scripts/node-version.json').version)")

# 4. Install the dsh kernel into the user data dir (or use tray → Apply Update after launch).
#    With no --version it installs the pinned baseline from scripts/kernel-version.json,
#    resolved through scripts/kernel-lock/ (pass --version latest to track npm's latest tag).
node scripts/fetch-dsh.mjs --dir "$APPDATA/com.dsh.desktop/kernel"

# 5. Run in development
npm run dev
```

> In development the shell falls back to `node` from `PATH`; packaged builds use the portable Node bundled into `resources/runtime`, so end users never need to install Node/npm.

## Build & release

```bash
# Generate a signing key (one-time)
npx @tauri-apps/cli signer generate -w ~/.tauri/dsh-desktop.key
# Put the PUBLIC key into plugins.updater.pubkey in src-tauri/tauri.conf.json
# Store the PRIVATE key and its password as repo secrets:
#   TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD

# Build installers (includes the portable Node from src-tauri/node-runtime)
npm run build
```

The recommended release flow goes through `.github/workflows/release.yml`: pushing a `v0.1.0` tag triggers a three-platform build, a smoke test, and a release upload.

### Release checklist (reproduce CI locally)

The bundled Node is pinned in `scripts/node-version.json` (currently v22.23.2) — CI installs with the same version it ships.

```sh
node scripts/fetch-node.mjs --out src-tauri/node-runtime
# Windows (on macOS/Linux use bin/node instead of node.exe)
src-tauri/node-runtime/node/node.exe scripts/fetch-dsh.mjs --dir src-tauri/resources/kernel --version <kernel-version>
node --test scripts/startup.test.mjs
node scripts/smoke-kernel.mjs
```

The startup test uses a temporary `DSH_HOME` and verifies that the kernel process stays alive, that auth redirects work, and that the frontend returns HTTP 200, then shuts the test process down. Installers are only built once every platform passes, and the release is only published once all three platform builds succeed.

`scripts/prepare-kernel.mjs` applies a compatibility patch to the fetched kernel: it defers `fs-ext` (POSIX-only) on Windows while preserving the kernel's Windows semaphore lock, and compiles the `fs-ext` native module on Linux/macOS. If upstream restructures that code, the build asks you to re-check the patch.

## Repository layout

```
dsh-desktop/
├── package.json              # script entry (tauri dev/build)
├── ui/                       # splash / startup UI (plain HTML/JS, no bundler)
├── src-tauri/
│   ├── src/lib.rs            # kernel process management, update commands, tray
│   ├── tauri.conf.json       # window / bundling / updater config
│   └── capabilities/         # Tauri permissions
├── scripts/
│   ├── fetch-dsh.mjs         # kernel install/upgrade (lockfile/npm + atomic swap)
│   ├── make-kernel-lock.mjs  # regenerate scripts/kernel-lock/ for a kernel version
│   ├── check-upstream.mjs    # query npm registry for the latest version
│   ├── fetch-node.mjs        # download the portable Node runtime
│   ├── gen-icons.mjs         # generate icons (zero dependencies)
│   ├── prepare-kernel.mjs    # fs-ext compatibility patch
│   ├── startup.test.mjs      # startup smoke test
│   ├── smoke-kernel.mjs      # kernel boot smoke test
│   ├── kernel-version.json   # kernel baseline version (upstream sync target)
│   ├── kernel-lock/          # pinned dependency tree for that version (npm ci)
│   └── node-version.json     # portable Node version
└── .github/workflows/
    ├── sync-upstream.yml     # daily upstream check + auto PR
    └── release.yml           # tag-triggered three-platform build
```

## FAQ

**Is this an official DeepSeek product?**
No. It is a community desktop shell around the open-source `@deepseek-ai/dsh` kernel. Bugs in the harness itself belong upstream; bugs in the window, the installer or the updater belong here.

**Do I need to install Node.js or npm?**
No. A portable Node.js runtime is bundled into every installer. (You only need Node if you build from source.)

**Does it work offline?**
Yes on first launch — the kernel is baked into the installer. Checking for and applying kernel updates needs network access, as does installing WebView2 on a Windows machine that lacks it.

**Where does it keep my data, and how do I uninstall completely?**
Runtime state lives under your OS app-data directory:

| OS | Path |
| --- | --- |
| Windows | `%APPDATA%\com.dsh.desktop\` |
| macOS | `~/Library/Application Support/com.dsh.desktop/` |
| Linux | `~/.local/share/com.dsh.desktop/` |

Inside it: `kernel/` (the installed dsh kernel), `dsh-home/` (your `DSH_HOME` — profiles, sessions, plugins), `kernel.old/` (previous kernel kept for rollback), `logs/kernel.log`. Uninstalling the app leaves this directory in place; delete it manually if you want a clean slate. **Back up `dsh-home/` first if you have data you care about.**

**Can I keep using my existing dsh configuration and plugins?**
Yes. DSH Desktop respects `DSH_HOME` and never overwrites it during kernel upgrades — this is the whole point of the shell/kernel split.

**Which kernel version am I running?**
The release notes for your shell version state the pinned kernel. On disk you can check `kernel/.dsh-kernel-version`, or `version` in `kernel/node_modules/@deepseek-ai/dsh/package.json`.

**Is my code or data sent anywhere?**
The shell itself does not phone home. The kernel runs locally on `127.0.0.1` and talks to whatever endpoints DeepSeek Harness is configured to use — same as running the CLI yourself.

**Why is there no Intel macOS build / `.rpm` / AppImage?**
Nothing is technically blocking them, they just are not in the release matrix yet. Build from source or open an issue.

**Can I run several instances at once?**
No — the app is single-instance. Launching it again focuses the existing window rather than starting a second kernel.

## Troubleshooting

**"Windows protected your PC" when running the installer**
Expected — the builds are not code-signed. Click **More info → Run anyway**.

**macOS says the app is damaged or from an unidentified developer**
Notarization is not set up yet. Right-click the app → **Open**, or run `xattr -dr com.apple.quarantine "/Applications/dsh-desktop.app"`.

**The window stays on the splash screen / "kernel start timed out"**
Open the log at `%APPDATA%\com.dsh.desktop\logs\kernel.log` (macOS/Linux: same relative path inside the app-data directory above). It rotates at roughly 2 MB. Startup URLs are logged with their auth token stripped, so the log is safe to share.

**The kernel will not start after an upgrade**
The previous kernel is kept in `kernel.old/`. Quit the app, delete `kernel/`, rename `kernel.old/` to `kernel/`, and relaunch.

**Where did the harness go after I closed the window?**
Closing the window stops the kernel and exits the app. Use the tray icon → **Show dsh-desktop** to bring it back, or just relaunch.

**A kernel upgrade is stuck downloading**
`Apply Update` runs a real `npm install` of the dsh dependency tree and can take 2–4 minutes on a slow connection. Progress is streamed to the splash window.

## License

[MIT](LICENSE)

DSH Desktop is an independent project and is not affiliated with, endorsed by, or sponsored by DeepSeek. "DeepSeek" and "DeepSeek Harness" refer to the upstream open-source projects this shell packages.
