// 设置页 /console/settings。原生 TS。接口约定见 docs/contracts/taxonomy-profile.md。
// 所有用户文本只用 textContent 写入，不拼 HTML。
import { $, api, apiRaw, ApiError, explain, initialOf, jsonInit, safeAvatar } from "./common";
import { setProfileCache, type Fact, type Link, type Profile } from "./topbar";
import { renderIntro } from "../intro-render";
import { confirmDialog } from "../ui/dialog";
import { enhanceSelect } from "../ui/select";
import { toast } from "../ui/toast";
import { openRebind } from "./rebind";
import { formatProvinceCity } from "./weather";

type Cat = { id: number; slug: string; name: string; description: string; sort: number; count: number; draftCount: number };
type TagItem = { name: string; sort: number; count: number; draftCount: number };

const msgEl = $("st-msg");
let msgTimer = 0;
/** 消息条只放错误和进行中的提示；成功类消息走 Toast。错误同时弹 Toast。 */
function setMsg(text: string, kind: "" | "err" | "ok" = "") {
  clearTimeout(msgTimer);
  if (kind === "ok" && text && !/…$/.test(text)) { msgEl.textContent = ""; msgEl.className = "st-msg"; toast(text, { kind: "ok" }); return; }
  msgEl.textContent = text; msgEl.className = "st-msg " + kind;
  if (kind === "err" && text) toast(text, { kind: "err" });
}
const fail = (prefix: string, e: unknown) => setMsg(`${prefix}：${explain(e)}`, "err");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  const { class: cls, ...rest } = props as any;
  if (cls) n.className = cls;
  Object.assign(n, rest);
  n.append(...kids);
  return n;
}
const btn = (text: string, onClick: () => void, label?: string, cls = "btn sm") => {
  const b = el("button", { type: "button", class: cls, textContent: text });
  if (label) b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
};

/* ---------- 分区切换（URL hash 记住） ---------- */
const SECTIONS = ["profile", "taxonomy", "weather", "backup", "security"] as const;
type Sec = (typeof SECTIONS)[number];
let current: Sec = "profile";
function showSection(s: Sec, updateHash = true) {
  if (current === "security" && s !== "security") clearRecoveryCodes(); // 离开安全区块后看不到恢复码
  current = s;
  for (const k of SECTIONS) {
    const on = k === s;
    $("sec-" + k).hidden = !on;
    const t = $("tab-" + k);
    t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1;
  }
  if (updateHash && location.hash !== "#" + s) history.replaceState(null, "", "#" + s);
  setMsg("");
  if (s === "taxonomy") void loadTaxonomy();
  if (s === "weather") void loadWeatherSettings();
  if (s === "security") void loadSecurity();
}
const fromHash = (): Sec => { const h = location.hash.slice(1); return (SECTIONS as readonly string[]).includes(h) ? (h as Sec) : "profile"; };
document.querySelectorAll<HTMLButtonElement>(".st-nav [role=tab]").forEach((t) => {
  t.addEventListener("click", () => showSection(t.dataset.s as Sec));
  t.addEventListener("keydown", (e) => {
    const i = SECTIONS.indexOf(current);
    const next = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? SECTIONS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    const s = SECTIONS[(next + SECTIONS.length) % SECTIONS.length];
    showSection(s); $("tab-" + s).focus();
  });
});
window.addEventListener("hashchange", () => { const s = fromHash(); if (s !== current) showSection(s, false); });

/* ---------- 个人资料 ---------- */
const pfName = $<HTMLInputElement>("pf-name"), pfTagline = $<HTMLTextAreaElement>("pf-tagline"), pfBio = $<HTMLTextAreaElement>("pf-bio");
let facts: Fact[] = [], links: Link[] = [], avatar: string | null = null;
let pfDirty = false;

function paintAvatar() {
  const src = safeAvatar(avatar), img = $<HTMLImageElement>("pfa-img"), ini = $("pfa-ini");
  if (src) { img.src = src; img.hidden = false; ini.hidden = true; } else { img.removeAttribute("src"); img.hidden = true; ini.hidden = false; ini.textContent = initialOf(pfName.value); }
  $("avatar-remove").hidden = !src;
}
function currentProfile(): Profile {
  return { name: pfName.value.trim(), tagline: pfTagline.value.trim(), bio: pfBio.value.trim(), avatar, facts: facts.filter((f) => f.label.trim() && f.value.trim()), links: links.filter((l) => l.label.trim() && l.url.trim()) };
}
function renderPreview() {
  const p = currentProfile();
  renderIntro({ ...p, links: p.links }, { tagline: $("pv-tagline"), side: $("pv-facts"), cta: $("pv-links") });
  // 预览里的固定按钮
  const cta = $("pv-links");
  if (!cta.querySelector(".primary")) {
    const a = el("a", { class: "primary", textContent: "看简历" }); a.setAttribute("href", "#"); a.addEventListener("click", (e) => e.preventDefault());
    cta.prepend(a);
  }
  cta.querySelectorAll("a").forEach((a) => { a.addEventListener("click", (e) => e.preventDefault()); });
  if (!p.tagline) $("pv-tagline").textContent = "（一句话介绍会显示在这里）";
  paintAvatar();
}
function listRow<T extends Fact | Link>(arr: T[], i: number, keys: [keyof T & string, keyof T & string], ph: [string, string], max: [number, number], rerender: () => void): HTMLLIElement {
  const li = el("li", { class: "pf-row" });
  const a = el("input", { value: String(arr[i][keys[0]]), placeholder: ph[0], maxLength: max[0] });
  const b = el("input", { value: String(arr[i][keys[1]]), placeholder: ph[1], maxLength: max[1] });
  a.setAttribute("aria-label", ph[0]); b.setAttribute("aria-label", ph[1]);
  if (keys[1] === "url") b.spellcheck = false;
  const upd = () => { (arr[i] as any)[keys[0]] = a.value; (arr[i] as any)[keys[1]] = b.value; pfDirty = true; renderPreview(); };
  a.addEventListener("input", upd); b.addEventListener("input", upd);
  const move = (d: number) => () => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; pfDirty = true; rerender(); renderPreview(); };
  li.append(a, b, btn("↑", move(-1), "上移"), btn("↓", move(1), "下移"), btn("删除", () => { arr.splice(i, 1); pfDirty = true; rerender(); renderPreview(); }, "删除这一条"));
  return li;
}
function renderFacts() { const ul = $("facts-list"); ul.replaceChildren(...facts.map((_, i) => listRow(facts, i, ["label", "value"], ["名称", "内容"], [10, 60], renderFacts))); $<HTMLButtonElement>("fact-add").disabled = facts.length >= 6; }
function renderLinks() { const ul = $("links-list"); ul.replaceChildren(...links.map((_, i) => listRow(links, i, ["label", "url"], ["名称", "https://… 或 mailto:…"], [20, 500], renderLinks))); $<HTMLButtonElement>("link-add").disabled = links.length >= 6; }
$("fact-add").addEventListener("click", () => { if (facts.length < 6) { facts.push({ label: "", value: "" }); pfDirty = true; renderFacts(); } });
$("link-add").addEventListener("click", () => { if (links.length < 6) { links.push({ label: "", url: "" }); pfDirty = true; renderLinks(); } });
for (const i of [pfName, pfTagline, pfBio]) i.addEventListener("input", () => { pfDirty = true; renderPreview(); });

function applyProfile(p: Profile) {
  pfName.value = p.name ?? ""; pfTagline.value = p.tagline ?? ""; pfBio.value = p.bio ?? "";
  avatar = safeAvatar(p.avatar);
  facts = (Array.isArray(p.facts) ? p.facts : []).map((f) => ({ label: String(f.label), value: String(f.value) }));
  links = (Array.isArray(p.links) ? p.links : []).map((l) => ({ label: String(l.label), url: String(l.url) }));
  pfDirty = false; renderFacts(); renderLinks(); renderPreview();
}
async function loadProfile() {
  try { applyProfile(await api<Profile>("/api/private/profile")); } catch (e) { fail("读取个人资料失败", e); }
}
$("pf-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p = currentProfile();
  if (!p.name) { setMsg("请填写名字", "err"); return; }
  for (const l of p.links) {
    if (!/^(https?:\/\/|mailto:)/i.test(l.url.trim())) { setMsg(`链接「${l.label}」只支持 http、https、mailto`, "err"); return; }
  }
  const saveBtn = $<HTMLButtonElement>("pf-save"); saveBtn.disabled = true;
  try {
    const { avatar: _a, ...body } = p;
    const saved = await api<Profile>("/api/private/profile", jsonInit("PUT", body));
    applyProfile(saved); setProfileCache(saved);
    setMsg("资料已保存，公开主页会在一分钟内更新", "ok");
  } catch (err) { fail("保存失败", err); } finally { saveBtn.disabled = false; }
});
$("avatar-upload").addEventListener("click", () => $("avatar-file").click());
$<HTMLInputElement>("avatar-file").addEventListener("change", async (e) => {
  const input = e.target as HTMLInputElement, f = input.files?.[0]; input.value = "";
  if (!f) return;
  if (f.size > 10 * 1024 * 1024) { setMsg("图片超过 10 MB", "err"); return; }
  setMsg("上传中…", "ok");
  try {
    const fd = new FormData(); fd.append("file", f, f.name || "avatar");
    const r = await api<{ avatar: string }>("/api/private/profile/avatar", { method: "POST", body: fd });
    avatar = safeAvatar(r.avatar); paintAvatar();
    setProfileCache({ ...currentProfile(), avatar });
    setMsg("头像已更新", "ok");
  } catch (err) { fail("头像上传失败", err); }
});
$("avatar-remove").addEventListener("click", async () => {
  try {
    await api<void>("/api/private/profile/avatar", { method: "DELETE" });
    avatar = null; paintAvatar(); setProfileCache({ ...currentProfile(), avatar: null }); setMsg("已恢复为首字母头像", "ok");
  } catch (err) { fail("移除失败", err); }
});

/* ---------- 分类和标签 ---------- */
let cats: Cat[] = [], tagItems: TagItem[] = [];
const catList = $("cat-list"), tagList = $("tag-list");
const affected = (x: { count: number; draftCount: number }) => `${x.count + x.draftCount} 篇文章（已发布 ${x.count} 篇，草稿 ${x.draftCount} 篇）`;

async function loadTaxonomy() {
  try {
    const [c, t] = await Promise.all([api<{ items: Cat[] }>("/api/private/categories"), api<{ items: TagItem[] }>("/api/private/tags")]);
    cats = Array.isArray(c.items) ? c.items : []; tagItems = Array.isArray(t.items) ? t.items : [];
    renderCats(); renderTags();
  } catch (e) { fail("读取分类和标签失败", e); }
}
const rowMeta = (text: string) => el("span", { class: "tx-meta", textContent: text });

function renderCats() {
  catList.replaceChildren();
  if (!cats.length) { catList.append(el("li", { class: "tx-empty", textContent: "还没有分类" })); return; }
  cats.forEach((c, i) => {
    const li = el("li", { class: "tx-row" });
    const main = el("span", { class: "tx-main" }, el("span", { class: "tx-name", textContent: c.name }), rowMeta(`/${c.slug} · ${c.count + c.draftCount} 篇`));
    li.append(main,
      btn("↑", () => moveCat(i, -1), `上移 ${c.name}`), btn("↓", () => moveCat(i, 1), `下移 ${c.name}`),
      btn("改名", () => editCat(li, c), `修改 ${c.name}`), btn("删除", () => delCat(c), `删除 ${c.name}`, "btn sm danger"));
    (li.children[1] as HTMLButtonElement).disabled = i === 0;
    (li.children[2] as HTMLButtonElement).disabled = i === cats.length - 1;
    catList.append(li);
  });
}
function editCat(li: HTMLElement, c: Cat) {
  const name = el("input", { value: c.name, maxLength: 20 }), slug = el("input", { value: c.slug, maxLength: 40 });
  name.setAttribute("aria-label", "分类名称"); slug.setAttribute("aria-label", "分类 slug"); slug.spellcheck = false;
  const save = async () => {
    const body: Record<string, string> = {};
    if (name.value.trim() && name.value.trim() !== c.name) body.name = name.value.trim();
    if (slug.value.trim() && slug.value.trim() !== c.slug) body.slug = slug.value.trim();
    if (!Object.keys(body).length) { renderCats(); return; }
    try { await api(`/api/private/categories/${c.id}`, jsonInit("PUT", body)); setMsg("分类已更新", "ok"); await loadTaxonomy(); } catch (e) { fail("修改失败", e); }
  };
  li.replaceChildren(el("span", { class: "tx-main edit" }, name, slug), btn("保存", save, undefined, "btn sm primary"), btn("取消", renderCats));
  for (const i of [name, slug]) i.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } else if (e.key === "Escape") renderCats(); });
  name.focus();
}
async function delCat(c: Cat) {
  const n = c.count + c.draftCount;
  const body = n ? `有 ${affected(c)} 属于这个分类。\n删除后它们会变成「未分类」。` : "没有文章属于这个分类。";
  if (!(await confirmDialog({ title: `删除分类「${c.name}」？`, body, confirmText: "删除", danger: true }))) return;
  try { await api<void>(`/api/private/categories/${c.id}`, { method: "DELETE" }); setMsg(`已删除分类「${c.name}」`, "ok"); await loadTaxonomy(); } catch (e) { fail("删除失败", e); }
}
async function moveCat(i: number, d: number) {
  const j = i + d; if (j < 0 || j >= cats.length) return;
  const ids = cats.map((c) => c.id); [ids[i], ids[j]] = [ids[j], ids[i]];
  try { await api<void>("/api/private/categories/order", jsonInit("PUT", { ids })); await loadTaxonomy(); } catch (e) { fail("排序失败", e); }
}
$("cat-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $<HTMLInputElement>("cat-name"), slug = $<HTMLInputElement>("cat-slug");
  if (!name.value.trim()) { setMsg("请填写分类名称", "err"); return; }
  const body: Record<string, string> = { name: name.value.trim() };
  if (slug.value.trim()) body.slug = slug.value.trim();
  try { await api("/api/private/categories", jsonInit("POST", body)); name.value = ""; slug.value = ""; setMsg("已添加分类", "ok"); await loadTaxonomy(); } catch (err) { fail("添加失败", err); }
});

function renderTags() {
  tagList.replaceChildren();
  if (!tagItems.length) { tagList.append(el("li", { class: "tx-empty", textContent: "还没有标签" })); return; }
  for (const t of tagItems) {
    const li = el("li", { class: "tx-row" });
    li.append(el("span", { class: "tx-main" }, el("span", { class: "tx-name", textContent: t.name }), rowMeta(`${t.count + t.draftCount} 篇`)),
      btn("改名", () => editTag(li, t), `修改 ${t.name}`), btn("删除", () => delTag(t), `删除 ${t.name}`, "btn sm danger"));
    tagList.append(li);
  }
}
function editTag(li: HTMLElement, t: TagItem) {
  const input = el("input", { value: t.name, maxLength: 30 }); input.setAttribute("aria-label", "标签名称");
  const save = async () => {
    const to = input.value.trim();
    if (!to || to === t.name) { renderTags(); return; }
    const other = tagItems.find((x) => x.name !== t.name && x.name.toLowerCase() === to.toLowerCase());
    if (other) {
      const total = t.count + t.draftCount;
      if (!(await confirmDialog({ title: `合并标签「${t.name}」？`, body: `标签「${other.name}」已经存在。\n继续会把「${t.name}」合并进「${other.name}」：${total} 篇使用「${t.name}」的文章会改用「${other.name}」，「${t.name}」这个标签会消失。`, confirmText: "合并" }))) return;
    }
    try {
      const r = await api<{ updated: number }>("/api/private/tags/rename", jsonInit("PUT", { from: t.name, to: other ? other.name : to }));
      setMsg(`${other ? "已合并" : "已改名"}，更新了 ${r.updated ?? 0} 篇文章`, "ok"); await loadTaxonomy();
    } catch (e) { fail("修改失败", e); }
  };
  li.replaceChildren(el("span", { class: "tx-main edit" }, input), btn("保存", save, undefined, "btn sm primary"), btn("取消", renderTags));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } else if (e.key === "Escape") renderTags(); });
  input.focus();
}
async function delTag(t: TagItem) {
  const n = t.count + t.draftCount;
  const body = n ? `有 ${affected(t)} 用了这个标签。\n删除后会从这些文章里移除。` : "没有文章用这个标签。";
  if (!(await confirmDialog({ title: `删除标签「${t.name}」？`, body, confirmText: "删除", danger: true }))) return;
  try { await api<void>(`/api/private/tags/${encodeURIComponent(t.name)}`, { method: "DELETE" }); setMsg(`已删除标签「${t.name}」`, "ok"); await loadTaxonomy(); } catch (e) { fail("删除失败", e); }
}
$("tag-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $<HTMLInputElement>("tag-name");
  if (!name.value.trim()) { setMsg("请填写标签名称", "err"); return; }
  try { await api("/api/private/tags", jsonInit("POST", { name: name.value.trim() })); name.value = ""; setMsg("已添加标签", "ok"); await loadTaxonomy(); } catch (err) { fail("添加失败", err); }
});

/* ---------- 数据备份 ---------- */
const backupFileInput = $<HTMLInputElement>("bk-file");
const backupImport = $<HTMLButtonElement>("bk-import");
let backupFile: File | null = null;

const sizeText = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
function setBackupFile(file: File | null) {
  backupFile = file;
  backupImport.disabled = !file;
  $("bk-file-name").textContent = file ? `${file.name} · ${sizeText(file.size)}` : "未选择文件";
}
function backupError(prefix: string, e: unknown) {
  const detail = e instanceof ApiError && e.detail ? e.detail : explain(e);
  setMsg(`${prefix}：${detail}`, "err");
}

$("bk-download").addEventListener("click", async () => {
  const b = $<HTMLButtonElement>("bk-download");
  b.disabled = true;
  $("bk-export-state").textContent = "正在打包…";
  setMsg("正在打包…", "ok");
  try {
    const res = await apiRaw("/api/private/backup/export");
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") ?? "";
    const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "lumen-desk-backup.zip";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.rel = "noopener";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("bk-export-state").textContent = `已下载 ${name}（${sizeText(blob.size)}）`;
    setMsg("备份已开始下载", "ok");
  } catch (e) {
    $("bk-export-state").textContent = "打包失败，请重试";
    backupError("备份失败", e);
  } finally {
    b.disabled = false;
  }
});

$("bk-pick").addEventListener("click", () => backupFileInput.click());
backupFileInput.addEventListener("change", () => {
  const f = backupFileInput.files?.[0] ?? null;
  backupFileInput.value = "";
  if (!f) return;
  if (!/\.zip$/i.test(f.name)) { setMsg("请选择 .zip 备份文件", "err"); setBackupFile(null); return; }
  if (f.size > 40 * 1024 * 1024) { setMsg("备份超过 40 MB", "err"); setBackupFile(null); return; }
  setBackupFile(f);
  setMsg(`已选择 ${f.name}`, "ok");
});

backupImport.addEventListener("click", async () => {
  if (!backupFile) return;
  const ok = await confirmDialog({
    title: "导入备份并覆盖当前内容？",
    body: `文件：${backupFile.name}\n当前站点的文章、分类、标签、书签、简历、个人资料和上传图片会以备份里的内容为准。\n\n验证器、恢复码和登录状态不会改变。`,
    confirmText: "覆盖导入",
    danger: true,
  });
  if (!ok) return;
  backupImport.disabled = true;
  backupImport.textContent = "导入中…";
  setMsg("正在导入并重建文章…", "ok");
  try {
    const fd = new FormData();
    fd.append("file", backupFile, backupFile.name);
    const r = await api<{ posts: number; categories: number; tags: number; folders: number; bookmarks: number; uploads: number }>(
      "/api/private/backup/import",
      { method: "POST", body: fd },
    );
    setMsg(`已恢复 ${r.posts} 篇文章、${r.categories} 个分类、${r.tags} 个标签、${r.bookmarks} 条书签和 ${r.uploads} 张图片，页面即将刷新`, "ok");
    pfDirty = false;
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    backupError("导入失败", e);
    backupImport.disabled = false;
    backupImport.textContent = "导入并覆盖";
  }
});

/* ---------- 账号安全 ---------- */
type Security = { recoveryCodesLeft: number; sessionCount: number; currentSessionCreatedAt: string | null };
async function loadSecurity() {
  try {
    const s = await api<Security>("/api/private/security");
    $("sc-codes").textContent = String(s.recoveryCodesLeft);
    $("sc-sessions").textContent = String(s.sessionCount);
    const d = s.currentSessionCreatedAt ? new Date(s.currentSessionCreatedAt) : null;
    $("sc-since").textContent = d && !isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "—";
    $("sc-warn").hidden = !(s.recoveryCodesLeft < 3);
  } catch (e) { fail("读取账号安全信息失败", e); }
}
$("revoke-others").addEventListener("click", async () => {
  if (!(await confirmDialog({ title: "退出其他设备？", body: "除本设备以外，其他已登录的设备都会退出登录。", confirmText: "退出其他设备" }))) return;
  try { await api<void>("/api/private/security/sessions/revoke-others", { method: "POST" }); setMsg("已退出其他设备", "ok"); await loadSecurity(); } catch (e) { fail("操作失败", e); }
});
$("revoke-all").addEventListener("click", async () => {
  if (!(await confirmDialog({ title: "退出所有设备？", body: "包括当前设备在内，所有设备都会退出登录。\n之后需要重新登录。", confirmText: "全部退出", danger: true }))) return;
  try { await api<void>("/api/private/security/sessions/revoke-all", { method: "POST" }); location.href = "/login"; } catch (e) { fail("操作失败", e); }
});

// 恢复码只存在于这一个 JS 变量和 DOM 里：不写 localStorage、不进 URL、不打日志。离开区块或刷新就没了。
let codes: string[] = [];
function clearRecoveryCodes() {
  codes = [];
  $("sc-codes-list").replaceChildren();
  $("sc-codes-box").hidden = true;
  $<HTMLInputElement>("regen-code").value = "";
}
$("regen-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("regen-code"), b = $<HTMLButtonElement>("regen-btn");
  const code = input.value.replace(/\D/g, "");
  if (code.length !== 6) { setMsg("请输入 6 位验证码", "err"); return; }
  if (!(await confirmDialog({ title: "重新生成恢复码？", body: "旧的恢复码会全部作废。\n新的恢复码只显示一次，请马上保存。", confirmText: "重新生成", danger: true }))) return;
  b.disabled = true;
  try {
    const r = await api<{ codes: string[] }>("/api/private/security/recovery-codes", jsonInit("POST", { code }));
    codes = Array.isArray(r.codes) ? r.codes.map(String) : [];
    $("sc-codes-list").replaceChildren(...codes.map((c) => el("li", { textContent: c })));
    $("sc-codes-box").hidden = false; input.value = "";
    setMsg("已生成新的恢复码，只显示这一次，请马上保存", "ok");
    msgEl.className = "st-msg ok"; clearTimeout(msgTimer);
    void loadSecurity();
  } catch (err) { fail("重新生成失败", err); input.select(); } finally { b.disabled = false; }
});
$("codes-copy").addEventListener("click", async () => {
  if (!codes.length) return;
  try { await navigator.clipboard.writeText(codes.join("\n")); setMsg("已复制到剪贴板", "ok"); }
  catch { setMsg("复制失败，请手动选中复制，或点「下载 .txt」", "err"); }
});
$("codes-download").addEventListener("click", () => {
  if (!codes.length) return;
  const blob = new Blob([`拾光台 恢复码（每个只能用一次）\n\n${codes.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "lumen-desk-recovery-codes.txt";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$("rebind-btn").addEventListener("click", () => void openRebind(() => void loadSecurity()));

/* ---------- 天气位置 ---------- */
type WxMode = "ip" | "manual";
type WxSettings = { mode: WxMode; province: string; city: string; lat: number; lon: number; timezone: string };
type WxProvinceOpt = { name: string; cities: Array<{ name: string; lat: number; lon: number }> };
type WxSettingsPayload = {
  settings: WxSettings;
  detected: { province: string; city: string; lat: number; lon: number; timezone: string };
  provinces: WxProvinceOpt[];
};
type WxSearchItem = { province: string; city: string; country: string; lat: number; lon: number; timezone: string };

const wxProvSel = $<HTMLSelectElement>("wx-prov-sel");
const wxCitySel = $<HTMLSelectElement>("wx-city-sel");
const wxProvIn = $<HTMLInputElement>("wx-prov");
const wxCityIn = $<HTMLInputElement>("wx-city");
const wxLatIn = $<HTMLInputElement>("wx-lat");
const wxLonIn = $<HTMLInputElement>("wx-lon");
const wxTzIn = $<HTMLInputElement>("wx-tz");
const wxSearchQ = $<HTMLInputElement>("wx-search-q");
const wxSearchList = $("wx-search-list");
const wxModeIpBtn = $<HTMLButtonElement>("wx-mode-ip");
const wxModeManualBtn = $<HTMLButtonElement>("wx-mode-manual");

enhanceSelect(wxProvSel, { searchable: true, searchAt: 6, placeholder: "选择省份…" });
enhanceSelect(wxCitySel, { searchable: true, searchAt: 6, placeholder: "选择城市或地区…" });

let wxMode: WxMode = "ip";
let wxProvinces: WxProvinceOpt[] = [];
let wxLoaded = false;
let wxDirty = false;

function fmtCoordPair(lat: number, lon: number): string {
  const ns = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  const ew = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
  return `${ns} ${ew}`;
}

function setWxMode(mode: WxMode, markDirty = false) {
  wxMode = mode;
  wxModeIpBtn.setAttribute("aria-checked", String(mode === "ip"));
  wxModeManualBtn.setAttribute("aria-checked", String(mode === "manual"));
  $("wx-manual-box").hidden = mode !== "manual";
  if (markDirty) wxDirty = true;
  updateWxPreview();
}

function updateWxPreview() {
  const label = formatProvinceCity(wxProvIn.value, wxCityIn.value);
  const lat = Number(wxLatIn.value.trim());
  const lon = Number(wxLonIn.value.trim());
  const coord = Number.isFinite(lat) && Number.isFinite(lon) ? ` · ${fmtCoordPair(lat, lon)}` : "";
  $("wx-preview-line").textContent = label ? `控制台将显示：${label}${coord}` : "请填写城市名称与经纬度";
}

function syncProvinceDropdowns(provName: string, cityName: string) {
  if (!wxProvinces.length) return;
  wxProvSel.replaceChildren(
    el("option", { value: "", textContent: "— 选择国内省份 —" }),
    ...wxProvinces.map((p) => el("option", { value: p.name, textContent: p.name })),
  );
  const matchedProv = wxProvinces.find((p) => p.name === provName);
  wxProvSel.value = matchedProv ? matchedProv.name : "";
  populateCitiesForProvince(matchedProv?.name ?? "", cityName);
}

function populateCitiesForProvince(provName: string, preferredCity = "") {
  const p = wxProvinces.find((x) => x.name === provName);
  if (!p) {
    wxCitySel.replaceChildren(el("option", { value: "", textContent: "请先选择省份" }));
    wxCitySel.value = "";
    wxCitySel.disabled = true;
    return;
  }
  wxCitySel.disabled = false;
  wxCitySel.replaceChildren(
    ...p.cities.map((c) => {
      const opt = el("option", { value: c.name, textContent: c.name });
      opt.dataset.sub = fmtCoordPair(c.lat, c.lon);
      return opt;
    }),
  );
  const hit = p.cities.find((c) => c.name === preferredCity) ?? p.cities[0];
  if (hit) wxCitySel.value = hit.name;
}

wxProvSel.addEventListener("change", () => {
  const pName = wxProvSel.value;
  const p = wxProvinces.find((x) => x.name === pName);
  if (!p) return;
  populateCitiesForProvince(pName);
  const c = p.cities.find((x) => x.name === wxCitySel.value) ?? p.cities[0];
  if (c) {
    wxProvIn.value = p.name;
    wxCityIn.value = c.name;
    wxLatIn.value = String(c.lat);
    wxLonIn.value = String(c.lon);
    wxTzIn.value = "Asia/Shanghai";
    wxDirty = true;
    updateWxPreview();
  }
});

wxCitySel.addEventListener("change", () => {
  const p = wxProvinces.find((x) => x.name === wxProvSel.value);
  const c = p?.cities.find((x) => x.name === wxCitySel.value);
  if (!p || !c) return;
  wxProvIn.value = p.name;
  wxCityIn.value = c.name;
  wxLatIn.value = String(c.lat);
  wxLonIn.value = String(c.lon);
  wxTzIn.value = "Asia/Shanghai";
  wxDirty = true;
  updateWxPreview();
});

for (const b of [wxModeIpBtn, wxModeManualBtn]) {
  b.addEventListener("click", () => setWxMode(b.dataset.mode as WxMode, true));
}

for (const inp of [wxProvIn, wxCityIn, wxLatIn, wxLonIn, wxTzIn]) {
  inp.addEventListener("input", () => { wxDirty = true; updateWxPreview(); });
}

async function loadWeatherSettings(refreshIp = false) {
  if (wxLoaded && !refreshIp) return;
  const redetectBtn = $<HTMLButtonElement>("wx-redetect");
  if (refreshIp) {
    redetectBtn.disabled = true;
    $("wx-detected").textContent = "正在重新识别…";
  }
  try {
    const url = refreshIp ? "/api/private/weather/settings?refreshIp=1" : "/api/private/weather/settings";
    const data = await api<WxSettingsPayload>(url);
    wxProvinces = Array.isArray(data.provinces) ? data.provinces : [];
    const det = data.detected;
    const detLabel = formatProvinceCity(det.province, det.city);
    $("wx-detected").textContent = `${detLabel}（${fmtCoordPair(det.lat, det.lon)}）`;

    if (!wxLoaded) {
      const s = data.settings;
      wxProvIn.value = s.province || "";
      wxCityIn.value = s.city || "";
      wxLatIn.value = String(s.lat);
      wxLonIn.value = String(s.lon);
      wxTzIn.value = s.timezone || "Asia/Shanghai";
      syncProvinceDropdowns(s.province, s.city);
      setWxMode(s.mode, false);
      wxLoaded = true;
      wxDirty = false;
    } else if (refreshIp) {
      setMsg(`已更新 IP 识别结果：${detLabel}`, "ok");
    }
  } catch (e) {
    $("wx-detected").textContent = "识别失败";
    fail("读取天气设置失败", e);
  } finally {
    redetectBtn.disabled = false;
  }
}

$("wx-redetect").addEventListener("click", () => void loadWeatherSettings(true));

async function runWeatherSearch() {
  const q = wxSearchQ.value.trim();
  if (!q) { wxSearchList.hidden = true; return; }
  const searchBtn = $<HTMLButtonElement>("wx-search-btn");
  searchBtn.disabled = true;
  try {
    const { results } = await api<{ results: WxSearchItem[] }>(`/api/private/weather/search?q=${encodeURIComponent(q)}`);
    wxSearchList.replaceChildren();
    wxSearchList.hidden = false;
    if (!results.length) {
      wxSearchList.append(el("li", { class: "wx-sempty", textContent: "未找到匹配城市，可直接手动填写下方名称与经纬度" }));
      return;
    }
    for (const item of results) {
      const label = formatProvinceCity(item.province, item.city);
      const rowBtn = el(
        "button",
        { type: "button", class: "wx-sitem" },
        el("span", { textContent: label }),
        el("span", { class: "wx-sitem-c", textContent: `${fmtCoordPair(item.lat, item.lon)} · ${item.timezone}` }),
      );
      rowBtn.addEventListener("click", () => {
        wxProvIn.value = item.province;
        wxCityIn.value = item.city;
        wxLatIn.value = String(item.lat);
        wxLonIn.value = String(item.lon);
        wxTzIn.value = item.timezone || "Asia/Shanghai";
        syncProvinceDropdowns(item.province, item.city);
        wxSearchList.hidden = true;
        wxDirty = true;
        updateWxPreview();
      });
      wxSearchList.append(el("li", {}, rowBtn));
    }
  } catch (e) {
    fail("搜索城市失败", e);
  } finally {
    searchBtn.disabled = false;
  }
}

$("wx-search-btn").addEventListener("click", () => void runWeatherSearch());
wxSearchQ.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); void runWeatherSearch(); }
});

$("wx-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const saveBtn = $<HTMLButtonElement>("wx-save");
  const body: Record<string, unknown> = { mode: wxMode };
  if (wxMode === "manual") {
    const city = wxCityIn.value.trim();
    const lat = Number(wxLatIn.value.trim());
    const lon = Number(wxLonIn.value.trim());
    if (!city) { setMsg("请填写城市名称", "err"); wxCityIn.focus(); return; }
    if (!wxLatIn.value.trim() || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      setMsg("纬度需在 -90 到 90 之间", "err"); wxLatIn.focus(); return;
    }
    if (!wxLonIn.value.trim() || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      setMsg("经度需在 -180 到 180 之间", "err"); wxLonIn.focus(); return;
    }
    body.province = wxProvIn.value.trim();
    body.city = city;
    body.lat = lat;
    body.lon = lon;
    body.timezone = wxTzIn.value.trim() || "Asia/Shanghai";
  }
  saveBtn.disabled = true;
  try {
    const r = await api<{ settings: WxSettings }>("/api/private/weather/settings", jsonInit("PUT", body));
    wxDirty = false;
    const s = r.settings;
    setMsg(
      s.mode === "ip"
        ? "已切换为按访问 IP 自动定位"
        : `天气位置已保存为：${formatProvinceCity(s.province, s.city)}`,
      "ok",
    );
  } catch (err) {
    fail("保存天气设置失败", err);
  } finally {
    saveBtn.disabled = false;
  }
});

/* ---------- 离开提醒、启动 ---------- */
window.addEventListener("beforeunload", (e) => { if (pfDirty || wxDirty) { e.preventDefault(); e.returnValue = ""; } });
void loadProfile();
showSection(fromHash(), false);
