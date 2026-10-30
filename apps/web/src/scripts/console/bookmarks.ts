// 收藏夹：数据、渲染、编辑。浏览模式（编辑开关关闭）的外观和行为与改造前完全一致。
// 书签数据只在运行时从 /api/private/bookmarks 取；这里不含任何书签内容。
import { $, api, apiRaw, esc, explain, hostOf, initials, isBookmarklet, isLan, isWeb, jsonInit, safeUrl, ApiError } from "./common";
import { formDialog, confirmDialog, choiceDialog, modal, title as dlgTitle, actions as dlgActions, button as dlgButton } from "../ui/dialog";
import { attachMenu, type MenuItem } from "../ui/menu";
import { toast } from "../ui/toast";
import { mk } from "../ui/pop";

/* ---------- 类型 ---------- */
export type BmItem = { id: number; title: string; url: string };
export type BmNode = { id?: number; name: string; children?: BmNode[]; links?: [string, string][]; items?: BmItem[] };
/** 渲染用的一条书签。id 只有新格式的接口才有。 */
export type Flat = { id?: number; name: string; url: string; top: string; sub: string; host: string; lan: boolean; fid?: number };
type Folder = { key: string; name: string; depth: number; id?: number; parentId?: number | null; path: string };

/* ---------- 状态 ---------- */
let TREE: BmNode[] = [];
export let flat: Flat[] = [];
let folderList: Folder[] = [];
let folder = localStorage.getItem("bmFolder") || "全部";
let editing = localStorage.getItem("bmEdit") === "1";
let onChange: () => void = () => {};
export const bookmarkCount = () => flat.length;
/** 命令面板用：名字、所在分组、网址 */
export const bookmarkCmds = () => flat.map((b) => ({ name: b.name, group: b.sub || b.top, url: b.url }));

const inFolder = (b: Flat, key: string) => key === "全部" || b.top === key || b.top + "/" + b.sub === key;

/** 先把新格式的 id 带上；接口还没带 id 时（旧格式）退化成只读浏览。 */
function setBookmarks(tree: BmNode[]) {
  TREE = tree; flat = []; folderList = [];
  tree.forEach((f) => {
    folderList.push({ key: f.name, name: f.name, depth: 0, id: f.id, parentId: null, path: f.name });
    pushLinks(f, f.name, "");
    (f.children || []).forEach((c) => {
      folderList.push({ key: f.name + "/" + c.name, name: c.name, depth: 1, id: c.id, parentId: f.id ?? null, path: f.name + " / " + c.name });
      pushLinks(c, f.name, c.name);
      // 更深的层级：展平到二级（与改造前的显示一致），路径里保留完整层级
      const deep = (n: BmNode, trail: string) => (n.children || []).forEach((g) => { pushLinks(g, f.name, c.name); folderList.push({ key: f.name + "/" + c.name + "/" + trail + g.name, name: g.name, depth: 2, id: g.id, parentId: n.id ?? null, path: f.name + " / " + c.name + " / " + trail + g.name }); deep(g, trail + g.name + " / "); });
      deep(c, "");
    });
  });
  flat.forEach((b) => { b.host = hostOf(b.url); b.lan = isLan(b.host); });
  if (folder !== "全部" && !folderList.some((f) => f.key === folder)) folder = "全部";
}
function pushLinks(n: BmNode, top: string, sub: string) {
  if (n.items) n.items.forEach((x) => flat.push({ id: x.id, name: x.title, url: x.url, top, sub, host: "", lan: false, fid: n.id }));
  else (n.links || []).forEach(([t, u]) => flat.push({ name: t, url: u, top, sub, host: "", lan: false, fid: n.id }));
}

/* ---------- 渲染 ---------- */
const hl = (s: string, q: string) => { const t = esc(s); if (!q) return t; const i = s.toLowerCase().indexOf(q); return i < 0 ? t : esc(s.slice(0, i)) + "<mark>" + esc(s.slice(i, i + q.length)) + "</mark>" + esc(s.slice(i + q.length)); };
function linkHTML(b: Flat, q: string) {
  const inner = `<span class="ico">${esc(initials(b.name))}</span>` +
    `<span class="txt"><span class="name">${hl(b.name, q)}</span><span class="host">${hl(b.host, q)}${b.lan ? '<span class="lan">内网</span>' : ""}</span></span>`;
  if (isWeb(b.url)) return `<a class="link" href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener noreferrer" title="${esc(b.name)}\n${esc(b.url)}">${inner}</a>`;
  // 非 http(s)（chrome://、file://、javascript: 小书签…）只显示文字，不能点
  const tag = isBookmarklet(b.url) ? "小书签" : "";
  return `<span class="link inert" title="${esc(b.name)}\n${esc(b.url)}"><span class="ico">${esc(initials(b.name))}</span>` +
    `<span class="txt"><span class="name">${hl(b.name, q)}</span><span class="host">${tag ? `<span class="lan">${tag}</span>` : hl(b.host, q)}</span></span></span>`;
}
function renderFolders(q: string) {
  const count = (key: string) => flat.filter((b) => inFolder(b, key)).length;
  $("folders").innerHTML = [{ key: "全部", name: "全部", depth: 0 }, ...folderList.filter((f) => f.depth < 2)].map((f) =>
    `<li><button type="button" class="${f.depth ? "sub" : ""}" data-f="${esc(f.key)}" aria-pressed="${!q && f.key === folder}"><span>${esc(f.name)}</span><span class="n">${count(f.key)}</span></button></li>`).join("");
}
export function renderBookmarks(keepScroll = false) {
  const input = $<HTMLInputElement>("bmq");
  const q = input.value.trim().toLowerCase();
  const scroller = $("bmMain"), top = scroller.scrollTop;
  renderFolders(q);
  $("bmCount").textContent = q ? `筛选「${input.value.trim()}」` : `${flat.length} 个书签 · ${TREE.length} 个文件夹`;
  const list = flat.filter((b) => q ? (b.name + " " + b.url).toLowerCase().includes(q) : inFolder(b, folder));
  if (editing && !q) { renderEdit(); }
  else if (!list.length) scroller.innerHTML = `<div class="bm-empty">没有匹配的书签</div>`;
  else {
    const groups = new Map<string, Flat[]>();
    list.forEach((b) => { const k = b.top + (b.sub ? " / " + b.sub : ""); (groups.get(k) || groups.set(k, []).get(k)!).push(b); });
    scroller.innerHTML = [...groups].map(([k, arr]) =>
      `<div class="bm-group"><h3>${esc(k)} <span class="c">${arr.length}</span></h3><div class="links">${arr.map((b) => linkHTML(b, q)).join("")}</div></div>`).join("");
  }
  scroller.scrollTop = keepScroll ? top : 0;
}

/* ---------- 编辑模式 ---------- */
// 浏览模式不输出任何编辑相关的节点和 class。

/** 每个文件夹的完整路径，用于「移动到…」和新增链接时选所在文件夹 */
function folderOptions(skip?: Folder) {
  const out: { value: string; label: string }[] = [];
  const walk = (n: BmNode, path: string) => {
    if (n.id == null) return;
    out.push({ value: String(n.id), label: path });
    (n.children || []).forEach((c) => walk(c, path + " / " + c.name));
  };
  TREE.forEach((n) => walk(n, n.name));
  if (skip?.id == null) return out;
  // 文件夹不能移到自己或子孙下面：把它和它的子孙排除（后端也会检查）
  const bad = new Set<string>(), find = (n: BmNode, inside: boolean) => { const on = inside || n.id === skip.id; if (on && n.id != null) bad.add(String(n.id)); (n.children || []).forEach((c) => find(c, on)); };
  TREE.forEach((n) => find(n, false));
  return out.filter((o) => !bad.has(o.value));
}
function findNode(id: number): { node: BmNode; parent: BmNode | null; siblings: BmNode[] } | null {
  const go = (arr: BmNode[], parent: BmNode | null): { node: BmNode; parent: BmNode | null; siblings: BmNode[] } | null => {
    for (const n of arr) { if (n.id === id) return { node: n, parent, siblings: arr }; const r = go(n.children || [], n); if (r) return r; }
    return null;
  };
  return go(TREE, null);
}
const countLinks = (n: BmNode): number => (n.items?.length ?? n.links?.length ?? 0) + (n.children || []).reduce((s, c) => s + countLinks(c), 0);
const countFolders = (n: BmNode): number => (n.children || []).reduce((s, c) => s + 1 + countFolders(c), 0);

/** 当前正在浏览的文件夹对应的节点（用于「+ 链接」默认所在文件夹和编辑模式的渲染）；「全部」时为 null */
function currentNode(): BmNode | null {
  if (folder === "全部") return null;
  const f = folderList.find((x) => x.key === folder);
  return f?.id != null ? findNode(f.id)?.node ?? null : null;
}

function renderEdit() {
  const scroller = $("bmMain");
  const cur = currentNode();
  const roots = cur ? [cur] : TREE;
  scroller.innerHTML = "";
  const bar = mk("div", "bm-editbar");
  const addL = mk("button", "btn sm", "+ 链接"), addF = mk("button", "btn sm", "+ 文件夹");
  addL.type = addF.type = "button";
  addL.addEventListener("click", () => void addLink(cur));
  addF.addEventListener("click", () => void addFolder(cur));
  bar.append(addL, addF, mk("span", "bm-hint", "拖动 ⋮⋮ 排序，或在「⋯」菜单里上移/下移"));
  scroller.append(bar);
  if (!roots.length) scroller.append(mk("div", "bm-empty", "还没有书签，点上面的按钮添加"));
  for (const n of roots) scroller.append(folderBlock(n, cur ? n.name : n.name, 0, null));
}

function folderBlock(n: BmNode, path: string, depth: number, parent: BmNode | null): HTMLElement {
  const box = mk("section", "bm-fold"); box.dataset.fid = String(n.id ?? "");
  const head = mk("div", "bm-fhead");
  head.append(mk("h3", "", path + " "), mk("span", "c", String(countLinks(n))));
  const sibs = parent ? parent.children! : TREE;
  head.append(more(`文件夹 ${n.name}`, () => folderMenu(n, parent, sibs)));
  box.append(head);
  const links = mk("div", "links edit"); links.dataset.fid = String(n.id ?? "");
  const items = n.items ?? [];
  for (const it of items) links.append(linkRow({ id: it.id, name: it.title, url: it.url, host: hostOf(it.url), lan: isLan(hostOf(it.url)), top: "", sub: "", fid: n.id }, n, items.length));
  if (!items.length && !(n.children || []).length) links.append(mk("div", "bm-empty sm", "空文件夹"));
  box.append(links);
  for (const c of n.children || []) box.append(folderBlock(c, path + " / " + c.name, depth + 1, n));
  return box;
}
function handle(): HTMLElement {
  const h = mk("span", "bm-handle", "⋮⋮"); h.setAttribute("aria-hidden", "true"); h.draggable = false; return h;
}
function more(label: string, items: () => MenuItem[]): HTMLElement {
  const b = mk("button", "bm-more", "⋯"); b.type = "button"; b.setAttribute("aria-label", `${label} 的操作`);
  attachMenu(b, items);
  return b;
}
function linkRow(b: Flat, folderNode: BmNode, n: number): HTMLElement {
  const row = mk("div", "bm-row"); row.dataset.id = String(b.id ?? ""); row.dataset.fid = String(folderNode.id ?? ""); row.draggable = true;
  const view = document.createElement("div"); view.className = "bm-cell"; view.innerHTML = linkHTML(b, "");
  // 编辑模式下，整行不是链接：http(s) 链接保留可点，但手柄和菜单在旁边
  row.append(handle(), view, more(`链接 ${b.name}`, () => linkMenu(b, folderNode)));
  void n;
  return row;
}

function linkMenu(b: Flat, f: BmNode): MenuItem[] {
  const arr = f.items!, i = arr.findIndex((x) => x.id === b.id);
  return [
    { label: "修改…", run: () => void editLink(b) },
    { label: "移动到…", run: () => void moveLink(b) },
    "sep",
    { label: "上移", run: () => void reorderLink(f, i, -1), disabled: i <= 0 },
    { label: "下移", run: () => void reorderLink(f, i, 1), disabled: i < 0 || i >= arr.length - 1 },
    "sep",
    { label: "删除…", danger: true, run: () => void delLink(b) },
  ];
}
function folderMenu(n: BmNode, parent: BmNode | null, sibs: BmNode[]): MenuItem[] {
  const i = sibs.findIndex((x) => x.id === n.id);
  return [
    { label: "重命名…", run: () => void renameFolder(n) },
    { label: "移动到…", run: () => void moveFolder(n) },
    "sep",
    { label: "上移", run: () => void reorderFolder(parent, i, -1), disabled: i <= 0 },
    { label: "下移", run: () => void reorderFolder(parent, i, 1), disabled: i < 0 || i >= sibs.length - 1 },
    "sep",
    { label: "删除…", danger: true, run: () => void delFolder(n) },
  ];
}

/* ---------- 操作：增删改移 ---------- */
const BM = "/api/private/bookmarks";
const FOLDER_OVERRIDES = { invalid_move: "不能把文件夹移到它自己下面", not_found: "找不到这一项，可能已被删除，已刷新列表" };
async function run<T>(what: string, fn: () => Promise<T>, ok?: string): Promise<T | undefined> {
  try { const r = await fn(); if (ok) toast(ok, { kind: "ok" }); return r; }
  catch (e) { toast(`${what}失败：${explain(e, FOLDER_OVERRIDES)}`, { kind: "err" }); if (e instanceof ApiError && e.code === "not_found") await reload(); return undefined; }
}
const urlProblem = (u: string) => (u.length > 2048 ? "网址最长 2048 个字符" : /[\u0000-\u001f\u007f]/.test(u) ? "网址里不能有控制字符" : null);
const nameProblem = (v: string, max: number, what: string) => ([...v].length > max ? `${what}最长 ${max} 个字` : /[\u0000-\u001f\u007f]/.test(v) ? `${what}里不能有控制字符` : null);

async function addLink(cur: BmNode | null) {
  const opts = folderOptions();
  if (!opts.length) { toast("请先新建一个文件夹", { kind: "info" }); return; }
  const v = await formDialog({ title: "新增链接", confirmText: "添加", fields: [
    { name: "title", label: "标题（留空则用网址）", required: false, maxLength: 300 },
    { name: "url", label: "网址", type: "url", placeholder: "https://…", mono: true },
    { name: "folderId", label: "所属文件夹", type: "select", options: opts, value: String(cur?.id ?? opts[0].value), searchable: true },
  ], validate: (x) => urlProblem(x.url) || nameProblem(x.title, 300, "标题") });
  if (!v) return;
  await run("新增", async () => { await api(`${BM}/links`, jsonInit("POST", { folderId: Number(v.folderId), title: v.title || v.url, url: v.url })); await reload(); }, "已添加链接");
}
async function editLink(b: Flat) {
  const v = await formDialog({ title: "修改链接", fields: [
    { name: "title", label: "标题", value: b.name, maxLength: 300 },
    { name: "url", label: "网址（可保存任何协议）", type: "url", value: b.url, mono: true },
  ], validate: (x) => urlProblem(x.url) || nameProblem(x.title, 300, "标题") });
  if (!v || (v.title === b.name && v.url === b.url)) return;
  await run("修改", async () => { await api(`${BM}/links/${b.id}`, jsonInit("PUT", { title: v.title, url: v.url })); await reload(); }, "已修改");
}
async function moveLink(b: Flat) {
  const v = await formDialog({ title: "移动到…", confirmText: "移动", fields: [{ name: "folderId", label: "目标文件夹", type: "select", options: folderOptions(), value: String(b.fid ?? ""), searchable: true }] });
  if (!v || Number(v.folderId) === b.fid) return;
  await run("移动", async () => { await api(`${BM}/links/${b.id}`, jsonInit("PUT", { folderId: Number(v.folderId) })); await reload(); }, "已移动");
}
async function delLink(b: Flat) {
  if (!(await confirmDialog({ title: "删除这个链接？", body: `「${b.name}」\n${b.url}`, confirmText: "删除", danger: true }))) return;
  await run("删除", async () => { await api(`${BM}/links/${b.id}`, { method: "DELETE" }); await reload(); }, "已删除链接");
}
async function addFolder(cur: BmNode | null) {
  const opts = [{ value: "", label: "（顶层）" }, ...folderOptions()];
  const v = await formDialog({ title: "新增文件夹", confirmText: "添加", fields: [
    { name: "name", label: "名称", maxLength: 100 },
    { name: "parentId", label: "放在哪个文件夹下", type: "select", options: opts, value: String(cur?.id ?? ""), searchable: true, required: false },
  ], validate: (x) => nameProblem(x.name, 100, "名称") });
  if (!v) return;
  await run("新增", async () => { await api(`${BM}/folders`, jsonInit("POST", { name: v.name, parentId: v.parentId ? Number(v.parentId) : null })); await reload(); }, "已添加文件夹");
}
async function renameFolder(n: BmNode) {
  const v = await formDialog({ title: "重命名文件夹", fields: [{ name: "name", label: "名称", value: n.name, maxLength: 100 }], validate: (x) => nameProblem(x.name, 100, "名称") });
  if (!v || v.name === n.name) return;
  await run("重命名", async () => { await api(`${BM}/folders/${n.id}`, jsonInit("PUT", { name: v.name })); await reload(); }, "已重命名");
}
async function moveFolder(n: BmNode) {
  const me = folderList.find((f) => f.id === n.id), cur = findNode(n.id!)?.parent?.id;
  const opts = [{ value: "", label: "（顶层）" }, ...folderOptions(me ?? ({ id: n.id } as Folder))];
  const v = await formDialog({ title: "移动文件夹到…", confirmText: "移动", fields: [{ name: "parentId", label: "目标文件夹", type: "select", options: opts, value: String(cur ?? ""), searchable: true, required: false }] });
  if (!v || String(cur ?? "") === v.parentId) return;
  await run("移动", async () => { await api(`${BM}/folders/${n.id}`, jsonInit("PUT", { parentId: v.parentId ? Number(v.parentId) : null })); await reload(); }, "已移动");
}
async function delFolder(n: BmNode) {
  const links = countLinks(n), subs = countFolders(n);
  const body = `「${n.name}」\n会一起删除它下面的 ${links} 个链接` + (subs ? `和 ${subs} 个子文件夹。` : "。") + (links > 20 ? "\n超过 20 条，删除前会自动保存一份快照。" : "");
  if (!(await confirmDialog({ title: "删除这个文件夹？", body, confirmText: "删除", danger: true }))) return;
  await run("删除", async () => { await api(`${BM}/folders/${n.id}`, { method: "DELETE" }); await reload(); }, `已删除文件夹，共 ${links} 个链接`);
}

/* ---------- 排序 ---------- */
// 乐观更新：先在本地换好顺序并重绘，请求失败再恢复原来的顺序。
async function sendOrder(parent: BmNode | null, snapshot: () => void, rollback: () => void) {
  const f = parent ?? null;
  const folderId = f?.id ?? null;
  // 根目录没有 id：后端约定 folderId 为 null 表示顶层
  const body = { folderId, folders: ((f ? f.children : TREE) || []).map((x) => x.id), links: (f?.items ?? []).map((x) => x.id) };
  snapshot();
  try { await api(`${BM}/order`, jsonInit("PUT", body)); await reload(); }
  catch (e) { rollback(); renderBookmarks(true); toast(`排序失败，已恢复原来的顺序：${explain(e, FOLDER_OVERRIDES)}`, { kind: "err" }); }
}
function swap<T>(arr: T[], i: number, j: number) { const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
async function reorderLink(f: BmNode, i: number, d: number) {
  const arr = f.items!, j = i + d; if (i < 0 || j < 0 || j >= arr.length) return;
  const before = arr.slice(); swap(arr, i, j); renderBookmarks(true);
  await sendOrder(f, () => {}, () => { arr.splice(0, arr.length, ...before); });
  focusRow(arr[j]?.id);
}
async function reorderFolder(parent: BmNode | null, i: number, d: number) {
  const arr = parent ? parent.children! : TREE, j = i + d; if (i < 0 || j < 0 || j >= arr.length) return;
  const before = arr.slice(); swap(arr, i, j); renderBookmarks(true);
  await sendOrder(parent, () => {}, () => { arr.splice(0, arr.length, ...before); });
}
/** 重绘后把焦点放回刚移动的那一行的菜单按钮，键盘用户可以连续上移/下移 */
function focusRow(id?: number) { if (id != null) $("bmMain").querySelector<HTMLElement>(`.bm-row[data-id="${id}"] .bm-more`)?.focus(); }

/** 拖拽排序（指针事件）：只在同一个文件夹内，跨文件夹用「移动到…」。 */
function initDrag() {
  const main = $("bmMain");
  let drag: { row: HTMLElement; fid: string; id: number; ghost: HTMLElement; startY: number; moved: boolean; pid: number } | null = null;
  main.addEventListener("pointerdown", (e) => {
    const h = (e.target as HTMLElement).closest<HTMLElement>(".bm-handle");
    const row = h?.closest<HTMLElement>(".bm-row");
    if (!h || !row || e.button !== 0 || !editing) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    drag = { row, fid: row.dataset.fid!, id: Number(row.dataset.id), ghost: row, startY: e.clientY, moved: false, pid: e.pointerId };
    row.classList.add("dragging");
  });
  main.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (Math.abs(e.clientY - drag.startY) > 4) drag.moved = true;
    if (!drag.moved) return;
    const wrap = drag.row.parentElement!;
    const rows = [...wrap.querySelectorAll<HTMLElement>(".bm-row")].filter((r) => r !== drag!.row);
    // 找到指针所在的行（同一文件夹内），把拖动的行插到它前/后
    const over = rows.find((r) => { const b = r.getBoundingClientRect(); return e.clientY >= b.top && e.clientY <= b.bottom && e.clientX >= b.left - 4 && e.clientX <= b.right + 4; });
    if (over) { const b = over.getBoundingClientRect(); const after = (e.clientY - b.top) > b.height / 2 && (e.clientX > b.left || true); wrap.insertBefore(drag.row, after ? over.nextSibling : over); }
    const sc = main.getBoundingClientRect(); // 靠近边缘时自动滚动
    if (e.clientY < sc.top + 30) main.scrollTop -= 12; else if (e.clientY > sc.bottom - 30) main.scrollTop += 12;
  });
  const finish = async (e: PointerEvent, cancel: boolean) => {
    if (!drag) return;
    const d = drag; drag = null;
    d.row.classList.remove("dragging");
    if (!d.moved) return;
    const fnode = findNode(Number(d.fid))?.node;
    if (!fnode?.items) return;
    const ids = [...d.row.parentElement!.querySelectorAll<HTMLElement>(".bm-row")].map((r) => Number(r.dataset.id));
    const before = fnode.items.slice();
    if (cancel || ids.join() === before.map((x) => x.id).join()) { renderBookmarks(true); return; }
    fnode.items = ids.map((id) => before.find((x) => x.id === id)!).filter(Boolean);
    renderBookmarks(true);
    await sendOrder(fnode, () => {}, () => { fnode.items = before; });
    void e;
  };
  main.addEventListener("pointerup", (e) => void finish(e, false));
  main.addEventListener("pointercancel", (e) => void finish(e, true));
  // 键盘：焦点在一行里时 Alt+↑/↓ 上移/下移
  main.addEventListener("keydown", (e) => {
    if (!editing || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>(".bm-row"); if (!row) return;
    const f = findNode(Number(row.dataset.fid))?.node; if (!f?.items) return;
    e.preventDefault();
    const i = f.items.findIndex((x) => x.id === Number(row.dataset.id));
    void reorderLink(f, i, e.key === "ArrowUp" ? -1 : 1);
  });
}

/* ---------- 加载 / 刷新 ---------- */
function bmMessage(html: string) { $("bmMain").innerHTML = `<div class="bm-empty">${html}</div>`; $("bmCount").textContent = ""; $("folders").innerHTML = ""; }
async function fetchTree(): Promise<BmNode[] | null> {
  const res = await apiRaw(BM).catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; });
  if (!res) return null;
  const data = await res.json();
  return Array.isArray(data) ? data : null;
}
/** 增删改之后局部刷新：保持当前文件夹、滚动位置和筛选词。 */
export async function reload() {
  const tree = await fetchTree();
  if (!tree) return;
  setBookmarks(tree);
  renderBookmarks(true);
  onChange();
}
export async function loadBookmarks(changed: () => void) {
  onChange = changed;
  try {
    const tree = await fetchTree();
    if (!tree || !tree.length) { bmMessage("还没有导入书签（运行 import-bookmarks，或在「管理」里导入 HTML）"); wireManage(); return; }
    setBookmarks(tree);
    renderBookmarks();
    wireManage();
    changed();
  } catch (e) {
    if (e instanceof ApiError && e.code === "unauthorized") return;
    bmMessage("书签加载失败，请刷新重试");
  }
}

/* ---------- 文件夹列表、筛选（浏览模式沿用原有行为） ---------- */
$("folders").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button"); if (!b) return;
  folder = b.dataset.f!; localStorage.setItem("bmFolder", folder); $<HTMLInputElement>("bmq").value = ""; renderBookmarks();
});
$("bmq").addEventListener("input", () => renderBookmarks());

/* ---------- 编辑开关、管理菜单 ---------- */
const hasIds = () => TREE.length > 0 && TREE.every((n) => n.id != null);
let wired = false;
function wireManage() {
  if (wired) return; wired = true;
  const sw = $<HTMLButtonElement>("bmEditSwitch"), manage = $<HTMLButtonElement>("bmManage");
  const sync = () => {
    sw.setAttribute("aria-pressed", String(editing));
    $("bmCard").classList.toggle("editing", editing);
  };
  sw.addEventListener("click", () => {
    if (!editing && !hasIds()) { toast("后端还没有返回书签 id，暂时不能编辑", { kind: "info" }); return; }
    editing = !editing; localStorage.setItem("bmEdit", editing ? "1" : "0"); sync(); renderBookmarks(true);
  });
  if (editing && !hasIds()) editing = false;
  sync(); if (editing) renderBookmarks(true);
  attachMenu(manage, () => [
    { label: "导入 HTML…", run: () => $("bmImportFile").click() },
    { label: "导出 HTML", href: `${BM}/export`, download: true },
    "sep",
    { label: "保存快照", run: () => void saveSnapshot() },
    { label: "快照列表…", run: () => void showSnapshots() },
  ]);
  $<HTMLInputElement>("bmImportFile").addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement, f = input.files?.[0]; input.value = "";
    if (f) void importHtml(f);
  });
  initDrag();
}

async function importHtml(f: File) {
  if (f.size > 5 * 1024 * 1024) { toast("文件超过 5 MB，没有导入", { kind: "err" }); return; }
  const mode = await choiceDialog({
    title: `导入「${f.name}」`, body: "替换全部：现在的书签会被文件里的整体替换（导入前会自动保存一份快照）。\n合并：把文件里的书签加到一个新文件夹「导入 日期」里，不动现有的。",
    choices: [{ text: "合并", value: "merge" }, { text: "替换全部", value: "replace", danger: true }],
  });
  if (!mode) return;
  if (mode === "replace" && !(await confirmDialog({ title: "替换全部书签？", body: `现有的 ${flat.length} 个书签会被「${f.name}」里的内容整体替换。\n导入前会自动保存一份快照，可以在「快照列表」里恢复。`, confirmText: "替换全部", danger: true }))) return;
  const fd = new FormData(); fd.append("file", f, f.name); fd.append("mode", mode);
  await run("导入", async () => { const r = await api<{ folders: number; links: number }>(`${BM}/import`, { method: "POST", body: fd }); await reload(); toast(`已导入 ${r?.links ?? 0} 个书签、${r?.folders ?? 0} 个文件夹`, { kind: "ok" }); });
}

type Snap = { id: number; reason: string; count: number; createdAt: string };
const REASON: Record<string, string> = { import: "导入前", "bulk-delete": "批量删除前", manual: "手动保存", restore: "恢复前" };
const fmtTime = (iso: string) => { const d = new Date(iso); if (isNaN(d.getTime())) return iso; const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
async function saveSnapshot() { await run("保存快照", async () => { await api(`${BM}/snapshots`, { method: "POST" }); }, "已保存快照"); }
async function showSnapshots() {
  let items: Snap[];
  try { items = (await api<{ items: Snap[] }>(`${BM}/snapshots`)).items ?? []; } catch (e) { toast(`读取快照失败：${explain(e)}`, { kind: "err" }); return; }
  const pick = await modal<number | null>("ui-dialog ui-snaps", null, (d, fin) => {
    const body = mk("div", "ui-dialog-body");
    body.append(dlgTitle(d, "快照列表"));
    const note = mk("p", "ui-dialog-text", items.length ? "最多保留 10 份。恢复前会先自动保存当前的书签。" : "还没有快照。导入、批量删除或点「保存快照」时会生成。");
    body.append(note);
    const ul = mk("ul", "snap-list");
    for (const s of items) {
      const li = mk("li", "snap-row"), t = mk("span", "snap-t");
      t.append(mk("strong", "", fmtTime(s.createdAt)), mk("span", "snap-m", `${REASON[s.reason] ?? s.reason} · ${s.count} 个书签`));
      const b = dlgButton("恢复", "sm"); b.onclick = () => fin(s.id);
      li.append(t, b); ul.append(li);
    }
    if (items.length) body.append(ul);
    const close = dlgButton("关闭", "ghost"); close.onclick = () => fin(null);
    d.append(body, dlgActions(close));
    return close;
  });
  if (pick == null) return;
  const s = items.find((x) => x.id === pick)!;
  if (!(await confirmDialog({ title: "恢复这份快照？", body: `${fmtTime(s.createdAt)}（${s.count} 个书签）\n现有的书签会被整体替换。恢复前会先自动保存当前的书签。`, confirmText: "恢复", danger: true }))) return;
  await run("恢复", async () => { await api(`${BM}/snapshots/${pick}/restore`, { method: "POST" }); await reload(); }, "已恢复快照");
}
