import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
let api, host;
export function disconnectWorkbench() {
  state.controller?.abort();
  state.activeId = null;
}
const $ = (id) => document.getElementById(id);
const state = {
  mode: "web",
  tasks: [],
  sessions: [],
  selected: null,
  activeId: null,
  resumeId: "",
  current: null,
  controller: null,
  viewing: 0,
  rawOpen: false,
};
const terminal = new Terminal({
  convertEol: true,
  disableStdin: true,
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  scrollback: 8000,
  theme: { background: "#151d24", foreground: "#d9e3e8" },
});
const fit = new FitAddon();
terminal.loadAddon(fit);
const labels = {
  idle: "Idle",
  running: "Running",
  stopping: "Stopping",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
};
function notice(message) {
  $("notice").hidden = !message;
  $("notice").textContent = message;
}
function guarded(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      if (e.name !== "AbortError") notice(e.message);
    }
  };
}
function showLogin() {
  state.controller?.abort();
  host.onSessionExpired();
}
function status(value) {
  $("status").className = `status ${value}`;
  $("status").textContent = `● ${labels[value] || value}`;
}
function controls() {
  $("run").disabled = !!state.activeId;
  $("stop").disabled = !state.activeId;
}
function markdown(text) {
  const div = document.createElement("div");
  div.className = "markdown";
  div.innerHTML = DOMPurify.sanitize(marked.parse(text), {
    FORBID_TAGS: ["img", "style", "form", "input"],
  });
  for (const code of div.querySelectorAll("pre code")) {
    hljs.highlightElement(code);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "复制";
    button.addEventListener(
      "click",
      guarded(async () => {
        await navigator.clipboard.writeText(code.textContent);
        button.textContent = "已复制";
      }),
    );
    code.parentElement.prepend(button);
  }
  return div;
}
function renderOutput(item) {
  const output = $("structured");
  const nearBottom =
    output.scrollHeight - output.scrollTop - output.clientHeight < 90;
  const previous = output.scrollTop;
  output.replaceChildren();
  if (item.messages) {
    for (const message of item.messages) {
      const block = document.createElement("div");
      block.className = `message ${message.role}`;
      const label = document.createElement("div");
      label.className = "message-role";
      label.textContent = `${message.role === "user" ? "YOU" : "CODEX"} · ${message.time || ""}`;
      block.append(label, markdown(message.text));
      output.append(block);
    }
  } else {
    for (const event of item.events
      .filter((e) => e.type === "codex")
      .slice(-40)) {
      const data = event.data,
        unit = data.item;
      if (unit?.type === "agent_message") continue;
      const label = document.createElement("div");
      label.className = "activity";
      label.textContent = unit
        ? `${data.type} · ${unit.type}${unit.command ? ` · ${unit.command}` : ""}`
        : `${data.type}${data.message ? ` · ${data.message}` : ""}`;
      output.append(label);
    }
    if (item.output) output.append(markdown(item.output));
    if (item.error) {
      const error = document.createElement("div");
      error.className = "activity";
      error.textContent = item.error;
      output.append(error);
    }
    if (!output.childNodes.length) {
      const text = document.createElement("p");
      text.className = "activity";
      text.textContent = "等待 Codex 输出…";
      output.append(text);
    }
  }
  if (item.truncated) {
    const warning = document.createElement("p");
    warning.textContent = "输出已达到保留上限，当前显示为截断记录。";
    output.append(warning);
  }
  output.scrollTop = nearBottom ? output.scrollHeight : previous;
}
function loadFields(item) {
  $("cwd").value = item.cwd || $("cwd").value;
  $("model").value = item.model || "";
  $("effort").value = item.effort || "";
  $("sandbox").value = item.sandbox || "read-only";
  $("context-paths").value = (item.contextPaths || []).join("\n");
  $("prompt").value = item.prompt || "";
}
function setResume(id, title) {
  state.resumeId = id;
  $("resume-banner").hidden = !id;
  $("resume-label").textContent = `继续会话 · ${title || id}`;
}
function listHistory() {
  const query = $("search").value.trim().toLowerCase();
  const items = state.mode === "web" ? state.tasks : state.sessions;
  const filtered = items.filter((item) =>
    `${item.title || item.prompt} ${item.cwd} ${item.model}`
      .toLowerCase()
      .includes(query),
  );
  $("history-count").textContent =
    `${state.mode === "web" ? "WEB TASKS" : "CLI SESSIONS"} / ${filtered.length}`;
  $("history-list").replaceChildren();
  for (const item of filtered) {
    const button = document.createElement("button");
    button.className = `history-item${state.selected === item.id ? " selected" : ""}`;
    const title = document.createElement("strong");
    title.textContent = item.title || item.prompt.split("\n")[0];
    const subtitle = document.createElement("small");
    const time = new Date(item.startedAt || item.updated).toLocaleString(
      "zh-CN",
      { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" },
    );
    subtitle.textContent = `${item.status ? labels[item.status] : item.archived ? "归档" : "会话"} · ${time} · ${item.cwd}`;
    button.append(title, subtitle);
    button.addEventListener(
      "click",
      guarded(() => select(item.id)),
    );
    $("history-list").append(button);
  }
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = query ? "没有匹配的记录" : "暂无历史记录";
    $("history-list").append(empty);
  }
}
async function refreshHistory() {
  if (state.mode === "web") state.tasks = (await api("/api/tasks")).tasks;
  else {
    $("history-count").textContent = "读取本地会话…";
    state.sessions = (await api("/api/sessions")).sessions;
  }
  listHistory();
}
function writeTerminal(text) {
  terminal.write(text.replace(/\r?\n/g, "\r\n"));
}
async function select(id) {
  state.controller?.abort();
  const generation = ++state.viewing;
  const item = await api(
    `/api/${state.mode === "web" ? "tasks" : "sessions"}/${id}`,
  );
  if (generation !== state.viewing) return;
  state.selected = id;
  state.current = item;
  loadFields(item);
  if (state.mode === "cli") {
    const last = [...item.messages].reverse().find((m) => m.role === "user");
    $("prompt").value = last?.text || "";
    setResume(item.archived ? "" : id, item.title);
    status(state.activeId ? "running" : "idle");
    $("output-meta").textContent =
      `CLI 会话 · ${id} · ${item.cwd}${item.archived ? " · 已归档，仅供查看" : ""}`;
  } else {
    setResume("", "");
    status(item.status);
    if (!["running", "stopping"].includes(item.status)) {
      if (state.activeId === item.id) state.activeId = null;
      const summary = state.tasks.find((task) => task.id === item.id);
      if (summary) summary.status = item.status;
      $("connection").textContent = "SSE · 历史记录";
    }
    $("output-meta").textContent =
      `${item.model || "CLI 默认模型"} · ${item.cwd} · ${item.startedAt}${item.exitCode !== null ? ` · exit ${item.exitCode}` : ""}`;
  }
  renderOutput(item);
  terminal.reset();
  if (item.raw) writeTerminal(item.raw);
  controls();
  listHistory();
  if (item.status === "running" || item.status === "stopping") stream(item);
}
async function stream(item) {
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  let after = item.events.at(-1)?.seq || 0;
  while (!controller.signal.aborted) {
    try {
      $("connection").textContent = "SSE · 正在连接";
      const response = await fetch(
        `/api/tasks/${item.id}/events?after=${after}`,
        { signal: controller.signal },
      );
      if (response.status === 401) {
        showLogin();
        return;
      }
      if (!response.ok) throw new Error(`流式连接 HTTP ${response.status}`);
      $("connection").textContent = "SSE · 已连接";
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      let dirty = false,
        timer;
      const flush = () => {
        timer = null;
        if (dirty && state.current === item) {
          renderOutput(item);
          dirty = false;
        }
      };
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const payload = frame
              .split("\n")
              .find((line) => line.startsWith("data: "));
            if (!payload) continue;
            const event = JSON.parse(payload.slice(6));
            if (controller.signal.aborted || state.current !== item) return;
            if (event.seq <= after) continue;
            after = event.seq;
            item.events.push(event);
            if (event.type === "raw") {
              writeTerminal(event.data.text);
              item.raw += event.data.text;
            }
            if (event.type === "codex") {
              const data = event.data;
              if (data.type === "thread.started")
                item.threadId = data.thread_id;
              if (
                data.type === "item.completed" &&
                data.item?.type === "agent_message"
              )
                item.output += data.item.text + "\n\n";
            }
            if (event.type === "status") {
              Object.assign(item, event.data);
              status(item.status);
              if (state.activeId === item.id) state.activeId = null;
              controls();
              $("connection").textContent = "SSE · 任务已结束";
              const final = await api(`/api/tasks/${item.id}`);
              if (state.current !== item) return;
              Object.assign(item, final);
              renderOutput(item);
              await refreshHistory();
              return;
            }
            dirty = true;
            if (!timer) timer = setTimeout(flush, 150);
          }
        }
      } finally {
        clearTimeout(timer);
        flush();
        reader.releaseLock();
      }
      if (controller.signal.aborted) return;
      const current = await api(`/api/tasks/${item.id}`);
      if (!["running", "stopping"].includes(current.status)) {
        if (state.current !== item) return;
        Object.assign(item, current);
        renderOutput(item);
        status(item.status);
        state.activeId = null;
        controls();
        await refreshHistory();
        return;
      }
      throw new Error("连接断开");
    } catch (error) {
      if (controller.signal.aborted) return;
      $("connection").textContent = `SSE · ${error.message}，正在重连`;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2000);
        controller.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }
}
export async function initializeWorkbench(config, context) {
  host = context;
  api = context.api;
  state.activeId = config.activeId;
  $("cwd").value = config.cwd;
  if (!state.rawOpen) {
    terminal.open($("raw"));
    state.rawOpen = true;
    new ResizeObserver(() => {
      if (!$("raw").hidden) fit.fit();
    }).observe($("raw"));
  }
  controls();
  await refreshHistory();
  if (state.activeId) {
    state.mode = "web";
    await select(state.activeId);
  }
}
$("task-form").addEventListener(
  "submit",
  guarded(async (event) => {
    event.preventDefault();
    if (state.activeId) return;
    notice("");
    $("run").disabled = true;
    try {
      const item = await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          prompt: $("prompt").value,
          cwd: $("cwd").value,
          model: $("model").value.trim(),
          effort: $("effort").value,
          sandbox: $("sandbox").value,
          contextPaths: $("context-paths")
            .value.split("\n")
            .map((p) => p.trim())
            .filter(Boolean),
          resumeId: state.resumeId,
        }),
      });
      state.activeId = item.id;
      state.mode = "web";
      $("web-history").classList.add("selected");
      $("cli-history").classList.remove("selected");
      await refreshHistory();
      await select(item.id);
    } finally {
      controls();
    }
  }),
);
$("prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    $("task-form").requestSubmit();
  }
});
const presets = {
  review:
    "请评审当前项目的代码。优先指出真实的正确性问题、安全问题和回归风险，给出文件位置、理由和修复建议。先阅读相关代码，仅做分析。",
  tests:
    "请分析当前项目的测试约定，为核心行为和边界条件补充有意义的单元测试，运行相关测试并报告结果。",
  debug:
    "请排查下面的问题，先核实根因，再给出最小修复方案与验证方法。\n\n错误信息：\n\n复现步骤：\n",
  refactor:
    "请分析当前项目，找出一处值得改善的重复或复杂代码，在保持现有行为的前提下进行小范围重构，运行相关检查并说明变化。",
};
for (const button of document.querySelectorAll("[data-preset]"))
  button.addEventListener("click", () => {
    $("prompt").value = presets[button.dataset.preset];
    $("sandbox").value = ["tests", "refactor"].includes(button.dataset.preset)
      ? "workspace-write"
      : "read-only";
    $("prompt").focus();
  });
$("cancel-resume").addEventListener("click", () => setResume("", ""));
$("stop").addEventListener(
  "click",
  guarded(async () => {
    if (!state.activeId) return;
    status("stopping");
    await api(`/api/tasks/${state.activeId}/stop`, {
      method: "POST",
      body: JSON.stringify({ signal: "SIGINT" }),
    });
  }),
);
$("new-task").addEventListener("click", () => {
  loadFields({ cwd: $("cwd").value });
  setResume("", "");
  notice("");
  $("prompt").focus();
});
$("search").addEventListener("input", listHistory);
$("refresh").addEventListener("click", guarded(refreshHistory));
for (const [id, mode] of [
  ["web-history", "web"],
  ["cli-history", "cli"],
])
  $(id).addEventListener(
    "click",
    guarded(async () => {
      state.mode = mode;
      $("web-history").classList.toggle("selected", mode === "web");
      $("cli-history").classList.toggle("selected", mode === "cli");
      await refreshHistory();
    }),
  );
$("structured-tab").addEventListener("click", () => {
  $("structured").hidden = false;
  $("raw").hidden = true;
  $("structured-tab").classList.add("selected");
  $("raw-tab").classList.remove("selected");
});
$("raw-tab").addEventListener("click", () => {
  $("structured").hidden = true;
  $("raw").hidden = false;
  $("raw-tab").classList.add("selected");
  $("structured-tab").classList.remove("selected");
  fit.fit();
});
$("export").addEventListener(
  "click",
  guarded(async () => {
    if (!state.current) return;
    const blob = new Blob([JSON.stringify(state.current, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `codex-${state.current.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }),
);
// Keep the global run/stop controls correct even while browsing another historical session.
setInterval(async () => {
  if ($("workspace").hidden || !state.activeId) return;
  try {
    const config = await api("/api/config");
    if (!config.activeId) {
      state.activeId = null;
      controls();
      await refreshHistory();
    }
  } catch {
    /* surfaced by stream or next action */
  }
}, 4000);

export async function resumeSession(id) {
  state.mode = "cli";
  $("cli-history").classList.add("selected");
  $("web-history").classList.remove("selected");
  await refreshHistory();
  await select(id);
  $("prompt").value = "请结合上述会话，继续尚未完成的工作。";
  $("prompt").focus();
}
