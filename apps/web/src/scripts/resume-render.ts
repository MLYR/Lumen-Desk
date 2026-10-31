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
  const name = h("h1", "rs-name"); name.append(fieldEl(b.name));
  head.append(name);
  if (b.title) head.append(h("p", "rs-title", b.title));
  const meta = h("ul", "rs-meta");
  const items: [string, PField | undefined][] = [["电话", b.phone], ["邮箱", b.email], ["现居", b.location], ["籍贯", b.hometown], ["出生", b.birth], ["性别", b.gender], ["学历", b.degree], ["院校", b.school], ["工作年限", b.years]];
  for (const [k, f] of items) if (nonEmpty(f)) { const li = h("li"); li.append(h("span", "rs-k", k), fieldEl(f)); meta.append(li); }
  head.append(meta);
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

/** 主页精简版：最近两段工作经历 + 技能分组 */
export function renderCompact(r: PResume, root: HTMLElement) {
  root.replaceChildren();
  const left = h("div"), right = h("div");
  left.append(h("h3", "", "// 经历"));
  const tl = h("ul", "timeline");
  for (const w of r.work.slice(0, 2)) {
    const li = h("li"), when = h("span", "when", `${w.start} — ${w.end}`), box = h("div"), what = h("div", "what");
    what.append(fieldEl(w.company)); if (w.role) what.append(document.createTextNode(" · " + w.role));
    box.append(what); if (w.bullets[0]) box.append(h("div", "desc", w.bullets[0]));
    li.append(when, box); tl.append(li);
  }
  left.append(tl);
  right.append(h("h3", "", "// 技能"));
  const dl = h("dl", "skills");
  for (const s of r.skills.slice(0, 6)) {
    const row = h("div"), dd = h("dd");
    for (const t of s.text.split(/[、，,；;]\s*/).filter(Boolean).slice(0, 6)) dd.append(h("span", "chip", t));
    row.append(h("dt", "", s.label), dd); dl.append(row);
  }
  right.append(dl);
  root.append(left, right);
}
