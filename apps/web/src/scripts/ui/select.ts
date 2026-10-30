// 用自定义控件替换原生 <select>。原生 select 仍在 DOM 里（隐藏），value / change / 表单读写都照旧。
// 程序里改 select.value、改 options 都会自动同步显示，不用手动 refresh。
import { bind, leave, mk, place, restoreFocus, uid } from "./pop";

type Item = { o: HTMLOptionElement; t: string; s: string; a: boolean };

export function enhanceSelect(sel: HTMLSelectElement, opts: { searchable?: boolean; placeholder?: string; searchAt?: number; host?: () => HTMLElement } = {}) {
  const wrap = mk("div", "ui-select" + (sel.dataset.size ? " " + sel.dataset.size : ""));
  const btn = mk("button", "ui-select-btn"), val = mk("span", "ui-val"), listId = uid("ui-lb");
  btn.type = "button";
  btn.setAttribute("role", "combobox");
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", listId);
  const lab = sel.getAttribute("aria-label");
  if (lab) btn.setAttribute("aria-label", lab);
  btn.append(val);
  sel.before(wrap); wrap.append(btn, sel); sel.classList.add("ui-native"); sel.tabIndex = -1; sel.setAttribute("aria-hidden", "true");

  const items = (): Item[] => [...sel.options].map((o) => ({ o, t: o.textContent || "", s: o.dataset.sub || "", a: o.dataset.kind === "action" }));
  let pop: HTMLElement | null = null, ul!: HTMLElement, empty!: HTMLElement, search: HTMLInputElement | null = null;
  let view: number[] = [], act = -1, off = () => {}, buf = "", bufT = 0;

  function paint() {
    const o = sel.selectedOptions[0], ph = opts.placeholder !== undefined && (!o || o.value === "");
    val.textContent = ph ? opts.placeholder! : o?.textContent ?? "";
    val.classList.toggle("is-ph", ph);
    btn.disabled = sel.disabled;
    if (pop) renderList();
  }
  // 程序里 select.value = x 不会触发事件，所以接管这两个属性，保证显示同步。
  for (const k of ["value", "selectedIndex"] as const) {
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, k)!;
    Object.defineProperty(sel, k, { configurable: true, get: () => d.get!.call(sel), set: (v) => { d.set!.call(sel, v); paint(); } });
  }
  sel.focus = () => btn.focus();
  let queued = false;
  const mo = new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; paint(); }); } });
  mo.observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "data-sub", "data-kind", "label"] });

  const optId = (i: number) => `${listId}-${i}`;
  const ok = (i: number) => !!view.includes(i) && !sel.options[i].disabled;
  function setActive(i: number, scroll = true) {
    pop?.querySelector(".is-active")?.classList.remove("is-active");
    act = i;
    const li = i >= 0 ? (pop?.querySelector("#" + optId(i)) as HTMLElement | null) : null;
    for (const f of [btn, search]) { if (!f) continue; if (li) f.setAttribute("aria-activedescendant", li.id); else f.removeAttribute("aria-activedescendant"); }
    if (li) { li.classList.add("is-active"); if (scroll) li.scrollIntoView({ block: "nearest" }); }
  }
  function renderList() {
    const q = (search?.value || "").trim().toLowerCase(), all = items();
    view = all.map((_, i) => i).filter((i) => !q || (all[i].t + " " + all[i].s).toLowerCase().includes(q));
    ul.replaceChildren();
    view.forEach((i, k) => {
      const it = all[i], li = mk("li", "ui-opt" + (it.a ? " is-action" : ""));
      li.id = optId(i);
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(it.o.selected));
      if (it.o.disabled) li.setAttribute("aria-disabled", "true");
      if (it.a && !(k > 0 && all[view[k - 1]].a)) li.classList.add("sep");
      const main = mk("span", "ui-opt-main");
      main.append(mk("span", "ui-opt-t", it.t));
      if (it.s) main.append(mk("span", "ui-opt-s", it.s));
      li.append(main);
      if (it.o.selected) li.append(mk("span", "ui-ck"));
      li.addEventListener("mousedown", (e) => e.preventDefault()); // 不抢走输入框或按钮的焦点
      li.addEventListener("mousemove", () => { if (act !== i && !it.o.disabled) setActive(i, false); });
      li.addEventListener("click", () => pick(i));
      ul.append(li);
    });
    empty.hidden = view.length > 0;
    const cur = sel.selectedIndex;
    setActive(ok(act) ? act : ok(cur) ? cur : view.find((i) => !sel.options[i].disabled) ?? -1);
  }
  function open() {
    if (pop || sel.disabled) return;
    const p = (pop = mk("div", "ui-pop ui-lp"));
    if (opts.searchable && sel.options.length > (opts.searchAt ?? 8)) {
      search = mk("input");
      search.type = "text"; search.placeholder = "搜索…"; search.autocomplete = "off"; search.spellcheck = false;
      search.setAttribute("aria-label", "搜索选项"); search.setAttribute("aria-controls", listId);
      search.addEventListener("keydown", onKey);
      search.addEventListener("input", renderList);
      const box = mk("div", "ui-search"); box.append(search); p.append(box);
    }
    ul = mk("ul", "ui-list"); ul.id = listId; ul.setAttribute("role", "listbox");
    empty = mk("div", "ui-empty", "没有匹配项");
    p.append(ul, empty);
    // 在模态 <dialog> 里使用时，浮层要挂进弹框，否则会被顶层的弹框盖住
    (opts.host?.() ?? (btn.closest("dialog") as HTMLElement | null) ?? document.body).append(p);
    btn.setAttribute("aria-expanded", "true");
    act = -1;
    renderList();
    const fit = () => place(btn, p, { min: 200 });
    fit();
    off = bind(btn, p, close, fit);
    search?.focus();
  }
  function close(refocus: boolean) {
    if (!pop) return;
    const p = pop; pop = null; search = null; off();
    btn.setAttribute("aria-expanded", "false"); btn.removeAttribute("aria-activedescendant");
    leave(p, () => p.remove());
    restoreFocus(btn, refocus);
  }
  function pick(i: number) {
    const o = sel.options[i];
    if (!o || o.disabled) return;
    const changed = sel.selectedIndex !== i;
    sel.selectedIndex = i;
    close(true);
    if (changed) { sel.dispatchEvent(new Event("input", { bubbles: true })); sel.dispatchEvent(new Event("change", { bubbles: true })); }
  }
  function move(d: number) {
    const en = view.filter((i) => !sel.options[i].disabled), at = en.indexOf(act);
    if (!en.length) return;
    setActive(en[Math.max(0, Math.min(en.length - 1, at < 0 ? (d > 0 ? 0 : en.length - 1) : at + d))]);
  }
  function ahead(ch: string) {
    clearTimeout(bufT); buf += ch.toLowerCase(); bufT = window.setTimeout(() => (buf = ""), 700);
    const en = view.filter((i) => !sel.options[i].disabled), at = en.indexOf(act), n = en.length;
    for (let k = 0; k < n; k++) {
      const i = en[(at + (buf.length === 1 ? 1 : 0) + k + n) % n];
      if ((sel.options[i].textContent || "").trim().toLowerCase().startsWith(buf)) { setActive(i); return; }
    }
  }
  function onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    const k = e.key, inInput = e.target === search, plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!pop) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") { e.preventDefault(); open(); }
      else if (k.length === 1 && plain) {
        e.preventDefault(); open();
        if (search) { search.value = k; renderList(); } else ahead(k);
      }
      return;
    }
    if (k === "ArrowDown") { e.preventDefault(); move(1); }
    else if (k === "ArrowUp") { e.preventDefault(); move(-1); }
    else if ((k === "Home" || k === "End") && (!inInput || !search!.value)) { e.preventDefault(); const en = view.filter((i) => !sel.options[i].disabled); if (en.length) setActive(en[k === "Home" ? 0 : en.length - 1]); }
    else if (k === "Enter" || (k === " " && !inInput)) { e.preventDefault(); if (act >= 0) pick(act); }
    else if (k === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (k === "Tab") close(true); // 不拦截，焦点接着往下一个控件走
    else if (!inInput && k.length === 1 && plain) { e.preventDefault(); ahead(k); }
  }
  btn.addEventListener("click", () => (pop ? close(true) : open()));
  btn.addEventListener("keydown", onKey);
  paint();

  return {
    refresh: paint,
    destroy() {
      close(false); mo.disconnect();
      delete (sel as { value?: unknown }).value; delete (sel as { selectedIndex?: unknown }).selectedIndex; delete (sel as { focus?: unknown }).focus;
      sel.classList.remove("ui-native"); wrap.replaceWith(sel);
    },
  };
}
