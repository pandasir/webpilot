---
name: export
description: Export selected WebPilot regression assets as an independent Playwright test package for a project or CI.
---

Use case_export for the selected assets and requested output directory. Read [the export reference](../../docs/export.md) for runtime references and verification. Preserve formal assertion semantics, wait conditions and locator scope.

Write export verification reports, gap explanations and conclusions in Simplified Chinese. Preserve code, commands, identifiers, machine-readable schema fields and original assertion values.

List external authentication/data requirements and any unsupported steps. Avoid embedding secrets or machine-specific login-state paths. Existing output files must not be overwritten. Verify the generated package against the same target with equivalent clean data before calling it verified. Keep the package unverified when required dependencies or capabilities are missing, and explain what remains.
