# Regression assets

A case contains `schemaVersion: 1`, `id`, positive integer `version`, `title`, `state`, optional `role`, `preconditions`, `conflicts`, `steps`, and optional `change`. Save it first as a draft. `saveCase` with `promote: true` re-runs it in an independent context with fresh data preparation; only a complete stable pass can become `regression-ready`.

Storage defaults to WebPilot's user cache or an explicit data directory. Cases live under `cases/<id>/<version>.json`; versions are immutable. Each run records attempted steps and evidence under `runs/<run-id>/`. Model-free replay consumes the same case schema and never changes saved expectations. Supply bindings for target/environment references; missing values are blockers, not fallback to remembered secrets.

Maintenance changes must preserve their visible version difference and reason. Changing formal assertions needs a new requirement source and adoption record. Locator changes remain distinguishable from expectation changes. Existing failures remain in their original run records.

新版本包含 `change:{reason,adoptedBy?,source?}`。`locatorRepairs` 可记录 `{stepId,previous:Locator,next:Locator,reason,status:"candidate"}`；它只是一条可审查定位建议，运行器不自动采用。先保留原失败 run，再由 Codex 基于新观察提出候选，采用时新增版本。`caseDifference` 将仅定位变化与正式断言语义变化区分；删除、放宽或改变正式断言需要 change.source 与 adoptedBy。原版本和失败记录保持不可变。

## 覆盖计划资产

覆盖计划独立存于 `plans/<coverageId>/`：`revisions/<revision>.json` 是不可变清单版本，`state.json` 原子记录当前版本、已提交版本、采用记录和运行关联。更新使用 expectedRevision 与 requestId，拒绝陈旧写入，重复请求不重复追加。草稿/待审阅计划不依赖浏览器心跳。

独立计划默认保留七天，期限由目标 evidence.retentionDays 决定，过期不能采用。执行前复制采用版本及历史为运行目录的 `coverage.json` / `coverage.md`，随运行保留及归档；独立计划过期不影响已复制快照，删除运行也不会删除其他运行共用的独立计划。秘密及动态数据使用引用，不写入清单和可读说明。
