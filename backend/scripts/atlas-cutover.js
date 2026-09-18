require('../env');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { parseArgs } = require('node:util');
const { connectRuntime, reportError } = require('../atlas/connection');
const { collections } = require('../atlas/accounts');
const { readSqliteAccounts, importAccounts } = require('../atlas/importAccounts');
const { providerCollections } = require('../atlas/providerSchema');
const { readProviderData, importProviderData } = require('../atlas/importProviders');
const { createTokenCipher } = require('../atlas/tokenCipher');
const { mediaCollections } = require('../atlas/media');
const { readMediaData, importMedia } = require('../atlas/importMedia');
const { libraryCollections } = require('../atlas/librarySchema');
const { readLibraryData, importLibrary } = require('../atlas/importLibrary');

function hashFile(filename) { return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'); }
function summarize(report) { return Object.fromEntries(Object.entries(report).filter(([key]) => !['conflicts'].includes(key))); }

async function main() {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true,
    options: { sqlite: { type: 'string' }, source: { type: 'string' } } });
  if (positionals.length !== 1 || !['rehearse', 'stage', 'reconcile'].includes(positionals[0]) || !values.sqlite || !values.source) {
    throw new Error('Use rehearse, stage, or reconcile --sqlite PATH --source NAME.');
  }
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(values.source)) throw new Error('Invalid source name.');
  const before = hashFile(values.sqlite);
  const data = { accounts: readSqliteAccounts(values.sqlite), providers: readProviderData(values.sqlite),
    media: readMediaData(values.sqlite), library: readLibraryData(values.sqlite) };
  if (hashFile(values.sqlite) !== before) throw new Error('SQLite source changed while it was being read.');
  const connection = await connectRuntime();
  try {
    const verify = positionals[0] === 'reconcile'; const stage = positionals[0] === 'stage';
    const reports = {};
    reports.accounts = await importAccounts(collections(connection.db), data.accounts, values.source, stage, verify, stage);
    reports.providers = await importProviderData({ client: connection.client, repo: providerCollections(connection.db), data: data.providers,
      source: values.source, sourceCipher: createTokenCipher(process.env.MIGRATION_TOKEN_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY),
      targetCipher: createTokenCipher(process.env.TOKEN_ENCRYPTION_KEY), apply: stage, verify, refresh: stage });
    reports.media = await importMedia({ client: connection.client, repo: mediaCollections(connection.db), data: data.media,
      source: values.source, apply: stage, verify, refresh: stage });
    reports.library = await importLibrary({ client: connection.client, repo: libraryCollections(connection.db), data: data.library,
      source: values.source, apply: stage, verify });
    if (hashFile(values.sqlite) !== before) throw new Error('SQLite source changed during rehearsal.');
    const conflicts = Object.fromEntries(Object.entries(reports).map(([name, report]) => [name, report.conflicts?.length || 0]));
    const expected = { accounts: reports.accounts.total, providers: reports.providers.links + reports.providers.settings,
      media: reports.media.total, library: reports.library.total };
    const verified = Object.fromEntries(Object.entries(reports).map(([name, report]) => [name, report.verified || 0]));
    const complete = !verify || Object.entries(expected).every(([name, count]) => verified[name] === count);
    const ok = complete && Object.values(conflicts).every(count => count === 0);
    const conflictDetails = Object.fromEntries(Object.entries(reports).map(([name, report]) => [name, report.conflicts || []]));
    console.log(JSON.stringify({ ok, mode: verify ? 'read-only-reconciliation' : stage ? 'staging-refresh' : 'read-only-rehearsal', source: values.source, sourceSha256: before,
      reports: Object.fromEntries(Object.entries(reports).map(([name, report]) => [name, summarize(report)])), conflicts, conflictDetails }, null, 2));
    if (!ok) process.exitCode = 1;
  } finally { await connection.close(); }
}

if (require.main === module) main().catch(error => { reportError(error); process.exitCode = 1; });
module.exports = { main, hashFile, summarize };
