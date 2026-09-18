require('../env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupMedia, createMediaService } = require('../atlas/media');
const { readMediaData, importMedia } = require('../atlas/importMedia');
const { createStagingServer } = require('../atlas/stagingServer');

async function main() {
  const connection = await connectStaging();
  const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'seenary-media-'));
  const filename = path.join(temp, 'source.sqlite');
  let server;
  try {
    const repo = await setupMedia(connection.db, prefix);
    await setupMedia(connection.db, prefix);
    const media = createMediaService(connection.client, repo);
    const [a, duplicate] = await Promise.all([media.ensure('ANIME', 'anilist', 1), media.ensure('ANIME', 'anilist', 1)]);
    assert.equal(a._id, duplicate._id);
    const manga = await media.ensure('MANGA', 'anilist', 1);
    assert.notEqual(a._id, manga._id);
    const mal = await media.ensure('ANIME', 'mal', 10);
    await repo.media.updateOne({ _id: mal._id }, { $set: { metadata: { title: 'MAL name', extra: 'retained' }, sources: { mal: { fetched: true } } } });
    await repo.media.updateOne({ _id: a._id }, { $set: { metadata: { title: 'AL name', episodes: 12 } } });
    const externalReference = { mediaId: a._id, progress: 7, notes: 'preserve' };
    await repo.mediaMigrationReceipts.insertOne({ _id: 'old-reference', mediaId: a._id, fingerprint: 'test', snapshot: {} });
    const merged = await media.attachVerifiedMapping(mal._id, { kind: 'anilist-idMal', type: 'ANIME', anilistId: 1, malId: 10 });
    assert.equal(merged._id, mal._id, 'original MAL record keeps its Seenary identity');
    assert.equal(merged.metadata.title, 'AL name');
    assert.equal(merged.metadata.extra, 'retained');
    assert.equal((await media.resolve(externalReference.mediaId))._id, mal._id);
    assert.equal(externalReference.progress, 7);
    assert.equal((await repo.mediaMigrationReceipts.findOne({ _id: 'old-reference' })).mediaId, mal._id);
    assert.equal((await repo.mediaRedirects.findOne({ _id: a._id })).snapshot.metadata.title, 'AL name');
    assert.equal((await media.byProvider('ANIME', 'anilist', 1))._id, mal._id);
    assert.equal((await media.byProvider('ANIME', 'mal', 10))._id, mal._id);
    const again = await media.attachVerifiedMapping(mal._id, { kind: 'anilist-idMal', type: 'ANIME', anilistId: 1, malId: 10 });
    assert.equal(again._id, mal._id);
    await assert.rejects(media.attachVerifiedMapping(mal._id, { kind: 'title-match', type: 'ANIME', anilistId: 1, malId: 10 }));
    await assert.rejects(media.attachVerifiedMapping(mal._id, { kind: 'anilist-idMal', type: 'MANGA', anilistId: 1, malId: 10 }));
    await assert.rejects(media.attachVerifiedMapping(mal._id, { kind: 'anilist-idMal', type: 'ANIME', anilistId: 2, malId: 10 }));
    assert.equal((await media.resolve(mal._id)).anilistId, 1);
    await assert.rejects(repo.media.insertOne({ ...merged, _id: crypto.randomUUID() }), (error) => error.code === 11000);
    await assert.rejects(repo.media.insertOne({ _id: 'bad', type: 'BOOK', metadata: {}, sources: {}, revision: 0 }), (error) => error.code === 121);
    await media.ensure('ANIME', 'mal', 20);
    await media.ensure('ANIME', 'mal', 21);
    console.log('PASS: stable IDs, concurrency, media type separation, verified mappings, duplicate redirects, preserved references, unique indexes.');

    const sqlite = new DatabaseSync(filename);
    sqlite.exec("CREATE TABLE anime (id INTEGER PRIMARY KEY, title_romaji TEXT, genres TEXT, average_score INTEGER, cached_at TEXT, updated_at TEXT); CREATE TABLE manga (id INTEGER PRIMARY KEY, title_romaji TEXT, details_json TEXT, cached_at TEXT, updated_at TEXT); CREATE TABLE anime_tags (anime_id INTEGER, tag_id INTEGER, name TEXT)");
    sqlite.prepare('INSERT INTO anime VALUES (?, ?, ?, ?, ?, ?)').run(100, 'Fixture anime', '["Drama"]', 80, '2026-01-01 00:00:00', '2026-01-01 00:00:00');
    sqlite.prepare('INSERT INTO manga VALUES (?, ?, ?, ?, ?)').run(100, 'Fixture manga', JSON.stringify({ id: 100, type: 'MANGA', idMal: 50, description: 'Full manga description' }), '2026-01-01 00:00:00', '2026-01-01 00:00:00');
    sqlite.exec("INSERT INTO anime_tags VALUES (100, 2, 'Drama tag')");
    sqlite.close();
    const before = fs.readFileSync(filename);
    const data = readMediaData(filename);
    assert.equal(data.orphanReferences, 0);
    assert.equal(data.missingOptionalMappingTables.length, 2);
    const options = { client: connection.client, repo, data, source: 'fixture' };
    const countBefore = await repo.media.countDocuments();
    assert.equal((await importMedia(options)).ready, 2);
    assert.equal(await repo.media.countDocuments(), countBefore);
    assert.equal((await importMedia({ ...options, apply: true })).imported, 2);
    assert.equal((await importMedia({ ...options, verify: true })).verified, 2);
    assert.equal((await importMedia({ ...options, apply: true })).unchanged, 2);
    assert.deepEqual(fs.readFileSync(filename), before);
    const saved = await media.byProvider('ANIME', 'anilist', 100);
    assert.equal(saved.sources.anilist.metrics.average_score, 80);
    assert.equal(saved.metadata.tags[0].name, 'Drama tag');
    assert.equal((await media.byProvider('MANGA', 'mal', 50)).anilistId, 100);
    await repo.media.updateOne({ _id: saved._id }, { $set: { 'metadata.title_romaji': 'CORRUPTED' } });
    assert.equal((await importMedia({ ...options, verify: true })).conflicts.length, 1);
    await repo.media.updateOne({ _id: saved._id }, { $set: { 'metadata.title_romaji': 'Fixture anime' } });
    const changed = structuredClone(data); changed.entries[0].row.title_romaji = 'Changed source';
    assert.equal((await importMedia({ ...options, data: changed, apply: true })).conflicts.length, 1);
    assert.equal((await media.resolve(saved._id)).metadata.title_romaji, 'Fixture anime');
    const malformed = structuredClone(data); malformed.entries[0].row.genres = 'broken json';
    assert.equal((await importMedia({ ...options, data: malformed, source: 'invalid', apply: true })).conflicts.length, 1);
    const orphan = structuredClone(data); orphan.orphanReferences = 1;
    assert.equal((await importMedia({ ...options, data: orphan, apply: true })).conflicts.length, 1);
    console.log('PASS: read-only SQLite import, rich metadata, missing optional tables, receipts/reruns, corruption detection, conflict preflight.');

    server = createStagingServer({ getSession: async (token) => ({ authenticated: token === 'test-session' }) }, null, media);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/rpc`;
    const request = (method, args, authenticated = true) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
      ...(authenticated ? { Cookie: 'seenary_atlas_staging=test-session' } : {}) }, body: JSON.stringify({ method, args }) });
    assert.equal((await request('getMedia', [saved._id], false)).status, 401);
    assert.equal((await (await request('getMedia', [saved._id])).json()).media._id, saved._id);
    assert.equal((await (await request('resolveMedia', ['MANGA', 'mal', 50])).json()).media.type, 'MANGA');
    assert.equal((await request('attachVerifiedMapping', [])).status, 404);
    console.log('PASS: authenticated media reads and no client mapping-write endpoint.');
  } finally {
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); });
    try {
      for (const name of ['media', 'mediaRedirects', 'mediaMigrationReceipts']) await connection.db.collection(prefix + name).drop().catch((error) => { if (error.code !== 26) throw error; });
    } finally { await connection.close(); }
    if (fs.existsSync(filename)) fs.unlinkSync(filename);
    fs.rmdirSync(temp);
  }
}
main().catch((error) => {
  if (error.code === 'ERR_ASSERTION') console.error(`Media assertion failed at ${String(error.stack).split('\n')[1]?.trim()}`);
  else reportError(error);
  process.exitCode = 1;
});
