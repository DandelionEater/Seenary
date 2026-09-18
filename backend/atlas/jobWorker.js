const crypto = require('node:crypto');

const ACTIVE = ['pending', 'retry', 'running'];
const scopeId = job => JSON.stringify([job.userId, job.provider, job.mediaId]);
function safeCode(value, fallback = 'PROVIDER_ERROR') {
  const text = String(value || '');
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(text) ? text : fallback;
}
function retryDelay(attempt, retryAfterSeconds) {
  const requested = Number(retryAfterSeconds);
  if (Number.isFinite(requested) && requested > 0) return Math.min(requested * 1000, 24 * 3600000);
  return Math.min(30000 * (2 ** Math.max(0, attempt - 1)), 6 * 3600000);
}

function createJobWorker({ repo, now = () => Date.now(), leaseMs = 120000, maxAttempts = 10 }) {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error('Invalid worker configuration.');
  async function releaseLock(claim) {
    await repo.jobLocks.deleteOne({ _id: claim.scope, owner: claim.owner });
  }
  async function acquire(candidate) {
    const owner = crypto.randomUUID();
    const scope = scopeId(candidate);
    const time = now();
    let lock;
    try {
      lock = await repo.jobLocks.findOneAndUpdate({ _id: scope, $or: [{ leaseUntil: { $lte: new Date(time) } }, { leaseUntil: { $exists: false } }] },
        { $set: { userId: candidate.userId, provider: candidate.provider, mediaId: candidate.mediaId,
          owner, leaseUntil: new Date(time + leaseMs), updatedAt: new Date(time) } }, { upsert: true, returnDocument: 'after' });
    } catch (error) { if (error.code !== 11000) throw error; }
    if (!lock || lock.owner !== owner) return null;
    const claim = { scope, owner };
    try {
      const latest = await repo.jobs.findOne({ userId: candidate.userId, provider: candidate.provider, mediaId: candidate.mediaId,
        status: { $in: ACTIVE } }, { sort: { libraryRevision: -1, createdAt: -1 } });
      if (!latest) { await releaseLock(claim); return null; }
      await repo.jobs.updateMany({ userId: latest.userId, provider: latest.provider, mediaId: latest.mediaId,
        status: { $in: ACTIVE }, libraryRevision: { $lt: latest.libraryRevision } },
      { $set: { status: 'cancelled', cancellationReason: 'superseded', cancelledAt: new Date(time) },
        $unset: { leaseOwner: '', leaseUntil: '' } });
      const due = latest.status === 'running' ? new Date(latest.leaseUntil || 0).getTime() <= time
        : new Date(latest.nextAttemptAt || 0).getTime() <= time;
      if (!due) { await releaseLock(claim); return null; }
      const job = await repo.jobs.findOneAndUpdate({ _id: latest._id, status: latest.status,
        ...(latest.status === 'running' ? { leaseUntil: { $lte: new Date(time) } } : {
          $or: [{ nextAttemptAt: { $lte: new Date(time) } }, { nextAttemptAt: { $exists: false } }],
        }) }, { $set: { status: 'running', leaseOwner: owner, leaseUntil: new Date(time + leaseMs),
          startedAt: new Date(time), updatedAt: new Date(time) }, $inc: { claims: 1 } }, { returnDocument: 'after' });
      if (!job) { await releaseLock(claim); return null; }
      return { ...claim, job };
    } catch (error) { await releaseLock(claim); throw error; }
  }
  return {
    async claimBatch(limit = 10) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid claim limit.');
      const time = now();
      const candidates = await repo.jobs.find({ $or: [
        { status: { $in: ['pending', 'retry'] }, $or: [{ nextAttemptAt: { $lte: new Date(time) } }, { nextAttemptAt: { $exists: false } }] },
        { status: 'running', leaseUntil: { $lte: new Date(time) } },
      ] }).sort({ createdAt: 1 }).limit(Math.min(limit * 10, 500)).toArray();
      const claims = [];
      for (const candidate of candidates) {
        if (claims.length >= limit) break;
        const claim = await acquire(candidate);
        if (claim) claims.push(claim);
      }
      return claims;
    },
    async renew(claim) {
      const time = now();
      const job = await repo.jobs.updateOne({ _id: claim.job._id, status: 'running', leaseOwner: claim.owner,
        leaseUntil: { $gt: new Date(time) } }, { $set: { leaseUntil: new Date(time + leaseMs), updatedAt: new Date(time) } });
      const lock = await repo.jobLocks.updateOne({ _id: claim.scope, owner: claim.owner, leaseUntil: { $gt: new Date(time) } },
        { $set: { leaseUntil: new Date(time + leaseMs), updatedAt: new Date(time) } });
      return job.modifiedCount === 1 && lock.modifiedCount === 1;
    },
    async succeed(claim, result = {}) {
      const time = now();
      const update = await repo.jobs.updateOne({ _id: claim.job._id, status: 'running', leaseOwner: claim.owner },
        { $set: { status: 'succeeded', completedAt: new Date(time), updatedAt: new Date(time),
          ...(result.providerRevision == null ? {} : { providerRevision: String(result.providerRevision).slice(0, 200) }) },
        $unset: { leaseOwner: '', leaseUntil: '', lastErrorCode: '', nextAttemptAt: '' } });
      await releaseLock(claim);
      return update.modifiedCount === 1;
    },
    async retry(claim, error = {}) {
      const time = now();
      const attempts = (claim.job.attempts || 0) + 1;
      const terminal = attempts >= maxAttempts || error.retryable === false;
      const update = await repo.jobs.updateOne({ _id: claim.job._id, status: 'running', leaseOwner: claim.owner },
        { $set: { status: terminal ? 'failed' : 'retry', attempts, lastErrorCode: safeCode(error.code),
          updatedAt: new Date(time), ...(terminal ? { failedAt: new Date(time) }
            : { nextAttemptAt: new Date(time + retryDelay(attempts, error.retryAfter)) }) },
        $unset: { leaseOwner: '', leaseUntil: '' } });
      await releaseLock(claim);
      return { updated: update.modifiedCount === 1, terminal, attempts };
    },
    async cancel(claim, reason = 'cancelled') {
      const time = now();
      const update = await repo.jobs.updateOne({ _id: claim.job._id, status: 'running', leaseOwner: claim.owner },
        { $set: { status: 'cancelled', cancellationReason: safeCode(reason, 'CANCELLED').toLowerCase(), cancelledAt: new Date(time), updatedAt: new Date(time) },
          $unset: { leaseOwner: '', leaseUntil: '' } });
      await releaseLock(claim);
      return update.modifiedCount === 1;
    },
  };
}
module.exports = { createJobWorker, retryDelay, scopeId };
