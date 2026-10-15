# WebPilot

面向 Codex 的本地 Web UI 验收与回归插件。接入任意可在浏览器访问的前端项目：React、Vue、Next.js、静态 HTML 或未知框架均可用 URL 测试，无需向目标项目安装测试依赖或添加 test id。

Codex 根据需求规划和诊断；本地执行器负责真实 Chromium 操作、明确断言、证据与不可变用例。保存的回归用例可通过 CLI 无模型重跑，也可导出独立 Playwright 测试包。

## 快速开始

### 推荐：一句话让 Codex 安装（macOS / Windows）

打开 Codex 桌面版聊天，复制发送下面这句话：

> 帮我把 https://github.com/pandasir/webpilot 的 WebPilot 插件安装到当前 Codex 桌面版，按仓库 README 的手动步骤自动适配 macOS 或 Windows，完成安装和检查，并告诉我重启后的验证方法。

Codex 可代你下载仓库、检查 Node.js 22+ / npm、安装依赖、构建、准备 Chromium、打包本地市场并安装插件；已有本地仓库时可直接使用。仓库和生成的本地市场应保留在固定目录，供后续更新使用。安装能力取决于当前宿主是否支持插件，以及聊天的网络和文件权限；遇到缺少运行环境或需要桌面操作的步骤时，Codex 应说明具体需要你完成的操作。

安装完成后，完全退出并重新打开 Codex 桌面应用，创建一个**新聊天**，检查四个 WebPilot Skill 是否可用。当前安装聊天不会自动加载新工具。

希望手动安装时，按下面的步骤操作。

### 1. 准备运行环境与插件包

要求 Node.js 22+、npm，以及支持插件的 Codex 桌面版或 CLI。WebPilot 需要本地 Node.js 和 Chromium；桌面版自带的 Codex CLI 不会替代 Node.js。

在终端进入 WebPilot 仓库根目录，先确认版本，再安装依赖、构建并准备 Chromium。Windows 用户使用 PowerShell；若提示 `npm.ps1` 无法加载，将下方 `npm` 换成 `npm.cmd`：

```sh
node --version
npm --version
npm ci --ignore-scripts
npm run build
node dist/cli/index.js setup
node dist/cli/index.js doctor
node scripts/package-plugin.mjs .webpilot/marketplace
```

`setup` 首次运行会下载 Chromium，需要网络连接；`doctor` 输出 `ready: true` 表示 Node.js、浏览器和存储检查通过。打包后生成 `.webpilot/marketplace`，其中包含插件、运行依赖和本地市场清单，无需在待测前端项目中安装 WebPilot。

### 2. 安装到 Codex 桌面版

#### macOS

桌面版用户的终端可能没有 `codex` 命令，出现 `command not found` 时可使用应用自带 CLI 的完整路径。本项目实测的 macOS 安装位于 `ChatGPT.app`，在同一个终端、WebPilot 仓库根目录执行：

```sh
WEBPILOT_CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"
"$WEBPILOT_CODEX" plugin --help
"$WEBPILOT_CODEX" plugin marketplace add "$PWD/.webpilot/marketplace"
"$WEBPILOT_CODEX" plugin add webpilot@webpilot-local
"$WEBPILOT_CODEX" plugin list --marketplace webpilot-local
```

`WEBPILOT_CODEX` 仅用于上述终端命令，无需修改 PATH。此路径不是所有桌面版本的固定路径；若出现 `No such file or directory`，请改为实际应用内的 Codex CLI 路径。当前命令已在 macOS arm64、Codex CLI `0.162.0-alpha.17.2` 验证；其他版本先通过 `plugin --help` 确认是否支持对应命令。

**已有 Codex CLI 的用户**也可以在仓库根目录使用以下命令完成注册与安装：

```sh
codex plugin marketplace add "$PWD/.webpilot/marketplace"
codex plugin add webpilot@webpilot-local
codex plugin list --marketplace webpilot-local
```

#### Windows（PowerShell）

先安装 Windows 版 Node.js 22+（含 npm），并安装、登录支持插件的 Codex 桌面版。重新打开 PowerShell，在 WebPilot 仓库根目录完成第 1 步；这些构建与浏览器准备命令也适用于 PowerShell。原生 Windows 安装在 Windows 中构建、下载 Chromium 和打包，WSL 环境需单独准备，不能混用其中的 `node_modules` 和浏览器安装。

先检查终端能否找到 CLI：

```powershell
Get-Command codex.exe, codex.cmd -ErrorAction SilentlyContinue
```

若找不到，可按 [OpenAI 官方 CLI 安装说明](https://developers.openai.com/codex/cli) 安装 CLI，供下面的市场注册命令使用：

```powershell
npm.cmd install -g @openai/codex
```

安装后重新打开 PowerShell，回到 WebPilot 仓库根目录。npm 安装的 CLI 使用 `codex.cmd`；若上一步找到的是桌面版自带或独立安装的 `codex.exe`，将 `$WebPilotCodex` 改成该可执行文件的完整路径。Windows 桌面版的安装位置可能因发行方式和版本不同而变化，无需套用 macOS 路径。

```powershell
$WebPilotCodex = (Get-Command codex.cmd -ErrorAction Stop).Source
$WebPilotMarketplace = (Resolve-Path -LiteralPath ".webpilot\marketplace").Path

& $WebPilotCodex --version
& $WebPilotCodex plugin --help
& $WebPilotCodex plugin marketplace add "$WebPilotMarketplace"
& $WebPilotCodex plugin add webpilot@webpilot-local
& $WebPilotCodex plugin list --marketplace webpilot-local
```

PowerShell 中使用 `&` 调用变量里的程序路径，路径带空格也适用。若当前 CLI 没有 `plugin add` 子命令，注册市场后重启桌面应用，在插件目录中选择 **WebPilot Local**，安装并启用 WebPilot；本地市场的可用性取决于宿主版本。桌面操作见 [OpenAI 官方插件打包与本地安装说明](https://developers.openai.com/plugins/build/plugins)。

上述 Windows 步骤依据官方 Windows/CLI 指南和本项目打包方式编写，尚未完成 Windows 实机验收；已验证的平台与限制见 [兼容记录](docs/compatibility.md)。

#### 安装后检查（两个平台相同）

检查列表中的 `webpilot@webpilot-local` 是否为 `installed, enabled`；若已安装并启用，可跳过重复安装。然后：

1. 完全退出并重新打开 Codex 桌面应用。
2. 打开待测前端项目，创建一个**新聊天**；已有聊天不会自动获得新安装的插件工具。
3. 检查是否能找到 `webpilot:verify`、`webpilot:replay`、`webpilot:diagnose`、`webpilot:export` 四个 Skill。

宿主支持本地市场时，也可在桌面版插件目录（Plugins Directory）中查看已注册的市场与 WebPilot；具体界面以当前版本为准。安装状态与新聊天中的 Skill / MCP 工具加载需分别检查。

桌面版与终端 CLI 应使用同一用户及同一 Codex 配置目录；自定义 `CODEX_HOME` 时需保持一致，避免装到另一个配置环境。

### 3. 在新聊天中验收前端

先启动待测前端服务，确认 URL 可访问，再在新 Codex 聊天调用 `$webpilot:verify`，例如：

> 验收 http://localhost:3000 的登录表单：错误密码显示 Invalid password，并保持在登录页；保存回归用例。

另有 `$webpilot:replay`、`$webpilot:diagnose`、`$webpilot:export`。插件不通过生命周期 hook 自动运行；在修改代码任务中明确要求验收即可。宿主的安装和加载能力存在版本差异，见 [安装说明](docs/installation.md)。

### 安装常见问题

| 现象 | 处理方式 |
|---|---|
| 终端找不到 `codex` | macOS 可使用上面的桌面版自带 CLI 路径；Windows 按上节检查 `codex.exe` / `codex.cmd`，或安装官方 CLI 后重新打开 PowerShell。 |
| PowerShell 提示 `npm.ps1` / `codex.ps1` 无法加载 | 使用 `npm.cmd` / `codex.cmd`；上面的 Windows 示例已采用此写法。 |
| `plugin` 或 `plugin add` 命令不可用 | 检查 `plugin --help`，确认使用的是支持该命令的宿主版本。 |
| 找不到 `webpilot-local` 或插件 | 确认已执行打包，且注册的是生成的 `.webpilot/marketplace` 目录，而非源码根目录。 |
| 已安装但聊天里没有 Skill / 工具 | 确认插件已启用、配置目录一致，并完全重启应用后创建新聊天。 |
| Chromium 不可用 | 在 WebPilot 仓库运行 `node dist/cli/index.js setup`，再用 `doctor` 检查。 |
| MCP 启动提示找不到 `node` | 确认桌面宿主能找到 Node.js 22+；若 Node 仅由终端初始化脚本加入 PATH，需检查桌面应用的运行环境。 |

更新、卸载、回滚和更详细的宿主检查见 [安装说明](docs/installation.md)；插件机制参考 [OpenAI 官方插件文档](https://developers.openai.com/codex/plugins)，Windows 环境参考 [OpenAI 官方 Windows 指南](https://developers.openai.com/codex/windows)。

### 直接使用 WebPilot CLI

直接使用 CLI：准备 [计划与绑定文件](docs/interfaces.md)，然后运行：

```sh
node dist/cli/index.js run --plan plan.json --bindings /path/to/bindings.json
node dist/cli/index.js replay --run RUN_ID
node dist/cli/index.js export --run RUN_ID --out /path/to/new-tests
```

## 支持范围

- 语义定位、表单、条件等待、iframe、新页面、上传与下载检查。
- 来源可追溯的正式断言；AI 推测保持候选，缺口不会被算作通过。
- passed / failed / blocked / inconclusive，保留失败重试与不稳定标记。
- 独立角色 context、外部登录态、数据 prepare/cleanup、服务所有权管理。
- JSON/Markdown 报告、脱敏快照与截图；所有浏览器尝试默认录制本地 WebM 流程录像，报告提供播放器入口。原始敏感 trace 默认关闭，仅显式本地保留。
- 草稿及不可变用例版本；晋升前独立重跑；业务标准修改需新依据与采纳记录。

首版使用 Chromium；Canvas 视觉操作、移动硬件等价、多浏览器和穷尽全站覆盖尚未实现。应用本身的启动环境、业务预期、登录及数据准备仍需提供；“通用”指框架无关的接入与执行能力。

流程录像在运行结束后可通过 `playbackPath` 打开本地 `recordings.html` 观看，支持播放、暂停和拖动进度。通过、失败、重试和弹出页面均保留录像；默认保存 7 天。录像未经脱敏，只保存在本机；设置 `target.evidence.video:false` 或项目配置的 `evidence.video:false` 关闭。详情见 [录像配置](docs/project.md) 和 [报告说明](docs/reporting.md)。

## 开发与验证

```sh
npm run typecheck
npm test
npm ci --ignore-scripts --prefix tests/fixtures
node scripts/compatibility-check.mjs
node scripts/host-check.mjs .webpilot/marketplace
```

测试需要 loopback 服务和 Chromium 进程权限。五类真实样例及缺陷集结果见 [兼容记录](docs/compatibility.md)。完整接口见 [工具/CLI](docs/interfaces.md)，另有 [接入](docs/project.md)、[规划](docs/planning.md)、[报告](docs/reporting.md)、[资产](docs/assets.md) 与 [独立导出](docs/export.md)。
