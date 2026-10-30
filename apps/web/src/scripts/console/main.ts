// 控制台脚本。书签、热点、服务器状态全部在运行时从 API 取，构建产物里不含任何这类数据。
import { startFlowField } from "../flowfield";

type BmNode = { name: string; children?: BmNode[]; links?: [string, string][] };
type Flat = { name: string; url: string; top: string; sub: string; host: string; lan: boolean };
type Hot = { rank: number; title: string; sourceCount: number; url: string };
type Cmd = { name: string; group: string; keys?: string; run: () => void };

const ENGINES: [string, string][] = [["Bing", "https://www.bing.com/search?q="], ["Google", "https://www.google.com/search?q="], ["百度", "https://www.baidu.com/s?wd="], ["GitHub", "https://github.com/search?q="], ["MDN", "https://developer.mozilla.org/zh-CN/search?q="]];

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const initials = (n: string) => { const s = n.replace(/^[\s\[\(【]+/, ""); return /^[\u4e00-\u9fa5]/.test(s) ? s[0] : (s.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || s[0] || "?"); };
const hostOf = (u: string) => { try { const x = new URL(u); return x.protocol.startsWith("http") ? x.hostname.replace(/^www\./, "") : x.protocol.replace(":", ""); } catch { return ""; } };
const isLan = (h: string) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
// Allowlist: browsers strip tabs/newlines/control chars before parsing the scheme, so a blocklist is bypassable.
const safeUrl = (u: string) => {
  try {
    return ["http:", "https:"].includes(new URL(u).protocol) ? u : "#";
  } catch {
    return "#";
  }
};
const goLogin = () => { location.href = "/login"; };
const getJSON = (url: string) => fetch(url, { credentials: "same-origin" });

/* 时钟 */
const WEEK = "日一二三四五六";
function tick() {
  const d = new Date(), h = d.getHours(), p = (n: number) => String(n).padStart(2, "0");
  $("#clock").innerHTML = `${p(h)}:${p(d.getMinutes())}<span class="sec">${p(d.getSeconds())}</span>`;
  $("#date").textContent = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${WEEK[d.getDay()]}`;
  $("#greet").textContent = h < 6 ? "夜深了，zreo" : h < 12 ? "早上好，zreo" : h < 18 ? "下午好，zreo" : "晚上好，zreo";
}
tick(); setInterval(tick, 1000);

/* 搜索（默认 Bing） */
let engine = localStorage.getItem("engineName") || "Bing";
if (!ENGINES.some(([n]) => n === engine)) engine = "Bing";
function renderEngines() { $("#engines").innerHTML = ENGINES.map(([n]) => `<button type="button" data-n="${n}" aria-pressed="${n === engine}">${n}</button>`).join(""); }
$("#engines").addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest("button"); if (!b) return; engine = b.dataset.n!; localStorage.setItem("engineName", engine); renderEngines(); $("#q").focus(); });
$("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); const q = $<HTMLInputElement>("#q").value.trim(); if (!q) return; window.open(ENGINES.find(([n]) => n === engine)![1] + encodeURIComponent(q), "_blank", "noopener"); });
renderEngines();

/* AI 热点滚动 */
const safeHot = (u: string) => (/^https?:\/\//i.test(u) ? u : "https://aihot.news/hot");
const hotItems = (list: Hot[], dup: boolean) => list.map((x) =>
  `<li class="${x.rank <= 3 ? "top3" : ""} ${dup ? "dup" : ""}" ${dup ? 'aria-hidden="true"' : ""}><a href="${esc(safeHot(x.url))}" target="_blank" rel="noopener" ${dup ? 'tabindex="-1"' : ""}>` +
  `<span class="rank">${String(x.rank).padStart(2, "0")}</span><span class="t">${esc(x.title)}</span><span class="src">${esc(x.sourceCount)} 源</span></a></li>`).join("");
function hotFail() {
  $("#ticker").innerHTML = `<div class="ticker-msg">暂时无法获取 AIHOT 热点。<a href="https://aihot.news/hot" target="_blank" rel="noopener">去 AIHOT 查看 →</a></div>`;
}
async function loadHot() {
  $("#tickerTrack").innerHTML = `<li class="ticker-msg">加载中…</li>`;
  try {
    const res = await fetch("/api/hot");
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const list: Hot[] = (data.items || []).slice(0, 10);
    if (!list.length) throw new Error("empty");
    $("#tickerTrack").innerHTML = hotItems(list, false) + hotItems(list, true);
  } catch { hotFail(); }
}
loadHot();

/* 收藏夹：文件夹 key 用 "一级" 或 "一级/二级" */
let BOOKMARKS: BmNode[] = [];
let flat: Flat[] = [];
let folderList: { key: string; name: string; depth: number }[] = [];
let folder = localStorage.getItem("bmFolder") || "全部";
const inFolder = (b: Flat, key: string) => key === "全部" || b.top === key || b.top + "/" + b.sub === key;

function setBookmarks(tree: BmNode[]) {
  BOOKMARKS = tree; flat = []; folderList = [];
  tree.forEach((f) => {
    folderList.push({ key: f.name, name: f.name, depth: 0 });
    (f.links || []).forEach(([n, u]) => flat.push({ name: n, url: u, top: f.name, sub: "", host: "", lan: false }));
    (f.children || []).forEach((c) => {
      folderList.push({ key: f.name + "/" + c.name, name: c.name, depth: 1 });
      (c.links || []).forEach(([n, u]) => flat.push({ name: n, url: u, top: f.name, sub: c.name, host: "", lan: false }));
    });
  });
  flat.forEach((b) => { b.host = hostOf(b.url); b.lan = isLan(b.host); });
  if (folder !== "全部" && !folderList.some((f) => f.key === folder)) folder = "全部";
  buildCmds();
}

const hl = (s: string, q: string) => { const t = esc(s); if (!q) return t; const i = s.toLowerCase().indexOf(q); return i < 0 ? t : esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + q.length)) + "</mark>" + esc(s.slice(i + q.length)); };
function linkHTML(b: Flat, q: string) {
  return `<a class="link" href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener noreferrer" title="${esc(b.name)}\n${esc(b.url)}">` +
    `<span class="ico">${esc(initials(b.name))}</span>` +
    `<span class="txt"><span class="name">${hl(b.name, q)}</span><span class="host">${hl(b.host, q)}${b.lan ? '<span class="lan">内网</span>' : ""}</span></span></a>`;
}
function renderFolders(q: string) {
  const count = (key: string) => flat.filter((b) => inFolder(b, key)).length;
  $("#folders").innerHTML = [{ key: "全部", name: "全部", depth: 0 }, ...folderList].map((f) =>
    `<li><button type="button" class="${f.depth ? "sub" : ""}" data-f="${esc(f.key)}" aria-pressed="${!q && f.key === folder}"><span>${esc(f.name)}</span><span class="n">${count(f.key)}</span></button></li>`).join("");
}
function renderBookmarks() {
  const input = $<HTMLInputElement>("#bmq");
  const q = input.value.trim().toLowerCase();
  renderFolders(q);
  $("#bmCount").textContent = q ? `筛选「${input.value.trim()}」` : `${flat.length} 个书签 · ${BOOKMARKS.length} 个文件夹`;
  const list = flat.filter((b) => q ? (b.name + " " + b.url).toLowerCase().includes(q) : inFolder(b, folder));
  if (!list.length) { $("#bmMain").innerHTML = `<div class="bm-empty">没有匹配的书签</div>`; return; }
  const groups = new Map<string, Flat[]>();
  list.forEach((b) => { const k = b.top + (b.sub ? " / " + b.sub : ""); (groups.get(k) || groups.set(k, []).get(k)!).push(b); });
  $("#bmMain").innerHTML = [...groups].map(([k, arr]) =>
    `<div class="bm-group"><h3>${esc(k)} <span class="c">${arr.length}</span></h3><div class="links">${arr.map((b) => linkHTML(b, q)).join("")}</div></div>`).join("");
  $("#bmMain").scrollTop = 0;
}
$("#folders").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button"); if (!b) return;
  folder = b.dataset.f!; localStorage.setItem("bmFolder", folder); $<HTMLInputElement>("#bmq").value = ""; renderBookmarks();
});
$("#bmq").addEventListener("input", renderBookmarks);

function bmMessage(html: string) { $("#bmMain").innerHTML = `<div class="bm-empty">${html}</div>`; $("#bmCount").textContent = ""; $("#folders").innerHTML = ""; }
async function loadBookmarks() {
  try {
    const res = await getJSON("/api/private/bookmarks");
    if (res.status === 401) return goLogin();
    if (res.status === 404) return bmMessage("还没有导入书签（运行 import-bookmarks）");
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return bmMessage("还没有导入书签（运行 import-bookmarks）");
    setBookmarks(data);
    renderBookmarks();
  } catch { bmMessage("书签加载失败，请刷新重试"); }
}
loadBookmarks();

/* 服务器状态 */
const GB = 1024 ** 3;
const fmtSize = (b: number) => (b >= GB ? (b / GB).toFixed(b >= 10 * GB ? 0 : 1) + "G" : Math.round(b / 1024 ** 2) + "M");
const fmtUp = (s: number) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d} 天 ${h} 小时` : h ? `${h} 小时 ${m} 分` : `${m} 分`; };
const pct = (a: number, b: number) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);
function setStat(id: string, v: string, k: string, p: number) {
  $("#" + id).textContent = v; $("#" + id + "K").textContent = k; $("#" + id + "Bar").style.width = p.toFixed(0) + "%";
}
function serverFail() {
  ["svCpu", "svMem", "svDisk", "svLoad", "svUp", "svHost"].forEach((id) => { $("#" + id).textContent = "—"; });
  ["svCpuBar", "svMemBar", "svDiskBar"].forEach((id) => { $("#" + id).style.width = "0"; });
}
async function loadServer() {
  try {
    const res = await getJSON("/api/private/server");
    if (res.status === 401) return goLogin();
    if (!res.ok) throw new Error(String(res.status));
    const s = await res.json();
    const cpu = pct(s.cpu.load1, s.cpu.cores);
    setStat("svCpu", cpu.toFixed(0) + "%", `CPU · ${s.cpu.cores} 核`, cpu);
    setStat("svMem", fmtSize(s.mem.used), `内存 / ${fmtSize(s.mem.total)}`, pct(s.mem.used, s.mem.total));
    setStat("svDisk", fmtSize(s.disk.used), `磁盘 / ${fmtSize(s.disk.total)}`, pct(s.disk.used, s.disk.total));
    $("#svLoad").textContent = [s.cpu.load1, s.cpu.load5, s.cpu.load15].map((n: number) => n.toFixed(2)).join(" / ");
    $("#svUp").textContent = fmtUp(s.uptime);
    $("#svHost").textContent = fmtUp(s.hostUptime);
  } catch { serverFail(); }
}
loadServer();
setInterval(() => { if (!document.hidden) loadServer(); }, 30 * 1000);

/* 退出登录 */
$("#logout").addEventListener("click", async () => {
  try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch {}
  goLogin();
});

/* 命令面板 */
const MODE_NAMES: Record<string, string> = { auto: "自动", paper: "白纸", blueprint: "蓝图" };
const setMode = (k: string) => (window as any).setThemeMode(k);
let CMDS: Cmd[] = [];
function buildCmds() {
  CMDS = [
    ...flat.map((b) => ({ name: b.name, group: b.sub || b.top, keys: b.url, run: () => window.open(safeUrl(b.url), "_blank", "noopener") })),
    ...Object.entries(MODE_NAMES).map(([k, v]) => ({ name: `主题：${v}`, group: "命令", keys: "theme zhuti " + k, run: () => setMode(k) })),
    { name: "公开主页", group: "页面", run: () => { location.href = "/"; } },
  ];
}
buildCmds();
let sel = 0, shown: Cmd[] = [];
function renderPalette() {
  const q = $<HTMLInputElement>("#pq").value.trim().toLowerCase();
  shown = CMDS.filter((c) => !q || (c.name + " " + c.group + " " + (c.keys || "")).toLowerCase().includes(q)).slice(0, 12);
  sel = Math.min(sel, Math.max(shown.length - 1, 0));
  $("#plist").innerHTML = shown.length ? shown.map((c, i) =>
    `<li role="option" data-i="${i}" aria-selected="${i === sel}"><span class="ico">${esc(initials(c.name.replace("主题：", "")))}</span><span class="nm">${esc(c.name)}</span><span class="grp">${esc(c.group)}</span></li>`).join("")
    : `<li class="palette-empty">没有匹配项</li>`;
}
function openPalette() { $("#palette").classList.add("open"); $<HTMLInputElement>("#pq").value = ""; sel = 0; renderPalette(); $("#pq").focus(); }
function closePalette() { $("#palette").classList.remove("open"); }
function runSel(i: number) { const c = shown[i]; if (!c) return; closePalette(); c.run(); }
$("#openPalette").addEventListener("click", openPalette);
$("#pq").addEventListener("input", () => { sel = 0; renderPalette(); });
$("#plist").addEventListener("click", (e) => { const li = (e.target as HTMLElement).closest("li[data-i]") as HTMLElement | null; if (li) runSel(Number(li.dataset.i)); });
$("#palette").addEventListener("click", (e) => { if ((e.target as HTMLElement).id === "palette") closePalette(); });
document.addEventListener("keydown", (e) => {
  const open = $("#palette").classList.contains("open");
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open ? closePalette() : openPalette(); return; }
  if (open) {
    if (e.key === "Escape") closePalette();
    else if (e.key === "ArrowDown") { e.preventDefault(); sel = (sel + 1) % Math.max(shown.length, 1); renderPalette(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = (sel - 1 + shown.length) % Math.max(shown.length, 1); renderPalette(); }
    else if (e.key === "Enter") { e.preventDefault(); runSel(sel); }
    return;
  }
  if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || "")) { e.preventDefault(); $("#q").focus(); }
});

/* 试验场：流场粒子 */
startFlowField($<HTMLCanvasElement>("#lab-canvas"), 240);
