// Port of the user's codex-history reader: response items first, event messages as fallback.
import { readdir, lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
export const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function* records(file) {
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  // readline does not forward input stream errors.
  let error;
  stream.on("error", (e) => {
    error = e;
    lines.close();
  });
  try {
    for await (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row && typeof row === "object") yield row;
      } catch {
        /* partial JSONL */
      }
    }
    if (error) throw error;
  } finally {
    lines.close();
    stream.destroy();
  }
}
function cleanUser(text) {
  text = text
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, "")
    .trim();
  return /^(# AGENTS\.md instructions for |<permissions instructions>)/.test(
    text,
  )
    ? ""
    : text;
}
async function* walk(root) {
  try {
    if ((await lstat(root)).isSymbolicLink()) return;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) yield* walk(file);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield file;
    }
  } catch (e) {
    if (!["ENOENT", "EACCES"].includes(e.code)) throw e;
  }
}
export class History {
  constructor(home) {
    this.home = home;
    this.index = new Map();
  }
  async refresh() {
    const names = new Map();
    try {
      for await (const r of records(
        path.join(this.home, "session_index.jsonl"),
      ))
        if (typeof r.id === "string") names.set(r.id, r.thread_name);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const index = new Map();
    for (const folder of ["sessions", "archived_sessions"]) {
      for await (const file of walk(path.join(this.home, folder))) {
        try {
          const item = await this.read(file, false);
          if (!item) continue;
          item.title = names.get(item.id) || item.title;
          item.archived = folder === "archived_sessions";
          item.file = file;
          if (!index.has(item.id) || item.updated > index.get(item.id).updated)
            index.set(item.id, item);
        } catch (e) {
          if (!["ENOENT", "EACCES"].includes(e.code)) throw e;
        }
      }
    }
    this.index = index;
    return this.list();
  }
  list() {
    return [...this.index.values()]
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .map(({ file, ...s }) => s);
  }
  async get(id) {
    const entry = this.index.get(id);
    if (!entry) return null;
    const data = await this.read(entry.file, true);
    return data
      ? { ...data, title: entry.title, archived: entry.archived }
      : null;
  }
  async read(file, detail) {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    let meta = {},
      model = "",
      first = "",
      eventFirst = "";
    const messages = [],
      events = [];
    let kept = 0,
      truncated = false;
    const keep = (arr, msg) => {
      if (!detail) return;
      const remaining = 2_000_000 - kept;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      if (msg.text.length > remaining) {
        msg.text = msg.text.slice(0, remaining);
        truncated = true;
      }
      kept += msg.text.length;
      arr.push(msg);
    };
    for await (const row of records(file)) {
      const p = row.payload;
      if (!p || typeof p !== "object") continue;
      if (row.type === "session_meta") meta = p;
      else if (row.type === "turn_context") model = p.model || model;
      else if (
        row.type === "response_item" &&
        p.type === "message" &&
        ["user", "assistant"].includes(p.role)
      ) {
        let text = Array.isArray(p.content)
          ? p.content
              .filter((c) => typeof c?.text === "string")
              .map((c) => c.text)
              .join("\n")
          : "";
        text = p.role === "user" ? cleanUser(text) : text.trim();
        if (text) {
          if (p.role === "user" && !first)
            first = text.split("\n")[0].slice(0, 100);
          keep(messages, { role: p.role, text, time: row.timestamp || "" });
        }
      } else if (
        row.type === "event_msg" &&
        ["user_message", "agent_message"].includes(p.type) &&
        typeof p.message === "string"
      ) {
        const role = p.type === "user_message" ? "user" : "assistant";
        const text = role === "user" ? cleanUser(p.message) : p.message.trim();
        if (text) {
          if (role === "user" && !eventFirst)
            eventFirst = text.split("\n")[0].slice(0, 100);
          keep(events, { role, text, time: row.timestamp || "" });
        }
      }
    }
    const id = meta.id || meta.session_id;
    if (typeof id !== "string" || !UUID.test(id)) return null;
    return {
      id,
      title: first || eventFirst || "未命名会话",
      cwd: meta.cwd || "",
      created: meta.timestamp || "",
      updated: stat.mtime.toISOString(),
      model,
      ...(detail
        ? { messages: messages.length ? messages : events, truncated }
        : {}),
    };
  }
}
