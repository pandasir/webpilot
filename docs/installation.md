# Local installation

## Desktop app and terminal PATH

The desktop app may include its own Codex CLI without adding `codex` to your terminal PATH. A `command not found` error does not establish that desktop plugin support is unavailable. On the macOS installation tested here, the bundled executable is:

```sh
"/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" plugin marketplace add /Users/edy/www/webpilot/.webpilot/marketplace
"/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" plugin add webpilot@webpilot-local
"/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" plugin list
```

Use your actual application and marketplace paths; other versions/installations may differ. If WebPilot is already `installed, enabled`, skip installation. Restart the desktop app and open a new chat to check workflow discovery; an existing chat does not automatically gain newly installed tools. A desktop Plugins Directory can also expose configured local marketplaces, subject to host support. See the official packaging guide linked below.

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
