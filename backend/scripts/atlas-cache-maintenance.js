require('../env');
const { parseArgs } = require('node:util');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupMetadata } = require('../atlas/metadata');
const { createCacheMaintenance } = require('../atlas/cacheMaintenance');
async function main() {
  const { values } = parseArgs({ args: process.argv.slice(2), strict: true,
    options: { apply: { type: 'boolean' }, limit: { type: 'string' }, 'byte-budget': { type: 'string' } } });
  const limit = values.limit == null ? 100 : Number(values.limit);
  const byteBudget = values['byte-budget'] == null ? Number.POSITIVE_INFINITY : Number(values['byte-budget']);
  const connection = await connectStaging();
  try {
    const report = await createCacheMaintenance({ queries: await setupMetadata(connection.db) })
      .run({ dryRun: !values.apply, limit, byteBudget });
    console.log(JSON.stringify(report));
  } finally { await connection.close(); }
}
main().catch(error => { reportError(error); process.exitCode = 1; });
