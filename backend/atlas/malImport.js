const { validId } = require('./media');
const { createMalMetadataService } = require('./malMetadata');
const { toMedia } = require('./metadata');

function createMalImportService({ media, repo, provider, now = () => Date.now() }) {
  const storage = createMalMetadataService({ media, repo, now });
  const statusMap = { watching: 'watching', reading: 'watching', completed: 'completed', on_hold: 'paused', dropped: 'dropped', plan_to_watch: 'planned', plan_to_read: 'planned' };
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : undefined;
  return {
    async preview(username) {
      if (typeof username !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(username.trim()) || username.trim() === '@me') throw new Error('Invalid MAL username.');
      const collections = [];
      for (const type of ['ANIME', 'MANGA']) {
        const observedAt = now();
        const result = await provider.collection(type, username.trim());
        if (!Array.isArray(result?.data) || result.truncated || result.data.length > 5000) throw new Error('MAL list is incomplete or exceeds the preview limit.');
        collections.push({ type, result, observedAt });
      }
      const groups = [];
      for (const { type, result, observedAt } of collections) {
        const items = [], seen = new Set();
        for (const { node, list_status: personal } of result.data) {
          const status = statusMap[personal?.status];
          if (!validId(node?.id) || typeof node.title !== 'string' || !node.title.trim() || !status || seen.has(node.id)) continue;
          seen.add(node.id);
          const document = await storage.ingest(node, type, 'card', observedAt);
          const publicMedia = toMedia(document, { provider: 'mal', stale: true });
          const id = document.anilistId || -node.id;
          const item = { animeId: id, mediaId: id, ...(type === 'MANGA' ? { mangaId: id } : {}), mediaType: type, status,
            media: publicMedia, title: publicMedia.title, coverImage: publicMedia.coverImage,
            startedAt: date(personal.start_date), completedAt: date(personal.finish_date) };
          for (const [key, value] of Object.entries({ progress: type === 'ANIME' ? personal.num_episodes_watched : personal.num_chapters_read,
            ...(type === 'MANGA' ? { volumeProgress: personal.num_volumes_read } : {}),
            repeatCount: type === 'ANIME' ? personal.num_times_rewatched : personal.num_times_reread })) {
            if (Number.isSafeInteger(value) && value >= 0) item[key] = value;
          }
          if (typeof personal.score === 'number' && Number.isFinite(personal.score) && personal.score >= 0 && personal.score <= 10) item.score = personal.score;
          if (typeof personal.comments === 'string') item.notes = personal.comments;
          const repeating = type === 'ANIME' ? personal.is_rewatching : personal.is_rereading;
          if (typeof repeating === 'boolean') item.isRepeating = repeating;
          items.push(item);
        }
        for (const status of ['watching', 'planned', 'completed', 'paused', 'dropped']) {
          const selected = items.filter(item => item.status === status);
          if (selected.length) groups.push({ status, mediaType: type, items: selected });
        }
      }
      const count = type => groups.filter(group => group.mediaType === type).reduce((sum, group) => sum + group.items.length, 0);
      return { ok: true, username: username.trim(), preview: { groups, totalFound: count('ANIME') + count('MANGA'), animeFound: count('ANIME'), mangaFound: count('MANGA') } };
    },
  };
}
module.exports = { createMalImportService };
