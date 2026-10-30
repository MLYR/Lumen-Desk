import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { BOOKMARKS_FILE, parseNetscapeBookmarks, type BookmarkNode } from '../bookmarks.js';

const [input, outArg] = process.argv.slice(2).filter((a) => a !== '--');
if (!input) {
  console.error('Usage: import-bookmarks <chrome-export.html> [out.json]');
  process.exit(1);
}

const tree = parseNetscapeBookmarks(await fs.readFile(input, 'utf8'));
const out = outArg ? path.resolve(outArg) : path.join(loadConfig().dataDir, BOOKMARKS_FILE);
await fs.mkdir(path.dirname(out), { recursive: true, mode: 0o700 });
await fs.writeFile(out, JSON.stringify(tree, null, 2) + '\n', { mode: 0o600 });

const count = (nodes: BookmarkNode[]): [number, number] =>
  nodes.reduce<[number, number]>(
    ([f, l], n) => {
      const [cf, cl] = count(n.children ?? []);
      return [f + 1 + cf, l + (n.links?.length ?? 0) + cl];
    },
    [0, 0],
  );
const [folders, links] = count(tree);
console.log(`Wrote ${folders} folders, ${links} links to ${out}`);
