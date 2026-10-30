import fs from 'node:fs/promises';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { BookmarkParseError, parseBookmarksHtml } from '../bookmarks/netscape.js';
import { importTree } from '../bookmarks/store.js';

// Usage: import-bookmarks <browser-export.html> [--merge]
// Default replaces every bookmark (a snapshot of the old tree is kept). --merge adds them under「导入 YYYY-MM-DD」.
const args = process.argv.slice(2).filter((a) => a !== '--');
const merge = args.includes('--merge');
const input = args.find((a) => !a.startsWith('--'));
if (!input || args.some((a) => a.startsWith('--') && a !== '--merge')) {
  console.error('Usage: import-bookmarks <browser-export.html> [--merge]');
  process.exit(1);
}

const config = loadConfig();
let tree;
try {
  tree = parseBookmarksHtml(await fs.readFile(input, 'utf8'));
} catch (err) {
  console.error(err instanceof BookmarkParseError ? `Refused: ${err.message}` : `Could not read ${input}`);
  process.exit(1);
}
const db = openDb(config.dataDir);
const now = Date.now();
const day = new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
const { folders, links } = importTree(db, tree, merge ? 'merge' : 'replace', now, `导入 ${day}`);
db.close();
// Counts only: bookmark titles and URLs are private and never logged.
console.log(`${merge ? 'Merged' : 'Imported'} ${folders} folders, ${links} links into the database (previous tree saved as a snapshot).`);
