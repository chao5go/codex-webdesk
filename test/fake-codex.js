#!/usr/bin/env node
import { spawn } from "node:child_process";
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
if (prompt.includes("slow")) {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  console.log(JSON.stringify({ type: "test.child", pid: child.pid }));
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));
  setInterval(() => console.error("working"), 100);
} else if (prompt.includes("fail")) {
  console.error("fixture failed");
  process.exitCode = 1;
} else {
  console.log(
    JSON.stringify({
      type: "thread.started",
      thread_id: "11111111-1111-4111-8111-111111111111",
    }),
  );
  console.log(
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: "## 完成\n\n```js\nconst answer = 42;\n```",
      },
    }),
  );
  console.error("\u001b[32mfixture done\u001b[0m");
  console.log(
    JSON.stringify({
      type: "test.args",
      args: process.argv.slice(2),
      prompt,
      serverToken: process.env.CODEX_REMOTE_WEB_TOKEN || null,
    }),
  );
}
