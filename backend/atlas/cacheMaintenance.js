const { calculateObjectSize } = require('bson');
const DAY = 24 * 3600000;
const RETENTION = { details: 7 * DAY, mapping: 30 * DAY, search: 30 * DAY, discovery: 30 * DAY,
  shelf: 30 * DAY, studio: 30 * DAY, artist: 30 * DAY, 'artist-cards': 30 * DAY, other: 30 * DAY };

function createCacheMaintenance({ queries, now = () => Date.now() }) {
  const protectedNow = row => new Date(row.leaseUntil || 0).getTime() > now() || new Date(row.retryAt || 0).getTime() > now();
  function safe(row) {
    if (!row.kind || !row.createdAt || !row.lastAccessAt || protectedNow(row)) return false;
    if (row.kind === 'details' && !row.canonicalizedAt) return false;
    return true;
  }
  function expired(row) {
    if (!safe(row)) return false;
    const age = now() - new Date(row.lastAccessAt).getTime();
    if (!row.payload) return age >= DAY;
    return age >= (RETENTION[row.kind] || RETENTION.other);
  }
  return {
    async run({ dryRun = true, limit = 100, byteBudget = Number.POSITIVE_INFINITY } = {}) {
      if (typeof dryRun !== 'boolean' || !Number.isSafeInteger(limit) || limit < 1 || limit > 500
          || !(byteBudget === Number.POSITIVE_INFINITY || Number.isSafeInteger(byteBudget) && byteBudget >= 0)) throw new Error('Invalid maintenance options.');
      const rows = await queries.find({ kind: { $exists: true }, createdAt: { $exists: true }, lastAccessAt: { $exists: true } })
        .sort({ lastAccessAt: 1, _id: 1 }).toArray();
      const sizes = new Map(rows.map(row => [row._id, calculateObjectSize(row)]));
      let totalBytes = [...sizes.values()].reduce((sum, size) => sum + size, 0);
      const candidates = rows.filter(expired); const pressureCandidates = rows.filter(safe);
      const selected = [];
      for (const row of pressureCandidates) {
        if (selected.length >= limit) break;
        if (!expired(row) && totalBytes <= byteBudget) continue;
        selected.push(row); totalBytes -= sizes.get(row._id);
      }
      let deleted = 0; let deletedBytes = 0;
      if (!dryRun) for (const row of selected) {
        const result = await queries.deleteOne({ _id: row._id, accessRevision: row.accessRevision || 0 });
        if (result.deletedCount === 1) { deleted++; deletedBytes += sizes.get(row._id); }
      }
      return { dryRun, scanned: rows.length, eligible: candidates.length, pressureEligible: pressureCandidates.length, selected: selected.length,
        selectedBytes: selected.reduce((sum, row) => sum + sizes.get(row._id), 0), deleted, deletedBytes,
        bytesBefore: [...sizes.values()].reduce((sum, size) => sum + size, 0), projectedBytes: totalBytes };
    },
  };
}
module.exports = { createCacheMaintenance, RETENTION };
