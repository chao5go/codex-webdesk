import { build } from "esbuild";
import {
  mkdir,
  copyFile,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["web/app.js"],
  bundle: true,
  minify: true,
  sourcemap: false,
  outfile: "dist/app.js",
  target: ["es2022"],
});
await Promise.all(
  ["index.html", "style.css"].map((file) =>
    copyFile(`web/${file}`, `dist/${file}`),
  ),
);
const libraries = [
  "@xterm/xterm",
  "@xterm/addon-fit",
  "dompurify",
  "highlight.js",
  "marked",
];
const notices = await Promise.all(
  libraries.map(async (name) => {
    const folder = `node_modules/${name}`;
    const files = (await readdir(folder)).filter((file) =>
      /^license/i.test(file),
    );
    return (
      `=== ${name} ===\n` +
      (
        await Promise.all(
          files.map((file) => readFile(`${folder}/${file}`, "utf8")),
        )
      ).join("\n")
    );
  }),
);
await writeFile("dist/third-party-licenses.txt", notices.join("\n\n"));
