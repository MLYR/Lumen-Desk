// 控制台顶栏：头像按钮和菜单（WAI-ARIA menu button 模式）。三个控制台页面共用。
import { $, api, initialOf, safeAvatar } from "./common";

export type Fact = { label: string; value: string };
export type Link = { label: string; url: string };
export type Profile = { name: string; tagline: string; bio: string; avatar: string | null; facts: Fact[]; links: Link[] };

let cache: Promise<Profile | null> | null = null;
/** 整个页面只请求一次。失败时返回 null，页面保留默认文案。 */
export function getProfile(): Promise<Profile | null> {
  if (!cache) cache = api<Profile>("/api/private/profile").catch(() => null);
  return cache;
}
export function setProfileCache(p: Profile) { cache = Promise.resolve(p); paintAvatar(p); }

function paintAvatar(p: Profile | null) {
  const img = $<HTMLImageElement>("avatar-img"), ini = $("avatar-initial"), btn = $("avatar-btn");
  if (!img || !ini) return;
  const src = p ? safeAvatar(p.avatar) : null;
  if (src) { img.src = src; img.hidden = false; ini.hidden = true; }
  else { img.removeAttribute("src"); img.hidden = true; ini.hidden = false; ini.textContent = initialOf(p?.name ?? "zreo"); }
  if (p) btn.setAttribute("aria-label", `账号菜单（${p.name}）`);
}

const btn = $<HTMLButtonElement>("avatar-btn"), menu = $("avatar-menu");
if (btn && menu) {
  const items = () => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const isOpen = () => !menu.hidden;
  const open = (focus: "first" | "last" | "none" = "first") => {
    menu.hidden = false; btn.setAttribute("aria-expanded", "true");
    const it = items();
    if (focus === "first") it[0]?.focus(); else if (focus === "last") it[it.length - 1]?.focus();
  };
  const close = (refocus = false) => {
    if (!isOpen()) return;
    menu.hidden = true; btn.setAttribute("aria-expanded", "false");
    if (refocus) btn.focus();
  };
  btn.addEventListener("click", () => (isOpen() ? close() : open("first")));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); open("first"); }
    else if (e.key === "ArrowUp") { e.preventDefault(); open("last"); }
    else if (e.key === "Escape") close(true);
  });
  menu.addEventListener("keydown", (e) => {
    const it = items(), i = it.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); it[(i + 1) % it.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); it[(i - 1 + it.length) % it.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); it[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); it[it.length - 1].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "Tab") close();
  });
  // 点菜单外部关闭
  document.addEventListener("pointerdown", (e) => { if (isOpen() && !menu.contains(e.target as Node) && !btn.contains(e.target as Node)) close(); });
  document.addEventListener("focusin", (e) => { if (isOpen() && !menu.contains(e.target as Node) && !btn.contains(e.target as Node)) close(); });

  $("logout").addEventListener("click", async () => {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch {}
    location.href = "/login";
  });

  void getProfile().then(paintAvatar);
}
