const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { WorkerCollection } = require('./atlas-worker-smoke');
const { createTokenCipher, PREFIX } = require('../atlas/tokenCipher');
const { createJobWorker } = require('../atlas/jobWorker');
const { createProviderDelivery } = require('../atlas/providerDelivery');
const { setupLibrary, LIBRARY_COLLECTIONS } = require('../atlas/librarySchema');
const { setupProviders } = require('../atlas/providerSchema');
const { connectStaging, reportError } = require('../atlas/connection');

const NAMES = ['jobs', 'jobLocks', 'providerBudgets', 'accountSettings', 'providerAccounts', 'libraryEntries', 'media'];
const key = Buffer.alloc(32, 7).toString('base64');
const cipher = createTokenCipher(key);
function localRepo() { return Object.fromEntries(NAMES.map(name => [name, new WorkerCollection()])); }

async function seed(repo, id, provider, extra = {}) {
  const time = new Date(1700000000000);
  const userId = `user-${id}`; const mediaId = `media-${id}`; const linkId = `link-${id}`;
  const providerUserId = String(parseInt(crypto.createHash('sha256').update(id).digest('hex').slice(0, 7), 16) + 1);
  const type = extra.type || 'ANIME'; const providerMediaId = extra.providerMediaId || (provider === 'anilist' ? 101 : 202);
  await repo.accountSettings.insertOne({ _id: userId, autoSyncEnabled: extra.autoSyncEnabled ?? true, needsDeviceReconciliation: false });
  await repo.providerAccounts.insertOne({ _id: linkId, userId, provider, providerUserId, username: id,
    accessToken: cipher.encrypt(`${provider}-${id}-access`), refreshToken: provider === 'mal' ? cipher.encrypt(`${provider}-${id}-refresh`) : null,
    expiresAt: provider === 'mal' ? new Date(extra.expiresAt ?? 1700000000000 + 3600000) : null,
    revision: 1, createdAt: time, updatedAt: time });
  await repo.media.insertOne({ _id: mediaId, type, anilistId: provider === 'anilist' ? providerMediaId : 303, malId: provider === 'mal' ? providerMediaId : 404 });
  await repo.libraryEntries.insertOne({ _id: JSON.stringify([userId, mediaId]), userId, mediaId, type, revision: 1, sequence: 1,
    deleted: extra.operation === 'delete', isFavorite: false, status: 'watching', progress: 12, volumeProgress: 3,
    repeatCount: 2, isRepeating: true, score: 8, notes: 'private note', startedAt: '2024-01-02', completedAt: null,
    createdAt: time, updatedAt: time });
  await repo.jobs.insertOne({ _id: `job-${id}`, kind: 'provider-library', userId, mediaId, provider, providerLinkId: linkId,
    providerLinkRevision: 1, providerMediaId, libraryRevision: 1, operation: extra.operation || 'upsert', status: 'pending',
    payload: {}, mediaType: type, createdAt: time });
  return { userId, mediaId, linkId, providerUserId, jobId: `job-${id}` };
}

async function claim(repo, clock) {
  const worker = createJobWorker({ repo, now: () => clock.value, leaseMs: 5000, maxAttempts: 3 });
  const [item] = await worker.claimBatch(1);
  assert(item, 'fixture job must be claimable');
  return { worker, item };
}

async function verify(repo) {
  const clock = { value: 1700000000000 };
  const calls = [];
  const adapters = {
    anilist: {
      async upsert(token, id, data) { calls.push({ provider: 'anilist', action: 'upsert', token, id, data }); return { id: 50, updatedAt: 99 }; },
      async delete(token, id, data) { calls.push({ provider: 'anilist', action: 'delete', token, id, data }); return { deleted: true }; },
    },
    mal: {
      async refresh(token) { calls.push({ provider: 'mal', action: 'refresh', token }); return { access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600 }; },
      async upsert(token, id, data) { calls.push({ provider: 'mal', action: 'upsert', token, id, data }); return { updatedAt: 'remote-mal' }; },
      async delete(token, id, data) { calls.push({ provider: 'mal', action: 'delete', token, id, data }); return { deleted: true }; },
    },
  };
  const alFixture = await seed(repo, 'al-success', 'anilist');
  let owned = await claim(repo, clock);
  let delivery = createProviderDelivery({ repo, worker: owned.worker, cipher, adapters, now: () => clock.value, spacing: { anilist: 0, mal: 0 } });
  assert.equal((await delivery.deliver(owned.item)).status, 'succeeded');
  const al = calls.at(-1);
  assert.deepEqual({ status: al.data.status, score: al.data.score, progress: al.data.progress, userId: al.data.userId },
    { status: 'CURRENT', score: 8, progress: 12, userId: Number(alFixture.providerUserId) });
  assert.equal(al.token, 'anilist-al-success-access');
  assert(!JSON.stringify(await repo.jobs.findOne({ _id: 'job-al-success' })).includes('private note'));

  clock.value += 1;
  const malFixture = await seed(repo, 'mal-refresh', 'mal', { type: 'MANGA', expiresAt: clock.value + 1000 });
  owned = await claim(repo, clock);
  delivery = createProviderDelivery({ repo, worker: owned.worker, cipher, adapters, now: () => clock.value, spacing: { anilist: 0, mal: 0 } });
  assert.equal((await delivery.deliver(owned.item)).status, 'succeeded');
  const malWrite = calls.at(-1); const refreshed = await repo.providerAccounts.findOne({ _id: malFixture.linkId });
  assert.equal(malWrite.data.mediaType, 'MANGA'); assert.equal(malWrite.data.score, 8); assert.equal(malWrite.data.volumeProgress, 3);
  assert.equal(malWrite.token, 'rotated-access'); assert.equal(cipher.decrypt(refreshed.accessToken), 'rotated-access');
  assert.equal(cipher.decrypt(refreshed.refreshToken), 'rotated-refresh'); assert.equal(refreshed.revision, 2);
  assert(refreshed.accessToken.startsWith(PREFIX)); assert(!JSON.stringify(refreshed).includes('rotated-access'));

  for (const [suffix, mutation, reason] of [
    ['disabled', async fixture => repo.accountSettings.updateOne({ _id: fixture.userId }, { $set: { autoSyncEnabled: false } }), 'sync_disabled'],
    ['unlinked', async fixture => repo.providerAccounts.deleteOne({ _id: fixture.linkId }), 'unlinked'],
    ['newer', async fixture => repo.libraryEntries.updateOne({ userId: fixture.userId, mediaId: fixture.mediaId }, { $inc: { revision: 1 } }), 'superseded'],
    ['remapped', async fixture => repo.media.updateOne({ _id: fixture.mediaId }, { $set: { anilistId: 999 } }), 'mapping_changed'],
  ]) {
    clock.value += 1; const fixture = await seed(repo, `cancel-${suffix}`, 'anilist'); owned = await claim(repo, clock); await mutation(fixture);
    const before = calls.length;
    const result = await createProviderDelivery({ repo, worker: owned.worker, cipher, adapters, now: () => clock.value,
      spacing: { anilist: 0, mal: 0 } }).deliver(owned.item);
    assert.equal(result.status, 'cancelled'); assert.equal(calls.length, before, 'cancelled job must not reach provider');
    assert.equal((await repo.jobs.findOne({ _id: fixture.jobId })).cancellationReason, reason);
  }

  clock.value += 1; const rejected = await seed(repo, 'mal-rejected', 'mal'); owned = await claim(repo, clock);
  const rejecting = { ...adapters, mal: { ...adapters.mal, async upsert() { throw Object.assign(new Error('secret provider response'), { status: 400 }); } } };
  let result = await createProviderDelivery({ repo, worker: owned.worker, cipher, adapters: rejecting, now: () => clock.value,
    spacing: { anilist: 0, mal: 0 } }).deliver(owned.item);
  assert.equal(result.status, 'failed'); assert.equal((await repo.providerAccounts.findOne({ _id: rejected.linkId })).needsReauthorization, true);
  const rejectedJob = await repo.jobs.findOne({ _id: rejected.jobId }); assert.equal(rejectedJob.lastErrorCode, 'REAUTHORIZATION_REQUIRED');
  assert(!JSON.stringify(rejectedJob).includes('secret provider response'));

  clock.value += 1; await seed(repo, 'budget-one', 'anilist'); await seed(repo, 'budget-two', 'anilist');
  const budgetWorker = createJobWorker({ repo, now: () => clock.value, leaseMs: 5000 });
  delivery = createProviderDelivery({ repo, worker: budgetWorker, cipher, adapters, now: () => clock.value,
    spacing: { anilist: 1000, mal: 1000 } });
  const batch = await delivery.runOnce(2);
  assert.equal(batch.claimed, 2); assert.equal(batch.results.filter(item => item.status === 'succeeded').length, 1);
  assert.equal(batch.results.filter(item => item.code === 'PROVIDER_BUDGET').length, 1);
  const budgetRetry = await repo.jobs.findOne({ status: 'retry', lastErrorCode: 'PROVIDER_BUDGET' });
  assert.equal(budgetRetry.nextAttemptAt.getTime(), clock.value + 1000);
  assert(!JSON.stringify(repo.providerBudgets.rows || []).includes('access'));
  console.log('PASS: AL/MAL delivery translation, encrypted MAL refresh, exact revision/link/mapping cancellation, safe rejection, and shared provider budgets.');
}

async function main() {
  if (!process.argv.includes('--atlas')) return verify(localRepo());
  const connection = await connectStaging(); const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  try {
    const library = await setupLibrary(connection.db, prefix); const providers = await setupProviders(connection.db, prefix);
    await verify({ ...library, ...providers, media: connection.db.collection(prefix + 'media') });
  } finally {
    const names = [...new Set([...LIBRARY_COLLECTIONS, 'providerAccounts', 'oauthFlows', 'accountSettings', 'providerMigrationReceipts', 'media'])];
    try { for (const name of names) await connection.db.collection(prefix + name).drop().catch(error => { if (error.code !== 26) throw error; }); }
    finally { await connection.close(); }
  }
}
if (require.main === module) main().catch(error => {
  if (!process.argv.includes('--atlas')) console.error(`Provider delivery smoke failed: ${error.name}: ${error.message}`);
  else reportError(error);
  process.exitCode = 1;
});
module.exports = { main, verify };
