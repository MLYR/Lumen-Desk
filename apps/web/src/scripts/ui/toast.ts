// 右下角 Toast：最多 3 条，默认 3 秒（err 6 秒），悬停暂停，可手动关闭。
import { leave, mk } from "./pop";

let box: HTMLElement | null = null;
const GLYPH = { ok: "✓", err: "!", info: "i" } as const;

export function toast(text: string, o: { kind?: "ok" | "err" | "info"; duration?: number } = {}) {
  const kind = o.kind ?? "ok", total = o.duration ?? (kind === "err" ? 6000 : 3000);
  if (!box) {
    box = mk("div", "ui-toasts");
    box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite");
    box.setAttribute("popover", "manual"); // 放进顶层，才不会被打开的弹框盖住
    document.body.append(box);
  }
  const b = box;
  while (b.children.length >= 3) b.firstElementChild!.remove();

  const t = mk("div", "ui-toast k-" + kind), msg = mk("span", "ui-tm", text), x = mk("button", "ui-tx", "×"), bar = mk("i", "ui-bar");
  if (kind === "err") t.setAttribute("role", "alert");
  x.type = "button"; x.setAttribute("aria-label", "关闭");
  const ic = mk("span", "ui-ti", GLYPH[kind]); ic.setAttribute("aria-hidden", "true");
  bar.style.animationDuration = total + "ms";
  t.append(ic, msg, x, bar);
  b.append(t);

  let left = total, started = 0, timer = 0, gone = false;
  const dismiss = () => { if (gone) return; gone = true; clearTimeout(timer); leave(t, () => t.remove()); };
  const run = () => { started = Date.now(); timer = window.setTimeout(dismiss, left); };
  const hold = () => { if (gone || !timer) return; clearTimeout(timer); timer = 0; left -= Date.now() - started; t.classList.add("paused"); };
  const go = () => { if (gone || timer) return; t.classList.remove("paused"); run(); };
  t.addEventListener("mouseenter", hold); t.addEventListener("mouseleave", go);
  t.addEventListener("focusin", hold); t.addEventListener("focusout", go);
  x.addEventListener("click", dismiss);
  run();

  // 有弹框打开时把容器重新提到最上层
  if (document.querySelector("dialog[open]") && b.hidePopover) { try { b.hidePopover(); b.showPopover(); } catch { /* 不支持就算了 */ } }
  else if (b.showPopover && !b.matches(":popover-open")) { try { b.showPopover(); } catch { /* 同上 */ } }
}
