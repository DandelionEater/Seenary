const crypto = require('node:crypto');
const { calculateObjectSize } = require('bson');
const HOUR = 3600000;
function createProviderCache({ queries, now = () => Date.now(), requestSpacingMs = 1500 }) {
  const inFlight = new Map();
  let providerTail = Promise.resolve();
  let lastStart = 0;
  function kindFor(key) {
    if (key.startsWith('details:')) return 'details';
    if (key.startsWith('mapping:mal:')) return 'mapping';
    try {
      const name = JSON.parse(key)?.[0];
      return ({ searchMedia: 'search', getDiscoverMedia: 'discovery', getDiscoverShelfAnime: 'shelf',
        getStudioMedia: 'studio', 'animethemes:artist': 'artist', 'animethemes:title': 'theme-music',
        getReleaseCalendar: 'calendar',
        'anilist:artist-cards': 'artist-cards' })[name] || 'other';
    } catch { return 'other'; }
  }
  async function touch(id, cached) {
    if (new Date(cached?.lastAccessAt || 0).getTime() + HOUR > now()) return;
    await queries.updateOne({ _id: id, accessRevision: cached?.accessRevision || 0 },
      { $set: { lastAccessAt: new Date(now()) }, $inc: { accessRevision: 1 } });
  }
  async function schedule(task) {
    const run = providerTail.then(async () => {
      const delay = Math.max(0, lastStart + requestSpacingMs - now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      lastStart = now(); return task();
    });
    providerTail = run.catch(() => {});
    return run;
  }
  async function fetchCached(key, fetcher, ttl, consume) {
    if (inFlight.has(key)) return inFlight.get(key);
    const task = (async () => {
      const id = crypto.createHash('sha256').update(key).digest('hex');
      const cached = await queries.findOne({ _id: id });
      await touch(id, cached);
      if (cached?.payload && new Date(cached.freshUntil).getTime() > now()) return { payload: cached.payload, stale: false };
      if (new Date(cached?.retryAt || 0).getTime() > now()) {
        if (cached?.payload) return { payload: cached.payload, stale: true };
        throw new Error('Metadata retry is deferred.');
      }
      const lease = crypto.randomUUID();
      let claimed;
      try { claimed = await queries.findOneAndUpdate({ _id: id, $or: [{ leaseUntil: { $lte: new Date(now()) } }, { leaseUntil: { $exists: false } }] },
        { $set: { lease, leaseUntil: new Date(now() + 120000), kind: kindFor(key), lastAccessAt: new Date(now()) },
          $setOnInsert: { createdAt: new Date(now()) }, $inc: { accessRevision: 1 } }, { upsert: true, returnDocument: 'after' }); }
      catch (error) { if (error.code !== 11000) throw error; }
      if (!claimed) {
        if (cached?.payload) return { payload: cached.payload, stale: true };
        throw new Error('Metadata refresh is already running.');
      }
      try {
        const observedAt = now();
        const payload = await schedule(fetcher);
        if (calculateObjectSize({ payload }) > 12 * 1024 * 1024) throw new Error('Metadata response exceeds storage limit.');
        await consume(payload, observedAt);
        await queries.updateOne({ _id: id, lease }, { $set: { payload, fetchedAt: new Date(observedAt), freshUntil: new Date(observedAt + ttl),
          retryAt: new Date(0), canonicalizedAt: new Date(now()) }, $unset: { lease: '', leaseUntil: '' }, $inc: { accessRevision: 1 } });
        return { payload, stale: false };
      } catch (error) {
        const seconds = Number(error.retryAfter);
        const backoff = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 24 * HOUR) : 5 * 60000;
        await queries.updateOne({ _id: id, lease }, { $set: { retryAt: new Date(now() + backoff), lastFailureAt: new Date(now()) },
          $unset: { lease: '', leaseUntil: '' }, $inc: { accessRevision: 1 } });
        if (cached?.payload) return { payload: cached.payload, stale: true };
        throw new Error('Provider metadata is unavailable.');
      }
    })();
    inFlight.set(key, task);
    try { return await task; } finally { inFlight.delete(key); }
  }
  return { fetchCached, schedule };
}
module.exports = { createProviderCache };
