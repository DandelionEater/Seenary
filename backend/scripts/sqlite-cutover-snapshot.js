require('../env');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseArgs } = require('node:util');
const Database = require('better-sqlite3');

async function main() {
  const { values } = parseArgs({ args: process.argv.slice(2), strict: true, options: { output: { type: 'string' } } });
  if (!values.output) throw new Error('Use --output PATH.');
  if (process.env.LEGACY_WRITE_FREEZE !== 'true') throw new Error('Set LEGACY_WRITE_FREEZE=true before taking the final snapshot.');
  const source = path.resolve(process.env.DATABASE_PATH || (process.env.NODE_ENV === 'production'
    ? '/home/u145628270/domains/api.seenary.app/data/media.db' : path.join(__dirname, '..', 'media.db')));
  const output = path.resolve(values.output);
  if (output === source || output.startsWith(path.resolve(__dirname, '..', 'public') + path.sep)) throw new Error('Choose a private snapshot path outside the live database and web roots.');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try { if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Live database integrity check failed.'); await db.backup(output); }
  finally { db.close(); }
  const bytes = fs.readFileSync(output); const verify = new Database(output, { readonly: true });
  try { if (verify.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Snapshot integrity check failed.'); }
  finally { verify.close(); }
  console.log(JSON.stringify({ created: true, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }));
}
main().catch(error => { console.error(`Cutover snapshot failed: ${error.message}`); process.exitCode = 1; });
