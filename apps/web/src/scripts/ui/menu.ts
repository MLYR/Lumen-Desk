// 小菜单（WAI-ARIA menu button 模式）：「⋯」和「管理」按钮用。和头像菜单的键盘行为一致。
// 菜单项只用 textContent。items 在每次打开时重新取，所以菜单内容可以随状态变化。
import { bind, leave, mk, place, uid } from "./pop";

export type MenuItem = { label: string; run?: () => void; href?: string; download?: boolean; danger?: boolean; disabled?: boolean } | "sep";

export function attachMenu(btn: HTMLElement, items: () => MenuItem[]) {
  let pop: HTMLElement | null = null, off = () => {};
  const id = uid("ui-menu");
  btn.setAttribute("aria-haspopup", "menu"); btn.setAttribute("aria-expanded", "false");
  const els = () => [...(pop?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
  function open(focus: "first" | "last" = "first") {
    if (pop) return;
    const p = (pop = mk("div", "ui-pop ui-menu")); p.id = id; p.setAttribute("role", "menu");
    p.setAttribute("aria-label", btn.getAttribute("aria-label") || "菜单");
    for (const it of items()) {
      if (it === "sep") { const hr = mk("div", "ui-msep"); hr.setAttribute("role", "separator"); p.append(hr); continue; }
      const cls = "ui-mi" + (it.danger ? " danger" : "");
      if (it.href) { // 链接型菜单项（例如导出）：直接下载，不经过脚本
        const a = mk("a", cls, it.label); a.href = it.href; a.tabIndex = -1; a.setAttribute("role", "menuitem");
        if (it.download) a.setAttribute("download", "");
        a.addEventListener("click", () => close(false));
        p.append(a); continue;
      }
      const b = mk("button", cls, it.label);
      b.type = "button"; b.tabIndex = -1; b.setAttribute("role", "menuitem");
      if (it.disabled) b.setAttribute("aria-disabled", "true");
      b.addEventListener("click", () => { if (it.disabled) return; close(true); setTimeout(() => it.run?.(), 0); });
      p.append(b);
    }
    (btn.closest("dialog") ?? document.body).append(p);
    btn.setAttribute("aria-expanded", "true"); btn.setAttribute("aria-controls", id);
    const fit = () => place(btn, p, { min: 168, width: 200, align: "end" }); // 右边对齐按钮
    fit();
    off = bind(btn, p, close, fit);
    const e = els(); (focus === "first" ? e[0] : e[e.length - 1])?.focus();
    p.addEventListener("keydown", (ev) => {
      const e = els(), i = e.indexOf(document.activeElement as HTMLElement), k = ev.key;
      if (k === "ArrowDown") { ev.preventDefault(); e[(i + 1) % e.length]?.focus(); }
      else if (k === "ArrowUp") { ev.preventDefault(); e[(i - 1 + e.length) % e.length]?.focus(); }
      else if (k === "Home") { ev.preventDefault(); e[0]?.focus(); }
      else if (k === "End") { ev.preventDefault(); e[e.length - 1]?.focus(); }
      else if (k === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(true); }
      else if (k === "Tab") close(false);
    });
  }
  function close(refocus: boolean) {
    if (!pop) return;
    const p = pop; pop = null; off();
    btn.setAttribute("aria-expanded", "false");
    leave(p, () => p.remove());
    if (refocus) btn.focus();
  }
  btn.addEventListener("click", (e) => { e.stopPropagation(); pop ? close(true) : open("first"); });
  btn.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // Alt+↑/↓ 留给行排序
    if (e.key === "ArrowDown") { e.preventDefault(); open("first"); }
    else if (e.key === "ArrowUp") { e.preventDefault(); open("last"); }
    else if (e.key === "Escape") close(true);
  });
  return { open, close: () => close(false) };
}
