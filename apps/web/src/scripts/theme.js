/* 主题切换：自动（06:00–18:00 白纸，其余蓝图）/ 白纸 / 蓝图。
   页面 <head> 里的内联脚本先用 resolveTheme 设好主题，避免闪烁；这里负责按钮和定时检查。 */
(function () {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const urlTheme = new URLSearchParams(location.search).get("theme");
  let mode = urlTheme || localStorage.getItem("themeMode") || "auto";

  function apply(animate) {
    const t = window.resolveTheme(mode);
    const set = () => {
      document.documentElement.dataset.theme = t;
      document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === mode));
    };
    if (animate && t !== document.documentElement.dataset.theme && document.startViewTransition && !reduce) document.startViewTransition(set);
    else set();
  }
  window.setThemeMode = function (m) { mode = m; localStorage.setItem("themeMode", m); apply(true); };
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => window.setThemeMode(b.dataset.mode)));
  apply(false);
  setInterval(() => mode === "auto" && apply(true), 60 * 1000);
})();
