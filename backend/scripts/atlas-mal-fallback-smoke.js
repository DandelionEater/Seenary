require('../env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createMediaService, setupMedia } = require('../atlas/media');
const { createMetadataService, setupMetadata } = require('../atlas/metadata');
const { createMalMetadataCache } = require('../atlas/malMetadataCache');
const { createMalMetadataService } = require('../atlas/malMetadata');
const { Collection } = require('./atlas-metadata-smoke');
const { connectStaging, reportError } = require('../atlas/connection');
const { createStagingServer } = require('../atlas/stagingServer');

async function verify(repo, queries, client) {
  let clock = 1700000000000, alOffline = false, malOffline = false, alCalls = 0, malCalls = 0;
  const media = createMediaService(client, repo);
  const alRaw = { id: 101, type: 'ANIME', title: { romaji: 'AL title' }, description: 'AL description', status: 'RELEASING',
    episodes: 12, averageScore: 91, genres: ['Drama'], staff: { edges: [] }, characters: { edges: [] }, relations: { edges: [] }, recommendations: { nodes: [] } };
  const malRaw = (type, id) => ({ id, title: 'MAL title', synopsis: 'MAL description', status: type === 'ANIME' ? 'currently_airing' : 'currently_publishing',
    genres: [{ id: 1, name: 'Action' }], num_episodes: 24, num_chapters: 40, num_volumes: 4, mean: 8.2,
    my_list_status: { comments: 'PRIVATE_TOKEN_NOTES' } });
  const alProvider = { details: async () => { alCalls++; if (alOffline) throw new Error('AL offline'); return structuredClone(alRaw); } };
  const malProvider = { details: async (type, id) => { malCalls++; if (malOffline) throw Object.assign(new Error('MAL offline'), { retryAfter: 900 }); return malRaw(type, id); } };
  const createMal = () => createMalMetadataCache({ media, repo, queries, provider: malProvider, now: () => clock, requestSpacingMs: 0 });
  const create = () => createMetadataService({ media, repo, queries, provider: alProvider, malCache: createMal(), now: () => clock, requestSpacingMs: 0 });
  let service = create();
  const first = await service.details('ANIME', 101);
  await repo.media.updateOne({ _id: first.seenaryId }, { $set: { malId: 1 } });
  const alClock = (await media.resolve(first.seenaryId)).sources.anilist.groups.details;
  assert.equal(malCalls, 0, 'fresh AL never calls MAL');
  clock += 7 * 3600000; alOffline = true;
  const fallback = await service.details('ANIME', 101);
  assert.equal(fallback.seenaryId, first.seenaryId);
  assert.equal(fallback.cache.provider, 'mal'); assert.equal(fallback.cache.stale, false);
  assert.equal(fallback.description, 'MAL description'); assert.equal(fallback.episodes, 24);
  assert.equal(fallback.averageScore, 91); assert.equal(fallback.providerMetrics.mal.mean, 8.2);
  assert.deepEqual((await media.resolve(first.seenaryId)).sources.anilist.groups.details, alClock);
  const malClock = (await media.resolve(first.seenaryId)).sources.mal.groups.details;
  service = create(); await service.details('ANIME', 101);
  assert.equal(malCalls, 1, 'fresh MAL survives service recreation'); assert.equal(alCalls, 2, 'AL backoff persists');
  clock += 6 * 60000; alOffline = false; alRaw.description = 'Recovered AL';
  const recovered = await service.details('ANIME', 101);
  assert.equal(recovered.description, 'Recovered AL'); assert.equal(recovered.episodes, 12);
  assert.equal(recovered.seenaryId, first.seenaryId); assert.equal(recovered.cache.provider, 'anilist');
  assert.deepEqual((await media.resolve(first.seenaryId)).sources.mal.groups.details, malClock);
  clock += 8 * 24 * 3600000; alOffline = true; malOffline = true;
  const stale = await service.details('ANIME', 101);
  assert.equal(stale.cache.stale, true); assert.equal(stale.description, 'Recovered AL', 'old MAL cannot undo newer AL');
  const calls = malCalls;
  await create().details('ANIME', 101); assert.equal(malCalls, calls, 'MAL outage backoff persists');
  malOffline = false;
  const animeOnly = await service.details('ANIME', -2);
  const mangaOnly = await service.details('MANGA', -2);
  assert.notEqual(animeOnly.seenaryId, mangaOnly.seenaryId);
  assert.equal(animeOnly.id, -2); assert.equal(mangaOnly.chapters, 40);
  assert.equal((await media.resolve(animeOnly.seenaryId)).anilistId, undefined);
  await assert.rejects(createMalMetadataCache({ media, repo, queries, now: () => clock, requestSpacingMs: 0,
    provider: { details: async () => ({ id: 999, title: 'Wrong' }) } }).details('ANIME', 3));
  assert.equal(await media.byProvider('ANIME', 'mal', 999), null);
  const partial = await createMalMetadataCache({ media, repo, queries, now: () => clock, requestSpacingMs: 0,
    provider: { details: async () => ({ id: 4, title: 'Partial' }) } }).details('ANIME', 4);
  assert.equal(partial.cache.stale, true);
  assert.equal((await media.byProvider('ANIME', 'mal', 4)).sources.mal.groups.details, undefined);
  // Two service instances share the persisted lease while a provider request is in flight.
  let started, release;
  const began = new Promise(resolve => { started = resolve; });
  const gated = { details: async (type, id) => { started(); await new Promise(resolve => { release = resolve; }); return malRaw(type, id); } };
  const held = createMalMetadataCache({ media, repo, queries, provider: gated, now: () => clock, requestSpacingMs: 0 });
  const refresh = held.details('ANIME', 1);
  // Prior failure retry must expire before claiming the lease.
  // Advance and retry if the cached call was deferred instead of reaching the provider.
  const initial = await refresh;
  assert.equal(initial.cache.stale, true);
  clock += 16 * 60000;
  const running = held.details('ANIME', 1); await began;
  try {
    assert.equal((await createMal().details('ANIME', 1)).cache.stale, true);
    alOffline = false; clock += 1;
    await service.ingest({ ...alRaw, description: 'AL won race' }, 'ANIME', 'details', clock);
  } finally { release(); }
  const raced = await running;
  assert.equal(raced.description, 'AL won race'); assert.equal(raced.cache.provider, 'anilist');
  clock += 8 * 24 * 3600000;
  const malStorage = createMalMetadataService({ media, repo, now: () => clock });
  await malStorage.ingest({ id: 1, title: 'Fresh card only' }, 'ANIME', 'card');
  const promoted = await malStorage.promoteFallback(first.seenaryId);
  assert.equal(promoted.metadata.description, 'AL won race', 'fresh MAL card cannot promote its old synopsis over newer AL');
  assert(!JSON.stringify(await queries.find({}).toArray()).includes('PRIVATE_TOKEN_NOTES'));
  assert(!JSON.stringify(await repo.media.find({}).toArray()).includes('PRIVATE_TOKEN_NOTES'));
  const server = createStagingServer({ getSession: async token => ({ authenticated: token === 'test', user: { id: 'test-user' } }) }, null, media, null, service);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const request = token => fetch(`http://127.0.0.1:${server.address().port}/rpc`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `seenary_atlas_staging=${token}` },
      body: JSON.stringify({ method: 'getMediaDetails', args: ['MANGA', -2] }) });
    assert.equal((await request('invalid')).status, 401);
    const response = await request('test'); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.id, -2); assert.equal(result.chapters, 40);
  } finally { await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); }
  console.log('PASS: AL-first MAL fallback, recovery, stable IDs, separate metrics/clocks, stale reads, persisted retries/leases, MAL-only anime/manga, partial/wrong IDs, and late-response race.');
}
async function main() {
  if (process.argv.includes('--provider-only')) {
    const { getPublicMediaDetails } = require('../mal');
    for (const type of ['ANIME', 'MANGA']) {
      const raw = await getPublicMediaDetails(type, 1);
      assert.equal(raw.id, 1); assert.equal(typeof raw.title, 'string');
      for (const key of ['synopsis', 'genres', 'status', type === 'ANIME' ? 'num_episodes' : 'num_chapters']) assert(Object.hasOwn(raw, key));
    }
    console.log('PASS: public MAL anime/manga detail contract. No database writes.'); return;
  }
  if (!process.argv.includes('--atlas')) return verify({ media: new Collection(), mediaRedirects: new Collection() }, new Collection(), {});
  const connection = await connectStaging();
  const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  try { await verify(await setupMedia(connection.db, prefix), await setupMetadata(connection.db, prefix), connection.client); }
  finally {
    try { for (const name of ['media', 'mediaRedirects', 'mediaMigrationReceipts', 'metadataQueries']) await connection.db.collection(prefix + name).drop().catch(error => { if (error.code !== 26) throw error; }); }
    finally { await connection.close(); }
  }
}
main().catch(error => { if (error.code === 'ERR_ASSERTION') console.error(`Fallback assertion failed: ${error.message}`); else reportError(error); process.exitCode = 1; });
