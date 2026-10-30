// 浮层共用：定位、点外部关闭、淡出。Select 和 DateTimePicker 用。
let n = 0;
export const uid = (p: string) => `${p}${++n}`;
export const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text; // 用户文字一律走 textContent
  return e;
};

/** 播放淡出后再执行 done。动画被关掉（prefers-reduced-motion）时立刻执行。 */
export function leave(el: HTMLElement, done: () => void) {
  el.classList.add("is-out");
  if (getComputedStyle(el).animationName === "none") return done();
  let fin = false;
  const f = () => { if (!fin) { fin = true; done(); } };
  el.addEventListener("animationend", (e) => { if (e.target === el) f(); });
  setTimeout(f, 250);
}

/** 浮层贴着触发按钮：默认在下方，下方放不下且上方更宽裕时向上弹；宽度不超出屏幕。 */
export function place(anchor: HTMLElement, pop: HTMLElement, o: { min?: number; width?: number } = {}) {
  const de = document.documentElement, vw = de.clientWidth, vh = de.clientHeight, M = 16, G = 4;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(o.width ?? Math.max(r.width, o.min ?? 0), vw - 2 * M);
  pop.style.width = w + "px";
  pop.style.left = Math.max(M, Math.min(r.left, vw - w - M)) + "px";
  pop.style.maxHeight = ""; pop.style.overflowY = "";
  const h = pop.offsetHeight, below = vh - r.bottom - M - G, above = r.top - M - G;
  const up = h > below && above > below, space = up ? above : below;
  if (h > space) { pop.style.maxHeight = Math.max(space, 120) + "px"; if (pop.scrollHeight > pop.clientHeight + 1) pop.style.overflowY = "auto"; }
  pop.classList.toggle("up", up);
  if (up) { pop.style.top = "auto"; pop.style.bottom = vh - r.top + G + "px"; }
  else { pop.style.bottom = "auto"; pop.style.top = r.bottom + G + "px"; }
}

/** 点浮层外部关闭；窗口缩放、页面滚动时重新定位。返回解除函数。 */
export function bind(anchor: HTMLElement, pop: HTMLElement, close: (refocus: boolean) => void, reflow: () => void) {
  const down = (e: Event) => { const t = e.target as Node; if (!pop.contains(t) && !anchor.contains(t)) close(false); };
  const move = (e: Event) => { if (!pop.contains(e.target as Node)) reflow(); };
  document.addEventListener("pointerdown", down, true);
  addEventListener("resize", reflow);
  addEventListener("scroll", move, true);
  return () => { document.removeEventListener("pointerdown", down, true); removeEventListener("resize", reflow); removeEventListener("scroll", move, true); };
}

/** 关闭后把焦点还给触发按钮；点外部关闭时，只有焦点落到 body 才还回去，不抢别处的焦点。 */
export function restoreFocus(btn: HTMLElement, force: boolean) {
  if (force) btn.focus();
  else setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) btn.focus(); }, 0);
}
