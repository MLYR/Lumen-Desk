import * as OTPAuth from 'otpauth';
import qrcode from 'qrcode-terminal';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { countUnusedRecoveryCodes, generateRecoveryCodes } from '../auth/recovery.js';
import { makeTotp } from '../auth/totp.js';

const force = process.argv.includes('--force');
const config = loadConfig();
const db = openDb(config.dataDir);

const existing = countUnusedRecoveryCodes(db);
if (existing > 0 && !force) {
  console.error(`Refusing to overwrite: ${existing} unused recovery codes exist in ${config.dataDir}. Re-run with --force.`);
  process.exit(1);
}

const secret = new OTPAuth.Secret({ size: 20 }).base32;
const totp = makeTotp(secret, config.totpIssuer, config.totpLabel);
const uri = totp.toString();
const codes = generateRecoveryCodes(db);
db.close();

console.log('\nScan with Google Authenticator:\n');
qrcode.generate(uri, { small: true }, (qr) => console.log(qr));
console.log(`otpauth URI:\n  ${uri}\n`);
console.log('Recovery codes (shown ONCE, store offline; each works one time):');
for (const c of codes) console.log(`  ${c}`);
console.log('\nAdd this line to the server .env (then restart the api):');
console.log(`TOTP_SECRET=${secret}\n`);
if (force) console.log('Note: old recovery codes were replaced. Consider running revoke-sessions.\n');
