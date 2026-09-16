# DSH Desktop — DeepSeek Harness 桌面客户端（Windows / macOS / Linux）

[![最新版本](https://img.shields.io/github/v/release/m2lan/dsh-desktop?label=download&sort=semver)](https://github.com/m2lan/dsh-desktop/releases/latest)
[![总下载量](https://img.shields.io/github/downloads/m2lan/dsh-desktop/total)](https://github.com/m2lan/dsh-desktop/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![平台](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#下载)
[![基于 Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB)](https://v2.tauri.app/)

[English](README.md) | **简体中文**

**DSH Desktop** 是一个免费、开源的 **DeepSeek Harness（`dsh`）桌面客户端**。它把 DeepSeek Harness 变成普通的桌面软件——双击图标就是一个原生窗口，在 **Windows、macOS、Linux** 上都能用。不需要开终端、不需要记 `dsh web` 命令，也**不需要预先安装 Node.js 或 npm**。

安装包内置了**便携版 Node.js 运行时**和**锁定版本的 dsh 内核**，所以**首次启动即可离线运行**。内核存放在用户数据目录，可以独立升级——**你的 `DSH_HOME` 配置、会话和插件永远不会被覆盖**。

> **本项目与 DeepSeek 官方无关**，是基于官方开源内核 `@deepseek-ai/dsh` 的社区桌面壳。

**你可能正在搜索：** DeepSeek 桌面版 · DeepSeek 桌面客户端 · DeepSeek Harness 桌面版 · DeepSeek Harness 桌面客户端 · DeepSeek 客户端下载 · DeepSeek 本地客户端 · dsh 桌面版 · 免安装 Node 运行 DeepSeek Harness · 在 Windows / macOS / Linux 上运行 DeepSeek Harness。

---

## 下载

**[→ 前往最新 Release](https://github.com/m2lan/dsh-desktop/releases/latest)**，选择对应系统的安装包：

| 系统 | 文件名 | 说明 |
| --- | --- | --- |
| **Windows 10/11 (x64)** | `dsh-desktop_<版本>_x64-setup.exe` | 推荐。**按用户安装，无需管理员权限**。 |
| **Windows 10/11 (x64)** | `dsh-desktop_<版本>_x64_en-US.msi` | 适合企业/域环境批量部署。 |
| **macOS 11+（Apple Silicon）** | `dsh-desktop_<版本>_aarch64.dmg` | Intel Mac 请从源码构建，见[本地开发](#本地开发)。 |
| **Linux x64（Debian / Ubuntu）** | `dsh-desktop_<版本>_amd64.deb` | 暂未发布 `.rpm` / AppImage，需要请从源码构建。 |

每个 Release 的说明里都会标注它锁定的 `@deepseek-ai/dsh` 内核版本。

### 首次启动

1. 安装对应系统的包（Windows SmartScreen、macOS Gatekeeper 的拦截属正常现象，见[安装说明](#安装说明)——社区构建未做代码签名）。
2. 启动 **DSH Desktop**。启动画面会显示启动进度，随后自动进入 Harness 界面。
3. 就这样。内核和 Node 运行时已经在安装包里了，**首次启动不需要联网、不需要 `npm install`**。

Windows 上如果缺少 WebView2 运行时会自动安装（仅这一步需要联网）。

## 功能特性

- **原生桌面窗口** —— Harness 跑在系统 WebView 里（Windows 用 WebView2、macOS 用 WKWebView、Linux 用 WebKitGTK），不用再在浏览器标签页里找它。
- **用户零依赖** —— 便携 Node 运行时 + dsh 内核全部打进安装包，终端用户不用装 Node、npm 或 dsh CLI。
- **首次启动可离线** —— 启动过程不查询 npm registry，安装包里带的内核就是实际运行的内核。
- **壳核分离** —— 外壳只负责进程与原生窗口；内核可独立升级，**不破坏 dsh 插件生态**。
- **`DSH_HOME` 不被触碰** —— 内核安装与升级永不覆盖你的 profile、会话和插件。
- **原子升级 + 自动回滚** —— 内核升级失败会自动恢复旧内核。
- **托盘控制** —— `Show dsh-desktop` / `Kernel Status…` / `Check for Updates…` / `Apply Update (latest)…` / `Quit`。
- **单实例** —— 重复启动只会聚焦已有窗口，不会起第二个内核。
- **干净退出** —— 关闭窗口即终止内核进程树，不留孤儿 `node` 进程。
- **默认只在本机** —— 内核绑定 `127.0.0.1` 并使用系统分配的随机端口（`--port 0`），既不会端口冲突，也不会暴露到局域网。
- **一套代码三平台** —— 基于 [Tauri 2](https://v2.tauri.app/)（Rust + 系统 WebView），安装包小、内存占用低。

## 安装说明

### Windows

- `.exe` 是 NSIS 安装包，**按当前用户安装**（`%LOCALAPPDATA%`），不需要管理员权限。
- 由于二进制未做代码签名，**SmartScreen 会拦截**（「Windows 已保护你的电脑」）。点 **更多信息 → 仍要运行**。
- Windows 11 和大多数已更新的 Windows 10 已自带 WebView2；缺失时安装程序会自动下载。

### macOS

- `.dmg` 目前**仅支持 Apple Silicon（arm64）**，要求 macOS 11 及以上。
- 应用未公证，Gatekeeper 会阻止首次启动。可以右键应用 → **打开**，或清除隔离属性：

  ```bash
  xattr -dr com.apple.quarantine "/Applications/dsh-desktop.app"
  ```

### Linux

```bash
sudo apt install ./dsh-desktop_<版本>_amd64.deb
```

构建面向 Debian/Ubuntu，依赖 `webkit2gtk-4.1`。AppImage 与 `.rpm` 尚未发布（内置内核让 AppImage 打包不现实），需要请从源码构建。

## 为什么用桌面客户端，而不是自己跑 `dsh web`？

| | 自己跑 `dsh web` | DSH Desktop |
| --- | --- | --- |
| Node 运行时 | 自己装、自己维护 | 内置便携版，用户无感知 |
| dsh 内核 | 自己 `npm install` / `npx` | 打进安装包 |
| 启动方式 | 终端敲命令、记端口 | 双击图标 |
| 首次运行 | 需要联网 + npm | 可离线 |
| 内核升级 | 手动重跑 npm | 托盘 → **Apply Update**，原子替换 + 回滚 |
| 关闭 | 自己找进程杀掉 | 关窗口即可 |
| 插件与配置数据 | `DSH_HOME` | 同一个 `DSH_HOME`，升级不覆盖 |

如果你本来就习惯命令行，上游 CLI 完全够用。DSH Desktop 面向的是「希望 Harness 像普通软件一样好用」的人。

## 架构

```
┌───────────────────────────────────────────────────────┐
│ Tauri 壳（Rust + WebView2 / WKWebView / WebKitGTK）    │
│ · 启动时 spawn：node <kernel>/…/dsh lib/bin.js         │
│   web --no-open --port 0（端口由系统分配）             │
│ · 解析 stdout 的 "dsh web: http://127.0.0.1:PORT"      │
│ · 打开原生 WebView 窗口指向该 URL                      │
│ · 关闭窗口时终止内核进程树                             │
│ · 托盘：显示 / 内核状态 / 检查更新 / 应用更新 / 退出     │
└───────────────┬───────────────────────────────────────┘
                │ 用户数据目录（app_data_dir）
                ▼
┌───────────────────────────────────────────────────────┐
│ runtime/  便携 Node（CI 下载，打进安装包）              │
│ kernel/   @deepseek-ai/dsh 及依赖（npm 安装）           │
│ dsh-home/ DSH_HOME：用户 profile 与插件（永不覆盖）      │
└───────────────────────────────────────────────────────┘
```

开发期外壳会回退到 `PATH` 上的 `node`；打包后始终使用内置运行时。

## 更新机制（两层，互相独立）

### 1. 内核更新 —— `@deepseek-ai/dsh` 本体

外壳采用**锁定（pinned）**策略：启动时**不联网检查**，安装包里带的内核就是实际运行的内核。升级是显式动作：

- **托盘 → Check for Updates…** 执行 `scripts/check-upstream.mjs`，查询 npm registry 并返回所有 dist-tags 中的最高版本（所以 `next` 比 `latest` 新时会选 `next`），结果用原生对话框展示。
- **托盘 → Apply Update (latest)…**，或启动画面上的更新按钮，执行 `scripts/fetch-dsh.mjs`：先 `npm install --prefix <staging> @deepseek-ai/dsh@<版本>`，随后**原子替换** `kernel/` 目录。旧内核保留为 `.old`，安装失败会自动把旧内核拉起来。
- 更新完成自动重启内核。**`DSH_HOME`（profile、插件）不受影响。**
- 安装更新的**外壳**时，内核会按该外壳锁定的版本**离线**重新同步（直接复制内置内核）。

### 2. 外壳更新 —— Tauri 本体

壳默认**不注册** Tauri updater 插件：它要求 `tauri.conf.json` 里有合法的 minisign 公钥，占位符会导致启动崩溃。外壳更新频率很低（Rust 侧逻辑变更才发版）。需要时按下面步骤启用：

1. 生成签名密钥：`npx @tauri-apps/cli signer generate -w ~/.tauri/dsh-desktop.key`；
2. 把公钥填入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，endpoints 指向你的 GitHub Releases；
3. 取消 `src-tauri/Cargo.toml` 中 `tauri-plugin-updater` 的注释，并在 `src-tauri/src/lib.rs` 的 `run()` 里恢复 `.plugin(tauri_plugin_updater::Builder::new().build())`；
4. 发布时用 `tauri signer sign` 对产物签名并上传 `updater.json`。

在启用之前，更新外壳的方式就是覆盖安装新版本。

## 与上游 deepseek-harness 保持同步

- 上游发布 npm 包 `@deepseek-ai/dsh`（当前锁定版本见 `scripts/kernel-version.json`）；
- `.github/workflows/sync-upstream.yml` **每日检查** npm registry，发现新版本自动开 PR 更新 `scripts/kernel-version.json`；
- 合并 PR 后打 `v*` tag 触发 `.github/workflows/release.yml` 重新构建安装包。

## 本地开发

前置要求：Node 22+、Rust stable、各平台 Tauri 依赖
（Windows 需 MSVC Build Tools + WebView2；macOS 需 Xcode；Linux 需 `webkit2gtk-4.1`、`libappindicator3`、`librsvg2`、`patchelf`）。

```bash
# 1. 生成图标（纯 Node，无外部依赖）
node scripts/gen-icons.mjs

# 2. 安装前端/dev 依赖
npm install

# 3. 准备便携 Node 运行时（开发期用系统 node 也能跑，但打包需要）
node scripts/fetch-node.mjs --out src-tauri/node-runtime --version $(node -e "console.log(require('./scripts/node-version.json').version)")

# 4. 安装 dsh 内核到用户数据目录（也可启动后走托盘 → Apply Update）
node scripts/fetch-dsh.mjs --dir "$APPDATA/com.dsh.desktop/kernel" --version latest

# 5. 开发运行
npm run dev
```

> 开发期外壳会自动使用 `PATH` 上的 `node`；打包后使用打进 `resources/runtime` 的便携 Node，终端用户无需安装 Node/npm。

## 打包发布

```bash
# 生成签名密钥（首次，一次性）
npx @tauri-apps/cli signer generate -w ~/.tauri/dsh-desktop.key
# 把公钥填进 src-tauri/tauri.conf.json 的 plugins.updater.pubkey
# 把私钥与密码配置为仓库 secrets：TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD

# 构建安装包（会带上 src-tauri/node-runtime 里的便携 Node）
npm run build
```

发布流程走 `.github/workflows/release.yml`：推 `v0.1.0` 之类的 tag 即触发三平台构建、冒烟测试与 release 上传。

### 发布前检查（本地复现 CI）

内置 Node 版本固定在 `scripts/node-version.json`（当前 v22.23.2），CI 安装与最终运行时使用同一版本。

```sh
node scripts/fetch-node.mjs --out src-tauri/node-runtime
# Windows（macOS/Linux 把 node.exe 换成 bin/node）
src-tauri/node-runtime/node/node.exe scripts/fetch-dsh.mjs --dir src-tauri/resources/kernel --version <内核版本>
node --test scripts/startup.test.mjs
node scripts/smoke-kernel.mjs
```

启动检查使用临时 `DSH_HOME`，验证内核进程存活、认证跳转和前端 HTTP 200，然后关闭测试进程。各平台全部通过才构建安装包，三平台构建成功才发布 Release。

`scripts/prepare-kernel.mjs` 会对取回的内核打一个兼容补丁：在 Windows 上延迟加载仅 POSIX 可用的 `fs-ext`，同时保留内核原有的 Windows 信号量锁；在 Linux/macOS 上编译 `fs-ext` 原生模块。上游若调整了相关代码结构，构建会要求重新检查该补丁。

## 目录结构

```
dsh-desktop/
├── package.json              # 脚本入口（tauri dev/build）
├── ui/                       # 启动画面 UI（原生 HTML/JS，无需打包器）
├── src-tauri/
│   ├── src/lib.rs            # 内核进程管理、更新命令、托盘
│   ├── tauri.conf.json       # 窗口/打包/更新器配置
│   └── capabilities/         # Tauri 权限
├── scripts/
│   ├── fetch-dsh.mjs         # 内核安装/升级（npm + 原子替换）
│   ├── check-upstream.mjs    # 查询 npm registry 最新版
│   ├── fetch-node.mjs        # 下载便携 Node 运行时
│   ├── gen-icons.mjs         # 生成图标（零依赖）
│   ├── prepare-kernel.mjs    # fs-ext 兼容补丁
│   ├── startup.test.mjs      # 启动冒烟测试
│   ├── smoke-kernel.mjs      # 内核启动冒烟测试
│   ├── kernel-version.json   # 内核锁定版本（上游同步目标）
│   └── node-version.json     # 便携 Node 版本
└── .github/workflows/
    ├── sync-upstream.yml     # 每日上游检查 + 自动 PR
    └── release.yml           # 打 tag 构建三平台安装包
```

## 常见问题

**这是 DeepSeek 官方产品吗？**
不是。这是围绕官方开源内核 `@deepseek-ai/dsh` 的社区桌面壳。Harness 本身的问题请提给上游；窗口、安装包、更新器的问题请提到本仓库。

**需要先装 Node.js 或 npm 吗？**
不需要。便携 Node 运行时已打进安装包。（只有从源码构建才需要 Node。）

**能离线使用吗？**
首次启动可以离线——内核就在安装包里。检查/应用内核更新需要联网；Windows 上缺少 WebView2 时安装那一步也需要联网。

**数据存在哪里？怎么彻底卸载？**
运行期数据在系统应用数据目录下：

| 系统 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\com.dsh.desktop\` |
| macOS | `~/Library/Application Support/com.dsh.desktop/` |
| Linux | `~/.local/share/com.dsh.desktop/` |

其中：`kernel/` 是已安装的 dsh 内核，`dsh-home/` 是你的 `DSH_HOME`（profile、会话、插件），`kernel.old/` 是用于回滚的上一版内核，`logs/kernel.log` 是日志。卸载应用**不会**删除该目录；想要干净重来请手动删除。**如果 `dsh-home/` 里有你在意的数据，先备份。**

**能继续用我现有的 dsh 配置和插件吗？**
可以。DSH Desktop 尊重 `DSH_HOME`，内核升级过程中永不覆盖——这正是壳核分离的意义。

**我怎么知道当前跑的是哪个内核版本？**
对应外壳版本的 Release 说明里会写明锁定的内核版本。磁盘上可以看 `kernel/.dsh-kernel-version`，或 `kernel/node_modules/@deepseek-ai/dsh/package.json` 的 `version` 字段。

**会把我的代码或数据发到别处吗？**
外壳自身不上报任何数据。内核在本机 `127.0.0.1` 上运行，访问的是 DeepSeek Harness 自己配置的端点——和你手动跑 CLI 完全一致。

**为什么没有 Intel Mac 版 / `.rpm` / AppImage？**
技术上没有障碍，只是还没进发布矩阵。可以从源码构建，或提 issue。

**能同时开多个实例吗？**
不能，应用是单实例的。重复启动只会聚焦已有窗口，不会起第二个内核。

## 故障排查

**安装时提示「Windows 已保护你的电脑」**
正常现象——构建未做代码签名。点 **更多信息 → 仍要运行**。

**macOS 提示应用已损坏或来自未识别的开发者**
尚未配置公证。右键应用 → **打开**，或执行 `xattr -dr com.apple.quarantine "/Applications/dsh-desktop.app"`。

**窗口一直停在启动画面 / 提示「内核启动超时」**
查看日志 `%APPDATA%\com.dsh.desktop\logs\kernel.log`（macOS/Linux 见上表对应目录）。日志约 2 MB 轮转，启动 URL 中的认证 token 不会写入日志，可以放心贴出来。

**升级后内核起不来**
上一版内核保留在 `kernel.old/`。退出应用，删除 `kernel/`，把 `kernel.old/` 改名为 `kernel/`，再启动。

**关掉窗口后 Harness 去哪了？**
关闭窗口即停止内核并退出应用。用托盘图标 → **Show dsh-desktop** 可以重新打开，或者直接重新启动应用。

**内核升级一直卡在下载**
`Apply Update` 是真的在跑一次 `npm install` 安装 dsh 的依赖树，网络慢时 2–4 分钟很正常。进度会实时输出到启动画面。

## License

[MIT](LICENSE)

DSH Desktop 是独立项目，与 DeepSeek 无隶属、背书或赞助关系。「DeepSeek」「DeepSeek Harness」指本项目所封装的官方开源项目。
