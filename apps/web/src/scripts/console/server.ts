// 服务器状态卡：每 5 秒刷新，页面在后台时暂停，切回来立刻刷新。
// 主机名、系统名称来自外部文件，不可信：全部用 textContent 写入，不拼 HTML。
type Svc = { id: string; name: string; ok: boolean; detail?: string };
type Srv = {
  host?: { name?: string; os?: string; kernel?: string; arch?: string; virtual?: "docker-vm" | "container" | null };
  cpu: { model?: string | null; cores: number; usage?: number; load1: number; load5: number; load15: number };
  mem: { total: number; used: number }; swap?: { total: number; used: number }; disk: { total: number; used: number; mount?: string };
  net?: { iface?: string; rxRate: number; txRate: number; rxTotal: number; txTotal: number } | null;
  uptime: number; hostUptime: number; services?: Svc[];
};

const $ = (id: string) => document.getElementById(id)!;
const KB = 1024;
/** 字节数自动换算成 KB/MB/GB/TB */
export function fmtBytes(b: number): string {
  if (!isFinite(b) || b < 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0, v = b;
  while (v >= KB && i < u.length - 1) { v /= KB; i++; }
  return (i === 0 || v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).toString().replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") + " " + u[i];
}
const fmtRate = (b: number) => fmtBytes(b) + "/s";
/** 「N 天 N 小时」或「N 小时 N 分」 */
export function fmtUp(s: number): string {
  if (!isFinite(s) || s < 0) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} 天 ${h} 小时` : h ? `${h} 小时 ${m} 分` : `${m} 分`;
}
const pct = (a: number, b: number) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);

function setStat(id: string, v: string, k: string, p: number, title?: string) {
  const el = $(id);
  el.querySelector(".v")!.textContent = v;
  el.querySelector(".k")!.textContent = k;
  (el.querySelector(".bar i") as HTMLElement).style.width = p.toFixed(0) + "%";
  el.classList.toggle("hot", p > 80); // 使用率超过 80% 用强调色
  if (title) el.title = title; else el.removeAttribute("title");
}
const TAG: Record<string, [string, string]> = {
  "docker-vm": ["Docker 虚拟机", "这是本机 Docker 虚拟机（例如 OrbStack）的数据，不是你的 Mac。CPU、内存、网络都来自这台虚拟机的内核。"],
  container: ["容器内视角", "没有挂载宿主机的文件，只能看到容器自己的视角，数据不代表宿主机。"],
};

function render(s: Srv) {
  const h = s.host ?? {}, tag = $("srvTag");
  const t = h.virtual ? TAG[h.virtual] : null;
  tag.hidden = !t;
  if (t) { tag.textContent = t[0]; tag.title = t[1]; }
  // 主机名 · 系统 · 架构 · N 核 型号
  const parts = [h.name, h.os, h.arch, `${s.cpu.cores} 核${s.cpu.model ? " " + s.cpu.model : ""}`].filter((x) => x && String(x).trim());
  const line = $("srvLine");
  line.textContent = parts.join(" · ") || "—";
  line.title = [...parts, h.kernel ? "内核 " + h.kernel : ""].filter(Boolean).join(" · ");

  const cpu = s.cpu.usage != null ? s.cpu.usage : pct(s.cpu.load1, s.cpu.cores); // 老接口没有 usage 时退回按负载估算
  setStat("stCpu", cpu.toFixed(0) + "%", `CPU · ${s.cpu.cores} 核`, cpu);
  setStat("stMem", pct(s.mem.used, s.mem.total).toFixed(0) + "%", `内存 ${fmtBytes(s.mem.used)} / ${fmtBytes(s.mem.total)}`, pct(s.mem.used, s.mem.total));
  setStat("stDisk", pct(s.disk.used, s.disk.total).toFixed(0) + "%", `磁盘 ${fmtBytes(s.disk.used)} / ${fmtBytes(s.disk.total)}`, pct(s.disk.used, s.disk.total), s.disk.mount ? `挂载点 ${s.disk.mount}` : undefined);
  if (!s.swap || s.swap.total <= 0) setStat("stSwap", "—", "交换 未启用", 0);
  else setStat("stSwap", pct(s.swap.used, s.swap.total).toFixed(0) + "%", `交换 ${fmtBytes(s.swap.used)} / ${fmtBytes(s.swap.total)}`, pct(s.swap.used, s.swap.total));

  const n = s.net;
  $("srvNet").classList.toggle("none", !n);
  $("srvRate").textContent = n ? `↓ ${fmtRate(n.rxRate)}  ↑ ${fmtRate(n.txRate)}` : "网络 —";
  $("srvTotal").textContent = n ? `累计 ↓ ${fmtBytes(n.rxTotal)} ↑ ${fmtBytes(n.txTotal)}` : "";
  $("srvNet").title = n?.iface ? `网卡 ${n.iface}` : "";

  $("svLoad").textContent = [s.cpu.load1, s.cpu.load5, s.cpu.load15].map((x) => Number(x).toFixed(2)).join(" / ");
  $("svUp").textContent = fmtUp(s.uptime);
  $("svHost").textContent = fmtUp(s.hostUptime);

  const ul = $("srvSvcs"); ul.replaceChildren();
  for (const v of s.services ?? []) {
    const li = document.createElement("li"), dot = document.createElement("span"), name = document.createElement("span");
    li.className = "sv " + (v.ok ? "ok" : "bad");
    dot.className = "dot"; dot.setAttribute("role", "img"); dot.setAttribute("aria-label", `${v.name}：${v.ok ? "正常" : "异常"}`);
    name.textContent = v.name + (v.detail ? " " + v.detail : "");
    li.append(dot, name); ul.append(li);
  }
}
function fail() {
  $("srvTag").hidden = true;
  $("srvLine").textContent = "—"; $("srvLine").removeAttribute("title");
  for (const id of ["stCpu", "stMem", "stDisk", "stSwap"]) {
    const el = $(id); el.classList.remove("hot");
    el.querySelector(".v")!.textContent = "—"; (el.querySelector(".bar i") as HTMLElement).style.width = "0";
    el.querySelector(".k")!.textContent = { stCpu: "CPU", stMem: "内存", stDisk: "磁盘", stSwap: "交换" }[id]!;
  }
  $("srvRate").textContent = "—"; $("srvTotal").textContent = ""; $("srvNet").classList.add("none");
  for (const id of ["svLoad", "svUp", "svHost"]) $(id).textContent = "—";
  $("srvSvcs").replaceChildren();
}

let busy = false;
async function load() {
  if (busy) return; busy = true;
  try {
    const res = await fetch("/api/private/server", { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) { location.href = "/login"; return; }
    if (!res.ok) throw new Error(String(res.status));
    render((await res.json()) as Srv);
  } catch { fail(); } // 请求失败显示「—」，不弹 toast
  finally { busy = false; }
}
export function startServerCard() {
  if (!document.hidden) void load();
  setInterval(() => { if (!document.hidden) void load(); }, 5000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void load(); });
}
