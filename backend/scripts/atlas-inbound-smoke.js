const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { WorkerCollection } = require('./atlas-worker-smoke');
const { createTokenCipher } = require('../atlas/tokenCipher');
const { createProviderInbound } = require('../atlas/providerInbound');
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
  let observedProgress;
  const adapters = { refresh: async () => { throw new Error('unexpected'); }, mapMal: async () => [],
    pull: async (_provider, token, type) => { assert.equal(token, 'al-access'); pullCalls++;
      observedProgress = await repo.providerRefreshStates.findOne({ _id: 'link-al' });
      return type === 'ANIME' ? alPayload(11) : { lists: [] }; } };
  let inbound = createProviderInbound({ client, repo, media, cipher, adapters, now: () => clock, spacing: { anilist: 0, mal: 0 } });
  let result = await inbound.runOnce(1); assert.equal(result.results[0].status, 'succeeded'); assert.equal(pullCalls, 2);
  assert.equal(observedProgress.progress.stage, 'fetching');
  assert.equal((await repo.providerRefreshStates.findOne({ _id: 'link-al' })).progress, undefined);
  let document = await repo.media.findOne({ anilistId: 11 }); let entry = await repo.libraryEntries.findOne({ userId, mediaId: document._id });
  assert.equal(entry.progress, 4); assert.equal(entry.score, 80); assert.equal(entry.isFavorite, false); assert.equal(entry.revision, 1);
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

  const repoMal = localRepo(); const malUser = await link(repoMal, 'mal', 'mal'); let mappedBatches = 0;
  const malAdapters = { refresh: async () => ({ access_token: 'new' }), pull: async (_provider, token, type) => {
    assert.equal(token, 'mal-access'); return malPayload(type === 'ANIME' ? 21 : 22, type);
  }, mapMal: async (type, ids) => { mappedBatches++; return ids.map(id => ({ id: id + 100, idMal: id, type })); } };
  inbound = createProviderInbound({ client: fakeClient, repo: repoMal, media: localMedia(repoMal), cipher, adapters: malAdapters,
    now: () => clock, spacing: { anilist: 0, mal: 0 } });
  result = await inbound.runOnce(1); assert.equal(result.results[0].counts.applied, 2); assert.equal(mappedBatches, 2);
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
