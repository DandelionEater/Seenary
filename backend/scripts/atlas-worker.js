require('../env');
const { parseArgs } = require('node:util');
const anilist = require('../anilist');
const mal = require('../mal');
const { connectRuntime, reportError } = require('../atlas/connection');
const { setupLibrary } = require('../atlas/librarySchema');
const { setupProviders } = require('../atlas/providerSchema');
const { setupMedia, createMediaService } = require('../atlas/media');
const { setupMetadata } = require('../atlas/metadata');
const { createTokenCipher } = require('../atlas/tokenCipher');
const { createProviderAdapters } = require('../atlas/providerAdapters');
const { createJobWorker } = require('../atlas/jobWorker');
const { createProviderDelivery, createDeliveryAdapters } = require('../atlas/providerDelivery');
const { createProviderInbound, createInboundAdapters } = require('../atlas/providerInbound');
const { createCacheMaintenance } = require('../atlas/cacheMaintenance');

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function main() {
  const { values } = parseArgs({ args: process.argv.slice(2), strict: true,
    options: { once: { type: 'boolean' }, watch: { type: 'boolean' }, maintenance: { type: 'boolean' }, limit: { type: 'string' }, interval: { type: 'string' } } });
  if (Boolean(values.once) === Boolean(values.watch)) throw new Error('Choose exactly one of --once or --watch.');
  const limit = values.limit == null ? 10 : Number(values.limit);
  const interval = values.interval == null ? 5000 : Number(values.interval);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be from 1 to 100.');
  if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 60000) throw new Error('Interval must be from 1000 to 60000 milliseconds.');
  const connection = await connectRuntime();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const library = await setupLibrary(connection.db); const providers = await setupProviders(connection.db); const mediaRepo = await setupMedia(connection.db);
    const queries = await setupMetadata(connection.db);
    const repo = { ...library, ...providers, ...mediaRepo, providerBudgets: library.providerBudgets,
      providerRefreshStates: library.providerRefreshStates };
    const worker = createJobWorker({ repo });
    const tokenCipher = createTokenCipher(process.env.TOKEN_ENCRYPTION_KEY); const providerAdapters = createProviderAdapters();
    const delivery = createProviderDelivery({ repo, worker, cipher: tokenCipher,
      adapters: createDeliveryAdapters({ anilist, mal, providerAdapters }) });
    const inbound = createProviderInbound({ client: connection.client, repo, media: createMediaService(connection.client, repo), cipher: tokenCipher,
      adapters: createInboundAdapters({ anilist, mal, providerAdapters }) });
    const maintenance = createCacheMaintenance({ queries }); let lastMaintenance = 0;
    const byteBudget = values.maintenance ? Number(process.env.ATLAS_QUERY_CACHE_BYTE_BUDGET) : Number.POSITIVE_INFINITY;
    if (values.maintenance && (!Number.isSafeInteger(byteBudget) || byteBudget < 0)) throw new Error('Configure ATLAS_QUERY_CACHE_BYTE_BUDGET.');
    do {
      const outbound = await delivery.runOnce(limit); const incoming = await inbound.runOnce(limit);
      const counts = result => result.results.reduce((all, item) => ({ ...all, [item.status]: (all[item.status] || 0) + 1 }), {});
      const report = { outbound: { claimed: outbound.claimed, outcomes: counts(outbound) }, inbound: { claimed: incoming.claimed, outcomes: counts(incoming) } };
      if (values.maintenance && Date.now() - lastMaintenance >= 24 * 3600000) {
        report.maintenance = await maintenance.run({ dryRun: false, limit: 100, byteBudget }); lastMaintenance = Date.now();
      }
      if (!values.watch || outbound.claimed || incoming.claimed || report.maintenance) console.log(JSON.stringify(report));
      if (!values.watch || stopping) break;
      await wait(interval);
    } while (!stopping);
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    await connection.close();
  }
}
main().catch(error => { reportError(error); process.exitCode = 1; });
