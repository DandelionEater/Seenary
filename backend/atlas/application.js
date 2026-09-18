const { setupAccounts, createAccountService } = require('./accounts');
const { setupProviders } = require('./providerSchema');
const { createProviderService } = require('./providers');
const { createTokenCipher } = require('./tokenCipher');
const { createProviderAdapters } = require('./providerAdapters');
const { setupMedia, createMediaService } = require('./media');
const { setupLibrary } = require('./librarySchema');
const { createLibraryService } = require('./library');
const { createMetadataService, setupMetadata } = require('./metadata');
const { createAniListMetadataProvider } = require('./anilistMetadataProvider');
const { createMalMetadataCache } = require('./malMetadataCache');
const { createMalMappingResolver } = require('./malMapping');
const { createMalImportService } = require('./malImport');
const { setupAnalytics, createAnalyticsService } = require('./analytics');

async function createAtlasApplication(connection) {
  const accountsRepo = await setupAccounts(connection.db); const accounts = await createAccountService(accountsRepo);
  const providersRepo = await setupProviders(connection.db); const analyticsRepo = await setupAnalytics(connection.db);
  Object.assign(providersRepo, analyticsRepo);
  const providers = createProviderService({ client: connection.client, repo: providersRepo, accounts,
    cipher: createTokenCipher(process.env.TOKEN_ENCRYPTION_KEY), adapters: createProviderAdapters() });
  const mediaRepo = await setupMedia(connection.db); const media = createMediaService(connection.client, mediaRepo);
  const library = createLibraryService({ client: connection.client, repo: await setupLibrary(connection.db), accounts, media });
  const queries = await setupMetadata(connection.db);
  const malCache = createMalMetadataCache({ media, repo: mediaRepo, queries, provider: { details: require('../mal').getPublicMediaDetails } });
  const malMapping = createMalMappingResolver({ media, queries, provider: { lookup: (type, id) => require('../anilist').getMediaByMalIds([id], type) } });
  const malImport = createMalImportService({ media, repo: mediaRepo,
    provider: { collection: (type, username) => type === 'ANIME' ? require('../mal').getUserAnimeList(username) : require('../mal').getUserMangaList(username) } });
  const metadata = createMetadataService({ media, repo: mediaRepo, queries, provider: createAniListMetadataProvider(), malCache, malMapping, malImport });
  const analytics = createAnalyticsService({ repo: { ...providersRepo, ...accountsRepo }, accounts });
  return { accounts, providers, media, library, metadata, analytics };
}

module.exports = { createAtlasApplication };
