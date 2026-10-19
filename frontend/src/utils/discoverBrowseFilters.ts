export type DiscoverBrowseFilters = {
  genres: string[]; genreMode: 'all' | 'any'; tags: string[]; tagMode: 'all' | 'any'; years: number[]; season: string; status?: string;
};
export function createBrowseShelfId(filters: DiscoverBrowseFilters) {
  const normalized = { ...filters, genres: [...new Set(filters.genres)].sort(), tags: [...new Set(filters.tags)].sort(), years: [...new Set(filters.years)].sort((a,b)=>a-b) };
  const bytes = new TextEncoder().encode(JSON.stringify(normalized));
  return 'browse-filter-' + btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
