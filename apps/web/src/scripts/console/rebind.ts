// 重新绑定验证器：3 步弹框。接口见 docs/contracts/totp-rebind.md 第 2 节。
// 二维码用 <img src="data:image/svg+xml;base64,…"> 显示（不用 innerHTML）；
// 密钥和二维码只存在于弹框的 DOM 和这个函数的局部变量里：不写 localStorage、不进 URL、不打日志；弹框关闭时一并移除。
import { api, apiRaw, explain, jsonInit } from "./common";
import { modal, button, actions, title } from "../ui/dialog";
import { mk } from "../ui/pop";
import { toast } from "../ui/toast";

type Pending = { otpauthUri: string; qrSvg: string; secret: string; expiresAt: string | number };
const OVR: Record<string, string> = {
  invalid_code: "验证码不正确，或已经用过，请等下一个验证码再试",
  locked: "尝试次数过多，已被暂时锁定，请稍后再试",
  pending_expired: "已超过 10 分钟，这次绑定作废了。请关闭后重新开始",
};
const fmt = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const group4 = (s: string) => s.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();

export async function openRebind(onDone?: () => void) {
  let pendingSet = false, finished = false;
  await modal<boolean>("ui-dialog rebind", false, (d, fin) => {
    d.setAttribute("aria-describedby", "");
    const body = mk("div", "ui-dialog-body"), foot = mk("div");
    d.append(body, foot);
    let timer = 0, expires = 0;
    const cleanup = () => {
      clearInterval(timer);
      body.replaceChildren(); foot.replaceChildren(); // 二维码和密钥从 DOM 中移除
      if (pendingSet && !finished) { pendingSet = false; void apiRaw("/api/private/security/totp/pending", { method: "DELETE" }).catch(() => {}); } // 关闭 = 取消
    };
    // 弹框关闭（Esc、点遮罩、取消、完成）都会走到这里
    d.addEventListener("close", cleanup);
    const origRemove = d.remove.bind(d); d.remove = () => { cleanup(); origRemove(); };
    const stepper = (n: number) => { const s = mk("ol", "rb-steps"); ["当前验证码", "扫码绑定", "完成"].forEach((t, i) => { const li = mk("li", i + 1 === n ? "on" : i + 1 < n ? "done" : "", `${i + 1}. ${t}`); if (i + 1 === n) li.setAttribute("aria-current", "step"); s.append(li); }); return s; };
    const err = mk("p", "ui-err"); err.setAttribute("role", "alert");
    const codeInput = (label: string, onFull: (v: string) => void) => {
      const lab = mk("label", "ui-label", label), i = mk("input", "ui-input mono rb-code");
      i.type = "text"; i.inputMode = "numeric"; i.maxLength = 6; i.autocomplete = "one-time-code"; i.placeholder = "000000"; i.id = "rb-" + Math.random().toString(36).slice(2, 7); lab.htmlFor = i.id;
      i.addEventListener("input", () => { i.value = i.value.replace(/\D/g, "").slice(0, 6); err.textContent = ""; if (i.value.length === 6) onFull(i.value); }); // 输满 6 位自动提交
      return { lab, i };
    };

    /* 步骤 1：当前验证码 */
    const step1 = () => {
      body.replaceChildren(); foot.replaceChildren();
      const h = title(d, "重新绑定验证器");
      const { lab, i } = codeInput("当前验证器上的 6 位码", (v) => void go(v));
      let busy = false;
      const go = async (v: string) => {
        if (busy) return; busy = true; i.disabled = true; err.textContent = "";
        try {
          const p = await api<Pending>("/api/private/security/totp/rebind", jsonInit("POST", { code: v }));
          pendingSet = true; step2(p);
        } catch (e) { err.textContent = explain(e, OVR); i.disabled = false; i.value = ""; i.focus(); busy = false; }
      };
      body.append(h, stepper(1), mk("p", "ui-dialog-text", "先证明是你本人：输入现在用的验证器上显示的 6 位码。新验证器确认之前，旧的一直有效。"), lab, i, err);
      const no = button("取消", "ghost"); no.onclick = () => fin(false);
      foot.replaceChildren(actions(no));
      i.focus();
    };

    /* 步骤 2：扫码 + 新验证码 */
    const step2 = (p: Pending) => {
      body.replaceChildren(); foot.replaceChildren();
      const h = title(d, "扫码绑定新验证器");
      const qr = mk("div", "rb-qr"), img = mk("img");
      // 二维码始终白底（含四周留白），两套主题下都能扫出来
      img.width = 200; img.height = 200; img.alt = "绑定验证器的二维码";
      try { img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(p.qrSvg))); } catch { img.alt = "二维码生成失败，请用下面的密钥手动输入"; }
      qr.append(img);
      const det = mk("details", "rb-manual"), sum = mk("summary", "", "扫不了码？手动输入密钥"), sec = mk("div", "rb-secret");
      const code = mk("code", "", group4(p.secret)); code.setAttribute("aria-label", "密钥");
      const cp = button("复制", "ghost sm"); cp.onclick = async () => { try { await navigator.clipboard.writeText(p.secret.replace(/\s+/g, "")); toast("已复制密钥", { kind: "ok" }); } catch { toast("复制失败，请手动选中密钥", { kind: "err" }); } };
      sec.append(code, cp); det.append(sum, sec);
      const cd = mk("p", "rb-count"); cd.setAttribute("role", "timer");
      expires = typeof p.expiresAt === "number" ? p.expiresAt : Date.parse(p.expiresAt);
      if (!isFinite(expires)) expires = Date.now() + 10 * 60 * 1000;
      const tick = () => { const left = expires - Date.now(); cd.textContent = left > 0 ? `${fmt(left)} 内完成` : "已超时，请关闭后重新开始"; cd.classList.toggle("warn", left < 60000); if (left <= 0) { clearInterval(timer); ok.disabled = true; } };
      const { lab, i } = codeInput("新验证器上的 6 位码", (v) => void go(v));
      const ok = button("确认绑定", "primary"); ok.disabled = true;
      i.addEventListener("input", () => { ok.disabled = i.value.length !== 6 || expires - Date.now() <= 0; });
      let busy = false;
      const go = async (v: string) => {
        if (busy) return; busy = true; i.disabled = true; ok.disabled = true; err.textContent = "";
        try {
          await api("/api/private/security/totp/confirm", jsonInit("POST", { code: v }));
          finished = true; pendingSet = false; clearInterval(timer); step3();
        } catch (e) {
          err.textContent = explain(e, OVR); busy = false; i.disabled = false; i.value = ""; i.focus();
          if ((e as { code?: string }).code === "pending_expired") { clearInterval(timer); pendingSet = false; i.disabled = true; cd.textContent = "已超时，请关闭后重新开始"; }
        }
      };
      ok.onclick = () => { if (i.value.length === 6) void go(i.value); };
      body.append(h, stepper(2), qr, det, cd, lab, i, err);
      const no = button("取消", "ghost"); no.onclick = () => fin(false);
      foot.replaceChildren(actions(no, ok));
      tick(); timer = window.setInterval(tick, 1000); i.focus();
    };

    /* 步骤 3：完成 */
    const step3 = () => {
      body.replaceChildren(); foot.replaceChildren();
      body.append(title(d, "已绑定新的验证器"), stepper(3), mk("p", "ui-dialog-text", "已绑定新的验证器，其他设备已退出登录。旧的验证器条目可以删除了。"));
      const done = button("完成", "primary"); done.onclick = () => fin(true);
      foot.replaceChildren(actions(done)); done.focus(); onDone?.();
    };
    step1();
    return d.querySelector<HTMLElement>("input") ?? d;
  });
}
