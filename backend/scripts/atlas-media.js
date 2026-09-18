require('../env');
const { parseArgs } = require('node:util');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupMedia, mediaCollections } = require('../atlas/media');
const { readMediaData, importMedia } = require('../atlas/importMedia');

async function main() {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true,
    options: { sqlite: { type: 'string' }, source: { type: 'string' }, apply: { type: 'boolean' } } });
  const command = positionals[0];
  if (positionals.length !== 1 || !['setup', 'import', 'verify'].includes(command)
      || command === 'setup' && Object.keys(values).length || command === 'verify' && values.apply) throw new Error('Invalid media command.');
  if (command !== 'setup' && (!values.sqlite || !values.source)) throw new Error('Provide --sqlite and --source.');
  const data = command === 'setup' ? null : readMediaData(values.sqlite);
  const connection = await connectStaging();
  try {
    if (command === 'setup') { await setupMedia(connection.db); console.log('Atlas media schemas and indexes are ready.'); return; }
    if (values.apply) await setupMedia(connection.db);
    const report = await importMedia({ client: connection.client, repo: mediaCollections(connection.db), data, source: values.source,
      apply: Boolean(values.apply), verify: command === 'verify', progress: (value) => console.log(`Media import: ${value.processed}/${value.total}`) });
    console.log(JSON.stringify(report, null, 2));
    if (report.conflicts.length) process.exitCode = 1;
  } finally { await connection.close(); }
}
main().catch((error) => { reportError(error); process.exitCode = 1; });
