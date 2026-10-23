# 测试前覆盖规划验收

变更：`add-pretest-coverage-planning`。验收分支：`feature/add-pretest-coverage-planning`。

## 搜索与筛选样例

使用 `tests/fixtures/coverage/index.html` 中的三件商品，真实 Chromium 分别运行套件和增量路径。清单先于执行创建，并在测试中心展示：

| 场景 | 来源与依据 | 本次安排 |
|---|---|---|
| 关键词搜索 | 用户要求，匹配一件商品 | 选中 |
| 搜索与分类组合、无匹配结果 | 相关组合边界；样例验收要求规定数量和提示 | 选中 |
| 清空条件恢复三件商品 | 相关状态恢复；样例验收要求 | 选中 |
| 刷新后保留条件 | 相关建议，缺少业务规则 | 未选，待明确 |

每条清单包含前置条件、操作、预期来源、补充理由、优先级和安排原因。两个执行入口均完成三条选中用例；增量路径保持一个 sessionId/runId，前置观察不增加用例完成数。未选建议不被误报为通过或失败。

此样例的补充场景元数据由测试预先构造，用于验证约定、执行和展示。实际 AI 补漏由更新后的 verify Skill 驱动，本地执行器不调用模型；自动化检查不证明任意模型会完整发现所有遗漏场景。

## 三种模式与聊天交付

默认流程：创建 published 清单，展示摘要和真实 planUrl，采用确切版本，然后执行。摘要示例：

> 本次选中 3 条：搜索、搜索与分类组合、清空恢复。另有“刷新保留条件”建议，因缺少业务规则未选。先按这份清单执行；完整覆盖范围见测试中心的覆盖计划。

先审阅流程：创建 review 清单并展示摘要；未明确采用时 snapshot/suite 拒绝执行，页面保持“待审阅”，没有活动浏览器记录。用户明确采用该版本后，才能执行。执行中新增建议保持未选；定位细化可继承已采用范围。

仅生成流程：创建 generate-only 清单并交付；不启动目标浏览器、服务或数据脚本。CLI 的 `--preview-only --no-dashboard` 在没有模型凭证时可生成确定性清单，也不创建 runs 目录。

审阅、仅生成阶段使用计划链接，不能编造运行链接。实际测试完成后使用真实新运行 ID 的详情入口。临时验收服务在测试结束后关闭，因此截图记录中的运行 ID 不提供持续可访问的网址。

## 自动化与故障检查

| 检查文件 | 验证内容 |
|---|---|
| `tests/coverage.test.mjs` | 来源与候选约束、旧断言保留、版本 CAS、幂等、审阅采用、定位变更、脱敏、到期清理、独立快照、路径约束、累计补漏上限、规划失败及结果对账 |
| `tests/coverage-execution.test.mjs` | 业务准备前持久化、用例顺序及关联、未采用/未知用例拒绝、单运行观察与执行、部分关闭、未选建议、定位同步、已执行步骤保护、角色隔离、失败重试、共享预算、取消、清单写入及报告定稿故障 |
| `tests/coverage-dashboard-browser.test.mjs` | 执行前发现三种模式、筛选与展开、套件/增量搜索筛选、逐项结果、本机认证和来源限制、320/375/768/1440px 布局、归档后清单独立保留、服务重启恢复 |
| `tests/coverage-revisions-browser.test.mjs` | 八条选中范围只完成六条时保留两条未验证；同一运行发布并采用第九条后再执行，页面显示九条、七条通过、两条未完整验证及两版历史 |
| `tests/dashboard.test.mjs` | 既有协议、事件重放、执行器失联与重连、历史恢复、路径访问、存储保留；新增规划能力识别，拒绝用旧服务伪造规划链接 |
| `tests/interfaces.test.mjs` | 23 个 MCP 工具、新规划接口的真实 stdio 调用、既有 CLI 回归、模型凭证缺省、候选与角色/预算、独立 Playwright 导出 |
| 其余既有回归 | 正式失败、旧资产、中文报告、直播、录像、归档删除、标题及浏览器工作区兼容 |

打开未完成运行只读取已持久化快照、事件和步骤，不重新调用业务执行。报告定稿失败测试实际保存一条已执行步骤及证据，验证页面投影可读、总体不宣称通过，并保留失败原因。旧运行没有覆盖文件时，页面明确显示“该运行未记录执行前覆盖清单”，不倒填规划历史。

MCP 链接专项在已有隔离 Dashboard 的情况下显式传入 `dashboard:false`，验证计划创建、采用、会话打开、开始用例和关闭均不返回链接，也不登记到服务；随后启用的仅生成计划返回真实 planUrl，没有 runUrl。

## 本地证据与复现

浏览器专项每次运行生成以下文件（本地忽略目录）：

- `.webpilot/reports/pretest-coverage/review-plan.png`：待审阅计划、未选建议与待明确原因。
- `.webpilot/reports/pretest-coverage/completed-coverage.png`：三条完成、一条未选及需求对应。
- `.webpilot/reports/pretest-coverage/mobile-coverage.png`：320px 页面，无横向溢出。
- `.webpilot/reports/pretest-coverage/expanded-coverage.png`：同次运行从八条增补到九条，保留原有未验证范围和新增原因。
- `.webpilot/reports/pretest-coverage/result.json`：实际时间、套件与增量运行 ID、检查项和页面错误列表（当前一份时间戳为 2026-10-21）。

```sh
npm run typecheck
npm test
openspec validate add-pretest-coverage-planning --strict
git diff --check
```

测试使用临时目标服务和隔离 Dashboard，不启动或修改用户正在使用的测试中心。已检查桌面和窄屏截图；正式发布前仍需更新安装的插件并重新加载 MCP 工具，源码实现不会自动替换现有安装。

## 验证结果

2026-10-21 本地验证：

- `npm run typecheck`：通过，包含执行器和 Dashboard UI。
- `npm test`：93/93 通过，无失败、无跳过，约 91 秒；包含完整构建与 Chromium、MCP、CLI、报告、导出、直播/录像、管理及兼容回归。
- `openspec validate add-pretest-coverage-planning --strict`：valid；`git diff --check`：无空白问题。

测试目录当前包含 93 项检查，`coverage-revisions-browser.test.mjs` 已作为独立文件并入默认 `npm test` 运行，不再需要单独执行。浏览器专项证据（截图与 `result.json`）时间戳为 `2026-10-21`，对应当前实现。AI 补漏本身采用 Skill 工作流，尚未对不同模型的场景召回率做量化评估；结果只对已声明的测试范围作出通过或未完整验证结论。

## 本机插件更新

2026-10-16 按用户要求重新构建、打包并通过 `codex plugin add webpilot@webpilot-local --json` 更新现有安装。安装位置为 `/Users/edy/.codex/plugins/cache/webpilot-local/webpilot/0.1.0`；MCP、覆盖模型、规划会话、存储、Dashboard 和 verify/replay Skill 的文件哈希与源码构建一致。旧安装备份在 `.webpilot/releases/before-pretest-coverage-planning/plugin`。

新宿主实测发现四个启用 Skill、23 个 MCP 工具，包含七个新增规划/用例工具，无 toolsError；完整日志为 `.webpilot/releases/pretest-coverage-planning/host-check.log`。共享 Dashboard 已在原地址 `http://127.0.0.1:4318` 重启，确认 `coveragePlanning:1`；更新前后三条保存的运行均保留，结果见同目录 `update-before.json` 与 `update-result.json`。

当前桌面聊天的常驻工具清单仍为旧版。桌面控制工具禁止操作应用，且未发现可用的宿主重载控制入口，因此没有强制终止应用或其 MCP 进程；用户需重启桌面应用、重新打开聊天以刷新工具。新宿主加载检查不代表当前聊天已热重载。
