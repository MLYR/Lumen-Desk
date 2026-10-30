// 把个人资料渲染到主页简介区。公开主页和设置页的预览共用。
// 所有文本只用 textContent；链接只允许 http、https、mailto。
export type PublicProfile = {
  name: string; tagline?: string; bio?: string; avatar?: string | null;
  facts?: { label: string; value: string }[];
  links?: { label: string; url: string }[];
};
type Els = { tagline: HTMLElement; side: HTMLElement; cta: HTMLElement };

/** 返回规范化后的 URL；不合法返回 null。用白名单，因为浏览器会忽略 URL 里的制表符和换行再判断协议。 */
export function safeHref(u: unknown): string | null {
  if (typeof u !== "string" || u.length > 2000) return null;
  try {
    const x = new URL(u.trim());
    return x.protocol === "http:" || x.protocol === "https:" || x.protocol === "mailto:" ? x.href : null;
  } catch { return null; }
}

export function renderIntro(p: PublicProfile, els: Els) {
  if (typeof p.tagline === "string" && p.tagline.trim()) els.tagline.textContent = p.tagline;
  if (Array.isArray(p.facts)) {
    els.side.replaceChildren();
    for (const f of p.facts.slice(0, 6)) {
      if (!f || typeof f.label !== "string" || typeof f.value !== "string") continue;
      const row = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = f.label; dd.textContent = f.value;
      row.append(dt, dd); els.side.append(row);
    }
  }
  if (Array.isArray(p.links)) {
    els.cta.querySelectorAll(".extra").forEach((n) => n.remove());
    for (const l of p.links.slice(0, 6)) {
      const href = l && typeof l.label === "string" ? safeHref(l.url) : null;
      if (!href) continue; // 不合法的链接不生成
      const a = document.createElement("a");
      a.className = "extra"; a.textContent = l.label; a.href = href;
      if (!href.startsWith("mailto:")) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
      els.cta.append(a);
    }
  }
}
