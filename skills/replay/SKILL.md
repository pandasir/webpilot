---
name: replay
description: Rerun saved WebPilot browser regression cases after frontend changes without modifying their expected behavior.
---

Read [the interfaces reference](../../docs/interfaces.md) when locating saved assets or supplying runtime parameters. Load the selected case or plan, provide the current target and external role/data references, and use suite_run or the CLI replay entry.

Write replay reports and conclusions in Simplified Chinese. Keep saved assertion values, original page text, identifiers and machine-readable codes unchanged.

Before suite_run, call dashboard_open and show its dashboardUrl before waiting for test completion. It starts or reuses one local dashboard across chats and opens it once; subsequent tests automatically join the overview. Dashboard failure does not block authorized replay. Respect the user's opening preferences. Keep browser live viewing enabled by default: omit target.evidence.live or set it to true. Set target.evidence.live:false only when the user explicitly requests disabling live viewing, independently of evidence.video. Browser live view is sensitive local media; do not read or upload live frames. This restriction on model access does not require disabling the user's live view.

The final response must include a clickable “本次测试详情” link to the replay run in the test center, whether the outcome is passed, failed, blocked or inconclusive. Use the returned metadata.runUrl for this replay, not the original run being replayed. If it is absent but dashboardUrl and the actual replay run ID are available, construct /runs/<runId> relative to that dashboard origin. A homepage link sent before execution, a run ID, a report file or a recording link does not replace this final run link. Include it even if report generation fails. If dashboard integration was explicitly disabled, or no run link can be obtained, explain the limitation without inventing a link or rerunning tests.

When dashboard_open returns shouldOpen:false, reuse the existing dashboard: show the link without opening another browser tab or Codex browser panel. Use force:true only when the user explicitly asks to reopen it.

Keep saved assertions unchanged. Missing identity, data or environment is blocked; insufficient evidence is inconclusive. Preserve initial failures and mark successful retries unstable. Report the case version, scope, evidence and reproduction entry. Suggest locator or expectation changes as visible test changes with their own basis; do not silently apply them.

Distinguish rerunning a case from watching a saved recording. All browser attempts are recorded by default; link playbackPath after completion. Videos are unredacted local-only evidence: do not read or upload contents. Users can disable collection with evidence.video:false.
