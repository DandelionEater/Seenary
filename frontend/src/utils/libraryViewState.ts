import type { MediaType } from '../types/domain';
export type LibraryFilters = {
  listSearch: string; ratingFilter: 'all' | 'rated' | 'unrated' | 'excellent' | 'good' | 'mixed' | 'low';
  formatFilter: string; genreFilters: string[]; tagFilters: string[]; releaseFromYear: string; releaseToYear: string;
  releaseSeason: string; activityFilter: 'all' | 'today' | '7d' | '30d' | 'year'; minimumLength: string; maximumLength: string;
  favoriteOnly: boolean; filtersOpen: boolean;
};
export const emptyLibraryFilters: LibraryFilters = { listSearch: '', ratingFilter: 'all', formatFilter: 'all', genreFilters: [], tagFilters: [],
  releaseFromYear: '', releaseToYear: '', releaseSeason: 'all', activityFilter: 'all', minimumLength: '', maximumLength: '', favoriteOnly: false, filtersOpen: false };
const key = (userId: number, type: MediaType) => `seenary-library-view:${userId}:${type}`;
export function readLibraryView(userId: number, type: MediaType): { filters: LibraryFilters; scrollTop: number } {
  const filters = { ...emptyLibraryFilters };
  let scrollTop = 0;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key(userId, type)) || '{}');
    for (const field of Object.keys(filters) as Array<keyof LibraryFilters>) {
      const value = saved.filters?.[field];
      if (Array.isArray(filters[field])) {
        if (Array.isArray(value) && value.every(item => typeof item === 'string')) Object.assign(filters, { [field]: value });
      } else if (typeof value === typeof filters[field]) Object.assign(filters, { [field]: value });
    }
    if (!['all', 'rated', 'unrated', 'excellent', 'good', 'mixed', 'low'].includes(filters.ratingFilter)) filters.ratingFilter = 'all';
    if (!['all', 'today', '7d', '30d', 'year'].includes(filters.activityFilter)) filters.activityFilter = 'all';
    if (Number.isFinite(saved.scrollTop) && saved.scrollTop >= 0) scrollTop = saved.scrollTop;
  } catch { /* Views remain usable when session storage is unavailable. */ }
  return { filters, scrollTop };
}
export function saveLibraryView(userId: number, type: MediaType, patch: { filters?: LibraryFilters; scrollTop?: number }) {
  try { sessionStorage.setItem(key(userId, type), JSON.stringify({ ...readLibraryView(userId, type), ...patch })); } catch { /* Best effort only. */ }
}
