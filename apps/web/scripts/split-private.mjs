// 构建后把 dist/ 拆成三类输出：
//   dist/          公开静态文件（主页、登录页、_astro/*）
//   dist-private/  控制台（console/index.html、console/write/index.html、console/settings/index.html），在 Caddy forward_auth 之后
//   dist-shell/    博客外壳 blog.html，api 读取后替换占位符，不对外直接提供
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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

// --- 控制台的 JS/CSS 搬进 dist-private/console/_assets ---
// 公开目录里不能再出现控制台的 chunk：里面有 /api/private 的接口路径。
// HTML 里的 /_astro/ 引用改写成 /console/_assets/，chunk 之间是相对 import，跟着一起搬。
const astroDir = resolve(root, "dist/_astro");
const privateAssets = resolve(privateDir, "console/_assets");
const consoleHtml = [];
(function walkHtml(dir) {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) walkHtml(full);
    else if (name.endsWith(".html")) consoleHtml.push(full);
  }
})(consoleDest);

const chunkImports = (text) => [...text.matchAll(/["']\.\/([A-Za-z0-9._-]+\.(?:js|css))["']/g)].map((m) => m[1]);
const htmlAssets = (file) => [...readFileSync(file, "utf8").matchAll(/\/_astro\/([A-Za-z0-9._-]+)/g)].map((m) => m[1]);

/** 从一组入口文件出发，收集它们直接或间接引用的 _astro 文件 */
function closure(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    const file = resolve(astroDir, name);
    if (!existsSync(file)) fail(`_astro/${name} 被引用但不存在`);
    seen.add(name);
    if (/\.(?:js|css)$/.test(name)) queue.push(...chunkImports(readFileSync(file, "utf8")));
  }
  return seen;
}

const consoleAssets = closure(consoleHtml.flatMap(htmlAssets));
mkdirSync(privateAssets, { recursive: true });
for (const name of consoleAssets) copyFileSync(resolve(astroDir, name), resolve(privateAssets, name));
for (const file of consoleHtml) {
  const rewritten = readFileSync(file, "utf8").replaceAll("/_astro/", "/console/_assets/");
  writeFileSync(file, rewritten);
}

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

// --- 试验场清单 dist/lab-index.json -> dist-shell/lab-index.json ---
// api 读这份清单生成 /sitemap.xml 里的实验条目，所以它不进公开目录。
const labIndexSrc = resolve(root, "dist/lab-index.json");
const labIndexDest = resolve(shellDir, "lab-index.json");
if (!existsSync(labIndexSrc)) fail("dist/lab-index.json 不存在，astro build 是否成功？");
renameSync(labIndexSrc, labIndexDest);

// 公开产物只留公开页面用得到的 chunk：控制台独占的那些从 dist/_astro 里删掉。
const publicHtml = [
  ...(function walkHtml(dir, out = []) {
    for (const name of readdirSync(dir)) {
      const full = resolve(dir, name);
      if (statSync(full).isDirectory()) walkHtml(full, out);
      else if (name.endsWith(".html")) out.push(full);
    }
    return out;
  })(resolve(root, "dist")),
  shellDest,
];
const publicAssets = closure(publicHtml.flatMap(htmlAssets));
for (const name of readdirSync(astroDir)) {
  if (!publicAssets.has(name)) rmSync(resolve(astroDir, name), { force: true });
}

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

// 3b. 试验场清单：公开目录不留，dist-shell 里是合法 JSON，至少含 /lab/
if (existsSync(labIndexSrc)) fail("dist/lab-index.json 仍然存在，不该出现在公开目录");
const labIndex = JSON.parse(readFileSync(labIndexDest, "utf8"));
if (!Array.isArray(labIndex.routes) || labIndex.routes[0] !== "/lab/") fail("dist-shell/lab-index.json 的 routes 必须以 /lab/ 开头");
for (const r of labIndex.routes) {
  if (typeof r !== "string" || !/^\/lab(\/[^/]+)*\/$/.test(r)) fail(`dist-shell/lab-index.json 里有不合法的路由：${r}`);
  // 卡片指向的页面必须真存在，否则 /lab/ 上会挂一条 404 链接
  if (!existsSync(resolve(root, "dist", r.slice(1), "index.html"))) fail(`试验场清单里的 ${r} 没有对应页面，给它建一个 .astro`);
}

// 3c. 控制台：HTML 里不再有公开目录的引用，引用的 _assets 文件都在
for (const file of consoleHtml) {
  const html = readFileSync(file, "utf8");
  if (html.includes("/_astro/")) fail(`${file} 仍然引用公开目录的 /_astro/`);
  for (const m of html.matchAll(/\/console\/_assets\/([A-Za-z0-9._-]+)/g)) {
    if (!existsSync(resolve(privateAssets, m[1]))) fail(`${file} 引用的 _assets/${m[1]} 不存在`);
  }
}
// 3d. 公开产物里不能出现任何私有接口路径
(function scanPublic(dir) {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) scanPublic(full);
    else if (/\.(?:js|css|html|json)$/.test(name) && readFileSync(full, "utf8").includes("/api/private")) {
      fail(`公开产物 ${full} 里出现了 /api/private`);
    }
  }
})(resolve(root, "dist"));

// 4. 登录页和控制台永远不含统计脚本
for (const f of [resolve(privateDir, "console/index.html"), resolve(privateDir, "console/write/index.html"), resolve(privateDir, "console/settings/index.html"), resolve(privateDir, "console/resume/index.html"), resolve(root, "dist/login/index.html")]) {
  if (readFileSync(f, "utf8").includes("data-website-id")) fail(`${f} 不应含 Umami 脚本`);
}

console.log("split-private: dist/console -> dist-private/console OK");
console.log("split-private: dist/blog/index.html -> dist-shell/blog.html OK");
console.log("split-private: dist/lab-index.json -> dist-shell/lab-index.json OK");
console.log(`split-private: 控制台 ${consoleAssets.size} 个静态文件进 dist-private/console/_assets OK`);
