// 简历编辑器 /console/resume。接口见 docs/contracts/resume.md。所有文字走 textContent。
// 前端不做打码：访客视图调用 /api/private/resume/preview，只显示返回的 text。
import { $, api, explain, jsonInit } from "./common";
import "./topbar";
import { confirmDialog } from "../ui/dialog";
import { toast } from "../ui/toast";
import { renderResume, h, type PResume } from "../resume-render";

type Field = { value: string; sensitive: boolean };
type Work = { id: string; start: string; end: string; company: Field; role: string; bullets: string[] };
type Skill = { id: string; label: string; text: string };
type Proj = { id: string; name: Field; client: Field | null; desc: string; stack: string[]; bullets: string[] };
type Resume = {
  basics: Record<"name" | "phone" | "email" | "birth" | "hometown" | "location" | "school" | "degree" | "gender" | "years", Field> & { title: string; summary: string };
  work: Work[]; skills: Skill[]; projects: Proj[]; keywords: string[]; updatedAt?: string;
};
type Loaded = Resume & { settings?: { revealPublic: boolean } };

const OVERRIDES = { invalid_request: "内容不符合要求：文字最多 200 字，描述和要点每条最多 500 字，经历/项目最多 20 条，技能最多 30 条", no_resume: "还没有简历" };
const fail = (p: string, e: unknown) => { const m = `${p}：${explain(e, OVERRIDES)}`; $("re-msg").textContent = m; $("re-msg").className = "re-msg err"; toast(m, { kind: "err" }); };

const uid = () => "i" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const F = (value = "", sensitive = true): Field => ({ value, sensitive });
let R: Resume = empty();
let reveal = false, dirty = false, busy = false, view: "me" | "guest" = "me";
function empty(): Resume {
  return { basics: { name: F(), title: "", phone: F(), email: F(), birth: F(), hometown: F(), location: F(), school: F("", false), degree: F("", false), gender: F("", false), years: F("", false), summary: "" }, work: [], skills: [], projects: [], keywords: [] };
}
function setDirty(v: boolean) { dirty = v; $("re-state").textContent = v ? "未保存" : "已保存"; $("re-state").classList.toggle("dirty", v); }
const touch = () => { setDirty(true); schedulePreview(); };

/* ---------- 表单控件 ---------- */
function txt(val: string, on: (v: string) => void, label: string, o: { area?: boolean; max?: number; ph?: string; mono?: boolean } = {}): HTMLElement {
  const i = o.area ? h("textarea", "re-in") : h("input", "re-in");
  i.value = val; i.setAttribute("aria-label", label); if (o.max) i.maxLength = o.max; if (o.ph) i.placeholder = o.ph;
  if (o.area) (i as HTMLTextAreaElement).rows = 2;
  if (o.mono) i.classList.add("mono");
  i.addEventListener("input", () => { on(i.value); touch(); });
  return i;
}
// 关锁（锁梁闭合）和开锁（锁梁抬起、偏向一侧）是两个不同的图形；颜色跟随 currentColor
const SV = (inner: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true">${inner}</svg>`;
const LOCKED = SV('<rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 15v2"/>');
const OPEN = SV('<rect x="5" y="11" width="14" height="10"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/><path d="M12 15v2"/>');
/** 敏感开关：小锁按钮，aria-pressed 表示是否打码 */
function lock(f: Field, label: string): HTMLButtonElement {
  const b = h("button", "re-lock"); b.type = "button";
  const sync = () => { b.setAttribute("aria-pressed", String(f.sensitive)); b.title = f.sensitive ? "对访客打码（点击取消）" : "不打码（点击设为打码）"; b.setAttribute("aria-label", `${label}：${f.sensitive ? "已设为打码" : "不打码"}`); b.innerHTML = f.sensitive ? LOCKED : OPEN; }; // 常量 SVG，不含用户内容
  b.addEventListener("click", () => { f.sensitive = !f.sensitive; sync(); touch(); });
  sync(); return b;
}
function fieldRow(label: string, f: Field, ph = ""): HTMLElement {
  const row = h("div", "re-row"), l = h("label", "re-l", label);
  const i = txt(f.value, (v) => { f.value = v; }, label, { max: 200, ph }) as HTMLInputElement;
  const id = uid(); i.id = id; l.htmlFor = id;
  row.append(l, i, lock(f, label)); return row;
}
function plainRow(label: string, get: () => string, set: (v: string) => void, o: { area?: boolean; ph?: string } = {}): HTMLElement {
  const row = h("div", "re-row"), l = h("label", "re-l", label);
  const i = txt(get(), set, label, { max: o.area ? 500 : 200, area: o.area, ph: o.ph }); const id = uid(); i.id = id; l.htmlFor = id;
  row.append(l, i, h("span", "re-nolock")); return row;
}
const iconBtn = (t: string, label: string, fn: () => void, disabled = false, cls = "") => { const b = h("button", "re-ib " + cls, t); b.type = "button"; b.setAttribute("aria-label", label); b.title = label; b.disabled = disabled; b.addEventListener("click", fn); return b; };
function move<T>(a: T[], i: number, d: number) { const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; touch(); render(); }
function bulletsEditor(arr: string[], label: string): HTMLElement {
  const box = h("div", "re-bl"); box.append(h("div", "re-bl-h", `${label}（每条最多 500 字，最多 20 条）`));
  const ul = h("ul");
  arr.forEach((b, i) => {
    const li = h("li");
    li.append(txt(b, (v) => { arr[i] = v; }, `${label} ${i + 1}`, { area: true, max: 500 }), iconBtn("↑", "上移", () => move(arr, i, -1), i === 0), iconBtn("↓", "下移", () => move(arr, i, 1), i === arr.length - 1), iconBtn("×", "删除这条", () => { arr.splice(i, 1); touch(); render(); }, false, "del"));
    ul.append(li);
  });
  const add = h("button", "btn sm", "+ 添加一条"); add.type = "button"; add.disabled = arr.length >= 20;
  add.addEventListener("click", () => { arr.push(""); touch(); render(); });
  box.append(ul, add); return box;
}
function card(title: string, tools: HTMLElement[], body: HTMLElement[]): HTMLElement {
  const c = h("section", "re-card"); const hd = h("div", "re-card-h"); hd.append(h("strong", "", title)); const t = h("span", "re-tools"); t.append(...tools); hd.append(t); c.append(hd, ...body); return c;
}
function sec(title: string, onAdd?: () => void, addText = "+ 添加", full = false): HTMLElement {
  const s = h("section", "re-sec"); const hd = h("div", "re-sec-h"); hd.append(h("h2", "", title));
  if (onAdd) { const b = h("button", "btn sm", addText); b.type = "button"; b.disabled = full; b.addEventListener("click", onAdd); hd.append(b); }
  s.append(hd); return s;
}

/* ---------- 其他需要隐藏的词 ---------- */
const KW_MIN = 2, KW_MAX = 40, KW_LIMIT = 50;
const len = (s: string) => [...s].length;
/** 校验并加入一个词；返回错误文字或 null。重复的（不区分大小写）直接忽略。 */
function addKeyword(raw: string): string | null {
  const w = raw.trim();
  if (!w) return null;
  if (len(w) < KW_MIN) return `「${w}」太短，每个词至少 ${KW_MIN} 个字`;
  if (len(w) > KW_MAX) return `这个词太长，每个词最多 ${KW_MAX} 个字`;
  // Case-sensitive, matching the server's split/join: "Redis" and "redis" are both kept so neither leaks.
  if (R.keywords.includes(w)) return null;
  if (R.keywords.length >= KW_LIMIT) return `最多 ${KW_LIMIT} 个词`;
  R.keywords.push(w); return null;
}
function keywordsSection(): HTMLElement {
  const s = sec("其他需要隐藏的词");
  s.append(h("p", "re-kw-note", "项目描述、要点里提到的厂商、客户内部系统等，访客看到的是「某系统」。公司或客户的简称（比如去掉「有限公司」的叫法）也要加在这里，否则不会被隐藏。"));
  const box = h("div", "tagbox re-kw"), chips = h("span", "tag-chips"), input = h("input"), err = h("p", "re-kw-err"), count = h("p", "re-kw-n");
  input.placeholder = "输入后按回车或逗号"; input.setAttribute("aria-label", "其他需要隐藏的词"); input.autocomplete = "off"; input.maxLength = 80;
  err.setAttribute("role", "alert");
  const paint = () => {
    chips.replaceChildren();
    R.keywords.forEach((k, i) => {
      const c = h("span", "tag-chip"), l = h("span", "", k), x = h("button", "tag-x", "×"); x.type = "button"; x.setAttribute("aria-label", `删除 ${k}`);
      x.addEventListener("click", () => { R.keywords.splice(i, 1); paint(); touch(); input.focus(); });
      c.append(l, x); chips.append(c);
    });
    count.textContent = `${R.keywords.length} / ${KW_LIMIT}`;
  };
  const commit = (raw: string) => {
    let bad: string | null = null, changed = false;
    for (const part of raw.split(/[,，]/)) { const n = R.keywords.length; const e = addKeyword(part); if (e) bad = e; if (R.keywords.length !== n) changed = true; }
    err.textContent = bad ?? ""; if (changed) { paint(); touch(); }
    return !bad;
  };
  input.addEventListener("input", () => {
    if (/[,，]/.test(input.value)) { const parts = input.value.split(/[,，]/), rest = parts.pop() ?? ""; commit(parts.join(",")); input.value = rest; }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (commit(input.value)) input.value = ""; }
    else if (e.key === "Backspace" && !input.value && R.keywords.length) { R.keywords.pop(); paint(); touch(); }
  });
  input.addEventListener("blur", () => { if (input.value.trim() && commit(input.value)) input.value = ""; });
  box.addEventListener("click", (e) => { if (e.target === box || e.target === chips) input.focus(); });
  box.append(chips, input); s.append(box, err, count); paint();
  return s;
}

/* ---------- 渲染表单 ---------- */
function render() {
  const root = $("re-form"), y = scrollY; root.replaceChildren();
  const b = R.basics;
  const s1 = sec("基本信息");
  const g = h("div", "re-grid");
  g.append(fieldRow("姓名", b.name, "张三"), plainRow("求职方向", () => b.title, (v) => (b.title = v), { ph: "Java 开发工程师" }), fieldRow("电话", b.phone, "13800000000"), fieldRow("邮箱", b.email, "zhangsan@example.com"),
    fieldRow("出生年月", b.birth, "2000.01"), fieldRow("籍贯", b.hometown), fieldRow("现居地", b.location), fieldRow("院校", b.school), fieldRow("学历", b.degree), fieldRow("性别", b.gender), fieldRow("工作年限", b.years));
  s1.append(g, plainRow("自我介绍", () => b.summary, (v) => (b.summary = v), { area: true }));
  root.append(s1, keywordsSection());

  const sw = sec("工作经历", () => { R.work.push({ id: uid(), start: "", end: "", company: F(), role: "", bullets: [] }); touch(); render(); }, "+ 添加经历", R.work.length >= 20);
  R.work.forEach((w, i) => {
    const top = h("div", "re-two"); top.append(plainRow("开始", () => w.start, (v) => (w.start = v), { ph: "2022.05" }), plainRow("结束", () => w.end, (v) => (w.end = v), { ph: "至今" }));
    sw.append(card(`经历 ${i + 1}`, [iconBtn("↑", "上移", () => move(R.work, i, -1), i === 0), iconBtn("↓", "下移", () => move(R.work, i, 1), i === R.work.length - 1), iconBtn("删除", "删除这段经历", () => { R.work.splice(i, 1); touch(); render(); }, false, "del")],
      [top, fieldRow("公司", w.company), plainRow("职位", () => w.role, (v) => (w.role = v)), bulletsEditor(w.bullets, "要点")]));
  });
  root.append(sw);

  const sp = sec("项目经历", () => { R.projects.push({ id: uid(), name: F(), client: null, desc: "", stack: [], bullets: [] }); touch(); render(); }, "+ 添加项目", R.projects.length >= 20);
  R.projects.forEach((p, i) => {
    const cl = p.client ? fieldRow("客户", p.client) : (() => { const r = h("div", "re-row"); const bb = h("button", "btn sm", "+ 添加客户"); bb.type = "button"; bb.addEventListener("click", () => { p.client = F(); touch(); render(); }); r.append(h("span", "re-l", "客户"), bb, h("span", "re-nolock")); return r; })();
    const stack = plainRow("技术栈", () => p.stack.join("、"), (v) => (p.stack = v.split(/[、，,]\s*/).map((x) => x.trim()).filter(Boolean)), { ph: "用顿号或逗号分隔" });
    sp.append(card(`项目 ${i + 1}`, [iconBtn("↑", "上移", () => move(R.projects, i, -1), i === 0), iconBtn("↓", "下移", () => move(R.projects, i, 1), i === R.projects.length - 1), iconBtn("删除", "删除这个项目", () => { R.projects.splice(i, 1); touch(); render(); }, false, "del")],
      [fieldRow("项目名", p.name), cl, plainRow("简介", () => p.desc, (v) => (p.desc = v), { area: true }), stack, bulletsEditor(p.bullets, "职责")]));
  });
  root.append(sp);

  const sk = sec("专业技能", () => { R.skills.push({ id: uid(), label: "", text: "" }); touch(); render(); }, "+ 添加技能", R.skills.length >= 30);
  R.skills.forEach((s, i) => {
    const row = h("div", "re-skill");
    row.append(txt(s.label, (v) => (s.label = v), `分组名 ${i + 1}`, { max: 200, ph: "后端框架" }), txt(s.text, (v) => (s.text = v), `内容 ${i + 1}`, { max: 200, ph: "Spring、SpringBoot…" }),
      iconBtn("↑", "上移", () => move(R.skills, i, -1), i === 0), iconBtn("↓", "下移", () => move(R.skills, i, 1), i === R.skills.length - 1), iconBtn("×", "删除", () => { R.skills.splice(i, 1); touch(); render(); }, false, "del"));
    sk.append(row);
  });
  root.append(sk);
  scrollTo(0, y);
}

/* ---------- 预览 ---------- */
/** 给「我看到的」预览里出现的额外敏感词加虚线下划线。只做标记，不做替换；用 textContent 切分 + span，不用 innerHTML。 */
function markKeywords(root: HTMLElement, kws: string[]) {
  const words = [...new Set(kws)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!words.length) return;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes: Text[] = [];
  for (let n = tw.nextNode(); n; n = tw.nextNode()) nodes.push(n as Text);
  for (const node of nodes) {
    const text = node.data; let i = 0, last = 0; const frag = document.createDocumentFragment(); let hit = false;
    while (i < text.length) {
      const w = words.find((x) => text.startsWith(x, i));   // 区分大小写，与服务端的 split/join 规则一致；不用正则
      if (w) { if (i > last) frag.append(document.createTextNode(text.slice(last, i))); const sp = h("span", "kw-mark", w); sp.title = "访客视图里会被隐藏"; frag.append(sp); i += w.length; last = i; hit = true; }
      else i++;
    }
    if (!hit) continue;
    if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
    node.replaceWith(frag);
  }
}
let pvT = 0, pvSeq = 0;
function schedulePreview() { clearTimeout(pvT); pvT = window.setTimeout(refreshPreview, 500); }
function maskedLocal(f: Field) { return { text: f.value, masked: false }; }
/** 「我看到的」：本地数据原样显示（不打码）；「访客看到的」：调用服务端预览接口，显示返回的 text（前端不做任何打码） */
async function refreshPreview() {
  const seq = ++pvSeq, out = $("re-rs"), st = $("pv-state");
  if (view === "me") {
    const b = R.basics, m = (f: Field) => maskedLocal(f);
    renderResume({ basics: { name: m(b.name), phone: m(b.phone), email: m(b.email), birth: m(b.birth), hometown: m(b.hometown), location: m(b.location), school: m(b.school), degree: m(b.degree), gender: m(b.gender), years: m(b.years), title: b.title, summary: b.summary },
      work: R.work.map((w) => ({ ...w, company: m(w.company) })), skills: R.skills, projects: R.projects.map((p) => ({ ...p, name: m(p.name), client: p.client ? m(p.client) : null })) }, out);
    markKeywords(out, R.keywords);
    st.textContent = R.keywords.length ? "完整内容。虚线下划线的词在访客视图里会被隐藏" : "完整内容，包含你填写的全部信息"; return;
  }
  st.textContent = dirty ? "访客视图来自已保存的版本，请先保存" : "已保存版本中访客会看到的样子";
  try {
    const r = await api<PResume>("/api/private/resume/preview");
    if (seq !== pvSeq || view !== "guest") return;
    renderResume(r, out);
  } catch (e) { if (seq === pvSeq) { out.replaceChildren(h("p", "rs-note", "预览失败：" + explain(e, OVERRIDES))); } }
}
function setView(v: "me" | "guest") { view = v; $("pv-me").setAttribute("aria-pressed", String(v === "me")); $("pv-guest").setAttribute("aria-pressed", String(v === "guest")); void refreshPreview(); }
$("pv-me").addEventListener("click", () => setView("me"));
$("pv-guest").addEventListener("click", () => setView("guest"));

/* ---------- 总开关 ---------- */
const sw = $("re-reveal");
function paintReveal() { sw.setAttribute("aria-checked", String(reveal)); $("re-reveal-hint").textContent = reveal ? "开启：访客看到完整信息" : "关闭：访客看到打码版"; $("re-reveal-hint").classList.toggle("on", reveal); }
sw.addEventListener("click", async () => {
  const next = !reveal;
  if (next && !(await confirmDialog({ title: "对外显示完整信息？", body: "访客将看到你的手机号、邮箱等全部信息。\n搜索引擎也可能收录这些信息；开启后页面会加上 noindex，但已被抓取的内容无法撤回。", confirmText: "开启", danger: true }))) return;
  try { await api("/api/private/resume/settings", jsonInit("PUT", { revealPublic: next })); reveal = next; paintReveal(); toast(next ? "已开启：访客现在能看到完整信息" : "已关闭：访客看到打码版", { kind: next ? "info" : "ok" }); if (view === "guest") void refreshPreview(); }
  catch (e) { fail("切换失败", e); }
});

/* ---------- 加载 / 保存 ---------- */
function clean(): Resume {
  const c = JSON.parse(JSON.stringify(R)) as Resume;
  c.work.forEach((w) => { w.bullets = w.bullets.filter((x) => x.trim() !== ""); });
  c.projects.forEach((p) => { p.bullets = p.bullets.filter((x) => x.trim() !== ""); if (p.client && !p.client.value.trim()) p.client = null; });
  c.skills = c.skills.filter((s) => s.label.trim() || s.text.trim());
  c.keywords = [...new Set(c.keywords.map((k) => k.trim()).filter((k) => len(k) >= KW_MIN && len(k) <= KW_MAX))].slice(0, KW_LIMIT);
  delete (c as Partial<Resume>).updatedAt;
  return c;
}
async function save() {
  if (busy) return; busy = true; ($("re-save") as HTMLButtonElement).disabled = true;
  try {
    const saved = await api<Resume>("/api/private/resume", jsonInit("PUT", clean()));
    if (saved && saved.basics) R = normalize(saved);
    render(); setDirty(false); $("re-msg").textContent = ""; $("re-msg").className = "re-msg";
    toast("简历已保存", { kind: "ok" }); void refreshPreview();
  } catch (e) { fail("保存失败", e); }
  finally { busy = false; ($("re-save") as HTMLButtonElement).disabled = false; }
}
function normalize(x: Loaded): Resume {
  const e = empty(), b = x.basics ?? ({} as Resume["basics"]);
  for (const k of Object.keys(e.basics) as (keyof Resume["basics"])[]) {
    const v = (b as Record<string, unknown>)[k];
    if (typeof e.basics[k] === "string") (e.basics as Record<string, unknown>)[k] = typeof v === "string" ? v : "";
    else if (v && typeof v === "object") (e.basics as Record<string, unknown>)[k] = { value: String((v as Field).value ?? ""), sensitive: !!(v as Field).sensitive };
  }
  const fld = (v: unknown, d: boolean): Field => (v && typeof v === "object" ? { value: String((v as Field).value ?? ""), sensitive: !!(v as Field).sensitive } : F("", d));
  e.work = (x.work ?? []).map((w) => ({ id: w.id || uid(), start: w.start ?? "", end: w.end ?? "", company: fld(w.company, true), role: w.role ?? "", bullets: [...(w.bullets ?? [])] }));
  e.skills = (x.skills ?? []).map((s) => ({ id: s.id || uid(), label: s.label ?? "", text: s.text ?? "" }));
  e.keywords = [...new Set((Array.isArray(x.keywords) ? x.keywords : []).map((k) => String(k).trim()).filter((k) => len(k) >= KW_MIN && len(k) <= KW_MAX))].slice(0, KW_LIMIT);
  e.projects = (x.projects ?? []).map((p) => ({ id: p.id || uid(), name: fld(p.name, true), client: p.client ? fld(p.client, true) : null, desc: p.desc ?? "", stack: [...(p.stack ?? [])], bullets: [...(p.bullets ?? [])] }));
  return e;
}
$("re-save").addEventListener("click", () => void save());
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } });
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

document.querySelectorAll<HTMLButtonElement>(".re-tabs button").forEach((b) => b.addEventListener("click", () => {
  $("re").dataset.tab = b.dataset.t!; document.querySelectorAll(".re-tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  if (b.dataset.t === "preview") void refreshPreview();
}));

(async () => {
  try {
    const r = await api<Loaded>("/api/private/resume");
    R = normalize(r); reveal = !!r.settings?.revealPublic;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "no_resume" && code !== "not_found") fail("读取失败", e);
    else { $("re-msg").textContent = "还没有简历，直接填写后保存即可。"; $("re-msg").className = "re-msg"; }
  }
  paintReveal(); render(); setDirty(false); void refreshPreview();
})();
