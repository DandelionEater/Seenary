require('../env');
const { parseArgs } = require('node:util');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupAccounts, collections, createAccountService } = require('../atlas/accounts');
const { importAccounts, readSqliteAccounts } = require('../atlas/importAccounts');
const { createStagingServer } = require('../atlas/stagingServer');

async function main() {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: {
    source: { type: 'string' }, sqlite: { type: 'string' }, apply: { type: 'boolean', default: false },
  } });
  const command = positionals[0];
  if (positionals.length !== 1 || !['setup', 'serve', 'import', 'create'].includes(command)) {
    throw new Error('Use setup, serve, import --sqlite PATH --source NAME [--apply], or create.');
  }
  if (command !== 'import' && Object.keys(values).some((key) => key !== 'apply') || command !== 'import' && values.apply) {
    throw new Error('Import options require the import command.');
  }
  if (command === 'import' && (!values.sqlite || !values.source)) throw new Error('Import requires --sqlite and --source.');
  const rows = command === 'import' ? readSqliteAccounts(values.sqlite) : null;
  const connection = await connectStaging();
  let server;
  try {
    if (command === 'setup') {
      await setupAccounts(connection.db);
      console.log('Staging account/session schemas and indexes are ready.');
    } else if (command === 'import') {
      // Dry run makes no Atlas writes. Run setup explicitly before apply.
      if (values.apply) await setupAccounts(connection.db);
      const report = await importAccounts(collections(connection.db), rows, values.source, values.apply);
      console.log(JSON.stringify(report, null, 2));
      if (report.conflicts.length) process.exitCode = 1;
    } else {
      const repo = await setupAccounts(connection.db);
      const service = await createAccountService(repo);
      if (command === 'create') {
        // Credentials are deliberately not accepted as CLI arguments (shell history).
        const password = process.env.ATLAS_ACCOUNT_PASSWORD;
        const username = process.env.ATLAS_ACCOUNT_USERNAME;
        delete process.env.ATLAS_ACCOUNT_PASSWORD;
        const result = await service.register(username, password);
        if (result.token) await service.logout(result.token);
        if (!result.ok) { console.error(result.message); process.exitCode = 1; }
        else console.log(`Staging account created. Seenary ID: ${result.user.id}`);
      } else {
        const { setupProviders } = require('../atlas/providerSchema');
        const { createProviderService } = require('../atlas/providers');
        const { createTokenCipher } = require('../atlas/tokenCipher');
        const { createProviderAdapters } = require('../atlas/providerAdapters');
        const providerRepo = await setupProviders(connection.db);
        const analyticsRepo = await require('../atlas/analytics').setupAnalytics(connection.db);
        Object.assign(providerRepo, analyticsRepo);
        const providers = createProviderService({ client: connection.client,
          repo: providerRepo, accounts: service,
          cipher: createTokenCipher(process.env.TOKEN_ENCRYPTION_KEY), adapters: createProviderAdapters() });
        const { setupMedia, createMediaService } = require('../atlas/media');
        const mediaRepo = await setupMedia(connection.db);
        const media = createMediaService(connection.client, mediaRepo);
        const { setupLibrary } = require('../atlas/librarySchema');
        const { createLibraryService } = require('../atlas/library');
        const library = createLibraryService({ client: connection.client, repo: await setupLibrary(connection.db), accounts: service, media });
        const { createMetadataService, setupMetadata } = require('../atlas/metadata');
        const { createAniListMetadataProvider } = require('../atlas/anilistMetadataProvider');
        const { createMalMetadataCache } = require('../atlas/malMetadataCache');
        const queries = await setupMetadata(connection.db);
        const malCache = createMalMetadataCache({ media, repo: mediaRepo, queries,
          provider: { details: require('../mal').getPublicMediaDetails } });
        const { createMalMappingResolver } = require('../atlas/malMapping');
        const { createMalImportService } = require('../atlas/malImport');
        const malMapping = createMalMappingResolver({ media, queries,
          provider: { lookup: (type, id) => require('../anilist').getMediaByMalIds([id], type) } });
        const malImport = createMalImportService({ media, repo: mediaRepo,
          provider: { collection: (type, username) => type === 'ANIME' ? require('../mal').getUserAnimeList(username) : require('../mal').getUserMangaList(username) } });
        const metadata = createMetadataService({ media, repo: mediaRepo, queries, provider: createAniListMetadataProvider(), malCache, malMapping, malImport });
        const analytics = require('../atlas/analytics').createAnalyticsService({ repo: { ...providerRepo, ...repo }, accounts: service });
        server = createStagingServer(service, providers, media, library, metadata, analytics);
        const port = Number(process.env.ATLAS_STAGING_PORT || 3001);
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
        console.log(`Atlas account staging API: http://127.0.0.1:${server.address().port}/rpc`);
        await new Promise((resolve) => {
          const stop = () => { process.off('SIGINT', stop); process.off('SIGTERM', stop); server.close(resolve); server.closeIdleConnections(); };
          process.on('SIGINT', stop); process.on('SIGTERM', stop);
        });
      }
    }
  } finally {
    if (server?.listening) server.close();
    await connection.close();
  }
}

main().catch((error) => { reportError(error); process.exitCode = 1; });
