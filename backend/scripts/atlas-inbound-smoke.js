const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { WorkerCollection } = require('./atlas-worker-smoke');
const { createTokenCipher } = require('../atlas/tokenCipher');
const { createProviderInbound } = require('../atlas/providerInbound');
const { createProviderService } = require('../atlas/providers');
const { tokenHash } = require('../atlas/accounts');
const argon2 = require('argon2');
const { setupLibrary, LIBRARY_COLLECTIONS } = require('../atlas/librarySchema');
const { setupProviders } = require('../atlas/providerSchema');
const { setupMedia, createMediaService } = require('../atlas/media');
const { connectStaging, reportError } = require('../atlas/connection');

const cipher = createTokenCipher(Buffer.alloc(32, 9).toString('base64'));
const names = ['providerAccounts', 'accountSettings', 'providerRefreshStates', 'providerBudgets', 'libraryEntries', 'libraryChanges', 'libraryState', 'media', 'mediaRedirects', 'mediaMigrationReceipts', 'jobs'];
const fakeClient = { startSession: () => ({ withTransaction: operation => operation(), endSession: async () => {} }) };
function localRepo() { return Object.fromEntries(names.map(name => [name, new WorkerCollection()])); }
function localMedia(repo) {
  return {
    async ensure(type, provider, id) {
      const key = provider === 'anilist' ? 'anilistId' : 'malId'; let row = await repo.media.findOne({ type, [key]: id });
      if (!row) { row = { _id: crypto.randomUUID(), type, [key]: id, metadata: {}, sources: {}, revision: 0 }; await repo.media.insertOne(row); }
      return row;
    },
    async attachVerifiedMapping(id, evidence) { return repo.media.findOneAndUpdate({ _id: id }, { $set: { anilistId: evidence.anilistId, malId: evidence.malId }, $inc: { revision: 1 } }, { returnDocument: 'after' }); },
  };
}
async function link(repo, id, provider) {
  const time = new Date(1700000000000); const userId = `user-${id}`;
  await repo.providerAccounts.insertOne({ _id: `link-${id}`, userId, provider, providerUserId: String(1000 + id.length), username: id,
    accessToken: cipher.encrypt(`${id}-access`), refreshToken: provider === 'mal' ? cipher.encrypt(`${id}-refresh`) : null,
    expiresAt: provider === 'mal' ? new Date(time.getTime() + 3600000) : null, revision: 1, createdAt: time, updatedAt: time });
  await repo.accountSettings.insertOne({ _id: userId, autoSyncEnabled: true, needsDeviceReconciliation: false });
  return userId;
}
const alPayload = (id, progress = 4) => ({ lists: [{ entries: [{ status: 'CURRENT', updatedAt: 1700000001, progress, progressVolumes: 0,
  repeat: 1, notes: 'remote note', score: 8, startedAt: { year: 2024, month: 1, day: 2 }, completedAt: {},
  media: { id, idMal: id + 500 } }] }] });
const malPayload = (id, type) => ({ data: [{ node: { id, title: 'Mapped title' }, list_status: { status: type === 'ANIME' ? 'watching' : 'reading',
  score: 7, [type === 'ANIME' ? 'num_episodes_watched' : 'num_chapters_read']: 6, num_volumes_read: 2,
  updated_at: '2023-11-14T22:13:21Z' } }] });

async function scenario(repo, client, media) {
  let clock = 1700000000000; const userId = await link(repo, 'al', 'anilist'); let pullCalls = 0;
  let observedProgress; const hydratedAniList = [];
  const adapters = { refresh: async () => { throw new Error('unexpected'); }, mapMal: async () => [],
    pull: async (_provider, token, type) => { assert.equal(token, 'al-access'); pullCalls++;
      observedProgress = await repo.providerRefreshStates.findOne({ _id: 'link-al' });
      if (pullCalls === 1) await repo.providerRefreshStates.updateOne({ _id: 'link-al' }, { $set: { manualRequestedAt: new Date(clock) } });
      return type === 'ANIME' ? alPayload(11) : { lists: [] }; } };
  let inbound = createProviderInbound({ client, repo, media, cipher, adapters, metadata: {
    anilist: async (raw, type) => hydratedAniList.push([raw.id, type]),
  }, now: () => clock, spacing: { anilist: 0, mal: 0 } });
  let result = await inbound.runOnce(1); assert.equal(result.results[0].status, 'succeeded'); assert.equal(pullCalls, 2);
  assert.deepEqual(hydratedAniList, [[11, 'ANIME']], 'AniList pull hydrates public card metadata');
  assert.equal(observedProgress.progress.stage, 'fetching');
  assert.equal((await repo.providerRefreshStates.findOne({ _id: 'link-al' })).progress, undefined);
  assert.equal((await repo.providerRefreshStates.findOne({ _id: 'link-al' })).manualRequestedAt, undefined, 'a manual request arriving mid-pull is consumed on success');
  let document = await repo.media.findOne({ anilistId: 11 }); let entry = await repo.libraryEntries.findOne({ userId, mediaId: document._id });
  assert.equal(entry.progress, 4); assert.equal(entry.score, 8); assert.equal(entry.isFavorite, false); assert.equal(entry.revision, 1);
  assert.equal(await repo.jobs.countDocuments({}), 0, 'inbound reconciliation must not echo into the outbound queue');
  assert.equal((await repo.libraryChanges.findOne({ userId })).source, 'provider:anilist');
  await repo.libraryEntries.updateOne({ userId, mediaId: document._id }, { $set: { inboundSources: {} } });
  clock += 6 * 3600000 + 1;
  result = await inbound.runOnce(1);
  assert.equal(result.results[0].counts.applied, 0);
  assert.equal(result.results[0].counts.skipped, 1, 'unchanged provider revisions bypass per-entry reconciliation');
  assert.equal(new Date((await repo.libraryEntries.findOne({ userId, mediaId: document._id })).inboundSources.anilist).getTime(), 1700000001000,
    'matching migrated rows record the provider revision without rewriting the library entry');
  clock += 6 * 3600000 + 1;
  result = await inbound.runOnce(1);
  assert.equal(result.results[0].counts.skipped, 1, 'recorded provider revisions bypass later reconciliation runs');
  assert.equal((await repo.libraryEntries.findOne({ userId, mediaId: document._id })).revision, 1);
  clock = 1700000000000;

  const repoManual = localRepo(); const manualUser = await link(repoManual, 'manual', 'anilist');
  await repoManual.accountSettings.updateOne({ _id: manualUser }, { $set: { autoSyncEnabled: false } });
  await repoManual.providerRefreshStates.insertOne({ _id: 'link-manual', userId: manualUser, provider: 'anilist',
    linkRevision: 1, revision: 0, nextAttemptAt: new Date(0), manualRequestedAt: new Date(clock) });
  const manualAdapters = { ...adapters, pull: async (_provider, token, type) => {
    assert.equal(token, 'manual-access'); return type === 'ANIME' ? alPayload(14) : { lists: [] };
  } };
  inbound = createProviderInbound({ client: fakeClient, repo: repoManual, media: localMedia(repoManual), cipher, adapters: manualAdapters,
    now: () => clock, spacing: { anilist: 0, mal: 0 } });
  result = await inbound.runOnce(1); assert.equal(result.results[0].status, 'succeeded');
  assert.equal(await repoManual.libraryEntries.countDocuments({ userId: manualUser }), 1, 'manual pull runs while automatic sync is disabled');
  assert.equal((await repoManual.providerRefreshStates.findOne({ _id: 'link-manual' })).manualRequestedAt, undefined);

  const repoCancel = localRepo();
  const cancelUser = await link(repoCancel, 'cancel', 'anilist');
  const service = createProviderService({ repo: repoCancel, accounts: { getAuthenticatedUser: async token => token ? { _id: token } : null } });
  await service.requestInboundSync(cancelUser, 'anilist');
  assert.equal((await service.cancelInboundSync('other-user', 'anilist')).ok, false);
  assert.equal((await service.cancelInboundSync(cancelUser, 'anilist')).cancelled, true);
  assert.equal((await service.cancelInboundSync(cancelUser, 'anilist')).cancelled, false);
  assert.equal((await service.inboundSyncStatus(cancelUser, 'anilist')).sync.lastOutcome, 'cancelled');
  assert.equal((await service.inboundSyncStatus(cancelUser, 'anilist')).sync.requestedAt, null);
  await service.requestInboundSync(cancelUser, 'anilist');
  const cancelMedia = localMedia(repoCancel);
  const cancelWorker = createProviderInbound({ client: fakeClient, repo: repoCancel, cipher, spacing: { anilist: 0, mal: 0 },
    media: { ...cancelMedia, ensure: async (type, provider, id) => {
      if (id === 17) assert.equal((await service.cancelInboundSync(cancelUser, 'anilist')).cancelled, true);
      return cancelMedia.ensure(type, provider, id);
    } },
    adapters: { ...adapters, pull: async (_, __, type) => type === 'ANIME' ? { lists: [...alPayload(16).lists, ...alPayload(17).lists] } : { lists: [] } },
  });
  assert.equal((await cancelWorker.runOnce(1)).results[0].status, 'skipped');
  assert.equal(await repoCancel.libraryEntries.countDocuments({ userId: cancelUser }), 1, 'cancellation preserves committed changes and fences later writes');
  const stopped = (await service.inboundSyncStatus(cancelUser, 'anilist')).sync;
  assert.equal(stopped.running, false);
  assert.equal(stopped.lastOutcome, 'cancelled');

  const repoRetry = localRepo();
  const retryUser = await link(repoRetry, 'retry', 'anilist');
  await repoRetry.accountSettings.updateOne({ _id: retryUser }, { $set: { autoSyncEnabled: false } });
  await repoRetry.providerRefreshStates.insertOne({ _id: 'link-retry', userId: retryUser, provider: 'anilist',
    linkRevision: 1, revision: 0, nextAttemptAt: new Date(clock), manualRequestedAt: new Date(clock), attempts: 144 });
  let retryCalls = 0;
  let retryClock = clock;
  const retryWorker = createProviderInbound({ client: fakeClient, repo: repoRetry, cipher, now: () => retryClock,
    spacing: { anilist: 0, mal: 0 }, adapters: { pull: async () => {
      retryCalls++;
      throw Object.assign(new Error('Unavailable'), { status: 503 });
    } } });
  assert.equal((await retryWorker.runOnce(1)).results[0].status, 'failed');
  const exhausted = await repoRetry.providerRefreshStates.findOne({ _id: 'link-retry' });
  assert.equal(exhausted.manualRequestedAt, undefined);
  assert.equal(exhausted.lastOutcome, 'failed');
  const retryService = createProviderService({ repo: repoRetry, accounts: { getAuthenticatedUser: async () => ({ _id: retryUser }) } });
  const restarted = await retryService.requestInboundSync(retryUser, 'anilist');
  assert.equal(restarted.ok, true);
  retryClock = +restarted.requestedAt;
  for (let attempt = 1; attempt <= 6; attempt++) {
    assert.equal((await retryWorker.runOnce(1)).results[0].status, attempt === 6 ? 'failed' : 'retry');
    const state = await repoRetry.providerRefreshStates.findOne({ _id: 'link-retry' });
    assert.equal(state.attempts, attempt);
    assert.equal(Boolean(state.manualRequestedAt), attempt < 6);
    retryClock = +state.nextAttemptAt;
  }
  assert.equal((await retryWorker.runOnce(1)).results[0].status, 'skipped');
  assert.equal(retryCalls, 7);

  const repoLease = localRepo();
  await link(repoLease, 'first', 'anilist');
  await link(repoLease, 'second', 'anilist');
  let leaseClock = clock;
  const leaseWorker = createProviderInbound({ client: fakeClient, repo: repoLease, cipher, now: () => leaseClock,
    spacing: { anilist: 0, mal: 0 }, adapters: { pull: async (_provider, token, type, _id, checkActive) => {
      if (token === 'first-access' && type === 'ANIME') {
        const second = await repoLease.providerRefreshStates.findOne({ _id: 'link-second' });
        assert.equal(second.leaseUntil, undefined);
        leaseClock += 4 * 60000;
        await checkActive();
        leaseClock += 2 * 60000;
        const first = await repoLease.providerRefreshStates.findOne({ _id: 'link-first' });
        assert.ok(+first.leaseUntil > leaseClock);
      }
      return { lists: [] };
    } } });
  assert.deepEqual((await leaseWorker.runOnce(2)).results.map(row => row.status), ['succeeded', 'succeeded']);

  const repoRace = localRepo(); const raceUser = await link(repoRace, 'race', 'anilist'); const raceMedia = localMedia(repoRace);
  document = await raceMedia.ensure('ANIME', 'anilist', 12);
  await repoRace.libraryEntries.insertOne({ _id: JSON.stringify([raceUser, document._id]), userId: raceUser, mediaId: document._id, type: 'ANIME',
    revision: 1, sequence: 1, deleted: false, isFavorite: true, status: 'watching', progress: 2, volumeProgress: 0, repeatCount: 0,
    isRepeating: false, score: null, notes: null, startedAt: null, completedAt: null, createdAt: new Date(clock - 10), updatedAt: new Date(clock - 10) });
  const raceAdapters = { ...adapters, pull: async (_provider, _token, type) => {
    if (type === 'ANIME') await repoRace.libraryEntries.updateOne({ userId: raceUser }, { $set: { progress: 99, updatedAt: new Date(clock + 1) }, $inc: { revision: 1 } });
    return type === 'ANIME' ? alPayload(12, 5) : { lists: [] };
  } };
  inbound = createProviderInbound({ client: fakeClient, repo: repoRace, media: raceMedia, cipher, adapters: raceAdapters, now: () => clock, spacing: { anilist: 0, mal: 0 } });
  result = await inbound.runOnce(1); entry = await repoRace.libraryEntries.findOne({ userId: raceUser });
  assert.equal(result.results[0].counts.applied, 0); assert.equal(entry.progress, 99); assert.equal(entry.isFavorite, true);

  const repoUnlink = localRepo(); const unlinkUser = await link(repoUnlink, 'unlink', 'anilist');
  const unlinkAdapters = { ...adapters, pull: async (_provider, _token, type) => {
    if (type === 'MANGA') await repoUnlink.providerAccounts.deleteOne({ userId: unlinkUser });
    return type === 'ANIME' ? alPayload(13) : { lists: [] };
  } };
  inbound = createProviderInbound({ client: fakeClient, repo: repoUnlink, media: localMedia(repoUnlink), cipher, adapters: unlinkAdapters,
    now: () => clock, spacing: { anilist: 0, mal: 0 } });
  result = await inbound.runOnce(1); assert.equal(result.results[0].status, 'skipped');
  assert.equal(await repoUnlink.libraryEntries.countDocuments({}), 0, 'unlink during a pull prevents later reconciliation');

  // Delete after the outer ownership check, while media resolution is in flight.
  // This used to recreate libraryEntries/libraryState after account erasure.
  const repoDelete = localRepo(); const deleteUser = await link(repoDelete, 'delete', 'anilist');
  repoDelete.users = new WorkerCollection(); repoDelete.sessions = new WorkerCollection();
  const deleteToken = 'a'.repeat(64);
  const account = { _id: deleteUser, username: 'DeleteUser', authVersion: 0, local_credentials_confirmed: true, password_hash: await argon2.hash('delete-password') };
  await repoDelete.users.insertOne(account);
  await repoDelete.sessions.insertOne({ _id: tokenHash(deleteToken), userId: deleteUser, expiresAt: new Date(Date.now() + 60000) });
  for (const collection of Object.values(repoDelete)) collection.deleteMany = async query => {
    let deletedCount = 0;
    while ((await collection.deleteOne(query)).deletedCount) deletedCount++;
    return { deletedCount };
  };
  const deletion = createProviderService({ client: fakeClient, repo: repoDelete, cipher, adapters: {},
    accounts: { getAuthenticatedUser: async () => repoDelete.users.findOne({ _id: deleteUser, authVersion: 0 }) } });
  assert.equal((await deletion.deleteAccount(deleteToken, 'DeleteUser', 'wrong-password')).ok, false);
  const deleteMedia = localMedia(repoDelete); const originalEnsure = deleteMedia.ensure;
  deleteMedia.ensure = async (...args) => {
    const document = await originalEnsure(...args);
    assert.equal((await deletion.deleteAccount(deleteToken, 'DeleteUser', 'delete-password')).ok, true);
    return document;
  };
  inbound = createProviderInbound({ client: fakeClient, repo: repoDelete, media: deleteMedia, cipher,
    adapters: { ...adapters, pull: async (_provider, _token, type) => type === 'ANIME' ? alPayload(14) : { lists: [] } },
    now: () => clock, spacing: { anilist: 0, mal: 0 } });
  result = await inbound.runOnce(1);
  assert.equal(result.results[0].status, 'skipped');
  for (const name of ['libraryEntries', 'libraryChanges', 'providerRefreshStates']) assert.equal(await repoDelete[name].countDocuments({ userId: deleteUser }), 0, `${name} stays erased after an in-flight pull`);
  assert.equal(await repoDelete.libraryState.countDocuments({ _id: deleteUser }), 0, 'library state stays erased');
  assert.equal((await repoDelete.users.findOne({ _id: deleteUser })).status, 'deleted');
  assert.equal(await repoDelete.sessions.countDocuments({ userId: deleteUser }), 0, 'sessions revoked');

  const providerOnlyDeletion = createProviderService({ client: fakeClient, repo: {}, cipher, adapters: {},
    accounts: { getAuthenticatedUser: async () => ({ local_credentials_confirmed: false }) } });
  const setupNeeded = await providerOnlyDeletion.deleteAccount(deleteToken, 'ProviderOnly', '');
  assert.equal(setupNeeded.ok, false);
  assert.equal(setupNeeded.needsLocalPassword, true, 'provider-only accounts receive password setup guidance');

  // Seed may already hold a stale list of links when account erasure completes.
  const repoSeed = localRepo(); const seedUser = await link(repoSeed, 'seed-delete', 'anilist');
  const originalFind = repoSeed.providerAccounts.find.bind(repoSeed.providerAccounts);
  repoSeed.providerAccounts.find = (...args) => {
    const cursor = originalFind(...args); const originalToArray = cursor.toArray.bind(cursor);
    cursor.toArray = async () => { const rows = await originalToArray(); await repoSeed.providerAccounts.deleteOne({ userId: seedUser }); return rows; };
    return cursor;
  };
  inbound = createProviderInbound({ client: fakeClient, repo: repoSeed, media: localMedia(repoSeed), cipher, adapters,
    now: () => clock, spacing: { anilist: 0, mal: 0 } });
  await inbound.seed();
  assert.equal(await repoSeed.providerRefreshStates.countDocuments({ userId: seedUser }), 0, 'stale seeding cannot recreate refresh state');

  const repoMal = localRepo(); const malUser = await link(repoMal, 'mal', 'mal'); let mappedBatches = 0; const mappingProgress = [];
  const hydratedMal = []; const hydratedMappings = [];
  const malAdapters = { refresh: async () => ({ access_token: 'new' }), pull: async (_provider, token, type) => {
    assert.equal(token, 'mal-access'); return malPayload(type === 'ANIME' ? 21 : 22, type);
  }, mapMal: async (type, ids) => { mappedBatches++;
    mappingProgress.push((await repoMal.providerRefreshStates.findOne({ _id: 'link-mal' })).progress);
    return ids.map(id => ({ id: id + 100, idMal: id, type })); } };
  inbound = createProviderInbound({ client: fakeClient, repo: repoMal, media: localMedia(repoMal), cipher, adapters: malAdapters, metadata: {
    anilist: async (raw, type) => hydratedMappings.push([raw.id, raw.idMal, type]),
    mal: async (raw, type) => hydratedMal.push([raw.id, raw.title, type]),
  },
    now: () => clock, spacing: { anilist: 0, mal: 0 } });
  result = await inbound.runOnce(1); assert.equal(result.results[0].counts.applied, 2); assert.equal(mappedBatches, 2);
  assert.deepEqual(mappingProgress.map(progress => [progress.stage, progress.current, progress.total]), [['mapping', 0, 2], ['mapping', 1, 2]]);
  assert.deepEqual(hydratedMappings, [[121, 21, 'ANIME'], [122, 22, 'MANGA']]);
  assert.deepEqual(hydratedMal, [[21, 'Mapped title', 'ANIME'], [22, 'Mapped title', 'MANGA']]);
  assert.equal((await repoMal.media.findOne({ type: 'ANIME', malId: 21 })).anilistId, 121);
  assert.equal((await repoMal.libraryEntries.findOne({ userId: malUser, type: 'MANGA' })).volumeProgress, 2);
  console.log('PASS: scheduled AL/MAL pulls, normalized inbound fields, bulk exact MAL mapping, ordered CAS reconciliation, favorite preservation, and no outbound echo.');
}

async function main() {
  if (!process.argv.includes('--atlas')) { const repo = localRepo(); return scenario(repo, fakeClient, localMedia(repo)); }
  const connection = await connectStaging(); const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  try {
    const library = await setupLibrary(connection.db, prefix); const providers = await setupProviders(connection.db, prefix); const mediaRepo = await setupMedia(connection.db, prefix);
    const repo = { ...library, ...providers, ...mediaRepo, providerBudgets: library.providerBudgets, providerRefreshStates: library.providerRefreshStates };
    await scenario(repo, connection.client, createMediaService(connection.client, repo));
  } finally {
    const cleanup = [...new Set([...LIBRARY_COLLECTIONS, 'providerAccounts', 'oauthFlows', 'accountSettings', 'providerMigrationReceipts', 'media', 'mediaRedirects', 'mediaMigrationReceipts'])];
    try { for (const name of cleanup) await connection.db.collection(prefix + name).drop().catch(error => { if (error.code !== 26) throw error; }); }
    finally { await connection.close(); }
  }
}
if (require.main === module) main().catch(error => { if (process.argv.includes('--atlas')) reportError(error); else console.error(error); process.exitCode = 1; });
module.exports = { main };
