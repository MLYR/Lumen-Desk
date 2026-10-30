// 控制台各页面共用：转义、接口封装、错误码中文提示。
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export const ERRORS: Record<string, string> = {
  invalid_request: "内容不符合要求，请检查输入",
  slug_taken: "这个 slug 已被占用",
  name_taken: "这个名称已被占用",
  not_found: "找不到这一项，可能已被删除",
  payload_too_large: "内容太大，超过了上限",
  unsupported_media_type: "不支持这种文件格式",
  bad_origin: "请求来源不被允许，请从站点本身打开此页面",
  unauthorized: "登录已失效，请重新登录",
  rate_limited: "请求太频繁，请稍后再试",
  invalid_code: "验证码不正确，或已经用过，请等下一个验证码",
  locked: "尝试次数过多，已被暂时锁定",
  invalid_move: "不能把文件夹移到它自己下面",
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, public detail?: string, public retryAfter?: number) { super(code); }
}

/** 所有接口都走这里。401 跳 /login（invalid_code 例外：那是验证码错，不是登录失效）；其余错误抛 ApiError。返回原始 Response（要读响应头时用）。 */
export async function apiRaw(url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, "network");
  }
  if (!res.ok) {
    let code = "http_" + res.status, detail: string | undefined, retry: number | undefined;
    try {
      const j = await res.json();
      if (j && typeof j.error === "string") code = j.error;
      if (j && typeof j.message === "string") detail = j.message;
      if (j && Number(j.retryAfter) > 0) retry = Number(j.retryAfter);
    } catch {}
    if (res.status === 401 && code !== "invalid_code") {
      location.href = "/login";
      throw new ApiError(401, "unauthorized");
    }
    throw new ApiError(res.status, code, detail, retry);
  }
  return res;
}
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await apiRaw(url, init);
  if (res.status === 204) return undefined as T;
  const t = await res.text(); // 201 可能没有响应体
  return (t ? JSON.parse(t) : undefined) as T;
}

/** overrides 用于某个页面对个别错误码用更具体的说法（例如 not_found -> 文章不存在）。 */
export function explain(e: unknown, overrides: Record<string, string> = {}): string {
  if (!(e instanceof ApiError)) return "出错了，请重试";
  if (e.code === "network") return "网络错误，请重试";
  if ((e.code === "locked" || e.code === "rate_limited") && e.retryAfter) return `${ERRORS[e.code]}，请 ${Math.max(1, Math.ceil(e.retryAfter / 60))} 分钟后再试`;
  return overrides[e.code] || ERRORS[e.code] || e.detail || `出错了（${e.code}）`;
}
export const jsonInit = (method: string, body?: unknown): RequestInit =>
  body === undefined ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };

/** 头像只接受站内上传目录。 */
export const safeAvatar = (u: unknown): string | null => (typeof u === "string" && /^\/uploads\/[A-Za-z0-9._-]+$/.test(u) ? u : null);
export const initialOf = (name: string) => ([...(name || "").trim()][0] || "z").toUpperCase();

/* 收藏夹和命令面板共用的小工具（从 main.ts 挪来，逻辑不变） */
export const initials = (n: string) => { const s = n.replace(/^[\s\[\(【]+/, ""); return /^[\u4e00-\u9fa5]/.test(s) ? s[0] : (s.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || s[0] || "?"); };
export const hostOf = (u: string) => { try { const x = new URL(u); return x.protocol.startsWith("http") ? x.hostname.replace(/^www\./, "") : x.protocol.replace(":", ""); } catch { return ""; } };
export const isLan = (h: string) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
/** 白名单：浏览器解析协议前会去掉制表符、换行等，所以不能用黑名单。非 http(s) 返回 "#"。 */
export const safeUrl = (u: string) => {
  try {
    return ["http:", "https:"].includes(new URL(u).protocol) ? u : "#";
  } catch {
    return "#";
  }
};
/** 能点开的链接只有 http(s)。 */
export const isWeb = (u: string) => safeUrl(u) !== "#";
/** javascript: 小书签（用 URL 解析，所以 java\tscript: 这类写法也能识别）。 */
export const isBookmarklet = (u: string) => { try { return new URL(u).protocol === "javascript:"; } catch { return /^[\s\u0000-\u0020]*j[\s\u0000-\u0020]*a[\s\u0000-\u0020]*v[\s\u0000-\u0020]*a[\s\u0000-\u0020]*s[\s\u0000-\u0020]*c[\s\u0000-\u0020]*r[\s\u0000-\u0020]*i[\s\u0000-\u0020]*p[\s\u0000-\u0020]*t[\s\u0000-\u0020]*:/i.test(u); } };
