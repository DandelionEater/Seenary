const assert = require('node:assert/strict');
const { Collection } = require('./atlas-metadata-smoke');
const { createMediaService } = require('../atlas/media');
const { createMetadataService } = require('../atlas/metadata');
const { createStagingServer } = require('../atlas/stagingServer');

async function main() {
  const repo = { media: new Collection(), mediaRedirects: new Collection() }, queries = new Collection();
  const media = createMediaService({}, repo);
  let calls = 0;
  const provider = { people: async (type, id, kind, page) => {
    calls++;
    return { id, type, kind, edges: Array.from({ length: page === 3 ? 5 : 20 }, (_, index) => ({ role: 'Supporting', node: { id: (page - 1) * 20 + index + 1 } })),
      pageInfo: { currentPage: page, hasNextPage: page < 3 } };
  } };
  const service = createMetadataService({ media, repo, queries, provider, requestSpacingMs: 0 });
  const all = [];
  for (let page = 1; ; page++) {
    const result = await service.query('getMediaPeople', ['ANIME', 1, 'character', page]);
    all.push(...result.edges);
    if (!result.pageInfo.hasNextPage) break;
  }
  assert.equal(all.length, 45, 'cast extends beyond the old 20-person response');
  await service.query('getMediaPeople', ['ANIME', 1, 'character', 2]);
  assert.equal(calls, 3, 'expanded pages use the shared cache');
  await service.query('getMediaPeople', ['ANIME', 1, 'staff', 1]);
  await service.query('getMediaPeople', ['MANGA', 1, 'character', 1]);
  assert.equal(calls, 5, 'staff and manga use separate cache identities');
  await assert.rejects(service.query('getMediaPeople', ['ANIME', 1, 'other', 1]), /Invalid/);
  const server = createStagingServer({ getSession: async token => ({ authenticated: token === 'test-token' }) }, null, null, null, service);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const request = authenticated => fetch(`http://127.0.0.1:${server.address().port}/rpc`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: 'seenary_atlas_staging=test-token' } : {}) },
      body: JSON.stringify({ method: 'getMediaPeople', args: ['ANIME', 1, 'staff', 1] }),
    });
    assert.equal((await request(false)).status, 401);
    const response = await request(true);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).edges.length, 20);
  } finally { await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); }
  console.log('PASS: complete paginated cast, cached additional pages, separate staff/manga identities, and authenticated people routes.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
