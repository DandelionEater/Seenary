// Resolve each prequel's own date so branches never inherit a sibling's premiere.
async function resolveSeriesStartDate(media, { fetchMedia, getSaved = async () => null, save = async () => {} }) {
  const resolved = new Map();
  async function visit(entry, path = new Set()) {
    const id = Number(entry?.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid series identity.');
    if (path.has(id) || path.size >= 10) throw new Error('Incomplete series history.');
    if (resolved.has(id)) return resolved.get(id);
    const saved = await getSaved(id);
    if (saved?.year) return saved;
    const nextPath = new Set([...path, id]);
    if (!entry.relations) entry = await fetchMedia(id);
    if (!entry?.relations) throw new Error('Missing series relations.');
    let earliest = entry.startDate;
    for (const edge of entry.relations.edges || []) {
      if (edge.relationType !== 'PREQUEL' || !edge.node?.id) continue;
      const candidate = await visit(edge.node, nextPath);
      if (candidate?.year && (!earliest?.year || dateValue(candidate) < dateValue(earliest))) earliest = candidate;
    }
    if (!earliest?.year) throw new Error('Missing series release date.');
    await save(id, earliest);
    resolved.set(id, earliest);
    return earliest;
  }
  return visit(media);
}
function dateValue(date) {
  return date.year * 10000 + (date.month || 1) * 100 + (date.day || 1);
}
module.exports = { resolveSeriesStartDate };
