# Acceptance planning

Codex creates plans; the runtime validates and executes them without an embedded model API. `collectContext` provides supplied requirements, README, package metadata, OpenSpec/test documents and optional Git revision/diff. Component/route impact needs code inspection and remains a hypothesis; collection does not establish complete coverage.

A plan contains `schemaVersion: 1`, a stable `id`, `target`, `scope`, `gaps` and `cases`. Formal assertion sources are `user`, `openspec` or `regression`, with a nonempty `reference` and optional `revision`. `inferred` assertions must be candidates. To adopt one, change its source to `user` with the adoption reference. Source conflicts are recorded in a case's `conflicts`; affected execution is blocked until resolved.

Candidates alone produce an inconclusive result. Missing prerequisites are recorded in `preconditions` as required runtime reference names. Scope and unverified coverage remain in reports, including mobile viewport and missing source. Budgets are shared across incremental actions in a session and across attempts/cases in a suite. Unexecuted cases still appear with their reason.

## 测试前覆盖清单

覆盖清单独立于可执行 Plan/Case，记录需求与稳定用例 ID 的映射、场景由谁提出、优先级、补充理由、前置条件、操作意图、预期依据以及本次安排。`suggestedBy:ai` 表示 AI 提出了场景，正式断言仍需 `user / openspec / regression` 依据；仅页面观察产生的预期保持候选。未知完整需求时不计算全站覆盖百分比。

用例的 `selected`、`readiness` 和执行结果分别表示“是否纳入本次”“当前是否具备条件”和“实际验证结论”。未选建议保留理由，不影响本次选定范围的通过；选中但未验证的必需项使验收保持不完整。默认最多两轮生成、十二条 AI 补充场景，用户明确要求不被该新增数量上限截断。

模式为 `auto`（发布摘要后自动采用并执行）、`review`（明确采用具体版本后执行）、`generate-only`（只保存清单，不启动浏览器、服务或数据脚本）。先审阅的清单可以跨聊天回合保留；定位细节更新保留采用关系，业务预期或范围变化需采用新版本。审阅模式执行时新发现的业务场景仅列建议。

浏览器增量执行使用 `session_case_begin → session_act/check → session_case_end`，步骤携带 caseId、revision 和 attempt。前置 session_observe 不计业务完成；页面观察后通过 coverage_update 细化未执行定位并 session_case_sync。自动模式的新增场景先发布采用，再执行；审阅模式只把新场景列为未选建议。已经执行的步骤和正式结果不被后续版本覆盖。
