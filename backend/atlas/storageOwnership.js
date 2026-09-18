const TABLE_OWNERSHIP = {
  anime: { domain: 'public-media', legacy: 'sqlite', cloud: 'atlas:media', cutover: 'batch-10' },
  manga: { domain: 'public-media', legacy: 'sqlite', cloud: 'atlas:media', cutover: 'batch-10' },
  anime_external_ids: { domain: 'media-identity', legacy: 'sqlite', cloud: 'atlas:media', cutover: 'batch-10' },
  manga_external_ids: { domain: 'media-identity', legacy: 'sqlite', cloud: 'atlas:media', cutover: 'batch-10' },
  provider_mapping_misses: { domain: 'media-mapping-cache', legacy: 'sqlite', cloud: 'atlas:metadataQueries', cutover: 'batch-10' },
  anime_tags: { domain: 'public-media', legacy: 'sqlite', cloud: 'atlas:media', cutover: 'batch-10' },
  anime_staff: { domain: 'public-media', legacy: 'sqlite', cloud: 'atlas:media', cutover: 'batch-10' },
  anime_characters: { domain: 'public-media', legacy: 'sqlite', cloud: 'atlas:media', cutover: 'batch-10' },
  person_details: { domain: 'public-media', legacy: 'sqlite', cloud: 'atlas:media', cutover: 'batch-10' },
  users: { domain: 'accounts', legacy: 'sqlite', cloud: 'atlas:users', cutover: 'batch-10' },
  web_sessions: { domain: 'sessions', legacy: 'sqlite', cloud: 'atlas:sessions', cutover: 'batch-10' },
  user_anime_lists: { domain: 'personal-library', legacy: 'sqlite', cloud: 'atlas:libraryEntries', cutover: 'batch-10' },
  user_manga_lists: { domain: 'personal-library', legacy: 'sqlite', cloud: 'atlas:libraryEntries', cutover: 'batch-10' },
  anilist_accounts: { domain: 'provider-links', legacy: 'sqlite', cloud: 'atlas:providerAccounts', cutover: 'batch-10' },
  mal_accounts: { domain: 'provider-links', legacy: 'sqlite', cloud: 'atlas:providerAccounts', cutover: 'batch-10' },
  sync_queue: { domain: 'provider-outbox', legacy: 'sqlite', cloud: 'atlas:jobs', cutover: 'batch-10' },
  sync_history: { domain: 'provider-sync-history', legacy: 'sqlite', cloud: 'atlas:jobs', cutover: 'batch-10' },
  app_settings: { domain: 'legacy-settings-and-consent', legacy: 'sqlite', cloud: 'local-preferences-and-atlas:accountSettings', cutover: 'batch-10' },
  engagement_daily_activity: { domain: 'consented-analytics', legacy: 'sqlite', cloud: 'atlas:analyticsDaily', cutover: 'batch-10' },
  engagement_monthly_aggregates: { domain: 'aggregate-analytics', legacy: 'sqlite', cloud: 'atlas:analyticsMonthly', cutover: 'batch-10' },
};

// Direct imports are frozen. Modules may be removed as domains cut over; adding one requires an ownership decision here first.
const SQLITE_CALLERS = [
  'analyticsReports.js', 'auth.js', 'backup.js', 'engagementAnalytics.js', 'lists.js', 'main.js', 'malImport.js',
  'malMangaImport.js', 'malMapping.js', 'malTokens.js', 'server.js', 'sync.js', 'textImport.js',
];

const RUNTIME_BOUNDARIES = {
  desktop: { entry: 'main.js', authority: 'sqlite-and-device-local', retirement: 'batch-10-compatible-client-gate' },
  hostedLegacy: { entry: 'server.js', authority: 'sqlite', retirement: 'batch-10-cutover' },
  atlasStaging: { entry: 'atlas/stagingServer.js', authority: 'atlas', retirement: null },
};

module.exports = { TABLE_OWNERSHIP, SQLITE_CALLERS, RUNTIME_BOUNDARIES };
