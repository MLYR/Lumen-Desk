// 博客阅读体验：目录高亮、阅读进度、浮动按钮、锚点复制、窄屏抽屉、搜索框移位。
// 导航和目录是服务端生成的，这里只加交互。契约见 docs/contracts/blog-reader.md。
const root = document.documentElement;
const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s);
const $$ = <T extends HTMLElement>(s: string) => [...document.querySelectorAll<T>(s)];
const mk = <K extends keyof HTMLElementTagNameMap>(t: K, cls: string, text = "") => { const e = document.createElement(t); e.className = cls; e.textContent = text; return e; };
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

if ($(".post-layout")) {
  /* 搜索框移进左侧导航 */
  const box = $(".blog-search"), slot = $(".blog-nav-search");
  if (box && slot) slot.append(box);

  /* 提示 */
  const tip = mk("div", "rd-toast"); tip.setAttribute("role", "status"); document.body.append(tip);
  let tipT = 0;
  const say = (t: string) => { tip.textContent = t; tip.classList.add("on"); clearTimeout(tipT); tipT = window.setTimeout(() => tip.classList.remove("on"), 2000); };

  /* 目录、标题锚点 */
  const prose = $(".prose"), hs = $$(".prose h2[id], .prose h3[id]");
  const links = $$<HTMLAnchorElement>(".post-toc a, .toc-inline a");
  for (const h of hs) { const b = mk("button", "h-a", "#"); b.type = "button"; b.setAttribute("aria-label", "复制本节链接"); h.append(b); }
  document.addEventListener("click", (e) => {
    const t = e.target as Element;
    const a = t.closest<HTMLAnchorElement>(".post-toc a, .toc-inline a");
    if (a) {
      const el = document.getElementById(dec(a.hash.slice(1)));
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: reduce.matches ? "auto" : "smooth", block: "start" });
      history.replaceState(null, "", a.hash);
      return;
    }
    const b = t.closest<HTMLElement>(".h-a");
    if (b) {
      const id = b.parentElement!.id, url = location.origin + location.pathname + "#" + encodeURIComponent(id);
      // 站点还在 http 的 IP 上时没有 clipboard：退而把链接写进地址栏
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
        () => say("已复制本节链接"),
        () => { history.replaceState(null, "", "#" + encodeURIComponent(id)); say("链接已写入地址栏，可直接复制"); });
    }
  });

  /* 浮动按钮 */
  const fab = mk("div", "rd-fab"), up = mk("button", "", "↑"), down = mk("button", "", "↓");
  up.type = down.type = "button";
  up.setAttribute("aria-label", "回到顶部"); down.setAttribute("aria-label", "直达底部");
  const go = (top: number) => scrollTo({ top, behavior: reduce.matches ? "auto" : "smooth" });
  up.onclick = () => go(0);
  down.onclick = () => go(root.scrollHeight);
  fab.append(up, down); document.body.append(fab);

  /* 滚动：当前一节、阅读进度、浮动按钮。rAF 节流 */
  const prog = $(".toc-progress"), bar = $(".toc-progress span"), tocList = $(".post-toc > ol");
  let cur = -2, raf = 0;
  const mark = (i: number) => {
    if (i === cur) return;
    cur = i;
    links.forEach((a) => a.removeAttribute("aria-current"));
    if (i < 0) return;
    const id = hs[i].id;
    for (const a of links) if (dec(a.hash.slice(1)) === id) a.setAttribute("aria-current", "true");
    const a = tocList?.querySelector<HTMLElement>("[aria-current]");
    if (tocList && a) { // 目录很长时，让当前项留在可视区域里
      const t = a.getBoundingClientRect().top - tocList.getBoundingClientRect().top;
      if (t < 24 || t > tocList.clientHeight - 48) tocList.scrollTop += t - tocList.clientHeight / 2;
    }
  };
  const update = () => {
    raf = 0;
    const y = scrollY, vh = innerHeight, H = root.scrollHeight, end = y + vh >= H - 8;
    let i = -1;
    for (let k = 0; k < hs.length && hs[k].getBoundingClientRect().top <= 100; k++) i = k;
    mark(end && hs.length ? hs.length - 1 : i);
    if (prose && prog && bar) {
      const top = prose.getBoundingClientRect().top + y;
      const p = Math.min(1, Math.max(0, (y - top + 80) / Math.max(1, prose.offsetHeight - vh + 80)));
      bar.style.width = p * 100 + "%"; prog.dataset.p = String(Math.round(p * 100));
    }
    fab.classList.toggle("on", y > vh * 0.8);
    up.hidden = y < 8; down.hidden = end;
  };
  const tick = () => { raf ||= requestAnimationFrame(update); };
  addEventListener("scroll", tick, { passive: true });
  addEventListener("resize", tick);
  update();

  /* 窄屏抽屉 */
  const nav = $("#blog-nav");
  if (nav) {
    const btn = mk("button", "nav-open-btn", "文章列表"), x = mk("button", "nav-x", "×"), scrim = mk("div", "nav-scrim");
    btn.type = x.type = "button";
    btn.setAttribute("aria-controls", "blog-nav"); btn.setAttribute("aria-expanded", "false");
    x.setAttribute("aria-label", "关闭文章列表");
    nav.before(btn); nav.prepend(x); document.body.append(scrim);
    const isOpen = () => root.classList.contains("nav-open");
    const open = () => {
      root.classList.add("nav-open"); btn.setAttribute("aria-expanded", "true");
      nav.setAttribute("role", "dialog"); nav.setAttribute("aria-modal", "true");
      x.focus();
    };
    const close = (back = true) => {
      if (!isOpen()) return;
      root.classList.remove("nav-open"); btn.setAttribute("aria-expanded", "false");
      nav.removeAttribute("role"); nav.removeAttribute("aria-modal");
      if (back) btn.focus();
    };
    btn.onclick = open; x.onclick = () => close(); scrim.onclick = () => close();
    nav.addEventListener("click", (e) => { if ((e.target as Element).closest("a")) close(false); });
    matchMedia("(min-width: 900px)").addEventListener("change", (e) => e.matches && close(false));
    document.addEventListener("keydown", (e) => {
      if (!isOpen()) return;
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab") { // 焦点锁在抽屉里
        const f = [...nav.querySelectorAll<HTMLElement>("a[href], button, input, summary")].filter((n) => n.offsetParent);
        const a = document.activeElement;
        if (e.shiftKey && (a === f[0] || !nav.contains(a))) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (a === f[f.length - 1] || !nav.contains(a))) { e.preventDefault(); f[0].focus(); }
      }
    });
  }
}
