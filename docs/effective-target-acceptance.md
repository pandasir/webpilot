# 最终目标配置与回放一致性验收

日期：2026-11-16。环境：macOS arm64、Node 26.7.0、仓库锁定的 Playwright/Chromium。对应 OpenSpec：`fix-effective-target-replay-consistency`。

## 配置对照

使用临时静态项目，配置 viewport 为 390×844，关闭 video/live，保留 2 天，设置 reader 角色、prepare/cleanup 和有限预算。页面通过 `innerWidth` 与 `innerHeight` 输出实际视口，正式断言检查 `390x844`，同时检查保存计划、覆盖快照、保留标记、报告及录像目录；结论不只依据测试的 passed 状态。

| 路径 | 实际页面视口 | 录像 | 配置及产物验证 |
|---|---|---|---|
| 原始计划首次 suite_run | 390×844 | 无 | plan.json 与 coverage.json 的 target 相等，.owner.json 保留 2 天且 sensitiveVideo=false，报告来源为 config |
| 按运行 ID 的 CLI 回放 | 390×844 | 无 | 原配置改为桌面视口及录像开启后，仍沿用保存配置；新静态服务使用当次地址 |
| 按保存计划文件的 CLI 回放 | 390×844 | 无 | 删除原配置文件后仍通过，原保存计划字节不变 |
| 已采用覆盖的增量会话 | 390×844 | 无 | 项目配置损坏后仍使用采用目标、reader 角色和保存预算；数据生命周期执行一次 |
| 干净晋升与显式探索 | 390×844 | 无 | 晋升通过独立上下文验证，探索使用相同解析规则，缺少身份引用的用例不晋升 |
| 独立 Playwright 导出 | 390×844 | 无 | 新包实际执行并读取其报告，保留移动设置与来源，外部数据流程有效，rawTrace/live 关闭 |

每次套件及其两次回放的生命周期文件必须严格为三组 prepare/cleanup。静态回放测试占用首次运行的旧端口，验证保存的是启动意图，不会误复用旧地址上的其他服务。

## 边界验证

- 5 项目标解析测试检查旧格式、未知元数据版本、原始字段与默认值优先级、嵌套对象整体替换、配置错误、接入歧义、配置文件变更/删除、显式覆盖以及 MCP 发布/更新。通过命令标记与 Chromium 启动计数确认只读解析没有环境副作用。
- CLI preview-only 保存最终移动配置，既不创建 runs，也不执行数据命令。显式新配置只替换对应字段；URL 覆盖保留其他保存策略并更新来源。
- 与已采用目标冲突的 suite/session 在浏览器启动计数为 0、数据标记不存在、运行目录不存在时返回 COVERAGE_MISMATCH；原覆盖 revision 字节不变。
- 对 suite 和 planned session 注入覆盖快照保存失败，验证不启动环境。配置损坏也在启动前拒绝。
- 旧运行回放使用保存计划，gaps 与 stderr 明示无法完整追溯原配置；旧已采用覆盖不会重新加载当前项目配置。历史文件不被修复或重写。
- 独立包缺少等价 prepare/cleanup 时验证失败；提供后实际通过；再要求未提供的 readerState 时生成 blocked 报告。运行绑定值不进入导出计划或 manifest。

具体断言见 `tests/target-resolution.test.mjs` 与 `tests/replay-configuration.test.mjs`。测试使用临时目录并清理服务、浏览器和数据，没有保留可复用运行链接，也没有修改目标项目 fixture。

## 检查结果与复现

- `npm run typecheck`：通过，包含后端与 Dashboard UI。
- `npm test`：构建通过，113/113 测试通过，0 失败、0 跳过；完整测试约 96.6 秒。
- `openspec validate fix-effective-target-replay-consistency --strict`：通过。
- `git diff --check`：通过。

本机完整测试日志保存在 `.webpilot/reports/effective-target-consistency/npm-test.log`，该目录沿用仓库的忽略规则。可用以下命令重新验证：

```sh
npm run typecheck
npm test
openspec validate fix-effective-target-replay-consistency --strict
```

只重跑本次新增测试时，先构建，再运行：

```sh
npm run build
node --import ./tests/dashboard-env.mjs --test --test-concurrency=1 tests/target-resolution.test.mjs tests/replay-configuration.test.mjs
```

真实浏览器测试需要允许监听本机回环端口并启动 Chromium。本次结果仅代表上述 macOS 环境，不替代 Windows/Linux 实机验证。旧执行器可能拒绝带 targetResolution 的新计划；新版可读取旧输入，但不能恢复历史上从未保存的有效配置。
