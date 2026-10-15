# Local installation

## Desktop app and terminal PATH

The desktop app may include its own Codex CLI without adding `codex` to your terminal PATH. A `command not found` error does not establish that desktop plugin support is unavailable. On the macOS installation tested here, the bundled executable is:

```sh
"/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" plugin marketplace add /Users/edy/www/webpilot/.webpilot/marketplace
"/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" plugin add webpilot@webpilot-local
"/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" plugin list
```

Use your actual application and marketplace paths; other versions/installations may differ. If WebPilot is already `installed, enabled`, skip installation. Restart the desktop app and open a new chat to check workflow discovery; an existing chat does not automatically gain newly installed tools. A desktop Plugins Directory can also expose configured local marketplaces, subject to host support. See the official packaging guide linked below.

## Windows desktop (PowerShell)

Install Windows Node.js 22+ with npm and a plugin-capable Codex desktop app. Open a new PowerShell window in the WebPilot checkout and prepare the package:

```powershell
node --version
npm.cmd --version
npm.cmd ci --ignore-scripts
npm.cmd run build
node dist/cli/index.js setup
node dist/cli/index.js doctor
node scripts/package-plugin.mjs .webpilot/marketplace
```

Check `Get-Command codex.exe, codex.cmd -ErrorAction SilentlyContinue` for an existing CLI. If none is available, install the [official Codex CLI](https://developers.openai.com/codex/cli) with `npm.cmd install -g @openai/codex`, reopen PowerShell, and return to the checkout. For the npm-installed CLI:

```powershell
$WebPilotCodex = (Get-Command codex.cmd -ErrorAction Stop).Source
$WebPilotMarketplace = (Resolve-Path -LiteralPath ".webpilot\marketplace").Path
& $WebPilotCodex --version
& $WebPilotCodex plugin --help
& $WebPilotCodex plugin marketplace add "$WebPilotMarketplace"
& $WebPilotCodex plugin add webpilot@webpilot-local
& $WebPilotCodex plugin list --marketplace webpilot-local
```

For an existing standalone or desktop-bundled `codex.exe`, set `$WebPilotCodex` to its actual full path instead. No fixed Windows desktop installation path is assumed. PowerShell's `&` invokes executable paths containing spaces; `.cmd` entry points avoid selecting PowerShell `.ps1` wrappers when script execution is restricted.

If `plugin add` is unavailable in your CLI version, register the marketplace, restart the desktop app, select **WebPilot Local** in the Plugins Directory, and install/enable WebPilot there, subject to host support. Keep the CLI and desktop app on the same Windows user and `CODEX_HOME`. Restart the app and open a new chat to check the four WebPilot skills.

Prepare native Windows dependencies and Chromium on Windows. A WSL installation has its own runtime, browser and configuration; prepare it separately. These instructions follow the [official Windows guide](https://developers.openai.com/codex/windows) and plugin packaging guide; WebPilot has not yet completed Windows machine acceptance (see [compatibility.md](compatibility.md)).

## Build and install

Node.js 22+ is required. In the WebPilot source checkout:

```sh
npm ci --ignore-scripts
npm run build
node dist/cli/index.js doctor --data-dir /path/to/writable/webpilot-data
node dist/cli/index.js setup
node scripts/package-plugin.mjs /path/to/webpilot-marketplace
codex plugin marketplace add /path/to/webpilot-marketplace
codex plugin add webpilot@webpilot-local
```

The marketplace contains a self-contained plugin copy with its own Node dependencies. Target applications do not install WebPilot. The portable manifest and a Codex compatibility overlay are included; neither defines lifecycle hooks.

Refresh installed files after rebuilding the source and packaging. Start a new Codex session so skills and tools can be loaded. Keep an earlier marketplace package to roll back. `codex plugin remove webpilot@webpilot-local` removes the installed plugin; saved test data remains in WebPilot storage. To remove its catalog too, use `codex plugin marketplace remove webpilot-local`. To restore, re-register the earlier marketplace package and install again.

Official packaging reference: https://developers.openai.com/plugins/build/plugins . Local plugin support varies by host. `node scripts/host-check.mjs /path/to/webpilot-marketplace` checks a fresh installed Codex binary's package parsing and a real packaged MCP handshake without starting a model turn or creating a user chat. It does not prove desktop UI installation or active-session refresh.

Tested host: Codex 0.162.0-alpha.17.2 on macOS arm64. This version supports `plugin add` and `plugin remove`; the official guide still emphasizes desktop installation, so check `codex plugin --help` when using another version. Full compatibility and limitations are in [compatibility.md](compatibility.md).
