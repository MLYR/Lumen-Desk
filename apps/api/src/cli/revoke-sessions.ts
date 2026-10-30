import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { deleteAllSessions } from '../auth/sessions.js';

const db = openDb(loadConfig().dataDir);
const n = deleteAllSessions(db);
db.close();
console.log(`Revoked ${n} session(s).`);
