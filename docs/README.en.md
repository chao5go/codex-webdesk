# Codex Webdesk

**Your Codex workspace, a browser tab away.**

Run tasks on your server, follow live output, and pick up yesterday’s conversations. Self-hosted, with your existing Codex CLI login and configuration.

[中文](../README.md) · [Deployment](deployment.md) · [Plugins](plugins.md) · [Configuration reference (中文)](reference.md)

![Workspace — simulated CLI output](screenshot.png)

## Start in a minute

Requires Node.js 22+, an installed and authenticated Codex CLI, and Linux/macOS. Full session management also requires Python 3.10+. The uv package includes the application, but does not install Node.js or Codex.

```bash
npx codex-webdesk start --cwd /srv/my-project
# Or
uvx codex-webdesk start --cwd /srv/my-project
```

The server listens on localhost:8080 and prints an access token. Forward the port from your computer:

```bash
ssh -N -L 8080:127.0.0.1:8080 your-user@your-server
```

Open http://127.0.0.1:8080 and enter the token.

## A place to work, and return to

- **Start with a goal.** Review code, generate tests, debug or refactor with prompt presets and configurable permissions.
- **Watch the work happen.** Streaming Markdown, highlighted code, copy buttons and raw terminal output.
- **Come back later.** Tasks continue when the tab closes; reconnect after reload and browse saved results.
- **Keep the context.** Search native Codex conversations and resume them in the workbench.
- **Take your work with you.** Export HTML, Markdown or JSON; combine sessions into handoff files.
- **Make room for your tools.** Local plugins share authentication, navigation and one port.

No database, locally bundled frontend assets, MIT licensed.

## Install and update

Choose one channel:

```bash
uv tool install codex-webdesk
uv tool upgrade codex-webdesk

# Or npm
npm install -g codex-webdesk
npm install -g codex-webdesk@latest
```

Restart the service after upgrading. Configuration and history are stored outside the installation.

## Scope

Designed for personal remote development, with one task at a time. Defaults to read-only; test generation and refactoring presets select workspace-write. Closing the browser leaves tasks running; stopping the service interrupts them. No multi-user isolation, interactive terminal or web approval flow. Use HTTPS for public access and protect the access token as a server credential.

See [deployment](deployment.md), [contributing](../CONTRIBUTING.md), [release automation](releasing.md), and [repository setup](repository-settings.md). Screenshots use simulated output, not a live model run.

Independent community project, not affiliated with OpenAI. [MIT](../LICENSE).
