# dsh-desktop

**English** | [简体中文](README.zh-CN.md)

A [Tauri](https://v2.tauri.app/) desktop shell that packages [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) into a native desktop application.

**Shell/kernel separation**: the shell (this Tauri app) is only responsible for process management and native windows. The dsh kernel (`@deepseek-ai/dsh` + a portable Node.js runtime) lives in the user data directory and can be upgraded independently — **without breaking the dsh plugin ecosystem**. User configuration (`DSH_HOME`) is never touched by kernel upgrades.

## Architecture

```
┌──────────────────────────────────────────────┐
│ Tauri shell (Rust + WebView2/WKWebView/WebKitGTK) │
│ · spawns: node <kernel>/…/dsh lib/bin.js          │
│   web --port 0 (OS-assigned free port)            │
│ · parses "dsh web: http://127.0.0.1:PORT" from stdout │
│ · opens a native WebView window at that URL       │
│ · kills the kernel process tree on window close   │
│ · tray icon: Show / Quit                          │
└───────────────┬──────────────────────────────────┘
                │ user data dir (app_data_dir)
                ▼
┌──────────────────────────────────────────────┐
│ runtime/  portable Node (fetched by CI, bundled) │
│ kernel/   @deepseek-ai/dsh + deps (npm install)  │
│ dsh-home/ DSH_HOME: user profiles & plugins (never overwritten) │
└──────────────────────────────────────────────┘
```

## Update mechanism (two independent layers)

### 1. Kernel updates (dsh itself, auto-synced with upstream)

- On every launch, or when you click **Check for Updates**, the shell runs `scripts/check-upstream.mjs` to query the npm registry for the latest `@deepseek-ai/dsh`;
- Clicking **Apply Update** runs `scripts/fetch-dsh.mjs`, which executes `npm install --prefix <staging> @deepseek-ai/dsh@<version>` and then **atomically swaps** the `kernel/` directory (the old directory is kept as `.old`, with automatic rollback on failure);
- The kernel restarts automatically after the update. `DSH_HOME` (profiles, plugins) is unaffected.

### 2. Shell updates (the Tauri app itself, optional)

The shell does **not** register the updater plugin by default: it requires a valid minisign public key in `tauri.conf.json`, and a placeholder key would crash the app at startup. Shell releases are infrequent (only when Rust-side logic changes). To enable:

1. Generate a signing key: `npx @tauri-apps/cli signer generate -w ~/.tauri/dsh-desktop.key`;
2. Paste the public key into `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, and point `endpoints` at your GitHub Releases;
3. Uncomment `tauri-plugin-updater` in `src-tauri/Cargo.toml` and restore `.plugin(tauri_plugin_updater::Builder::new().build())` in `run()` in `src-tauri/src/lib.rs`;
4. Sign the artifacts with `tauri signer sign` and upload `updater.json` when releasing.

## Keeping in sync with upstream deepseek-harness

- Upstream publishes the npm package `@deepseek-ai/dsh` (current baseline: see `scripts/kernel-version.json`);
- `.github/workflows/sync-upstream.yml` **checks the npm registry daily** and opens a PR to bump `scripts/kernel-version.json` when a new version is found;
- After merging the PR, push a `v*` tag to trigger `.github/workflows/release.yml`, which rebuilds the installers.

## Local development

Prerequisites: Node 22+, stable Rust, and the platform Tauri dependencies
(Windows: MSVC Build Tools + WebView2; macOS: Xcode; Linux: webkit2gtk-4.1 etc.).

```bash
# 1. Generate icons (pure Node, no external deps)
node scripts/gen-icons.mjs

# 2. Install dev dependencies
npm install

# 3. Fetch the portable Node runtime (dev works with system node; packaging needs it)
node scripts/fetch-node.mjs --out src-tauri/node-runtime --version $(node -e "console.log(require('./scripts/node-version.json').version)")

# 4. Install the dsh kernel into the user data dir (or click "Apply Update" after launch)
node scripts/fetch-dsh.mjs --dir "$APPDATA/com.dsh.desktop/kernel" --version latest

# 5. Run in development
npm run dev
```

> In development the shell falls back to `node` from PATH; packaged builds use the portable Node bundled into `resources/runtime`, so end users never need to install Node/npm.

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

The recommended release flow goes through `.github/workflows/release.yml`: pushing a `v0.1.0` tag triggers a three-platform build, signing, and a draft release upload.

## Repository layout

```
dsh-desktop/
├── package.json              # script entry (tauri dev/build)
├── ui/                       # control-panel frontend (plain HTML/JS, no bundler)
├── src-tauri/
│   ├── src/lib.rs            # kernel process management, update commands, tray
│   ├── tauri.conf.json       # window / bundling / updater config
│   └── capabilities/         # Tauri permissions
├── scripts/
│   ├── fetch-dsh.mjs         # kernel install/upgrade (npm + atomic swap)
│   ├── check-upstream.mjs    # query npm registry for the latest version
│   ├── fetch-node.mjs        # download the portable Node runtime
│   ├── gen-icons.mjs         # generate icons (zero dependencies)
│   ├── kernel-version.json   # kernel baseline version (upstream sync target)
│   └── node-version.json     # portable Node version
└── .github/workflows/
    ├── sync-upstream.yml     # daily upstream check + auto PR
    └── release.yml           # tag-triggered three-platform build
```

## Known notes

- On first launch, if the kernel is not installed, the control panel shows "kernel not installed" — click **Check for Updates** then **Apply Update** (requires network);
- Closing all windows quits the app and stops the kernel; the tray icon can reopen it;
- The kernel is currently a pre-release (`0.1.0-rc.x`); upstream APIs may change. If something misbehaves after a kernel upgrade, check the "kernel log" panel.

## License

MIT
