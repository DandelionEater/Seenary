const { safeUser } = require('./accounts');

const USER_ID_COLLECTIONS = [
  'sessions', 'providerAccounts', 'oauthFlows', 'providerMigrationReceipts', 'libraryEntries', 'libraryChanges',
  'librarySnapshots', 'mutationReceipts', 'libraryMigrationReceipts', 'jobs', 'jobLocks', 'providerRefreshStates',
];
const USER_KEY_COLLECTIONS = ['accountSettings', 'libraryState'];
const EXPORT_COLLECTIONS = [
  'accountSettings', 'providerAccounts', 'libraryEntries', 'libraryChanges', 'libraryState', 'librarySnapshots',
  'mutationReceipts', 'libraryMigrationReceipts', 'jobs', 'providerRefreshStates',
];
const PRIVATE_KEYS = new Set(['accessToken', 'refreshToken', 'password_hash', 'sourceFingerprint', 'legacyKey', 'legacy',
  'leaseOwner', 'leaseUntil', 'refreshLease', 'refreshLeaseUntil', 'owner', 'bindingHash', 'sessionHash', 'verifier']);

function portable(value) {
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(portable);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_KEYS.has(key)).map(([key, item]) => [key, portable(item)]));
}
async function rows(collection, query) {
  return collection ? collection.find(query).sort({ _id: 1 }).toArray() : [];
}
async function exportAccountData(repo, user) {
  if (!user || user.status === 'deleted') throw new Error('Account is unavailable.');
  const data = {};
  for (const name of EXPORT_COLLECTIONS) {
    const query = USER_KEY_COLLECTIONS.includes(name) ? { _id: user._id } : { userId: user._id };
    data[name] = portable(await rows(repo[name], query));
  }
  return { format: 'seenary.account-export', version: 1, exportedAt: new Date().toISOString(), account: portable(safeUser(user)), data };
}
async function eraseAccountData(repo, userId, session) {
  const counts = {};
  for (const name of USER_ID_COLLECTIONS) {
    if (!repo[name]) continue;
    const result = await repo[name].deleteMany({ userId }, { session }); counts[name] = result.deletedCount;
  }
  for (const name of USER_KEY_COLLECTIONS) {
    if (!repo[name]) continue;
    const result = await repo[name].deleteOne({ _id: userId }, { session }); counts[name] = result.deletedCount;
  }
  if (repo.analyticsDaily) {
    const secret = String(process.env.ANALYTICS_HMAC_SECRET || '').trim();
    if (secret.length >= 32) {
      const months = [...new Set((await repo.analyticsDaily.find({}, { session }).toArray()).map(row => row.activityMonth))];
      const keys = months.map(month => require('node:crypto').createHmac('sha256', secret).update(`${month}:${userId}`).digest('base64url'));
      if (keys.length) counts.analyticsDaily = (await repo.analyticsDaily.deleteMany({ monthlyKey: { $in: keys } }, { session })).deletedCount;
    }
  }
  return counts;
}
module.exports = { exportAccountData, eraseAccountData, portable, USER_ID_COLLECTIONS, USER_KEY_COLLECTIONS, EXPORT_COLLECTIONS };
