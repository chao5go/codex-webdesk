import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { createServer } from "../src/server.js";
const root = await mkdtemp(path.join(os.tmpdir(), "codex-web-browser-"));
const home = path.join(root, "codex");
await mkdir(path.join(home, "sessions"), { recursive: true });
const id = "44444444-4444-4444-8444-444444444444";
await writeFile(
  path.join(home, "sessions", "test.jsonl"),
  [
    { type: "session_meta", payload: { id, cwd: root } },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ text: "Review the project" }],
      },
    },
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          {
            text: "<script>window.injected=true</script>\n\n## Previous result",
          },
        ],
      },
    },
  ]
    .map((r) => JSON.stringify(r))
    .join("\n"),
);
const token = "browser-test-token-123456789";
const app = await createServer({
  cwd: root,
  codexHome: home,
  dataDir: path.join(root, "data"),
  codexBin: fileURLToPath(new URL("./fake-codex.js", import.meta.url)),
  token,
  pluginsDir: fileURLToPath(new URL("../examples/plugins", import.meta.url)),
});
await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1040 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${url}/?token=${token}`);
  await page.waitForSelector("#workspace:not([hidden])");
  assert.equal(new URL(page.url()).search, "");
  await page.click('[data-preset="review"]');
  await page.click("#run");
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("Completed"),
  );
  assert.match(
    await page.locator("#structured").innerText(),
    /const answer = 42/,
  );
  await page.click("#raw-tab");
  await page.waitForSelector(".xterm-screen");
  await page.click("#structured-tab");
  await page.screenshot({
    path: process.env.SCREENSHOT_PATH || path.join(root, "desktop.png"),
    fullPage: true,
  });
  await page.click('[data-plugin="server-info"]');
  const info = page.frameLocator("#plugin-frame");
  await info.locator("#info strong").first().waitFor();
  assert.ok((await info.locator("#info").innerText()).includes("主机"));
  await page.click('[data-plugin="codex-history"]');
  const historyFrame = page.frameLocator("#plugin-frame");
  await historyFrame.locator(".session").first().waitFor();
  await historyFrame.locator("#search").fill("Previous result");
  assert.equal(await historyFrame.locator(".session").count(), 1);
  await historyFrame.locator(".session").click();
  assert.equal(await historyFrame.locator("#detail script").count(), 0);
  if (process.env.HISTORY_SCREENSHOT_PATH)
    await page.screenshot({
      path: process.env.HISTORY_SCREENSHOT_PATH,
      fullPage: true,
    });
  const downloaded = page.waitForEvent("download");
  await historyFrame.locator("#export").click();
  assert.match((await downloaded).suggestedFilename(), /codex-history.*html/);
  await historyFrame
    .getByRole("button", { name: "在工作台继续", exact: true })
    .click();
  await page.waitForSelector("#workbench-view:not([hidden])");
  await page.waitForSelector("#resume-banner:not([hidden])");
  assert.match(
    await page.locator("#resume-label").innerText(),
    /Review the project/,
  );
  await page.click("#cli-history");
  await page.waitForSelector(".history-item");
  await page.click(".history-item");
  await page.waitForSelector("#resume-banner:not([hidden])");
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await page.locator("#structured script").count(), 0);
  await page.fill("#prompt", "continue");
  await page.click("#run");
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("Completed"),
  );
  assert.ok(app.tasks.list().some((task) => task.resumeId === id));
  await page.click("#new-task");
  await page.fill("#prompt", "slow");
  await page.locator("#prompt").press("Control+Enter");
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("Running"),
  );
  await page.reload();
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("Running"),
  );
  await page.click("#stop");
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("Interrupted"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.click("#logout");
  await page.waitForSelector("#login:not([hidden])");
  assert.deepEqual(errors, []);
  console.log(
    "Browser smoke passed: plugin navigation, custom plugin API, full-text history search, HTML export, direct resume, login, presets, streaming, terminal, history, XSS sanitization, resume, keyboard submit, reload, stop, mobile, logout.",
  );
} finally {
  await browser.close();
  await app.close();
  await rm(root, { recursive: true, force: true });
}
