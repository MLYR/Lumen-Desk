import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { ConflictError, InputError, NotFoundError } from '../http.js';

/** 上传包与解压后的硬上限（3 Mbps 服务器带宽，别让一个实验拖垮整站）。 */
export const MAX_LAB_ZIP_BYTES = 15 * 1024 * 1024;
export const MAX_LAB_BYTES = 30 * 1024 * 1024;
export const MAX_LAB_FILES = 200;
export const MAX_LAB_TEXT_BYTES = 4 * 1024 * 1024;

const LAB_SLUG_RE = /^[a-z0-9-]{1,80}$/;

const ALLOWED_EXTS = new Set([
  'html', 'js', 'mjs', 'css', 'json', 'glsl', 'vert', 'frag', 'wgsl', 'wasm',
  'svg', 'webp', 'png', 'jpg', 'jpeg', 'gif', 'avif',
  'mp3', 'wav', 'ogg', 'woff2', 'txt', 'md',
]);

const TEXT_EXTS = new Set(['html', 'js', 'mjs', 'css', 'json', 'glsl', 'vert', 'frag', 'wgsl', 'svg', 'txt', 'md']);

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  glsl: 'text/plain; charset=utf-8',
  vert: 'text/plain; charset=utf-8',
  frag: 'text/plain; charset=utf-8',
  wgsl: 'text/plain; charset=utf-8',
  wasm: 'application/wasm',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
};

const BAD_NAME = /[\u0000-\u001f\u007f<>:"|?*\\]/;

export interface LabFile {
  path: string;
  size: number;
}

export interface ExtractResult {
  files: string[];
  entry: string;
  bytes: number;
}

export function labDir(dataDir: string, slug: string): string {
  if (!LAB_SLUG_RE.test(slug)) throw new InputError('slug 不合法');
  return path.join(dataDir, 'labs', slug);
}

/** 把 rel 规整成安全的相对路径；/、..、反斜杠、控制字符一律拒绝。 */
export function normalizeRel(rel: string): string {
  if (typeof rel !== 'string') throw new InputError('路径不合法');
  const raw = rel;
  if (!raw || raw.length > 240) throw new InputError('路径不合法');
  if (raw.startsWith('/')) throw new InputError('路径不合法');
  const parts = raw.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') throw new InputError('路径不合法');
    if (BAD_NAME.test(part) || part.endsWith('.') || part.endsWith(' ')) throw new InputError('路径不合法');
  }
  return parts.join('/');
}

function extOf(rel: string): string {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isAllowedExt(rel: string): boolean {
  return ALLOWED_EXTS.has(extOf(rel));
}

export function isTextFile(rel: string): boolean {
  return TEXT_EXTS.has(extOf(rel));
}

export function contentTypeOf(rel: string): string {
  return CONTENT_TYPES[extOf(rel)] ?? 'application/octet-stream';
}

/** 解压到 DATA_DIR/labs/<slug>/，先校验后落盘；返回文件清单和入口 HTML。 */
export function extractZip(dataDir: string, slug: string, buf: Uint8Array): ExtractResult {
  if (!buf.length) throw new InputError('压缩包是空的');
  if (buf.length > MAX_LAB_ZIP_BYTES) throw new InputError('压缩包不能超过 15 MB');

  let entries: Record<string, Uint8Array>;
  try {
    // filter 在解压前按中央目录里声明的大小先卡一遍，避免小包解出大文件。
    let declaredFiles = 0;
    let declaredBytes = 0;
    entries = unzipSync(buf, {
      filter: (file) => {
        if (!file.name || file.name.endsWith('/')) return false;
        const parts = file.name.split('/');
        if (parts.includes('__MACOSX')) return false;
        if (parts[parts.length - 1] === '.DS_Store') return false;
        if (++declaredFiles > MAX_LAB_FILES) throw new InputError(`文件数不能超过 ${MAX_LAB_FILES}`);
        declaredBytes += file.originalSize;
        if (declaredBytes > MAX_LAB_BYTES) throw new InputError('解压后不能超过 30 MB');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof InputError) throw err;
    throw new InputError('不是有效的 ZIP 文件');
  }

  const kept = new Map<string, Uint8Array>();
  let total = 0;
  for (const [name, data] of Object.entries(entries)) {
    if (!name || name.endsWith('/')) continue;
    const parts = name.split('/');
    if (parts.includes('__MACOSX')) continue;
    if (parts[parts.length - 1] === '.DS_Store') continue;

    const rel = normalizeRel(name);
    if (!ALLOWED_EXTS.has(extOf(rel))) throw new InputError(`不支持的文件类型：${rel}`);
    if (kept.size >= MAX_LAB_FILES) throw new InputError(`文件数不能超过 ${MAX_LAB_FILES}`);
    total += data.length;
    if (total > MAX_LAB_BYTES) throw new InputError('解压后不能超过 30 MB');
    kept.set(rel, data);
  }

  if (!kept.size) throw new InputError('压缩包里没有可用文件');

  // 包内若只有一层顶层目录（my-demo/index.html），剥掉它。
  let strip: string | null = null;
  const names = [...kept.keys()];
  const split = names.map((n) => n.split('/'));
  if (split.every((p) => p.length >= 2)) {
    const first = split[0]?.[0];
    if (first && split.every((p) => p[0] === first)) strip = first;
  }

  const files = new Map<string, Uint8Array>();
  for (const [name, data] of kept) {
    const rel = strip ? name.slice(strip.length + 1) : name;
    if (!rel) throw new InputError('压缩包目录结构不合法');
    if (files.has(rel)) throw new InputError(`压缩包里有重复文件：${rel}`);
    files.set(rel, data);
  }

  const sorted = [...files.keys()].sort((a, b) => a.localeCompare(b));
  const html = sorted.filter((f) => extOf(f) === 'html');
  if (!html.length) throw new InputError('压缩包里没有 .html 文件');
  const entry = files.has('index.html') ? 'index.html' : html[0] as string;

  const dir = labDir(dataDir, slug);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  for (const [rel, data] of files) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
    fs.writeFileSync(file, data, { mode: 0o644 });
  }

  return { files: sorted, entry, bytes: total };
}

function resolveInLab(dataDir: string, slug: string, rel: string): { root: string; file: string; rel: string } {
  const root = path.resolve(labDir(dataDir, slug));
  const clean = normalizeRel(rel);
  const file = path.resolve(root, ...clean.split('/'));
  if (file === root || !file.startsWith(root + path.sep)) throw new InputError('路径不合法');
  return { root, file, rel: clean };
}

export function listFiles(dataDir: string, slug: string): LabFile[] {
  const root = labDir(dataDir, slug);
  try {
    if (!fs.statSync(root).isDirectory()) return [];
  } catch {
    return [];
  }

  const out: LabFile[] = [];
  const walk = (dir: string, prefix: string): void => {
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        walk(path.join(dir, ent.name), rel);
      } else if (ent.isFile()) {
        let size = 0;
        try {
          size = fs.statSync(path.join(dir, ent.name)).size;
        } catch {
          // 文件在这一瞬间被删掉了，忽略大小即可。
        }
        out.push({ path: rel, size });
      }
    }
  };
  walk(root, '');
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export function readFile(dataDir: string, slug: string, rel: string): { path: string; data: Buffer } {
  const target = resolveInLab(dataDir, slug, rel);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target.file);
  } catch {
    throw new NotFoundError();
  }
  if (!stat.isFile()) throw new NotFoundError();
  return { path: target.rel, data: fs.readFileSync(target.file) };
}

export function writeFile(dataDir: string, slug: string, rel: string, content: string): { path: string; size: number } {
  const target = resolveInLab(dataDir, slug, rel);
  if (!isTextFile(target.rel)) throw new InputError('只能在线编辑文本文件');
  const size = Buffer.byteLength(content, 'utf8');
  if (size > MAX_LAB_TEXT_BYTES) throw new InputError('单个文件不能超过 4 MB');
  fs.mkdirSync(path.dirname(target.file), { recursive: true, mode: 0o755 });
  fs.writeFileSync(target.file, content, { encoding: 'utf8', mode: 0o644 });
  return { path: target.rel, size };
}

function pruneEmptyDirs(root: string, file: string): void {
  let dir = path.dirname(file);
  while (dir.startsWith(root + path.sep)) {
    try {
      fs.rmdirSync(dir);
    } catch {
      break;
    }
    dir = path.dirname(dir);
  }
}

export function removeFile(dataDir: string, slug: string, rel: string): string {
  const target = resolveInLab(dataDir, slug, rel);
  try {
    if (!fs.lstatSync(target.file).isFile()) throw new NotFoundError();
    fs.unlinkSync(target.file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError();
    throw err;
  }
  // 清掉删空的父目录，但绝不越过实验根目录。
  pruneEmptyDirs(target.root, target.file);
  return target.rel;
}

export function removeLabDir(dataDir: string, slug: string): void {
  fs.rmSync(labDir(dataDir, slug), { recursive: true, force: true });
}

function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** 为新建空白实验生成开箱即用的 Canvas 2D 动画骨架。 */
export function scaffoldBlankLab(dataDir: string, slug: string, title: string): { files: string[]; entry: string } {
  const dir = labDir(dataDir, slug);
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 });

  const safeTitle = escHtml(title);
  const indexHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <canvas id="stage"></canvas>
  <div class="hud">
    <span class="dot" aria-hidden="true"></span>
    <span>${safeTitle}</span>
  </div>
  <script type="module" src="./main.js"></script>
</body>
</html>
`;

  const styleCss = `*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #060913;
  color: #e2e8f0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

#stage {
  display: block;
  width: 100%;
  height: 100%;
}

.hud {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(148, 163, 184, 0.22);
  backdrop-filter: blur(8px);
  font-size: 13px;
  letter-spacing: 0.02em;
  pointer-events: none;
}

.hud .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #38bdf8;
  box-shadow: 0 0 10px #38bdf8;
}
`;

  const mainJs = `const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

let width = 0;
let height = 0;
let dpr = 1;

const nodes = Array.from({ length: 42 }, (_, index) => ({
  x: Math.random(),
  y: Math.random(),
  vx: (Math.random() - 0.5) * 0.0012,
  vy: (Math.random() - 0.5) * 0.0012,
  radius: 1.5 + (index % 3) * 0.9,
}));

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function frame(time) {
  ctx.fillStyle = 'rgba(6, 9, 19, 0.28)';
  ctx.fillRect(0, 0, width, height);

  const linkDist = Math.min(width, height) * 0.18;
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    a.x = (a.x + a.vx + 1) % 1;
    a.y = (a.y + a.vy + 1) % 1;
    const ax = a.x * width;
    const ay = a.y * height;

    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      const bx = b.x * width;
      const by = b.y * height;
      const dist = Math.hypot(ax - bx, ay - by);
      if (dist < linkDist) {
        const alpha = (1 - dist / linkDist) * 0.35;
        ctx.strokeStyle = \`rgba(56, 189, 248, \${alpha.toFixed(3)})\`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }

    const pulse = 0.65 + 0.35 * Math.sin(time * 0.002 + i);
    ctx.fillStyle = \`rgba(125, 211, 252, \${pulse.toFixed(3)})\`;
    ctx.beginPath();
    ctx.arc(ax, ay, a.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
ctx.fillStyle = '#060913';
ctx.fillRect(0, 0, width, height);
requestAnimationFrame(frame);
`;

  fs.writeFileSync(path.join(dir, 'index.html'), indexHtml, { encoding: 'utf8', mode: 0o644 });
  fs.writeFileSync(path.join(dir, 'style.css'), styleCss, { encoding: 'utf8', mode: 0o644 });
  fs.writeFileSync(path.join(dir, 'main.js'), mainJs, { encoding: 'utf8', mode: 0o644 });

  return { files: ['index.html', 'main.js', 'style.css'], entry: 'index.html' };
}

/** 把 DATA_DIR/labs/<slug>/ 打包成 ZIP；空目录返回合法空 ZIP。 */
export function exportLabZip(dataDir: string, slug: string): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of listFiles(dataDir, slug)) {
    entries[f.path] = new Uint8Array(readFile(dataDir, slug, f.path).data);
  }
  return zipSync(entries, { level: 6 });
}

/** 上传并写入单个资源或文本文件，校验扩展名、单文件与实验总量上限。 */
export function writeAssetFile(dataDir: string, slug: string, rel: string, data: Uint8Array): { path: string; size: number } {
  const target = resolveInLab(dataDir, slug, rel);
  if (!isAllowedExt(target.rel)) throw new InputError(`不支持的文件类型：${target.rel}`);
  if (data.byteLength > MAX_LAB_ZIP_BYTES) throw new InputError('单个文件不能超过 15 MB');

  const existing = listFiles(dataDir, slug);
  const exists = existing.some((f) => f.path === target.rel);
  const nextCount = exists ? existing.length : existing.length + 1;
  if (nextCount > MAX_LAB_FILES) throw new InputError(`文件数不能超过 ${MAX_LAB_FILES}`);
  const otherBytes = existing.reduce((sum, f) => (f.path === target.rel ? sum : sum + f.size), 0);
  if (otherBytes + data.byteLength > MAX_LAB_BYTES) throw new InputError('实验总大小不能超过 30 MB');

  try {
    if (fs.lstatSync(target.file).isDirectory()) throw new InputError('目标路径是目录');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  fs.mkdirSync(path.dirname(target.file), { recursive: true, mode: 0o755 });
  fs.writeFileSync(target.file, data, { mode: 0o644 });
  return { path: target.rel, size: data.byteLength };
}

/** 重命名或移动实验内单个文件，并清理删空的旧父目录。 */
export function renameFile(dataDir: string, slug: string, fromRel: string, toRel: string): string {
  const src = resolveInLab(dataDir, slug, fromRel);
  const dst = resolveInLab(dataDir, slug, toRel);
  if (!isAllowedExt(dst.rel)) throw new InputError(`不支持的文件类型：${dst.rel}`);

  let srcStat: fs.Stats;
  try {
    srcStat = fs.lstatSync(src.file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError();
    throw err;
  }
  if (!srcStat.isFile()) throw new NotFoundError();

  if (src.rel === dst.rel) return dst.rel;

  try {
    fs.lstatSync(dst.file);
    throw new ConflictError('file_exists', '目标文件名已存在');
  } catch (err) {
    if (err instanceof ConflictError) throw err;
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  fs.mkdirSync(path.dirname(dst.file), { recursive: true, mode: 0o755 });
  fs.renameSync(src.file, dst.file);
  pruneEmptyDirs(src.root, src.file);
  return dst.rel;
}
