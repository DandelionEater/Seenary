function sanitizeTitle(item) {
  if (!item || !Number.isSafeInteger(item.id) || item.id === 0 || !['ANIME', 'MANGA'].includes(item.type) || typeof item.title !== 'string') return null;
  return { id: item.id, type: item.type, title: item.title.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 100) || 'Untitled' };
}
function sanitizeLibrary(value) {
  if (!value || value.signedIn !== true) return { signedIn: false, watching: [], recent: [], continueWatching: null };
  const titles = rows => Array.isArray(rows) ? rows.map(sanitizeTitle).filter(Boolean).slice(0, 6) : [];
  return { signedIn: true, watching: titles(value.watching), recent: titles(value.recent), continueWatching: sanitizeTitle(value.continueWatching) };
}
function libraryMenu(state, navigate) {
  if (!state.signedIn) return [];
  const open = item => ({ label: item.title, click: () => navigate({ action: 'title', id: item.id, type: item.type }) });
  return [
    { label: state.continueWatching ? `Continue: ${state.continueWatching.title}` : 'Continue watching', enabled: Boolean(state.continueWatching), click: () => state.continueWatching && navigate({ action: 'title', id: state.continueWatching.id, type: state.continueWatching.type }) },
    { label: 'Watching', submenu: [{ label: 'Open Watching list', click: () => navigate({ action: 'watching' }) },
      ...(state.watching.length ? [{ type: 'separator' }, ...state.watching.map(open)] : [])] },
    { label: 'Recently opened', submenu: state.recent.length ? state.recent.map(open) : [{ label: 'No recently opened titles', enabled: false }] },
    { type: 'separator' },
  ];
}
module.exports = { sanitizeLibrary, libraryMenu };
