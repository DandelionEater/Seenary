require('../env');
const { parseArgs } = require('node:util');
const { connectRuntime, reportError } = require('../atlas/connection');
const { collections } = require('../atlas/accounts');
const { readSqliteAccounts, convertAccount, accountFields } = require('../atlas/importAccounts');
const { readProviderData } = require('../atlas/importProviders');
const { providerCollections } = require('../atlas/providerSchema');
const { createTokenCipher } = require('../atlas/tokenCipher');
const { readMediaData } = require('../atlas/importMedia');
const { mediaCollections } = require('../atlas/media');

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function changedPaths(left, right, prefix = '') {
  if (same(left, right)) return [];
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)
      || left instanceof Date || right instanceof Date) return [prefix || '(root)'];
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    .flatMap(key => changedPaths(left[key], right[key], prefix ? `${prefix}.${key}` : key));
}
function date(value) { if (value == null) return null; return new Date(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? value.replace(' ', 'T') + 'Z' : value); }

async function main() {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true,
    options: { sqlite: { type: 'string' }, source: { type: 'string' } } });
  if (positionals.length !== 1 || positionals[0] !== 'diff' || !values.sqlite || !values.source) throw new Error('Use diff --sqlite PATH --source NAME.');
  const connection = await connectRuntime();
  try {
    const accountRepo = collections(connection.db); const accounts = [];
    for (const row of readSqliteAccounts(values.sqlite)) {
      const expected = convertAccount(row, values.source); const current = await accountRepo.users.findOne({ legacyKey: expected.legacyKey });
      if (current?.sourceFingerprint !== expected.sourceFingerprint) accounts.push({ legacyId: row.id, changedFields: changedPaths(accountFields(current || {}), accountFields(expected)) });
    }
    const providerRepo = providerCollections(connection.db); const sourceCipher = createTokenCipher(process.env.MIGRATION_TOKEN_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY);
    const targetCipher = createTokenCipher(process.env.TOKEN_ENCRYPTION_KEY); const providers = [];
    for (const { provider, row } of readProviderData(values.sqlite).links) {
      const receipt = await providerRepo.providerMigrationReceipts.findOne({ _id: JSON.stringify([values.source, provider, row.user_id]) });
      const user = await accountRepo.users.findOne({ legacyKey: JSON.stringify([values.source, row.user_id]) });
      const current = user && await providerRepo.providerAccounts.findOne({ userId: user._id, provider });
      const sourceToken = value => value ? sourceCipher.decrypt(value) : null;
      const fields = { providerUserId: String(row[`${provider}_user_id`]), username: row[`${provider}_username`], originalUsername: row[`original_${provider}_username`],
        expiresAt: date(row.token_expires_at), createdAt: date(row.created_at), updatedAt: date(row.updated_at), lastImportAt: date(row.last_import_at) };
      const changedFields = current ? changedPaths(Object.fromEntries(Object.keys(fields).map(key => [key, current[key]])), fields) : ['missing'];
      if (!current || targetCipher.decrypt(current.accessToken) !== sourceToken(row.access_token)) changedFields.push('accessToken');
      if (!current || targetCipher.decrypt(current.refreshToken) !== sourceToken(row.refresh_token)) changedFields.push('refreshToken');
      const crypto = require('node:crypto'); const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ provider, row })).digest('hex');
      if (receipt?.fingerprint !== fingerprint) providers.push({ provider, legacyUserId: row.user_id, changedFields: [...new Set(changedFields)].sort() });
    }
    const mediaRepo = mediaCollections(connection.db); const receipts = new Map((await mediaRepo.mediaMigrationReceipts.find({ source: values.source }).toArray()).map(item => [item._id, item]));
    const media = [];
    for (const entry of readMediaData(values.sqlite).entries) {
      const receipt = receipts.get(JSON.stringify([values.source, entry.type, entry.row.id]));
      if (receipt && !same(receipt.snapshot, entry)) media.push({ type: entry.type, legacyId: entry.row.id, changedFields: changedPaths(receipt.snapshot, entry) });
    }
    console.log(JSON.stringify({ accounts, providers, media }, null, 2));
  } finally { await connection.close(); }
}

if (require.main === module) main().catch(error => { reportError(error); process.exitCode = 1; });
module.exports = { main, changedPaths };
