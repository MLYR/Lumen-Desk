// 控制台 AIHOT 今日日报：底部预览条 + <dialog> 摘要阅读器。
// 严格遵守 AIHOT 协议：只读本站 /api/daily 缓存、保留来源标注与 AIHOT 链接、所有外部文本用 textContent 写入。
import { button, modal, title as dialogTitle } from "../ui/dialog";
import { mk } from "../ui/pop";
import { safeUrl } from "./common";

type DailyLead = { title: string; leadParagraph: string };
type DailyItem = {
  title: string;
  summary: string;
  sourceName: string;
  aihotUrl: string;
  originalUrl: string | null;
  publishedAt: string | null;
};
type DailySection = { label: string; items: DailyItem[] };
type DailyReport = {
  date: string;
  generatedAt: string | null;
  url: string;
  lead: DailyLead | null;
  highlights: DailyItem[];
  sections: DailySection[];
  flashes: DailyItem[];
};
type DailyPayload = {
  report: DailyReport | null;
  updatedAt: string | null;
  source?: { name: string; url: string };
};

const REFRESH_MS = 30 * 60_000;
let latest: DailyPayload | null = null;
let loadedOnce = false;

function shortDate(d: string): string {
  const m = /^\d{4}-(\d{2}-\d{2})$/.exec(d.trim());
  return m ? m[1]! : d.trim();
}

function extLink(href: string, text: string, cls: string): HTMLAnchorElement {
  const a = mk("a", cls, text);
  const safe = safeUrl(href);
  a.href = safe === "#" ? "https://aihot.news/daily" : safe;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

function headlineOf(report: DailyReport): string {
  if (report.lead?.title) return report.lead.title;
  if (report.highlights[0]?.title) return report.highlights[0].title;
  if (report.sections[0]?.items[0]?.title) return report.sections[0].items[0].title;
  if (report.flashes[0]?.title) return report.flashes[0].title;
  return "查看今日 AI 要点";
}

function updateBar() {
  const tag = document.getElementById("dailyTag");
  const lead = document.getElementById("dailyLead");
  const bar = document.getElementById("dailyBar");
  if (!tag || !lead || !bar) return;

  const r = latest?.report;
  if (!r) {
    tag.textContent = "日报";
    lead.textContent = loadedOnce ? "今日日报暂未更新" : "加载今日日报…";
    bar.classList.toggle("is-empty", loadedOnce);
    return;
  }
  const sd = shortDate(r.date);
  tag.textContent = sd ? `日报 · ${sd}` : "今日日报";
  lead.textContent = headlineOf(r);
  bar.classList.remove("is-empty");
}

function renderItem(it: DailyItem, compact = false): HTMLLIElement {
  const li = mk("li", compact ? "daily-item compact" : "daily-item");
  const h = mk("div", "daily-item-t");
  h.append(extLink(it.aihotUrl, it.title, "daily-item-link"));
  li.append(h);

  if (!compact && it.summary) {
    li.append(mk("p", "daily-item-s", it.summary));
  }

  const meta = mk("div", "daily-item-m");
  if (it.sourceName) meta.append(mk("span", "daily-src", it.sourceName));
  const links = mk("span", "daily-links");
  links.append(extLink(it.aihotUrl, "AIHOT ↗", "daily-ext"));
  if (it.originalUrl && safeUrl(it.originalUrl) !== "#") {
    links.append(extLink(it.originalUrl, "原文 ↗", "daily-ext"));
  }
  meta.append(links);
  li.append(meta);
  return li;
}

function renderBody(container: HTMLElement, data: DailyPayload | null, onReload: () => void) {
  container.replaceChildren();
  const r = data?.report;
  if (!r) {
    const empty = mk("div", "daily-empty");
    empty.append(mk("p", "", "当前还没有缓存到今日日报（AIHOT 每天 08:00 后发布，后端每小时同步一次）。"));
    const row = mk("div", "daily-empty-acts");
    const retry = button("重新加载", "sm");
    retry.onclick = onReload;
    row.append(retry, extLink("https://aihot.news/daily", "前往 AIHOT 查看 →", "daily-ext"));
    empty.append(row);
    container.append(empty);
    return;
  }

  if (r.lead) {
    const hero = mk("section", "daily-hero");
    hero.append(mk("div", "daily-kicker", "今日导读"));
    hero.append(mk("h3", "daily-hero-t", r.lead.title));
    if (r.lead.leadParagraph) hero.append(mk("p", "daily-hero-p", r.lead.leadParagraph));
    container.append(hero);
  }

  // Highlights 与 sections 可能包含同一条目，按 aihotUrl 去重，避免重复阅读。
  const seen = new Set<string>();

  if (r.highlights.length) {
    const sec = mk("section", "daily-sec");
    sec.append(mk("h3", "daily-sec-h", "焦点精选"));
    const ul = mk("ul", "daily-list");
    for (const it of r.highlights) {
      if (seen.has(it.aihotUrl)) continue;
      seen.add(it.aihotUrl);
      ul.append(renderItem(it, false));
    }
    if (ul.childElementCount) {
      sec.append(ul);
      container.append(sec);
    }
  }

  for (const s of r.sections) {
    const items = s.items.filter((it) => {
      if (seen.has(it.aihotUrl)) return false;
      seen.add(it.aihotUrl);
      return true;
    });
    if (!items.length) continue;
    const sec = mk("section", "daily-sec");
    sec.append(mk("h3", "daily-sec-h", s.label));
    const ul = mk("ul", "daily-list");
    for (const it of items) ul.append(renderItem(it, false));
    sec.append(ul);
    container.append(sec);
  }

  if (r.flashes.length) {
    const sec = mk("section", "daily-sec");
    sec.append(mk("h3", "daily-sec-h", "快讯速览"));
    const ul = mk("ul", "daily-list");
    for (const it of r.flashes) ul.append(renderItem(it, true));
    sec.append(ul);
    container.append(sec);
  }
}

export async function loadDaily(): Promise<DailyPayload | null> {
  try {
    const res = await fetch("/api/daily", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    latest = (await res.json()) as DailyPayload;
  } catch {
    if (!loadedOnce) latest = null;
  } finally {
    loadedOnce = true;
    updateBar();
  }
  return latest;
}

export function openDailyDialog() {
  void modal("ui-dialog daily-dialog", undefined, (d, fin) => {
    const shell = mk("div", "daily-shell");
    const head = mk("div", "daily-head");
    const headLeft = mk("div", "daily-head-l");
    headLeft.append(dialogTitle(d, "AIHOT 今日日报"));
    const sub = mk("div", "daily-sub");
    const updateSub = () => {
      sub.replaceChildren();
      const r = latest?.report;
      if (r?.date) sub.append(mk("span", "", r.date), mk("span", "", " · "));
      sub.append(mk("span", "", "来源 "));
      sub.append(extLink(r?.url ?? "https://aihot.news/daily", "AIHOT", "daily-ext"));
    };
    updateSub();
    headLeft.append(sub);

    const closeX = mk("button", "daily-x", "×");
    closeX.type = "button";
    closeX.setAttribute("aria-label", "关闭今日日报");
    closeX.onclick = () => fin(undefined);
    head.append(headLeft, closeX);

    const foot = mk("div", "daily-foot");
    const note = mk("span", "daily-note");
    const updateFoot = () => {
      note.replaceChildren(
        mk("span", "", "内容来自 AIHOT，仅作个人阅读缓存 · "),
        extLink(latest?.report?.url ?? "https://aihot.news/daily", "在 AIHOT 查看完整版 ↗", "daily-ext"),
      );
    };
    updateFoot();
    const closeBtn = button("关闭", "ghost sm");
    closeBtn.onclick = () => fin(undefined);
    foot.append(note, closeBtn);

    const scroll = mk("div", "daily-scroll scroll");
    const reload = () => {
      void loadDaily().then(() => {
        updateSub();
        updateFoot();
        renderBody(scroll, latest, reload);
      });
    };
    renderBody(scroll, latest, reload);

    shell.append(head, scroll, foot);
    d.append(shell);

    if (!loadedOnce) reload();
    return closeX;
  });
}

export function startDailyCard() {
  document.getElementById("openDailyBtn")?.addEventListener("click", openDailyDialog);
  document.getElementById("dailyBarBtn")?.addEventListener("click", openDailyDialog);
  void loadDaily();
  setInterval(() => {
    if (!document.hidden) void loadDaily();
  }, REFRESH_MS);
}
