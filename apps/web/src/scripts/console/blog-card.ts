// 控制台「博客」卡片：最近 3 篇文章（标题、发布状态、日期）。数据来自私有接口，全部用 textContent 写入。
// 标题可点：已发布的打开公开文章页（新标签页），草稿打开控制台编辑器（同一个标签页）。
type Item = { id?: unknown; slug?: unknown; title?: unknown; status?: unknown; publishedAt?: unknown; updatedAt?: unknown };

const list = document.getElementById("blogPosts");
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

function fmtDay(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function empty(text: string) {
  if (!list) return;
  const li = document.createElement("li");
  li.className = "post-empty";
  li.textContent = text;
  list.replaceChildren(li);
}

/** 已发布 → /blog/<slug>/；草稿 → /console/write?id=<id>；拿不到可用的目标时返回 null（纯文本）。 */
function target(x: Item): { href: string; blank: boolean } | null {
  if (x.status === "published" && typeof x.slug === "string" && SLUG_RE.test(x.slug)) return { href: `/blog/${x.slug}/`, blank: true };
  if (typeof x.id === "number" && Number.isInteger(x.id) && x.id > 0) return { href: `/console/write?id=${x.id}`, blank: false };
  return null;
}

export async function startBlogCard(): Promise<void> {
  if (!list) return;
  try {
    const res = await fetch("/api/private/posts", { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { items?: unknown };
    const items = (Array.isArray(data?.items) ? data.items : []).filter((x: Item) => x && typeof x.title === "string");
    if (!items.length) { empty("还没有文章，点右上角「写文章」开始写"); return; }
    list.replaceChildren();
    // 接口已按 updated_at 倒序，取前 3 篇。
    for (const x of items.slice(0, 3)) {
      const li = document.createElement("li");
      const text = (x.title as string) || "（无标题）";
      const go = target(x);
      const t: HTMLElement = document.createElement(go ? "a" : "span");
      t.className = "t";
      t.textContent = text;
      t.title = text;
      if (go && t instanceof HTMLAnchorElement) {
        t.href = go.href;
        if (go.blank) { t.target = "_blank"; t.rel = "noopener"; }
      }
      const d = document.createElement("span"); d.className = "d";
      const day = fmtDay(x.publishedAt ?? x.updatedAt);
      d.textContent = [x.status === "published" ? "已发布" : "草稿", day].filter(Boolean).join(" · ");
      li.append(t, d);
      list.append(li);
    }
  } catch {
    empty("文章列表暂时读取不到");
  }
}
