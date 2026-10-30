// 把本地 .md 文件读成编辑器字段。纯函数，不碰 DOM。
// 只做简单的 frontmatter 解析，不引入 YAML 库。全程按行扫描，没有会回溯的正则，耗时与文件大小成线性。
export const MAX_MD_BYTES = 1024 * 1024;

export type ParsedMd = {
  title: string;
  slug: string;
  summary: string;
  tags: string[];
  status: "draft" | "published";
  publishedAt: Date;
  markdown: string;
  /** 需要提示用户的问题；没有则为空数组 */
  warnings: string[];
};

const unquote = (s: string): string => {
  const t = s.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) return t.slice(1, -1).trim();
  return t;
};

type Front = { kv: Map<string, string>; lists: Map<string, string[]>; end: number };

/** lines[0] 必须是单独一行的 ---。找不到结束行或遇到读不懂的行时返回 null。 */
function readFront(lines: string[]): Front | null {
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trimEnd() === "---") { end = i; break; }
  }
  if (end < 0) return null;
  const kv = new Map<string, string>();
  const lists = new Map<string, string[]>();
  let listKey: string | null = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t || t[0] === "#") continue;
    if (listKey !== null && t[0] === "-" && (t.length === 1 || t[1] === " " || t[1] === "\t")) {
      lists.get(listKey)!.push(unquote(t.slice(1)));
      continue;
    }
    if (line[0] === " " || line[0] === "\t") continue; // 多行值的续行，不认识就忽略
    const ci = t.indexOf(":");
    if (ci <= 0) return null;
    const key = t.slice(0, ci).trim().toLowerCase();
    let val = t.slice(ci + 1).trim();
    if (val.length <= 2 && (val[0] === "|" || val[0] === ">")) val = ""; // 块标量，不支持
    kv.set(key, val);
    if (val === "") { listKey = key; lists.set(key, []); } else listKey = null;
  }
  return { kv, lists, end };
}

function parseTags(front: Front): string[] {
  const l = front.lists.get("tags");
  let raw: string[];
  if (l && l.length) raw = l;
  else {
    let v = front.kv.get("tags") ?? "";
    if (v.startsWith("[") && v.endsWith("]")) v = v.slice(1, -1);
    raw = v.split(/[,，]/);
  }
  const out: string[] = [];
  for (const x of raw) {
    const t = unquote(x);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

const DATE_ONLY = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** 只写日期按当天 00:00 本地时间；日期加时间按 ISO 解析（无时区按本地）；其余用 fallback。 */
export function parseDate(v: string | undefined, fallback: Date): Date {
  const s = unquote(v ?? "");
  if (!s || s.length > 40) return fallback;
  const m = DATE_ONLY.exec(s);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    const date = new Date(y, mo - 1, d, 0, 0, 0, 0);
    return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : fallback;
  }
  if (!DATE_TIME.test(s)) return fallback;
  const t = Date.parse(s.replace(" ", "T"));
  if (isNaN(t)) return fallback;
  const date = new Date(t);
  return date.getFullYear() >= 1970 && date.getFullYear() <= 2100 ? date : fallback;
}

/** 去掉 ATX 标题末尾的 # 序列。只处理最后一段，线性。 */
function cleanHeading(s: string): string {
  let t = s.trim();
  let j = t.length;
  while (j > 0 && t[j - 1] === "#") j--;
  if (j < t.length && (j === 0 || t[j - 1] === " ")) t = t.slice(0, j).trim();
  return t;
}

/** 第一个代码围栏之外的 "# 标题" 行的下标，没有返回 -1。 */
function findH1(lines: string[]): number {
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const s = l.trimStart();
    if (s.startsWith("```") || s.startsWith("~~~")) { fence = !fence; continue; }
    if (!fence && l.startsWith("# ")) return i;
  }
  return -1;
}

export function parseMdFile(raw: string, fileName: string, now: Date): ParsedMd {
  let text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  text = text.replace(/\r\n?/g, "\n");
  let lines = text.split("\n");
  const warnings: string[] = [];
  let front: Front | null = null;

  if (lines[0].trimEnd() === "---") {
    front = readFront(lines);
    if (front) lines = lines.slice(front.end + 1);
    else warnings.push("没能读取文件头信息，已把全文放进正文");
  }
  const kv = front?.kv ?? new Map<string, string>();

  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  lines = lines.slice(start);

  let title = unquote(kv.get("title") ?? "");
  if (!title) {
    const i = findH1(lines);
    if (i >= 0) {
      title = cleanHeading(lines[i].slice(2));
      if (i === 0) { // 标题就是正文第一行：从正文里去掉，避免页面上标题重复
        let k = 1;
        while (k < lines.length && lines[k].trim() === "") k++;
        lines = lines.slice(k);
      }
    }
  }
  if (!title) {
    const dot = fileName.lastIndexOf(".");
    title = (dot > 0 ? fileName.slice(0, dot) : fileName).trim();
  }

  let slug = unquote(kv.get("slug") ?? "");
  if (slug && !/^[a-z0-9-]{1,80}$/.test(slug)) { warnings.push("slug 不合法，已留空"); slug = ""; }

  const isDraft = unquote(kv.get("draft") ?? "").toLowerCase() === "true" || unquote(kv.get("published") ?? "").toLowerCase() === "false";

  return {
    title: [...title].slice(0, 200).join(""),
    slug,
    summary: [...unquote(kv.get("summary") ?? kv.get("description") ?? "")].slice(0, 500).join(""),
    tags: front ? parseTags(front) : [],
    status: isDraft ? "draft" : "published",
    publishedAt: parseDate(kv.get("date") ?? kv.get("publishedat"), now),
    markdown: lines.join("\n"),
    warnings,
  };
}
