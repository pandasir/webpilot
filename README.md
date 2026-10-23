# WebPilot

WebPilot 是 Codex 的本地 Web UI 验收与回归插件。只要项目能在浏览器里打开就能接进来测：React、Vue、Next.js、静态 HTML，甚至不知道用什么框架的站点，都可以直接用 URL 跑。目标项目不用装测试依赖，也不用加 test id。

Codex 读需求、规划步骤、分析失败原因；本机执行器负责真实 Chromium 操作、断言和证据留存，用例一旦保存就不再修改。回归用例可以在 CLI 里不接模型重跑，也能导出成独立的 Playwright 测试包。

本地测试中心把多个聊天、多个项目的测试进度收在一个页面：浏览器直播、分步截图、报告和录像、两条运行并排看，还有运行重命名、归档永久保存和批量管理。

![WebPilot 本地测试中心：两条运行并排直播、步骤预期与实际结果、覆盖清单](assets/demo.gif)

## 目录

- [安装](#安装)
  - [让 Codex 自己装（推荐）](#让-codex-自己装推荐)
  - [手动准备环境与插件包](#手动准备环境与插件包)
  - [macOS 注册与安装](#macos-注册与安装)
  - [Windows 注册与安装](#windows-注册与安装)
  - [安装后检查](#安装后检查)
  - [安装问题排查](#安装问题排查)
- [使用](#使用)
  - [四个 Skill 怎么选](#四个-skill-怎么选)
  - [第一次验收](#第一次验收)
  - [先看覆盖清单](#先看覆盖清单)
  - [常见场景](#常见场景)
  - [重跑与诊断](#重跑与诊断)
  - [报告、截图与录像](#报告截图与录像)
  - [导出成独立测试包](#导出成独立测试包)
  - [直接用 CLI 跑](#直接用-cli-跑)
- [本地测试中心](#本地测试中心)
- [支持范围](#支持范围)
- [开发](#开发)
- [相关文档](#相关文档)

## 安装

需要 Node.js 22+、npm，以及支持插件的 Codex 桌面版或 CLI。WebPilot 自己要用本机 Node.js 和 Chromium，桌面版自带的 Codex CLI 顶不上 Node.js。

装法有两种：让 Codex 代你装，或者按下面的手动步骤来。两种方式装完，都要退出重开应用并新建聊天，见[安装后检查](#安装后检查)。

### 让 Codex 自己装（推荐）

打开 Codex 桌面版聊天，复制发送下面这句话：

> 帮我把 https://github.com/pandasir/webpilot 的 WebPilot 插件安装到当前 Codex 桌面版，按仓库 README 的手动步骤自动适配 macOS 或 Windows，完成安装和检查，并告诉我重启后的验证方法。

Codex 会替你下载仓库、检查 Node.js 22+ 和 npm、装依赖、构建、准备 Chromium、打包本地市场并安装插件；本地已有仓库就直接用。仓库和生成的本地市场放在固定目录，方便以后更新。

能不能装成，取决于当前宿主是否支持插件，以及聊天有没有网络和文件权限。碰到缺运行环境或需要手动点桌面的步骤，Codex 会说明要你自己做什么。

### 手动准备环境与插件包

在终端进入 WebPilot 仓库根目录，先看版本，再装依赖、构建、准备 Chromium。Windows 用 PowerShell；提示 `npm.ps1` 无法加载时，把下面的 `npm` 换成 `npm.cmd`：

```sh
node --version
npm --version
npm ci --ignore-scripts
npm run build
node dist/cli/index.js setup
node dist/cli/index.js doctor
node scripts/package-plugin.mjs .webpilot/marketplace
```

`setup` 第一次跑会下载 Chromium，要联网。`doctor` 输出 `ready: true`，说明 Node.js、浏览器和存储都检查通过。打包会生成 `.webpilot/marketplace`，里面有插件、运行依赖和本地市场清单；待测前端项目里不用装 WebPilot。

### macOS 注册与安装

桌面版的终端里可能没有 `codex` 命令，报 `command not found` 时用应用自带 CLI 的完整路径。本项目实测的 macOS 安装路径在 `ChatGPT.app` 里，在同一个终端、WebPilot 仓库根目录执行：

```sh
WEBPILOT_CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"
"$WEBPILOT_CODEX" plugin --help
"$WEBPILOT_CODEX" plugin marketplace add "$PWD/.webpilot/marketplace"
"$WEBPILOT_CODEX" plugin add webpilot@webpilot-local
"$WEBPILOT_CODEX" plugin list --marketplace webpilot-local
```

`WEBPILOT_CODEX` 只在上面这几条命令里用，不用改 PATH。这个路径不是所有桌面版本都一样，报 `No such file or directory` 就换成你应用里实际的 Codex CLI 路径。以上命令在 macOS arm64、Codex CLI `0.162.0-alpha.17.2` 上验证过；别的版本先用 `plugin --help` 确认支持这些子命令。

已经有 Codex CLI 的话，在仓库根目录用这几条命令注册并安装：

```sh
codex plugin marketplace add "$PWD/.webpilot/marketplace"
codex plugin add webpilot@webpilot-local
codex plugin list --marketplace webpilot-local
```

### Windows 注册与安装

先装 Windows 版 Node.js 22+（自带 npm），再装好并登录支持插件的 Codex 桌面版。重开 PowerShell，在 WebPilot 仓库根目录做[手动准备环境与插件包](#手动准备环境与插件包)那一步；构建和准备浏览器的命令在 PowerShell 里同样能跑。

原生 Windows 环境要在 Windows 里构建、下载 Chromium 和打包。WSL 要单独准备，两边的 `node_modules` 和浏览器安装不能混用。

先检查终端能否找到 CLI：

```powershell
Get-Command codex.exe, codex.cmd -ErrorAction SilentlyContinue
```

找不到就按 [OpenAI 官方 CLI 安装说明](https://developers.openai.com/codex/cli) 装一个，下面的市场注册命令要用：

```powershell
npm.cmd install -g @openai/codex
```

装完重开 PowerShell，回到 WebPilot 仓库根目录。npm 装的 CLI 是 `codex.cmd`；如果上一步找到的是桌面版自带或单独安装的 `codex.exe`，就把 `$WebPilotCodex` 改成那个可执行文件的完整路径。Windows 桌面版装在哪里随发行方式和版本不同，别照抄 macOS 的路径。

```powershell
$WebPilotCodex = (Get-Command codex.cmd -ErrorAction Stop).Source
$WebPilotMarketplace = (Resolve-Path -LiteralPath ".webpilot\marketplace").Path

& $WebPilotCodex --version
& $WebPilotCodex plugin --help
& $WebPilotCodex plugin marketplace add "$WebPilotMarketplace"
& $WebPilotCodex plugin add webpilot@webpilot-local
& $WebPilotCodex plugin list --marketplace webpilot-local
```

PowerShell 里用 `&` 调用变量里的程序路径，路径带空格也没问题。

当前 CLI 没有 `plugin add` 子命令时，注册完市场重启桌面应用，在插件目录里选 **WebPilot Local**，装上并启用；本地市场能不能用要看宿主版本。桌面上的操作见 [OpenAI 官方插件打包与本地安装说明](https://developers.openai.com/plugins/build/plugins)。

上面的 Windows 步骤是按官方 Windows/CLI 指南和本项目打包方式写的，还没在 Windows 实机上验收过。已验证的平台和限制见 [兼容记录](docs/compatibility.md)。

### 安装后检查

先看列表里的 `webpilot@webpilot-local` 是不是 `installed, enabled`，已经装好并启用就不用再装。然后：

1. 完全退出并重新打开 Codex 桌面应用。
2. 打开待测前端项目，创建一个新聊天。已有聊天不会自动获得新安装的插件工具。
3. 检查是否能找到 `webpilot:verify`、`webpilot:replay`、`webpilot:diagnose`、`webpilot:export` 四个 Skill。

宿主支持本地市场的话，桌面版的插件目录（Plugins Directory）里也能看到已注册的市场和 WebPilot，界面以当前版本为准。安装状态和新聊天里 Skill / MCP 工具有没有加载，要分开检查。

桌面版和终端 CLI 要用同一个用户、同一个 Codex 配置目录。自定义了 `CODEX_HOME` 就保持一致，否则会装到另一个配置环境里。

### 安装问题排查

| 现象 | 处理方式 |
|---|---|
| 终端找不到 `codex` | macOS 使用上面的桌面版自带 CLI 路径；Windows 检查 `codex.exe` / `codex.cmd`，或安装官方 CLI 后重新打开 PowerShell。 |
| PowerShell 提示 `npm.ps1` / `codex.ps1` 无法加载 | 使用 `npm.cmd` / `codex.cmd`；上面的 Windows 示例已采用此写法。 |
| `plugin` 或 `plugin add` 命令不可用 | 检查 `plugin --help`，确认使用的是支持该命令的宿主版本。 |
| 找不到 `webpilot-local` 或插件 | 确认已执行打包，且注册的是生成的 `.webpilot/marketplace` 目录，而非源码根目录。 |
| 已安装但聊天里没有 Skill / 工具 | 确认插件已启用、配置目录一致，并完全重启应用后创建新聊天。 |
| Chromium 不可用 | 在 WebPilot 仓库运行 `node dist/cli/index.js setup`，再用 `doctor` 检查。 |
| MCP 启动提示找不到 `node` | 确认桌面宿主能找到 Node.js 22+；若 Node 仅由终端初始化脚本加入 PATH，需检查桌面应用的运行环境。 |

更新、卸载、回滚和更细的宿主检查见 [安装说明](docs/installation.md)。插件机制看 [OpenAI 官方插件文档](https://developers.openai.com/codex/plugins)，Windows 环境看 [OpenAI 官方 Windows 指南](https://developers.openai.com/codex/windows)。

## 使用

在装完插件后新建的 Codex 聊天里直接发需求。下面出现的 `$webpilot:...` 是聊天里调 Skill 的写法，别当终端命令用。

### 四个 Skill 怎么选

| 你想做什么 | 使用哪个 Skill | 需要提供什么 |
|---|---|---|
| 验收新功能或本次改动 | `$webpilot:verify` | 页面 URL、操作流程、预期结果；可要求保存回归用例 |
| 改完代码后重跑已有用例 | `$webpilot:replay` | 用例 ID 和版本，或先前运行 ID；当前 URL 和必要运行参数 |
| 分析一次失败 | `$webpilot:diagnose` | 失败的运行 ID，或能定位该运行的报告路径 |
| 生成项目或 CI 可独立运行的测试 | `$webpilot:export` | 要导出的用例/计划、一个新的输出目录 |

### 第一次验收

1. 在 Codex 里打开待测前端项目。WebPilot 装在本机就行，待测项目不用装它的依赖。
2. 启动项目和它依赖的后端，确认浏览器能打开目标 URL。已经在跑的测试环境也可以，直接给 URL 就行；没有源码，照样能测页面行为。
3. 告诉 Codex 要测什么、怎样才算正确，以及需要的测试身份或数据。
4. 看这次的覆盖范围、每项结论和证据。以后要复跑，就明确让它保存回归用例。

先启动待测前端服务，再在新 Codex 聊天发送类似这样的一句：

> $webpilot:verify 验收 http://localhost:3000 的登录表单：错误密码显示 Invalid password，并保持在登录页；保存回归用例。

把 URL 和预期提示换成自己项目的内容。执行前会打开本地测试中心，跑完从回复里的“本次测试详情”链接进去看这次运行。

Codex 先检查目标和运行环境，再结合需求和页面观察生成步骤，然后执行、断言。选择器和计划 JSON 一般不用你写。要求保存时，用例得在独立的浏览器上下文里再稳定通过一次，才算正式回归用例；没满足条件的留在草稿或记成缺口。保存验证可能再提交一次表单、触发一次业务操作，测试数据要能反复用。

需求可以按下面的格式写全，不需要的项直接省掉：

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
交付：中文测试结论、未覆盖项、可点击的测试中心本次测试详情链接、运行 ID、用例版本、报告与录像路径。最终回复必须附上本次运行链接，失败或受阻时也一样；执行前发送首页链接不能替代它。
```

只说“帮我测试这个页面”也行，Codex 会看页面提检查项。但没经过你确认的业务预期只能算候选，不能拿来宣布验收通过。

### 先看覆盖清单

verify/replay 先存一份覆盖清单，在聊天里列出本次选中的用例、AI 补的场景、缺的条件和范围外的建议，完整内容在测试中心侧栏“覆盖计划”里。默认展示完就直接执行，选择器和计划 JSON 都不用你写。

三种节奏可以在需求里说明：

| 说法 | 结果 |
|---|---|
| “验收商品搜索和分类筛选，并补充相关边界场景。” | 默认，展示清单后自动执行 |
| “先生成用例让我审阅，确认后再执行。” | 浏览器在明确采用具体版本后才启动 |
| “只生成搜索和筛选的测试用例，本次不要执行。” | 只保存清单，不启动目标服务、浏览器或数据准备脚本 |

AI 默认在两轮里补最多十二条相关场景，优先核心流程和高风险遗漏，你明确要求的验收点不会被删。它猜的业务规则只是候选，需求里没写的文案也不会被当成正式标准。已有回归用例保留原预期，新增建议单独列。跑完在运行详情的“覆盖清单”里逐项对结果，没执行的、没选用的建议都会写明原因。需求不完整时，报告不会说成覆盖了全站。

### 常见场景

#### 改完代码，立即验收

实现和验收可以写进同一条任务。插件不会通过生命周期 hook 自动跑，要明确说用 WebPilot。

> 修复商品列表的筛选问题，然后用 $webpilot:verify 验收 http://localhost:3000/products：选择“家居”后只显示该分类商品，清空筛选后恢复初始列表；保存回归用例并给出结果。

#### 服务还没启动

告诉 Codex 项目在哪、要起哪个应用、怎么起，多应用仓库得指明应用。WebPilot 会检查可用的启动命令，但找到命令不等于已经启动，项目缺的依赖还得另外装。

> $webpilot:verify 验收当前仓库的 apps/shop 应用，先检查 package.json 的开发启动命令并启动必要服务，使用启动后的实际 URL 测试搜索“蓝色杯子”能找到该商品；后端地址使用项目现有测试配置，缺少配置时明确报告阻塞。

#### 只有网站 URL

能访问的页面直接测。没有源码时，报告会写明分析不了代码改动和源码层面的原因。

> $webpilot:verify 验收 https://staging.example.com/help：搜索“退款”后，结果中应出现“退款说明”；只覆盖这个查询流程。

#### 需要登录或测试数据

说明测试角色、登录成功的判断标志、数据怎么准备和清理。你日常浏览器里已登录的账号不会自动带进 WebPilot，要么给测试登录流程，要么引用外部登录态。账号、文件这类东西通过运行时 bindings 传，配置见[项目接入](docs/project.md)和[接口说明](docs/interfaces.md)。

> $webpilot:verify 验收测试环境的订单页，使用 buyer 测试角色，先确认页面显示“我的订单”再继续；创建一条测试订单后应能在列表中找到它，结束后用项目的测试清理脚本移除本次数据；先检查身份和数据配置是否齐备。

#### 检查窄屏布局

可以指定视口，不过这只是浏览器视口检查，不等于真机验收。

> $webpilot:verify 以 390×844 视口验收 http://localhost:3000：点击菜单按钮后导航列表应可见，再次点击后应隐藏；报告中标明本次视口。

### 重跑与诊断

记下首次验收返回的用例 ID、版本、运行 ID 和存储位置。示例里的 `invalid-password`、版本 `1` 和 `RUN_ID` 换成你实际拿到的值；上一步没保存成功的话，先把用例存下来。

修改页面代码后，在同一聊天或能访问这些资产的新聊天中发送：

> $webpilot:replay 重跑已保存的 invalid-password 第 1 版，目标为 http://localhost:3000/login；保持原有预期，给出本次重跑的“本次测试详情”链接、运行 ID、各步骤结果和录像播放路径。

也可指定一次完整运行作为复跑依据：

> $webpilot:replay 重跑运行 RUN_ID 对应的测试计划，目标改为 http://localhost:3001/login，使用本次提供的测试环境参数。

重跑会重新操作一遍浏览器，目标地址、测试身份、文件和数据准备都得还在，缺了会报阻塞。换了登录态、端口或测试数据，不等于能改原用例的业务预期。用例版本不能覆盖；正式需求变了，要说明新依据，再存一个新版本。

失败后先诊断，再按需要修复：

> $webpilot:diagnose 分析运行 RUN_ID，列出失败步骤的预期、实际结果和证据，区分已确认事实与可能原因，并给出复现方法。

要一起修代码就追加一句：“修复已确认的问题，然后用原用例复跑。”单独诊断不会顺手改产品代码，也不该靠放宽断言把失败抹过去。

### 报告、截图与录像

verify/replay 执行前会打开本地测试中心，回复里附一个可点击的“本次测试详情”链接，点进去就是这次运行的时间线、截图、报告和录像。通过、失败、受阻、无法确定都会给链接，重跑后给的是新运行的。显式关掉测试中心或者拿不到链接时，回复会说明原因。

完整的一次运行会存下 `report.md` 和 `report.json`，里面有运行 ID、目标、视口、覆盖范围、缺口、用例版本、步骤结果、可用证据和复现入口。也可以直接让 Codex：“打开刚才的中文测试报告，并给出失败步骤的截图链接。”

| 状态 | 表示什么 | 接下来怎么做 |
|---|---|---|
| `passed`（通过） | 本次要求的正式断言均已满足 | 结合覆盖范围判断是否足够，必要时保存用例 |
| `failed`（失败） | 实际结果违反明确预期 | 用运行 ID 诊断，修复后按原用例复跑 |
| `blocked`（受阻） | 环境、权限、身份或数据阻止执行 | 补齐对应条件后重跑 |
| `inconclusive`（无法确定） | 预期、证据或能力不足，或执行未完成 | 补充预期、消除定位歧义或解决报告中的缺口 |

重试之后才通过的结果会标成不稳定，不能当作稳定通过。没覆盖到的页面和流程也不在这次通过的范围里。

想看已经录好的过程，发一句：“给我运行 RUN_ID 的录像播放路径。”用浏览器打开返回的 `playbackPath`（本地 `recordings.html`），能播放、暂停、拖动进度，不用再跑一遍 replay。录像在运行结束、浏览器上下文关闭后才定稿；没有录像就看报告里写的原因。

录像默认开着，只存在本机，没有脱敏，按保留期跟着运行一起清理，默认 7 天；在测试中心归档后就永久保留。不想录就在需求里写“本次不录制流程录像”，对应 `target.evidence.video:false`。截图和页面快照有单独的脱敏配置，见[报告说明](docs/reporting.md)。

### 导出成独立测试包

想脱离 Codex 也跑这些回归测试，就用导出。输出目录必须是还不存在的新目录：

> $webpilot:export 将运行 RUN_ID 的测试计划导出到当前项目下尚不存在的 tests/webpilot-login 目录，保留原断言和等待条件，列出外部登录态、数据和配置要求，并在相同目标及等价测试数据下验证导出包。

导出的目录里有测试文件、配置、README 和运行内核快照。跑它需要 Node.js、浏览器和系统依赖，不需要 WebPilot 插件，也不需要模型凭证。进到返回的输出目录，按包里的 README 安装和执行。

macOS：

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

要身份、文件或数据脚本，按导出说明提供外部 bindings / target config。生成文件不等于验证通过，看 `manifest.json` 里的 `verified` 标记和验证报告。交给 CI 时把整个导出目录复制过去，保留安装后生成的 lockfile，再准备好目标服务、Chromium、系统依赖和外部参数，详见[独立导出](docs/export.md)。

### 直接用 CLI 跑

已经有结构化计划，就能在终端里不接模型直接跑。下面的命令在 WebPilot 源码仓库根目录执行，别的位置要用 WebPilot 的绝对入口。CLI 不要求待测项目装 WebPilot。

先按[计划与绑定文件示例](docs/interfaces.md)准备好 `plan.json` 和需要的 bindings，也可以让 Codex 把确认过的验收计划写成这两个文件。下面的例子统一用 `.webpilot/data` 存储，`RUN_ID`、用例 ID/版本、URL 和输出目录都换成实际值：

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

这些 `node` 命令在 PowerShell 里也能跑。用到 bindings 的 run / save / replay / export 都得带上相应参数。想看着浏览器跑，加 `--headful`。

CLI 和桌面插件要用同一个数据目录，才能按 ID 找到同一份资产。默认存在 WebPilot 的用户缓存里，`doctor` 能看到实际路径；示例里的 `.webpilot/data` 是显式覆盖的目录，要读桌面插件创建的运行，就换成它的实际目录。`--data-dir` 或 `WEBPILOT_DATA_DIR` 可以指定存储位置，业务用例不必放进目标项目。

退出码：

| 退出码 | 含义 |
|---|---|
| `0` | 稳定完整通过 |
| `1` | 正式断言失败 |
| `2` | 受阻、没完整验证或重试后才通过 |
| `3` | 内部错误或调用无效 |

CI 里最好同时留一份 JSON 报告，方便判断具体原因。更多命令和 schema 见[接口说明](docs/interfaces.md)。

## 本地测试中心

同一系统用户下的多个聊天、项目和 CLI 共用同一个本地测试中心，数据目录不同也能汇总到一个页面。

### 打开与停止

下面几条命令可以手动打开或查看状态，地址以返回结果为准：

```sh
node dist/cli/index.js dashboard open
node dist/cli/index.js dashboard status

# 直接查看某次运行，或在关闭页面后强制重新打开
node dist/cli/index.js dashboard open --run RUN_ID
node dist/cli/index.js dashboard open --force

# 导入旧数据目录中的历史记录
node dist/cli/index.js dashboard import --data-dir /path/to/older-webpilot-data
```

自动打开会跨聊天去重：这个服务已经开过页面，后面的测试就加进现有看板并返回链接。自己关掉页面后，可以点链接回来，或者用 `--force` 再弹一次。关网页不会停测试，测试跑完服务还在，历史随时能看。不需要了就执行 `node dist/cli/index.js dashboard stop`，它不会取消正在跑的测试。

### 查看运行

侧栏有“所有运行”“正在执行”“失败记录”和“已归档”。总览里能按运行名称、项目或目标搜索，按状态筛选，也能分页。点进详情看执行时间线、每步的预期和实际结果、实时画面、截图、报告和录像。截图能点开放大、看原始尺寸；在列表里勾两条运行就能“并排观看”。窄屏自动改成上下排列。

固定计划显示的是用例完成数量。增量浏览器探索只显示已经执行的步骤，不给推测的完成百分比，正常关掉探索也不等于验收通过。直播断线、执行器失联和业务断言失败会分开显示。

### 管理运行记录

在运行列表或详情的 `⋯` 菜单中操作：

| 操作 | 使用方式与结果 |
|---|---|
| 重命名 | 选择“重命名”，输入 1 到 120 个字符的名称并保存，执行中也能改。新名字同步到列表、搜索和详情，原报告、结果和证据保持原样。 |
| 归档并永久保存 | 已结束且可管理的运行移入“已归档”，已有的报告、截图、录像和原详情链接都保留；自动清理和 `prune --days` 都会跳过它。 |
| 恢复到当前记录 | 在“已归档”里恢复，或者归档后点“撤销”。恢复之后仍然是永久保存。 |
| 删除… | 弹窗里核对运行名称，再点“永久删除”，才会删掉报告、截图、录像和执行记录，删了找不回来。已保存的回归用例、项目文件和独立导出包不受影响。 |
| 批量管理 | 点“批量管理”，勾选多条运行或“全选当前页”，然后批量归档、恢复或确认删除，不受并排观看只能选两条的限制。 |

正在执行、还在采集证据或清理、以及没确认终止的失联运行，都不能归档或删除，菜单里会写原因。切换范围、筛选、搜索或分页会清空批量选择。批量操作逐项给结果，失败的可以重试。归档只保留现有文件，之前缺的、过期的证据不会补回来。

### 直播、录像与自动打开

CLI 的 `--no-open` 只登记进度、不自动弹页，`--no-dashboard` 关掉本次执行的看板接入。`target.evidence.live:false` 单独关直播，`target.evidence.video:false` 关录像。直播只在有人看的时候采集，画面里可能有没脱敏的本地敏感内容。

看板的服务目录和测试资产目录是分开的：`--data-dir` / `WEBPILOT_DATA_DIR` 指定测试资产，`--dashboard-dir` / `WEBPILOT_DASHBOARD_DIR` 隔离看板服务状态。完整配置、访问机制和恢复规则见[本地测试中心说明](docs/dashboard.md)。

## 支持范围

已经能用：

- 语义定位、表单、条件等待、iframe、新页面、上传与下载检查。
- 断言来源可追溯；AI 推测只算候选，缺口不算通过。
- passed / failed / blocked / inconclusive，保留失败重试与不稳定标记。
- 独立角色 context、外部登录态、数据 prepare/cleanup、服务所有权管理。
- JSON/Markdown 报告、脱敏快照和截图；每次浏览器执行默认录一段本地 WebM 流程录像，报告里带播放器入口。原始敏感 trace 默认关，只有显式要求才留在本地。
- 跨聊天与项目共享的本地测试中心，实时进度与浏览器直播、截图放大、两条运行并排观看；支持运行重命名、归档永久保存及批量管理。
- 草稿及不可变用例版本；晋升前独立重跑；业务标准修改需新依据与采纳记录。

还没做：

- 只支持 Chromium，多浏览器没做。
- Canvas 视觉操作、移动硬件等价、穷尽全站覆盖都还没实现。
- 应用自己的启动环境、业务预期、登录和数据准备仍然要你提供。“通用”说的是接入和执行不挑框架。

## 开发

```sh
npm run typecheck
npm test
npm ci --ignore-scripts --prefix tests/fixtures
node scripts/compatibility-check.mjs
node scripts/host-check.mjs .webpilot/marketplace

# 重新生成 README 演示 GIF（macOS，需要 ffmpeg）
node scripts/capture-readme-demo.mjs .webpilot/readme-frames
scripts/build-demo-gif.sh .webpilot/readme-frames assets/demo.gif
```

测试需要 loopback 服务和启动 Chromium 进程的权限。五类真实样例和缺陷集的结果见 [兼容记录](docs/compatibility.md)。测试中心的分项验证见 [实时看板验收](docs/dashboard-acceptance.md)、[工作台界面验收](docs/workspace-ui-acceptance.md)、[视觉改版验收](docs/dashboard-visual-refresh.md)、[预测试覆盖率与验收](docs/pretest-coverage-acceptance.md)、[运行管理验收](docs/run-management-acceptance.md) 和 [运行标题验收](docs/run-title-acceptance.md)。

## 相关文档

| 文档 | 内容 |
|---|---|
| [安装说明](docs/installation.md) | 各宿主平台的安装细节、更新、卸载与回滚 |
| [项目接入](docs/project.md) | 目标项目、启动命令与数据准备 |
| [接口说明](docs/interfaces.md) | MCP 工具、CLI 命令与 schema |
| [规划](docs/planning.md) | 计划生成与执行 |
| [预测试覆盖率与验收](docs/pretest-coverage-acceptance.md) | 覆盖率规划与验收报告 |
| [报告](docs/reporting.md) | 报告结构、脱敏与证据 |
| [资产](docs/assets.md) | 用例、运行与存储布局 |
| [本地测试中心](docs/dashboard.md) | 看板配置、访问机制与恢复规则 |
| [独立导出](docs/export.md) | 导出包结构与 CI 接入 |
| [兼容记录](docs/compatibility.md) | 已验证平台、样例与已知限制 |
