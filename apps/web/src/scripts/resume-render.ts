// 简历渲染。公开页 /resume/、主页精简版、控制台预览共用。
// 前端不做任何打码：只显示接口返回的 text；masked=true 的字段旁边加锁图标。所有文字走 textContent。
export type PField = { text: string; masked: boolean };
export type PResume = {
  basics: Record<"name" | "phone" | "email" | "birth" | "hometown" | "location" | "school" | "degree" | "gender" | "years", PField> & { title: string; summary: string };
  work: { id?: string; start: string; end: string; company: PField; role: string; bullets: string[] }[];
  skills: { id?: string; label: string; text: string }[];
  projects: { id?: string; name: PField; client: PField | null; desc: string; stack: string[]; bullets: string[] }[];
  reveal?: boolean; revealPublic?: boolean; updatedAt?: string;
};

export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string) => {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e;
};
const LOCK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
/** 文字 + （被打码时）锁图标。锁图标是常量 SVG，不含用户内容。 */
export function fieldEl(f: PField | null | undefined, cls = ""): HTMLElement {
  const s = h("span", "rf " + cls);
  s.append(document.createTextNode(f?.text ?? ""));
  if (f?.masked) {
    const l = h("span", "rf-lock"); l.innerHTML = LOCK; l.title = "已隐藏"; l.setAttribute("role", "img"); l.setAttribute("aria-label", "已隐藏");
    s.append(l);
  }
  return s;
}
const nonEmpty = (f?: PField | null) => !!f && f.text.trim() !== "";

/** 完整简历（/resume/ 与控制台预览） */
export function renderResume(r: PResume, root: HTMLElement) {
  root.replaceChildren();
  const b = r.basics;
  const head = h("header", "rs-head");
  const top = h("div", "rs-head-top");
  const id = h("div", "rs-id");
  const name = h("h1", "rs-name"); name.append(fieldEl(b.name));
  id.append(name);
  if (b.title) id.append(h("p", "rs-title", b.title));
  top.append(id);
  const meta = h("ul", "rs-meta");
  const items: [string, PField | undefined][] = [["电话", b.phone], ["邮箱", b.email], ["现居", b.location], ["籍贯", b.hometown], ["出生", b.birth], ["性别", b.gender], ["学历", b.degree], ["院校", b.school], ["工作年限", b.years]];
  for (const [k, f] of items) if (nonEmpty(f)) { const li = h("li"); li.append(h("span", "rs-k", k), fieldEl(f)); meta.append(li); }
  if (meta.childElementCount) { top.append(meta); top.classList.add("has-meta"); }
  head.append(top);
  if (b.summary) head.append(h("p", "rs-sum", b.summary));
  root.append(head);

  if (r.work.length) {
    const sec = section("工作经历");
    const tl = h("ol", "rs-tl");
    for (const w of r.work) {
      const li = h("li", "rs-job");
      const top = h("div", "rs-jobtop"); top.append(h("span", "rs-when", `${w.start} — ${w.end}`));
      const co = h("strong", "rs-co"); co.append(fieldEl(w.company)); top.append(co);
      if (w.role) top.append(h("span", "rs-role", w.role));
      li.append(top, bullets(w.bullets)); tl.append(li);
    }
    sec.append(tl); root.append(sec);
  }
  if (r.skills.length) {
    const sec = section("专业技能"), dl = h("dl", "rs-skills");
    for (const s of r.skills) { const row = h("div"); row.append(h("dt", "", s.label), h("dd", "", s.text)); dl.append(row); }
    sec.append(dl); root.append(sec);
  }
  if (r.projects.length) {
    const sec = section("项目经历"), g = h("div", "rs-projects");
    for (const p of r.projects) {
      const c = h("article", "rs-proj");
      const t = h("h3", "rs-pname"); t.append(fieldEl(p.name)); c.append(t);
      if (p.client && nonEmpty(p.client)) { const cl = h("p", "rs-client"); cl.append(h("span", "rs-k", "客户"), fieldEl(p.client)); c.append(cl); }
      if (p.desc) c.append(h("p", "rs-desc", p.desc));
      if (p.stack.length) { const ch = h("ul", "rs-chips"); for (const s of p.stack) ch.append(h("li", "", s)); c.append(ch); }
      c.append(bullets(p.bullets)); g.append(c);
    }
    sec.append(g); root.append(sec);
  }
}
function section(title: string) { const s = h("section", "rs-sec"); s.append(h("h2", "rs-h", title)); return s; }
function bullets(list: string[]) {
  const ul = h("ul", "rs-bl"); for (const x of list) ul.append(h("li", "", x)); return ul;
}

/** 从项目 desc 中拆出首行「时间 / 角色」元信息与正文概述（无换行或首行是完整句子时整段作概述）。 */
function splitProjectDesc(desc: string): { meta: string; summary: string } {
  const lines = (desc ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length >= 2 && lines[0].length <= 48 && !/[。！？!?]/.test(lines[0])) {
    return { meta: lines[0], summary: lines.slice(1).join(" ") };
  }
  return { meta: "", summary: lines.join(" ") };
}

/** 主页精简版：左栏技能分组，右栏最近工作经历 + 关键项目简述 */
export function renderCompact(r: PResume, root: HTMLElement) {
  root.replaceChildren();
  const cols: HTMLElement[] = [];

  if (r.skills.length) {
    const left = h("div", "resume-col resume-skills");
    left.append(h("h3", "", "// 技能"));
    const dl = h("dl", "skills");
    for (const s of r.skills.slice(0, 6)) {
      const row = h("div"), dd = h("dd");
      for (const t of s.text.split(/[、，,；;]\s*/).filter(Boolean).slice(0, 6)) dd.append(h("span", "chip", t));
      row.append(h("dt", "", s.label), dd);
      dl.append(row);
    }
    left.append(dl);
    cols.push(left);
  }

  const projects = Array.isArray(r.projects) ? r.projects : [];
  if (r.work.length || projects.length) {
    const right = h("div", "resume-col resume-exp");
    if (r.work.length) {
      const workSec = h("div", "resume-block");
      workSec.append(h("h3", "", "// 经历"));
      const tl = h("ul", "timeline");
      for (const w of r.work.slice(0, projects.length ? 2 : 3)) {
        const li = h("li"), when = h("span", "when", `${w.start} — ${w.end}`), box = h("div"), what = h("div", "what");
        what.append(fieldEl(w.company));
        if (w.role) what.append(document.createTextNode(" · " + w.role));
        box.append(what);
        if (w.bullets[0]) box.append(h("div", "desc", w.bullets[0]));
        li.append(when, box);
        tl.append(li);
      }
      workSec.append(tl);
      right.append(workSec);
    }

    if (projects.length) {
      const projSec = h("div", "resume-block");
      projSec.append(h("h3", "", "// 项目"));
      const list = h("ul", "proj-list");
      for (const p of projects.slice(0, 4)) {
        const li = h("li");
        const head = h("div", "proj-head");
        const name = h("div", "proj-name");
        name.append(fieldEl(p.name));
        if (p.client && nonEmpty(p.client)) {
          name.append(h("span", "proj-sep", " · "), fieldEl(p.client, "proj-client"));
        }
        head.append(name);
        const { meta, summary } = splitProjectDesc(p.desc);
        if (meta) head.append(h("span", "proj-meta", meta));
        li.append(head);
        const brief = summary || p.bullets?.[0] || "";
        if (brief) li.append(h("div", "desc", brief));
        list.append(li);
      }
      projSec.append(list);
      right.append(projSec);
    }
    cols.push(right);
  }

  root.classList.toggle("is-single", cols.length === 1);
  root.append(...cols);
}
