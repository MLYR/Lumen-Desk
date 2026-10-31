// 构建后把 dist/ 拆成三类输出：
//   dist/          公开静态文件（主页、登录页、_astro/*）
//   dist-private/  控制台（console/index.html、console/write/index.html、console/settings/index.html），在 Caddy forward_auth 之后
//   dist-shell/    博客外壳 blog.html，api 读取后替换占位符，不对外直接提供
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (msg) => { throw new Error("split-private: " + msg); };

// --- 控制台 -> dist-private/console ---
const consoleSrc = resolve(root, "dist/console");
const privateDir = resolve(root, "dist-private");
const consoleDest = resolve(privateDir, "console");
if (!existsSync(resolve(consoleSrc, "index.html"))) fail("dist/console/index.html 不存在，astro build 是否成功？");
for (const sub of ["write", "settings", "resume"]) {
  if (!existsSync(resolve(consoleSrc, sub, "index.html"))) fail(`dist/console/${sub}/index.html 不存在，astro build 是否成功？`);
}

rmSync(privateDir, { recursive: true, force: true });
mkdirSync(privateDir, { recursive: true });
renameSync(consoleSrc, consoleDest);

// --- 博客外壳 dist/blog/index.html -> dist-shell/blog.html ---
const blogSrcDir = resolve(root, "dist/blog");
const blogSrc = resolve(blogSrcDir, "index.html");
const shellDir = resolve(root, "dist-shell");
const shellDest = resolve(shellDir, "blog.html");
if (!existsSync(blogSrc)) fail("dist/blog/index.html 不存在，astro build 是否成功？");

rmSync(shellDir, { recursive: true, force: true });
mkdirSync(shellDir, { recursive: true });
renameSync(blogSrc, shellDest);
rmSync(blogSrcDir, { recursive: true, force: true });

// --- 断言 ---
// 1. dist/ 只含公开文件
if (existsSync(consoleSrc)) fail("dist/console 仍然存在");
if (existsSync(blogSrcDir)) fail("dist/blog 仍然存在");
if (existsSync(resolve(root, "dist/blog.html"))) fail("dist/blog.html 不应存在");
if (!existsSync(resolve(root, "dist/index.html"))) fail("dist/index.html 不存在");
// 2. dist-private/ 有控制台、编辑器和设置页
for (const f of ["console/index.html", "console/write/index.html", "console/settings/index.html", "console/resume/index.html"]) {
  if (!existsSync(resolve(privateDir, f))) fail(`dist-private/${f} 不存在`);
}
// 3. dist-shell/blog.html 含三个占位符，各出现位置正确
const shell = readFileSync(shellDest, "utf8");
const checks = [
  ["{{LD_TITLE}}", /<title>\{\{LD_TITLE\}\}<\/title>/],
  ["{{LD_DESCRIPTION}}", /<meta name="description" content="\{\{LD_DESCRIPTION\}\}"/],
  ["{{LD_CONTENT}}", /<main[^>]*>[\s\S]*\{\{LD_CONTENT\}\}[\s\S]*<\/main>/],
];
for (const [name, re] of checks) {
  if (shell.split(name).length !== 2) fail(`dist-shell/blog.html 里 ${name} 必须恰好出现一次`);
  if (!re.test(shell)) fail(`dist-shell/blog.html 里 ${name} 位置不对`);
}
if (!shell.includes('id="blog-search"') || !shell.includes('id="blog-search-results"')) fail("dist-shell/blog.html 缺少搜索框或结果容器");

// 4. 登录页和控制台永远不含统计脚本
for (const f of [resolve(privateDir, "console/index.html"), resolve(privateDir, "console/write/index.html"), resolve(privateDir, "console/settings/index.html"), resolve(privateDir, "console/resume/index.html"), resolve(root, "dist/login/index.html")]) {
  if (readFileSync(f, "utf8").includes("data-website-id")) fail(`${f} 不应含 Umami 脚本`);
}

console.log("split-private: dist/console -> dist-private/console OK");
console.log("split-private: dist/blog/index.html -> dist-shell/blog.html OK");
