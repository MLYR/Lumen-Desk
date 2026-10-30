import { kvGet, kvSet, type DB } from './db.js';
import { INVISIBLE, InputError, visible } from './http.js';

export interface Profile {
  name: string;
  tagline: string;
  bio: string;
  avatar: string | null;
  facts: Array<{ label: string; value: string }>;
  links: Array<{ label: string; url: string }>;
}

// Matches the static homepage copy (apps/web Intro.astro) so nothing changes until the owner edits it.
export const DEFAULT_PROFILE: Profile = {
  name: 'zreo',
  tagline: '我是 zreo，一名程序员。这里放我的简历、技术笔记，以及一些用 Canvas、WebGPU、WASM 做的小实验。',
  bio: '',
  avatar: null,
  facts: [
    { label: '职业', value: '程序员' },
    { label: '坐标', value: '上海' },
    { label: '在研究', value: 'Astro · Hono · AI Agent' },
    { label: '联系', value: '待填写' },
  ],
  links: [],
};

const KEY = 'profile';
const AVATAR_RE = /^\/uploads\/[0-9a-f]{16}\.webp$/;
const len = (s: string) => [...s].length;

export function getProfile(db: DB): Profile {
  const raw = kvGet(db, KEY);
  if (!raw) return structuredClone(DEFAULT_PROFILE);
  try {
    return { ...structuredClone(DEFAULT_PROFILE), ...(JSON.parse(raw) as Partial<Profile>) };
  } catch {
    return structuredClone(DEFAULT_PROFILE);
  }
}

function text(v: unknown, field: string, min: number, max: number): string {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new InputError(`${field} 必须是文字`);
  const s = v.trim();
  if (len(s) < min || len(s) > max) throw new InputError(min ? `${field} ${min}–${max} 字` : `${field} 最多 ${max} 字`);
  // Single-line fields: control characters (including newlines) aren't allowed. bio allows \n.
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(s) || INVISIBLE.test(s) || (field !== 'bio' && s.includes('\n'))) throw new InputError(`${field} 含有不允许的字符`);
  if (min && !visible(s)) throw new InputError(`${field} 不能只有不可见字符`);
  return s;
}

/** http, https and mailto only; anything that doesn't parse, or uses another scheme, is rejected. */
export function isProfileUrl(v: string): boolean {
  if (len(v) > 500 || /\s/.test(v)) return false;
  try {
    const u = new URL(v);
    if (u.protocol === 'mailto:') return u.pathname.length > 0;
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0;
  } catch {
    return false;
  }
}

function list<T>(v: unknown, field: string, max: number, item: (x: Record<string, unknown>, i: number) => T): T[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new InputError(`${field} 必须是数组`);
  if (v.length > max) throw new InputError(`${field} 最多 ${max} 条`);
  return v.map((x, i) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) throw new InputError(`${field} 第 ${i + 1} 条格式不对`);
    return item(x as Record<string, unknown>, i);
  });
}

/** Validates a PUT body. avatar is managed by its own routes and ignored here. */
export function parseProfile(body: unknown): Omit<Profile, 'avatar'> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('请求体必须是对象');
  const b = body as Record<string, unknown>;
  return {
    name: text(b.name, 'name', 1, 40),
    tagline: text(b.tagline, 'tagline', 0, 80),
    bio: text(b.bio, 'bio', 0, 500),
    facts: list(b.facts, 'facts', 6, (x) => ({ label: text(x.label, 'facts.label', 1, 10), value: text(x.value, 'facts.value', 1, 60) })),
    links: list(b.links, 'links', 6, (x, i) => {
      const label = text(x.label, 'links.label', 1, 20);
      const url = typeof x.url === 'string' ? x.url.trim() : '';
      if (!isProfileUrl(url)) throw new InputError(`links 第 ${i + 1} 条只能是 http、https 或 mailto 链接`);
      return { label, url };
    }),
  };
}

export function saveProfile(db: DB, p: Omit<Profile, 'avatar'>): Profile {
  const next: Profile = { ...p, avatar: getProfile(db).avatar };
  kvSet(db, KEY, JSON.stringify(next));
  return next;
}

export function setAvatar(db: DB, avatar: string | null): void {
  if (avatar !== null && !AVATAR_RE.test(avatar)) throw new Error('bad avatar path');
  kvSet(db, KEY, JSON.stringify({ ...getProfile(db), avatar }));
}
