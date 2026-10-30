import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNetscapeBookmarks } from '../src/bookmarks.js';

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
