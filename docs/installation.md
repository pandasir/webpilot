# Local installation

## Desktop app and terminal PATH

The desktop app may include its own Codex CLI without adding `codex` to your terminal PATH. A `command not found` error does not establish that desktop plugin support is unavailable. On the macOS installation tested here, the bundled executable is:

```sh
"/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" plugin marketplace add /Users/edy/www/webpilot/.webpilot/marketplace
"/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" plugin add webpilot@webpilot-local
"/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" plugin list
```

Use your actual application and marketplace paths; other versions/installations may differ. If WebPilot is already `installed, enabled`, skip installation. Restart the desktop app and open a new chat to check workflow discovery; an existing chat does not automatically gain newly installed tools. A desktop Plugins Directory can also expose configured local marketplaces, subject to host support. See the official packaging guide linked below.

## Windows desktop (PowerShell)

Install Windows Node.js 22+ with npm and a plugin-capable Codex desktop app. Open a new PowerShell window in the WebPilot checkout and prepare the package:

```powershell
node --version
npm.cmd --version
npm.cmd ci --ignore-scripts
npm.cmd run build
node dist/cli/index.js setup
node dist/cli/index.js doctor
node scripts/package-plugin.mjs .webpilot/marketplace
```

Check `Get-Command codex.exe, codex.cmd -ErrorAction SilentlyContinue` for an existing CLI. If none is available, install the [official Codex CLI](https://developers.openai.com/codex/cli) with `npm.cmd install -g @openai/codex`, reopen PowerShell, and return to the checkout. For the npm-installed CLI:

```powershell
$WebPilotCodex = (Get-Command codex.cmd -ErrorAction Stop).Source
$WebPilotMarketplace = (Resolve-Path -LiteralPath ".webpilot\marketplace").Path
& $WebPilotCodex --version
& $WebPilotCodex plugin --help
& $WebPilotCodex plugin marketplace add "$WebPilotMarketplace"
& $WebPilotCodex plugin add webpilot@webpilot-local
& $WebPilotCodex plugin list --marketplace webpilot-local
```

For an existing standalone or desktop-bundled `codex.exe`, set `$WebPilotCodex` to its actual full path instead. No fixed Windows desktop installation path is assumed. PowerShell's `&` invokes executable paths containing spaces; `.cmd` entry points avoid selecting PowerShell `.ps1` wrappers when script execution is restricted.

If `plugin add` is unavailable in your CLI version, register the marketplace, restart the desktop app, select **WebPilot Local** in the Plugins Directory, and install/enable WebPilot there, subject to host support. Keep the CLI and desktop app on the same Windows user and `CODEX_HOME`. Restart the app and open a new chat to check the four WebPilot skills.

Prepare native Windows dependencies and Chromium on Windows. A WSL installation has its own runtime, browser and configuration; prepare it separately. These instructions follow the [official Windows guide](https://developers.openai.com/codex/windows) and plugin packaging guide; WebPilot has not yet completed Windows machine acceptance (see [compatibility.md](compatibility.md)).

## Build and install

Node.js 22+ is required. In the WebPilot source checkout:

```sh
npm ci --ignore-scripts
npm run build
node dist/cli/index.js doctor --data-dir /path/to/writable/webpilot-data
node dist/cli/index.js setup
node scripts/package-plugin.mjs /path/to/webpilot-marketplace
codex plugin marketplace add /path/to/webpilot-marketplace
codex plugin add webpilot@webpilot-local
```

The marketplace contains a self-contained plugin copy with its own Node dependencies. Target applications do not install WebPilot. The portable manifest and a Codex compatibility overlay are included; neither defines lifecycle hooks.

## 核对源码、发行包与运行时版本

源码版本以 package.json.version 为准，插件清单及锁文件根字段必须一致。维护者明确改版后执行 `npm run version:sync`；普通安装与构建不会自动改写这些清单。

```sh
npm run check:version
npm run build
npm run check:version -- --built
node scripts/package-plugin.mjs /path/to/webpilot-marketplace
node /path/to/webpilot-marketplace/plugins/webpilot/dist/cli/index.js doctor --data-dir /path/to/writable/version-check-data
```

打包直接入口也会拒绝缺少构建元数据或与源码不一致的旧 dist，暂存包校验失败不会替换已有有效发行目录。输出应使用新目录、空目录或可识别的单插件 WebPilot Local 市场，其他非空目录会被拒绝。成功后，包内 package.json、plugin.json、.codex-plugin/plugin.json、锁文件根字段和 doctor.version 必须一致。使用新连接调用 runtime_info 并核对 MCP serverInfo.version，可确认实际加载了哪份执行器。

构建快照缺失或损坏时重新运行完整 build 并重新打包；已安装包损坏时重装完整包，不单独复制清单或 release.json。更新文件不会改变已运行进程的发布身份，需要重新启动相应进程/会话后核对。回滚也使用完整旧发行包；历史报告与已有独立导出包保留原版本记录。

Refresh installed files after rebuilding the source and packaging. Start a new Codex session so skills and tools can be loaded. Keep an earlier marketplace package to roll back. `codex plugin remove webpilot@webpilot-local` removes the installed plugin; saved test data remains in WebPilot storage. To remove its catalog too, use `codex plugin marketplace remove webpilot-local`. To restore, re-register the earlier marketplace package and install again.

Official packaging reference: https://developers.openai.com/plugins/build/plugins . Local plugin support varies by host. `node scripts/host-check.mjs /path/to/webpilot-marketplace` checks a fresh installed Codex binary's package parsing and a real packaged MCP handshake without starting a model turn or creating a user chat. It does not prove desktop UI installation or active-session refresh.

Tested host: Codex 0.162.0-alpha.17.2 on macOS arm64. This version supports `plugin add` and `plugin remove`; the official guide still emphasizes desktop installation, so check `codex plugin --help` when using another version. Full compatibility and limitations are in [compatibility.md](compatibility.md).
