const { validId } = require('./media');
const { createMalMetadataService } = require('./malMetadata');
const { createProviderCache } = require('./providerCache');
const { toMedia } = require('./metadata');

function createMalMetadataCache({ media, repo, queries, provider, now = () => Date.now(), requestSpacingMs = 1500 }) {
  const storage = createMalMetadataService({ media, repo, now });
  const { fetchCached } = createProviderCache({ queries, now, requestSpacingMs });
  return {
    async details(type, id) {
      if (!['ANIME', 'MANGA'].includes(type) || !validId(id)) throw new Error('Invalid MAL identity.');
      let document = await media.byProvider(type, 'mal', id);
      let stale = new Date(document?.sources.mal?.groups?.details?.freshUntil || 0).getTime() <= now();
      if (stale) {
        try {
          await fetchCached(`mal:details:${type}:${id}`, async () => {
            const observedAt = now();
            const raw = await provider.details(type, id);
            if (raw?.id !== id) throw new Error('MAL returned another title.');
            // No raw transport payload is persisted: ingest projects nested public fields.
            const saved = await storage.ingest(raw, type, 'details', observedAt);
            const complete = new Date(saved.sources.mal.groups?.details?.freshUntil || 0).getTime() > now();
            if (!complete) throw new Error('Partial MAL details response.');
            return { mediaId: saved._id };
          }, 0, async () => {});
        } catch { /* Canonical MAL data remains available on provider, lease, or retry failure. */ }
        document = await media.byProvider(type, 'mal', id);
        stale = new Date(document?.sources.mal?.groups?.details?.freshUntil || 0).getTime() <= now();
      }
      if (!document || !document.sources.mal?.details?.title) throw new Error('MAL metadata is unavailable.');
      document = await storage.promoteFallback(document._id);
      if (new Date(document.sources.anilist?.groups?.details?.freshUntil || 0).getTime() > now()) {
        return toMedia(document, { provider: 'anilist', stale: false });
      }
      return toMedia(document, { provider: 'mal', stale, fallback: 'mal',
        malFreshUntil: document.sources.mal.groups?.details?.freshUntil || null });
    },
  };
}
module.exports = { createMalMetadataCache };
