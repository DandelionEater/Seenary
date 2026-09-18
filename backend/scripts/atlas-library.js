require('../env');
const { parseArgs } = require('node:util');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupLibrary, libraryCollections } = require('../atlas/librarySchema');
const { readLibraryData, importLibrary } = require('../atlas/importLibrary');

async function main() {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true,
    options: { sqlite: { type: 'string' }, source: { type: 'string' }, apply: { type: 'boolean' } } });
  const command = positionals[0];
  if (positionals.length !== 1 || !['setup', 'import', 'verify'].includes(command)
      || command === 'setup' && Object.keys(values).length || command === 'verify' && values.apply) throw new Error('Invalid library command.');
  if (command !== 'setup' && (!values.sqlite || !values.source)) throw new Error('Provide --sqlite and --source.');
  const data = command === 'setup' ? null : readLibraryData(values.sqlite);
  const connection = await connectStaging();
  try {
    if (command === 'setup') { await setupLibrary(connection.db); console.log('Atlas library schemas and indexes are ready.'); return; }
    if (values.apply) await setupLibrary(connection.db);
    const report = await importLibrary({ client: connection.client, repo: libraryCollections(connection.db), data, source: values.source,
      apply: Boolean(values.apply), verify: command === 'verify', progress: ({ processed, total }) => console.log(`Library import: ${processed}/${total}`) });
    console.log(JSON.stringify(report, null, 2));
    if (report.conflicts.length) process.exitCode = 1;
  } finally { await connection.close(); }
}
main().catch((error) => { reportError(error); process.exitCode = 1; });
