const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  if (response.status === 401 && parent !== window)
    parent.postMessage({ type: "crw:session-expired" }, location.origin);
  return response;
};
const embedded = /*SESSION_DATA*/ null;
const $ = (id) => document.getElementById(id);
let sessions = [],
  selected = null,
  toastTimer,
  loading = false,
  csrfToken = "",
  deleting = false;
const picked = new Set();
let merging = false,
  exporting = false;
const date = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
};
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 3000);
}
function filtered() {
  const q = $("search").value.trim().toLowerCase();
  return sessions.filter(
    (s) =>
      (!$("project").value || s.cwd === $("project").value) &&
      ($("archive").value === "all" ||
        s.archived === ($("archive").value === "archived")) &&
      (!q || s.searchText.includes(q)),
  );
}
function updatePicks() {
  for (const id of picked)
    if (!sessions.some((s) => s.id === id)) picked.delete(id);
  $("merge-tools").classList.toggle("hidden", Boolean(embedded));
  $("merge").textContent = `合并后继续（${picked.size}）`;
  $("merge").disabled = picked.size < 2 || picked.size > 20;
  $("export-tools").classList.toggle("hidden", Boolean(embedded));
  $("merge").title = picked.size > 20 ? "合并最多选择 20 段会话" : "";
  if (!exporting)
    $("export").textContent = picked.size
      ? `导出已选（${picked.size}）`
      : "导出全部";
}
function renderList() {
  updatePicks();
  const rows = filtered();
  $("count").textContent = `${rows.length} 段会话 · 共 ${sessions.length} 段`;
  $("list").replaceChildren();
  if (!rows.length) {
    $("list").append(el("div", "empty", "没有找到匹配的会话。"));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const s of rows) {
    const b = el("button", "session" + (s.id === selected ? " active" : ""));
    b.setAttribute("aria-pressed", String(s.id === selected));
    b.append(el("div", "session-title", s.title));
    const meta = el("div", "session-meta");
    const project = el(
      "span",
      "project",
      (s.archived ? "归档 · " : "") +
        (s.cwd.split(/[\\/]/).filter(Boolean).pop() || "无项目目录"),
    );
    project.title = s.cwd;
    meta.append(project, el("span", "", date(s.updated)));
    b.append(meta);
    b.onclick = () => select(s.id);
    const wrap = el("div", "session-row");
    if (!embedded) {
      const check = el("input", "pick");
      check.type = "checkbox";
      check.checked = picked.has(s.id);
      check.setAttribute("aria-label", "选择会话：" + s.title);
      check.onchange = () => {
        check.checked ? picked.add(s.id) : picked.delete(s.id);
        updatePicks();
      };
      wrap.append(check);
    }
    wrap.append(b);
    fragment.append(wrap);
  }
  $("list").append(fragment);
}
async function copyCommand(input, button) {
  const original = button.textContent;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(input.value);
    } else {
      input.focus();
      input.select();
      if (!document.execCommand("copy")) throw Error("copy");
    }
    button.textContent = "已复制 ✓";
    toast("命令已复制，粘贴到终端即可。");
    setTimeout(() => (button.textContent = original), 1800);
  } catch {
    input.focus();
    input.select();
    toast("请按 Ctrl+C 或 ⌘C 复制已选中的命令。");
  }
}
function select(id) {
  selected = id;
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  document.body.classList.add("detail-open");
  renderList();
  const head = el("div", "detail-head");
  const back = el("button", "button mobile-back", "← 返回会话列表");
  back.onclick = () => document.body.classList.remove("detail-open");
  head.append(back, el("h2", "", s.title));
  head.append(
    el(
      "div",
      "metadata",
      `${s.cwd || "无项目目录"}\n${s.messages.length} 条消息${s.model ? " · " + s.model : ""} · 更新于 ${date(s.updated)}${s.archived ? " · 已归档" : ""}`,
    ),
  );
  const row = el("div", "command-row");
  const command = el("input");
  command.readOnly = true;
  command.value = s.command;
  command.setAttribute("aria-label", "恢复此会话的终端命令");
  const button = el("button", "button primary", "复制恢复命令");
  button.onclick = () => copyCommand(command, button);
  row.append(command, button);
  if (!embedded && !s.archived && window.parent !== window) {
    const resume = el("button", "button primary", "在工作台继续");
    resume.onclick = () =>
      parent.postMessage({ type: "crw:resume", id: s.id }, location.origin);
    row.append(resume);
  }
  if (!embedded) {
    const remove = el("button", "button danger", "删除会话");
    remove.onclick = () => deleteSession(s, remove);
    row.append(remove);
  }
  head.append(row);
  const messages = el("div", "messages");
  messages.tabIndex = 0;
  messages.setAttribute("aria-label", "对话内容");
  if (!s.messages.length)
    messages.append(el("div", "empty", "这段会话暂无可展示的文本消息。"));
  const fragment = document.createDocumentFragment();
  for (const m of s.messages) {
    const article = el("article", "message " + m.role);
    const label = el(
      "div",
      "message-label",
      m.role === "user" ? "你" : "Codex",
    );
    label.append(el("time", "", date(m.time)));
    article.append(label, el("pre", "text", m.text));
    fragment.append(article);
  }
  messages.append(fragment);
  $("detail").replaceChildren(head, messages);
}
async function deleteSession(session, button) {
  if (
    deleting ||
    !confirm(
      `删除会话「${session.title}」？\n\n会话文件会移入本地回收站，并从历史列表移除。请先退出正在运行的会话。\n不会删除项目代码。`,
    )
  )
    return;
  deleting = true;
  button.disabled = true;
  button.textContent = "正在删除…";
  try {
    const response = await fetch(
      "/api/plugins/codex-history/api/sessions/delete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ id: session.id }),
      },
    );
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "删除失败，请重试。");
    if (selected === session.id) selected = null;
    await load();
    document.body.classList.remove("detail-open");
    toast("会话已移入本地回收站。");
  } catch (error) {
    toast(error.message);
  } finally {
    deleting = false;
    button.disabled = false;
    button.textContent = "删除会话";
  }
}
async function load() {
  if (loading) return;
  loading = true;
  $("refresh").disabled = true;
  try {
    let data = embedded;
    if (!data) {
      if (location.protocol === "file:")
        throw Error("请从工作台打开会话管理，或先导出独立 HTML 文件。");
      const r = await fetch("/api/plugins/codex-history/api/sessions");
      if (!r.ok)
        throw Error("读取会话失败，请检查登录是否过期或插件是否可用。");
      data = await r.json();
    }
    csrfToken = data.csrfToken || "";
    sessions = data.sessions.map((s) => ({
      ...s,
      searchText: [s.title, s.cwd, s.id, ...s.messages.map((m) => m.text)]
        .join("\n")
        .toLowerCase(),
    }));
    const project = $("project").value;
    $("project").replaceChildren(new Option("全部项目", ""));
    for (const cwd of [
      ...new Set(sessions.map((s) => s.cwd).filter(Boolean)),
    ].sort())
      $("project").append(new Option(cwd, cwd));
    $("project").value = [...$("project").options].some(
      (o) => o.value === project,
    )
      ? project
      : "";
    $("status").textContent = data.exported ? "离线快照" : "会话管理";
    $("status").title = data.source;
    if (data.exported) {
      $("refresh").textContent = "离线快照";
      $("refresh").title = "重新运行导出命令可更新此文件";
    }
    renderList();
    if (selected && sessions.some((s) => s.id === selected)) select(selected);
    else if (!sessions.length) {
      $("detail").replaceChildren(
        el(
          "div",
          "empty",
          data.exists
            ? "还没有找到会话记录。"
            : "会话目录不存在：" + data.source,
        ),
      );
    } else {
      $("detail").replaceChildren(
        el("div", "empty", "选择一段会话，查看对话并复制恢复命令。"),
      );
    }
  } catch (e) {
    $("count").textContent = "读取失败";
    $("detail").replaceChildren(el("div", "empty error", e.message));
  } finally {
    loading = false;
    $("refresh").disabled = Boolean(embedded);
  }
}
$("merge").onclick = () => {
  const rows = sessions.filter((s) => picked.has(s.id));
  $("merge-summary").textContent = rows.map((s) => "• " + s.title).join("\n");
  $("merge-result").classList.add("hidden");
  $("merge-error").textContent = "";
  $("create-merge").disabled = false;
  $("merge-dialog").showModal();
};
$("clear-picks").onclick = () => {
  picked.clear();
  renderList();
};
$("select-all").onclick = () => {
  for (const s of filtered()) picked.add(s.id);
  renderList();
};
$("export").onclick = async () => {
  if (exporting) return;
  exporting = true;
  const button = $("export"),
    count = picked.size || sessions.length;
  button.disabled = true;
  button.textContent = "正在导出…";
  try {
    const response = await fetch(
      "/api/plugins/codex-history/api/sessions/export",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          ids: [...picked],
          format: $("export-format").value,
        }),
      },
    );
    if (!response.ok) {
      let message = "导出失败，请重试。";
      try {
        message = (await response.json()).error || message;
      } catch {}
      throw Error(message);
    }
    const name =
      (response.headers.get("Content-Disposition") || "").match(
        /filename="([^"]+)"/,
      )?.[1] || "codex-history";
    const url = URL.createObjectURL(await response.blob());
    const link = el("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`已导出 ${count} 段会话。`);
  } catch (e) {
    toast(e.message);
  } finally {
    exporting = false;
    button.disabled = false;
    updatePicks();
  }
};
$("merge-objective").oninput = () => {
  if (!merging) {
    $("create-merge").disabled = false;
    $("merge-result").classList.add("hidden");
  }
};
$("close-merge").onclick = () => $("merge-dialog").close();
$("copy-merge").onclick = () =>
  copyCommand($("merge-command"), $("copy-merge"));
$("create-merge").onclick = async () => {
  if (merging) return;
  merging = true;
  $("create-merge").disabled = true;
  $("merge-error").textContent = "";
  try {
    const response = await fetch(
      "/api/plugins/codex-history/api/sessions/merge",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          ids: [...picked],
          objective: $("merge-objective").value,
        }),
      },
    );
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "生成失败");
    $("merge-command").value = data.command;
    $("merge-info").textContent =
      `已整理 ${data.sessions} 段会话、${data.messages} 条消息（${Math.ceil(data.bytes / 1024)} KB）。新会话启动后会梳理进度。`;
    $("merge-result").classList.remove("hidden");
  } catch (e) {
    $("merge-error").textContent = e.message;
    $("create-merge").disabled = false;
  } finally {
    merging = false;
  }
};
$("search").addEventListener("input", renderList);
$("project").onchange = renderList;
$("archive").onchange = renderList;
$("refresh").onclick = load;
load();
