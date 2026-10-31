import crypto from 'node:crypto';
import { kvGet, kvSet, type DB } from './db.js';
import { InputError } from './http.js';

/*
 * Résumé (docs/contracts/resume.md). Stored in kv.resume / kv.resume_settings, never in Git.
 * Masking happens here, on the server: the public view never contains a sensitive original.
 */

export interface Field {
  value: string;
  sensitive: boolean;
}

export interface Resume {
  basics: {
    name: Field;
    title: string;
    phone: Field;
    email: Field;
    birth: Field;
    hometown: Field;
    location: Field;
    school: Field;
    degree: Field;
    gender: Field;
    years: Field;
    summary: string;
  };
  work: Array<{ id: string; start: string; end: string; company: Field; role: string; bullets: string[] }>;
  skills: Array<{ id: string; label: string; text: string }>;
  projects: Array<{ id: string; name: Field; client: Field | null; desc: string; stack: string[]; bullets: string[] }>;
  /** Extra words to hide that belong to no field (vendor names, client systems). Private only. */
  keywords: string[];
  updatedAt: string;
}

export interface ResumeSettings {
  revealPublic: boolean;
}

const RESUME_KV = 'resume';
const SETTINGS_KV = 'resume_settings';

// ---------- validation ----------

const TEXT_MAX = 200;
const LONG_MAX = 500;
const LIST_MAX = 20;
const BULLETS_MAX = 20;
const SKILLS_MAX = 30;
const STACK_MAX = 30;
const KEYWORDS_MAX = 50;
const KEYWORD_MIN = 2;
const KEYWORD_MAX = 40;

/** Control, zero-width and bidi characters (BAD_CHARS); the multi-line variant allows \n. */
// eslint-disable-next-line no-control-regex
const BAD_LINE = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/;
// eslint-disable-next-line no-control-regex
const BAD_MULTI = /[\u0000-\u0009\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const len = (s: string) => [...s].length;

type Basics = Resume['basics'];
const FIELD_KEYS = ['name', 'phone', 'email', 'birth', 'hometown', 'location', 'school', 'degree', 'gender', 'years'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
/** Contract §0: school, degree, gender and years are not sensitive by default; everything else is. */
export const DEFAULT_SENSITIVE: Record<FieldKey, boolean> = {
  name: true,
  phone: true,
  email: true,
  birth: true,
  hometown: true,
  location: true,
  school: false,
  degree: false,
  gender: false,
  years: false,
};

function text(v: unknown, where: string, max = TEXT_MAX, multiline = false): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new InputError(`${where} 必须是文字`);
  // NFC on save, so storage and comparison use one spelling of each character.
  const n = v.normalize('NFC');
  const s = multiline ? n.replace(/\r\n?/g, '\n').trim() : n.trim();
  if (len(s) > max) throw new InputError(`${where} 最多 ${max} 字`);
  if ((multiline ? BAD_MULTI : BAD_LINE).test(s)) throw new InputError(`${where} 含有不允许的字符`);
  return s;
}

function field(v: unknown, where: string, defaultSensitive: boolean): Field {
  if (v === undefined || v === null) return { value: '', sensitive: defaultSensitive };
  if (typeof v !== 'object' || Array.isArray(v)) throw new InputError(`${where} 必须是 {value, sensitive}`);
  const f = v as Record<string, unknown>;
  if (f.sensitive !== undefined && typeof f.sensitive !== 'boolean') throw new InputError(`${where}.sensitive 必须是 true 或 false`);
  return { value: text(f.value, where), sensitive: (f.sensitive as boolean | undefined) ?? defaultSensitive };
}

function list<T>(v: unknown, where: string, max: number, item: (x: unknown, i: number) => T): T[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new InputError(`${where} 必须是数组`);
  if (v.length > max) throw new InputError(`${where} 最多 ${max} 条`);
  return v.map(item);
}

const obj = (v: unknown, where: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new InputError(`${where} 必须是对象`);
  return v as Record<string, unknown>;
};

function id(v: unknown, where: string, seen: Set<string>): string {
  let s: string;
  if (v === undefined || v === null || v === '') s = crypto.randomBytes(6).toString('base64url');
  else if (typeof v === 'string' && ID_RE.test(v)) s = v;
  else throw new InputError(`${where}.id 只能是字母、数字、_ 和 -，最多 40 个`);
  if (seen.has(s)) throw new InputError(`${where}.id 重复`);
  seen.add(s);
  return s;
}

const bullets = (v: unknown, where: string) => list(v, where, BULLETS_MAX, (b, i) => text(b, `${where}[${i}]`, LONG_MAX, true)).filter(Boolean);

/** Validates a PUT body (whole replacement). Throws InputError (400). */
export function parseResume(body: unknown, nowMs: number): Resume {
  const b = obj(body, '请求体');
  const bs = obj(b.basics ?? {}, 'basics');
  const basics = { title: text(bs.title, 'basics.title'), summary: text(bs.summary, 'basics.summary') } as Basics;
  for (const k of FIELD_KEYS) basics[k] = field(bs[k], `basics.${k}`, DEFAULT_SENSITIVE[k]);
  const seen = new Set<string>();
  return {
    basics,
    work: list(b.work, 'work', LIST_MAX, (x, i) => {
      const w = obj(x, `work[${i}]`);
      return {
        id: id(w.id, `work[${i}]`, seen),
        start: text(w.start, `work[${i}].start`, 20),
        end: text(w.end, `work[${i}].end`, 20),
        company: field(w.company, `work[${i}].company`, true),
        role: text(w.role, `work[${i}].role`),
        bullets: bullets(w.bullets, `work[${i}].bullets`),
      };
    }),
    skills: list(b.skills, 'skills', SKILLS_MAX, (x, i) => {
      const s = obj(x, `skills[${i}]`);
      // Skill groups list many technologies; they get the long-text limit (see report).
      return { id: id(s.id, `skills[${i}]`, seen), label: text(s.label, `skills[${i}].label`), text: text(s.text, `skills[${i}].text`, LONG_MAX, true) };
    }),
    projects: list(b.projects, 'projects', LIST_MAX, (x, i) => {
      const p = obj(x, `projects[${i}]`);
      return {
        id: id(p.id, `projects[${i}]`, seen),
        name: field(p.name, `projects[${i}].name`, true),
        client: p.client === undefined || p.client === null ? null : field(p.client, `projects[${i}].client`, true),
        desc: text(p.desc, `projects[${i}].desc`, LONG_MAX, true),
        stack: list(p.stack, `projects[${i}].stack`, STACK_MAX, (s, j) => text(s, `projects[${i}].stack[${j}]`)).filter(Boolean),
        bullets: bullets(p.bullets, `projects[${i}].bullets`),
      };
    }),
    keywords: parseKeywords(b.keywords),
    updatedAt: new Date(nowMs).toISOString(),
  };
}

/** ≤ 50 entries, each 2–40 characters, no BAD_CHARS; trimmed, exact duplicates removed (matching is case-sensitive). */
function parseKeywords(v: unknown): string[] {
  const raw = list(v, 'keywords', KEYWORDS_MAX * 2, (k, i) => {
    if (typeof k !== 'string') throw new InputError(`keywords[${i}] 必须是文字`);
    const s = k.normalize('NFC').trim();
    if (len(s) < KEYWORD_MIN || len(s) > KEYWORD_MAX) throw new InputError(`keywords[${i}] 要 ${KEYWORD_MIN}–${KEYWORD_MAX} 个字`);
    if (BAD_LINE.test(s)) throw new InputError(`keywords[${i}] 含有不允许的字符`);
    return s;
  });
  const out = [...new Set(raw)];
  if (out.length > KEYWORDS_MAX) throw new InputError(`keywords 最多 ${KEYWORDS_MAX} 个`);
  return out;
}

// ---------- storage ----------

export function getResume(db: DB): Resume | null {
  const raw = kvGet(db, RESUME_KV);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Resume;
    // Saved before keywords existed.
    if (!Array.isArray(r.keywords)) r.keywords = [];
    return r;
  } catch {
    return null;
  }
}

export function saveResume(db: DB, r: Resume): void {
  kvSet(db, RESUME_KV, JSON.stringify(r));
}

export function getSettings(db: DB): ResumeSettings {
  try {
    const v = JSON.parse(kvGet(db, SETTINGS_KV) ?? '{}') as Partial<ResumeSettings>;
    return { revealPublic: v.revealPublic === true };
  } catch {
    return { revealPublic: false };
  }
}

export function parseSettings(body: unknown): ResumeSettings {
  const b = obj(body, '请求体');
  if (typeof b.revealPublic !== 'boolean') throw new InputError('revealPublic 必须是 true 或 false');
  return { revealPublic: b.revealPublic };
}

export function saveSettings(db: DB, s: ResumeSettings): void {
  kvSet(db, SETTINGS_KV, JSON.stringify(s));
}

// ---------- masking (contract §2) ----------

export type MaskKind = 'name' | 'phone' | 'email' | 'birth' | 'place' | 'company' | 'project' | 'other';

const chars = (s: string) => [...s];
const stars = (s: string) => '*'.repeat(chars(s).length);

/** Organisation/project type words, longest first; the value's ending decides which one is kept. */
const ORG_SUFFIXES = [
  '信息科技有限公司',
  '网络科技有限公司',
  '软件科技有限公司',
  '股份有限公司',
  '有限责任公司',
  '科技有限公司',
  '软件有限公司',
  '有限公司',
  '研究院',
  '研究所',
  '集团',
  '银行',
  '医院',
  '大学',
  '学院',
  '中心',
  '公司',
  '管理系统',
  '小程序',
  '系统',
  '平台',
  '项目',
  '网站',
];

export function mask(kind: MaskKind, value: string): string {
  const v = value.trim();
  if (!v) return '';
  const c = chars(v);
  switch (kind) {
    case 'name':
      if (c.length === 1) return '*';
      return c.length === 2 ? `${c[0]}*` : `${c[0]}*${c[c.length - 1]}`;
    case 'phone': {
      // Separators, full-width digits and a +86 prefix don't change what an 11-digit mobile number is.
      const hw = [...halfwidth(v)];
      let digits = hw.filter(isDigit).join('');
      if (hw.every((ch) => isDigit(ch) || DIGIT_SEPS.has(ch) || ch === '+' || ch === '(' || ch === ')')) {
        if (digits.length === 13 && digits.startsWith('86')) digits = digits.slice(2);
        if (digits.length === 11) return `${digits.slice(0, 3)}****${digits.slice(7)}`;
      }
      return c.length <= 2 ? stars(v) : `${'*'.repeat(c.length - 2)}${c.slice(-2).join('')}`;
    }
    case 'email': {
      const at = v.lastIndexOf('@');
      if (at < 1) return stars(v);
      return `${chars(v.slice(0, at))[0]}***${v.slice(at)}`;
    }
    case 'birth': {
      const y = v.slice(0, 4);
      return y.length === 4 && [...y].every((d) => d >= '0' && d <= '9') ? `${y}.**` : stars(v);
    }
    case 'place':
      return c.length <= 2 ? stars(v) : `${c.slice(0, 2).join('')}**`;
    case 'company':
    case 'project': {
      const suffix = ORG_SUFFIXES.find((s) => v.endsWith(s) && v !== s);
      return suffix ? `某${suffix}` : kind === 'company' ? '某公司' : '某项目';
    }
    default:
      return stars(v);
  }
}

const BASIC_KIND: Record<FieldKey, MaskKind> = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  birth: 'birth',
  hometown: 'place',
  location: 'place',
  school: 'other',
  degree: 'other',
  gender: 'other',
  years: 'other',
};

/** How a secret is found in free text (see makeScrubber). */
export type MatchKind = 'text' | 'email' | 'digits';

export interface Secret {
  value: string;
  replacement: string;
  match?: MatchKind;
}

// ---------- normalisation ----------

/**
 * Full-width ASCII (U+FF01–FF5E) → ASCII and the ideographic space → ' '. Every character maps to
 * exactly one UTF-16 unit, so indices in the converted string are indices in the original: matches are
 * found on the converted text and the original slice is replaced (full-width punctuation stays as is).
 */
export function halfwidth(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 0xff01 && c <= 0xff5e ? String.fromCharCode(c - 0xfee0) : c === 0x3000 ? ' ' : s[i];
  }
  return out;
}

/** Per-unit lowercase that never changes the length (so indices stay aligned). */
function lowerUnits(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const l = s[i]!.toLowerCase();
    out += l.length === 1 ? l : s[i];
  }
  return out;
}

/** The form the final leak check compares: NFC, half-width, lowercase, no whitespace or separators. */
export function normForm(s: string): string {
  return halfwidth(s.normalize('NFC'))
    .toLowerCase()
    .replace(/[\s\u00a0\-·.・]/g, '');
}

/** Allowed between the characters of a name or keyword. */
const SPACES = new Set([' ', '\u00a0', '\t']);
/** Allowed between the digits of a phone number (after half-width conversion, so － and ． are included). */
const DIGIT_SEPS = new Set([' ', '\u00a0', '\t', '-', '·', '.', '・']);
const MAX_SEP = 2;
const isDigit = (ch: string) => ch >= '0' && ch <= '9';
const digitsOf = (v: string) => [...halfwidth(v)].filter(isDigit).join('');

/**
 * Non-overlapping [start, end) ranges where pat (code points) occurs in t with up to MAX_SEP characters
 * from seps between consecutive pattern characters. Never builds a regex from user text. Each start
 * position does at most |pat| × (MAX_SEP + 1) steps, so the whole scan is O(|t| · |pat|).
 * Callers keep seps and pattern characters disjoint, so greedy separator skipping is exact.
 */
function findLoose(t: string, pat: string[], seps: Set<string>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const first = pat[0];
  if (first === undefined) return out;
  let i = t.indexOf(first);
  while (i >= 0) {
    let j = i + first.length;
    let k = 1;
    for (; k < pat.length; k++) {
      for (let n = 0; n < MAX_SEP && j < t.length && seps.has(t[j]!); n++) j++;
      if (!t.startsWith(pat[k]!, j)) break;
      j += pat[k]!.length;
    }
    if (k === pat.length) {
      out.push([i, j]);
      i = t.indexOf(first, j);
    } else i = t.indexOf(first, i + 1);
  }
  return out;
}

function findExact(t: string, v: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (!v) return out;
  for (let i = t.indexOf(v); i >= 0; i = t.indexOf(v, i + v.length)) out.push([i, i + v.length]);
  return out;
}

function splice(s: string, ranges: Array<[number, number]>, replacement: string): string {
  let out = '';
  let at = 0;
  for (const [a, b] of ranges) {
    out += s.slice(at, a) + replacement;
    at = b;
  }
  return out + s.slice(at);
}

interface Matcher {
  /** Normalised forms that must not survive (final check). */
  forms: string[];
  /** Ranges in the half-width text. */
  find: (conv: string) => Array<[number, number]>;
  replacement: string;
  weight: number;
}

/** Phone variants: the digits, and without a leading 86 country code. */
function phoneVariants(value: string): string[] {
  const d = digitsOf(value);
  return d.length === 13 && d.startsWith('86') ? [d, d.slice(2)] : [d];
}

function matcherFor({ value, replacement, match = 'text' }: Secret): Matcher {
  const v = value.normalize('NFC');
  if (match === 'digits') {
    const variants = phoneVariants(v);
    return {
      forms: variants,
      find: (conv) => {
        // Longest variant first; later variants only see what earlier ones left.
        for (const d of variants) {
          const r = findLoose(conv, [...d], DIGIT_SEPS);
          if (r.length) return r;
        }
        return [];
      },
      replacement,
      weight: variants[0]!.length,
    };
  }
  if (match === 'email') {
    const lv = lowerUnits(halfwidth(v));
    return { forms: [normForm(v)], find: (conv) => findExact(lowerUnits(conv), lv), replacement, weight: chars(v).length };
  }
  const pat = [...halfwidth(v)].filter((ch) => !SPACES.has(ch));
  return { forms: [normForm(v)], find: (conv) => findLoose(conv, pat, SPACES), replacement, weight: chars(v).length };
}

// ---------- secrets ----------

/** A phone (or birth date) written with at least this many digits is matched digit by digit. */
const MIN_PHONE_DIGITS = 7;

/** Every sensitive value with its mask (≥ 2 characters, longest first, duplicates removed). */
export function sensitiveValues(r: Resume): Secret[] {
  const out = new Map<string, { replacement: string; match: MatchKind }>();
  const add = (f: Field | null, kind: MaskKind) => {
    if (!f?.sensitive) return;
    const v = f.value.normalize('NFC');
    if (chars(v).length < 2 || out.has(v)) return;
    let match: MatchKind = 'text';
    if (kind === 'email') match = 'email';
    else if (kind === 'phone' && digitsOf(v).length >= MIN_PHONE_DIGITS) match = 'digits';
    else if (kind === 'birth' && digitsOf(v).length >= 6 && [...halfwidth(v)].every((ch) => isDigit(ch) || DIGIT_SEPS.has(ch))) match = 'digits';
    out.set(v, { replacement: mask(kind, v), match });
  };
  for (const k of FIELD_KEYS) add(r.basics[k], BASIC_KIND[k]);
  for (const w of r.work) add(w.company, 'company');
  for (const p of r.projects) {
    add(p.name, 'project');
    add(p.client, 'company');
  }
  // Field values first so a keyword equal to a field keeps that field's own mask.
  for (const raw of r.keywords ?? []) {
    const k = raw.normalize('NFC');
    if (chars(k).length >= 2 && !out.has(k)) out.set(k, { replacement: KEYWORD_MASK, match: 'text' });
  }
  const list = [...out].map(([value, x]) => ({ value, ...x }));
  // A mask that itself contains a sensitive value (e.g. a sensitive「有限公司」inside「某…有限公司」)
  // would reintroduce it; such masks are swapped for a placeholder that contains none.
  const forms = list.flatMap((x) => matcherFor(x).forms).filter((f) => f.length >= 2);
  const safe = safePlaceholder(forms);
  return list
    .map((x) => {
      const nr = normForm(x.replacement);
      return { ...x, replacement: forms.some((f) => nr.includes(f)) ? safe : x.replacement, weight: matcherFor(x).weight };
    })
    .sort((a, b) => b.weight - a.weight)
    .map(({ weight: _w, ...x }) => x);
}

const GUARDS = ['（已隐藏）', '***', '■■'];
const KEYWORD_MASK = '某系统';
/** First guard whose normalised form contains no secret's; '' if every guard does (the text is then dropped). */
const safePlaceholder = (forms: string[]) => GUARDS.find((g) => !forms.some((f) => normForm(g).includes(f))) ?? '';

/**
 * Removes every sensitive value from s.
 * - Text is NFC-normalised; matching runs on a half-width copy (same indices) and replaces the original slice.
 * - Names and keywords match with spaces/NBSP between characters; e-mails case-insensitively;
 *   phone numbers digit by digit with spaces, NBSP, -, ·, . between digits, full-width digits, and ±86.
 * - Longest first; passes repeat while anything is left (a replacement can create another value).
 * - Final check on normForm: if any secret's normalised form is still in the normalised text,
 *   the whole string becomes a guard containing none. Invariant (tested):
 *   for every secret, normForm(scrub(s)) does not contain its normalised form.
 */
export function makeScrubber(secrets: Secret[]): (s: string) => string {
  const matchers = secrets.map(matcherFor).sort((a, b) => b.weight - a.weight);
  const forms = matchers.flatMap((m) => m.forms).filter((f) => f.length >= 2);
  const guard = safePlaceholder(forms);
  const leaks = (s: string) => {
    const n = normForm(s);
    return forms.some((f) => n.includes(f));
  };
  return (input: string) => {
    let out = input.normalize('NFC');
    for (let pass = 0; pass < 4 && leaks(out); pass++) {
      for (const m of matchers) {
        const ranges = m.find(halfwidth(out));
        if (ranges.length) out = splice(out, ranges, m.replacement);
      }
    }
    return leaks(out) ? guard : out;
  };
}

export interface PublicField {
  text: string;
  masked: boolean;
}

export interface PublicResume {
  reveal: boolean;
  basics: Record<FieldKey, PublicField> & { title: string; summary: string };
  work: Array<{ id: string; start: string; end: string; company: PublicField; role: string; bullets: string[] }>;
  skills: Array<{ id: string; label: string; text: string }>;
  projects: Array<{ id: string; name: PublicField; client: PublicField | null; desc: string; stack: string[]; bullets: string[] }>;
  updatedAt: string;
}

/**
 * What visitors get. reveal=false: sensitive Fields are masked, and every other string (free text,
 * non-sensitive fields, titles, stack) is scrubbed of the sensitive values. reveal=true: originals.
 */
export function publicView(r: Resume, settings: ResumeSettings): PublicResume {
  const reveal = settings.revealPublic;
  const secrets = reveal ? [] : sensitiveValues(r);
  const secretMask = new Map(secrets.map((x) => [x.value, x.replacement]));
  const scrub = reveal ? (s: string) => s : makeScrubber(secrets);
  const pf = (f: Field, kind: MaskKind): PublicField => {
    if (reveal) return { text: f.value, masked: false };
    // Masked through the same table as free text, so a field and a sentence mentioning it agree.
    const v = f.value.normalize('NFC');
    if (f.sensitive) return { text: scrub(v === '' ? '' : (secretMask.get(v) ?? mask(kind, v))), masked: v !== '' };
    const t = scrub(v);
    return { text: t, masked: t !== v };
  };
  const basics = { title: scrub(r.basics.title), summary: scrub(r.basics.summary) } as PublicResume['basics'];
  for (const k of FIELD_KEYS) basics[k] = pf(r.basics[k], BASIC_KIND[k]);
  return {
    reveal,
    basics,
    // ids are user-settable, so the public view uses positional ones.
    work: r.work.map((w, i) => ({ id: `w${i + 1}`, start: scrub(w.start), end: scrub(w.end), company: pf(w.company, 'company'), role: scrub(w.role), bullets: w.bullets.map(scrub) })),
    skills: r.skills.map((s, i) => ({ id: `s${i + 1}`, label: scrub(s.label), text: scrub(s.text) })),
    projects: r.projects.map((p, i) => ({
      id: `p${i + 1}`,
      name: pf(p.name, 'project'),
      client: p.client ? pf(p.client, 'company') : null,
      desc: scrub(p.desc),
      stack: p.stack.map(scrub),
      bullets: p.bullets.map(scrub),
    })),
    updatedAt: r.updatedAt,
  };
}
