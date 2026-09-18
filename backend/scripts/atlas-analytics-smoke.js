require('../env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupAccounts, createAccountService } = require('../atlas/accounts');
const { setupProviders } = require('../atlas/providerSchema');
const { setupLibrary, LIBRARY_COLLECTIONS } = require('../atlas/librarySchema');
const { setupAnalytics, createAnalyticsService, monthlyKey } = require('../atlas/analytics');
const { createProviderService } = require('../atlas/providers');
const { createTokenCipher } = require('../atlas/tokenCipher');

async function main() {
  const connection = await connectStaging(); const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  const analyticsSecret = 'synthetic-atlas-analytics-secret-at-least-32-characters'; const previousSecret = process.env.ANALYTICS_HMAC_SECRET;
  process.env.ANALYTICS_HMAC_SECRET = analyticsSecret;
  try {
    const accountsRepo = await setupAccounts(connection.db, prefix); const providersRepo = await setupProviders(connection.db, prefix);
    const library = await setupLibrary(connection.db, prefix); const analyticsRepo = await setupAnalytics(connection.db, prefix);
    const repo = { ...accountsRepo, ...providersRepo, ...library, ...analyticsRepo }; const accounts = await createAccountService(repo);
    const alice = await accounts.register('AnalyticsAlice', 'alice-password'); const bob = await accounts.register('AnalyticsBob', 'bob-password');
    let clock = new Date('2026-07-03T23:59:59Z'); const analytics = createAnalyticsService({ repo, accounts, now: () => clock, analyticsSecret });
    assert.equal((await analytics.record(alice.token, { platform: 'win32', appVersion: '0.1.12-beta', userId: bob.user.id })).consentRequired, true);
    assert.equal(await repo.analyticsDaily.countDocuments({}), 0);
    assert.equal((await analytics.consent(alice.token, true)).enabled, true);
    assert.equal((await analytics.record(alice.token, { platform: 'win32', appVersion: '0.1.12-beta', userId: bob.user.id })).recorded, true);
    assert.equal((await analytics.record(alice.token, { platform: 'linux', appVersion: 'changed' })).duplicate, true);
    assert.equal((await analytics.record(bob.token, { platform: 'linux', appVersion: '0.1.12-beta' })).consentRequired, true);
    let row = await repo.analyticsDaily.findOne({}); assert.equal(row.platform, 'windows'); assert.equal(row.appVersion, '0.1.12-beta');
    assert.equal(row.userId, undefined); assert(!JSON.stringify(row).includes('AnalyticsAlice')); assert(!JSON.stringify(row).includes('AnalyticsBob'));
    assert.equal(row.monthlyKey, monthlyKey(alice.user.id, '2026-07', analyticsSecret));
    clock = new Date('2026-08-01T00:00:01Z'); await analytics.record(alice.token, { platform: 'bad value', appVersion: 'bad version' });
    row = await repo.analyticsDaily.findOne({ activityMonth: '2026-08' }); assert.equal(row.platform, 'unknown'); assert.equal(row.appVersion, 'unknown');
    assert.notEqual(row.monthlyKey, monthlyKey(alice.user.id, '2026-07', analyticsSecret));
    const report = await analytics.report(40); assert.equal(report.overview.registeredAccounts, 2); assert.equal(report.overview.observedActiveAccounts, 1);
    assert(!JSON.stringify(report).includes('monthlyKey')); assert(!JSON.stringify(report).includes('AnalyticsAlice'));
    const optOut = await analytics.consent(alice.token, false); assert.equal(optOut.removed, 2); assert.equal(await repo.analyticsDaily.countDocuments({}), 0);

    await analytics.consent(alice.token, true); clock = new Date('2026-06-01T00:00:00Z'); await analytics.record(alice.token, { platform: 'web', appVersion: '1.0.0' });
    clock = new Date('2026-09-01T00:00:00Z'); const finalized = await analytics.finalize(); assert.equal(finalized.finalized, 1); assert.equal(finalized.pruned, 1);
    assert.equal((await repo.analyticsMonthly.findOne({ _id: '2026-06' })).aggregate.monthlyActiveUsers, 1);
    assert.equal(await repo.analyticsDaily.countDocuments({}), 0); assert(!JSON.stringify(await repo.analyticsMonthly.findOne({})).includes('monthlyKey'));

    clock = new Date('2026-09-02T00:00:00Z'); await analytics.record(alice.token, { platform: 'web', appVersion: '1.0.0' });
    const providerService = createProviderService({ client: connection.client, repo, accounts,
      cipher: createTokenCipher(Buffer.alloc(32, 4).toString('base64')), adapters: {} });
    assert.equal((await providerService.deleteAccount(alice.token, 'AnalyticsAlice', 'alice-password')).ok, true);
    assert.equal(await repo.analyticsDaily.countDocuments({}), 0, 'account deletion removes retained pseudonymous daily rows');
    assert.equal(await repo.analyticsMonthly.countDocuments({ _id: '2026-06' }), 1, 'anonymous finalized aggregate survives');
    console.log('PASS: authenticated explicit consent, server-owned identity, month-scoped pseudonyms, daily deduplication, opt-out/deletion erasure, 45-day pruning, and anonymous finalized reports.');
  } finally {
    if (previousSecret === undefined) delete process.env.ANALYTICS_HMAC_SECRET; else process.env.ANALYTICS_HMAC_SECRET = previousSecret;
    const names = new Set([...LIBRARY_COLLECTIONS, 'users', 'sessions', 'providerAccounts', 'oauthFlows', 'accountSettings', 'providerMigrationReceipts', 'analyticsDaily', 'analyticsMonthly']);
    try { for (const name of names) await connection.db.collection(prefix + name).drop().catch(error => { if (error.code !== 26) throw error; }); }
    finally { await connection.close(); }
  }
}
if (require.main === module) main().catch(error => { reportError(error); process.exitCode = 1; });
module.exports = { main };
