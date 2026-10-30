// 弹框：基于原生 <dialog>.showModal()，自带焦点锁定和 Esc。文字一律走 textContent，body 里允许 \n 换行。
import { leave, mk, uid } from "./pop";

function modal<T>(cls: string, cancel: T, build: (d: HTMLDialogElement, fin: (v: T) => void) => HTMLElement): Promise<T> {
  return new Promise((resolve) => {
    const d = mk("dialog", cls), prev = document.activeElement as HTMLElement | null;
    let over = false;
    const fin = (v: T) => {
      if (over) return;
      over = true;
      leave(d, () => { if (d.open) d.close(); d.remove(); if (prev && prev.isConnected) prev.focus(); resolve(v); });
    };
    const target = build(d, fin);
    document.body.append(d);
    d.addEventListener("cancel", (e) => { e.preventDefault(); fin(cancel); }); // Esc
    d.addEventListener("close", () => fin(cancel));
    let down = false;
    d.addEventListener("pointerdown", (e) => { down = e.target === d; });
    d.addEventListener("click", (e) => { if (e.target === d && down) fin(cancel); }); // 点遮罩
    d.showModal();
    target.focus();
    if (target instanceof HTMLInputElement) target.select();
  });
}
const button = (text: string, cls: string, type: "button" | "submit" = "button") => { const b = mk("button", "ui-btn " + cls, text); b.type = type; return b; };
const actions = (...b: HTMLElement[]) => { const a = mk("div", "ui-dialog-actions"); a.append(...b); return a; };
function title(d: HTMLElement, text: string) {
  const h = mk("h2", "ui-dialog-title", text); h.id = uid("ui-dt");
  d.setAttribute("aria-labelledby", h.id);
  return h;
}

export function confirmDialog(o: { title: string; body?: string; confirmText?: string; cancelText?: string; danger?: boolean }): Promise<boolean> {
  return modal("ui-dialog" + (o.danger ? " danger" : ""), false, (d, fin) => {
    const body = mk("div", "ui-dialog-body");
    body.append(title(d, o.title));
    if (o.body) { const p = mk("p", "ui-dialog-text", o.body); p.id = uid("ui-dd"); d.setAttribute("aria-describedby", p.id); body.append(p); }
    if (o.danger) body.append(mk("p", "ui-note", "此操作无法撤销"));
    const ok = button(o.confirmText ?? "确定", "primary"), no = button(o.cancelText ?? "取消", "ghost");
    ok.onclick = () => fin(true);
    no.onclick = () => fin(false);
    d.append(body, actions(no, ok));
    return o.danger ? no : ok; // 危险操作默认停在取消上
  });
}

export function promptDialog(o: { title: string; label: string; value?: string; placeholder?: string; maxLength?: number; validate?(v: string): string | null }): Promise<string | null> {
  return modal<string | null>("ui-dialog", null, (d, fin) => {
    const form = mk("form"), body = mk("div", "ui-dialog-body");
    form.noValidate = true;
    const input = mk("input", "ui-input"), lab = mk("label", "ui-label", o.label), err = mk("p", "ui-err");
    input.id = uid("ui-pi"); lab.htmlFor = input.id;
    input.type = "text"; input.autocomplete = "off"; input.value = o.value ?? ""; input.placeholder = o.placeholder ?? "";
    if (o.maxLength) input.maxLength = o.maxLength;
    err.setAttribute("role", "alert");
    body.append(title(d, o.title), lab, input, err);
    input.addEventListener("input", () => { err.textContent = ""; input.removeAttribute("aria-invalid"); });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim(), m = !v ? "不能为空" : o.validate?.(v) ?? null;
      if (m) { err.textContent = m; input.setAttribute("aria-invalid", "true"); input.focus(); return; }
      fin(v);
    });
    const no = button("取消", "ghost");
    no.onclick = () => fin(null);
    form.append(body, actions(no, button("确定", "primary", "submit")));
    d.append(form);
    return input;
  });
}
