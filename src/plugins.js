import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HttpError } from "./tasks.js";
const ID = /^[a-z][a-z0-9-]{0,47}$/;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
export async function contained(root, relative) {
  if (
    typeof relative !== "string" ||
    !relative ||
    path.isAbsolute(relative) ||
    relative.includes("\0") ||
    relative
      .split(/[\\/]/)
      .some((part) => part === ".." || part.startsWith("."))
  )
    throw new HttpError(400, "插件文件路径无效");
  const base = await realpath(root),
    file = await realpath(path.resolve(base, relative));
  const rel = path.relative(base, file);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    throw new HttpError(403, "插件文件超出目录范围");
  if (!(await stat(file)).isFile()) throw new HttpError(404, "插件文件不存在");
  return file;
}
export class Plugins {
  constructor(context) {
    this.context = context;
    this.items = new Map();
    this.closed = false;
  }
  add(plugin) {
    if (typeof plugin.id !== "string" || !ID.test(plugin.id) || this.items.has(plugin.id))
      throw new Error(`Invalid or duplicate plugin ID: ${plugin.id}`);
    this.items.set(plugin.id, plugin);
  }
  list() {
    return [...this.items.values()]
      .sort(
        (a, b) =>
          (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id),
      )
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description || "",
        icon: p.icon || "◇",
        type: p.type,
        enabled: p.enabled !== false,
        available: p.available !== false,
        reason: p.reason || "",
        entry:
          p.type === "page" && p.enabled !== false && p.available !== false
            ? `/plugins/${p.id}/${p.entry || "index.html"}`
            : null,
      }));
  }
  async load(directory, disabled = []) {
    if (!directory) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const folder = path.join(directory, entry.name);
      const manifest = JSON.parse(
        await readFile(await contained(folder, "plugin.json"), "utf8"),
      );
      if (
        manifest.apiVersion !== 1 ||
        typeof manifest.id !== "string" ||
        !ID.test(manifest.id) ||
        typeof manifest.name !== "string" ||
        !manifest.name.trim() ||
        manifest.name.length > 80 ||
        (manifest.description !== undefined &&
          typeof manifest.description !== "string") ||
        (manifest.icon !== undefined && typeof manifest.icon !== "string") ||
        (manifest.order !== undefined && !Number.isFinite(manifest.order))
      )
        throw new Error(`Invalid plugin manifest: ${entry.name}`);
      if (this.items.has(manifest.id))
        throw new Error(`Duplicate plugin ID: ${manifest.id}`);
      const plugin = {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        icon: manifest.icon,
        order: manifest.order,
        type: "page",
        entry: manifest.entry || "index.html",
        publicDir: path.join(folder, "public"),
        enabled: !disabled.includes(manifest.id),
      };
      if (plugin.enabled) {
        await contained(plugin.publicDir, plugin.entry);
        if (manifest.server) {
          const module = await import(
            pathToFileURL(await contained(folder, manifest.server)).href
          );
          if (typeof module.default !== "function")
            throw new Error(
              `${plugin.id}: server must export a default factory`,
            );
          const server = await module.default(
            Object.freeze({
              id: plugin.id,
              pluginDir: folder,
              dataDir: path.join(
                this.context.options.dataDir,
                "plugins",
                plugin.id,
              ),
              config: Object.freeze(
                this.context.options.pluginOptions?.[plugin.id] || {},
              ),
              apiBase: `/api/plugins/${plugin.id}`,
              HttpError,
            }),
          );
          if (!server || typeof server.handle !== "function")
            throw new Error(`${plugin.id}: factory must return handle()`);
          plugin.handle = server.handle.bind(server);
          plugin.close = server.close?.bind(server);
        }
      }
      this.add(plugin);
    }
  }
  async dispatch(req, res, url, helpers) {
    if (this.closed) throw new HttpError(503, "服务正在关闭");
    const match = /^\/api\/plugins\/([a-z][a-z0-9-]*)(\/.*)?$/.exec(
      url.pathname,
    );
    if (match) {
      const plugin = this.items.get(match[1]);
      if (!plugin || plugin.enabled === false)
        throw new HttpError(404, "插件未启用");
      if (plugin.available === false)
        throw new HttpError(503, plugin.reason || "插件不可用");
      if (
        !plugin.handle ||
        !(await plugin.handle({
          req,
          res,
          url,
          route: match[2] || "/",
          ...helpers,
        }))
      )
        throw new HttpError(404, "插件接口不存在");
      return true;
    }
    for (const plugin of this.items.values()) {
      if (
        plugin.enabled === false ||
        !plugin.aliases?.some(
          (prefix) =>
            url.pathname === prefix || url.pathname.startsWith(prefix + "/"),
        )
      )
        continue;
      if (
        await plugin.handle({
          req,
          res,
          url,
          route: url.pathname,
          legacy: true,
          ...helpers,
        })
      )
        return true;
    }
    return false;
  }
  async asset(route, res, method) {
    const match = /^\/plugins\/([a-z][a-z0-9-]*)\/(.*)$/.exec(route);
    if (!match) throw new HttpError(404, "插件页面不存在");
    const plugin = this.items.get(match[1]);
    if (!plugin || plugin.enabled === false || plugin.type !== "page")
      throw new HttpError(404, "插件未启用");
    if (plugin.available === false)
      throw new HttpError(503, plugin.reason || "插件不可用");
    let relative;
    try {
      relative = decodeURIComponent(match[2] || plugin.entry || "index.html");
    } catch {
      throw new HttpError(400, "路径无效");
    }
    const mime = types[path.extname(relative).toLowerCase()];
    if (!mime) throw new HttpError(404, "不支持此文件类型");
    let file;
    try {
      file = await contained(plugin.publicDir, relative);
    } catch (e) {
      if (e.code === "ENOENT") throw new HttpError(404, "插件文件不存在");
      throw e;
    }
    const data = await readFile(file);
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
    );
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.writeHead(200, { "Content-Type": mime });
    res.end(method === "HEAD" ? undefined : data);
  }
  async close() {
    this.closed = true;
    const results = await Promise.allSettled(
      [...this.items.values()]
        .reverse()
        .map((plugin) => Promise.resolve().then(() => plugin.close?.())),
    );
    const errors = results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    if (errors.length)
      throw new AggregateError(errors, "Plugin shutdown failed");
  }
}
