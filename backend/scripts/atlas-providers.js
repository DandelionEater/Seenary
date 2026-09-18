require('../env');
const { parseArgs } = require('node:util');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupProviders, providerCollections } = require('../atlas/providerSchema');
const { createTokenCipher } = require('../atlas/tokenCipher');
const { readProviderData, importProviderData } = require('../atlas/importProviders');

async function main() {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true,
    options: { sqlite: { type: 'string' }, source: { type: 'string' }, apply: { type: 'boolean' } } });
  const command = positionals[0];
  if (positionals.length !== 1 || !['setup', 'import', 'verify'].includes(command)
      || command === 'setup' && Object.keys(values).length || command === 'verify' && values.apply) throw new Error('Invalid provider command.');
  if (command !== 'setup' && (!values.sqlite || !values.source)) throw new Error('Provide --sqlite and --source.');
  const data = command === 'setup' ? null : readProviderData(values.sqlite);
  const targetCipher = createTokenCipher(process.env.TOKEN_ENCRYPTION_KEY);
  const sourceCipher = command === 'setup' ? null : createTokenCipher(process.env.MIGRATION_TOKEN_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY);
  const connection = await connectStaging();
  try {
    if (command === 'setup') { await setupProviders(connection.db); console.log('Atlas provider schemas and indexes are ready.'); return; }
    if (values.apply) await setupProviders(connection.db);
    const report = await importProviderData({ client: connection.client, repo: providerCollections(connection.db), data,
      source: values.source, sourceCipher, targetCipher, apply: Boolean(values.apply), verify: command === 'verify' });
    console.log(JSON.stringify(report, null, 2));
    if (report.conflicts.length) process.exitCode = 1;
  } finally { await connection.close(); }
}
main().catch((error) => { reportError(error); process.exitCode = 1; });
