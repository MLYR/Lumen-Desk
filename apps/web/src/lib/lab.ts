/** 试验场里一个实验的接口数据（GET /api/lab 返回项） */
export interface ApiLab {
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
}

const SLUG_RE = /^[a-z0-9-]{1,80}$/;

const ESC_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** 严格转义 HTML 特殊字符，防止外部文本注入。 */
export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ESC_MAP[ch]!);
}

/** 解析实验封面地址：站内绝对路径直出，其余视作实验包内相对路径。 */
export function resolveCover(slug: string, cover?: string): string {
  if (!cover) return "";
  if (cover.startsWith("/")) {
    if (cover.startsWith("//") || cover.includes("..")) return "";
    return cover;
  }
  if (cover.includes("..")) return "";
  const parts = cover.split("/").filter(Boolean);
  if (!parts.length) return "";
  return `/lab-files/${encodeURIComponent(slug)}/${parts.map(encodeURIComponent).join("/")}`;
}

/** 解析实验入口 HTML 地址，供无封面图时的实时缩略预览使用。 */
export function resolveEntry(slug: string, entry?: string): string {
  const raw = (entry && entry.trim()) || "index.html";
  if (raw.includes("..")) return "";
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length) return "";
  return `/lab-files/${encodeURIComponent(slug)}/${parts.map(encodeURIComponent).join("/")}`;
}

function renderPreviewMedia(item: ApiLab): string {
  const cover = resolveCover(item.slug, item.cover);
  if (cover) {
    return `<img src="${esc(cover)}" alt="${esc(item.title)}" width="1440" height="720" loading="lazy" decoding="async" />`;
  }
  const entryUrl = resolveEntry(item.slug, item.entry);
  if (!entryUrl) return "";
  return `<iframe class="pv-frame" src="${esc(entryUrl)}" title="${esc(item.title)}" loading="lazy" tabindex="-1" aria-hidden="true" sandbox="allow-scripts allow-same-origin"></iframe>`;
}

/** 从 /api/lab 响应中过滤出合法实验项。 */
export function parseLabs(data: unknown): ApiLab[] {
  const raw = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(raw)) return [];
  const out: ApiLab[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.slug !== "string" || !SLUG_RE.test(row.slug)) continue;
    if (typeof row.title !== "string" || !row.title.trim()) continue;
    out.push({
      slug: row.slug,
      title: row.title,
      intro: typeof row.intro === "string" ? row.intro : "",
      stack: typeof row.stack === "string" ? row.stack : "",
      status: typeof row.status === "string" ? row.status : "",
      cover: typeof row.cover === "string" ? row.cover : "",
      entry: typeof row.entry === "string" ? row.entry : "index.html",
      featured: Boolean(row.featured),
      draft: Boolean(row.draft),
      sort: typeof row.sort === "number" ? row.sort : 50,
    });
  }
  return out;
}

/** 主打卡片：标了 featured 的第一个，没标就用排第一的。 */
export function featuredOf(items: ApiLab[]): ApiLab | undefined {
  return items.find((item) => item.featured) ?? items[0];
}

/** 首页只放主打卡片加最多三张小卡，剩下的走「全部实验」。 */
export function homeLabItems(items: ApiLab[], max = 4): ApiLab[] {
  const featured = featuredOf(items);
  if (!featured) return [];
  return [featured, ...items.filter((item) => item !== featured).slice(0, Math.max(0, max - 1))];
}

/** 渲染与 LabGrid.astro 样式一致的实验卡片墙 HTML。 */
export function renderLabGrid(items: ApiLab[]): string {
  const featured = featuredOf(items);
  if (!featured) return `<p class="lab-empty">还没有实验。做出来再放上来。</p>`;
  const rest = items.filter((item) => item !== featured);
  const featMedia = renderPreviewMedia(featured);
  const featCard =
    `<a class="lab lab-feature" href="/lab/${esc(featured.slug)}/">` +
    `<div class="pv feature-pv">${featMedia}</div>` +
    `<div class="body">` +
    `<div class="kicker">${esc(featured.stack)}</div>` +
    `<div class="nm">${esc(featured.title)}</div>` +
    `<div class="ds">${esc(featured.intro)}</div>` +
    `<div class="st"><span>${esc(featured.status)}</span><span class="go">进入实验 →</span></div>` +
    `</div></a>`;
  const smallCards = rest.map((item) => {
    const media = renderPreviewMedia(item);
    const pv = media ? `<div class="pv">${media}</div>` : "";
    return (
      `<a class="lab lab-small" href="/lab/${esc(item.slug)}/">${pv}<div class="body">` +
      `<div class="kicker">${esc(item.stack)}</div>` +
      `<div class="nm">${esc(item.title)}</div>` +
      `<div class="ds">${esc(item.intro)}</div>` +
      `<div class="st"><span>${esc(item.status)}</span><span class="go">进入 →</span></div>` +
      `</div></a>`
    );
  });
  return `<div class="labs">${featCard}${smallCards.join("")}</div>`;
}
