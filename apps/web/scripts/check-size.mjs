// 构建后体积守门（ROADMAP P3-4）。
//
// 对每个公开页面，把首屏里静态引用的资源（HTML 本身、CSS、JS、非懒加载的本地图片）
// 按 gzip 6 级压一遍，按路由对照预算。超了就退出码 1，让 pnpm build 红。
// 新增页面忘了定预算也会红——这是故意的。
//
// 用法：node scripts/check-size.mjs        （astro build && split-private.mjs 之后跑）

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(root, "dist");
const SHELL_DIR = resolve(root, "dist-shell");

const KB = 1024;
const PAGE_BUDGET = 200 * KB; // 普通公开页首屏
const HEAVY_BUDGET = 2048 * KB; // 实验页、工具页

// 运行时才由 api / Caddy 提供的路径，构建产物里没有，也不计入体积。
const RUNTIME_PREFIXES = ["/u/", "/api/", "/uploads/"];

// 路由规则：先精确匹配，再按顺序试通配（* 只匹配一段）。
// forbid 里的字符串只要出现在该页引用的脚本或样式路径里就算违规。
const RULES = [
  { route: "/", budget: PAGE_BUDGET },
  { route: "/login/", budget: PAGE_BUDGET },
  { route: "/resume/", budget: PAGE_BUDGET },
  { route: "/blog/", budget: PAGE_BUDGET, file: join(SHELL_DIR, "blog.html") },
  { route: "/lab/", budget: PAGE_BUDGET, forbid: ["end-of-time"] },
  { route: "/tools/", budget: PAGE_BUDGET, forbid: ["image-compressor"] },
  { route: "/lab/*/", budget: HEAVY_BUDGET },
  { route: "/tools/*/", budget: HEAVY_BUDGET },
];

if (!existsSync(DIST)) {
  console.error("check-size: apps/web/dist 不存在，先跑 astro build");
  process.exit(1);
}

/** dist 下所有 index.html 的 { route, file } */
function pages() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name === "index.html") {
        const rel = relative(DIST, dir).split("\\").join("/");
        out.push({ route: rel === "" ? "/" : `/${rel}/`, file: full });
      }
    }
  };
  walk(DIST);
  return out;
}

function ruleFor(route) {
  const exact = RULES.find((r) => r.route === route);
  if (exact) return exact;
  for (const rule of RULES) {
    if (!rule.route.includes("*")) continue;
    const pattern = new RegExp(
      "^" + rule.route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\*", "[^/]+") + "$",
    );
    if (pattern.test(route)) return rule;
  }
  return null;
}

/** 页面引用的脚本和样式路径 */
function assetRefs(html) {
  const refs = new Set();
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) refs.add(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*?>/gi)) {
    const tag = m[0];
    if (!/\brel\s*=\s*["'](?:stylesheet|modulepreload)["']/i.test(tag)) {
      const as = tag.match(/\bas\s*=\s*["']([^"']+)["']/i);
      if (!(/\brel\s*=\s*["']preload["']/i.test(tag) && as && /^(style|script)$/i.test(as[1]))) continue;
    }
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (href) refs.add(href[1]);
  }
  return [...refs];
}

/** 首屏就要下载的本地图片（懒加载的、占位没 src 的、data: 都不算） */
function eagerImages(html) {
  const out = [];
  for (const m of html.matchAll(/<img\b[^>]*?>/gi)) {
    const tag = m[0];
    if (/\bloading\s*=\s*["']lazy["']/i.test(tag)) continue;
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!src) continue;
    const url = src[1];
    if (url.startsWith("data:") || /^[a-z]+:/i.test(url) || url.startsWith("//")) continue;
    out.push(url);
  }
  return out;
}

function toDisk(pageFile, url) {
  const clean = url.split("#")[0].split("?")[0];
  if (clean.startsWith("/")) return resolve(DIST, "." + clean);
  return resolve(dirname(pageFile), clean);
}

const gzipCache = new Map();
function gzipSize(file) {
  if (gzipCache.has(file)) return gzipCache.get(file);
  const size = gzipSync(readFileSync(file), { level: 6 }).length;
  gzipCache.set(file, size);
  return size;
}

const fmt = (n) => (n / KB).toFixed(1) + " KB";

const rows = [];
const failures = [];
const warnings = [];

for (const { route, file } of pages()) {
  const rule = ruleFor(route);
  if (!rule) {
    failures.push(`${route} 没有声明预算——在 scripts/check-size.mjs 的 RULES 里加一条`);
    continue;
  }
  rows.push(check(route, file, rule));
}

const shellRule = RULES.find((r) => r.file);
if (shellRule) {
  if (existsSync(shellRule.file)) rows.push(check(shellRule.route, shellRule.file, shellRule, "api 渲染"));
  else failures.push(`${shellRule.route} 的外壳 dist-shell/blog.html 不存在，split-private.mjs 是否跑过？`);
}

function check(route, file, rule, note = "") {
  const html = readFileSync(file, "utf8");
  const sizes = { html: gzipSize(file), css: 0, js: 0, img: 0 };
  const biggest = [];

  for (const url of assetRefs(html)) {
    for (const banned of rule.forbid ?? []) {
      if (url.includes(banned)) failures.push(`${route} 不许加载 ${url}（命中 forbid: ${banned}）`);
    }
    if (RUNTIME_PREFIXES.some((p) => url.startsWith(p))) continue;
    const disk = toDisk(file, url);
    if (!existsSync(disk)) {
      warnings.push(`${route} 引用了构不出来的 ${url}（按运行时资源处理）`);
      continue;
    }
    const size = gzipSize(disk);
    if (/\.css$/i.test(url.split("?")[0])) sizes.css += size;
    else sizes.js += size;
    biggest.push({ url, size });
  }

  for (const url of eagerImages(html)) {
    const disk = toDisk(file, url);
    if (!existsSync(disk)) continue;
    const size = gzipSize(disk);
    sizes.img += size;
    biggest.push({ url, size });
  }

  const total = sizes.html + sizes.css + sizes.js + sizes.img;
  biggest.sort((a, b) => b.size - a.size);
  const row = { route, note, ...sizes, total, budget: rule.budget, biggest, ok: total <= rule.budget };
  if (!row.ok) {
    failures.push(
      `${route} 首屏 ${fmt(total)}，预算 ${fmt(rule.budget)}，超了 ${fmt(total - rule.budget)}` +
        (biggest[0] ? `；最大的一件是 ${biggest[0].url}（${fmt(biggest[0].size)}）` : ""),
    );
  }
  return row;
}

rows.sort((a, b) => (a.route === "/" ? -1 : b.route === "/" ? 1 : a.route.localeCompare(b.route)));

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
console.log("\n体积预算（gzip 6 级，单位 KB；首屏 = HTML + CSS + JS + 非懒加载图片）\n");
console.log(pad("路由", 26) + padL("HTML", 9) + padL("CSS", 9) + padL("JS", 9) + padL("图片", 9) + padL("合计", 10) + padL("预算", 10) + "  状态");
for (const r of rows) {
  console.log(
    pad(r.route, 26) +
      padL((r.html / KB).toFixed(1), 9) +
      padL((r.css / KB).toFixed(1), 9) +
      padL((r.js / KB).toFixed(1), 9) +
      padL((r.img / KB).toFixed(1), 9) +
      padL((r.total / KB).toFixed(1), 10) +
      padL((r.budget / KB).toFixed(0), 10) +
      (r.ok ? "  ok" : "  超了") +
      (r.note ? `  （${r.note}）` : ""),
  );
}

if (warnings.length) {
  console.log("\n提示：");
  for (const w of new Set(warnings)) console.log("  · " + w);
}

if (failures.length) {
  console.error("\n体积守门没过：");
  for (const f of failures) console.error("  ✗ " + f);
  console.error("\n预算写在 apps/web/scripts/check-size.mjs 的 RULES 里，规则见 docs/ROADMAP.md P3-4。");
  process.exit(1);
}

console.log("\n全部在预算内。\n");
