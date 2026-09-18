require('../env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupMedia, createMediaService } = require('../atlas/media');
const { setupMetadata, createMetadataService } = require('../atlas/metadata');
const { createAniListMetadataProvider } = require('../atlas/anilistMetadataProvider');

async function main() {
  if (process.argv.includes('--provider-only')) {
    const provider = createAniListMetadataProvider();
    for (const [type, id] of [['ANIME', 1], ['MANGA', 30002]]) {
      const payload = await provider.details(type, id);
      assert.equal(payload.id, id);
      assert(payload.title?.romaji);
      for (const key of ['description', 'genres', 'staff', 'characters', 'relations', 'recommendations']) assert(Object.hasOwn(payload, key), `Missing provider field ${key}`);
    }
    console.log('PASS: real AniList anime/manga payloads match the metadata completeness contract. No database writes.');
    return;
  }
  const connection = await connectStaging();
  const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  const live = process.argv.includes('--live-provider');
  try {
    const repo = await setupMedia(connection.db, prefix);
    const queries = await setupMetadata(connection.db, prefix);
    const media = createMediaService(connection.client, repo);
    const actual = createAniListMetadataProvider();
    let clock = Date.now(), offline = false, calls = 0;
    const fixture = (type, id) => ({ id, type, title: { romaji: 'Integration title' }, coverImage: { large: 'image' }, status: 'FINISHED', isAdult: false,
      description: 'Public description', genres: ['Drama'], averageScore: 80, staff: { edges: [] }, characters: { edges: [] }, relations: { edges: [] }, recommendations: { nodes: [] } });
    const provider = { details: async (type, id) => { calls++; if (offline) throw new Error('Simulated provider outage'); return live ? actual.details(type, id) : fixture(type, id); } };
    const create = () => createMetadataService({ media, repo, queries, provider, now: () => clock, requestSpacingMs: 0 });
    let cache = create();
    const anime = await cache.details('ANIME', 1);
    assert(anime.title.romaji); assert.equal(anime.cache.stale, false);
    const mongoDocument = await repo.media.findOne({ _id: anime.seenaryId });
    assert(mongoDocument.sources.anilist.groups.details.fetchedAt instanceof Date);
    assert.equal((await cache.details('ANIME', 1)).seenaryId, anime.seenaryId);
    assert.equal(calls, 1, 'fresh Atlas cache avoids another provider call');
    cache = create();
    await cache.details('ANIME', 1); assert.equal(calls, 1, 'cache survives service restart');
    const manga = await cache.details('MANGA', live ? 30002 : 1);
    assert.notEqual(manga.seenaryId, anime.seenaryId);
    assert.equal((await repo.media.countDocuments({})), 2);
    if (!live) {
      const update = queries.updateOne.bind(queries);
      let loseAcknowledgement = true;
      queries.updateOne = async (filter, change) => {
        const result = await update(filter, change);
        if (loseAcknowledgement && change.$set?.payload) { loseAcknowledgement = false; throw new Error('Simulated lost acknowledgement after commit'); }
        return result;
      };
      const recovered = await cache.details('ANIME', 10);
      assert(recovered.title.romaji);
      queries.updateOne = update;
      const beforeRetry = calls;
      assert.equal((await create().details('ANIME', 10)).seenaryId, recovered.seenaryId);
      assert.equal(calls, beforeRetry, 'lost cache acknowledgement cannot discard the committed media');
    }
    // Actual Mongo CAS under simultaneous writers, with ordered observation times.
    await Promise.all([
      cache.ingest({ id: 1, title: { english: 'Older observation' } }, 'ANIME', 'card', clock + 100),
      cache.ingest({ id: 1, title: { english: 'Newer observation' } }, 'ANIME', 'card', clock + 200),
    ]);
    assert.equal((await repo.media.findOne({ _id: anime.seenaryId })).metadata.title_english, 'Newer observation');
    clock += 8 * 24 * 3600000;
    const originalDetails = provider.details;
    let releaseRefresh, markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    provider.details = async (...args) => {
      markStarted();
      await new Promise(resolve => { releaseRefresh = resolve; });
      return originalDetails(...args);
    };
    const refreshing = create().details('ANIME', 1);
    await started;
    try {
      const competing = await create().details('ANIME', 1);
      assert.equal(competing.seenaryId, anime.seenaryId);
      assert.equal(competing.cache.stale, true, 'another service serves stale data during the persisted refresh lease');
    } finally { releaseRefresh(); await refreshing; provider.details = originalDetails; }
    clock += 8 * 24 * 3600000; offline = true;
    const fallback = await cache.details('ANIME', 1);
    assert.equal(fallback.cache.stale, true); assert.equal(fallback.seenaryId, anime.seenaryId);
    const failedCalls = calls;
    cache = create(); await cache.details('ANIME', 1);
    assert.equal(calls, failedCalls, 'Atlas retry state survives restart');
    const queryCount = await queries.countDocuments({});
    assert.equal(queryCount, live ? 2 : 3);
    console.log(`PASS: real Atlas persistence, BSON dates, cache reuse/restart, canonical IDs, concurrent CAS, provider outage and persistent backoff (${live ? 'real AniList anime/manga payloads' : 'synthetic provider'}).`);
  } finally {
    try {
      for (const name of ['media', 'mediaRedirects', 'mediaMigrationReceipts', 'metadataQueries']) {
        await connection.db.collection(prefix + name).drop().catch(error => { if (error.code !== 26) throw error; });
      }
    } finally { await connection.close(); }
  }
}
main().catch(error => {
  if (process.argv.includes('--provider-only')) {
    console.error(`Public AniList probe failed (status ${Number(error.status) || 'unknown'}): ${String(error.message).slice(0, 240)}`);
    process.exitCode = 1; return;
  }
  if (error.code === 'ERR_ASSERTION') console.error(`Metadata assertion failed: ${error.message}`);
  else { reportError(error); console.error(`Diagnostic class: ${/^[A-Za-z]+$/.test(error.name || '') ? error.name : 'Error'}`); }
  process.exitCode = 1;
});
