# WebPilot

面向 Codex 的本地 Web UI 验收与回归插件。接入任意可在浏览器访问的前端项目：React、Vue、Next.js、静态 HTML 或未知框架均可用 URL 测试，无需向目标项目安装测试依赖或添加 test id。

Codex 根据需求规划和诊断；本地执行器负责真实 Chromium 操作、明确断言、证据与不可变用例。保存的回归用例可通过 CLI 无模型重跑，也可导出独立 Playwright 测试包。

首次使用先看[快速开始](#快速开始)；已安装插件可直接看[使用指南](#使用指南)，命令行与 CI 接入见[直接使用 WebPilot CLI](#直接使用-webpilot-cli)。

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

先启动待测前端服务，确认 URL 可访问，再在新 Codex 聊天发送：

> $webpilot:verify 验收 http://localhost:3000 的登录表单：错误密码显示 Invalid password，并保持在登录页；保存回归用例。

将 URL 和预期提示替换成自己项目的实际内容。如何准备需求、查看结果、复跑和导出，见下方[使用指南](#使用指南)。

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

## 使用指南

### 先选要做的事

在安装后新建的 Codex 聊天里发送需求即可；下面的 `$webpilot:...` 是聊天中的 Skill 调用写法，不是终端命令。

| 你想做什么 | 使用哪个 Skill | 需要提供什么 |
|---|---|---|
| 验收新功能或本次改动 | `$webpilot:verify` | 页面 URL、操作流程、预期结果；可要求保存回归用例 |
| 改完代码后重跑已有用例 | `$webpilot:replay` | 用例 ID 和版本，或先前运行 ID；当前 URL 和必要运行参数 |
| 分析一次失败 | `$webpilot:diagnose` | 失败的运行 ID，或能定位该运行的报告路径 |
| 生成项目或 CI 可独立运行的测试 | `$webpilot:export` | 要导出的用例/计划、一个新的输出目录 |

### 第一次验收：从打开项目到查看结果

1. 在 Codex 中打开**待测前端项目**。WebPilot 安装在本机即可，待测项目无需安装 WebPilot 依赖。
2. 启动项目及其必要后端，确认浏览器能打开目标 URL。也可提供已经运行的测试环境 URL；只有 URL、没有源码同样能测页面行为。
3. 告诉 Codex 要测什么、怎样才算正确，以及需要的测试身份或数据。
4. 查看本次覆盖范围、每项结论和证据；如需后续复跑，明确要求保存回归用例。

例如，项目实际要求错误密码显示 `Invalid password`，可复制以下需求并替换地址、字段名称和提示文案：

> $webpilot:verify 验收 http://localhost:3000/login 的登录功能：用测试邮箱和错误密码提交后，应显示“Invalid password”，地址仍为 http://localhost:3000/login；请使用真实浏览器执行，保存 ID 为 invalid-password 的回归用例，并给出运行 ID、用例 ID/版本、中文报告路径和录像播放路径。

Codex 会检查目标和运行环境、根据需求与页面观察生成步骤，再执行操作和断言。你通常无需自己写选择器或计划 JSON。要求保存时，用例需在独立浏览器上下文中再次稳定通过，才能成为正式回归用例；未满足条件的内容保留为草稿或缺口。保存验证可能会再次提交表单或触发业务操作，因此要准备可重复使用的测试数据。

**需求写得越明确，验收结论越有依据。**建议提供以下信息；不需要的项可以省略：

```text
$webpilot:verify
目标：http://localhost:3000/products
范围：商品搜索和分类筛选
前置条件：测试环境已有商品“蓝色杯子”，属于“家居”分类
操作与预期：
1. 搜索“蓝色杯子”，列表中应出现该商品。
2. 选择“家居”，结果应保留该商品。
3. 清空搜索与分类，列表应恢复初始结果。
保存：保存可重复执行的回归用例。
交付：中文测试结论、未覆盖项、运行 ID、用例版本、报告与录像路径。
```

如果只说“帮我测试这个页面”，Codex 可以观察页面并提出检查项；未获需求或用户确认支持的业务预期仍是候选，不能据此宣布正式验收通过。

### 常见使用场景

**改完代码，立即验收**：可以把实现和验收写在同一条任务中。插件不通过生命周期 hook 自动运行，需要明确要求使用 WebPilot。

> 修复商品列表的筛选问题，然后用 $webpilot:verify 验收 http://localhost:3000/products：选择“家居”后只显示该分类商品，清空筛选后恢复初始列表；保存回归用例并给出结果。

**服务尚未启动**：告诉 Codex 项目位置、要启动的应用和启动方式；多应用仓库需要指定应用。WebPilot 会检查启动候选，发现候选不代表已经执行启动，目标项目缺少的依赖也需要另行准备。

> $webpilot:verify 验收当前仓库的 apps/shop 应用，先检查 package.json 的开发启动命令并启动必要服务，使用启动后的实际 URL 测试搜索“蓝色杯子”能找到该商品；后端地址使用项目现有测试配置，缺少配置时明确报告阻塞。

**只有网站 URL**：可直接验收浏览器能访问的页面；没有源码时，报告会说明无法分析代码改动和源码根因。

> $webpilot:verify 验收 https://staging.example.com/help：搜索“退款”后，结果中应出现“退款说明”；只覆盖这个查询流程。

**需要登录或测试数据**：指定测试角色、登录成功的可观察标志、数据准备与清理方式。已登录的日常浏览器不会自动成为 WebPilot 的登录态；需提供测试登录流程或外部登录态引用。账号、文件等可通过运行时 bindings 提供，具体配置见[项目接入](docs/project.md)和[接口说明](docs/interfaces.md)。

> $webpilot:verify 验收测试环境的订单页，使用 buyer 测试角色，先确认页面显示“我的订单”再继续；创建一条测试订单后应能在列表中找到它，结束后用项目的测试清理脚本移除本次数据；先检查身份和数据配置是否齐备。

**检查窄屏布局**：可指定视口，但这代表浏览器视口检查，不等于真实移动设备验收。

> $webpilot:verify 以 390×844 视口验收 http://localhost:3000：点击菜单按钮后导航列表应可见，再次点击后应隐藏；报告中标明本次视口。

### 保存后，怎样重跑和诊断

记下首次验收返回的**用例 ID、版本、运行 ID 和存储位置**。示例中的 `invalid-password`、版本 `1` 和 `RUN_ID` 都应替换为实际返回的值；若上一步没有保存成功，需先完成用例保存。

修改页面代码后，在同一聊天或能访问这些资产的新聊天中发送：

> $webpilot:replay 重跑已保存的 invalid-password 第 1 版，目标为 http://localhost:3000/login；保持原有预期，报告运行 ID、各步骤结果和录像播放路径。

也可指定一次完整运行作为复跑依据：

> $webpilot:replay 重跑运行 RUN_ID 对应的测试计划，目标改为 http://localhost:3001/login，使用本次提供的测试环境参数。

重跑会重新操作浏览器。目标地址、测试身份、文件和数据准备仍需可用；缺失时会报告阻塞。更换登录态、端口或测试数据不意味着可以修改原用例的业务预期。用例版本不可覆盖；正式需求改变时，应说明新依据并保存新版本。

失败后先诊断，再按需要修复：

> $webpilot:diagnose 分析运行 RUN_ID，列出失败步骤的预期、实际结果和证据，区分已确认事实与可能原因，并给出复现方法。

需要一起修代码时可追加：“修复已确认的问题，然后用原用例复跑。”单独诊断不会自动授权修改产品代码，也不应通过放宽断言掩盖失败。

### 怎样看报告、截图和录像

完整测试运行会保存 `report.md` 和 `report.json`；报告包含运行 ID、目标、视口、覆盖范围、缺口、用例版本、步骤结果、可用证据与复现入口。可要求 Codex：“打开刚才的中文测试报告，并给出失败步骤的截图链接。”

| 状态 | 表示什么 | 接下来怎么做 |
|---|---|---|
| `passed`（通过） | 本次要求的正式断言均已满足 | 结合覆盖范围判断是否足够，必要时保存用例 |
| `failed`（失败） | 实际结果违反明确预期 | 用运行 ID 诊断，修复后按原用例复跑 |
| `blocked`（受阻） | 环境、权限、身份或数据阻止执行 | 补齐对应条件后重跑 |
| `inconclusive`（无法确定） | 预期、证据或能力不足，或执行未完成 | 补充预期、消除定位歧义或解决报告中的缺口 |

重试后才通过的结果会标记为不稳定，不能当成稳定通过；没有覆盖的页面和流程也不属于本次通过范围。

观看已经录好的过程，可发送：“给我运行 RUN_ID 的录像播放路径。”用浏览器打开返回的 `playbackPath`（本地 `recordings.html`）即可播放、暂停和拖动进度，**无需调用 replay 重跑**。录像在运行结束、浏览器上下文关闭后定稿；缺失时以报告中的原因说明为准。

录像默认开启、仅保存在本机，未经脱敏，默认保留 7 天。需要关闭时可在验收需求中说明“本次不录制流程录像”，对应 `target.evidence.video:false`。截图和页面快照采用独立的脱敏配置，详情见[报告说明](docs/reporting.md)。

### 导出给项目或 CI 独立运行

当你希望离开 Codex 也能执行这些回归测试时，使用导出功能。输出目录必须是**尚不存在的新目录**：

> $webpilot:export 将运行 RUN_ID 的测试计划导出到当前项目下尚不存在的 tests/webpilot-login 目录，保留原断言和等待条件，列出外部登录态、数据和配置要求，并在相同目标及等价测试数据下验证导出包。

导出目录包含测试文件、配置、README 和运行内核快照。独立执行需要 Node.js、浏览器及其依赖，不需要 WebPilot 插件或模型凭证。进入返回的输出目录后，按包内 README 安装和执行，例如 macOS：

```sh
npm install --ignore-scripts
npx playwright install chromium
BASE_URL=http://localhost:3000 npm test
```

Windows PowerShell：

```powershell
npm.cmd install --ignore-scripts
npx.cmd playwright install chromium
$env:BASE_URL = "http://localhost:3000"
npm.cmd test
```

需要身份、文件或数据脚本时，按导出说明提供外部 bindings / target config。生成文件不代表验证通过；查看 `manifest.json` 的 `verified` 标记和验证报告。交给 CI 时复制整个导出目录，保留安装后生成的 lockfile，并准备目标服务、Chromium、系统依赖和外部参数，详见[独立导出](docs/export.md)。

### 直接使用 WebPilot CLI

已有结构化计划时，可在终端无模型执行。从 **WebPilot 源码仓库根目录**运行以下命令；其他位置需使用 WebPilot 的绝对入口。CLI 不要求在待测项目中安装 WebPilot。

先按[计划与绑定文件示例](docs/interfaces.md)准备 `plan.json` 和需要的 bindings；也可让 Codex 将已经确认的验收计划写成这些文件。下面统一使用 `.webpilot/data` 存储，`RUN_ID`、用例 ID/版本、URL 和输出目录须替换成实际值：

```sh
# 执行计划；需要运行参数时追加 --bindings /path/to/bindings.json
node dist/cli/index.js run --plan plan.json --data-dir .webpilot/data

# 保存其中一条用例，独立重跑通过后晋升为正式回归用例
node dist/cli/index.js save --plan plan.json --case invalid-password --promote --data-dir .webpilot/data

# 重跑完整运行，或指定已保存的用例版本
node dist/cli/index.js replay --run RUN_ID --url http://localhost:3001 --data-dir .webpilot/data
node dist/cli/index.js replay --case invalid-password --version 1 --url http://localhost:3001 --data-dir .webpilot/data

# 读取 JSON 报告、导出到一个新目录
node dist/cli/index.js report --run RUN_ID --data-dir .webpilot/data
node dist/cli/index.js export --run RUN_ID --out ./new-test-package --data-dir .webpilot/data
```

以上 `node` 命令也可在 PowerShell 执行。用到 bindings 的 run / save / replay / export 命令都要传入相应参数。`--headful` 可用于执行测试时显示浏览器窗口。

CLI 与桌面插件必须使用同一个数据目录才能按 ID 找到同一份资产。默认存储在 WebPilot 用户缓存，可用 `doctor` 查看实际路径；示例中的 `.webpilot/data` 是显式覆盖目录，读取桌面插件创建的运行时应换成其实际目录。`--data-dir` 或 `WEBPILOT_DATA_DIR` 可指定存储位置，业务用例不要求放进目标项目。

CLI 退出码：`0` 稳定完整通过，`1` 正式断言失败，`2` 受阻、未完整验证或重试后通过，`3` 内部错误或无效调用。CI 应同时保留 JSON 报告以判断具体原因。更多命令与 schema 见[接口说明](docs/interfaces.md)。

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
