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

## 覆盖清单对账

完整套件及按清单执行的增量运行在浏览器动作前保存 `plan.json`、`coverage.json`、`coverage.md`，结束时保存 `coverage-result.json`。JSON 报告包含 coverage ID/版本，中文 Markdown 附逐项对账及版本变更。选择安排与实际结果分开：范围外建议不计通过，也不单独使本次失败；选中必需项未执行或未完成时验收不完整。候选检查、前置观察和截图存在均不能证明正式通过。

中断或最终报告不可用时，测试中心仍读取清单快照与已保存事件/步骤，标明剩余未验证范围，不自动恢复业务操作。独立计划过期不会删除随运行保存的快照；升级前运行显示缺少执行前覆盖清单，不伪造历史规划。

## 正式验收与补充检查分别汇总

新生成的套件与覆盖计划会话报告标记 `outcomePolicy: "formal-v1"`，并包含 `acceptance.formal` 与 `acceptance.supplementary`。`outcome` / `exitCode` 由正式用例决定；只含候选断言的补充用例不拉低已完成的正式验收，也不能贡献正式通过。补充检查逐项标记 `matched`（符合预期）、`issue`（断言不匹配，待确认产品规则）或 `incomplete`（未执行、定位或环境等原因无法验证）。没有任何正式用例时仍为 `inconclusive`，页面展示“仅探索，未作验收”。没有断言的必需用例仍为未完成，不能当作补充用例忽略。

汇总依据采用版本的完整可执行步骤和最后一次尝试：正式断言及所需操作必须全部执行并通过，未执行的正式范围、受阻、取消、预算耗尽和清理异常仍如实影响结论。先失败后通过仍标记不稳定，退出码为 2。补充断言失败若中断后续正式步骤，后续缺失范围仍为未完成。不得将不同尝试中的部分成功拼成通过。

`cases[].outcome`、逐步错误、证据和重试保留原始执行事实，可能包含候选断言导致的 `inconclusive`；正式汇总见 `acceptance`。新计划将正常登录、空表单补充校验、登录态保持补充检查拆成独立用例。历史记录不改写 `report.json`、原有状态或退出码；看板可根据已有快照与执行步骤展示正式／补充分项解释，并明确标注原始报告结果。缺少计划或可信结束信息时不推断通过。列表进度使用“已执行 N / M 用例”，不表示通过数量。
