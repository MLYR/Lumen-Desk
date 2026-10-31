import qrcode from 'qrcode-terminal';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { InitRefused, initTotp } from '../auth/init-totp.js';
import { parseSecretKey } from '../auth/secret-store.js';
import { makeTotp } from '../auth/totp.js';

// Usage: init-totp [--force] [--print-env]
//   Default: writes a new TOTP secret into the database (kv.totp_secret, AES-256-GCM with SECRET_KEY),
//   10 fresh recovery codes, clears any pending rebind and signs out every device. Restart the api.
//   --print-env  old behaviour: print TOTP_SECRET=… for .env instead of writing the database.
//                Refused when the database already has a secret (the .env value would be ignored).
//   --force      overwrite an existing secret / unused recovery codes.
const force = process.argv.includes('--force');
const printEnv = process.argv.includes('--print-env');
const config = loadConfig();
const key = parseSecretKey(config.secretKey);
const db = openDb(config.dataDir);

let result;
try {
  result = initTotp(db, key, { force, printEnv, now: Date.now() });
} catch (err) {
  db.close();
  if (err instanceof InitRefused) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
db.close();

const uri = makeTotp(result.secret, config.totpIssuer, config.totpLabel).toString();
console.log('\nScan with Google Authenticator:\n');
qrcode.generate(uri, { small: true }, (qr) => console.log(qr));
console.log(`otpauth URI:\n  ${uri}\n`);
console.log('Recovery codes (shown ONCE, store offline; each works one time):');
for (const c of result.codes) console.log(`  ${c}`);
if (printEnv) {
  console.log('\nAdd this line to the server .env (then restart the api):');
  console.log(`TOTP_SECRET=${result.secret}\n`);
} else {
  console.log(`\nSaved to the database${key ? ' (encrypted with SECRET_KEY)' : ' (UNENCRYPTED: SECRET_KEY is not set)'}. Restart the api to use it.`);
  console.log(`All devices were signed out (${result.sessionsRevoked} sessions); log in again with the new code.`);
  console.log('TOTP_SECRET in .env is no longer needed and is ignored while the database has a secret.\n');
}
if (force) console.log('Note: old recovery codes were replaced.\n');
