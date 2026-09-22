require('../env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupAccounts, createAccountService } = require('../atlas/accounts');
const { setupProviders } = require('../atlas/providerSchema');
const { createProviderService } = require('../atlas/providers');
const { createTokenCipher } = require('../atlas/tokenCipher');
const { setupMedia, createMediaService } = require('../atlas/media');
const { setupLibrary, LIBRARY_COLLECTIONS } = require('../atlas/librarySchema');
const { createLibraryService } = require('../atlas/library');
const { readLibraryData, importLibrary } = require('../atlas/importLibrary');
const { createStagingServer } = require('../atlas/stagingServer');

async function main() {
  const connection = await connectStaging();
  const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'seenary-library-'));
  const filename = path.join(temp, 'source.sqlite');
  let server;
  try {
    const accounts = await createAccountService(await setupAccounts(connection.db, prefix));
    const providerRepo = await setupProviders(connection.db, prefix);
    const media = createMediaService(connection.client, await setupMedia(connection.db, prefix));
    const repo = await setupLibrary(connection.db, prefix);
    await setupLibrary(connection.db, prefix);
    const library = createLibraryService({ client: connection.client, repo, accounts, media });
    const alice = await accounts.register('LibraryAlice', 'alice-password');
    const otherDevice = await accounts.login('LibraryAlice', 'alice-password');
    const bob = await accounts.register('LibraryBob', 'bob-password');
    const anime = await media.ensure('ANIME', 'anilist', 1);
    const manga = await media.ensure('MANGA', 'anilist', 1);
    const third = await media.ensure('ANIME', 'mal', 20);
    await repo.media.updateOne({ _id: anime._id }, { $set: { 'metadata.recommendations': [{ id: 2 }] } });
    await repo.media.updateOne({ _id: manga._id }, { $set: { 'metadata.recommendations': [{ id: 3 }] } });
    const request = (mediaId, expectedRevision, patch = {}, action = 'upsert', extra = {}) => ({ operationId: crypto.randomUUID(), mediaId, expectedRevision, action, patch, ...extra });
    const initial = request(anime._id, 0, { isFavorite: true, progress: 4, status: 'watching', notes: 'keep me' });
    const created = await library.mutate(alice.token, initial);
    assert.equal(created.ok, true);
    assert.equal(created.entry.revision, 1);
    assert.equal((await library.get(otherDevice.token, anime._id)).entry.isFavorite, true);
    assert.equal((await library.get(bob.token, anime._id)).entry, null);
    assert.equal((await library.mutate('', initial)).code, 'UNAUTHENTICATED');
    assert.equal((await library.mutate(alice.token, { ...initial, userId: bob.user.id })).code, 'INVALID_MUTATION');
    assert.deepEqual(await library.mutate(otherDevice.token, initial), created, 'same operation returns committed result');
    assert.equal((await library.mutate(alice.token, { ...initial, patch: { isFavorite: false } })).code, 'OPERATION_ID_REUSED');
    const concurrent = await Promise.all([
      library.mutate(alice.token, request(anime._id, 1, { isFavorite: false })),
      library.mutate(otherDevice.token, request(anime._id, 1, { progress: 5 })),
    ]);
    assert.equal(concurrent.filter((item) => item.ok).length, 1);
    assert.equal(concurrent.find((item) => !item.ok).code, 'REVISION_CONFLICT');
    const current = (await library.get(alice.token, anime._id)).entry;
    const favored = await library.mutate(alice.token, request(anime._id, current.revision, { isFavorite: true }));
    assert.equal(favored.entry.notes, 'keep me', 'partial favorite update preserves notes');
    const beforeNoop = await repo.libraryState.findOne({ _id: alice.user.id });
    await library.mutate(alice.token, request(anime._id, favored.entry.revision, { isFavorite: true }));
    assert.equal((await repo.libraryState.findOne({ _id: alice.user.id })).sequence, beforeNoop.sequence);
    assert.equal((await library.mutate(alice.token, request(anime._id, favored.entry.revision, { volumeProgress: 1 }))).code, 'INVALID_FIELDS');
    assert.equal((await library.mutate(alice.token, request(anime._id, favored.entry.revision, { score: 10.1 }))).code, 'INVALID_FIELDS');
    assert.equal((await library.mutate(alice.token, request(anime._id, favored.entry.revision, { startedAt: '2026-02-30' }))).code, 'INVALID_FIELDS');
    await library.mutate(alice.token, request(manga._id, 0, { isFavorite: true, volumeProgress: 2, progress: 8 }));
    await library.mutate(alice.token, request(third._id, 0, { isFavorite: true }));
    const animeSeeds = await library.favoriteSeeds(alice.token, { type: 'ANIME' });
    const mangaSeeds = await library.favoriteSeeds(alice.token, { type: 'MANGA' });
    assert(animeSeeds.seeds.some((seed) => seed.anime_id === 1 && seed.is_favorite && seed.recommendations[0].id === 2));
    assert(animeSeeds.seeds.some((seed) => seed.malId === 20 && seed.needsAniListMapping));
    assert.equal(mangaSeeds.seeds[0].manga_id, 1);
    assert.equal(mangaSeeds.seeds[0].recommendations[0].id, 3);
    assert.equal((await library.favoriteSeeds(bob.token)).seeds.length, 0);
    const typedSnapshot = await library.snapshot(alice.token, { type: 'ANIME', limit: 1 });
    assert(typedSnapshot.nextCursor);
    assert.equal((await library.snapshot(alice.token, { cursor: typedSnapshot.nextCursor, limit: 1 })).ok, true, 'cursor retains its media-type filter');
    assert.equal((await library.snapshot(alice.token, { cursor: typedSnapshot.nextCursor, type: 'MANGA' })).code, 'FULL_SNAPSHOT_REQUIRED');

    const baseline = await library.snapshot(alice.token);
    const firstPage = await library.snapshot(alice.token, { limit: 1 });
    assert(firstPage.nextCursor);
    assert.equal((await library.snapshot(bob.token, { limit: 1, cursor: firstPage.nextCursor })).code, 'FULL_SNAPSHOT_REQUIRED');
    const aRevision = (await library.get(alice.token, anime._id)).entry.revision;
    await library.mutate(otherDevice.token, request(anime._id, aRevision, { isFavorite: false }));
    await library.mutate(otherDevice.token, request(manga._id, 1, {}, 'delete'));
    const fourth = await media.ensure('ANIME', 'anilist', 4);
    await library.mutate(otherDevice.token, request(fourth._id, 0, { isFavorite: true, status: 'dropped' }));
    const frozen = [...firstPage.entries];
    let next = firstPage.nextCursor;
    while (next) { const page = await library.snapshot(alice.token, { cursor: next, limit: 1 }); assert(page.ok); frozen.push(...page.entries); next = page.nextCursor; }
    assert.deepEqual(frozen, baseline.entries, 'writes during pagination do not change the frozen snapshot');
    const changes = []; let changeToken = firstPage.changeCursor;
    for (;;) {
      const page = await library.changes(alice.token, { cursor: changeToken, limit: 1 });
      assert(page.ok); changes.push(...page.changes); changeToken = page.nextCursor; if (!page.hasMore) break;
    }
    assert.equal(changes.length, 3);
    const typedChanges = await library.changes(alice.token, { cursor: typedSnapshot.changeCursor });
    assert.equal(typedChanges.changes.length, 2);
    assert(typedChanges.changes.every((change) => change.entry.type === 'ANIME'));
    const reconciled = new Map(frozen.map((entry) => [entry.mediaId, entry]));
    for (const change of changes) { if (change.entry.deleted) reconciled.delete(change.entry.mediaId); else reconciled.set(change.entry.mediaId, change.entry); }
    assert.deepEqual([...reconciled.values()].sort((a, b) => a.mediaId.localeCompare(b.mediaId)), (await library.snapshot(alice.token)).entries);
    assert.equal((await library.changes(bob.token, { cursor: firstPage.changeCursor })).code, 'FULL_SNAPSHOT_REQUIRED');
    assert.equal((await library.changes(alice.token, { cursor: 'invalid' })).code, 'FULL_SNAPSHOT_REQUIRED');
    const withDeleted = await library.snapshot(alice.token, { includeDeleted: true, limit: 1 });
    const allEntries = [...withDeleted.entries];
    let deletedCursor = withDeleted.nextCursor;
    assert.equal((await library.snapshot(alice.token, { includeDeleted: 'true' })).code, 'INVALID_PAGE');
    assert.equal((await library.snapshot(alice.token, { cursor: deletedCursor, includeDeleted: false })).code, 'FULL_SNAPSHOT_REQUIRED');
    while (deletedCursor) {
      const page = await library.snapshot(alice.token, { cursor: deletedCursor, limit: 1 });
      assert.equal(page.ok, true); allEntries.push(...page.entries); deletedCursor = page.nextCursor;
    }
    assert.equal(allEntries.find(entry => entry.mediaId === manga._id).deleted, true, 'fresh client can find tombstones and explicitly restore them');
    assert.equal((await library.snapshot(alice.token)).entries.some(entry => entry.deleted), false, 'default snapshots remain compatible');
    await repo.librarySnapshots.updateMany({ userId: alice.user.id }, { $set: { expiresAt: new Date(0) } });
    assert.equal((await library.snapshot(alice.token, { cursor: firstPage.nextCursor })).code, 'FULL_SNAPSHOT_REQUIRED');
    assert.equal((await library.mutate(alice.token, request(manga._id, 1, { isFavorite: true }))).code, 'REVISION_CONFLICT');
    assert.equal((await library.mutate(alice.token, request(manga._id, 2, { isFavorite: true }))).code, 'ENTRY_DELETED');
    assert.equal((await library.mutate(alice.token, request(manga._id, 2, { isFavorite: true }, 'upsert', { restore: true }))).ok, true);
    assert(!(await library.favoriteSeeds(alice.token)).seeds.some((seed) => seed.mediaId === fourth._id), 'dropped favorites excluded from recommendations');
    const duplicate = await media.ensure('ANIME', 'mal', 999);
    await assert.rejects(media.attachVerifiedMapping(duplicate._id, { kind: 'anilist-idMal', type: 'ANIME', anilistId: 1, malId: 999 }));
    assert.equal((await media.resolve(anime._id))._id, anime._id);
    console.log('PASS: two-device favorites, user isolation, idempotency, conflicts, stable pagination/deltas, tombstones/restoration, recommendation seeds.');

    await repo.accountSettings.insertOne({ _id: alice.user.id, autoSyncEnabled: true, needsDeviceReconciliation: false });
    await repo.providerAccounts.insertOne({ _id: 'synthetic-link', userId: alice.user.id, provider: 'anilist', providerUserId: '1000', username: 'Synthetic',
      accessToken: 'seenary:v1:synthetic', revision: 0, createdAt: new Date(), updatedAt: new Date() });
    const syncTitle = await media.ensure('ANIME', 'anilist', 50);
    const syncRequest = request(syncTitle._id, 0, { progress: 3 });
    const syncResult = await library.mutate(alice.token, syncRequest);
    assert.equal(syncResult.providerSync, 'pending');
    assert.equal(await repo.jobs.countDocuments({ userId: alice.user.id }), 1);
    await library.mutate(alice.token, syncRequest);
    await library.mutate(alice.token, request(syncTitle._id, 1, { isFavorite: true }));
    assert.equal(await repo.jobs.countDocuments({ userId: alice.user.id }), 1, 'favorite-only updates do not push provider favorites');
    const missingMap = await library.mutate(alice.token, request(third._id, 1, { progress: 1 }));
    assert.equal(missingMap.providerSync, 'blocked_mapping');
    const failedTitle = await media.ensure('ANIME', 'anilist', 51);
    const failedOperation = request(failedTitle._id, 0, { notes: 'atomic rollback' });
    const failing = createLibraryService({ client: connection.client, repo: { ...repo, jobs: { insertOne: async () => { throw new Error('Simulated outbox write failure'); } } }, accounts, media });
    const beforeFailure = (await repo.libraryState.findOne({ _id: alice.user.id })).sequence;
    await assert.rejects(failing.mutate(alice.token, failedOperation));
    assert.equal((await library.get(alice.token, failedTitle._id)).entry, null);
    assert.equal((await repo.libraryState.findOne({ _id: alice.user.id })).sequence, beforeFailure);
    assert.equal(await repo.libraryChanges.countDocuments({ userId: alice.user.id, mediaId: failedTitle._id }), 0);
    assert.equal(await repo.mutationReceipts.countDocuments({ _id: JSON.stringify([alice.user.id, failedOperation.operationId]) }), 0);
    console.log('PASS: atomic outbox, no duplicate jobs, cloud-only favorite toggles, missing mappings, rollback on outbox failure.');

    const legacy = await accounts.register('LibraryLegacy', 'legacy-password');
    await repo.users.updateOne({ _id: legacy.user.id }, { $set: { legacyKey: JSON.stringify(['fixture', 9]) } });
    for (const [type, id] of [['ANIME', 201], ['MANGA', 202]]) {
      const title = await media.ensure(type, 'anilist', id);
      await repo.mediaMigrationReceipts.insertOne({ _id: JSON.stringify(['fixture', type, id]), mediaId: title._id, fingerprint: 'fixture', snapshot: {}, source: 'fixture' });
    }
    const sqlite = new DatabaseSync(filename);
    sqlite.exec('CREATE TABLE user_anime_lists (id INTEGER, user_id INTEGER, anime_id INTEGER, status TEXT, is_favorite INTEGER, progress INTEGER, score REAL, notes TEXT, started_at TEXT, completed_at TEXT, repeat_count INTEGER, is_rewatching INTEGER, created_at TEXT, updated_at TEXT, local_updated_at TEXT); CREATE TABLE user_manga_lists (id INTEGER, user_id INTEGER, manga_id INTEGER, status TEXT, is_favorite INTEGER, progress INTEGER, volume_progress INTEGER, score REAL, notes TEXT, started_at TEXT, completed_at TEXT, repeat_count INTEGER, is_rereading INTEGER, created_at TEXT, updated_at TEXT, local_updated_at TEXT)');
    sqlite.prepare('INSERT INTO user_anime_lists VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(1, 9, 201, 'completed', 1, 12, 9.5, 'Preserved notes', '2026-01-01', '2026-01-02', 2, 0, '2026-01-01 00:00:00', '2026-01-02 00:00:00', null);
    sqlite.prepare('INSERT INTO user_manga_lists VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(1, 9, 202, 'watching', 1, 100, 10, 8, null, null, null, 1, 1, '2026-01-01 00:00:00', '2026-01-02 00:00:00', null);
    sqlite.close();
    const beforeSource = fs.readFileSync(filename);
    const data = readLibraryData(filename);
    const options = { client: connection.client, repo, data, source: 'fixture' };
    assert.equal((await importLibrary(options)).ready, 2);
    assert.equal(await repo.libraryEntries.countDocuments({ userId: legacy.user.id }), 0);
    assert.equal((await importLibrary({ ...options, apply: true })).imported, 2);
    assert.equal((await importLibrary({ ...options, verify: true })).verified, 2);
    assert.equal((await importLibrary({ ...options, apply: true })).unchanged, 2);
    assert.deepEqual(fs.readFileSync(filename), beforeSource);
    const seeds = await library.favoriteSeeds(legacy.token);
    assert.equal(seeds.seeds.length, 2);
    assert(seeds.seeds.some((seed) => seed.anime_id === 201 && seed.is_favorite));
    assert(seeds.seeds.some((seed) => seed.manga_id === 202 && seed.is_favorite));
    const legacyAnime = seeds.seeds.find((seed) => seed.type === 'ANIME');
    await library.mutate(legacy.token, request(legacyAnime.mediaId, 1, { isFavorite: false }));
    assert.equal((await importLibrary({ ...options, apply: true })).unchanged, 2);
    assert.equal((await library.get(legacy.token, legacyAnime.mediaId)).entry.isFavorite, false, 'snapshot rerun preserves newer favorite choice');
    assert.equal((await importLibrary({ ...options, verify: true })).conflicts.length, 1);
    assert.equal(await repo.jobs.countDocuments({ userId: legacy.user.id }), 0);
    const changed = structuredClone(data); changed[0].row.is_favorite = 0;
    assert.equal((await importLibrary({ ...options, data: changed, apply: true })).conflicts.length, 1);
    console.log('PASS: anime/manga/favorite import, preserved fields, recommendation compatibility, no external writes, repeat import preserves newer favorites.');

    server = createStagingServer(accounts, null, media, library);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/rpc`;
    const rpc = (method, args, token = alice.token) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `seenary_atlas_staging=${token}` }, body: JSON.stringify({ method, args }) });
    assert.equal((await (await rpc('getLibrarySnapshot', [{}])).json()).ok, true);
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal((await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const switched = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `seenary_atlas_staging=${bob.token}` },
      body: JSON.stringify({ method: 'mutateLibraryEntry', args: [request(anime._id, 0)], expectedUserId: alice.user.id }) });
    assert.equal(switched.status, 409);
    assert.equal((await switched.json()).code, 'ACCOUNT_CHANGED');
    assert.equal((await rpc('ensureLibraryMedia', ['MANGA', 'mal', 777], '')).status, 401);
    const clientMedia = await (await rpc('ensureLibraryMedia', ['MANGA', 'mal', 777])).json();
    assert.equal(clientMedia.media.malId, 777);
    assert.equal(clientMedia.media.anilistId, undefined);
    assert.equal((await (await rpc('getLibraryMedia', [[anime._id, clientMedia.media._id]])).json()).media.length, 2);
    assert.equal((await rpc('getLibraryMedia', [Array(51).fill(anime._id)])).status, 400);
    assert.equal((await (await rpc('getFavoriteRecommendationSeeds', [{ type: 'MANGA' }])).json()).seeds.length, 1);
    assert.equal((await (await rpc('getLibraryEntry', [anime._id], '')).json()).code, 'UNAUTHENTICATED');
    const longNotes = request(syncTitle._id, 2, { notes: 'x'.repeat(10000) });
    assert.equal((await (await rpc('mutateLibraryEntry', [longNotes])).json()).ok, true);
    const providers = createProviderService({ client: connection.client, repo: providerRepo, accounts,
      cipher: createTokenCipher(crypto.randomBytes(32).toString('base64')), adapters: {} });
    assert.equal((await providers.deleteAccount(alice.token, 'LibraryAlice', 'alice-password')).ok, true);
    for (const name of LIBRARY_COLLECTIONS.filter((name) => name !== 'libraryState')) assert.equal(await repo[name].countDocuments({ userId: alice.user.id }), 0, `deletion clears ${name}`);
    assert.equal(await repo.libraryState.countDocuments({ _id: alice.user.id }), 0);
    assert.equal((await library.get(otherDevice.token, anime._id)).code, 'UNAUTHENTICATED');
    console.log('PASS: library HTTP routes, long notes, and deletion removes all private library/history/receipt/outbox data.');
  } finally {
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); });
    try {
      const names = new Set([...LIBRARY_COLLECTIONS, 'users', 'sessions', 'providerAccounts', 'oauthFlows', 'accountSettings', 'providerMigrationReceipts', 'media', 'mediaRedirects', 'mediaMigrationReceipts']);
      for (const name of names) await connection.db.collection(prefix + name).drop().catch((error) => { if (error.code !== 26) throw error; });
    } finally { await connection.close(); }
    if (fs.existsSync(filename)) fs.unlinkSync(filename);
    fs.rmdirSync(temp);
  }
}
main().catch((error) => {
  if (error.code === 'ERR_ASSERTION') console.error(`Library assertion failed at ${String(error.stack).split('\n')[1]?.trim()}`);
  else {
    reportError(error);
    // Class/code only: driver messages can contain credentials or source values.
    const name = /^[A-Za-z]+$/.test(error.name || '') ? error.name : 'Error';
    const code = /^[A-Z0-9_]+$/.test(String(error.code ?? '')) ? String(error.code) : 'unknown';
    console.error(`Diagnostic: ${name}, code ${code}`);
  }
  process.exitCode = 1;
});
