import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { InputError, normalizeDate, normalizeTags, type Post } from './posts.js';

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

/** Splits a leading `---` YAML block from the markdown body. Invalid YAML throws. */
export function splitFrontmatter(src: string): Frontmatter {
  const text = src.replace(/^\uFEFF/, '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };
  // Default core schema: no custom tags, so untrusted YAML can't construct objects.
  const parsed: unknown = parseYaml(m[1] ?? '', { maxAliasCount: 10 });
  const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  return { data, body: text.slice(m[0].length) };
}

function trimClosingHashes(s: string): string {
  let end = s.length;
  while (end > 0 && ' \t#'.includes(s[end - 1]!)) end--;
  return s.slice(0, end).trim();
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);

/**
 * Turns an imported .md file into a post payload (not yet validated by parsePostInput).
 * Draft by default; `draft: false` or `published: true` publishes.
 */
export function importToInput(src: string, fileName: string): Record<string, unknown> {
  let fm: Frontmatter;
  try {
    fm = splitFrontmatter(src);
  } catch {
    throw new InputError('frontmatter 不是有效的 YAML');
  }
  const { data, body } = fm;
  let title = str(data.title)?.trim();
  if (!title) {
    // Take the whole line, then trim closing #s with a loop. Both `(.+?)[ \t#]*$` and an unanchored
    // `/[ \t#]+$/` backtrack quadratically on lines like `# a # # # …`.
    const h = /^[ \t]*#[ \t]+(.*)$/m.exec(body);
    if (h?.[1]) title = trimClosingHashes(h[1]);
  }
  if (!title) title = fileName.replace(/\.(md|markdown)$/i, '').trim() || '未命名';
  const published = data.draft === false || data.published === true;
  return {
    title: [...title].slice(0, 200).join(''),
    slug: str(data.slug)?.trim() || undefined,
    summary: str(data.summary) ?? '',
    tags: normalizeTags(data.tags),
    markdown: body,
    status: published ? 'published' : 'draft',
    publishedAt: data.date === undefined ? undefined : normalizeDate(data.date),
    // A name; savePost creates the category if the site doesn't have it yet.
    category: str(data.category)?.trim() || undefined,
  };
}

/** Export format, re-importable by importToInput. */
export function toMarkdownFile(p: Post): string {
  const meta: Record<string, unknown> = { title: p.title, slug: p.slug };
  if (p.publishedAt) meta.date = p.publishedAt;
  if (p.category) meta.category = p.category.name;
  meta.tags = p.tags;
  if (p.summary) meta.summary = p.summary;
  meta.draft = p.status !== 'published';
  return `---\n${stringifyYaml(meta)}---\n${p.markdown}`;
}
