# dsh-desktop

Tauri 桌面壳，用于把 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 封装成原生桌面应用。

**壳核分离（shell/kernel separation）**：外壳（本 Tauri 应用）只负责进程管理与原生窗口；dsh 内核（`@deepseek-ai/dsh` + 便携 Node 运行时）存放在用户数据目录，可独立升级，**不破坏 dsh 插件生态**，用户配置（`DSH_HOME`）与内核升级互不干扰。

## 架构

```
┌────────────────────────────────────────────┐
│ Tauri 壳（Rust + WebView2/WKWebView/WebKitGTK）│
│ · 启动时 spawn：node <kernel>/…/dsh lib/bin.js │
│   web --port 0（端口由系统分配）              │
│ · 解析 stdout 的 "dsh web: http://127.0.0.1:PORT"│
│ · 打开原生 WebView 窗口指向该 URL             │
│ · 关闭窗口/退出时 taskkill 内核进程树          │
│ · 托盘：显示 / 退出                          │
└───────────────┬────────────────────────────┘
                │ 用户数据目录（app_data_dir）
                ▼
┌────────────────────────────────────────────┐
│ runtime/  便携 Node（CI 下载，打进安装包）     │
│ kernel/   @deepseek-ai/dsh 及依赖（npm 安装） │
│ dsh-home/ DSH_HOME：用户 profile 与插件（永不覆盖）│
└────────────────────────────────────────────┘
```

## 更新机制（两层，互相独立）

### 1. 内核更新（dsh 本体，随上游自动同步）

- 每次启动或点击「检查更新」，壳调用 `scripts/check-upstream.mjs` 查询 npm registry 的 `@deepseek-ai/dsh` 最新版；
- 点击「应用更新」→ `scripts/fetch-dsh.mjs` 执行 `npm install --prefix <staging> @deepseek-ai/dsh@<version>`，随后**原子替换** `kernel/` 目录（旧目录备份为 `.old`，失败自动回滚）；
- 更新完成自动重启内核。`DSH_HOME`（profile、插件）不受影响。

### 2. 外壳更新（Tauri 本体，可选）

壳默认**不注册** updater 插件：它要求 `tauri.conf.json` 里有合法的 minisign 公钥，占位符会导致启动崩溃。外壳更新频率很低（Rust 侧逻辑变更才发版），需要时按下面步骤启用：

1. 生成签名密钥：`npx tauri signer generate -w ~/.tauri/dsh-desktop.key`；
2. 把公钥填入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，endpoints 指向你的 GitHub Releases；
3. 取消 `src-tauri/Cargo.toml` 中 `tauri-plugin-updater` 的注释，并在 `src-tauri/src/lib.rs` 的 `run()` 里恢复 `.plugin(tauri_plugin_updater::Builder::new().build())`；
4. 发布时用 `tauri signer sign` 对产物签名并上传 `updater.json`。

## 与上游 deepseek-harness 保持同步

- 上游发布 npm 包 `@deepseek-ai/dsh`（当前版本见 `scripts/kernel-version.json`）；
- `.github/workflows/sync-upstream.yml` **每日检查** npm registry，发现新版本自动开 PR 更新 `scripts/kernel-version.json`；
- 合并 PR 后打 `v*` tag 触发 `.github/workflows/release.yml` 重新构建安装包。

## 本地开发

前置要求：Node 22+、Rust stable、各平台 Tauri 依赖
（Windows 需 MSVC Build Tools + WebView2；macOS 需 Xcode；Linux 需 webkit2gtk-4.1 等）。

```bash
# 1. 生成图标（纯 Node，无外部依赖）
node scripts/gen-icons.mjs

# 2. 安装前端/dev 依赖
npm install

# 3. 准备便携 Node 运行时（壳默认用系统 node 也能开发，但打包需要）
node scripts/fetch-node.mjs --out src-tauri/node-runtime --version $(node -e "console.log(require('./scripts/node-version.json').version)")

# 4. 安装 dsh 内核到用户数据目录（也可直接启动后点「应用更新」）
node scripts/fetch-dsh.mjs --dir "$APPDATA/com.dsh.desktop/kernel" --version latest

# 5. 开发运行
npm run dev
```

> 开发期壳会自动用 PATH 上的 `node`；打包后使用打进 `resources/runtime` 的便携 Node，终端用户无需安装 Node/npm。

## 打包发布

```bash
# 生成签名密钥（首次，一次性）
npx tauri signer generate -w ~/.tauri/dsh-desktop.key
# 把公钥填进 src-tauri/tauri.conf.json 的 plugins.updater.pubkey
# 把私钥与密码配置为仓库 secrets：TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD

# 构建安装包（会带上 src-tauri/node-runtime 里的便携 Node）
npm run build
```

发布流程建议走 `.github/workflows/release.yml`：打 `v0.1.0` tag 即触发三平台构建、签名、上传 release draft。

## 目录结构

```
dsh-desktop/
├── package.json              # 脚本入口（tauri dev/build）
├── ui/                       # 控制面板前端（原生 HTML/JS，无需打包器）
├── src-tauri/
│   ├── src/lib.rs            # 内核进程管理、更新命令、托盘
│   ├── tauri.conf.json       # 窗口/打包/更新器配置
│   └── capabilities/         # Tauri 权限
├── scripts/
│   ├── fetch-dsh.mjs         # 内核安装/升级（npm + 原子替换）
│   ├── check-upstream.mjs    # 查询 npm registry 最新版
│   ├── fetch-node.mjs        # 下载便携 Node 运行时
│   ├── gen-icons.mjs         # 生成图标（零依赖）
│   ├── kernel-version.json   # 内核基线版本（上游同步目标）
│   └── node-version.json     # 便携 Node 版本
└── .github/workflows/
    ├── sync-upstream.yml     # 每日上游检查 + 自动 PR
    └── release.yml           # 打 tag 构建三平台安装包
```

## 已知事项

- 首次启动若内核未安装，控制面板会提示「内核未安装」，点击「检查更新」→「应用更新」即可（需联网）；
- 关闭所有窗口即退出应用并停止内核；托盘图标可重新打开；
- 当前内核为预发布版本（`0.1.0-rc.x`），上游 API 可能变动，升级内核后如遇异常请查看「内核日志」面板。
