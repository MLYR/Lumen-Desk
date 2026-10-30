// 构建后把 dist/console 移到 dist-private/console，使 dist/ 只含公开文件。
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "dist/console");
const outDir = resolve(root, "dist-private");
const dest = resolve(outDir, "console");

if (!existsSync(resolve(src, "index.html"))) throw new Error("split-private: dist/console/index.html 不存在，astro build 是否成功？");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
renameSync(src, dest);

if (existsSync(src)) throw new Error("split-private: dist/console 仍然存在");
if (!existsSync(resolve(dest, "index.html"))) throw new Error("split-private: dist-private/console/index.html 不存在");
console.log("split-private: dist/console -> dist-private/console OK");
