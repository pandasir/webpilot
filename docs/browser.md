# Browser operations

Each run/case uses its own Chromium context; role contexts do not share Cookie/localStorage. Locators use `{ kind, value, name?, exact?, scope? }`. Kinds: `role`, `label`, `text`, `testId`, `selector`; `name` is the accessible name for role locators. `scope` is a list of explicit CSS ancestor scopes. Exact text/name matching defaults true. A matched action target must be unique; count assertions can intentionally match a set.

Steps have `id`, `op` and optional `timeoutMs`. Actions:
- `navigate`: relative `path` or `{ ref }`.
- `click`, `fill` (`value`), `select` (`value`), `check` (`checked`), `press` (`key`): with `locator`.
- `scroll`: numeric `x`, `y`.
- `frame`: `selector`, or `null` to return to the main page.
- `openPage`: clicking `locator` opens a popup named `name`; `switchPage` selects a saved `name`, including `main`.
- `upload`: `locator`, `file: { ref }`.
- `unsupported`: `capability`, recorded as an explicit gap (for example Canvas).

Assertions include a source and optional `candidate`:
- `expectText`: `locator`, `expected`, optional `contains`.
- `expectURL`: relative or absolute `expected`.
- `expectVisible`: `locator`, boolean `expected` (default true).
- `expectCount`, `expectValue`, `expectEnabled`: `locator`, typed `expected`.
- `download`: clicking `locator` must download the exact `filename`.

Values can be literals or runtime `{ ref }` values. Use references for credentials and machine-dependent files. Browser scripts are not a public step operation. The executor uses condition-based waits and stores action/expectation/actual results separately. Unexpected navigation is stopped and reported. Source conflicts, login readiness, missing files and unsupported operations never count as a business pass.

## 有覆盖清单的增量会话

session_open 关联已采用覆盖版本后，session_observe 是前置观察。业务动作必须在 session_case_begin/end 内，并提供当前 caseId、revision、attempt。每条用例独立准备/清理数据及角色 context，整个请求共用 sessionId、runId 和总预算；角色状态不互相污染。

步骤顺序、预期或未执行定位改变时须先发布相应清单版本，按模式采用后 session_case_sync；已执行步骤不能改写。允许的重试必须先结束失败尝试，并遵守 attempts 上限。未执行完即关闭会话不算通过。浏览器或预算阻塞时保留证据和缺口，不自动新建替代运行。
