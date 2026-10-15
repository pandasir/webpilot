# Reporting

测试执行中可通过共享的 [本地测试中心](dashboard.md) 查看多个聊天及 CLI 运行的阶段、步骤、截图和浏览器直播；结束后在同一详情查看报告和录像。实时状态与最终四态结论分离，探索会话关闭不自动表示正式验收通过。进度日志在保存前脱敏；直播像素与录像遵循敏感本地媒体规则，不宣称继承截图遮挡。

测试报告默认使用简体中文，包含结果状态、覆盖范围、步骤、证据、清理问题及复现方法。四个 Skill 的计划、用例标题和对用户的结论也使用简体中文。JSON 字段及 passed/failed/blocked/inconclusive 等机器可读状态保持稳定；页面文本、预期值和底层诊断保留原文，避免改变断言或丢失证据。

`passed`: all required formal assertions executed with valid prerequisites and satisfied. `failed`: an explicit formal assertion is violated. `blocked`: environment, permissions, identity or data prevents execution. `inconclusive`: missing expectations, evidence, capabilities, cancellation or exhausted budgets leaves behavior unverified.

Retries preserve every attempt. Passing only after failure is unstable. Partial coverage is visible and never described as complete verification. Diagnostic hypotheses are separate from execution facts.

Step evidence is redacted before default storage and MCP output. Request bodies and authentication headers are excluded. Configure sensitive selectors and runtime secret references. Unmaskable screenshots are omitted. Raw Playwright traces are off by default; explicitly retained sensitive traces stay local and never enter model responses or exports. Local video recordings follow the separate policy below.

流程录像是独立的敏感本地证据，默认开启，不适用截图的 mask/脱敏保证。所有已启动的浏览器尝试均录制，通过、失败与重试分别保留；多页面分别生成 WebM。`attempt.recordings` 记录每段的 `pageId`、`pageName`、`status` 和本地 `path`；可用录像标记 `sensitive:true, redacted:false`，缺失录像标记 `status:omitted` 并给出 `reason`。录像缺失不改变断言结果。

运行结束后 JSON 报告的 `playbackPath` 指向本地 `recordings.html`，Markdown 报告提供“观看流程录像”及每段 WebM 链接。使用支持 WebM 的浏览器打开播放器即可观看；播放器无需网络或报告服务器。`session_close` 返回探索会话的录像元数据及播放器路径，同时保存在 `session.json`。MCP 只返回路径和状态，不读取或传输视频内容。启用录像的 run owner marker 包含 `sensitiveVideo:true`；录像随运行的 `retentionDays` 清理，默认 7 天。设置 `evidence.video:false` 可关闭录像。

启用 `evidence.rawTrace:true` 时，run 目录的 `.owner.json` 标记 `sensitiveRawTrace:true`，trace 文件权限为 0600。它不进入 JSON/Markdown 证据引用及 MCP 返回。每次新运行/会话按各 run 的 retentionDays 清理过期插件目录；CLI prune --days 可显式覆盖保留天数。只处理拥有有效 WebPilot owner marker 的普通目录，不删除用例目录、符号链接或用户文件。

截图遮挡及敏感值收集涵盖当前页面的 frames。若 frame 不可检查、mask 未匹配或截图遮挡失败，则省略截图并保留证据缺口。此策略不自动识别所有业务敏感字段，应在项目配置中声明 masks。

运行归档后，`management.json` 将该运行标记为永久保存；报告、截图、录像、事件日志和其他已有运行文件不再按天数自动清理，显式 `prune --days` 也不会覆盖该规则。恢复到当前列表或撤销归档后仍永久保存。归档不恢复之前已经缺失的证据。用户仍可在测试中心确认后永久删除该运行的全部产物。
