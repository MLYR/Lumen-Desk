import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBookmarksHtml } from '../src/bookmarks/netscape.js';

// Same expectations as before P2.8, in the legacy shape the old parser returned.
const parseNetscapeBookmarks = (html: string) => {
  type N = { name: string; children?: N[]; links?: [string, string][] };
  const conv = (f: ReturnType<typeof parseBookmarksHtml>[number]): N | null => {
    const children = f.folders.map(conv).filter((x): x is N => x !== null);
    const n: N = { name: f.name };
    if (children.length) n.children = children;
    if (f.links.length) n.links = f.links.map((l) => [l.title, l.url]);
    return children.length || f.links.length ? n : null;
  };
  return parseBookmarksHtml(html).map(conv).filter((x) => x !== null);
};

const html = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/bookmarks.html'), 'utf8');

describe('parseNetscapeBookmarks', () => {
  it('builds the folder/link tree and flattens wrapper folders', () => {
    expect(parseNetscapeBookmarks(html)).toEqual([
      {
        name: 'Work',
        children: [
          {
            name: 'Team',
            links: [
              ['GitLab', 'https://git.example.test/'],
              ['Wiki & Docs', 'https://wiki.example.test/?a=1&b=2'],
            ],
          },
        ],
        links: [['Mail', 'https://mail.example.test/']],
      },
      { name: 'Tools', links: [['Tool', 'https://tool.example.test/']] },
      { name: 'Reading', links: [['Read', 'https://read.example.test/']] },
      { name: '未分类', links: [['Loose', 'https://loose.example.test/']] },
    ]);
  });
});
