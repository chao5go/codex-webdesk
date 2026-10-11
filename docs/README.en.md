# Codex Webdesk

A lightweight, self-hosted browser workbench for **Codex CLI on your VPS**. Run prompts, follow streaming output, stop tasks and browse local history. MIT licensed; no cloud storage or separate model API integration.

## Quick start

Requires Node.js 22+, Python 3.10+ for the full history plugin, Linux/macOS and an installed, authenticated Codex CLI. CLI flags were checked against version 0.160.1.

```bash
npm ci
npm run build
node bin/cli.js start --cwd /absolute/path/to/project --port 8080
```

The server binds to localhost and prints a generated access token. On your local computer:

```bash
ssh -N -L 8080:127.0.0.1:8080 your-user@your-vps
```

Open `http://127.0.0.1:8080` and enter the token. Set `CODEX_WEBDESK_TOKEN` to a random fixed secret for later startups. Use HTTPS when exposing the service through a reverse proxy.

## Features

- Multiline prompts, keyboard submission and review/test/debug/refactor presets.
- Model, reasoning effort, directory, additional context and sandbox controls.
- Single-task execution via `spawn`, SSE reconnect/replay, Markdown highlighting and ANSI terminal output.
- Whole-process-group cancellation and local JSON task persistence.
- Full Codex history plugin: conversation search, filters, HTML/Markdown/JSON exports, recoverable deletion, multi-session handoffs and direct resume.
- Local page plugins with optional namespaced Node backends, shared login and automatic navigation. See [plugin guide](plugins.md) and the included server-info example.
- Token/Bearer authentication, HttpOnly cookies, rate limiting and same-origin write checks.
- Bundled assets without external CDN requests.

This is a personal-use MVP. Approval UI, multiple users, queues and terminal input are not implemented. Data retention is bounded per task, but old task files require manual archival. Tests use a fake CLI; paid model execution and memory benchmarks have not been run.

```bash
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm pack
```

The project has not been published to npm. See the [Chinese README](../README.md) for complete configuration and limits, [deployment](deployment.md), [architecture/API](architecture.md) and [contributing](../CONTRIBUTING.md).

## Package installation

Install with `npm install -g codex-webdesk` or `uv tool install codex-webdesk`, then run `codex-webdesk start --cwd /path/to/project`. Upgrade with `npm install -g codex-webdesk@latest` or `uv tool upgrade codex-webdesk`. For a temporary run use `uvx codex-webdesk@0.1.0 start`. Both distributions require Node.js 22+ and an installed, authenticated Codex CLI. The npm distribution additionally needs Python 3.10+ for full session management. Linux/macOS are supported; Windows is unverified. Choose one installation channel to avoid command collisions. Legacy data/plugin directories and `CODEX_REMOTE_WEB_TOKEN` remain supported; `CODEX_WEBDESK_TOKEN` takes precedence.
