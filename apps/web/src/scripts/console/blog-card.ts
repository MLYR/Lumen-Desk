// 控制台「博客」卡片：最近 3 篇文章（标题、发布状态、日期）。数据来自私有接口，全部用 textContent 写入。
type Status = "draft" | "published";
type Item = { title?: unknown; status?: unknown; publishedAt?: unknown; updatedAt?: unknown };

const list = document.getElementById("blogPosts");

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
      const t = document.createElement("span"); t.className = "t"; t.textContent = (x.title as string) || "（无标题）"; t.title = t.textContent;
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
