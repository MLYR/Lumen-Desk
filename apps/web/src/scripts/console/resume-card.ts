// 控制台「简历」卡片：只读摘要（经历、项目、技能数量，打码状态，最近更新）。数据来自私有接口，全部用 textContent 写入。
type F = { value: string; sensitive: boolean } | null | undefined;
type R = {
  basics?: Record<string, unknown>; work?: Array<{ company?: F; role?: string; start?: string; end?: string }>; projects?: Array<{ name?: F; client?: F }>;
  skills?: unknown[]; keywords?: unknown[]; updatedAt?: string; settings?: { revealPublic?: boolean };
};
const $ = (id: string) => document.getElementById(id)!;
const set = (id: string, v: string) => { $(id).textContent = v; };
const isF = (f: unknown): f is { value: string; sensitive: boolean } => !!f && typeof f === "object" && "sensitive" in (f as object);

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso); if (isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function startResumeCard(): Promise<void> {
  const badge = $("rsBadge");
  try {
    const res = await fetch("/api/private/resume", { credentials: "same-origin", cache: "no-store" });
    if (res.status === 401) { location.href = "/login"; return; }
    if (res.status === 404) {
      badge.textContent = "未导入"; badge.className = "rs-badge";
      set("rsNote", "还没有简历，点右上角「编辑简历」开始填写");
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    const r = (await res.json()) as R;
    const reveal = r.settings?.revealPublic === true;
    badge.textContent = reveal ? "完整信息对外" : "访客看到打码版";
    badge.className = "rs-badge " + (reveal ? "reveal" : "masked");
    set("rsNote", reveal ? "所有访客都能看到手机号、邮箱等完整信息" : "姓名、联系方式、公司等敏感信息对访客隐藏");
    let masked = 0;
    for (const v of Object.values(r.basics ?? {})) if (isF(v) && v.sensitive && v.value) masked++;
    for (const w of r.work ?? []) if (isF(w.company) && w.company.sensitive && w.company.value) masked++;
    for (const p of r.projects ?? []) { if (isF(p.name) && p.name.sensitive && p.name.value) masked++; if (isF(p.client) && p.client.sensitive && p.client.value) masked++; }
    const kw = Array.isArray(r.keywords) ? r.keywords.length : 0;
    set("rsWork", String(r.work?.length ?? 0));
    set("rsProj", String(r.projects?.length ?? 0));
    set("rsSkill", String(r.skills?.length ?? 0));
    set("rsMasked", kw ? `${masked} + ${kw} 词` : String(masked));
    set("rsUpdated", fmtTime(r.updatedAt));
    // 最近两段经历（控制台只有自己能看，显示原文）。
    const ul = $("rsRecent"); ul.replaceChildren();
    const recent = (r.work ?? []).slice(0, 2);
    if (!recent.length) { const li = document.createElement("li"); li.className = "rs-empty"; li.textContent = "还没有填写工作经历"; ul.append(li); }
    for (const w of recent) {
      const li = document.createElement("li");
      const when = document.createElement("span"); when.className = "when"; when.textContent = `${w.start ?? ""} — ${w.end ?? ""}`;
      const what = document.createElement("span"); what.className = "what";
      const text = [isF(w.company) ? w.company.value : "", w.role ?? ""].filter(Boolean).join(" · ");
      what.textContent = text; what.title = text;
      li.append(when, what); ul.append(li);
    }
  } catch {
    badge.textContent = "—"; badge.className = "rs-badge";
    set("rsNote", "简历信息暂时读取不到");
  }
}
