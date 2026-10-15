# Acceptance planning

Codex creates plans; the runtime validates and executes them without an embedded model API. `collectContext` provides supplied requirements, README, package metadata, OpenSpec/test documents and optional Git revision/diff. Component/route impact needs code inspection and remains a hypothesis; collection does not establish complete coverage.

A plan contains `schemaVersion: 1`, a stable `id`, `target`, `scope`, `gaps` and `cases`. Formal assertion sources are `user`, `openspec` or `regression`, with a nonempty `reference` and optional `revision`. `inferred` assertions must be candidates. To adopt one, change its source to `user` with the adoption reference. Source conflicts are recorded in a case's `conflicts`; affected execution is blocked until resolved.

Candidates alone produce an inconclusive result. Missing prerequisites are recorded in `preconditions` as required runtime reference names. Scope and unverified coverage remain in reports, including mobile viewport and missing source. Budgets are shared across incremental actions in a session and across attempts/cases in a suite. Unexecuted cases still appear with their reason.
