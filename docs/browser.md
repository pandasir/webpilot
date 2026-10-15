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
