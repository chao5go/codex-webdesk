import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
const run = promisify(execFile);
async function files(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await files(name)));
    else if (/\.(js|mjs)$/.test(name)) result.push(name);
  }
  return result;
}
const roots = ["bin", "src", "web", "scripts", "test", "examples"];
const checks = (await Promise.all(roots.map(files))).flat();
await Promise.all(
  checks.map((file) => run(process.execPath, ["--check", file])),
);
console.log(`Syntax checked ${checks.length} JavaScript modules.`);
