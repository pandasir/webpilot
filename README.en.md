# WebPilot

[中文说明](README.md)

WebPilot is a local Web UI acceptance and regression plugin for Codex. Any project you can open in a browser can be tested with it: React, Vue, Next.js, static HTML, or a site whose stack you don't even know. Point it at a URL and it runs. The target project needs no test dependencies and no test IDs.

Codex reads the requirement, plans the steps, and analyzes failures. The local runner does the real Chromium work, assertions, and evidence capture. Once a case is saved, its expectations never change. Regression cases can be replayed from the CLI with no model involved, and exported as a standalone Playwright test package.

The local test center pulls test progress from multiple chats and multiple projects into one page: live browser view, step-by-step screenshots, reports and recordings, two runs side by side, plus run renaming, permanent archiving, and batch management.

![WebPilot's local test center: two runs watched side by side, step expectations versus actual results, and the coverage list](assets/demo.gif)

## Contents

- [Install](#install)
  - [Let Codex install it (recommended)](#let-codex-install-it-recommended)
  - [Prepare the environment and plugin package manually](#prepare-the-environment-and-plugin-package-manually)
  - [Register and install on macOS](#register-and-install-on-macos)
  - [Register and install on Windows](#register-and-install-on-windows)
  - [Post-install checks](#post-install-checks)
  - [Troubleshooting installation](#troubleshooting-installation)
- [Usage](#usage)
  - [Choosing between the four skills](#choosing-between-the-four-skills)
  - [Your first acceptance run](#your-first-acceptance-run)
  - [Review the coverage list first](#review-the-coverage-list-first)
  - [Common scenarios](#common-scenarios)
  - [Replay and diagnose](#replay-and-diagnose)
  - [Reports, screenshots, and recordings](#reports-screenshots-and-recordings)
  - [Export as a standalone test package](#export-as-a-standalone-test-package)
  - [Run directly from the CLI](#run-directly-from-the-cli)
- [Local test center](#local-test-center)
- [Scope](#scope)
- [Development](#development)
- [Related documentation](#related-documentation)

## Install

You need Node.js 22+, npm, and a Codex desktop app or CLI that supports plugins. WebPilot runs on your local Node.js and Chromium; the Codex CLI bundled with the desktop app is not a substitute for Node.js.

There are two ways to install: let Codex do it, or follow the manual steps below. Either way, quit and reopen the app and start a new chat afterwards — see [post-install checks](#post-install-checks).

### Let Codex install it (recommended)

Open a chat in the Codex desktop app and send this message:

> Install the WebPilot plugin from https://github.com/pandasir/webpilot into the current Codex desktop app. Follow the manual steps in the repository README and adapt them for macOS or Windows, complete the installation and checks, and tell me how to verify it after restarting.

Codex downloads the repository, checks Node.js 22+ and npm, installs dependencies, builds, prepares Chromium, packages the local marketplace, and installs the plugin. If a local clone already exists, it uses that. The repository and the generated local marketplace live in fixed directories so updates stay simple.

Whether this works depends on whether your host supports plugins, and whether the chat has network and file permissions. When a runtime is missing or a step needs you to click something on the desktop, Codex will tell you what to do.

### Prepare the environment and plugin package manually

In a terminal, go to the WebPilot repository root. Check versions first, then install dependencies, build, and prepare Chromium. On Windows use PowerShell; if `npm.ps1` refuses to load, replace `npm` below with `npm.cmd`:

```sh
node --version
npm --version
npm ci --ignore-scripts
npm run build
node dist/cli/index.js setup
node dist/cli/index.js doctor
node scripts/package-plugin.mjs .webpilot/marketplace
```

The first `setup` run downloads Chromium, so it needs network access. When `doctor` prints `ready: true`, Node.js, the browser, and storage all pass their checks. Packaging produces `.webpilot/marketplace`, which contains the plugin, its runtime dependencies, and the local marketplace manifest. Projects under test do not need WebPilot installed.

### Register and install on macOS

The terminal may not have a `codex` command; if you get `command not found`, use the full path to the CLI bundled with the app. On this project the verified macOS path lives inside `ChatGPT.app`. Run the following in the same terminal, from the WebPilot repository root:

```sh
WEBPILOT_CODEX="/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"
"$WEBPILOT_CODEX" plugin --help
"$WEBPILOT_CODEX" plugin marketplace add "$PWD/.webpilot/marketplace"
"$WEBPILOT_CODEX" plugin add webpilot@webpilot-local
"$WEBPILOT_CODEX" plugin list --marketplace webpilot-local
```

`WEBPILOT_CODEX` is only used for those commands; you don't need to change your PATH. That path is not the same on every desktop version. If you get `No such file or directory`, use the actual Codex CLI path inside your app. These commands were verified on macOS arm64 with Codex CLI `0.162.0-alpha.17.2`; on other versions, run `plugin --help` first to confirm the subcommands are supported.

If you already have a Codex CLI, register and install from the repository root with:

```sh
codex plugin marketplace add "$PWD/.webpilot/marketplace"
codex plugin add webpilot@webpilot-local
codex plugin list --marketplace webpilot-local
```

### Register and install on Windows

Install the Windows build of Node.js 22+ (which bundles npm), then install and sign in to a Codex desktop build that supports plugins. Reopen PowerShell and do the [prepare the environment and plugin package](#prepare-the-environment-and-plugin-package-manually) step from the WebPilot repository root; the build and browser-prep commands work in PowerShell too.

A native Windows setup must build, download Chromium, and package inside Windows. WSL needs its own preparation; `node_modules` and browser installs cannot be shared between the two.

First check whether the terminal can find the CLI:

```powershell
Get-Command codex.exe, codex.cmd -ErrorAction SilentlyContinue
```

If it can't, install one following the [official OpenAI CLI instructions](https://developers.openai.com/codex/cli); you need it for the marketplace commands below:

```powershell
npm.cmd install -g @openai/codex
```

Reopen PowerShell and return to the WebPilot repository root. The npm-installed CLI is `codex.cmd`. If the command you found above is a `codex.exe` bundled with the desktop app or installed separately, point `$WebPilotCodex` at that executable's full path instead. Where the Windows desktop app installs depends on the distribution channel and version — don't copy the macOS path.

```powershell
$WebPilotCodex = (Get-Command codex.cmd -ErrorAction Stop).Source
$WebPilotMarketplace = (Resolve-Path -LiteralPath ".webpilot\marketplace").Path

& $WebPilotCodex --version
& $WebPilotCodex plugin --help
& $WebPilotCodex plugin marketplace add "$WebPilotMarketplace"
& $WebPilotCodex plugin add webpilot@webpilot-local
& $WebPilotCodex plugin list --marketplace webpilot-local
```

In PowerShell, `&` invokes a program path held in a variable, so paths with spaces are fine.

If your CLI has no `plugin add` subcommand yet, register the marketplace, restart the desktop app, and install and enable **WebPilot Local** from the plugin directory. Whether local marketplaces work depends on the host version. For the desktop flow, see the [official OpenAI plugin packaging and local installation docs](https://developers.openai.com/plugins/build/plugins).

The Windows steps above follow the official Windows/CLI guidance and this project's packaging method, but they have not been validated on a real Windows machine yet. See the [compatibility record](docs/compatibility.md) for validated platforms and limits.

### Post-install checks

First confirm that `webpilot@webpilot-local` shows as `installed, enabled` in the list. If it is already installed and enabled, you don't need to install it again. Then:

1. Fully quit and reopen the Codex desktop app.
2. Open the frontend project you want to test and start a new chat. Existing chats do not pick up the tools from a newly installed plugin.
3. Check that the four skills `webpilot:verify`, `webpilot:replay`, `webpilot:diagnose`, and `webpilot:export` are available.

If your host supports local marketplaces, the desktop app's Plugins Directory will also show the registered marketplace and WebPilot; the exact UI depends on your version. Check install status and whether skills/MCP tools load in a new chat as two separate things.

The desktop app and the terminal CLI must use the same user and the same Codex configuration directory. If you set a custom `CODEX_HOME`, keep it consistent, or you will install into a different configuration environment.

### Troubleshooting installation

| Symptom | What to do |
|---|---|
| Terminal can't find `codex` | On macOS use the desktop app's bundled CLI path above; on Windows check `codex.exe` / `codex.cmd`, or install the official CLI and reopen PowerShell. |
| PowerShell refuses to load `npm.ps1` / `codex.ps1` | Use `npm.cmd` / `codex.cmd`; the Windows examples above already do. |
| The `plugin` or `plugin add` command is unavailable | Run `plugin --help` and confirm your host version supports those commands. |
| `webpilot-local` or the plugin isn't found | Make sure you packaged first and registered the generated `.webpilot/marketplace` directory, not the source root. |
| Installed, but no skills/tools in the chat | Confirm the plugin is enabled, the configuration directory matches, and you fully restarted the app and started a new chat. |
| Chromium unavailable | Run `node dist/cli/index.js setup` in the WebPilot repository, then check again with `doctor`. |
| MCP startup says it can't find `node` | Confirm the desktop host can find Node.js 22+. If Node is only on PATH via a terminal init script, check the desktop app's runtime environment. |

For updates, uninstall, rollback, and more detailed host checks, see [installation](docs/installation.md). For how plugins work, see the [official OpenAI plugin docs](https://developers.openai.com/codex/plugins); for Windows environments, see the [official OpenAI Windows guide](https://developers.openai.com/codex/windows).

## Usage

After installing the plugin, start a new Codex chat and describe what you want. The `$webpilot:...` forms below are how you invoke a skill in a chat — don't run them as terminal commands.

### Choosing between the four skills

| What you want to do | Skill | What to provide |
|---|---|---|
| Accept a new feature or this change | `$webpilot:verify` | Page URL, flow to perform, expected results; optionally ask to save a regression case |
| Re-run existing cases after a code change | `$webpilot:replay` | Case ID and version, or a previous run ID; current URL and any run parameters |
| Analyze one failure | `$webpilot:diagnose` | The failed run ID, or a report path that identifies the run |
| Produce tests that run in a project or CI without WebPilot | `$webpilot:export` | The cases/plan to export and a new output directory |

### Your first acceptance run

1. Open the frontend project you want to test in Codex. WebPilot only needs to be installed on your machine; the target project does not need its dependencies.
2. Start the project and any backend it needs, and confirm the target URL opens in a browser. An already-running test environment is fine too — just give the URL. Without source code you can still test page behavior.
3. Tell Codex what to test, what counts as correct, and which test identity or data it needs.
4. Review this run's coverage, each result, and the evidence. To re-run later, explicitly ask it to save a regression case.

Start the frontend service first, then send something like this in a new Codex chat:

> $webpilot:verify Accept http://localhost:3000 login form: an incorrect password shows "Invalid password" and stays on the login page; save a regression case.

Replace the URL and expected message with your own project's. The local test center opens before execution; when the run finishes, follow the "this run's details" link in the reply to see the run.

Codex checks the target and runtime first, then combines the requirement with what it observes on the page to generate steps, which it then executes and asserts on. You generally don't write selectors or plan JSON yourself. When you ask to save, the case must pass again in an independent browser context before it becomes a formal regression case; anything that doesn't meet that stays a draft or is recorded as a gap. Save verification may submit the form or trigger a business action again, so test data must be reusable.

You can spell out the requirement in this format, omitting anything you don't need:

```text
$webpilot:verify
Target: http://localhost:3000/products
Scope: product search and category filtering
Preconditions: the test environment already has a product "Blue Mug" in category "Home"
Steps and expectations:
1. Search "Blue Mug"; the product should appear in the list.
2. Select "Home"; the result should still contain the product.
3. Clear search and category; the list should return to its initial results.
Save: save a repeatable regression case.
Deliver: test conclusions, uncovered items, a clickable link to this run's details in the test center, the run ID, case version, and report and recording paths. The final reply must include this run's link, including when the run fails or is blocked; sending the landing page link before execution does not count.
```

Just saying "test this page for me" also works; Codex will propose checks based on what it sees. But business expectations you haven't confirmed are only candidates — they can't be used to declare acceptance passed.

### Review the coverage list first

verify and replay first store a coverage list, and show you the selected cases, AI-added scenarios, missing conditions, and out-of-scope suggestions in the chat; the full content lives in the "coverage plan" sidebar of the test center. By default it executes right after showing the list, and you never write selectors or plan JSON.

You can state the pacing in your requirement:

| How you phrase it | Result |
|---|---|
| "Accept product search and category filtering, and add related edge cases." | Default: execute automatically after showing the list |
| "Generate the cases first and let me review them; execute after I confirm." | The browser only starts after you explicitly adopt a specific version |
| "Only generate search and filtering test cases; don't execute this time." | Only the list is saved; no target service, browser, or data preparation is started |

By default, AI adds up to twelve related scenarios over two rounds, prioritizing core flows and high-risk gaps; acceptance points you explicitly asked for are never removed. Business rules it guesses are only candidates, and wording that isn't in the requirement is not treated as a formal standard. Existing regression cases keep their original expectations, and new suggestions are listed separately. After the run, compare results item by item in the run's "coverage list"; anything not executed or not adopted is explained. When the requirement is incomplete, the report will not claim the whole site was covered.

### Common scenarios

#### Accept immediately after changing code

Implementation and acceptance can go into one task. The plugin does not run automatically through lifecycle hooks, so say explicitly that you want WebPilot.

> Fix the product list filtering, then use $webpilot:verify to accept http://localhost:3000/products: after selecting "Home" only products in that category should show, and clearing the filter should restore the initial list; save a regression case and give me the results.

#### The service isn't running yet

Tell Codex where the project is, which app to start, and how to start it. In a multi-app repository, name the app. WebPilot checks for available start commands, but finding a command doesn't mean the service is running; missing project dependencies still need to be installed separately.

> $webpilot:verify Accept the apps/shop app in the current repository: first check the dev start command in package.json and start the necessary services, then use the actual URL after startup to test that searching "Blue Mug" finds the product; use the project's existing test configuration for the backend address, and report a blocker clearly if the configuration is missing.

#### You only have a website URL

Any reachable page can be tested directly. Without source code, the report will state that code changes and source-level causes could not be analyzed.

> $webpilot:verify Accept https://staging.example.com/help: after searching "refund", the results should include "Refund policy"; only cover this query flow.

#### Login or test data is required

Describe the test role, how you know login succeeded, and how data is prepared and cleaned up. The account you're signed into in your everyday browser is not carried into WebPilot automatically; either provide a test login flow or reference an external login state. Accounts, files, and similar values are passed as runtime bindings — see [project integration](docs/project.md) and the [interface reference](docs/interfaces.md).

> $webpilot:verify Accept the order page in the test environment as the buyer test role; confirm the page shows "My Orders" before continuing. After creating a test order it should appear in the list, and at the end remove this run's data with the project's test cleanup script; check identity and data configuration first.

#### Check narrow-screen layout

You can specify a viewport, but this is only a browser viewport check, not real-device acceptance.

> $webpilot:verify Accept http://localhost:3000 at a 390×844 viewport: clicking the menu button should make the nav list visible, and clicking again should hide it; state the viewport in the report.

### Replay and diagnose

Note the case ID, version, run ID, and storage location from the first acceptance run. In the examples below, replace `invalid-password`, version `1`, and `RUN_ID` with the values you actually got; if the case wasn't saved, save it first.

After changing page code, send this in the same chat or a new chat that can reach those assets:

> $webpilot:replay Re-run the saved invalid-password case, version 1, against http://localhost:3001/login; keep the original expectations and give me this replay's run details link, run ID, per-step results, and the recording playback path.

You can also point at a full run as the replay basis:

> $webpilot:replay Re-run the test plan from run RUN_ID, with the target changed to http://localhost:3001/login, using the test environment parameters provided in this message.

Replay operates the browser again, so the target address, test identity, files, and data preparation all need to exist; if any is missing it reports a blocker. Changing the login state, port, or test data does not mean you may change the original case's business expectations. Case versions cannot be overwritten; if the formal requirement changed, state the new basis and save a new version.

After a failure, diagnose first, then fix as needed:

> $webpilot:diagnose Analyze run RUN_ID, list each failed step's expectation, actual result, and evidence, separate confirmed facts from possible causes, and give me a way to reproduce it.

To fix code in the same pass, add: "fix the confirmed problem, then replay with the original case." Diagnosing on its own won't quietly change product code, and it shouldn't paper over failures by loosening assertions.

### Reports, screenshots, and recordings

verify and replay open the local test center before executing and include a clickable "this run's details" link in the reply. It leads to the timeline, screenshots, report, and recording for that run. You get a link whether the run passed, failed, was blocked, or was inconclusive; a replay gives you the new run's link. If you explicitly turned off the test center or no link could be obtained, the reply says why.

A complete run stores `report.md` and `report.json` with the run ID, target, viewport, coverage, gaps, case version, step results, available evidence, and reproduction entry points. You can also just ask Codex: "open the test report and give me the screenshot link for the failed step."

| Status | What it means | What to do next |
|---|---|---|
| `passed` | All formal assertions for this run are satisfied | Judge whether that's enough given the coverage; save a case if needed |
| `failed` | The actual result violates an explicit expectation | Diagnose with the run ID, fix, then replay with the original case |
| `blocked` | Environment, permissions, identity, or data prevented execution | Supply the missing condition and replay |
| `inconclusive` | Expectations, evidence, or capability were insufficient, or execution didn't finish | Add expectations, remove locator ambiguity, or resolve the gaps in the report |

Results that only passed after a retry are marked unstable and cannot be treated as a stable pass. Pages and flows that weren't covered are outside the scope of this pass.

To watch an already-recorded run, send: "give me the recording playback path for run RUN_ID." Open the returned `playbackPath` (a local `recordings.html`) in a browser to play, pause, and scrub without replaying. A recording is finalized only after the run ends and the browser context closes; if there is no recording, the report says why.

Recordings are on by default, stored only on your machine, unredacted, and cleaned up with the run at the end of the retention period — 7 days by default. Once archived in the test center they are kept permanently. To skip recording, write "don't record a video for this run" in your request, which maps to `target.evidence.video:false`. Screenshots and page snapshots have separate redaction settings; see [reporting](docs/reporting.md).

### Export as a standalone test package

To run these regression tests without Codex, use export. The output directory must be a new directory that doesn't exist yet:

> $webpilot:export Export the test plan from run RUN_ID to a not-yet-existing tests/webpilot-login directory under the current project, keep the original assertions and wait conditions, list the external login state, data, and configuration requirements, and verify the exported package against the same target and equivalent test data.

The exported directory contains test files, configuration, a README, and a snapshot of the run kernel. Running it needs Node.js, a browser, and system dependencies — no WebPilot plugin and no model credentials. Go to the returned output directory and follow the package's README to install and run.

macOS:

```sh
npm install --ignore-scripts
npx playwright install chromium
BASE_URL=http://localhost:3000 npm test
```

Windows PowerShell:

```powershell
npm.cmd install --ignore-scripts
npx.cmd playwright install chromium
$env:BASE_URL = "http://localhost:3000"
npm.cmd test
```

If it needs identity, files, or data scripts, supply external bindings / target config as the export instructions describe. Generating files is not the same as verifying them — check the `verified` flag in `manifest.json` and the verification report. To hand it to CI, copy the whole exported directory over, keep the lockfile generated by installation, and prepare the target service, Chromium, system dependencies, and external parameters; see [standalone export](docs/export.md).

### Run directly from the CLI

If you already have a structured plan, you can run it in a terminal with no model involved. The commands below run from the WebPilot source repository root; anywhere else, use WebPilot's absolute entry point. The CLI does not require the target project to have WebPilot installed.

First prepare `plan.json` and any bindings following the [plan and bindings example](docs/interfaces.md), or have Codex write a confirmed acceptance plan into those two files. The examples below consistently use `.webpilot/data` for storage; replace `RUN_ID`, the case ID/version, URLs, and output directories with actual values:

```sh
# Execute a plan; add --bindings /path/to/bindings.json when run parameters are needed
node dist/cli/index.js run --plan plan.json --data-dir .webpilot/data

# Save one case; it is promoted to a formal regression case after an independent clean re-run
node dist/cli/index.js save --plan plan.json --case invalid-password --promote --data-dir .webpilot/data

# Replay a full run, or a specific saved case version
node dist/cli/index.js replay --run RUN_ID --url http://localhost:3001 --data-dir .webpilot/data
node dist/cli/index.js replay --case invalid-password --version 1 --url http://localhost:3001 --data-dir .webpilot/data

# Read the JSON report, or export to a new directory
node dist/cli/index.js report --run RUN_ID --data-dir .webpilot/data
node dist/cli/index.js export --run RUN_ID --out ./new-test-package --data-dir .webpilot/data
```

These `node` commands also work in PowerShell. run / save / replay / export all need the corresponding arguments when bindings are involved. To watch the browser while it runs, add `--headful`.

The CLI and the desktop plugin must use the same data directory to find the same assets by ID. By default, data lives in WebPilot's user cache and `doctor` shows the actual path; `.webpilot/data` in the examples is an explicit override. To read runs created by the desktop plugin, use its actual directory. `--data-dir` or `WEBPILOT_DATA_DIR` sets the storage location, so business cases don't have to live inside the target project.

Exit codes:

| Exit code | Meaning |
|---|---|
| `0` | Stable, complete pass |
| `1` | A formal assertion failed |
| `2` | Blocked, not fully verified, or only passed after a retry |
| `3` | Internal error or invalid invocation |

In CI, keep a JSON report as well so you can tell exactly what happened. For more commands and schemas, see the [interface reference](docs/interfaces.md).

## Local test center

Multiple chats, projects, and CLI invocations under the same system user share one local test center, and runs from different data directories are aggregated onto one page.

### Open and stop

You can open or inspect it manually with these commands; use the address the command returns:

```sh
node dist/cli/index.js dashboard open
node dist/cli/index.js dashboard status

# Open a specific run, or force the page to reopen after it was closed
node dist/cli/index.js dashboard open --run RUN_ID
node dist/cli/index.js dashboard open --force

# Import history from an older data directory
node dist/cli/index.js dashboard import --data-dir /path/to/older-webpilot-data
```

Automatic opening is de-duplicated across chats: if this service already opened a page, later tests are added to the existing dashboard and you get the link. If you closed the page yourself, follow the link back or use `--force` to pop it again. Closing the page doesn't stop tests; the service stays up after runs finish and history is always available. When you no longer need it, run `node dist/cli/index.js dashboard stop`; it does not cancel running tests.

### Reviewing runs

The sidebar has "All runs", "Running", "Failures", and "Archived". The overview lets you search by run name, project, or target, filter by status, and paginate. Open a run to see the execution timeline, each step's expectation and actual result, the live view, screenshots, report, and recording. Screenshots open enlarged at their original size; select two runs in the list to "watch side by side". Narrow screens stack them vertically.

A fixed plan shows completed case counts. Incremental browser exploration only shows steps already executed and gives no speculative completion percentage; closing exploration normally does not mean acceptance passed. Live-view disconnects, lost runners, and business assertion failures are displayed separately.

### Managing run records

Use the `⋯` menu in the run list or run details:

| Action | How it works and what it does |
|---|---|
| Rename | Choose "Rename", enter a name of 1 to 120 characters, and save; it works while a run is executing. The new name propagates to the list, search, and details, while the original report, results, and evidence stay as they are. |
| Archive and keep permanently | A finished, manageable run moves to "Archived", keeping its existing report, screenshots, recording, and original details link; automatic cleanup and `prune --days` both skip it. |
| Restore to current records | Restore it from "Archived", or click "Undo" after archiving. It remains permanently kept after restoring. |
| Delete… | The dialog shows the run name; click "Delete permanently" to remove the report, screenshots, recording, and execution record. Deletion cannot be undone. Saved regression cases, project files, and standalone export packages are unaffected. |
| Batch management | Click "Batch manage", select runs or "select all on this page", then archive, restore, or confirm deletion in bulk, without the two-run limit of side-by-side viewing. |

Runs that are executing, still collecting evidence or cleaning up, or that lost contact without a confirmed termination cannot be archived or deleted; the menu explains why. Changing scope, filters, search, or page clears the batch selection. Batch operations report results item by item, and failures can be retried. Archiving keeps only the files that exist; evidence that was already missing or expired is not restored.

### Live view, recording, and automatic opening

CLI `--no-open` only records progress without popping a page, and `--no-dashboard` turns off dashboard integration for that execution. `target.evidence.live:false` turns off the live view alone, and `target.evidence.video:false` turns off recording. The live view is only captured while someone is watching, and frames may contain local sensitive content that hasn't been redacted.

The dashboard's service directory and the test asset directory are separate: `--data-dir` / `WEBPILOT_DATA_DIR` sets test assets, while `--dashboard-dir` / `WEBPILOT_DASHBOARD_DIR` isolates dashboard service state. For full configuration, access mechanics, and recovery rules, see the [local test center docs](docs/dashboard.md).

## Scope

What works today:

- Semantic locators, forms, conditional waits, iframes, new pages, upload and download checks.
- Traceable assertion sources; AI guesses are only candidates, and gaps never count as passes.
- passed / failed / blocked / inconclusive, with failure retries and unstable markers preserved.
- Independent role contexts, external login state, data prepare/cleanup, and service ownership management.
- JSON/Markdown reports, redacted snapshots and screenshots; every browser execution records a local WebM video by default, with a player entry point in the report. Raw sensitive traces are off by default and only kept locally when explicitly requested.
- A local test center shared across chats and projects, with live progress and browser view, screenshot enlargement, and two runs side by side; supports run renaming, permanent archiving, and batch management.
- Draft and immutable case versions; an independent re-run before promotion; business standard changes require a new basis and an adoption record.

Not done yet:

- Chromium only; no multi-browser support.
- Canvas visual operations, mobile hardware equivalence, and exhaustive whole-site coverage are not implemented.
- The app's own startup environment, business expectations, login, and data preparation still come from you. "Framework-independent" means integration and execution don't care about your stack.

## Development

```sh
npm run typecheck
npm test
npm ci --ignore-scripts --prefix tests/fixtures
node scripts/compatibility-check.mjs
node scripts/host-check.mjs .webpilot/marketplace

# Regenerate the README demo GIF (macOS, needs ffmpeg)
node scripts/capture-readme-demo.mjs .webpilot/readme-frames
scripts/build-demo-gif.sh .webpilot/readme-frames assets/demo.gif
```

Tests need a loopback service and permission to start Chromium processes. See the [compatibility record](docs/compatibility.md) for results across the five real fixtures and the defect set. For dashboard-specific verification, see [live dashboard acceptance](docs/dashboard-acceptance.md), [workspace UI acceptance](docs/workspace-ui-acceptance.md), [visual refresh acceptance](docs/dashboard-visual-refresh.md), [pre-test coverage and acceptance](docs/pretest-coverage-acceptance.md), [run management acceptance](docs/run-management-acceptance.md), and [run title acceptance](docs/run-title-acceptance.md).

## Related documentation

The detailed documentation is currently written in Chinese.

| Document | Contents |
|---|---|
| [Installation](docs/installation.md) | Installation details, updates, uninstall, and rollback per host platform |
| [Project integration](docs/project.md) | Targets, start commands, and data preparation |
| [Interfaces](docs/interfaces.md) | MCP tools, CLI commands, and schemas |
| [Planning](docs/planning.md) | Plan generation and execution |
| [Pre-test coverage and acceptance](docs/pretest-coverage-acceptance.md) | Coverage planning and acceptance reporting |
| [Reporting](docs/reporting.md) | Report structure, redaction, and evidence |
| [Assets](docs/assets.md) | Cases, runs, and storage layout |
| [Local test center](docs/dashboard.md) | Dashboard configuration, access mechanics, and recovery rules |
| [Standalone export](docs/export.md) | Export package structure and CI integration |
| [Compatibility](docs/compatibility.md) | Validated platforms, fixtures, and known limits |

## Feedback and contributions

If something breaks, follow the [pre-issue checklist](.github/CONTRIBUTING.md) to confirm your environment first, then pick the matching issue template. Installation, interface, and compatibility questions are usually answered faster by the docs listed above.

## License

[MIT](LICENSE)
