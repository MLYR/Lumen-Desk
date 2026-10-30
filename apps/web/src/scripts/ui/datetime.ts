// 替换 datetime-local：原生 input 保留并隐藏，value 格式不变（YYYY-MM-DDTHH:mm）。
import { bind, leave, mk, place, restoreFocus, uid } from "./pop";

const p2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const fmt = (d: Date) => `${ymd(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const parse = (v: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null; };
const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const day0 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const WEEK = "日一二三四五六";
const ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="5" width="16" height="15"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>';

export function enhanceDateTime(input: HTMLInputElement) {
  const wrap = mk("div", "ui-dt"), btn = mk("button", "ui-dt-btn"), val = mk("span", "ui-dt-val"), ic = mk("span", "ui-dt-ic");
  btn.type = "button"; btn.setAttribute("aria-haspopup", "dialog"); btn.setAttribute("aria-expanded", "false");
  const lab = input.getAttribute("aria-label");
  if (lab) btn.setAttribute("aria-label", lab);
  ic.innerHTML = ICON; // 常量，不含用户内容
  btn.append(val, ic);
  input.before(wrap); wrap.append(btn, input); input.classList.add("ui-native"); input.tabIndex = -1; input.setAttribute("aria-hidden", "true");

  const paint = () => {
    const d = parse(input.value);
    val.textContent = d ? `${ymd(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}` : "选择日期和时间";
    val.classList.toggle("is-ph", !d);
    btn.disabled = input.disabled;
  };
  const pd = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
  Object.defineProperty(input, "value", { configurable: true, get: () => pd.get!.call(input), set: (v) => { pd.set!.call(input, v); paint(); } });
  input.focus = () => btn.focus();
  const setVal = (v: string) => {
    if (input.value === v) return;
    input.value = v;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  let pop: HTMLElement | null = null, off = () => {}, grid!: HTMLElement, title!: HTMLElement, hh!: HTMLInputElement, mm!: HTMLInputElement;
  let vy = 0, vm = 0, fd = day0(new Date());

  function render() {
    const cur = parse(input.value), today = new Date(), first = new Date(vy, vm, 1), lead = (first.getDay() + 6) % 7;
    title.textContent = `${vy}年${vm + 1}月`;
    grid.replaceChildren();
    const head = mk("div", "ui-row"); head.setAttribute("role", "row");
    for (const w of "一二三四五六日") { const c = mk("div", "ui-wd", w); c.setAttribute("role", "columnheader"); head.append(c); }
    grid.append(head);
    for (let r = 0; r < 6; r++) {
      const row = mk("div", "ui-row"); row.setAttribute("role", "row");
      for (let c = 0; c < 7; c++) {
        const d = new Date(vy, vm, 1 - lead + r * 7 + c), cell = mk("div", "ui-cell"), b = mk("button", "ui-day", String(d.getDate()));
        cell.setAttribute("role", "gridcell");
        b.type = "button";
        b.setAttribute("aria-label", `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK[d.getDay()]}`);
        b.tabIndex = same(d, fd) ? 0 : -1;
        if (d.getMonth() !== vm) b.classList.add("out");
        if (same(d, today)) b.classList.add("today");
        if (cur && same(d, cur)) { b.classList.add("sel"); cell.setAttribute("aria-selected", "true"); }
        b.addEventListener("click", () => choose(d));
        cell.append(b); row.append(cell);
      }
      grid.append(row);
    }
  }
  const focusDay = () => (grid.querySelector('.ui-day[tabindex="0"]') as HTMLElement | null)?.focus();
  const goto = (d: Date) => { fd = d; vy = d.getFullYear(); vm = d.getMonth(); render(); focusDay(); };
  const shiftMonth = (d: Date, n: number) => {
    const t = new Date(d.getFullYear(), d.getMonth() + n, 1), last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last));
  };
  const time = () => ({ h: Math.min(23, Math.max(0, parseInt(hh.value, 10) || 0)), m: Math.min(59, Math.max(0, parseInt(mm.value, 10) || 0)) });
  function choose(d: Date) { const t = time(); setVal(fmt(new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.h, t.m))); close(true); }
  function commitTime() {
    const t = time(), c = parse(input.value) ?? fd;
    hh.value = p2(t.h); mm.value = p2(t.m);
    setVal(fmt(new Date(c.getFullYear(), c.getMonth(), c.getDate(), t.h, t.m)));
    render();
  }
  function tn(label: string, max: number) {
    const i = mk("input", "ui-tn");
    i.type = "text"; i.inputMode = "numeric"; i.maxLength = 2; i.autocomplete = "off"; i.setAttribute("aria-label", label);
    i.addEventListener("input", () => { i.value = i.value.replace(/\D/g, "").slice(0, 2); });
    i.addEventListener("change", commitTime);
    i.addEventListener("focus", () => i.select());
    i.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        i.value = p2((((parseInt(i.value, 10) || 0) + (e.key === "ArrowUp" ? 1 : -1)) % (max + 1) + max + 1) % (max + 1));
        commitTime();
      } else if (e.key === "Enter") { e.preventDefault(); commitTime(); close(true); }
    });
    return i;
  }
  function nav(text: string, label: string, n: number) {
    const b = mk("button", "ui-nav", text); b.type = "button"; b.setAttribute("aria-label", label);
    b.addEventListener("click", () => { fd = shiftMonth(fd, n); vy = fd.getFullYear(); vm = fd.getMonth(); render(); });
    return b;
  }
  function open() {
    if (pop || input.disabled) return;
    const cur = parse(input.value), base = cur ?? new Date(), p = (pop = mk("div", "ui-pop ui-dtp"));
    p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "选择日期和时间");
    fd = day0(base); vy = fd.getFullYear(); vm = fd.getMonth();
    const head = mk("div", "ui-dt-head");
    title = mk("span", "ui-dt-title"); title.id = uid("ui-dm"); title.setAttribute("aria-live", "polite");
    head.append(nav("‹", "上个月", -1), title, nav("›", "下个月", 1));
    grid = mk("div", "ui-grid"); grid.setAttribute("role", "grid"); grid.setAttribute("aria-labelledby", title.id);
    grid.addEventListener("keydown", (e) => {
      const k = e.key, a = document.activeElement as HTMLElement;
      if (!a.classList.contains("ui-day") || e.altKey || e.ctrlKey || e.metaKey) return;
      const lead = (fd.getDay() + 6) % 7;
      const next = k === "ArrowLeft" ? addDays(fd, -1) : k === "ArrowRight" ? addDays(fd, 1) : k === "ArrowUp" ? addDays(fd, -7) : k === "ArrowDown" ? addDays(fd, 7)
        : k === "Home" ? addDays(fd, -lead) : k === "End" ? addDays(fd, 6 - lead) : k === "PageUp" ? shiftMonth(fd, -1) : k === "PageDown" ? shiftMonth(fd, 1) : null;
      if (next) { e.preventDefault(); goto(next); }
    });
    const t = base, row = mk("div", "ui-time"), tl = mk("span", "ui-tl", "时间");
    hh = tn("小时", 23); mm = tn("分钟", 59); hh.value = p2(t.getHours()); mm.value = p2(t.getMinutes());
    const now = mk("button", "ui-btn ghost sm", "现在"), clr = mk("button", "ui-btn ghost sm", "清空");
    now.type = "button"; clr.type = "button";
    now.onclick = () => { setVal(fmt(new Date())); close(true); };
    clr.onclick = () => { setVal(""); close(true); };
    const grp = mk("span", "ui-tbtn"); grp.append(now, clr);
    row.append(tl, hh, mk("span", "ui-colon", ":"), mm, grp);
    p.append(head, grid, row);
    p.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === "Tab") { // 浮层不是模态：从首尾 Tab 出去就关闭
        const f = [...p.querySelectorAll<HTMLElement>("button:not([tabindex='-1']), input")].filter((x) => x.tabIndex >= 0);
        if (e.shiftKey ? document.activeElement === f[0] : document.activeElement === f[f.length - 1]) close(true);
      }
    });
    document.body.append(p);
    btn.setAttribute("aria-expanded", "true");
    render();
    const fit = () => place(btn, p, { width: 296 });
    fit();
    off = bind(btn, p, close, fit);
    focusDay();
  }
  function close(refocus: boolean) {
    if (!pop) return;
    const p = pop; pop = null; off();
    btn.setAttribute("aria-expanded", "false");
    leave(p, () => p.remove());
    restoreFocus(btn, refocus);
  }
  btn.addEventListener("click", () => (pop ? close(true) : open()));
  btn.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" && !pop) { e.preventDefault(); open(); } });
  paint();
  return { refresh: paint };
}
