const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { WorkerCollection } = require('./atlas-worker-smoke');
const { createProviderCache } = require('../atlas/providerCache');
const { createCacheMaintenance } = require('../atlas/cacheMaintenance');
const { setupMetadata } = require('../atlas/metadata');
const { connectStaging, reportError } = require('../atlas/connection');

async function verify(queries) {
  let clock = 1700000000000;
  const cache = createProviderCache({ queries, now: () => clock, requestSpacingMs: 0 });
  await cache.fetchCached(JSON.stringify(['searchMedia', 'private raw query', true]), async () => ({ anime: [], manga: [] }), 2 * 3600000, async () => {});
  let tracked = await queries.findOne({ kind: 'search' });
  assert(tracked.createdAt instanceof Date); assert(tracked.lastAccessAt instanceof Date); assert.equal(tracked.accessRevision, 2);
  assert(!JSON.stringify(tracked).includes('private raw query'), 'cache metadata must not store the unhashed key');
  const firstAccess = tracked.lastAccessAt.getTime(); clock += 30 * 60000;
  await cache.fetchCached(JSON.stringify(['searchMedia', 'private raw query', true]), async () => { throw new Error('fresh cache expected'); }, 2 * 3600000, async () => {});
  assert.equal((await queries.findOne({ _id: tracked._id })).lastAccessAt.getTime(), firstAccess, 'access writes are throttled');

  clock += 31 * DAY;
  const old = date => new Date(clock - date);
  const rows = [
    { _id: 'details', kind: 'details', payload: { value: 'details' }, canonicalizedAt: old(10 * DAY), createdAt: old(10 * DAY), lastAccessAt: old(8 * DAY), accessRevision: 0, retryAt: new Date(0) },
    { _id: 'mapping', kind: 'mapping', payload: { anilistId: 1 }, createdAt: old(40 * DAY), lastAccessAt: old(31 * DAY), accessRevision: 0, retryAt: new Date(0) },
    { _id: 'failure', kind: 'search', createdAt: old(3 * DAY), lastAccessAt: old(2 * DAY), accessRevision: 0, retryAt: new Date(0) },
    { _id: 'lease', kind: 'search', payload: { keep: true }, createdAt: old(50 * DAY), lastAccessAt: old(40 * DAY), accessRevision: 0, retryAt: new Date(0), leaseUntil: new Date(clock + DAY) },
    { _id: 'retry', kind: 'search', createdAt: old(50 * DAY), lastAccessAt: old(40 * DAY), accessRevision: 0, retryAt: new Date(clock + DAY) },
    { _id: 'legacy', payload: { keep: true } },
  ];
  for (const row of rows) await queries.insertOne(row);
  let maintenance = createCacheMaintenance({ queries, now: () => clock });
  const dry = await maintenance.run({ dryRun: true, limit: 2 });
  assert.equal(dry.selected, 2); assert.equal(dry.deleted, 0); assert(dry.selectedBytes > 0); assert(!Object.hasOwn(dry, 'payload'));
  assert(await queries.findOne({ _id: 'details' }));
  let applied = await maintenance.run({ dryRun: false, limit: 2 }); assert.equal(applied.deleted, 2);
  applied = await createCacheMaintenance({ queries, now: () => clock }).run({ dryRun: false, limit: 10 });
  assert(applied.deleted >= 1, 'a restarted maintenance instance continues bounded cleanup');
  assert(await queries.findOne({ _id: 'lease' })); assert(await queries.findOne({ _id: 'retry' })); assert(await queries.findOne({ _id: 'legacy' }));

  await queries.insertOne({ _id: 'raced', kind: 'search', payload: { keep: true }, createdAt: old(50 * DAY), lastAccessAt: old(40 * DAY), accessRevision: 0, retryAt: new Date(0) });
  const originalDelete = queries.deleteOne.bind(queries); let raced = false;
  queries.deleteOne = async filter => { if (filter._id === 'raced' && !raced) { raced = true; await queries.updateOne({ _id: 'raced' }, { $set: { lastAccessAt: new Date(clock) }, $inc: { accessRevision: 1 } }); } return originalDelete(filter); };
  maintenance = createCacheMaintenance({ queries, now: () => clock }); await maintenance.run({ dryRun: false, limit: 10, byteBudget: 0 });
  assert(await queries.findOne({ _id: 'raced' }), 'concurrent access revision fences deletion');
  console.log('PASS: hashed query access metadata, throttled touches, dry-run/byte reports, bounded restart cleanup, retention classes, and lease/retry/access fencing.');
}
const DAY = 24 * 3600000;
async function main() {
  if (!process.argv.includes('--atlas')) return verify(new WorkerCollection());
  const connection = await connectStaging(); const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  try { await verify(await setupMetadata(connection.db, prefix)); }
  finally { try { await connection.db.collection(prefix + 'metadataQueries').drop().catch(error => { if (error.code !== 26) throw error; }); }
    finally { await connection.close(); } }
}
if (require.main === module) main().catch(error => { if (process.argv.includes('--atlas')) reportError(error); else console.error(error); process.exitCode = 1; });
module.exports = { main };
