---
name: diagnose
description: Diagnose a WebPilot browser acceptance or regression failure from its saved report and evidence.
---

Use report_read to load the selected run. Read [the reporting reference](../../docs/reporting.md) when interpreting evidence or statuses. Explain the failed step's expectation and observed state before proposing causes.

Write diagnostic reports and conclusions in Simplified Chinese. Preserve identifiers, machine-readable codes, page text and original error messages as evidence; give Chinese explanations without changing original assertions.

Separate observed facts, likely causes and verified causes. A network failure near a failed step is supporting evidence, not proof of causation. If source is available, inspect relevant code and cite the basis; otherwise state that code location is unavailable. Provide a reproducible entry and a focused next investigation. Raw sensitive traces remain local and are not fetched through report_read. Product code changes require the user's requested scope.
