import { version } from "./version.js";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Tasks, HttpError } from "./tasks.js";
import { History } from "./history.js";
import { Plugins } from "./plugins.js";
import { workbenchPlugin } from "./builtins/workbench.js";
import { historyPlugin } from "./builtins/codex-history.js";
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const equal = (a, b) =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};
async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "需要 application/json");
  let size = 0,
    chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256000) throw new HttpError(413, "请求过大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON 无效");
  }
}
export async function createServer(options) {
  const tasks = new Tasks(options),
    history = new History(options.codexHome);
  await tasks.init();
  tasks.on("storageError", (error) =>
    console.error("History persistence failed:", error.message),
  );
  const sessions = new Map(),
    attempts = new Map(),
    streams = new Set();
  let refreshing;
  const refresh = () =>
    (refreshing ||= history.refresh().finally(() => {
      refreshing = null;
    }));
  const safeOptions = { ...options };
  delete safeOptions.token;
  const context = { options: safeOptions, tasks, history, refresh, streams };
  const plugins = new Plugins(context);
  plugins.add(workbenchPlugin(context));
  plugins.add(await historyPlugin(context));
  for (const id of options.disabledPlugins || [])
    if (plugins.items.has(id)) plugins.items.get(id).enabled = false;
  try {
    await plugins.load(options.pluginsDir, options.disabledPlugins || []);
  } catch (e) {
    await Promise.allSettled([plugins.close(), tasks.close()]);
    throw e;
  }
  const expire = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of sessions) if (value < now) sessions.delete(key);
    for (const [key, value] of attempts)
      if (value.until < now) attempts.delete(key);
  }, 60000).unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      const url = new URL(req.url, "http://localhost"),
        route = url.pathname;
      const origin = req.headers.origin;
      if (origin) {
        let host;
        try {
          host = new URL(origin).host;
        } catch {
          throw new HttpError(403, "来源无效");
        }
        if (
          host !== req.headers.host ||
          (options.origin && origin !== options.origin)
        )
          throw new HttpError(403, "不允许跨站请求");
      }
      if (req.method === "POST" && route === "/api/login") {
        const ip = req.socket.remoteAddress; // Do not trust forwarded headers for rate limiting.
        const limit = attempts.get(ip);
        if (limit && limit.until > Date.now() && limit.count >= 10)
          throw new HttpError(429, "登录尝试过多，请 5 分钟后重试");
        const input = await body(req);
        if (!equal(input?.token, options.token)) {
          if (attempts.size > 10000) throw new HttpError(429, "登录繁忙");
          attempts.set(ip, {
            count: (limit?.until > Date.now() ? limit.count : 0) + 1,
            until: Date.now() + 300000,
          });
          throw new HttpError(401, "Access Token 无效");
        }
        attempts.delete(ip);
        if (sessions.size >= 1000) throw new HttpError(429, "登录会话过多");
        const sid = randomBytes(32).toString("hex");
        sessions.set(sid, Date.now() + 86400000);
        res.setHeader(
          "Set-Cookie",
          `crw_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${options.secureCookie ? "; Secure" : ""}`,
        );
        return json(res, 200, { ok: true });
      }
      if (route.startsWith("/api/") || route.startsWith("/plugins/")) {
        const bearer =
          req.headers.authorization?.startsWith("Bearer ") &&
          equal(req.headers.authorization.slice(7), options.token);
        const sid = /(?:^|;\s*)crw_session=([a-f0-9]+)/.exec(
          req.headers.cookie || "",
        )?.[1];
        if (!bearer && !(sessions.get(sid) > Date.now()))
          throw new HttpError(401, "请先登录");
        if (!["GET", "HEAD"].includes(req.method) && !bearer && !origin)
          throw new HttpError(403, "缺少请求来源");
        if (route.startsWith("/plugins/")) {
          if (!["GET", "HEAD"].includes(req.method))
            throw new HttpError(405, "不支持此方法");
          await plugins.asset(route, res, req.method);
          return;
        }
        if (route === "/api/logout" && req.method === "POST") {
          sessions.delete(sid);
          res.setHeader(
            "Set-Cookie",
            `crw_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${options.secureCookie ? "; Secure" : ""}`,
          );
          return json(res, 200, { ok: true });
        }
        if (route === "/api/config" && req.method === "GET")
          return json(res, 200, {
            cwd: options.cwd,
            codexHome: options.codexHome,
            workspaceRoot: options.workspaceRoot || null,
            activeId: tasks.active?.item.id || null,
            version,
          });
        if (route === "/api/plugins" && req.method === "GET")
          return json(res, 200, { plugins: plugins.list() });
        if (
          await plugins.dispatch(req, res, url, {
            body,
            json,
            isAuthorized: () => bearer || sessions.get(sid) > Date.now(),
          })
        )
          return;
        throw new HttpError(404, "接口不存在");
      }
      if (!["GET", "HEAD"].includes(req.method))
        throw new HttpError(405, "不支持此方法");
      const assets = {
        "/": "index.html",
        "/app.js": "app.js",
        "/app.css": "app.css",
        "/style.css": "style.css",
      };
      if (!assets[route]) throw new HttpError(404, "页面不存在");
      const types = {
        html: "text/html",
        js: "text/javascript",
        css: "text/css",
      };
      const file = assets[route];
      const data = await readFile(dist + file);
      res.writeHead(200, {
        "Content-Type": `${types[file.split(".").at(-1)]}; charset=utf-8`,
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (!e.status) console.error(e);
      json(res, e.status || 500, {
        error: e.status ? e.message : "服务器内部错误，请查看服务日志",
      });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return {
    server,
    tasks,
    history,
    plugins,
    async close() {
      clearInterval(expire);
      const closed = new Promise((resolve) => server.close(resolve));
      for (const res of streams) res.end();
      const results = await Promise.allSettled([
        plugins.close(),
        tasks.close(),
      ]);
      server.closeAllConnections();
      await closed;
      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
    },
  };
}
