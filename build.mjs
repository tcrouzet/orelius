import { build } from "esbuild";
import { copyFile } from "node:fs/promises";

await build({
  entryPoints: ["plugin/src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  platform: "node",
  format: "cjs",
  target: "es2020",
  loader: { ".md": "text" },
  outfile: "plugin/main.js",
  logLevel: "info",
});

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(`plugin/${file}`, file);
}
