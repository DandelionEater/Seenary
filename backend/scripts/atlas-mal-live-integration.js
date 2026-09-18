require('../env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { calculateObjectSize } = require('bson');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupMedia, createMediaService } = require('../atlas/media');
const { setupMetadata, createMetadataService } = require('../atlas/metadata');
const { createMalMetadataCache } = require('../atlas/malMetadataCache');
const { createMalMappingResolver } = require('../atlas/malMapping');
const { createAniListMetadataProvider } = require('../atlas/anilistMetadataProvider');
const { getPublicMediaDetails } = require('../mal');
const { getMediaByMalIds } = require('../anilist');

async function main() {
  const connection = await connectStaging();
  const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  try {
    const repo = await setupMedia(connection.db, prefix);
    const queries = await setupMetadata(connection.db, prefix);
    const media = createMediaService(connection.client, repo);
    const realAl = createAniListMetadataProvider();
    let clock = Date.now(), alOffline = false, malOffline = false;
    const alProvider = { details: async (...args) => {
      if (alOffline) throw new Error('Simulated AniList outage');
      return realAl.details(...args);
    } };
    const malProvider = { details: async (...args) => {
      if (malOffline) throw new Error('Simulated MAL outage');
      return getPublicMediaDetails(...args);
    } };
    const create = () => {
      const malCache = createMalMetadataCache({ media, repo, queries, provider: malProvider, now: () => clock, requestSpacingMs: 0 });
      const malMapping = createMalMappingResolver({ media, queries, now: () => clock, requestSpacingMs: 0,
        provider: { lookup: (type, id) => getMediaByMalIds([id], type) } });
      return createMetadataService({ media, repo, queries, provider: alProvider, malCache, malMapping, now: () => clock, requestSpacingMs: 0 });
    };
    let service = create();
    const animeFromMal = await service.details('ANIME', -1);
    const mangaFromMal = await service.details('MANGA', -1);
    assert(animeFromMal.seenaryId); assert(mangaFromMal.seenaryId);
    assert.notEqual(animeFromMal.seenaryId, mangaFromMal.seenaryId);
    const animeDocument = await media.resolve(animeFromMal.seenaryId);
    const mangaDocument = await media.resolve(mangaFromMal.seenaryId);
    assert.equal(animeDocument.malId, 1); assert.equal(mangaDocument.malId, 1);
    assert(animeDocument.anilistId > 0); assert(mangaDocument.anilistId > 0);
    assert(animeDocument.sources.mal.groups.details.fetchedAt instanceof Date);
    assert(mangaDocument.sources.mal.groups.details.fetchedAt instanceof Date);
    assert(animeDocument.sources.mal.metrics.mean >= 0 && animeDocument.sources.mal.metrics.mean <= 10);
    assert(calculateObjectSize(animeDocument) < 256 * 1024); assert(calculateObjectSize(mangaDocument) < 256 * 1024);

    const animeAl = await service.details('ANIME', animeDocument.anilistId);
    const mangaAl = await service.details('MANGA', mangaDocument.anilistId);
    assert.equal(animeAl.seenaryId, animeFromMal.seenaryId);
    assert.equal(mangaAl.seenaryId, mangaFromMal.seenaryId);
    assert.equal(animeAl.cache.provider, 'anilist'); assert.equal(mangaAl.cache.provider, 'anilist');
    const beforeOutage = await media.resolve(animeFromMal.seenaryId);
    const alClock = beforeOutage.sources.anilist.groups.details.fetchedAt;
    const malClock = beforeOutage.sources.mal.groups.details.fetchedAt;

    clock += 8 * 24 * 3600000; alOffline = true;
    service = create();
    const fallback = await service.details('ANIME', beforeOutage.anilistId);
    assert.equal(fallback.seenaryId, animeFromMal.seenaryId);
    assert.equal(fallback.cache.provider, 'mal'); assert.equal(fallback.cache.stale, false);
    const afterFallback = await media.resolve(animeFromMal.seenaryId);
    assert.deepEqual(afterFallback.sources.anilist.groups.details.fetchedAt, alClock, 'MAL cannot renew AL clock');
    assert(afterFallback.sources.mal.groups.details.fetchedAt > malClock);
    assert(afterFallback.sources.anilist.metrics.average_score !== undefined);
    assert(afterFallback.sources.mal.metrics.mean !== undefined);

    clock += 6 * 60000; alOffline = false;
    service = create();
    const recovered = await service.details('ANIME', beforeOutage.anilistId);
    assert.equal(recovered.seenaryId, animeFromMal.seenaryId);
    assert.equal(recovered.cache.provider, 'anilist'); assert.equal(recovered.cache.stale, false);
    const afterRecovery = await media.resolve(animeFromMal.seenaryId);
    assert(afterRecovery.sources.anilist.groups.details.fetchedAt > alClock);
    assert.deepEqual(afterRecovery.sources.mal.groups.details.fetchedAt, afterFallback.sources.mal.groups.details.fetchedAt, 'AL cannot renew MAL clock');

    clock += 8 * 24 * 3600000; alOffline = true; malOffline = true;
    service = create();
    const bothDown = await service.details('ANIME', beforeOutage.anilistId);
    assert.equal(bothDown.seenaryId, animeFromMal.seenaryId); assert.equal(bothDown.cache.stale, true);
    assert(!JSON.stringify(await repo.media.find({}).toArray()).match(/access_token|refresh_token|my_list_status/i));
    const queryRows = await queries.find({}).toArray();
    const malReferences = queryRows.filter(row => typeof row.payload?.mediaId === 'string');
    assert(malReferences.length >= 2, 'MAL detail cache records canonical references');
    assert(!JSON.stringify(malReferences).match(/synopsis|description|title|my_list_status/i), 'MAL detail cache stores references, not raw payloads');
    console.log(`PASS: live MAL→Atlas→AniList mapping, AL-first reads, MAL fallback, AL recovery and dual outage on stable anime/manga IDs (${await repo.media.countDocuments({})} media, ${queryRows.length} cache records).`);
  } finally {
    try {
      for (const name of ['media', 'mediaRedirects', 'mediaMigrationReceipts', 'metadataQueries']) {
        await connection.db.collection(prefix + name).drop().catch(error => { if (error.code !== 26) throw error; });
      }
    } finally { await connection.close(); }
  }
}
main().catch(error => {
  if (error.code === 'ERR_ASSERTION') console.error(`Live MAL integration assertion failed: ${error.message}`);
  else reportError(error);
  process.exitCode = 1;
});
