const { validId } = require('./media');
const { createProviderCache } = require('./providerCache');

function createMalMappingResolver({ media, queries, provider, now = () => Date.now(), requestSpacingMs = 1500 }) {
  const { fetchCached } = createProviderCache({ queries, now, requestSpacingMs });
  return {
    async resolve(type, malId) {
      if (!['ANIME', 'MANGA'].includes(type) || !validId(malId)) throw new Error('Invalid MAL identity.');
      const original = await media.byProvider(type, 'mal', malId);
      if (!original) return { status: 'missing' };
      if (original.anilistId) return { status: 'mapped', mediaId: original._id, anilistId: original.anilistId };
      try {
        const { payload } = await fetchCached(`mapping:mal:${type}:${malId}`, async () => {
          const rows = await provider.lookup(type, malId);
          if (!Array.isArray(rows) || rows.some(row => row.type !== type || row.idMal !== malId || !validId(row.id))) throw new Error('Invalid provider mapping response.');
          const ids = [...new Set(rows.map(row => row.id))];
          if (ids.length > 1) throw new Error('Ambiguous provider mapping.');
          return { anilistId: ids[0] || null };
        }, 24 * 3600000, async () => {});
        if (!payload.anilistId) return { status: 'unmatched', mediaId: original._id };
        const mapped = await media.attachVerifiedMapping(original._id, { kind: 'anilist-idMal', type, malId, anilistId: payload.anilistId });
        return { status: 'mapped', mediaId: mapped._id, anilistId: mapped.anilistId };
      } catch (error) {
        if (['MAPPING_REVIEW_REQUIRED', 'MAPPING_CONFLICT'].includes(error.code)) return { status: 'review-required', mediaId: original._id };
        return { status: 'deferred', mediaId: original._id };
      }
    },
  };
}
module.exports = { createMalMappingResolver };
