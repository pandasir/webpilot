---
name: replay
description: Rerun saved WebPilot browser regression cases after frontend changes without modifying their expected behavior.
---

Read [the interfaces reference](../../docs/interfaces.md) when locating saved assets or supplying runtime parameters. Load the selected case or plan, provide the current target and external role/data references, and use suite_run or the CLI replay entry.

Write replay reports and conclusions in Simplified Chinese. Keep saved assertion values, original page text, identifiers and machine-readable codes unchanged.

Keep saved assertions unchanged. Missing identity, data or environment is blocked; insufficient evidence is inconclusive. Preserve initial failures and mark successful retries unstable. Report the case version, scope, evidence and reproduction entry. Suggest locator or expectation changes as visible test changes with their own basis; do not silently apply them.

Distinguish rerunning a case from watching a saved recording. All browser attempts are recorded by default; link playbackPath after completion. Videos are unredacted local-only evidence: do not read or upload contents. Users can disable collection with evidence.video:false.
