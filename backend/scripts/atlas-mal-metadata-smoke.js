require('../env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createMediaService, setupMedia } = require('../atlas/media');
const { createMalMetadataService } = require('../atlas/malMetadata');
const { Collection } = require('./atlas-metadata-smoke');
const { connectStaging, reportError } = require('../atlas/connection');

async function verify(repo, client) {
  let clock = 1700000000000;
  const media = createMediaService(client, repo);
  const create = () => createMalMetadataService({ media, repo, now: () => clock });
  let service = create();
  const raw = { id: 1, title: 'MAL title', synopsis: 'Description', status: 'currently_airing', nsfw: 'white',
    num_episodes: 0, main_picture: { large: 'cover', secret: 'PRIVATE' },
    genres: [{ id: 1, name: 'Action', notes: 'PRIVATE' }], mean: 8.5, rank: 0,
    my_list_status: { score: 2, comments: 'PRIVATE' }, access_token: 'PRIVATE' };
  const first = await service.ingest(raw, 'ANIME', 'details');
  assert.equal(first.sources.mal.metrics.mean, 8.5);
  assert.equal(first.sources.mal.metrics.rank, 0);
  assert.equal(first.metadata.episodes, 0);
  assert.equal(first.metadata.is_adult, false);
  assert.equal(first.sources.mal.groups.details.freshUntil.getTime(), clock + 6 * 3600000);
  assert(!JSON.stringify(first).includes('PRIVATE'));
  const al = { details: { title: { romaji: 'AL title' } }, metrics: { average_score: 91 },
    groups: { details: { fetchedAt: new Date(clock), freshUntil: new Date(clock + 123) } } };
  await repo.media.updateOne({ _id: first._id }, { $set: { anilistId: 101, 'sources.anilist': al, 'metadata.title_romaji': 'AL title' } });
  clock += 1000;
  const updated = await service.ingest({ ...raw, title: 'New MAL title', mean: 9, synopsis: null, genres: [], num_episodes: undefined }, 'ANIME', 'details');
  assert.equal(updated._id, first._id);
  assert.equal(updated.metadata.title_romaji, 'AL title');
  assert.deepEqual(updated.sources.anilist, al);
  assert.equal(updated.sources.mal.details.synopsis, 'Description');
  assert.equal(updated.sources.mal.details.genres.length, 1);
  assert.equal(updated.sources.mal.groups.details.fetchedAt.getTime(), clock - 1000, 'partial response cannot renew completeness');
  assert.equal(updated.sources.mal.metrics.mean, 9);
  service = create();
  assert.equal((await service.ingest({ id: 1, title: 'Card', mean: 0 }, 'ANIME'))._id, first._id);
  const afterCard = await media.resolve(first._id);
  assert.equal(afterCard.sources.mal.groups.details.fetchedAt.getTime(), clock - 1000, 'cards never renew details');
  assert.equal(afterCard.sources.mal.metrics.mean, 0);
  await service.ingest({ ...raw, title: 'Old', mean: 1 }, 'ANIME', 'details', clock - 500);
  assert.equal((await media.resolve(first._id)).sources.mal.details.title, 'Card');
  await Promise.all([
    service.ingest({ id: 1, title: 'Older writer', mean: 2 }, 'ANIME', 'card', clock + 100),
    service.ingest({ id: 1, title: 'Newest writer', mean: 7 }, 'ANIME', 'card', clock + 200),
  ]);
  const final = await media.resolve(first._id);
  assert.equal(final.sources.mal.details.title, 'Newest writer');
  assert.equal(final.sources.mal.metrics.mean, 7);
  assert.deepEqual(final.sources.anilist, al);
  const manga = await service.ingest({ id: 1, title: 'Manga', synopsis: '', genres: [], status: 'finished', num_chapters: 0, num_volumes: 0 }, 'MANGA', 'details');
  assert.notEqual(manga._id, first._id);
  assert.equal(manga.sources.mal.groups.details.freshUntil.getTime(), clock + 7 * 24 * 3600000);
  assert.equal(manga.anilistId, undefined);
  const unknown = await service.ingest({ id: 2, title: 'Unknown' }, 'ANIME');
  assert.equal(unknown.sources.mal.groups.card.freshUntil.getTime(), clock + 24 * 3600000);
  await assert.rejects(service.ingest({ id: -1, title: 'Bad' }, 'ANIME'));
  await assert.rejects(service.ingest(raw, 'OTHER'));
  await assert.rejects(service.ingest(raw, 'ANIME', 'other'));
  await assert.rejects(service.ingest(raw, 'ANIME', 'card', NaN));
  await assert.rejects(service.ingest({ id: 99, title: 'Huge', synopsis: 'x'.repeat(12 * 1024 * 1024) }, 'ANIME', 'details'));
  assert.equal(await media.byProvider('ANIME', 'mal', 99), null, 'reject oversized data before creating identity');
  assert.equal((await repo.media.find({}).toArray()).length, 3);
  console.log('PASS: MAL anime/manga identity, restart reuse, source isolation, partial merges, freshness, zero values, privacy, concurrent updates and size guards.');
}
async function main() {
  if (!process.argv.includes('--atlas')) return verify({ media: new Collection(), mediaRedirects: new Collection() }, {});
  const connection = await connectStaging();
  const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  try { await verify(await setupMedia(connection.db, prefix), connection.client); }
  finally {
    try {
      for (const name of ['media', 'mediaRedirects', 'mediaMigrationReceipts']) {
        await connection.db.collection(prefix + name).drop().catch(error => { if (error.code !== 26) throw error; });
      }
    } finally { await connection.close(); }
  }
}
main().catch(error => {
  if (error.code === 'ERR_ASSERTION') console.error(`MAL test assertion failed: ${error.message}`);
  else reportError(error);
  process.exitCode = 1;
});
