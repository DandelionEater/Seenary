require('../env');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { connectStaging, reportError } = require('../atlas/connection');
const { createBackup, restoreBackup, BACKUP_COLLECTIONS } = require('../atlas/backup');
const { validateDeployment, healthReport } = require('../atlas/operations');
async function main() {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true,
    options: { output: { type: 'string' }, input: { type: 'string' }, mode: { type: 'string' } } });
  const command = positionals[0]; if (positionals.length !== 1 || !['validate', 'health', 'backup', 'restore-rehearsal'].includes(command)) throw new Error('Use validate, health, backup --output PATH, or restore-rehearsal --input PATH.');
  if (command === 'validate') { const result = validateDeployment(process.env, values.mode || 'staging'); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; return; }
  if (command === 'backup' && !values.output || command === 'restore-rehearsal' && !values.input) throw new Error('Provide the required backup path.');
  const connection = await connectStaging();
  try {
    if (command === 'health') { console.log(JSON.stringify(await healthReport(connection.db), null, 2)); return; }
    if (command === 'backup') {
      const result = await createBackup(connection.db, process.env.ATLAS_BACKUP_ENCRYPTION_KEY); const target = path.resolve(values.output);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, result.blob, { mode: 0o600 });
      console.log(JSON.stringify({ created: true, collections: Object.keys(result.manifest).length,
        documents: Object.values(result.manifest).reduce((sum, item) => sum + item.count, 0), bytes: result.blob.length })); return;
    }
    const prefix = `batch1_test_${require('node:crypto').randomBytes(10).toString('hex')}_`;
    try { console.log(JSON.stringify(await restoreBackup(connection.db, process.env.ATLAS_BACKUP_ENCRYPTION_KEY, fs.readFileSync(path.resolve(values.input)), prefix), null, 2)); }
    finally { for (const name of BACKUP_COLLECTIONS) await connection.db.collection(prefix + name).drop().catch(error => { if (error.code !== 26) throw error; }); }
  } finally { await connection.close(); }
}
main().catch(error => { reportError(error); process.exitCode = 1; });
