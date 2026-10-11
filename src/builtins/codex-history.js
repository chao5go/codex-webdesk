import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError } from "../tasks.js";
import { UUID } from "../history.js";
const execute = promisify(execFile);
const folder = fileURLToPath(new URL("./codex-history/", import.meta.url));
export async function historyPlugin({ options, history, refresh }) {
  const python =
    options.pluginOptions?.["codex-history"]?.pythonBin || "python3";
  let available = true,
    reason = "";
  if (!(options.disabledPlugins || []).includes("codex-history")) {
    try {
      await execute(
        python,
        ["-c", "import sys; assert sys.version_info >= (3, 10)"],
        { timeout: 3000 },
      );
    } catch {
      available = false;
      reason =
        "完整会话管理需要 Python 3.10+，请安装后重启；任务页的 CLI 会话浏览仍可使用。";
    }
  }
  const csrf = randomBytes(32).toString("hex");
  let queue = Promise.resolve(),
    closing = false,
    controller;
  const call = (action, payload = {}) => {
    const operation = queue
      .catch(() => {})
      .then(async () => {
        if (closing) throw new HttpError(503, "插件正在关闭");
        controller = new AbortController();
        const env = {
          ...process.env,
          CODEX_HISTORY_COMMAND: options.codexBin,
          PYTHONDONTWRITEBYTECODE: "1",
        };
        delete env.CODEX_REMOTE_WEB_TOKEN;
        try {
          const pending = execute(python, [folder + "bridge.py"], {
            env,
            timeout: 60000,
            maxBuffer: 64 * 1024 * 1024,
            signal: controller.signal,
          });
          pending.child.stdin.on("error", () => {});
          pending.child.stdin.end(
            JSON.stringify({ home: options.codexHome, action, payload }),
          );
          const { stdout } = await pending;
          const response = JSON.parse(stdout);
          if (response.error)
            throw new HttpError(response.status || 500, response.error);
          return response.result;
        } catch (e) {
          if (e.status) throw e;
          if (closing) throw new HttpError(503, "插件正在关闭");
          console.error("Codex history adapter:", e.message);
          throw new HttpError(
            500,
            "会话插件执行失败，请检查 Python 或服务日志",
          );
        } finally {
          controller = null;
        }
      });
    queue = operation;
    return operation;
  };
  return {
    id: "codex-history",
    name: "Codex 会话管理",
    description: "搜索、导出、回收站删除与合并交接",
    icon: "▤",
    order: 20,
    type: "page",
    entry: "index.html",
    publicDir: folder + "public",
    available,
    reason,
    aliases: ["/api/sessions"],
    async handle({ req, res, url, route, legacy, body, json }) {
      // Preserve MVP read-only endpoints for the task workbench and existing API clients.
      if (legacy) {
        if (route === "/api/sessions" && req.method === "GET") {
          json(res, 200, { sessions: await refresh() });
          return true;
        }
        const match = /^\/api\/sessions\/([a-f0-9-]+)(?:\/(export))?$/.exec(
          route,
        );
        if (match && UUID.test(match[1]) && req.method === "GET") {
          if (!history.index.size) await refresh();
          const session = await history.get(match[1]);
          if (!session) throw new HttpError(404, "会话不存在");
          if (match[2])
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="codex-session-${session.id}.json"`,
            );
          json(res, 200, session);
          return true;
        }
        return false;
      }
      if (route === "/api/sessions" && req.method === "GET") {
        const result = await call("list");
        json(res, 200, { ...result, csrfToken: csrf });
        return true;
      }
      const action = /^\/api\/sessions\/(delete|merge|export)$/.exec(
        route,
      )?.[1];
      if (action && req.method === "POST") {
        const received = req.headers["x-csrf-token"] || "";
        if (
          typeof received !== "string" ||
          Buffer.byteLength(received) !== Buffer.byteLength(csrf) ||
          !timingSafeEqual(Buffer.from(received), Buffer.from(csrf))
        )
          throw new HttpError(403, "会话管理验证已失效，请刷新插件页面");
        const result = await call(action, await body(req));
        if (action === "export") {
          res.writeHead(200, {
            "Content-Type": result.mime,
            "Content-Disposition": `attachment; filename="${result.filename}"`,
          });
          res.end(Buffer.from(result.body, "base64"));
        } else json(res, 200, result);
        return true;
      }
      return false;
    },
    async close() {
      closing = true;
      controller?.abort();
      await queue.catch(() => {});
    },
  };
}
