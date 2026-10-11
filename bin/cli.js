#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, realpath } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";
const help = `codex-remote-web [start] [options]

  --port <number>         Port (default: 8080)
  --host <address>        Listen address (default: 127.0.0.1)
  --token <secret>        Access token; prefer CODEX_REMOTE_WEB_TOKEN
  --cwd <directory>       Default project directory (default: current directory)
  --workspace-root <dir>  Restrict cwd/additional directories to this root
  --codex-home <dir>      Codex history/auth directory (default: CODEX_HOME or ~/.codex)
  --codex-bin <path>      Codex executable (default: codex)
  --data-dir <dir>        Task history (default: ~/.local/share/codex-remote-web)
  --plugins-dir <dir>    Local tool plugins (default: ~/.config/codex-remote-web/plugins)
  --disable-plugins <ids> Comma-separated plugin IDs to disable
  --config <file>         JSON configuration (camelCase keys)
  --origin <url>          Expected browser origin behind a reverse proxy
  --secure-cookie        Set Secure cookies (use with HTTPS)
  --help                 Show help
  --version              Show version
`;
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries([
      ...[
        "port",
        "host",
        "token",
        "cwd",
        "workspace-root",
        "codex-home",
        "codex-bin",
        "data-dir",
        "plugins-dir",
        "disable-plugins",
        "config",
        "origin",
      ].map((k) => [k, { type: "string" }]),
      ...["help", "version", "secure-cookie"].map((k) => [
        k,
        { type: "boolean" },
      ]),
    ]),
  });
  if (values.help) {
    console.log(help);
    process.exit(0);
  }
  if (values.version) {
    console.log("0.1.0");
    process.exit(0);
  }
  if (
    positionals.length &&
    (positionals.length !== 1 || positionals[0] !== "start")
  )
    throw new Error("Only the start command is supported");
  const config = values.config
    ? JSON.parse(await readFile(values.config, "utf8"))
    : {};
  const allowed = new Set([
    "port",
    "host",
    "token",
    "cwd",
    "workspaceRoot",
    "codexHome",
    "codexBin",
    "dataDir",
    "origin",
    "secureCookie",
    "pluginsDir",
    "disabledPlugins",
    "pluginOptions",
  ]);
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    Object.keys(config).some((k) => !allowed.has(k))
  )
    throw new Error("Invalid configuration keys");
  const options = {
    port: 8080,
    host: "127.0.0.1",
    cwd: process.cwd(),
    codexHome: process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    codexBin: "codex",
    dataDir: path.join(os.homedir(), ".local/share/codex-remote-web"),
    pluginsDir: path.join(os.homedir(), ".config/codex-remote-web/plugins"),
    ...config,
  };
  if (process.env.CODEX_REMOTE_WEB_TOKEN)
    options.token = process.env.CODEX_REMOTE_WEB_TOKEN;
  for (const [key, value] of Object.entries(values))
    if (!["config", "help", "version"].includes(key))
      options[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  if (options.disablePlugins !== undefined) {
    options.disabledPlugins = options.disablePlugins
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    delete options.disablePlugins;
  }
  if (
    options.disabledPlugins &&
    (!Array.isArray(options.disabledPlugins) ||
      options.disabledPlugins.some(
        (id) => typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id),
      ))
  )
    throw new Error("disabledPlugins must be an array of plugin IDs");
  if (
    options.pluginOptions &&
    (typeof options.pluginOptions !== "object" ||
      Array.isArray(options.pluginOptions) ||
      Object.values(options.pluginOptions).some(
        (value) => !value || typeof value !== "object" || Array.isArray(value),
      ))
  )
    throw new Error("pluginOptions must contain configuration objects");
  if (typeof options.pluginsDir !== "string")
    throw new Error("Invalid pluginsDir");
  options.pluginsDir = path.resolve(options.pluginsDir);
  options.port = Number(options.port);
  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65535
  )
    throw new Error("Port must be 1–65535");
  for (const field of ["host", "cwd", "codexHome", "codexBin", "dataDir"])
    if (typeof options[field] !== "string" || !options[field])
      throw new Error(`Invalid ${field}`);
  if (
    options.token !== undefined &&
    (typeof options.token !== "string" || options.token.length < 16)
  )
    throw new Error("Token must contain at least 16 characters");
  if (
    options.secureCookie !== undefined &&
    typeof options.secureCookie !== "boolean"
  )
    throw new Error("secureCookie must be boolean");
  if (options.origin) {
    const parsed = new URL(options.origin);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== options.origin
    )
      throw new Error(
        "origin must be an HTTP(S) origin without trailing slash",
      );
  }
  options.cwd = await realpath(options.cwd);
  options.codexHome = path.resolve(options.codexHome);
  options.dataDir = path.resolve(options.dataDir);
  if (options.workspaceRoot)
    options.workspaceRoot = await realpath(options.workspaceRoot);
  const generated = !options.token;
  options.token ||= randomBytes(32).toString("base64url");
  const app = await createServer(options);
  app.server.on("error", (error) => {
    console.error(`Cannot start server: ${error.message}`);
    process.exit(1);
  });
  app.server.listen(options.port, options.host, () => {
    const host = ["0.0.0.0", "::"].includes(options.host)
      ? "127.0.0.1"
      : options.host.includes(":")
        ? `[${options.host}]`
        : options.host;
    const address = `http://${host}:${options.port}`;
    console.log(
      `Codex Remote Web 0.1.0\nListening: ${options.host}:${options.port}\nOpen: ${address}`,
    );
    if (generated)
      console.log(
        `Login: ${address}/?token=${encodeURIComponent(options.token)}\nAccess Token: ${options.token}`,
      );
    console.log(`Workspace: ${options.cwd}\nHistory: ${options.dataDir}`);
  });
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      try {
        await app.close();
        process.exitCode = 0;
      } catch (e) {
        console.error(e.message);
        process.exitCode = 1;
      }
    });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
