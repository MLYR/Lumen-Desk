import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { unlockAll } from '../auth/ratelimit.js';

const db = openDb(loadConfig().dataDir);
unlockAll(db);
db.close();
console.log('Cleared the global login pause and all IP locks.');
