require('../env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupMedia, createMediaService } = require('../atlas/media');
const { setupMetadata, createMetadataService } = require('../atlas/metadata');
const { createMalMappingResolver } = require('../atlas/malMapping');
const { createMalImportService } = require('../atlas/malImport');
const { createStagingServer } = require('../atlas/stagingServer');
const { Collection } = require('./atlas-metadata-smoke');

async function imports(repo, media) {
  const personal = { status: 'completed', score: 0, comments: 'PRIVATE_IMPORT', num_episodes_watched: 12, num_chapters_read: 30,
    num_volumes_read: 2, num_times_rewatched: 1, num_times_reread: 2, is_rewatching: false, is_rereading: true,
    start_date: '2020-01', finish_date: '2020-02-29' };
  const row = { node: { id: 1, title: 'Public title', mean: 8, my_list_status: personal }, list_status: personal };
  const provider = { collection: async () => ({ data: [row, row] }) };
  const service = createMalImportService({ media, repo, provider });
  const preview = await service.preview('ExampleUser');
  assert.equal(preview.preview.totalFound, 2);
  const anime = preview.preview.groups.find(group => group.mediaType === 'ANIME').items[0];
  const manga = preview.preview.groups.find(group => group.mediaType === 'MANGA').items[0];
  assert.equal(anime.score, 0); assert.equal(anime.notes, 'PRIVATE_IMPORT'); assert.equal(anime.startedAt, undefined);
  assert.equal(anime.completedAt, '2020-02-29'); assert.equal(anime.isFavorite, undefined);
  assert.equal(manga.volumeProgress, 2); assert.equal(manga.repeatCount, 2);
  assert(!JSON.stringify(await repo.media.find({}).toArray()).includes('PRIVATE_IMPORT'));
  assert(anime.animeId !== 0 && manga.animeId !== 0);
  await assert.rejects(service.preview('@me'));
  await assert.rejects(createMalImportService({ media, repo, provider: { collection: async () => ({ data: [row], truncated: true }) } }).preview('ExampleUser'));
  const server = createStagingServer({ getSession: async token => ({ authenticated: token === 'test', user: { id: 'owner' } }) }, null, media, null,
    { previewMalImport: name => service.preview(name) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const request = token => fetch(`http://127.0.0.1:${server.address().port}/rpc`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `seenary_atlas_staging=${token}` }, body: JSON.stringify({ method: 'previewMalImport', args: ['ExampleUser'] }) });
    assert.equal((await request('bad')).status, 401);
    const response = await request('test'); assert.equal(response.status, 200); assert.equal((await response.json()).preview.totalFound, 2);
  } finally { await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); }
  console.log('PASS: MAL import anime/manga, unmatched identities, deduplication, personal-field privacy, zero values, complete dates, no favorites, truncation rejection and authenticated HTTP.');
}
async function main() {
  if (process.argv.includes('--provider-only')) {
    const { getMediaByMalIds } = require('../anilist');
    for (const type of ['ANIME', 'MANGA']) {
      const rows = await getMediaByMalIds([1], type);
      assert.equal(rows.length, 1); assert.equal(rows[0].idMal, 1); assert.equal(rows[0].type, type); assert(rows[0].id > 0);
    }
    console.log('PASS: real AniList exact MAL-ID lookup for anime and manga. No database writes.'); return;
  }
  if (!process.argv.includes('--atlas')) {
    const repo = { media: new Collection(), mediaRedirects: new Collection() };
    return imports(repo, createMediaService({}, repo));
  }
  const connection = await connectStaging();
  const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  try {
    const repo = await setupMedia(connection.db, prefix), queries = await setupMetadata(connection.db, prefix);
    const media = createMediaService(connection.client, repo);
    let calls = 0;
    const resolver = createMalMappingResolver({ media, queries, requestSpacingMs: 0, provider: { lookup: async (type, id) => {
      calls++; return id === 5 ? [] : [{ id: id * 100, idMal: id, type }];
    } } });
    const original = await media.ensure('ANIME', 'mal', 1), duplicate = await media.ensure('ANIME', 'anilist', 100);
    await repo.libraryEntries.insertOne({ _id: 'personal', mediaId: original._id, progress: 7, isFavorite: true, notes: 'DO_NOT_CHANGE' });
    const resolved = await resolver.resolve('ANIME', 1);
    assert.equal(resolved.status, 'mapped'); assert.equal(resolved.mediaId, original._id);
    assert.equal((await media.resolve(duplicate._id))._id, original._id);
    assert.deepEqual(await repo.libraryEntries.findOne({ _id: 'personal' }), { _id: 'personal', mediaId: original._id, progress: 7, isFavorite: true, notes: 'DO_NOT_CHANGE' });
    await resolver.resolve('ANIME', 1); assert.equal(calls, 1);
    const held = await media.ensure('ANIME', 'mal', 2), libraryDuplicate = await media.ensure('ANIME', 'anilist', 200);
    await repo.libraryEntries.insertOne({ _id: 'other', mediaId: libraryDuplicate._id, notes: 'OTHER' });
    assert.equal((await resolver.resolve('ANIME', 2)).status, 'review-required');
    assert.equal((await media.resolve(held._id)).anilistId, undefined); assert.equal((await media.resolve(libraryDuplicate._id))._id, libraryDuplicate._id);
    await media.ensure('ANIME', 'mal', 3);
    const conflict = await media.ensure('ANIME', 'anilist', 300);
    await repo.media.updateOne({ _id: conflict._id }, { $set: { malId: 99 } });
    assert.equal((await resolver.resolve('ANIME', 3)).status, 'review-required');
    await media.ensure('ANIME', 'mal', 5);
    assert.equal((await resolver.resolve('ANIME', 5)).status, 'unmatched'); const misses = calls;
    assert.equal((await resolver.resolve('ANIME', 5)).status, 'unmatched'); assert.equal(calls, misses);
    await media.ensure('ANIME', 'mal', 6);
    let badCalls = 0;
    const invalid = createMalMappingResolver({ media, queries, requestSpacingMs: 0, provider: { lookup: async () => { badCalls++; return [{ id: 600, idMal: 999, type: 'ANIME' }]; } } });
    assert.equal((await invalid.resolve('ANIME', 6)).status, 'deferred');
    await invalid.resolve('ANIME', 6); assert.equal(badCalls, 1);
    assert.equal((await media.byProvider('ANIME', 'mal', 6)).anilistId, undefined);
    const manga = await media.ensure('MANGA', 'mal', 1);
    assert.equal((await resolver.resolve('MANGA', 1)).mediaId, manga._id); assert.notEqual(manga._id, original._id);
    const onDemand = await media.ensure('ANIME', 'mal', 7);
    const metadata = createMetadataService({ media, repo, queries, requestSpacingMs: 0, malMapping: resolver,
      malCache: { details: async () => ({ id: -7 }) }, provider: { details: async () => ({ id: 700, type: 'ANIME', title: { romaji: 'Resolved' },
        description: '', genres: [], status: 'FINISHED', staff: {}, characters: {}, relations: {}, recommendations: {} }) } });
    assert.equal((await metadata.details('ANIME', -7)).seenaryId, onDemand._id);
    await imports(repo, media);
    assert(!JSON.stringify(await queries.find({}).toArray()).includes('PRIVATE_IMPORT'));
    console.log('PASS: Atlas verified mappings, original MAL identity, duplicate redirects, personal-reference preservation, explicit conflicts, cached misses, bad-evidence backoff, type separation and on-demand AL details.');
  } finally {
    try { for (const name of ['media', 'mediaRedirects', 'mediaMigrationReceipts', 'metadataQueries', 'libraryEntries']) await connection.db.collection(prefix + name).drop().catch(error => { if (error.code !== 26) throw error; }); }
    finally { await connection.close(); }
  }
}
main().catch(error => { if (error.code === 'ERR_ASSERTION') console.error(`MAL mapping assertion: ${error.message}`); else reportError(error); process.exitCode = 1; });
