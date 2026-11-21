// 零依赖轻量语法高亮代码编辑器：行号栏 (.ce-gutter) + 高亮渲染层 (.ce-hl) + 透明输入层 (.ce-input)
import { esc } from "./common";

export type LangKind = "js" | "glsl" | "html" | "css" | "json" | "md" | "txt";

const JS_KW = new Set([
  "import", "export", "from", "default", "as", "const", "let", "var", "function", "return",
  "if", "else", "for", "while", "do", "switch", "case", "break", "continue", "class",
  "extends", "new", "this", "super", "async", "await", "try", "catch", "finally", "throw",
  "typeof", "instanceof", "in", "of", "true", "false", "null", "undefined", "void", "delete",
  "static", "get", "set", "yield", "debugger",
]);

const JS_TYPES = new Set([
  "Math", "window", "document", "console", "THREE", "Float32Array", "Float64Array",
  "Uint8Array", "Uint8ClampedArray", "Uint16Array", "Uint32Array", "Int8Array", "Int16Array", "Int32Array",
  "ArrayBuffer", "DataView", "Promise", "Array", "Object", "Map", "Set", "WeakMap", "WeakSet",
  "Number", "String", "Boolean", "Symbol", "BigInt", "JSON", "Date", "RegExp", "Error",
  "WebGLRenderingContext", "WebGL2RenderingContext", "CanvasRenderingContext2D", "AudioContext",
  "Image", "URL", "URLSearchParams", "FormData", "Blob", "File", "FileReader",
  "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "fetch", "performance", "navigator", "localStorage", "sessionStorage", "devicePixelRatio",
]);

const GLSL_KW = new Set([
  "uniform", "varying", "attribute", "in", "out", "inout", "const", "void", "return",
  "if", "else", "for", "while", "do", "break", "continue", "discard", "struct",
  "highp", "mediump", "lowp", "precision", "layout", "location", "binding", "group",
  "flat", "smooth", "noperspective", "invariant", "centroid",
  "fn", "let", "var", "override", "switch", "case", "default", "true", "false",
  "vertex", "fragment", "compute",
]);

const GLSL_TYPES = new Set([
  "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4", "uvec2", "uvec3", "uvec4", "bvec2", "bvec3", "bvec4",
  "mat2", "mat3", "mat4", "mat2x2", "mat2x3", "mat2x4", "mat3x2", "mat3x3", "mat3x4", "mat4x2", "mat4x3", "mat4x4",
  "float", "int", "uint", "bool", "sampler2D", "samplerCube", "sampler3D", "sampler2DShadow",
  "f32", "i32", "u32", "vec2f", "vec3f", "vec4f", "vec2i", "vec3i", "vec4i", "vec2u", "vec3u", "vec4u",
  "mat2x2f", "mat3x3f", "mat4x4f", "texture_2d", "sampler",
]);

const GLSL_BUILTINS = new Set([
  "gl_Position", "gl_FragColor", "gl_FragCoord", "gl_PointSize", "gl_PointCoord",
  "gl_FrontFacing", "gl_FragData", "gl_VertexID", "gl_InstanceID",
  "sin", "cos", "tan", "asin", "acos", "atan", "pow", "exp", "log", "exp2", "log2",
  "sqrt", "inversesqrt", "abs", "sign", "floor", "ceil", "fract", "mod", "min", "max",
  "clamp", "mix", "step", "smoothstep", "length", "distance", "dot", "cross", "normalize",
  "faceforward", "reflect", "refract", "texture2D", "textureCube", "texture", "texelFetch",
  "dFdx", "dFdy", "fwidth", "radians", "degrees", "determinant", "inverse", "transpose",
]);

const CSS_FUNCS = new Set([
  "var", "calc", "rgba", "rgb", "hsl", "hsla", "hwb", "oklch", "oklab", "color-mix",
  "clamp", "min", "max", "linear-gradient", "radial-gradient", "conic-gradient",
  "repeating-linear-gradient", "repeating-radial-gradient", "url", "attr", "counter",
  "translate", "translateX", "translateY", "translateZ", "translate3d",
  "scale", "scaleX", "scaleY", "scale3d", "rotate", "rotateX", "rotateY", "rotateZ", "rotate3d",
  "skew", "skewX", "skewY", "matrix", "perspective", "cubic-bezier", "steps",
  "blur", "brightness", "contrast", "drop-shadow", "grayscale", "hue-rotate", "invert", "opacity", "saturate", "sepia",
  "minmax", "repeat", "fit-content",
]);

const wrap = (cls: string, raw: string) => `<span class="${cls}">${esc(raw)}</span>`;

function highlightJs(code: string): string {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|[^`])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d+(?:_\d+)*(?:\.\d+(?:_\d+)*)?(?:[eE][+-]?\d+)?n?)\b|\b([A-Za-z_$][A-Za-z0-9_$]*)\b|([{}()[\].,:;?])|([+\-*/%&|^~!=<>]+)/g;
  let out = "";
  let last = 0;
  for (const m of code.matchAll(re)) {
    const idx = m.index!;
    if (idx > last) out += esc(code.slice(last, idx));
    const [full, com, str, num, id, punc, op] = m;
    if (com !== undefined) {
      out += wrap("tok-com", full);
    } else if (str !== undefined) {
      out += wrap("tok-str", full);
    } else if (num !== undefined) {
      out += wrap("tok-num", full);
    } else if (id !== undefined) {
      const after = code.slice(idx + full.length);
      if (JS_KW.has(id)) {
        out += wrap("tok-kw", full);
      } else if (JS_TYPES.has(id) || /^[A-Z][A-Za-z0-9_]*$/.test(id)) {
        out += wrap("tok-type", full);
      } else if (/^\s*\(/.test(after)) {
        out += wrap("tok-fn", full);
      } else {
        out += esc(full);
      }
    } else if (punc !== undefined) {
      out += wrap("tok-punc", full);
    } else if (op !== undefined) {
      out += wrap("tok-op", full);
    } else {
      out += esc(full);
    }
    last = idx + full.length;
  }
  if (last < code.length) out += esc(code.slice(last));
  return out;
}

function highlightGlsl(code: string): string {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(^\s*#[A-Za-z_][^\n]*)|\b(0[xX][0-9a-fA-F]+|\d+\.\d*(?:[eE][+-]?\d+)?f?|\.\d+(?:[eE][+-]?\d+)?f?|\d+(?:[eE][+-]?\d+)?[uUfF]?)\b|\b([A-Za-z_][A-Za-z0-9_]*)\b|([{}()[\].,:;?@])|([+\-*/%&|^~!=<>]+)/gm;
  let out = "";
  let last = 0;
  for (const m of code.matchAll(re)) {
    const idx = m.index!;
    if (idx > last) out += esc(code.slice(last, idx));
    const [full, com, pre, num, id, punc, op] = m;
    if (com !== undefined) {
      out += wrap("tok-com", full);
    } else if (pre !== undefined) {
      out += wrap("tok-kw", full);
    } else if (num !== undefined) {
      out += wrap("tok-num", full);
    } else if (id !== undefined) {
      const after = code.slice(idx + full.length);
      if (GLSL_KW.has(id)) {
        out += wrap("tok-kw", full);
      } else if (GLSL_TYPES.has(id)) {
        out += wrap("tok-type", full);
      } else if (GLSL_BUILTINS.has(id) || /^\s*\(/.test(after)) {
        out += wrap("tok-fn", full);
      } else {
        out += esc(full);
      }
    } else if (punc !== undefined) {
      out += wrap("tok-punc", full);
    } else if (op !== undefined) {
      out += wrap("tok-op", full);
    } else {
      out += esc(full);
    }
    last = idx + full.length;
  }
  if (last < code.length) out += esc(code.slice(last));
  return out;
}

function highlightCss(code: string): string {
  const re = /(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(@[A-Za-z_-]+)|(#[0-9a-fA-F]{3,8}\b)|([+-]?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|vh|vw|dvh|dvw|vmin|vmax|deg|rad|turn|s|ms|%|fr|ch|ex)?\b)|(--[A-Za-z0-9_-]+|[A-Za-z_-][A-Za-z0-9_-]*)(?=\s*:)|\b([A-Za-z_-][A-Za-z0-9_-]*)\b|([{}()[\]:;,])/g;
  let out = "";
  let last = 0;
  for (const m of code.matchAll(re)) {
    const idx = m.index!;
    if (idx > last) out += esc(code.slice(last, idx));
    const [full, com, str, atRule, hex, num, prop, word, punc] = m;
    if (com !== undefined) {
      out += wrap("tok-com", full);
    } else if (str !== undefined) {
      out += wrap("tok-str", full);
    } else if (atRule !== undefined) {
      out += wrap("tok-kw", full);
    } else if (hex !== undefined || num !== undefined) {
      out += wrap("tok-num", full);
    } else if (prop !== undefined) {
      out += wrap("tok-attr", full);
    } else if (word !== undefined) {
      const after = code.slice(idx + full.length);
      if (CSS_FUNCS.has(word) || /^\s*\(/.test(after)) {
        out += wrap("tok-fn", full);
      } else if (word === "important" || word === "from" || word === "to" || word === "and" || word === "not" || word === "only") {
        out += wrap("tok-kw", full);
      } else {
        out += esc(full);
      }
    } else if (punc !== undefined) {
      out += wrap("tok-punc", full);
    } else {
      out += esc(full);
    }
    last = idx + full.length;
  }
  if (last < code.length) out += esc(code.slice(last));
  return out;
}

function highlightHtmlTag(tagText: string): string {
  const m = tagText.match(/^(\/?<|<\/?)([A-Za-z][A-Za-z0-9:-]*)([\s\S]*?)(\/?>)$/);
  if (!m) return esc(tagText);
  const [, openPunc, tagName, attrsPart, closePunc] = m;
  let out = wrap("tok-punc", openPunc) + wrap("tok-tag", tagName);
  const attrRe = /([A-Za-z_:][A-Za-z0-9_.:-]*)|(=)|("[^"]*"|'[^']*')/g;
  let last = 0;
  for (const am of attrsPart.matchAll(attrRe)) {
    const idx = am.index!;
    if (idx > last) out += esc(attrsPart.slice(last, idx));
    const [full, attrName, eq, strVal] = am;
    if (attrName !== undefined) out += wrap("tok-attr", full);
    else if (eq !== undefined) out += wrap("tok-op", full);
    else if (strVal !== undefined) out += wrap("tok-str", full);
    else out += esc(full);
    last = idx + full.length;
  }
  if (last < attrsPart.length) out += esc(attrsPart.slice(last));
  out += wrap("tok-punc", closePunc);
  return out;
}

function highlightHtmlSegment(code: string): string {
  const re = /(<!--[\s\S]*?-->)|(<!DOCTYPE[^>]*>)|(<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>)/gi;
  let out = "";
  let last = 0;
  for (const m of code.matchAll(re)) {
    const idx = m.index!;
    if (idx > last) out += esc(code.slice(last, idx));
    const [full, com, doctype, tag] = m;
    if (com !== undefined) out += wrap("tok-com", full);
    else if (doctype !== undefined) out += wrap("tok-kw", full);
    else if (tag !== undefined) out += highlightHtmlTag(full);
    else out += esc(full);
    last = idx + full.length;
  }
  if (last < code.length) out += esc(code.slice(last));
  return out;
}

function highlightHtml(code: string): string {
  const blockRe = /(<(style|script)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi;
  let out = "";
  let last = 0;
  for (const m of code.matchAll(blockRe)) {
    const idx = m.index!;
    if (idx > last) out += highlightHtmlSegment(code.slice(last, idx));
    const [full, openTag, kind, inner, closeTag] = m;
    out += highlightHtmlTag(openTag);
    out += kind.toLowerCase() === "style" ? highlightCss(inner) : highlightJs(inner);
    out += highlightHtmlTag(closeTag);
    last = idx + full.length;
  }
  if (last < code.length) out += highlightHtmlSegment(code.slice(last));
  return out;
}

function highlightJson(code: string): string {
  const re = /("(?:\\.|[^"\\\n])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]:,])/g;
  let out = "";
  let last = 0;
  for (const m of code.matchAll(re)) {
    const idx = m.index!;
    if (idx > last) out += esc(code.slice(last, idx));
    const [full, str, colon, kw, num, punc] = m;
    if (str !== undefined) {
      if (colon !== undefined) {
        out += wrap("tok-attr", str) + wrap("tok-punc", colon);
      } else {
        out += wrap("tok-str", str);
      }
    } else if (kw !== undefined) {
      out += wrap("tok-kw", full);
    } else if (num !== undefined) {
      out += wrap("tok-num", full);
    } else if (punc !== undefined) {
      out += wrap("tok-punc", full);
    } else {
      out += esc(full);
    }
    last = idx + full.length;
  }
  if (last < code.length) out += esc(code.slice(last));
  return out;
}

function highlightMd(code: string): string {
  const re = /(^#{1,6}\s+[^\n]*)|(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\n]+\))|(^\s*>\s+[^\n]*)/gm;
  let out = "";
  let last = 0;
  for (const m of code.matchAll(re)) {
    const idx = m.index!;
    if (idx > last) out += esc(code.slice(last, idx));
    const [full, h, inlineCode, link, quote] = m;
    if (h !== undefined) out += wrap("tok-kw", full);
    else if (inlineCode !== undefined) out += wrap("tok-str", full);
    else if (link !== undefined) out += wrap("tok-fn", full);
    else if (quote !== undefined) out += wrap("tok-com", full);
    else out += esc(full);
    last = idx + full.length;
  }
  if (last < code.length) out += esc(code.slice(last));
  return out;
}

export function detectLang(filename: string): { kind: LangKind; label: string } {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "js":
    case "mjs":
      return { kind: "js", label: "JavaScript" };
    case "glsl":
    case "vert":
    case "frag":
      return { kind: "glsl", label: `GLSL (${ext.toUpperCase()})` };
    case "wgsl":
      return { kind: "glsl", label: "WGSL" };
    case "html":
    case "htm":
      return { kind: "html", label: "HTML" };
    case "svg":
      return { kind: "html", label: "SVG" };
    case "css":
      return { kind: "css", label: "CSS" };
    case "json":
      return { kind: "json", label: "JSON" };
    case "md":
    case "markdown":
      return { kind: "md", label: "Markdown" };
    default:
      return { kind: "txt", label: ext ? ext.toUpperCase() : "TEXT" };
  }
}

export function highlightCode(code: string, extOrFile: string): string {
  const { kind } = detectLang(extOrFile.includes(".") ? extOrFile : `file.${extOrFile}`);
  let html: string;
  switch (kind) {
    case "js":
      html = highlightJs(code);
      break;
    case "glsl":
      html = highlightGlsl(code);
      break;
    case "html":
      html = highlightHtml(code);
      break;
    case "css":
      html = highlightCss(code);
      break;
    case "json":
      html = highlightJson(code);
      break;
    case "md":
      html = highlightMd(code);
      break;
    default:
      html = esc(code);
      break;
  }
  // 若末尾是换行符，补一个空格保证 <pre> 与 <textarea> 末尾空行高度对齐
  if (code.endsWith("\n")) html += " ";
  return html;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface CodeEditorOptions {
  container: HTMLElement;
  onChange?: (value: string, dirty: boolean) => void;
  onSave?: () => void;
}

export class CodeEditor {
  private root: HTMLElement;
  private gutterEl: HTMLElement;
  private preEl: HTMLPreElement;
  private codeEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private statusFileEl: HTMLElement;
  private statusMetaEl: HTMLElement;

  private filename = "index.html";
  private savedValue = "";
  private lineCount = 0;
  private onChange?: (value: string, dirty: boolean) => void;
  private onSave?: () => void;

  constructor(opts: CodeEditorOptions) {
    this.onChange = opts.onChange;
    this.onSave = opts.onSave;

    this.root = document.createElement("div");
    this.root.className = "ce-root";
    this.root.innerHTML = `
      <div class="ce-body">
        <div class="ce-gutter" aria-hidden="true">1</div>
        <div class="ce-stage">
          <pre class="ce-hl" aria-hidden="true"><code class="ce-code"></code></pre>
          <textarea class="ce-input" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="代码编辑器"></textarea>
        </div>
      </div>
      <div class="ce-statusbar">
        <span class="ce-status-file">未打开文件</span>
        <span class="ce-status-meta"></span>
      </div>
    `;
    opts.container.replaceChildren(this.root);

    this.gutterEl = this.root.querySelector<HTMLElement>(".ce-gutter")!;
    this.preEl = this.root.querySelector<HTMLPreElement>(".ce-hl")!;
    this.codeEl = this.root.querySelector<HTMLElement>(".ce-code")!;
    this.inputEl = this.root.querySelector<HTMLTextAreaElement>(".ce-input")!;
    this.statusFileEl = this.root.querySelector<HTMLElement>(".ce-status-file")!;
    this.statusMetaEl = this.root.querySelector<HTMLElement>(".ce-status-meta")!;

    this.bindEvents();
  }

  private bindEvents() {
    this.inputEl.addEventListener("scroll", () => this.syncScroll());
    this.inputEl.addEventListener("input", () => {
      this.render();
      this.onChange?.(this.inputEl.value, this.isDirty());
    });
    this.inputEl.addEventListener("click", () => this.updateStatus());
    this.inputEl.addEventListener("keyup", () => this.updateStatus());
    this.inputEl.addEventListener("keydown", (e) => this.handleKeydown(e));
  }

  private syncScroll() {
    const top = this.inputEl.scrollTop;
    const left = this.inputEl.scrollLeft;
    this.preEl.scrollTop = top;
    this.preEl.scrollLeft = left;
    this.gutterEl.scrollTop = top;
  }

  private handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      this.onSave?.();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const val = this.inputEl.value;
      const start = this.inputEl.selectionStart;
      const end = this.inputEl.selectionEnd;

      if (start !== end || e.shiftKey) {
        const lineStart = val.lastIndexOf("\n", start - 1) + 1;
        const lineEndIdx = val.indexOf("\n", end);
        const blockEnd = lineEndIdx === -1 ? val.length : lineEndIdx;
        const block = val.slice(lineStart, blockEnd);
        const lines = block.split("\n");

        let firstDelta = 0;
        let totalDelta = 0;
        const updated = lines.map((line, idx) => {
          if (e.shiftKey) {
            const m = line.match(/^( {1,2}|\t)/);
            if (!m) return line;
            const removed = m[0].length;
            if (idx === 0) firstDelta = -removed;
            totalDelta -= removed;
            return line.slice(removed);
          } else {
            if (idx === 0) firstDelta = 2;
            totalDelta += 2;
            return "  " + line;
          }
        });

        this.inputEl.value = val.slice(0, lineStart) + updated.join("\n") + val.slice(blockEnd);
        this.inputEl.selectionStart = Math.max(lineStart, start + firstDelta);
        this.inputEl.selectionEnd = Math.max(this.inputEl.selectionStart, end + totalDelta);
      } else {
        this.inputEl.value = val.slice(0, start) + "  " + val.slice(end);
        this.inputEl.selectionStart = this.inputEl.selectionEnd = start + 2;
      }

      this.render();
      this.onChange?.(this.inputEl.value, this.isDirty());
      return;
    }

    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const val = this.inputEl.value;
      const start = this.inputEl.selectionStart;
      const end = this.inputEl.selectionEnd;
      const lineStart = val.lastIndexOf("\n", start - 1) + 1;
      const currentLineBefore = val.slice(lineStart, start);
      const indentMatch = currentLineBefore.match(/^[ \t]*/);
      const baseIndent = indentMatch ? indentMatch[0] : "";
      const trimmedBefore = currentLineBefore.trimEnd();
      const openChar = trimmedBefore.slice(-1);
      const nextChar = val.slice(end, end + 1);
      const extraIndent = openChar === "{" || openChar === "[" || openChar === "(" ? "  " : "";

      if (extraIndent && ((openChar === "{" && nextChar === "}") || (openChar === "[" && nextChar === "]") || (openChar === "(" && nextChar === ")"))) {
        const insert = "\n" + baseIndent + extraIndent + "\n" + baseIndent;
        this.inputEl.value = val.slice(0, start) + insert + val.slice(end);
        const cursor = start + 1 + baseIndent.length + extraIndent.length;
        this.inputEl.selectionStart = this.inputEl.selectionEnd = cursor;
      } else {
        const insert = "\n" + baseIndent + extraIndent;
        this.inputEl.value = val.slice(0, start) + insert + val.slice(end);
        const cursor = start + insert.length;
        this.inputEl.selectionStart = this.inputEl.selectionEnd = cursor;
      }

      this.render();
      this.onChange?.(this.inputEl.value, this.isDirty());
    }
  }

  load(filename: string, content: string) {
    this.filename = filename;
    this.savedValue = content;
    this.inputEl.value = content;
    this.lineCount = 0;
    this.render();
    this.inputEl.scrollTop = 0;
    this.inputEl.scrollLeft = 0;
    this.syncScroll();
  }

  getValue(): string {
    return this.inputEl.value;
  }

  getFilename(): string {
    return this.filename;
  }

  isDirty(): boolean {
    return this.inputEl.value !== this.savedValue;
  }

  markSaved() {
    this.savedValue = this.inputEl.value;
    this.updateStatus();
  }

  focus() {
    this.inputEl.focus();
  }

  private render() {
    const code = this.inputEl.value;
    this.codeEl.innerHTML = highlightCode(code, this.filename);
    const lines = code.split("\n").length;
    if (lines !== this.lineCount) {
      this.lineCount = lines;
      const nums: string[] = [];
      for (let i = 1; i <= lines; i++) nums.push(String(i));
      this.gutterEl.textContent = nums.join("\n");
    }
    this.updateStatus();
    this.syncScroll();
  }

  private updateStatus() {
    const code = this.inputEl.value;
    const { label } = detectLang(this.filename);
    const bytes = new TextEncoder().encode(code).byteLength;
    const dirty = this.isDirty();
    const pos = this.inputEl.selectionStart || 0;
    const before = code.slice(0, pos);
    const line = before.split("\n").length;
    const col = pos - before.lastIndexOf("\n");

    this.statusFileEl.textContent = this.filename + (dirty ? " · 未保存" : "");
    this.statusFileEl.classList.toggle("is-dirty", dirty);
    this.statusMetaEl.textContent = `${label} · 行 ${line}:${col} · 共 ${this.lineCount} 行 · ${formatBytes(bytes)}`;
  }
}
