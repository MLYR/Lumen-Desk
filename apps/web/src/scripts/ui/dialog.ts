// 弹框：基于原生 <dialog>.showModal()，自带焦点锁定和 Esc。文字一律走 textContent，body 里允许 \n 换行。
import { leave, mk, uid } from "./pop";
import { enhanceSelect } from "./select";

export function modal<T>(cls: string, cancel: T, build: (d: HTMLDialogElement, fin: (v: T) => void) => HTMLElement): Promise<T> {
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
export const button = (text: string, cls: string, type: "button" | "submit" = "button") => { const b = mk("button", "ui-btn " + cls, text); b.type = type; return b; };
export const actions = (...b: HTMLElement[]) => { const a = mk("div", "ui-dialog-actions"); a.append(...b); return a; };
export function title(d: HTMLElement, text: string) {
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

export type FormField =
  | { name: string; label: string; type?: "text" | "url"; value?: string; placeholder?: string; maxLength?: number; required?: boolean; mono?: boolean }
  | { name: string; label: string; type: "select"; value?: string; options: { value: string; label: string; sub?: string }[]; searchable?: boolean; required?: boolean };

/**
 * 多字段表单弹框：文字输入和下拉选择。返回字段值（文本字段已 trim），取消返回 null。
 * 下拉用 enhanceSelect（可搜索，选项显示完整路径）。validate 返回错误文字时弹框不关闭，错误显示在表单下方。
 */
export function formDialog(o: { title: string; fields: FormField[]; confirmText?: string; validate?(v: Record<string, string>): string | null }): Promise<Record<string, string> | null> {
  return modal<Record<string, string> | null>("ui-dialog ui-form", null, (d, fin) => {
    const form = mk("form"), body = mk("div", "ui-dialog-body"), err = mk("p", "ui-err");
    form.noValidate = true;
    err.setAttribute("role", "alert");
    body.append(title(d, o.title));
    const get: (() => [string, string])[] = [];
    let first: HTMLElement | null = null;
    for (const f of o.fields) {
      const id = uid("ui-f"), lab = mk("label", "ui-label", f.label);
      lab.htmlFor = id;
      if (f.type === "select") {
        const sel = mk("select"); sel.id = id; sel.setAttribute("aria-label", f.label);
        for (const x of f.options) { const op = new Option(x.label, x.value); if (x.sub) op.dataset.sub = x.sub; sel.append(op); }
        if (f.value !== undefined) sel.value = f.value;
        body.append(lab, sel);
        enhanceSelect(sel, { searchable: f.searchable, searchAt: 6 });
        get.push(() => [f.name, sel.value]);
        lab.htmlFor = ""; lab.addEventListener("click", () => sel.focus());
        first ??= sel.parentElement!.querySelector<HTMLElement>(".ui-select-btn");
      } else {
        const input = mk("input", "ui-input" + (f.mono ? " mono" : ""));
        input.id = id; input.type = "text"; input.autocomplete = "off"; input.spellcheck = false;
        input.value = f.value ?? ""; input.placeholder = f.placeholder ?? "";
        if (f.maxLength) input.maxLength = f.maxLength;
        input.addEventListener("input", () => { err.textContent = ""; input.removeAttribute("aria-invalid"); });
        body.append(lab, input);
        get.push(() => [f.name, input.value.trim()]);
        first ??= input;
      }
    }
    body.append(err);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = Object.fromEntries(get.map((g) => g()));
      const missing = o.fields.find((f) => (f.required ?? true) && !v[f.name]);
      const m = missing ? `${missing.label}不能为空` : o.validate?.(v) ?? null;
      if (m) {
        err.textContent = m;
        return;
      }
      fin(v);
    });
    const no = button("取消", "ghost");
    no.onclick = () => fin(null);
    form.append(body, actions(no, button(o.confirmText ?? "保存", "primary", "submit")));
    d.append(form);
    return first!;
  });
}

/** 多个选项的弹框（例如导入方式）。默认焦点在取消上；danger 的选项用强调色。取消返回 null。 */
export function choiceDialog(o: { title: string; body?: string; choices: { text: string; value: string; danger?: boolean }[]; cancelText?: string }): Promise<string | null> {
  return modal<string | null>("ui-dialog", null, (d, fin) => {
    const body = mk("div", "ui-dialog-body");
    body.append(title(d, o.title));
    if (o.body) { const p = mk("p", "ui-dialog-text", o.body); p.id = uid("ui-dd"); d.setAttribute("aria-describedby", p.id); body.append(p); }
    const no = button(o.cancelText ?? "取消", "ghost");
    no.onclick = () => fin(null);
    const bs = o.choices.map((c) => { const b = button(c.text, c.danger ? "primary danger" : ""); b.onclick = () => fin(c.value); return b; });
    d.append(body, actions(no, ...bs));
    return no;
  });
}
