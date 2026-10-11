// Reproducible documentation screenshots. Only synthetic data; no model calls.
import { chromium } from "playwright";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";
const root = await mkdtemp(path.join(os.tmpdir(), "webdesk-preview-"));
const codexHome = path.join(root, "codex");
await mkdir(path.join(codexHome, "sessions"), { recursive: true });
const answer = `## 评审完成：会话恢复流程

检查了任务保存、流式重连和会话恢复路径。整体流程清晰，有一处值得补充的边界处理。

### 建议优先处理

**重连时保留已读位置。** 当用户正在查看前面的输出时，新事件不应把页面强制拉到底部。可以根据距底部的距离决定是否自动滚动：

\`\`\`js
const nearBottom =
  output.scrollHeight - output.scrollTop
  - output.clientHeight < 90;

if (nearBottom) {
  output.scrollTop = output.scrollHeight;
}
\`\`\`

### 接下来

- 补充断线重连后的滚动位置测试
- 验证刷新页面后仍能找回运行中的任务
- 在移动端检查长代码块的横向滚动

> 这是用于界面展示的模拟评审，不是实际模型执行结果。`;
const fixture = path.join(root, "codex-preview");
await writeFile(fixture, '#!/usr/bin/env node\nfor await (const chunk of process.stdin) {}\n' +
  `console.log(JSON.stringify(${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: answer } })}));\n`, { mode: 0o700 });
for (const [index, title] of ["检查会话恢复流程", "为任务队列补充测试", "梳理插件接口设计"].entries()) {
  await writeFile(path.join(codexHome, "sessions", `${index}.jsonl`), [
    { type: "session_meta", payload: { id: `${index+1}4444444-4444-4444-8444-444444444444`, cwd: root, timestamp: "2026-10-12T09:00:00Z" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ text: title }] } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ text: "已整理当前实现与下一步建议。\n\n1. 确认刷新后任务可以恢复连接。\n2. 保留历史记录，避免重复执行。\n3. 补充移动端与断线重连测试。\n\n这是演示会话，可以在工作台继续，也可以导出保存。" }] } },
  ].map(JSON.stringify).join("\n"));
}
const token = "documentation-preview-token";
const app = await createServer({ cwd: root, codexHome, dataDir: path.join(root,"data"), codexBin: fixture, token });
await new Promise(resolve => app.server.listen(0,"127.0.0.1",resolve));
const browser = await chromium.launch({ headless:true });
try {
  const page = await browser.newPage({ viewport:{width:1440,height:1040} });
  await page.goto(`http://127.0.0.1:${app.server.address().port}/?token=${token}`);
  await page.waitForSelector("#workspace:not([hidden])");
  await page.screenshot({path:"docs/workspace.png",fullPage:true});
  await page.fill("#prompt","评审会话恢复流程，重点检查流式重连、历史记录保存与移动端体验。先给出问题与建议，不修改代码。");
  await page.click("#run");
  await page.waitForFunction(()=>document.querySelector("#structured").textContent.includes("这是用于界面展示"));
  await page.screenshot({path:"docs/screenshot.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:"docs/mobile.png",fullPage:true});
  await page.setViewportSize({width:1440,height:1040});
  await page.click('[data-plugin="codex-history"]');
  const frame=page.frameLocator("#plugin-frame");
  await frame.locator(".session").first().click();
  await frame.locator("#detail").getByText("这是演示会话",{exact:false}).waitFor();
  await page.screenshot({path:"docs/history.png",fullPage:true});
  console.log("Captured workspace, task output, mobile and session history using synthetic data.");
} finally {
  await browser.close(); await app.close(); await rm(root,{recursive:true,force:true});
}
