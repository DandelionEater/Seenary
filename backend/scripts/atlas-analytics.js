require('../env');
const { connectRuntime, reportError } = require('../atlas/connection');
const { setupAnalytics, createAnalyticsService } = require('../atlas/analytics');
async function main() {
  const command = process.argv[2]; if (!['setup', 'finalize', 'report'].includes(command) || process.argv.length !== 3) throw new Error('Use setup, finalize, or report.');
  const connection = await connectRuntime();
  try {
    const analyticsRepo = await setupAnalytics(connection.db); const repo = { ...analyticsRepo, users: connection.db.collection('users') };
    if (command === 'setup') { console.log('Atlas analytics schemas and indexes are ready.'); return; }
    const service = createAnalyticsService({ repo, accounts: null });
    console.log(JSON.stringify(command === 'finalize' ? await service.finalize() : await service.report(), null, 2));
  } finally { await connection.close(); }
}
main().catch(error => { reportError(error); process.exitCode = 1; });
