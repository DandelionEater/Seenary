require('../env');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createJobWorker } = require('../atlas/jobWorker');
const { Collection } = require('./atlas-metadata-smoke');
const { connectStaging, reportError } = require('../atlas/connection');
const { setupLibrary, LIBRARY_COLLECTIONS } = require('../atlas/librarySchema');

class WorkerCollection extends Collection {
  async insertOne(value) {
    if (await this.findOne({ _id: value._id })) throw Object.assign(new Error('Duplicate key'), { code: 11000 });
    this.rows.push(structuredClone(value)); return { insertedId: value._id };
  }
  async countDocuments(query = {}) { return (await this.find(query).toArray()).length; }
  async updateOne(query, update) {
    const before = await this.findOne(query);
    if (!before) return { matchedCount: 0, modifiedCount: 0 };
    await super.findOneAndUpdate(query, update);
    return { matchedCount: 1, modifiedCount: 1 };
  }
}
const job = (id, revision, scope = 'a', extra = {}) => ({ _id: id, kind: 'provider-library', userId: `user-${scope}`,
  mediaId: `media-${scope}`, provider: 'anilist', providerLinkId: `link-${scope}`, providerLinkRevision: 1,
  providerMediaId: revision, libraryRevision: revision, operation: 'upsert', status: 'pending', payload: {}, mediaType: 'ANIME',
  createdAt: new Date(1700000000000 + revision), ...extra });

async function verify(repo) {
  let clock = 1700001000000;
  const create = (options = {}) => createJobWorker({ repo, now: () => clock, leaseMs: 1000, ...options });
  await repo.jobs.insertOne(job('old', 1)); await repo.jobs.insertOne(job('new', 2));
  const first = (await create().claimBatch(10))[0];
  assert.equal(first.job._id, 'new');
  assert.equal((await repo.jobs.findOne({ _id: 'old' })).status, 'cancelled');
  assert.equal((await create().claimBatch(10)).length, 0, 'scope lock prevents concurrent delivery');
  clock += 100;
  assert.equal(await create().renew(first), true);

  clock += 1100;
  const recovered = (await create().claimBatch(1))[0];
  assert.equal(recovered.job._id, 'new'); assert.notEqual(recovered.owner, first.owner);
  assert.equal(await create().succeed(first), false, 'expired owner is fenced');
  assert.equal(await create().succeed(recovered, { providerRevision: 'remote-2' }), true);
  assert.equal((await repo.jobs.findOne({ _id: 'new' })).status, 'succeeded');

  await repo.jobs.insertOne(job('retry', 1, 'b'));
  let claim = (await create().claimBatch(1))[0];
  const retried = await create().retry(claim, { code: 'RATE_LIMITED', retryAfter: 90 });
  assert.equal(retried.terminal, false); assert.equal(retried.attempts, 1);
  let saved = await repo.jobs.findOne({ _id: 'retry' });
  assert.equal(saved.lastErrorCode, 'RATE_LIMITED'); assert.equal(saved.nextAttemptAt.getTime(), clock + 90000);
  assert.equal((await create().claimBatch(1)).length, 0);
  clock += 90000;
  claim = (await create().claimBatch(1))[0];
  assert.equal(claim.job._id, 'retry', 'new worker recovers persisted retry');
  await create({ maxAttempts: 2 }).retry(claim, { code: 'BROKEN', message: 'SECRET_PROVIDER_BODY' });
  saved = await repo.jobs.findOne({ _id: 'retry' });
  assert.equal(saved.status, 'failed'); assert(!JSON.stringify(saved).includes('SECRET_PROVIDER_BODY'));

  for (const scope of ['c', 'd', 'e']) await repo.jobs.insertOne(job(`job-${scope}`, 1, scope));
  const bounded = await create().claimBatch(2);
  assert.equal(bounded.length, 2);
  for (const item of bounded) await create().cancel(item, 'UNLINKED');
  assert.equal(await repo.jobs.countDocuments({ status: 'running' }), 0);
  assert.equal((await create().claimBatch(2)).length, 1);
  await assert.rejects(create().claimBatch(101));
  console.log('PASS: durable claims, scope locks, superseding, bounded batches, renewal, expired-lease recovery, fencing, Retry-After, terminal backoff and safe errors.');
}

async function main() {
  if (!process.argv.includes('--atlas')) return verify({ jobs: new WorkerCollection(), jobLocks: new WorkerCollection() });
  const connection = await connectStaging();
  const prefix = `batch1_test_${crypto.randomBytes(10).toString('hex')}_`;
  try { await verify(await setupLibrary(connection.db, prefix)); }
  finally {
    try { for (const name of LIBRARY_COLLECTIONS) await connection.db.collection(prefix + name).drop().catch(error => { if (error.code !== 26) throw error; }); }
    finally { await connection.close(); }
  }
}
if (require.main === module) main().catch(error => {
  if (error.code === 'ERR_ASSERTION') console.error(`Worker assertion failed: ${error.message}`);
  else if (!process.argv.includes('--atlas')) console.error(`Worker smoke failed: ${error.name}: ${error.message}`);
  else reportError(error);
  process.exitCode = 1;
});
module.exports = { WorkerCollection, job, main };
