// 控制台编辑器 /console/write。原生 TS，不引入框架。
// 接口约定见 docs/contracts/blog-api.md 第 3 节。
import { MAX_MD_BYTES, parseMdFile } from "./mdfile";
import { $, api, ApiError, esc, explain as explainBase, jsonInit } from "./common";
import "./topbar";

type Status = "draft" | "published";
type ListItem = { id: number; slug: string; title: string; status: Status; tags: string[]; publishedAt: string | null; updatedAt: string };
type Post = { id: number; slug: string; title: string; summary: string; tags: string[]; markdown: string; status: Status; publishedAt: string | null; categoryId?: number | null; category?: { slug: string; name: string } | null };
type Cat = { id: number; slug: string; name: string };

const ERR_OVERRIDES: Record<string, string> = {
  invalid_request: "内容不符合要求，请检查标题、slug、分类和标签",
  not_found: "文章不存在，可能已被删除",
};
const explain = (e: unknown) => explainBase(e, ERR_OVERRIDES);

/* ---------- 元素与状态 ---------- */
const ed = $("ed"), msgEl = $("ed-msg"), stateEl = $("ed-state"), pvState = $("pv-state"), previewEl = $("preview"), saveLabel = $("save-label");
const fTitle = $<HTMLInputElement>("f-title"), fSlug = $<HTMLInputElement>("f-slug"), fStatus = $<HTMLSelectElement>("f-status"),
  fPub = $<HTMLInputElement>("f-published"), fTags = $<HTMLInputElement>("f-tags"), fCat = $<HTMLSelectElement>("f-category"), fNewCat = $<HTMLInputElement>("f-newcat"), newCatRow = $("newcat-row"), fSummary = $<HTMLTextAreaElement>("f-summary"), fMd = $<HTMLTextAreaElement>("f-md");
const form = $<HTMLFormElement>("pane-edit"), saveBtn = $<HTMLButtonElement>("save-btn"), delBtn = $<HTMLButtonElement>("delete-btn");
const importBtn = $<HTMLButtonElement>("import-btn"), importFile = $<HTMLInputElement>("import-file"), dropEl = $("drop"), openSel = $<HTMLSelectElement>("open-select");

let currentId: number | null = null;
let dirty = false;
let busy = false;

function setMsg(text: string, kind: "" | "err" | "ok" = "") { msgEl.textContent = text; msgEl.className = "ed-msg " + kind; }
function setDirty(v: boolean) {
  dirty = v;
  stateEl.classList.toggle("dirty", v);
}
function setState() {
  stateEl.textContent = currentId === null ? "新文章" : `文章 #${currentId}`;
  delBtn.hidden = currentId === null;
  openSel.value = currentId === null ? "" : String(currentId);
}
function updateSaveLabel() { saveLabel.textContent = fStatus.value === "published" ? "发布" : "保存草稿"; }
fStatus.addEventListener("change", updateSaveLabel);

/* ---------- 时间转换 ---------- */
const pad = (n: number) => String(n).padStart(2, "0");
function dateToLocal(d: Date): string {
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function isoToLocal(iso: string | null): string { return iso ? dateToLocal(new Date(iso)) : ""; }
function localToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}
const dayOf = (iso: string | null) => (iso ? isoToLocal(iso).slice(0, 10) : "");

/* ---------- 表单 <-> 数据 ---------- */
/** 新文章默认：发布，发布时间为当前分钟。已有文章保持自己的状态和时间。 */
function fill(p: Post | null) {
  currentId = p ? p.id : null;
  fTitle.value = p?.title ?? "";
  fSlug.value = p?.slug ?? "";
  fStatus.value = p?.status ?? "published";
  fPub.value = p ? isoToLocal(p.publishedAt) : dateToLocal(new Date());
  setTags(p?.tags ?? []);
  fTags.value = "";
  setCategory(p ? (p.categoryId ?? p.category?.name ?? null) : null);
  fSummary.value = p?.summary ?? "";
  fMd.value = p?.markdown ?? "";
  setDirty(false);
  setState();
  updateSaveLabel();
  setMsg("");
  schedulePreview(true);
}
function collect() {
  commitTagInput();
  const body: Record<string, unknown> = {
    title: fTitle.value.trim(), summary: fSummary.value.trim(), tags: [...tags], markdown: fMd.value, status: fStatus.value,
  };
  const slug = fSlug.value.trim();
  if (slug) body.slug = slug;
  const pub = localToIso(fPub.value);
  if (pub) body.publishedAt = pub;
  if (fCat.value === NEW_CAT) { const n = fNewCat.value.trim(); if (n) body.category = n; else body.categoryId = null; }
  else body.categoryId = fCat.value ? Number(fCat.value) : null;
  return body;
}
function validate(b: Record<string, unknown>): string | null {
  if (!b.title) return "请填写标题";
  if (b.slug && !/^[a-z0-9-]{1,80}$/.test(String(b.slug))) return "slug 只能用小写字母、数字和短横线，最长 80 个字符";
  const tags = b.tags as string[];
  if (tags.length > 10) return "标签最多 10 个";
  if (tags.some((t) => [...t].length > 30)) return "每个标签最多 30 个字";
  if (fCat.value === NEW_CAT && !fNewCat.value.trim()) return "请填写新分类的名称，或改选其他分类";
  if (fCat.value === NEW_CAT && [...fNewCat.value.trim()].length > 20) return "分类名称最多 20 个字";
  return null;
}

/* ---------- 分类 ---------- */
const NEW_CAT = "__new";
let cats: Cat[] = [];
async function loadCategories() {
  try {
    const d = await api<{ items: Cat[] }>("/api/private/categories");
    cats = Array.isArray(d.items) ? d.items : [];
  } catch { cats = []; }
  renderCategoryOptions();
}
function renderCategoryOptions(selected?: string) {
  const keep = selected ?? fCat.value;
  fCat.replaceChildren();
  const add = (v: string, t: string) => { const o = document.createElement("option"); o.value = v; o.textContent = t; fCat.append(o); };
  add("", "未分类");
  for (const c of cats) add(String(c.id), c.name); // 名称只用 textContent
  add(NEW_CAT, "+ 新分类…");
  fCat.value = [...fCat.options].some((o) => o.value === keep) ? keep : "";
  syncNewCat();
}
function syncNewCat() {
  const on = fCat.value === NEW_CAT;
  newCatRow.hidden = !on;
}
/** v: 分类 id、分类名（导入或保存后返回）或 null。名字对不上时返回 false。 */
function setCategory(v: number | string | null): boolean {
  fNewCat.value = "";
  if (v === null || v === "") { renderCategoryOptions(""); return true; }
  const c = typeof v === "number" ? cats.find((x) => x.id === v) : cats.find((x) => x.name === v);
  if (c) { renderCategoryOptions(String(c.id)); return true; }
  renderCategoryOptions("");
  return false;
}
fCat.addEventListener("change", () => {
  syncNewCat();
  if (fCat.value === NEW_CAT) fNewCat.focus();
  setDirty(true);
});
$("newcat-cancel").addEventListener("click", () => { fNewCat.value = ""; renderCategoryOptions(""); fCat.focus(); });
fNewCat.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); } });

/* ---------- 标签：小块 + 自动补全 ---------- */
let tags: string[] = [];
let vocab: string[] = [];
const chipsEl = $("tag-chips"), suggestEl = $("tag-suggest"), tagBox = $("tagbox");
async function loadVocab() {
  try {
    const d = await api<{ items: { name: string }[] }>("/api/private/tags");
    vocab = (Array.isArray(d.items) ? d.items : []).map((x) => String(x.name));
  } catch { vocab = []; }
}
function renderChips() {
  chipsEl.replaceChildren();
  tags.forEach((t, i) => {
    const c = document.createElement("span"); c.className = "tag-chip";
    const label = document.createElement("span"); label.textContent = t; // 用 textContent，不拼 HTML
    const x = document.createElement("button"); x.type = "button"; x.className = "tag-x"; x.textContent = "×"; x.setAttribute("aria-label", `删除标签 ${t}`);
    x.addEventListener("click", () => { tags.splice(i, 1); renderChips(); setDirty(true); fTags.focus(); });
    c.append(label, x); chipsEl.append(c);
  });
}
function setTags(list: string[]) { tags = []; for (const t of list) addTag(t, false); renderChips(); }
function addTag(raw: string, render = true): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) return false;
  tags.push(t);
  if (render) { renderChips(); setDirty(true); }
  return true;
}
/** 把输入框里还没变成小块的文字也算进去（保存前调用）。 */
function commitTagInput() {
  for (const part of fTags.value.split(/[,，]/)) addTag(part);
  fTags.value = ""; closeSuggest();
}
let sugg: string[] = [], suggIdx = -1;
function closeSuggest() { suggestEl.hidden = true; suggestEl.replaceChildren(); sugg = []; suggIdx = -1; fTags.setAttribute("aria-expanded", "false"); fTags.removeAttribute("aria-activedescendant"); }
function renderSuggest() {
  const q = fTags.value.trim().toLowerCase();
  sugg = vocab.filter((n) => !tags.some((t) => t.toLowerCase() === n.toLowerCase()) && (!q || n.toLowerCase().includes(q))).slice(0, 8);
  suggestEl.replaceChildren();
  if (!sugg.length) { closeSuggest(); return; }
  sugg.forEach((n, i) => {
    const li = document.createElement("li"); li.id = "tag-opt-" + i; li.setAttribute("role", "option"); li.textContent = n;
    li.setAttribute("aria-selected", String(i === suggIdx));
    li.addEventListener("pointerdown", (e) => { e.preventDefault(); addTag(n); fTags.value = ""; closeSuggest(); fTags.focus(); });
    suggestEl.append(li);
  });
  suggestEl.hidden = false; fTags.setAttribute("aria-expanded", "true");
  if (suggIdx >= 0) fTags.setAttribute("aria-activedescendant", "tag-opt-" + suggIdx); else fTags.removeAttribute("aria-activedescendant");
}
fTags.addEventListener("input", () => {
  const v = fTags.value;
  if (/[,，]/.test(v)) { const parts = v.split(/[,，]/); const rest = parts.pop() ?? ""; parts.forEach((p) => addTag(p)); fTags.value = rest; }
  suggIdx = -1; renderSuggest();
});
fTags.addEventListener("focus", () => { renderSuggest(); });
fTags.addEventListener("blur", () => { setTimeout(closeSuggest, 120); const v = fTags.value.trim(); if (v) { addTag(v); fTags.value = ""; } });
fTags.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); if (suggestEl.hidden) renderSuggest(); if (sugg.length) { suggIdx = (suggIdx + 1) % sugg.length; renderSuggest(); } }
  else if (e.key === "ArrowUp") { e.preventDefault(); if (sugg.length) { suggIdx = (suggIdx - 1 + sugg.length) % sugg.length; renderSuggest(); } }
  else if (e.key === "Enter") {
    e.preventDefault();
    if (suggIdx >= 0 && sugg[suggIdx]) addTag(sugg[suggIdx]); else addTag(fTags.value);
    fTags.value = ""; closeSuggest();
  }
  else if (e.key === "Escape") { if (!suggestEl.hidden) { e.preventDefault(); e.stopPropagation(); closeSuggest(); } }
  else if (e.key === "Backspace" && !fTags.value && tags.length) { tags.pop(); renderChips(); setDirty(true); }
});
tagBox.addEventListener("click", (e) => { if (e.target === tagBox || e.target === chipsEl) fTags.focus(); });

/* ---------- 打开已有文章（下拉框） ---------- */
// 标题来自数据库，只用 textContent 写入，不拼 HTML。
async function loadList() {
  try {
    const data = await api<{ items: ListItem[] }>("/api/private/posts");
    const items = Array.isArray(data.items) ? data.items : [];
    openSel.replaceChildren();
    const first = document.createElement("option");
    first.value = ""; first.textContent = "打开已有文章…";
    openSel.append(first);
    for (const x of items) {
      const o = document.createElement("option");
      o.value = String(x.id);
      o.textContent = `${x.title || "（无标题）"}（${x.status === "published" ? "已发布" : "草稿"}）`;
      openSel.append(o);
    }
    openSel.value = currentId === null ? "" : String(currentId);
  } catch (e) {
    openSel.options[0].textContent = "打开已有文章…（列表加载失败）";
    setMsg("文章列表加载失败：" + explain(e), "err");
  }
}
const confirmDiscard = () => !dirty || confirm("有未保存的修改，确定放弃吗？");

openSel.addEventListener("change", async () => {
  const id = Number(openSel.value);
  if (!openSel.value || !Number.isInteger(id)) { openSel.value = currentId === null ? "" : String(currentId); return; }
  if (id === currentId) return;
  if (!confirmDiscard()) { openSel.value = currentId === null ? "" : String(currentId); return; }
  setMsg("加载中…", "ok");
  try {
    fill(await api<Post>(`/api/private/posts/${id}`));
  } catch (err) {
    setMsg("打开失败：" + explain(err), "err");
    openSel.value = currentId === null ? "" : String(currentId);
  }
});
$("new-post").addEventListener("click", () => {
  if (!confirmDiscard()) return;
  fill(null);
  fTitle.focus();
});

/* ---------- 保存 / 删除 ---------- */
async function save() {
  if (busy) return;
  const body = collect();
  const bad = validate(body);
  if (bad) { setMsg(bad, "err"); return; }
  busy = true; saveBtn.disabled = true; setMsg("保存中…", "ok");
  try {
    const p = currentId === null
      ? await api<Post>("/api/private/posts", jsonInit("POST", body))
      : await api<Post>(`/api/private/posts/${currentId}`, jsonInit("PUT", body));
    // 以服务器返回为准（slug、发布时间可能被补全）；返回里没有 markdown 时保留编辑器里的文本。
    const keepMd = fMd.value;
    fill({ ...p, markdown: typeof p.markdown === "string" ? p.markdown : keepMd });
    setMsg(p.status === "published" ? "已发布" : "已保存为草稿", "ok");
    await Promise.all([loadList(), loadCategories(), loadVocab()]);
    setCategory(p.categoryId ?? p.category?.name ?? null);
  } catch (e) { setMsg("保存失败：" + explain(e), "err"); }
  finally { busy = false; saveBtn.disabled = false; }
}
saveBtn.addEventListener("click", () => { void save(); });
form.addEventListener("submit", (e) => { e.preventDefault(); void save(); });
delBtn.addEventListener("click", async () => {
  if (currentId === null || busy) return;
  if (!confirm(`确定删除「${fTitle.value.trim() || "这篇文章"}」吗？删除后无法恢复。`)) return;
  busy = true;
  try {
    await api<void>(`/api/private/posts/${currentId}`, { method: "DELETE" });
    fill(null);
    setMsg("已删除", "ok");
    await loadList();
  } catch (e) { setMsg("删除失败：" + explain(e), "err"); }
  finally { busy = false; }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
});

/* ---------- 未保存提示 ---------- */
form.addEventListener("input", () => { setDirty(true); });
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- 预览 ---------- */
let pvTimer = 0, pvSeq = 0, pvStale = true;
function schedulePreview(immediate = false) {
  clearTimeout(pvTimer);
  pvStale = true;
  pvTimer = window.setTimeout(renderPreview, immediate ? 0 : 400);
}
async function renderPreview() {
  const seq = ++pvSeq;
  if (!fMd.value.trim()) { previewEl.innerHTML = `<p class="ed-note">预览会显示在这里。</p>`; pvState.textContent = ""; pvStale = false; return; }
  pvState.textContent = "渲染中…";
  try {
    const { html } = await api<{ html: string }>("/api/private/preview", jsonInit("POST", { markdown: fMd.value }));
    if (seq !== pvSeq) return; // 已有更新的请求
    previewEl.innerHTML = html; // 服务端已用白名单过滤，不含脚本
    pvState.textContent = "";
    pvStale = false;
  } catch (e) {
    if (seq !== pvSeq) return;
    pvState.textContent = "预览失败：" + explain(e);
  }
}
fMd.addEventListener("input", () => schedulePreview());

/* ---------- 窄屏标签页 ---------- */
document.querySelectorAll<HTMLButtonElement>(".ed-tabs button").forEach((b) => b.addEventListener("click", () => {
  const t = b.dataset.t!;
  ed.dataset.tab = t;
  document.querySelectorAll(".ed-tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  if (t === "preview" && pvStale) schedulePreview(true);
}));

/* ---------- 图片 ---------- */
const IMG_RE = /^image\/(jpeg|png|webp|gif|avif)$/;
function insertAtCursor(text: string) {
  const s = fMd.selectionStart ?? fMd.value.length, en = fMd.selectionEnd ?? s;
  fMd.setRangeText(text, s, en, "end");
  fMd.dispatchEvent(new Event("input", { bubbles: true }));
}
async function uploadImages(files: File[]) {
  for (const f of files) {
    if (f.size > 10 * 1024 * 1024) { setMsg(`${f.name || "图片"} 超过 10 MB`, "err"); continue; }
    setMsg(`上传 ${f.name || "图片"}…`, "ok");
    try {
      const fd = new FormData();
      fd.append("file", f, f.name || "image");
      const r = await api<{ url: string }>("/api/private/uploads", { method: "POST", body: fd });
      if (typeof r.url !== "string" || !/^\/uploads\/[A-Za-z0-9._-]+$/.test(r.url)) throw new ApiError(0, "invalid_request");
      insertAtCursor(`![](${r.url})\n`);
      setMsg("图片已上传", "ok");
    } catch (e) { setMsg("图片上传失败：" + explain(e), "err"); }
  }
}
fMd.addEventListener("paste", (e) => {
  const imgs = [...(e.clipboardData?.files ?? [])].filter((f) => IMG_RE.test(f.type));
  if (!imgs.length) return;
  e.preventDefault();
  void uploadImages(imgs);
});
fMd.addEventListener("drop", (e) => {
  const imgs = [...(e.dataTransfer?.files ?? [])].filter((f) => IMG_RE.test(f.type));
  if (!imgs.length) return; // 非图片交给页面级的导入处理
  e.preventDefault(); e.stopPropagation();
  dropDepth = 0; dropEl.hidden = true;
  void uploadImages(imgs);
});

/* ---------- 打开 .md：在浏览器里读取，填进编辑器，不入库 ---------- */
const isMd = (f: File) => /\.(md|markdown)$/i.test(f.name);
async function openMdFiles(files: File[]) {
  const md = files.filter(isMd);
  if (!md.length) { setMsg("只能打开 .md 文件", "err"); return; }
  const file = md[0];
  if (file.size > MAX_MD_BYTES) { setMsg(`${file.name} 超过 1 MB，没有打开`, "err"); return; }
  if (!confirmDiscard()) return;
  let text: string;
  try { text = await file.text(); } catch { setMsg(`读取 ${file.name} 失败`, "err"); return; }
  const r = parseMdFile(text, file.name, new Date());
  fill(null);
  fTitle.value = r.title;
  fSlug.value = r.slug;
  fStatus.value = r.status;
  fPub.value = dateToLocal(r.publishedAt);
  setTags(r.tags);
  fTags.value = "";
  fSummary.value = r.summary;
  fMd.value = r.markdown;
  updateSaveLabel();
  setDirty(true);
  schedulePreview(true);
  const parts: string[] = [];
  if (md.length > 1 || files.length > md.length) parts.push(`一次只能导入一篇，已打开 ${file.name}`);
  else parts.push(`已导入 ${file.name}`);
  parts.push(r.status === "published" ? "检查后点发布" : "检查后点保存草稿");
  if (r.category) {
    if (!setCategory(r.category)) {
      renderCategoryOptions(NEW_CAT); fNewCat.value = r.category;
      r.warnings.push(`保存时会新建分类 ${r.category}`);
    }
  }
  const warn = r.warnings.length ? "。" + r.warnings.join("；") : "";
  setMsg(parts.join("，") + warn, r.warnings.length ? "err" : "ok");
  fTitle.focus();
}
importBtn.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", () => { const fs = [...(importFile.files ?? [])]; importFile.value = ""; if (fs.length) void openMdFiles(fs); });

/* 页面级拖放：文件拖进页面显示遮罩，松开后打开 .md；图片拖在文本框上由上面的处理接管 */
let dropDepth = 0;
const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
const hasImage = (e: DragEvent) => [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file" && IMG_RE.test(i.type));
window.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dropDepth++; if (!hasImage(e)) dropEl.hidden = false; });
window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; dropDepth = Math.max(0, dropDepth - 1); if (!dropDepth) dropEl.hidden = true; });
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dropDepth = 0; dropEl.hidden = true;
  const files = [...(e.dataTransfer?.files ?? [])];
  if (!files.length) return;
  const imgs = files.filter((f) => IMG_RE.test(f.type));
  if (imgs.length === files.length) { setMsg("请把图片拖进正文文本框", "err"); return; }
  void openMdFiles(files.filter((f) => !IMG_RE.test(f.type)));
});

/* ---------- 启动 ---------- */
fill(null);
void loadList();
void loadCategories().then(() => { if (currentId === null && !dirty) setCategory(null); });
void loadVocab();
