// 设置页 /console/settings。原生 TS。接口约定见 docs/contracts/taxonomy-profile.md。
// 所有用户文本只用 textContent 写入，不拼 HTML。
import { $, api, ApiError, explain, initialOf, jsonInit, safeAvatar } from "./common";
import { setProfileCache, type Fact, type Link, type Profile } from "./topbar";
import { renderIntro } from "../intro-render";
import { confirmDialog } from "../ui/dialog";
import { toast } from "../ui/toast";

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
const SECTIONS = ["profile", "taxonomy", "security"] as const;
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

/* ---------- 离开提醒、启动 ---------- */
window.addEventListener("beforeunload", (e) => { if (pfDirty) { e.preventDefault(); e.returnValue = ""; } });
void loadProfile();
showSection(fromHash(), false);
