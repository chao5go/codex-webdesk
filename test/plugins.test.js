import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  open,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";
const token = "plugin-test-token-1234567890";
const example = fileURLToPath(new URL("../examples/plugins/", import.meta.url));
async function fixture(t, extra = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-plugins-"));
  await mkdir(path.join(root, "codex"));
  const app = await createServer({
    cwd: root,
    codexHome: path.join(root, "codex"),
    dataDir: path.join(root, "data"),
    codexBin: "codex",
    token,
    ...extra,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const request = (route, init = {}) =>
    fetch(base + route, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  return { ...app, root, base, request, home: path.join(root, "codex") };
}
async function session(app, id, text = "A test conversation") {
  const folder = path.join(app.home, "sessions");
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, `${id}.jsonl`);
  await writeFile(
    file,
    [
      { type: "session_meta", payload: { id, cwd: app.root } },
      {
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ text }] },
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n"),
  );
  return file;
}
test("plugins register namespaced pages and API behind shared authentication", async (t) => {
  const app = await fixture(t, { pluginsDir: example });
  const manifest = await (await app.request("/api/plugins")).json();
  assert.deepEqual(
    manifest.plugins.map((p) => p.id),
    ["workbench", "codex-history", "server-info"],
  );
  for (const route of [
    "/api/plugins",
    "/api/plugins/server-info/info",
    "/plugins/server-info/index.html",
    "/plugins/codex-history/app.js",
  ])
    assert.equal((await fetch(app.base + route)).status, 401);
  const data = await (
    await app.request("/api/plugins/server-info/info")
  ).json();
  assert.equal(typeof data.hostname, "string");
  assert.ok(!("token" in data));
  const page = await app.request("/plugins/server-info/index.html");
  assert.equal(page.status, 200);
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'self'/,
  );
  assert.equal(
    (await app.request("/api/plugins/server-info/missing")).status,
    404,
  );
  assert.equal(
    (await app.request("/plugins/server-info/server.mjs")).status,
    404,
  );
  assert.equal(
    (await app.request("/plugins/server-info/%2e%2e%2fserver.mjs")).status,
    400,
  );
  assert.equal((await app.request("/api/plugins/workbench/tasks")).status, 200);
});
test("disabled plugins expose no page or API and missing Python is a friendly plugin state", async (t) => {
  const app = await fixture(t, {
    pluginsDir: example,
    disabledPlugins: ["server-info"],
    pluginOptions: { "codex-history": { pythonBin: "/missing-python" } },
  });
  const data = await (await app.request("/api/plugins")).json();
  const info = data.plugins.find((p) => p.id === "server-info");
  assert.equal(info.enabled, false);
  assert.equal(info.entry, null);
  assert.equal(
    (await app.request("/plugins/server-info/index.html")).status,
    404,
  );
  assert.equal(
    (await app.request("/api/plugins/server-info/info")).status,
    404,
  );
  const history = data.plugins.find((p) => p.id === "codex-history");
  assert.equal(history.available, false);
  assert.match(history.reason, /Python/);
  assert.equal(
    (await app.request("/plugins/codex-history/index.html")).status,
    503,
  );
  assert.equal((await app.request("/api/sessions")).status, 200);
});
test("history adapter preserves full search data, export formats, handoffs and recoverable deletion", async (t) => {
  const app = await fixture(t);
  const ids = [
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666",
  ];
  const files = await Promise.all(
    ids.map((id, index) =>
      session(
        app,
        id,
        index === 0
          ? "</script><script>unsafe()</script>"
          : "Second conversation",
      ),
    ),
  );
  const listed = await (
    await app.request("/api/plugins/codex-history/api/sessions")
  ).json();
  assert.equal(listed.sessions.length, 2);
  assert.equal(listed.sessions[0].messages.length, 1);
  const post = (action, payload, csrf = listed.csrfToken) =>
    app.request(`/api/plugins/codex-history/api/sessions/${action}`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body: JSON.stringify(payload),
    });
  assert.equal((await post("delete", { id: ids[0] }, "wrong")).status, 403);
  assert.equal((await post("delete", { id: ids[0] }, "é".repeat(64))).status, 403);
  for (const format of ["json", "md", "html"]) {
    const response = await post("export", { ids: [ids[0]], format });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition"), /attachment/);
    const text = await response.text();
    if (format === "html") {
      assert.ok(text.includes('"exported": true'));
      assert.ok(!text.includes("</script><script>unsafe()"));
    }
    if (format === "json") assert.equal(JSON.parse(text).sessions.length, 1);
  }
  const merged = await (
    await post("merge", { ids, objective: "Continue the implementation" })
  ).json();
  assert.equal(merged.sessions, 2);
  assert.match(merged.command, /codex /);
  assert.match(
    await readFile(merged.file, "utf8"),
    /Continue the implementation/,
  );
  await Promise.all(files.map((file) => readFile(file)));
  const held = await open(files[0], "a");
  assert.equal((await post("delete", { id: ids[0] })).status, 409);
  await held.close();
  const deleted = await (await post("delete", { id: ids[0] })).json();
  assert.equal(deleted.deleted, ids[0]);
  assert.ok(
    (
      await readFile(
        path.join(deleted.trash, "sessions", path.basename(files[0])),
        "utf8",
      )
    ).includes(ids[0]),
  );
  await assert.rejects(readFile(files[0]), (e) => e.code === "ENOENT");
  assert.ok((await readFile(files[1], "utf8")).includes(ids[1]));
});
test("plugin asset symlinks cannot escape their public directory", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-asset-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, "demo");
  await mkdir(path.join(folder, "public"), { recursive: true });
  await writeFile(
    path.join(folder, "plugin.json"),
    JSON.stringify({ apiVersion: 1, id: "demo", name: "Demo" }),
  );
  await writeFile(path.join(folder, "public", "index.html"), "Demo");
  const secret = path.join(root, "private.txt");
  await writeFile(secret, "private");
  await symlink(secret, path.join(folder, "public", "leak.txt"));
  const app = await fixture(t, { pluginsDir: root });
  assert.equal((await app.request("/plugins/demo/leak.txt")).status, 403);
});
test("disabled backend modules are never imported, and duplicate IDs fail startup", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-disabled-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, "disabled");
  await mkdir(folder);
  await writeFile(
    path.join(folder, "plugin.json"),
    JSON.stringify({
      apiVersion: 1,
      id: "disabled",
      name: "Disabled",
      server: "server.mjs",
    }),
  );
  await writeFile(
    path.join(folder, "server.mjs"),
    'throw new Error("disabled module was executed");',
  );
  const app = await fixture(t, {
    pluginsDir: root,
    disabledPlugins: ["disabled"],
  });
  assert.equal(app.plugins.items.get("disabled").enabled, false);
  const duplicate = path.join(root, "duplicate");
  await mkdir(duplicate);
  await writeFile(
    path.join(duplicate, "plugin.json"),
    JSON.stringify({ apiVersion: 1, id: "workbench", name: "Conflict" }),
  );
  await assert.rejects(
    createServer({
      cwd: app.root,
      codexHome: app.home,
      dataDir: path.join(app.root, "other-data"),
      codexBin: "codex",
      token,
      pluginsDir: root,
      disabledPlugins: ["disabled"],
    }),
    /Duplicate plugin ID/,
  );
});
test("one failing plugin shutdown hook does not prevent other plugin cleanup", async () => {
  const { Plugins } = await import("../src/plugins.js");
  const registry = new Plugins({ options: {} });
  let closed = false;
  registry.add({
    id: "one",
    close: () => {
      closed = true;
    },
  });
  registry.add({
    id: "two",
    close: () => {
      throw new Error("failure");
    },
  });
  await assert.rejects(registry.close(), AggregateError);
  assert.equal(closed, true);
});
