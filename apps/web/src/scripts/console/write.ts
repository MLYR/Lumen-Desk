// 控制台编辑器 /console/write。原生 TS，不引入框架。
// 接口约定见 docs/contracts/blog-api.md 第 3 节。
type Status = "draft" | "published";
type ListItem = { id: number; slug: string; title: string; status: Status; tags: string[]; publishedAt: string | null; updatedAt: string };
type Post = { id: number; slug: string; title: string; summary: string; tags: string[]; markdown: string; status: Status; publishedAt: string | null };
type ImportResult = { imported?: { id: number; slug: string; title: string; status: Status }[]; errors?: { file: string; error: string }[] };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const ERRORS: Record<string, string> = {
  invalid_request: "内容不符合要求，请检查标题、slug 和标签",
  slug_taken: "这个 slug 已被占用",
  not_found: "文章不存在，可能已被删除",
  payload_too_large: "内容太大，超过了上限",
  unsupported_media_type: "不支持这种文件格式",
  bad_origin: "请求来源不被允许，请从站点本身打开此页面",
  unauthorized: "登录已失效，请重新登录",
  rate_limited: "请求太频繁，请稍后再试",
};
const errText = (code: string, message?: string) => ERRORS[code] || (message ? message : `出错了（${code}）`);

class ApiError extends Error {
  constructor(public status: number, public code: string, public detail?: string) { super(code); }
}

/** 所有接口都走这里：401 直接跳登录；其余错误抛 ApiError。 */
async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, "network");
  }
  if (res.status === 401) {
    location.href = "/login";
    throw new ApiError(401, "unauthorized");
  }
  if (!res.ok) {
    let code = "http_" + res.status, detail: string | undefined;
    try { const j = await res.json(); if (j && typeof j.error === "string") code = j.error; if (j && typeof j.message === "string") detail = j.message; } catch {}
    throw new ApiError(res.status, code, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
const explain = (e: unknown) => (e instanceof ApiError ? (e.code === "network" ? "网络错误，请重试" : errText(e.code, e.detail)) : "出错了，请重试");
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/* ---------- 元素与状态 ---------- */
const ed = $("ed"), listEl = $("post-list"), msgEl = $("ed-msg"), stateEl = $("ed-state"), pvState = $("pv-state"), previewEl = $("preview");
const fTitle = $<HTMLInputElement>("f-title"), fSlug = $<HTMLInputElement>("f-slug"), fStatus = $<HTMLSelectElement>("f-status"),
  fPub = $<HTMLInputElement>("f-published"), fTags = $<HTMLInputElement>("f-tags"), fSummary = $<HTMLTextAreaElement>("f-summary"), fMd = $<HTMLTextAreaElement>("f-md");
const form = $<HTMLFormElement>("pane-edit"), saveBtn = $<HTMLButtonElement>("save-btn"), delBtn = $<HTMLButtonElement>("delete-btn");
const importBtn = $<HTMLButtonElement>("import-btn"), importFile = $<HTMLInputElement>("import-file"), importResult = $("import-result"), dropEl = $("drop");

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
}

/* ---------- 时间转换 ---------- */
const pad = (n: number) => String(n).padStart(2, "0");
function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}
const dayOf = (iso: string | null) => (iso ? isoToLocal(iso).slice(0, 10) : "");

/* ---------- 表单 <-> 数据 ---------- */
function fill(p: Post | null) {
  currentId = p ? p.id : null;
  fTitle.value = p?.title ?? "";
  fSlug.value = p?.slug ?? "";
  fStatus.value = p?.status ?? "draft";
  fPub.value = isoToLocal(p?.publishedAt ?? null);
  fTags.value = (p?.tags ?? []).join(", ");
  fSummary.value = p?.summary ?? "";
  fMd.value = p?.markdown ?? "";
  setDirty(false);
  setState();
  setMsg("");
  schedulePreview(true);
}
function collect() {
  const tags = fTags.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
  const body: Record<string, unknown> = {
    title: fTitle.value.trim(), summary: fSummary.value.trim(), tags, markdown: fMd.value, status: fStatus.value,
  };
  const slug = fSlug.value.trim();
  if (slug) body.slug = slug;
  const pub = localToIso(fPub.value);
  if (pub) body.publishedAt = pub;
  return body;
}
function validate(b: Record<string, unknown>): string | null {
  if (!b.title) return "请填写标题";
  if (b.slug && !/^[a-z0-9-]{1,80}$/.test(String(b.slug))) return "slug 只能用小写字母、数字和短横线，最长 80 个字符";
  const tags = b.tags as string[];
  if (tags.length > 10) return "标签最多 10 个";
  if (tags.some((t) => [...t].length > 30)) return "每个标签最多 30 个字";
  return null;
}

/* ---------- 列表 ---------- */
async function loadList() {
  try {
    const data = await api<{ items: ListItem[] }>("/api/private/posts");
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) { listEl.innerHTML = `<li class="ed-note">还没有文章，点「新文章」开始写。</li>`; return; }
    listEl.innerHTML = items.map((x) =>
      `<li><button type="button" data-id="${esc(x.id)}" ${x.id === currentId ? 'aria-current="true"' : ""}>` +
      `<span class="ttl">${esc(x.title || "（无标题）")}</span>` +
      `<span class="sub"><span class="${x.status === "published" ? "st-pub" : ""}">${x.status === "published" ? "已发布" : "草稿"}</span><span>${esc(dayOf(x.updatedAt))}</span></span></button></li>`).join("");
  } catch (e) {
    listEl.innerHTML = `<li class="ed-note">${esc("列表加载失败：" + explain(e))}</li>`;
  }
}
const confirmDiscard = () => !dirty || confirm("有未保存的修改，确定放弃吗？");

listEl.addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest("button[data-id]") as HTMLButtonElement | null;
  if (!b) return;
  const id = Number(b.dataset.id);
  if (id === currentId || !confirmDiscard()) return;
  setMsg("加载中…", "ok");
  try {
    fill(await api<Post>(`/api/private/posts/${id}`));
    await loadList();
  } catch (err) { setMsg("打开失败：" + explain(err), "err"); }
});
$("new-post").addEventListener("click", () => {
  if (!confirmDiscard()) return;
  fill(null);
  void loadList();
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
    setMsg(p.status === "published" ? "已保存并发布" : "已保存为草稿", "ok");
    await loadList();
  } catch (e) { setMsg("保存失败：" + explain(e), "err"); }
  finally { busy = false; saveBtn.disabled = false; }
}
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

/* ---------- 导入 .md ---------- */
async function importFiles(files: File[]) {
  const md = files.filter((f) => /\.(md|markdown)$/i.test(f.name));
  const skipped = files.length - md.length;
  if (!md.length) { showImport([], [{ file: files[0]?.name ?? "", error: "unsupported_media_type" }]); return; }
  if (md.length > 20) { showImport([], [{ file: `共 ${md.length} 个文件`, error: "invalid_request" }]); return; }
  importBtn.disabled = true;
  importResult.hidden = false; importResult.textContent = "导入中…";
  try {
    const fd = new FormData();
    md.forEach((f) => fd.append("files", f, f.name));
    const r = await api<ImportResult>("/api/private/posts/import", { method: "POST", body: fd });
    const errors = [...(r.errors ?? [])];
    if (skipped) errors.push({ file: `${skipped} 个文件`, error: "unsupported_media_type" });
    showImport(r.imported ?? [], errors);
    await loadList();
  } catch (e) {
    importResult.hidden = false;
    importResult.innerHTML = `<span class="bad">${esc("导入失败：" + explain(e))}</span>`;
  } finally { importBtn.disabled = false; }
}
function showImport(ok: NonNullable<ImportResult["imported"]>, errors: NonNullable<ImportResult["errors"]>) {
  importResult.hidden = false;
  importResult.innerHTML =
    (ok.length ? `已导入 ${ok.length} 篇` : "没有导入任何文章") +
    (ok.length ? `<ul>${ok.map((x) => `<li>${esc(x.title)}（${x.status === "published" ? "已发布" : "草稿"}）</li>`).join("")}</ul>` : "") +
    (errors.length ? `<ul>${errors.map((x) => `<li class="bad">${esc(x.file)}：${esc(errText(x.error))}</li>`).join("")}</ul>` : "");
}
importBtn.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", () => { const fs = [...(importFile.files ?? [])]; importFile.value = ""; if (fs.length) void importFiles(fs); });

/* 页面级拖放：文件拖进页面显示遮罩，松开后导入 .md；图片拖在文本框上由上面的处理接管 */
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
  void importFiles(files.filter((f) => !IMG_RE.test(f.type)));
});

/* ---------- 启动 ---------- */
setState();
void loadList();
