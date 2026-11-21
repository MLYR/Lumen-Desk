// 试验场工作台控制器 /console/lab：实验 CRUD、ZIP 导入导出、文件树管理、语法高亮代码编辑与实时预览。
import { $, api, ApiError, esc, explain as explainBase, jsonInit } from "./common";
import "./topbar";
import { enhanceSelect } from "../ui/select";
import { confirmDialog, promptDialog } from "../ui/dialog";
import { toast } from "../ui/toast";
import { CodeEditor, formatBytes } from "./code-editor";

export interface Lab {
  slug: string;
  title: string;
  intro: string;
  stack: string;
  status: string;
  cover: string;
  entry: string;
  featured: boolean;
  draft: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface LabFileItem {
  path: string;
  size: number;
}

const ERR_OVERRIDES: Record<string, string> = {
  invalid_request: "输入内容不符合要求，请检查 slug、标题和文件路径",
  slug_taken: "这个实验标识 (slug) 已被占用，请换一个",
  not_found: "找不到对应的实验或文件，可能已被删除",
  payload_too_large: "文件体积超过上限（上限 15 MB）",
};
const explain = (e: unknown) => explainBase(e, ERR_OVERRIDES);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEXT_EXT_RE = /\.(?:html|htm|css|js|mjs|json|glsl|vert|frag|wgsl|svg|txt|md)$/i;
const IMAGE_EXT_RE = /\.(?:webp|png|jpe?g|gif|avif|svg)$/i;
const RASTER_IMAGE_EXT_RE = /\.(?:webp|png|jpe?g|gif|avif)$/i;

/* ---------- DOM 元素 ---------- */
const wsEl = $("lab-ws");
const msgEl = $("lab-msg");
const stateEl = $("lab-state");
const saveLabBtn = $<HTMLButtonElement>("save-lab-btn");
const saveLabLabel = $("save-lab-label");
const deleteLabBtn = $<HTMLButtonElement>("delete-lab-btn");
const openPublicLink = $<HTMLAnchorElement>("open-public-link");
const exportZipLink = $<HTMLAnchorElement>("export-zip-link");

const labSelect = $<HTMLSelectElement>("lab-select");
const zipNewBtn = $<HTMLButtonElement>("zip-new-btn");
const blankNewBtn = $<HTMLButtonElement>("blank-new-btn");
const zipReplaceBtn = $<HTMLButtonElement>("zip-replace-btn");
const zipNewInput = $<HTMLInputElement>("zip-new-input");
const zipReplaceInput = $<HTMLInputElement>("zip-replace-input");
const assetUploadInput = $<HTMLInputElement>("asset-upload-input");

const metaPanel = $("lab-meta-panel");
const metaHeading = $("meta-heading");
const metaSummary = $("meta-summary");
const toggleMetaBtn = $<HTMLButtonElement>("toggle-meta-btn");
const metaForm = $<HTMLFormElement>("lab-meta-form");
const pendingZipBanner = $("pending-zip-banner");
const pendingZipText = $("pending-zip-text");
const pendingZipClear = $<HTMLButtonElement>("pending-zip-clear");

const fTitle = $<HTMLInputElement>("f-title");
const fSlug = $<HTMLInputElement>("f-slug");
const fStack = $<HTMLInputElement>("f-stack");
const fStatus = $<HTMLInputElement>("f-status");
const fEntry = $<HTMLInputElement>("f-entry");
const fCover = $<HTMLInputElement>("f-cover");
const fSort = $<HTMLInputElement>("f-sort");
const fDraft = $<HTMLSelectElement>("f-draft");
const fFeatured = $<HTMLInputElement>("f-featured");
const fIntro = $<HTMLTextAreaElement>("f-intro");

const filesCountEl = $("files-count");
const fileListEl = $("lab-file-list");
const fileNewBtn = $<HTMLButtonElement>("file-new-btn");
const fileUploadBtn = $<HTMLButtonElement>("file-upload-btn");

const activeFilePathEl = $("active-file-path");
const activeFileActionsEl = $("active-file-actions");
const fileSetEntryBtn = $<HTMLButtonElement>("file-set-entry-btn");
const fileSetCoverBtn = $<HTMLButtonElement>("file-set-cover-btn");
const fileRenameBtn = $<HTMLButtonElement>("file-rename-btn");
const fileDeleteBtn = $<HTMLButtonElement>("file-delete-btn");
const codeEditorHost = $("code-editor-host");
const assetPreviewHost = $("asset-preview-host");

const previewUrlLabel = $("preview-url-label");
const captureCoverBtn = $<HTMLButtonElement>("capture-cover-btn");
const refreshPreviewBtn = $<HTMLButtonElement>("refresh-preview-btn");
const openRawPreviewLink = $<HTMLAnchorElement>("open-raw-preview-link");
const previewFrame = $<HTMLIFrameElement>("lab-preview-frame");
const previewEmpty = $("preview-empty");

const dropEl = $("lab-drop");
const dropSubEl = $("lab-drop-sub");

/* ---------- 增强下拉框 ---------- */
enhanceSelect(labSelect, { searchable: true, placeholder: "选择已有实验…" });
enhanceSelect(fDraft);

/* ---------- 状态 ---------- */
let labs: Lab[] = [];
let currentLab: Lab | null = null;
let files: LabFileItem[] = [];
let activeFilePath: string | null = null;
let activeFileIsText = false;
let metaDirty = false;
let pendingZipFile: File | null = null;
let slugTouched = false;
let autoCoverTimer: number | null = null;
let busy = false;

const editor = new CodeEditor({
  container: codeEditorHost,
  onChange: () => {
    syncStateDisplay();
    renderFileList();
  },
  onSave: () => {
    void saveAll();
  },
});

/* ---------- 消息与状态显示 ---------- */
function setMsg(text: string, kind: "" | "err" | "ok" = "", alsoToast = true) {
  msgEl.textContent = text;
  msgEl.className = "ed-msg " + kind;
  if (kind === "err" && text && alsoToast) toast(text, { kind: "err" });
}

function ok(text: string) {
  setMsg("");
  toast(text, { kind: "ok" });
}

function isCodeDirty(): boolean {
  return Boolean(currentLab && activeFilePath && activeFileIsText && editor.isDirty());
}

function hasUnsavedChanges(): boolean {
  return metaDirty || isCodeDirty();
}

function syncStateDisplay() {
  const dirty = hasUnsavedChanges();
  stateEl.classList.toggle("dirty", dirty);
  if (!currentLab) {
    stateEl.textContent = pendingZipFile ? `新建实验（待上传 ${pendingZipFile.name}）` : "新建空白实验";
    saveLabLabel.textContent = pendingZipFile ? "创建并上传 ZIP" : "创建实验";
    deleteLabBtn.hidden = true;
    openPublicLink.hidden = true;
    exportZipLink.hidden = true;
    zipReplaceBtn.hidden = true;
  } else {
    const pubText = currentLab.draft ? "草稿" : "已发布";
    stateEl.textContent = `${pubText} · ${files.length} 个文件`;
    saveLabLabel.textContent = "保存";
    deleteLabBtn.hidden = false;
    openPublicLink.hidden = false;
    openPublicLink.href = `/lab/${encodeURIComponent(currentLab.slug)}/`;
    exportZipLink.hidden = false;
    exportZipLink.href = `/api/lab/${encodeURIComponent(currentLab.slug)}/export`;
    zipReplaceBtn.hidden = false;
  }
}

/* ---------- 元数据面板折叠 ---------- */
function setMetaCollapsed(collapsed: boolean) {
  metaPanel.classList.toggle("is-collapsed", collapsed);
  metaForm.hidden = collapsed;
  toggleMetaBtn.setAttribute("aria-expanded", String(!collapsed));
  toggleMetaBtn.textContent = collapsed ? "展开元数据" : "收起元数据";
}

toggleMetaBtn.addEventListener("click", () => {
  setMetaCollapsed(!metaForm.hidden);
});

/* ---------- 视图切换 ---------- */
document.querySelectorAll<HTMLButtonElement>(".lab-view-modes .view-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const v = btn.dataset.v || "split";
    wsEl.dataset.view = v;
    document.querySelectorAll<HTMLButtonElement>(".lab-view-modes .view-btn").forEach((b) => {
      b.classList.toggle("is-active", b === btn);
    });
  });
});

document.querySelectorAll<HTMLButtonElement>(".lab-m-tabs button[role='tab']").forEach((tab) => {
  tab.addEventListener("click", () => {
    const mt = tab.dataset.mt || "code";
    wsEl.dataset.mTab = mt;
    document.querySelectorAll<HTMLButtonElement>(".lab-m-tabs button[role='tab']").forEach((t) => {
      t.setAttribute("aria-selected", String(t === tab));
    });
  });
});

/* ---------- 下拉列表渲染 ---------- */
function renderLabSelect() {
  const curVal = currentLab ? currentLab.slug : "";
  labSelect.replaceChildren();
  const ph = new Option("选择已有实验…", "");
  labSelect.append(ph);
  for (const item of labs) {
    const prefix = item.featured ? "★ " : "";
    const suffix = item.draft ? " [草稿]" : "";
    const op = new Option(`${prefix}${item.title}${suffix}`, item.slug);
    op.dataset.sub = `${item.slug} · ${item.stack || item.status || "实验"}`;
    labSelect.append(op);
  }
  labSelect.value = curVal;
}

/* ---------- 元数据表单读写 ---------- */
function fillMetaForm(lab: Lab | null) {
  fTitle.value = lab?.title ?? "";
  fSlug.value = lab?.slug ?? "";
  fSlug.readOnly = Boolean(lab);
  fStack.value = lab?.stack ?? "HTML · CSS · JS";
  fStatus.value = lab?.status ?? "Web · 实验";
  fEntry.value = lab?.entry ?? "index.html";
  fCover.value = lab?.cover ?? "";
  fSort.value = String(lab?.sort ?? 10);
  fDraft.value = lab ? String(lab.draft) : "false";
  fFeatured.checked = Boolean(lab?.featured);
  fIntro.value = lab?.intro ?? "";
  metaDirty = false;
  slugTouched = Boolean(lab);

  if (lab) {
    metaHeading.textContent = `实验元数据 · ${lab.title}`;
    metaSummary.textContent = `/${lab.slug} · 入口 ${lab.entry}${lab.draft ? " · 草稿" : " · 已发布"}`;
  } else {
    metaHeading.textContent = "新建实验元数据";
    metaSummary.textContent = "填写标识 (slug) 与名称后保存即可创建";
  }
}

function setPendingZip(file: File | null) {
  pendingZipFile = file;
  if (file) {
    pendingZipBanner.hidden = false;
    pendingZipText.textContent = `待上传实验包：${file.name}（${formatBytes(file.size)}）`;
  } else {
    pendingZipBanner.hidden = true;
    pendingZipText.textContent = "";
  }
  syncStateDisplay();
}

pendingZipClear.addEventListener("click", () => {
  setPendingZip(null);
});

function deriveSlugFromName(rawName: string): string {
  const base = rawName
    .replace(/\.zip$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const candidate = base || "lab-" + Date.now().toString(36);
  if (!labs.some((x) => x.slug === candidate)) return candidate;
  let i = 2;
  while (labs.some((x) => x.slug === `${candidate}-${i}`)) i++;
  return `${candidate}-${i}`;
}

function deriveTitleFromName(rawName: string): string {
  return rawName.replace(/\.zip$/i, "").replace(/[-_]+/g, " ").trim() || "新实验";
}

fTitle.addEventListener("input", () => {
  metaDirty = true;
  if (!currentLab && !slugTouched) {
    const ascii = fTitle.value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    if (ascii) fSlug.value = ascii;
  }
  syncStateDisplay();
});

fSlug.addEventListener("input", () => {
  metaDirty = true;
  if (!currentLab) slugTouched = fSlug.value.trim().length > 0;
  syncStateDisplay();
});

[fStack, fStatus, fEntry, fCover, fSort, fDraft, fFeatured, fIntro].forEach((el) => {
  el.addEventListener("input", () => {
    metaDirty = true;
    syncStateDisplay();
  });
  el.addEventListener("change", () => {
    metaDirty = true;
    syncStateDisplay();
  });
});

metaForm.addEventListener("submit", (e) => {
  e.preventDefault();
  void saveAll();
});

/* ---------- 预览面板 ---------- */
function buildPreviewUrl(slug: string, entry: string, bust = true): string {
  const cleanEntry = (entry || "index.html").split("/").map(encodeURIComponent).join("/");
  const base = `/lab-files/${encodeURIComponent(slug)}/${cleanEntry}`;
  return bust ? `${base}?t=${Date.now()}` : base;
}

function refreshPreview() {
  if (autoCoverTimer) {
    window.clearTimeout(autoCoverTimer);
    autoCoverTimer = null;
  }
  if (!currentLab) {
    previewFrame.hidden = true;
    previewFrame.src = "about:blank";
    previewEmpty.hidden = false;
    previewUrlLabel.textContent = "未加载";
    openRawPreviewLink.hidden = true;
    captureCoverBtn.hidden = true;
    return;
  }
  const entry = fEntry.value.trim() || currentLab.entry || "index.html";
  const rawUrl = buildPreviewUrl(currentLab.slug, entry, false);
  const bustUrl = buildPreviewUrl(currentLab.slug, entry, true);
  previewUrlLabel.textContent = rawUrl;
  openRawPreviewLink.href = rawUrl;
  openRawPreviewLink.hidden = false;
  captureCoverBtn.hidden = false;
  previewEmpty.hidden = true;
  previewFrame.hidden = false;
  previewFrame.src = bustUrl;
}

async function captureCoverFromPreview(opts?: { silent?: boolean }): Promise<boolean> {
  const lab = currentLab;
  if (!lab || previewFrame.hidden) return false;
  const win = previewFrame.contentWindow;
  const doc = previewFrame.contentDocument;
  if (!win || !doc || !doc.body) return false;

  const W = 1280;
  const H = 640;
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d");
  if (!ctx) return false;

  const drawn = await new Promise<boolean>((resolve) => {
    win.requestAnimationFrame(() => {
      win.requestAnimationFrame(() => {
        try {
          const canvases = Array.from(doc.querySelectorAll("canvas")).filter(
            (c) => c.width > 64 && c.height > 64
          );
          canvases.sort((a, b) => b.width * b.height - a.width * a.height);
          const srcCanvas = canvases[0];
          if (!srcCanvas) {
            resolve(false);
            return;
          }

          const bodyStyle = win.getComputedStyle(doc.body);
          const htmlStyle = win.getComputedStyle(doc.documentElement);
          const bgImg = bodyStyle.backgroundImage !== "none" ? bodyStyle.backgroundImage : htmlStyle.backgroundImage;
          const bgCol =
            bodyStyle.backgroundColor && bodyStyle.backgroundColor !== "rgba(0, 0, 0, 0)"
              ? bodyStyle.backgroundColor
              : htmlStyle.backgroundColor && htmlStyle.backgroundColor !== "rgba(0, 0, 0, 0)"
                ? htmlStyle.backgroundColor
                : "#0f172a";

          const colors = bgImg.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/g);
          if (colors && colors.length >= 2) {
            const grad = bgImg.includes("radial")
              ? ctx.createRadialGradient(W * 0.5, H * 0.3, W * 0.05, W * 0.5, H * 0.5, W * 0.75)
              : ctx.createLinearGradient(0, 0, 0, H);
            grad.addColorStop(0, colors[0]!);
            grad.addColorStop(1, colors[colors.length - 1]!);
            ctx.fillStyle = grad;
          } else {
            ctx.fillStyle = bgCol;
          }
          ctx.fillRect(0, 0, W, H);

          const sw = srcCanvas.width;
          const sh = srcCanvas.height;
          const scale = Math.max(W / sw, H / sh);
          const dw = sw * scale;
          const dh = sh * scale;
          ctx.drawImage(srcCanvas, (W - dw) / 2, (H - dh) / 2, dw, dh);
          resolve(true);
        } catch {
          resolve(false);
        }
      });
    });
  });

  if (!drawn) {
    if (!opts?.silent) setMsg("当前实验未检测到可截取的 Canvas 画布（列表页将自动使用实时嵌入预览）", "err");
    return false;
  }

  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/webp", 0.86));
  if (!blob || !currentLab || currentLab.slug !== lab.slug) return false;

  try {
    const fd = new FormData();
    fd.append("file", new File([blob], "cover.webp", { type: "image/webp" }));
    fd.append("path", "cover.webp");
    const res = await api<{ path: string; size: number; cover: string }>(
      `/api/lab/${encodeURIComponent(lab.slug)}/file`,
      { method: "POST", body: fd }
    );
    let nextCover = res.cover;
    if (nextCover !== "cover.webp") {
      const updated = await api<Lab>(
        `/api/lab/${encodeURIComponent(lab.slug)}`,
        jsonInit("PATCH", { cover: "cover.webp" })
      );
      nextCover = updated.cover;
    }
    if (currentLab && currentLab.slug === lab.slug) {
      currentLab.cover = nextCover;
      if (!metaDirty || !fCover.value.trim()) fCover.value = nextCover;
      const existing = files.find((f) => f.path === res.path);
      if (existing) existing.size = res.size;
      else files.push({ path: res.path, size: res.size });
      renderFileList();
      updateActiveFileHeader();
    }
    if (!opts?.silent) ok("已截取当前预览画面并设为实验封面 (cover.webp)");
    return true;
  } catch (e) {
    if (!opts?.silent) setMsg(explain(e), "err");
    return false;
  }
}

previewFrame.addEventListener("load", () => {
  if (!currentLab || previewFrame.hidden) return;
  if (!currentLab.cover && !fCover.value.trim()) {
    if (autoCoverTimer) window.clearTimeout(autoCoverTimer);
    autoCoverTimer = window.setTimeout(() => {
      autoCoverTimer = null;
      if (currentLab && !currentLab.cover && !fCover.value.trim()) {
        void captureCoverFromPreview({ silent: true });
      }
    }, 1200);
  }
});

captureCoverBtn.addEventListener("click", () => {
  void captureCoverFromPreview({ silent: false });
});

refreshPreviewBtn.addEventListener("click", () => {
  refreshPreview();
  toast("已刷新实验预览", { kind: "info", duration: 1800 });
});

/* ---------- 文件列表与文件加载 ---------- */
function isCoverMatch(filePath: string, cover: string, slug: string): boolean {
  if (!cover) return false;
  return cover === filePath || cover === `/lab-files/${slug}/${filePath}` || cover === `/lab/${slug}/${filePath}`;
}

function renderFileList() {
  filesCountEl.textContent = String(files.length);
  fileListEl.replaceChildren();

  if (!currentLab) {
    const li = document.createElement("li");
    li.className = "lab-file-empty";
    li.textContent = "创建实验后即可在此管理文件";
    fileListEl.append(li);
    return;
  }

  if (files.length === 0) {
    const li = document.createElement("li");
    li.className = "lab-file-empty";
    li.textContent = "暂无文件，可新建文件或上传 ZIP";
    fileListEl.append(li);
    return;
  }

  const entryVal = fEntry.value.trim() || currentLab.entry;
  const coverVal = fCover.value.trim() || currentLab.cover;

  for (const item of files) {
    const li = document.createElement("li");
    const isActive = item.path === activeFilePath;
    li.className = "lab-file-item" + (isActive ? " is-active" : "");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(isActive));

    const isDirtyFile = isActive && isCodeDirty();
    const isEntry = item.path === entryVal;
    const isCover = isCoverMatch(item.path, coverVal, currentLab.slug);

    let badgesHtml = "";
    if (isEntry) badgesHtml += `<span class="file-badge entry">入口</span>`;
    if (isCover) badgesHtml += `<span class="file-badge cover">封面</span>`;
    if (isDirtyFile) badgesHtml += `<span class="file-badge dirty" title="有未保存更改">●</span>`;

    li.innerHTML = `
      <div class="lab-file-main">
        <span class="lab-file-name" title="${esc(item.path)}">${esc(item.path)}</span>
        <span class="lab-file-badges">${badgesHtml}</span>
      </div>
      <span class="lab-file-size">${esc(formatBytes(item.size))}</span>
    `;
    li.addEventListener("click", () => {
      if (item.path !== activeFilePath) {
        void selectFile(item.path);
      }
    });
    fileListEl.append(li);
  }
}

function updateActiveFileHeader() {
  if (!currentLab || !activeFilePath) {
    activeFilePathEl.textContent = "未打开文件";
    activeFileActionsEl.hidden = true;
    return;
  }
  activeFilePathEl.textContent = activeFilePath;
  activeFileActionsEl.hidden = false;

  const isHtml = activeFilePath.toLowerCase().endsWith(".html");
  const isImg = IMAGE_EXT_RE.test(activeFilePath);
  const curEntry = fEntry.value.trim() || currentLab.entry;
  const curCover = fCover.value.trim() || currentLab.cover;

  fileSetEntryBtn.hidden = !isHtml || activeFilePath === curEntry;
  fileSetCoverBtn.hidden = !isImg || isCoverMatch(activeFilePath, curCover, currentLab.slug);
}

async function selectFile(relPath: string, forceDiscard = false) {
  if (!currentLab) return;
  if (!forceDiscard && isCodeDirty() && activeFilePath) {
    const okDiscard = await confirmDialog({
      title: `放弃对 ${activeFilePath} 的未保存修改？`,
      body: "切换文件将丢失当前编辑器里尚未保存的内容。",
      confirmText: "放弃修改",
      danger: true,
    });
    if (!okDiscard) return;
  }

  const fileMeta = files.find((f) => f.path === relPath);
  activeFilePath = relPath;
  activeFileIsText = TEXT_EXT_RE.test(relPath);
  updateActiveFileHeader();
  renderFileList();

  if (activeFileIsText) {
    try {
      const res = await api<{ path: string; content: string; size: number }>(
        `/api/lab/${encodeURIComponent(currentLab.slug)}/file?path=${encodeURIComponent(relPath)}`
      );
      assetPreviewHost.hidden = true;
      codeEditorHost.hidden = false;
      editor.load(res.path, res.content);
      syncStateDisplay();
      renderFileList();
    } catch (e) {
      setMsg(explain(e), "err");
    }
    return;
  }

  // 二进制图片或资源预览
  codeEditorHost.hidden = true;
  assetPreviewHost.hidden = false;
  const fileUrl = `/lab-files/${encodeURIComponent(currentLab.slug)}/${relPath.split("/").map(encodeURIComponent).join("/")}?t=${Date.now()}`;
  const sizeText = fileMeta ? formatBytes(fileMeta.size) : "";

  if (RASTER_IMAGE_EXT_RE.test(relPath)) {
    assetPreviewHost.innerHTML = `
      <div class="lab-asset-card">
        <div class="lab-asset-img-wrap">
          <img src="${esc(fileUrl)}" alt="${esc(relPath)}" class="lab-asset-img">
        </div>
        <div class="lab-asset-meta">
          <code>${esc(relPath)}</code>
          <span>${esc(sizeText)}</span>
          <a class="btn btn-xs" href="${esc(fileUrl)}" target="_blank" rel="noopener">新窗口打开图片 ↗</a>
        </div>
      </div>
    `;
  } else {
    assetPreviewHost.innerHTML = `
      <div class="lab-asset-card">
        <p class="lab-asset-note">二进制资源文件（不支持直接文本编辑）</p>
        <div class="lab-asset-meta">
          <code>${esc(relPath)}</code>
          <span>${esc(sizeText)}</span>
          <a class="btn btn-xs" href="${esc(fileUrl)}" download="${esc(relPath.split("/").pop() || "file")}">下载文件</a>
        </div>
      </div>
    `;
  }
  syncStateDisplay();
}

/* ---------- 加载实验与切换实验 ---------- */
async function loadLabFiles(slug: string, preferredFile?: string) {
  const res = await api<{ items: LabFileItem[] }>(`/api/lab/${encodeURIComponent(slug)}/files`);
  files = res.items || [];
  renderFileList();

  if (files.length === 0) {
    activeFilePath = null;
    activeFileIsText = false;
    updateActiveFileHeader();
    codeEditorHost.hidden = true;
    assetPreviewHost.hidden = false;
    assetPreviewHost.innerHTML = `<div class="lab-asset-card"><p class="lab-asset-note">当前实验暂无文件，可点击左侧「+ 新建文件」或上方「重传 ZIP」。</p></div>`;
    return;
  }

  const entry = currentLab?.entry || "index.html";
  const target =
    (preferredFile && files.some((f) => f.path === preferredFile) && preferredFile) ||
    (files.some((f) => f.path === entry) && entry) ||
    files[0].path;

  await selectFile(target, true);
}

async function openLab(slug: string, preferredFile?: string) {
  try {
    const lab = await api<Lab>(`/api/lab/${encodeURIComponent(slug)}`);
    currentLab = lab;
    const idx = labs.findIndex((x) => x.slug === lab.slug);
    if (idx >= 0) labs[idx] = lab;
    else labs.unshift(lab);

    setPendingZip(null);
    fillMetaForm(lab);
    renderLabSelect();
    await loadLabFiles(lab.slug, preferredFile);
    refreshPreview();
    syncStateDisplay();
    setMsg("");

    const url = new URL(location.href);
    url.searchParams.set("slug", lab.slug);
    history.replaceState(null, "", url.pathname + url.search);
  } catch (e) {
    setMsg(explain(e), "err");
  }
}

function enterNewLabMode(zipFile: File | null = null) {
  currentLab = null;
  files = [];
  activeFilePath = null;
  activeFileIsText = false;
  fillMetaForm(null);
  setPendingZip(zipFile);

  if (zipFile) {
    fSlug.value = deriveSlugFromName(zipFile.name);
    fTitle.value = deriveTitleFromName(zipFile.name);
    slugTouched = true;
    metaDirty = true;
  } else {
    editor.load("index.html", "<!-- 创建实验后将自动生成 index.html、style.css 与 main.js 骨架 -->\n");
  }

  setMetaCollapsed(false);
  renderLabSelect();
  renderFileList();
  updateActiveFileHeader();
  codeEditorHost.hidden = false;
  assetPreviewHost.hidden = true;
  refreshPreview();
  syncStateDisplay();

  const url = new URL(location.href);
  url.searchParams.delete("slug");
  history.replaceState(null, "", url.pathname + url.search);
  fTitle.focus();
}

/* ---------- 元数据收集与校验 ---------- */
function collectMetaPayload(isCreate: boolean) {
  const title = fTitle.value.trim();
  const slug = fSlug.value.trim().toLowerCase();
  const stack = fStack.value.trim();
  const status = fStatus.value.trim();
  const entry = fEntry.value.trim() || "index.html";
  const cover = fCover.value.trim();
  const sort = Number.parseInt(fSort.value, 10);
  const draft = fDraft.value === "true";
  const featured = fFeatured.checked;
  const intro = fIntro.value.trim();

  if (!title) {
    setMsg("请填写实验名称 (title)", "err");
    setMetaCollapsed(false);
    fTitle.focus();
    return null;
  }
  if (isCreate) {
    if (!slug || !SLUG_RE.test(slug)) {
      setMsg("实验标识 (slug) 只能包含小写字母、数字和单个连字符", "err");
      setMetaCollapsed(false);
      fSlug.focus();
      return null;
    }
  }
  if (!entry.toLowerCase().endsWith(".html")) {
    setMsg("入口文件 (entry) 必须是 .html 文件", "err");
    setMetaCollapsed(false);
    fEntry.focus();
    return null;
  }

  return {
    slug,
    title,
    intro,
    stack,
    status,
    cover,
    entry,
    featured,
    draft,
    sort: Number.isFinite(sort) ? sort : 10,
  };
}

/* ---------- ZIP 上传实现 ---------- */
async function uploadZipForSlug(slug: string, file: File): Promise<{ files: string[]; entry: string; cover: string; bytes: number }> {
  const fd = new FormData();
  fd.append("file", file);
  return api<{ files: string[]; entry: string; cover: string; bytes: number }>(
    `/api/lab/${encodeURIComponent(slug)}/upload`,
    { method: "POST", body: fd }
  );
}

/* ---------- 保存（创建实验 / 更新元数据 + 保存当前代码） ---------- */
async function saveAll() {
  if (busy) return;

  // 新建实验模式
  if (!currentLab) {
    const payload = collectMetaPayload(true);
    if (!payload) return;
    busy = true;
    saveLabBtn.disabled = true;
    try {
      const zipToUpload = pendingZipFile;
      const created = await api<Lab>(
        "/api/lab",
        jsonInit("POST", { ...payload, scaffold: !zipToUpload })
      );
      if (zipToUpload) {
        await uploadZipForSlug(created.slug, zipToUpload);
      }
      const refreshed = await api<{ items: Lab[] }>("/api/lab");
      labs = refreshed.items || [];
      await openLab(created.slug);
      ok(zipToUpload ? `已创建实验「${created.title}」并解压 ZIP` : `已创建空白实验「${created.title}」`);
    } catch (e) {
      setMsg(explain(e), "err");
    } finally {
      busy = false;
      saveLabBtn.disabled = false;
    }
    return;
  }

  // 已有实验：保存元数据与当前打开的代码文件
  const payload = collectMetaPayload(false);
  if (!payload) return;

  busy = true;
  saveLabBtn.disabled = true;
  try {
    let savedCode = false;
    if (activeFilePath && activeFileIsText && editor.isDirty()) {
      const fileRes = await api<{ path: string; size: number }>(
        `/api/lab/${encodeURIComponent(currentLab.slug)}/file`,
        jsonInit("PUT", { path: activeFilePath, content: editor.getValue() })
      );
      editor.markSaved();
      const item = files.find((f) => f.path === fileRes.path);
      if (item) item.size = fileRes.size;
      savedCode = true;
    }

    const updated = await api<Lab>(
      `/api/lab/${encodeURIComponent(currentLab.slug)}`,
      jsonInit("PATCH", {
        title: payload.title,
        intro: payload.intro,
        stack: payload.stack,
        status: payload.status,
        cover: payload.cover,
        entry: payload.entry,
        featured: payload.featured,
        draft: payload.draft,
        sort: payload.sort,
      })
    );
    currentLab = updated;
    const idx = labs.findIndex((x) => x.slug === updated.slug);
    if (idx >= 0) labs[idx] = updated;
    fillMetaForm(updated);
    renderLabSelect();
    renderFileList();
    updateActiveFileHeader();
    refreshPreview();
    syncStateDisplay();
    ok(savedCode ? `已保存 ${activeFilePath} 与实验设置` : "已保存实验设置");
  } catch (e) {
    setMsg(explain(e), "err");
  } finally {
    busy = false;
    saveLabBtn.disabled = false;
  }
}

/* ---------- 工具栏按钮事件 ---------- */
labSelect.addEventListener("change", async () => {
  const nextSlug = labSelect.value;
  const curSlug = currentLab?.slug ?? "";
  if (nextSlug === curSlug) return;

  if (hasUnsavedChanges()) {
    const okSwitch = await confirmDialog({
      title: "放弃未保存的更改？",
      body: "当前实验有未保存的元数据或代码修改，切换后将丢失。",
      confirmText: "继续切换",
      danger: true,
    });
    if (!okSwitch) {
      labSelect.value = curSlug;
      return;
    }
  }

  if (!nextSlug) {
    enterNewLabMode(null);
  } else {
    await openLab(nextSlug);
  }
});

blankNewBtn.addEventListener("click", async () => {
  if (hasUnsavedChanges()) {
    const okNew = await confirmDialog({
      title: "放弃未保存的更改？",
      body: "当前实验有尚未保存的更改，新建实验将清空当前未保存内容。",
      confirmText: "继续新建",
      danger: true,
    });
    if (!okNew) return;
  }
  enterNewLabMode(null);
});

zipNewBtn.addEventListener("click", () => {
  zipNewInput.value = "";
  zipNewInput.click();
});

zipNewInput.addEventListener("change", async () => {
  const file = zipNewInput.files?.[0];
  if (!file) return;
  if (hasUnsavedChanges()) {
    const okNew = await confirmDialog({
      title: "放弃未保存的更改？",
      body: "即将根据所选 ZIP 包创建新实验。",
      confirmText: "继续",
      danger: true,
    });
    if (!okNew) return;
  }
  enterNewLabMode(file);
  await saveAll();
});

zipReplaceBtn.addEventListener("click", () => {
  if (!currentLab) return;
  zipReplaceInput.value = "";
  zipReplaceInput.click();
});

zipReplaceInput.addEventListener("change", async () => {
  const file = zipReplaceInput.files?.[0];
  if (!file || !currentLab) return;
  const confirmed = await confirmDialog({
    title: `用 ${file.name} 覆盖当前实验文件？`,
    body: `将清空「${currentLab.title}」现有的静态文件并解压新的 ZIP 包。`,
    confirmText: "确认覆盖",
    danger: true,
  });
  if (!confirmed) return;

  try {
    setMsg("正在上传并解压 ZIP…");
    const res = await uploadZipForSlug(currentLab.slug, file);
    await openLab(currentLab.slug, res.entry);
    ok(`已解压 ${res.files.length} 个文件（${formatBytes(res.bytes)}）`);
  } catch (e) {
    setMsg(explain(e), "err");
  }
});

deleteLabBtn.addEventListener("click", async () => {
  if (!currentLab || busy) return;
  const target = currentLab;
  const confirmed = await confirmDialog({
    title: `删除实验「${target.title}」？`,
    body: `将永久删除实验 /${target.slug} 及其目录下的全部 ${files.length} 个文件。`,
    confirmText: "删除实验",
    danger: true,
  });
  if (!confirmed) return;

  busy = true;
  try {
    await api<void>(`/api/lab/${encodeURIComponent(target.slug)}`, { method: "DELETE" });
    labs = labs.filter((x) => x.slug !== target.slug);
    ok(`已删除实验「${target.title}」`);
    if (labs.length > 0) {
      await openLab(labs[0].slug);
    } else {
      enterNewLabMode(null);
    }
  } catch (e) {
    setMsg(explain(e), "err");
  } finally {
    busy = false;
  }
});

saveLabBtn.addEventListener("click", () => {
  void saveAll();
});

/* ---------- 文件操作（新建、上传、重命名、设为入口/封面、删除） ---------- */
function defaultContentFor(path: string): string {
  const ext = (path.split(".").pop() || "").toLowerCase();
  if (ext === "html") {
    return `<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>实验页面</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <canvas id="stage"></canvas>\n  <script type="module" src="main.js"></script>\n</body>\n</html>\n`;
  }
  if (ext === "css") {
    return `html, body {\n  margin: 0;\n  height: 100%;\n  background: #080d1a;\n  color: #e2e8f0;\n}\n`;
  }
  if (ext === "js" || ext === "mjs") {
    return `// ${path}\nconsole.log("loaded ${path}");\n`;
  }
  if (ext === "glsl" || ext === "frag") {
    return `precision highp float;\nuniform float uTime;\nuniform vec2 uResolution;\n\nvoid main() {\n  vec2 uv = gl_FragCoord.xy / uResolution.xy;\n  gl_FragColor = vec4(uv, 0.5 + 0.5 * sin(uTime), 1.0);\n}\n`;
  }
  if (ext === "vert") {
    return `attribute vec3 position;\nvoid main() {\n  gl_Position = vec4(position, 1.0);\n}\n`;
  }
  if (ext === "json") {
    return `{\n  "name": "lab"\n}\n`;
  }
  return "";
}

fileNewBtn.addEventListener("click", async () => {
  if (!currentLab) {
    toast("请先创建或选择一个实验", { kind: "info" });
    return;
  }
  const rel = await promptDialog({
    title: "新建文件",
    label: "文件相对路径（支持子目录，如 shaders/sky.frag、utils.js）",
    placeholder: "utils.js",
    maxLength: 180,
    validate: (v) => {
      const clean = v.replace(/^\/+/, "");
      if (!clean || clean.includes("..")) return "路径不合法";
      if (!TEXT_EXT_RE.test(clean)) return "新建文本文件需使用 .html/.css/.js/.mjs/.json/.glsl/.vert/.frag/.wgsl/.svg/.txt/.md 后缀";
      if (files.some((f) => f.path === clean)) return "该文件已存在";
      return null;
    },
  });
  if (!rel) return;
  const cleanPath = rel.replace(/^\/+/, "");
  try {
    await api<{ path: string; size: number }>(
      `/api/lab/${encodeURIComponent(currentLab.slug)}/file`,
      jsonInit("PUT", { path: cleanPath, content: defaultContentFor(cleanPath) })
    );
    await loadLabFiles(currentLab.slug, cleanPath);
    syncStateDisplay();
    ok(`已新建 ${cleanPath}`);
  } catch (e) {
    setMsg(explain(e), "err");
  }
});

fileUploadBtn.addEventListener("click", () => {
  if (!currentLab) {
    toast("请先创建或选择一个实验", { kind: "info" });
    return;
  }
  assetUploadInput.value = "";
  assetUploadInput.click();
});

async function uploadAssetFiles(fileList: File[]) {
  if (!currentLab || fileList.length === 0) return;
  let lastPath = activeFilePath || undefined;
  try {
    for (const file of fileList) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("path", file.name);
      const res = await api<{ path: string; size: number; cover: string }>(
        `/api/lab/${encodeURIComponent(currentLab.slug)}/file`,
        { method: "POST", body: fd }
      );
      lastPath = res.path;
      if (res.cover && res.cover !== currentLab.cover) {
        currentLab.cover = res.cover;
        fCover.value = res.cover;
      }
    }
    await loadLabFiles(currentLab.slug, lastPath);
    refreshPreview();
    syncStateDisplay();
    ok(`已上传 ${fileList.length} 个文件`);
  } catch (e) {
    setMsg(explain(e), "err");
  }
}

assetUploadInput.addEventListener("change", () => {
  const list = assetUploadInput.files ? Array.from(assetUploadInput.files) : [];
  void uploadAssetFiles(list);
});

fileRenameBtn.addEventListener("click", async () => {
  if (!currentLab || !activeFilePath) return;
  const fromPath = activeFilePath;
  const toPath = await promptDialog({
    title: "重命名 / 移动文件",
    label: "新的相对路径",
    value: fromPath,
    maxLength: 180,
    validate: (v) => {
      const clean = v.replace(/^\/+/, "");
      if (!clean || clean.includes("..")) return "路径不合法";
      if (clean !== fromPath && files.some((f) => f.path === clean)) return "目标文件已存在";
      return null;
    },
  });
  if (!toPath) return;
  const cleanTo = toPath.replace(/^\/+/, "");
  if (cleanTo === fromPath) return;

  try {
    const res = await api<{ path: string; entry: string; cover: string }>(
      `/api/lab/${encodeURIComponent(currentLab.slug)}/file/rename`,
      jsonInit("POST", { from: fromPath, to: cleanTo })
    );
    currentLab.entry = res.entry;
    currentLab.cover = res.cover;
    fEntry.value = res.entry;
    fCover.value = res.cover;
    await loadLabFiles(currentLab.slug, res.path);
    refreshPreview();
    ok(`已重命名为 ${res.path}`);
  } catch (e) {
    setMsg(explain(e), "err");
  }
});

fileSetEntryBtn.addEventListener("click", async () => {
  if (!currentLab || !activeFilePath) return;
  try {
    const updated = await api<Lab>(
      `/api/lab/${encodeURIComponent(currentLab.slug)}`,
      jsonInit("PATCH", { entry: activeFilePath })
    );
    currentLab = updated;
    fEntry.value = updated.entry;
    renderFileList();
    updateActiveFileHeader();
    refreshPreview();
    ok(`已将 ${activeFilePath} 设为实验入口`);
  } catch (e) {
    setMsg(explain(e), "err");
  }
});

fileSetCoverBtn.addEventListener("click", async () => {
  if (!currentLab || !activeFilePath) return;
  try {
    const updated = await api<Lab>(
      `/api/lab/${encodeURIComponent(currentLab.slug)}`,
      jsonInit("PATCH", { cover: activeFilePath })
    );
    currentLab = updated;
    fCover.value = updated.cover;
    renderFileList();
    updateActiveFileHeader();
    ok(`已将 ${activeFilePath} 设为实验封面`);
  } catch (e) {
    setMsg(explain(e), "err");
  }
});

fileDeleteBtn.addEventListener("click", async () => {
  if (!currentLab || !activeFilePath) return;
  const targetPath = activeFilePath;
  const confirmed = await confirmDialog({
    title: `删除文件 ${targetPath}？`,
    body: "此操作将从实验目录中直接移除该文件。",
    confirmText: "删除文件",
    danger: true,
  });
  if (!confirmed) return;

  try {
    await api<void>(
      `/api/lab/${encodeURIComponent(currentLab.slug)}/file?path=${encodeURIComponent(targetPath)}`,
      { method: "DELETE" }
    );
    const refreshedLab = await api<Lab>(`/api/lab/${encodeURIComponent(currentLab.slug)}`);
    currentLab = refreshedLab;
    fEntry.value = refreshedLab.entry;
    fCover.value = refreshedLab.cover;
    await loadLabFiles(currentLab.slug);
    refreshPreview();
    syncStateDisplay();
    ok(`已删除 ${targetPath}`);
  } catch (e) {
    setMsg(explain(e), "err");
  }
});

/* ---------- 全屏快捷键与拖拽上传 ---------- */
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    void saveAll();
  }
});

window.addEventListener("beforeunload", (e) => {
  if (hasUnsavedChanges()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

let dragDepth = 0;
const hasDragFiles = (e: DragEvent) => Boolean(e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files"));

window.addEventListener("dragenter", (e) => {
  if (!hasDragFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  dropSubEl.textContent = currentLab
    ? `拖入 .zip 可替换「${currentLab.title}」或新建实验；拖入普通文件将直接上传到当前实验`
    : "将自动用 ZIP 文件名预填并创建新实验";
  dropEl.hidden = false;
});

window.addEventListener("dragover", (e) => {
  if (!hasDragFiles(e)) return;
  e.preventDefault();
});

window.addEventListener("dragleave", (e) => {
  if (!hasDragFiles(e)) return;
  if (--dragDepth <= 0) {
    dragDepth = 0;
    dropEl.hidden = true;
  }
});

window.addEventListener("drop", async (e) => {
  if (!hasDragFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropEl.hidden = true;

  const dropped = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
  if (dropped.length === 0) return;

  const zipFile = dropped.find((f) => /\.zip$/i.test(f.name));
  if (zipFile) {
    if (!currentLab) {
      enterNewLabMode(zipFile);
      await saveAll();
      return;
    }
    const replaceCurrent = await confirmDialog({
      title: `已拖入 ${zipFile.name}`,
      body: `是否用该 ZIP 覆盖当前实验「${currentLab.title}」的文件？（若点取消，将为您切换为新建实验并上传此 ZIP）`,
      confirmText: "覆盖当前实验",
      cancelText: "以此 ZIP 新建实验",
      danger: true,
    });
    if (replaceCurrent) {
      try {
        const res = await uploadZipForSlug(currentLab.slug, zipFile);
        await openLab(currentLab.slug, res.entry);
        ok(`已覆盖并解压 ${res.files.length} 个文件`);
      } catch (err) {
        setMsg(explain(err), "err");
      }
    } else {
      enterNewLabMode(zipFile);
      await saveAll();
    }
    return;
  }

  if (currentLab) {
    await uploadAssetFiles(dropped);
  } else {
    toast("请先拖入 .zip 实验包，或先创建实验后再拖入单个文件", { kind: "info" });
  }
});

/* ---------- 初始化加载 ---------- */
async function init() {
  try {
    const res = await api<{ items: Lab[] }>("/api/lab");
    labs = res.items || [];
    renderLabSelect();

    const querySlug = new URLSearchParams(location.search).get("slug")?.trim();
    if (querySlug) {
      await openLab(querySlug);
    } else if (labs.length > 0) {
      await openLab(labs[0].slug);
    } else {
      enterNewLabMode(null);
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return;
    setMsg(explain(e), "err");
  }
}

void init();
